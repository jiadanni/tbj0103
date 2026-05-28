use crate::commands::flashcard::{generate_card_pairs, insert_card, CardDifficulty};
use crate::db::DbState;
use crate::models::learning_card::LearningCard;
use crate::models::workspace::TopicSignature;
use rusqlite::Connection;

/// One row from the `flashcard_topics` table.
#[derive(Debug, Clone)]
pub struct FlashcardTopicRow {
    pub id: String,
    pub workspace_id: String,
    pub topic: String,
    pub mastery_score: f64,
    pub last_generated_at: Option<String>,
    pub card_count: i64,
}

const TARGET_CARDS_PER_TOPIC: i64 = 8;
const DEFAULT_MIN_INTERVAL_MINUTES: i64 = 60;
const DEFAULT_BATCH_SIZE: u32 = 3;

/// Read the workspace topic_signature JSON and upsert each topic into `flashcard_topics`.
/// Idempotent — existing rows keep their mastery_score and card_count.
pub fn sync_topics_from_signatures(conn: &Connection, workspace_id: &str) -> Result<(), String> {
    let sig_json: String = conn
        .query_row(
            "SELECT topic_signature FROM workspaces WHERE id = ?1",
            rusqlite::params![workspace_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let signature: TopicSignature = serde_json::from_str(&sig_json).unwrap_or_default();

    let mut seen: Vec<String> = Vec::new();
    for tag in &signature.auto_detected_tags {
        let t = tag.tag.trim();
        if !t.is_empty() && !signature.excluded_tags.iter().any(|e| e.eq_ignore_ascii_case(t)) {
            seen.push(t.to_string());
        }
    }
    for t in &signature.custom_tags {
        let t = t.trim();
        if !t.is_empty() {
            seen.push(t.to_string());
        }
    }

    for topic in seen {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO flashcard_topics (id, workspace_id, topic, source, mastery_score, card_count, created_at)
             VALUES (?1, ?2, ?3, 'chat_signature', 0.0, 0, ?4)",
            rusqlite::params![id, workspace_id, topic, now],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Compute mastery score for one topic from its cards' average SM-2 ease factor.
/// Returns a value in [0.0, 1.0]. Persists to flashcard_topics.mastery_score and card_count.
pub fn recompute_mastery(conn: &Connection, topic_id: &str) -> Result<f64, String> {
    let (count, avg_ease): (i64, f64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(AVG(ease_factor), 2.5) FROM learning_cards WHERE topic_id = ?1",
            rusqlite::params![topic_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let mastery = ((avg_ease - 1.3) / (3.0 - 1.3)).clamp(0.0, 1.0);
    conn.execute(
        "UPDATE flashcard_topics SET mastery_score = ?1, card_count = ?2 WHERE id = ?3",
        rusqlite::params![mastery, count, topic_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(mastery)
}

/// When a card is reviewed, refresh its topic's mastery. Cheap UPDATE.
pub fn on_card_reviewed(conn: &Connection, topic_id: &str) {
    let _ = recompute_mastery(conn, topic_id);
}

/// Generate one batch of cards for the given topic and insert them.
pub async fn generate_for_topic(
    state: &DbState,
    topic: &FlashcardTopicRow,
    model: &str,
    count: u32,
    ollama_url: Option<String>,
) -> Result<Vec<LearningCard>, String> {
    let difficulty = CardDifficulty::from_mastery(topic.mastery_score);
    let pairs = generate_card_pairs(&topic.topic, model, count, difficulty, ollama_url).await?;

    let mut conn = state.0.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut cards = Vec::new();
    for (front, back) in pairs {
        let mut card = LearningCard::new(topic.workspace_id.clone(), front, back);
        card.source_type = "chat_topic".to_string();
        card.topic_id = Some(topic.id.clone());
        insert_card(&tx, &card).map_err(|e| e.to_string())?;
        cards.push(card);
    }
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "UPDATE flashcard_topics SET last_generated_at = ?1, card_count = card_count + ?2 WHERE id = ?3",
        rusqlite::params![now, cards.len() as i64, topic.id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(cards)
}

/// Background scheduler tick. Generates at most one batch per call across all workspaces.
pub async fn tick(state: &DbState, ollama_url: Option<String>) -> Result<(), String> {
    let (workspace_ids, model, min_interval) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let model_raw = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'preferred_model'",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap_or_default();
        let model = model_raw.trim_matches('"').to_string();
        let interval = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'flashcard_topic_min_interval_minutes'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
            .and_then(|v| v.trim_matches('"').parse::<i64>().ok())
            .unwrap_or(DEFAULT_MIN_INTERVAL_MINUTES);

        let mut stmt = conn
            .prepare("SELECT id FROM workspaces WHERE is_hidden = 0")
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        (ids, model, interval)
    };

    if model.is_empty() {
        return Ok(());
    }

    for ws_id in &workspace_ids {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let _ = sync_topics_from_signatures(&conn, ws_id);
    }

    for ws_id in &workspace_ids {
        let due = {
            let conn = state.0.get().map_err(|e| e.to_string())?;
            // Only consider topics that still need more cards under our target.
            let mut stmt = conn
                .prepare(
                    "SELECT id, workspace_id, topic, mastery_score, last_generated_at, card_count
                     FROM flashcard_topics
                     WHERE workspace_id = ?1
                       AND card_count < ?2
                       AND (last_generated_at IS NULL
                            OR datetime(last_generated_at) < datetime('now', ?3))
                     ORDER BY card_count ASC, mastery_score ASC
                     LIMIT 1",
                )
                .map_err(|e| e.to_string())?;
            let cooldown = format!("-{min_interval} minutes");
            stmt.query_row(rusqlite::params![ws_id, TARGET_CARDS_PER_TOPIC, cooldown], |r| {
                Ok(FlashcardTopicRow {
                    id: r.get(0)?,
                    workspace_id: r.get(1)?,
                    topic: r.get(2)?,
                    mastery_score: r.get(3)?,
                    last_generated_at: r.get(4)?,
                    card_count: r.get(5)?,
                })
            })
            .ok()
        };

        if let Some(topic) = due {
            let _ = generate_for_topic(state, &topic, &model, DEFAULT_BATCH_SIZE, ollama_url.clone()).await;
            return Ok(()); // One batch per tick.
        }
    }

    Ok(())
}
