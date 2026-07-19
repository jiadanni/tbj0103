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

/// Hours between duplicate-cleanup sweeps. Overridable via the
/// `flashcard_cleanup_interval_hours` setting.
pub(crate) const DEFAULT_CLEANUP_INTERVAL_HOURS: i64 = 24;
/// Topics examined per cleanup sweep (one LLM call each).
const CLEANUP_TOPICS_PER_RUN: i64 = 10;

/// Rough parameter count (in billions) parsed from a model name like
/// "qwen3:4b" or "gemma3:27b"; 0.0 when unknown so unknown provenance loses
/// ties against known models.
fn model_params_b(model: &str) -> f64 {
    let lower = model.to_lowercase();
    let bytes = lower.as_bytes();
    let mut best: f64 = 0.0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                i += 1;
            }
            if i < bytes.len() && (bytes[i] == b'b' || bytes[i] == b'm') {
                if let Ok(value) = lower[start..i].parse::<f64>() {
                    let scaled = if bytes[i] == b'b' { value } else { value / 1000.0 };
                    if scaled > best {
                        best = scaled;
                    }
                }
            }
        } else {
            i += 1;
        }
    }
    best
}

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
        card.generated_by_model = Some(model.to_string());
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

/// Pick the single most-starved due topic across all eligible workspaces.
///
/// Selection is global — NOT per-workspace — so one workspace with many
/// unfilled topics cannot monopolize the one-batch-per-tick budget while
/// every other workspace stays at zero cards. The user's active workspace
/// wins ties first; after that, the topic with the fewest cards.
pub(crate) fn next_due_topic(
    conn: &Connection,
    workspace_filter: Option<&[String]>,
    target_cards: i64,
    min_interval_minutes: i64,
    current_workspace: Option<&str>,
) -> Option<FlashcardTopicRow> {
    let cooldown = format!("-{min_interval_minutes} minutes");
    let mut sql = String::from(
        "SELECT ft.id, ft.workspace_id, ft.topic, ft.mastery_score, ft.last_generated_at, ft.card_count
         FROM flashcard_topics ft
         JOIN workspaces w ON w.id = ft.workspace_id
         WHERE w.is_hidden = 0
           AND ft.card_count < ?1
           AND (ft.last_generated_at IS NULL
                OR datetime(ft.last_generated_at) < datetime('now', ?2))",
    );
    let mut values: Vec<rusqlite::types::Value> = vec![
        rusqlite::types::Value::Integer(target_cards),
        rusqlite::types::Value::Text(cooldown),
        rusqlite::types::Value::Text(current_workspace.unwrap_or("").to_string()),
    ];
    if let Some(filter) = workspace_filter {
        let placeholders: Vec<String> = filter
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", values.len() + 1 + i))
            .collect();
        sql.push_str(&format!(
            " AND ft.workspace_id IN ({})",
            placeholders.join(", ")
        ));
        for ws in filter {
            values.push(rusqlite::types::Value::Text(ws.clone()));
        }
    }
    sql.push_str(
        " ORDER BY (ft.workspace_id = ?3) DESC, ft.card_count ASC, ft.mastery_score ASC
          LIMIT 1",
    );
    let mut stmt = conn.prepare(&sql).ok()?;
    stmt.query_row(rusqlite::params_from_iter(values.iter()), |r| {
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

    let due = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let current = crate::services::model_settings::get_current_workspace_id(&conn);
        next_due_topic(
            &conn,
            workspace_filter,
            target_cards,
            min_interval,
            current.as_deref(),
        )
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
    }

    Ok(())
}

/// One card row as seen by the cleanup sweep.
struct CleanupCard {
    id: String,
    front: String,
    repetitions: i64,
    generated_by_model: Option<String>,
    created_at: String,
}

/// LLM-assisted duplicate cleanup. For each topic with 2+ cards (up to
/// [`CLEANUP_TOPICS_PER_RUN`] per sweep), asks the model to group cards that
/// ask essentially the same question, then keeps the best card per group:
/// reviewed cards win first (SM-2 progress is preserved), then cards from
/// larger models (a 27B card outranks a 4B one), then the newest. Losers are
/// deleted and the topic's card_count is recomputed.
pub async fn cleanup_tick(state: &DbState, ollama_url: Option<String>) -> Result<(), String> {
    let (model, topics) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let model = get_model_for_job(&conn, "flashcard_cleanup_model").unwrap_or_default();
        let mut stmt = conn
            .prepare(
                "SELECT id, topic FROM flashcard_topics
                 WHERE card_count >= 2
                 ORDER BY card_count DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let topics: Vec<(String, String)> = stmt
            .query_map(rusqlite::params![CLEANUP_TOPICS_PER_RUN], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        (model, topics)
    };
    if model.is_empty() {
        return Ok(());
    }

    let client = crate::ollama::client::OllamaClient::new(ollama_url)?;
    for (topic_id, topic_name) in &topics {
        let cards: Vec<CleanupCard> = {
            let conn = state.0.get().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare(
                    "SELECT id, front, repetitions, generated_by_model, created_at
                     FROM learning_cards
                     WHERE topic_id = ?1
                     ORDER BY created_at ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows: Vec<CleanupCard> = stmt
                .query_map(rusqlite::params![topic_id], |r| {
                    Ok(CleanupCard {
                        id: r.get(0)?,
                        front: r.get(1)?,
                        repetitions: r.get(2)?,
                        generated_by_model: r.get(3)?,
                        created_at: r.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();
            rows
        };
        if cards.len() < 2 {
            continue;
        }

        let listing = cards
            .iter()
            .enumerate()
            .map(|(i, card)| {
                let truncated: String = card.front.chars().take(120).collect();
                format!("{}. {}", i + 1, truncated)
            })
            .collect::<Vec<_>>()
            .join("\n");
        let prompt = format!(
            "These are flashcard questions about \"{topic_name}\":\n{listing}\n\n\
            Identify groups of questions that ask essentially the same thing \
            (same fact, trivially rephrased). Output ONLY a JSON array of arrays \
            of the question numbers, e.g. [[1,4],[2,7]]. If there are no \
            duplicates, output []. No markdown, no explanation."
        );
        let raw = client
            .send_message(
                "flashcard_cleanup",
                &model,
                vec![crate::ollama::client::OllamaMessage {
                    role: "user".to_string(),
                    content: prompt,
                }],
            )
            .await
            .map_err(|e| format!("Cleanup for topic \"{topic_name}\" failed: {e}"))?;
        let trimmed = raw.trim();
        let json_str = match (trimmed.find('['), trimmed.rfind(']')) {
            (Some(start), Some(end)) if end > start => &trimmed[start..=end],
            _ => {
                return Err(format!(
                    "Cleanup for topic \"{topic_name}\" failed: response contained no JSON array"
                ))
            }
        };
        let groups: Vec<Vec<usize>> = serde_json::from_str(json_str).map_err(|e| {
            format!("Cleanup for topic \"{topic_name}\" failed: unparseable groups: {e}")
        })?;

        let mut delete_ids: Vec<String> = Vec::new();
        let mut claimed = vec![false; cards.len()];
        for group in groups {
            let mut indices: Vec<usize> = group
                .into_iter()
                .filter_map(|n| n.checked_sub(1))
                .filter(|&i| i < cards.len() && !claimed[i])
                .collect();
            indices.sort_unstable();
            indices.dedup();
            if indices.len() < 2 {
                continue;
            }
            for &i in &indices {
                claimed[i] = true;
            }
            // Keeper: most reviews, then largest generating model, then newest.
            let keeper = *indices
                .iter()
                .max_by(|&&a, &&b| {
                    let ca = &cards[a];
                    let cb = &cards[b];
                    ca.repetitions
                        .cmp(&cb.repetitions)
                        .then_with(|| {
                            model_params_b(ca.generated_by_model.as_deref().unwrap_or(""))
                                .total_cmp(&model_params_b(
                                    cb.generated_by_model.as_deref().unwrap_or(""),
                                ))
                        })
                        .then_with(|| ca.created_at.cmp(&cb.created_at))
                })
                .unwrap_or(&indices[0]);
            for &i in &indices {
                if i != keeper {
                    delete_ids.push(cards[i].id.clone());
                }
            }
        }

        if !delete_ids.is_empty() {
            let mut conn = state.0.get().map_err(|e| e.to_string())?;
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            for id in &delete_ids {
                tx.execute(
                    "DELETE FROM learning_cards WHERE id = ?1",
                    rusqlite::params![id],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.execute(
                "UPDATE flashcard_topics
                 SET card_count = (SELECT COUNT(*) FROM learning_cards WHERE topic_id = ?1)
                 WHERE id = ?1",
                rusqlite::params![topic_id],
            )
            .map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
        }
    }

    // Watermark so the scheduler doesn't re-sweep until the interval elapses.
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('flashcard_cleanup_last_run_at', ?1)",
        rusqlite::params![format!("\"{}\"", chrono::Utc::now().to_rfc3339())],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod next_due_topic_tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;

    fn insert_ws(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO workspaces (id, name, created_at, updated_at)
             VALUES (?1, ?1, datetime('now'), datetime('now'))",
            rusqlite::params![id],
        )
        .unwrap();
    }

    fn insert_topic(conn: &Connection, id: &str, ws: &str, card_count: i64) {
        conn.execute(
            "INSERT INTO flashcard_topics (id, workspace_id, topic, card_count)
             VALUES (?1, ?2, ?1, ?3)",
            rusqlite::params![id, ws, card_count],
        )
        .unwrap();
    }

    #[test]
    fn earlier_workspace_does_not_starve_later_ones() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_ws(&conn, "ws_first");
        insert_ws(&conn, "ws_second");
        // The first workspace has a due topic, but the second workspace's
        // topic is more starved. Global selection must pick the emptier one.
        insert_topic(&conn, "t_first", "ws_first", 3);
        insert_topic(&conn, "t_second", "ws_second", 0);

        let due = next_due_topic(&conn, None, 20, 60, None).unwrap();
        assert_eq!(due.id, "t_second");
    }

    #[test]
    fn active_workspace_wins_over_card_count() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_ws(&conn, "ws_other");
        insert_ws(&conn, "ws_active");
        insert_topic(&conn, "t_other", "ws_other", 0);
        insert_topic(&conn, "t_active", "ws_active", 5);

        let due = next_due_topic(&conn, None, 20, 60, Some("ws_active")).unwrap();
        assert_eq!(due.id, "t_active");
    }

    #[test]
    fn respects_target_cooldown_and_filter() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_ws(&conn, "ws_a");
        insert_ws(&conn, "ws_b");
        // At target — never due.
        insert_topic(&conn, "t_full", "ws_a", 20);
        // Generated moments ago — cooling down.
        insert_topic(&conn, "t_cooling", "ws_a", 1);
        conn.execute(
            "UPDATE flashcard_topics SET last_generated_at = datetime('now') WHERE id = 't_cooling'",
            [],
        )
        .unwrap();
        insert_topic(&conn, "t_b", "ws_b", 2);

        let due = next_due_topic(&conn, None, 20, 60, None).unwrap();
        assert_eq!(due.id, "t_b");

        // A workspace filter excludes topics outside it entirely.
        let filter = vec!["ws_a".to_string()];
        assert!(next_due_topic(&conn, Some(&filter), 20, 60, None).is_none());
    }
}

#[cfg(test)]
mod cleanup_tests {
    use super::model_params_b;

    #[test]
    fn parses_model_parameter_counts() {
        assert_eq!(model_params_b("qwen3:4b"), 4.0);
        assert_eq!(model_params_b("gemma3:27b"), 27.0);
        assert_eq!(model_params_b("qwen2.5-coder:1.5b"), 1.5);
        assert_eq!(model_params_b("gemma3:270m"), 0.27);
        assert_eq!(model_params_b("mystery-model"), 0.0);
        // Larger models must outrank smaller ones.
        assert!(model_params_b("gemma3:27b") > model_params_b("qwen3:4b"));
        assert!(model_params_b("qwen3:4b") > model_params_b("gemma3:270m"));
    }
}
