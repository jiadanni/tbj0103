use crate::commands::flashcard::{generate_card_pairs, insert_card, CardDifficulty};
use crate::commands::knowledge_graph::upsert_concept_from_tag_inner;
use crate::db::DbState;
use crate::models::learning_card::LearningCard;
use crate::models::workspace::TopicSignature;
use crate::services::model_settings::get_model_for_job;
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

const DEFAULT_TARGET_CARDS_PER_TOPIC: i64 = 20;
const DEFAULT_MIN_INTERVAL_MINUTES: i64 = 60;
const DEFAULT_BATCH_SIZE: u32 = 3;

/// How many cards a topic accumulates before background generation stops
/// adding to it. Overridable via the `flashcard_topic_target_cards` setting.
pub(crate) fn topic_target_cards(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'flashcard_topic_target_cards'",
        [],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.trim_matches('"').parse::<i64>().ok())
    .map(|v| v.clamp(1, 200))
    .unwrap_or(DEFAULT_TARGET_CARDS_PER_TOPIC)
}

/// DEPRECATED: legacy bridge from `workspaces.topic_signature` to `flashcard_topics`.
/// Now a no-op so that `flashcard_topics` stops growing. Callers should use
/// [`sync_concepts_from_signatures`] instead. Existing `flashcard_topics` rows
/// remain readable so existing code paths keep working.
pub fn sync_topics_from_signatures(_conn: &Connection, _workspace_id: &str) -> Result<(), String> {
    Ok(())
}

/// Read the workspace topic_signature JSON and upsert each tag into `concept_nodes`
/// as a top-level concept (no parent). Idempotent — case-insensitive match against
/// `concept_nodes.name` and `aliases`. This is the new bridge that replaces the
/// legacy `flashcard_topics` path so the Learning hub sees one taxonomy.
pub fn sync_concepts_from_signatures(conn: &Connection, workspace_id: &str) -> Result<(), String> {
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
        if !t.is_empty()
            && !signature
                .excluded_tags
                .iter()
                .any(|e| e.eq_ignore_ascii_case(t))
        {
            seen.push(t.to_string());
        }
    }
    for t in &signature.custom_tags {
        let t = t.trim();
        if !t.is_empty() {
            seen.push(t.to_string());
        }
    }

    for tag in seen {
        let _ = upsert_concept_from_tag_inner(conn, workspace_id, &tag);
    }
    Ok(())
}

/// Normalise a topic for grouping: lowercase, trim, collapse British/US z↔s.
#[allow(dead_code)]
fn normalise_topic(t: &str) -> String {
    t.trim().to_lowercase().replace(['-', '_'], " ")
}

/// First "word" used for parent grouping. Collapses `ise/ize`, `isation/ization`.
#[allow(dead_code)]
fn group_key(t: &str) -> String {
    let n = normalise_topic(t);
    let first = n.split_whitespace().next().unwrap_or("").to_string();
    // memoisation / memoization -> "memo"; profiler / profilers -> "profile"
    // Strip common trailing morphemes so spelling variants and plurals collapse.
    let stripped = first
        .trim_end_matches("isation")
        .trim_end_matches("ization")
        .trim_end_matches("ise")
        .trim_end_matches("ize")
        .trim_end_matches("ers")
        .trim_end_matches("er")
        .trim_end_matches('s')
        .to_string();
    if stripped.len() >= 3 {
        stripped
    } else {
        first
    }
}

/// Group topics by their first-word key. When ≥2 siblings share a key,
/// elect the shortest topic as the parent and link the others to it.
/// Idempotent: rerunning is safe and converges on the same parent assignments.
#[allow(dead_code)]
fn reconcile_parents(conn: &Connection, workspace_id: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id, topic FROM flashcard_topics WHERE workspace_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String)> = stmt
        .query_map(rusqlite::params![workspace_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    let mut groups: std::collections::HashMap<String, Vec<(String, String)>> =
        std::collections::HashMap::new();
    for (id, topic) in rows {
        let key = group_key(&topic);
        if key.len() < 3 {
            continue;
        }
        groups.entry(key).or_default().push((id, topic));
    }

    for (_key, mut members) in groups {
        if members.len() < 2 {
            // Single-member group → ensure it's a root.
            if let Some((id, _)) = members.into_iter().next() {
                conn.execute(
                    "UPDATE flashcard_topics SET parent_topic_id = NULL WHERE id = ?1",
                    rusqlite::params![id],
                )
                .map_err(|e| e.to_string())?;
            }
            continue;
        }
        // Sort by topic length then alphabetical for stability; pick shortest as parent.
        members.sort_by(|a, b| a.1.len().cmp(&b.1.len()).then_with(|| a.1.cmp(&b.1)));
        let (parent_id, _) = members[0].clone();
        // Parent itself has no parent.
        conn.execute(
            "UPDATE flashcard_topics SET parent_topic_id = NULL WHERE id = ?1",
            rusqlite::params![parent_id],
        )
        .map_err(|e| e.to_string())?;
        for (child_id, _) in members.iter().skip(1) {
            conn.execute(
                "UPDATE flashcard_topics SET parent_topic_id = ?1 WHERE id = ?2 AND id != ?1",
                rusqlite::params![parent_id, child_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn group_key_collapses_spelling_and_morphology() {
        assert_eq!(group_key("memoisation"), group_key("memoization"));
        assert_eq!(group_key("profiler"), group_key("profilers"));
        assert_eq!(group_key("React performance"), "react");
        assert_eq!(group_key("react profiler"), "react");
    }
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
    // Feed the topic's existing questions into the prompt so regeneration
    // extends coverage instead of duplicating cards.
    let existing_fronts: Vec<String> = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT front FROM learning_cards
                 WHERE topic_id = ?1
                 ORDER BY created_at DESC
                 LIMIT 30",
            )
            .map_err(|e| e.to_string())?;
        let fronts: Vec<String> = stmt
            .query_map(rusqlite::params![topic.id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        fronts
    };
    let pairs = generate_card_pairs(
        &topic.topic,
        model,
        count,
        difficulty,
        &existing_fronts,
        ollama_url,
    )
    .await?;

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
    tick_for_workspaces(state, ollama_url, None).await
}

pub async fn tick_for_workspaces(
    state: &DbState,
    ollama_url: Option<String>,
    workspace_filter: Option<&[String]>,
) -> Result<(), String> {
    let (workspace_ids, model, min_interval, target_cards) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let model = get_model_for_job(&conn, "flashcard_model").unwrap_or_default();
        let target_cards = topic_target_cards(&conn);
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
            .filter(|id| match workspace_filter {
                Some(filter) => filter.iter().any(|ws| ws == id),
                None => true,
            })
            .collect();
        (ids, model, interval, target_cards)
    };

    if model.is_empty() {
        return Ok(());
    }

    for ws_id in &workspace_ids {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let _ = sync_concepts_from_signatures(&conn, ws_id);
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
            stmt.query_row(
                rusqlite::params![ws_id, target_cards, cooldown],
                |r| {
                    Ok(FlashcardTopicRow {
                        id: r.get(0)?,
                        workspace_id: r.get(1)?,
                        topic: r.get(2)?,
                        mastery_score: r.get(3)?,
                        last_generated_at: r.get(4)?,
                        card_count: r.get(5)?,
                    })
                },
            )
            .ok()
        };

        if let Some(topic) = due {
            // Propagate generation failures so the scheduler records a failed
            // run with the real error (e.g. model missing, unparseable JSON).
            // Swallowing them here made every run report "completed" while
            // producing zero cards.
            generate_for_topic(
                state,
                &topic,
                &model,
                DEFAULT_BATCH_SIZE,
                ollama_url.clone(),
            )
            .await
            .map_err(|e| format!("Flashcard generation for topic \"{}\" failed: {e}", topic.topic))?;
            return Ok(()); // One batch per tick.
        }
    }

    Ok(())
}
