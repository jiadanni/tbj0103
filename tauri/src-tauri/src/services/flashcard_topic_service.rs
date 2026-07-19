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
/// Workspaces examined per topic-quality sweep (one LLM call each).
const TOPIC_CLEANUP_WORKSPACES_PER_RUN: i64 = 5;

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

/// One topic row as seen by the topic-quality sweep.
struct TopicQualityRow {
    id: String,
    topic: String,
    card_count: i64,
    reviewed_count: i64,
}

/// Parsed LLM verdict for one workspace's topics. Indices are 0-based after
/// [`parse_topic_cleanup_response`] converts them from the 1-based prompt
/// numbering.
#[derive(Debug, Default, serde::Deserialize)]
struct TopicCleanupPlan {
    #[serde(default)]
    junk: Vec<usize>,
    #[serde(default)]
    duplicates: Vec<Vec<usize>>,
}

fn parse_topic_cleanup_response(raw: &str) -> Result<TopicCleanupPlan, String> {
    let trimmed = raw.trim();
    let json_str = match (trimmed.find('{'), trimmed.rfind('}')) {
        (Some(start), Some(end)) if end > start => &trimmed[start..=end],
        _ => return Err("response contained no JSON object".to_string()),
    };
    let mut plan: TopicCleanupPlan =
        serde_json::from_str(json_str).map_err(|e| format!("unparseable plan: {e}"))?;
    plan.junk = plan
        .junk
        .iter()
        .filter_map(|n| n.checked_sub(1))
        .collect();
    plan.duplicates = plan
        .duplicates
        .iter()
        .map(|group| group.iter().filter_map(|n| n.checked_sub(1)).collect())
        .collect();
    Ok(plan)
}

/// Apply a parsed topic-cleanup plan. Junk topics are deleted together with
/// their cards, but only when no card has been reviewed — SM-2 progress marks
/// a topic the user actually studies, and deleting it would be destructive.
/// Duplicate groups are merged into the group's most-studied topic; the
/// losers' cards are reassigned to the keeper so the card-level dedup sweep
/// can collapse any resulting same-question cards on a later pass.
/// Returns (junk_topics_deleted, duplicate_groups_merged).
fn apply_topic_cleanup(
    conn: &mut Connection,
    topics: &[TopicQualityRow],
    plan: &TopicCleanupPlan,
) -> Result<(usize, usize), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut claimed = vec![false; topics.len()];
    let mut junk_deleted = 0usize;
    for &i in &plan.junk {
        if i >= topics.len() || claimed[i] || topics[i].reviewed_count > 0 {
            continue;
        }
        claimed[i] = true;
        tx.execute(
            "DELETE FROM learning_cards WHERE topic_id = ?1",
            rusqlite::params![topics[i].id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM flashcard_topics WHERE id = ?1",
            rusqlite::params![topics[i].id],
        )
        .map_err(|e| e.to_string())?;
        junk_deleted += 1;
    }

    let mut groups_merged = 0usize;
    for group in &plan.duplicates {
        let mut indices: Vec<usize> = group
            .iter()
            .copied()
            .filter(|&i| i < topics.len() && !claimed[i])
            .collect();
        indices.sort_unstable();
        indices.dedup();
        if indices.len() < 2 {
            continue;
        }
        for &i in &indices {
            claimed[i] = true;
        }
        // Keeper: most reviewed cards, then most cards, then the oldest
        // (lowest index — rows are ordered by created_at ASC).
        let keeper = *indices
            .iter()
            .max_by(|&&a, &&b| {
                topics[a]
                    .reviewed_count
                    .cmp(&topics[b].reviewed_count)
                    .then_with(|| topics[a].card_count.cmp(&topics[b].card_count))
                    .then_with(|| b.cmp(&a))
            })
            .unwrap_or(&indices[0]);
        for &i in &indices {
            if i == keeper {
                continue;
            }
            tx.execute(
                "UPDATE learning_cards SET topic_id = ?1 WHERE topic_id = ?2",
                rusqlite::params![topics[keeper].id, topics[i].id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "DELETE FROM flashcard_topics WHERE id = ?1",
                rusqlite::params![topics[i].id],
            )
            .map_err(|e| e.to_string())?;
        }
        recompute_mastery(&tx, &topics[keeper].id)?;
        groups_merged += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok((junk_deleted, groups_merged))
}

/// LLM-assisted topic-quality sweep: per workspace, ask the model which
/// topics are junk (bare question words, fragments) and which groups name the
/// same subject, then delete/merge accordingly. Workspaces are sampled
/// randomly so every workspace is eventually covered across sweeps.
async fn topic_quality_pass(
    state: &DbState,
    client: &crate::ollama::client::OllamaClient,
    model: &str,
) -> Result<(), String> {
    let workspaces: Vec<String> = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT ft.workspace_id
                 FROM flashcard_topics ft
                 JOIN workspaces w ON w.id = ft.workspace_id
                 WHERE w.is_hidden = 0
                 ORDER BY random()
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map(rusqlite::params![TOPIC_CLEANUP_WORKSPACES_PER_RUN], |r| {
                r.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        ids
    };

    for ws_id in &workspaces {
        let topics: Vec<TopicQualityRow> = {
            let conn = state.0.get().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare(
                    "SELECT ft.id, ft.topic, ft.card_count,
                            COALESCE(SUM(CASE WHEN lc.repetitions > 0 THEN 1 ELSE 0 END), 0)
                     FROM flashcard_topics ft
                     LEFT JOIN learning_cards lc ON lc.topic_id = ft.id
                     WHERE ft.workspace_id = ?1
                     GROUP BY ft.id
                     ORDER BY ft.created_at ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows: Vec<TopicQualityRow> = stmt
                .query_map(rusqlite::params![ws_id], |r| {
                    Ok(TopicQualityRow {
                        id: r.get(0)?,
                        topic: r.get(1)?,
                        card_count: r.get(2)?,
                        reviewed_count: r.get(3)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();
            rows
        };
        if topics.is_empty() {
            continue;
        }

        let listing = topics
            .iter()
            .enumerate()
            .map(|(i, t)| {
                let truncated: String = t.topic.chars().take(80).collect();
                format!("{}. {}", i + 1, truncated)
            })
            .collect::<Vec<_>>()
            .join("\n");
        let prompt = format!(
            "These are the flashcard study topics in one workspace:\n{listing}\n\n\
            Return ONLY a JSON object of the form {{\"junk\": [], \"duplicates\": []}}.\n\
            - \"junk\": numbers of entries that are not meaningful standalone study \
            topics (bare question words, filler, or fragments — e.g. \"what\", \"stuff\").\n\
            - \"duplicates\": groups of numbers whose topics name the same subject \
            (spelling variants, singular/plural), e.g. [[1,4],[2,7]]. Group ONLY topics \
            that are genuinely the same subject; similar-looking but distinct concepts \
            (e.g. \"jaccard\" the similarity index vs \"jacquard\" the loom) must NOT \
            be grouped.\n\
            Use empty arrays when nothing applies. No markdown, no explanation."
        );
        let raw = client
            .send_message(
                "flashcard_cleanup",
                model,
                vec![crate::ollama::client::OllamaMessage {
                    role: "user".to_string(),
                    content: prompt,
                }],
            )
            .await
            .map_err(|e| format!("Topic cleanup for workspace {ws_id} failed: {e}"))?;
        let plan = parse_topic_cleanup_response(&raw)
            .map_err(|e| format!("Topic cleanup for workspace {ws_id} failed: {e}"))?;
        if plan.junk.is_empty() && plan.duplicates.is_empty() {
            continue;
        }
        let mut conn = state.0.get().map_err(|e| e.to_string())?;
        apply_topic_cleanup(&mut conn, &topics, &plan)?;
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

    // Topic-quality pass first: junk topics deleted here won't waste a
    // card-dedup LLM call below, and merged topics concentrate their cards
    // so the card sweep sees the duplicates in one place.
    topic_quality_pass(state, &client, &model).await?;

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
mod topic_cleanup_tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;

    #[test]
    fn parses_plan_and_converts_to_zero_based() {
        let plan = parse_topic_cleanup_response(
            "Sure! {\"junk\": [1, 5], \"duplicates\": [[2, 4], [3, 6]]} done",
        )
        .unwrap();
        assert_eq!(plan.junk, vec![0, 4]);
        assert_eq!(plan.duplicates, vec![vec![1, 3], vec![2, 5]]);

        // Missing keys default to empty; zero entries are dropped.
        let plan = parse_topic_cleanup_response("{\"junk\": [0]}").unwrap();
        assert!(plan.junk.is_empty());
        assert!(plan.duplicates.is_empty());

        assert!(parse_topic_cleanup_response("no json here").is_err());
    }

    fn insert_ws(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO workspaces (id, name, created_at, updated_at)
             VALUES (?1, ?1, datetime('now'), datetime('now'))",
            rusqlite::params![id],
        )
        .unwrap();
    }

    fn insert_topic(conn: &Connection, id: &str, ws: &str) {
        conn.execute(
            "INSERT INTO flashcard_topics (id, workspace_id, topic, card_count)
             VALUES (?1, ?2, ?1, 0)",
            rusqlite::params![id, ws],
        )
        .unwrap();
    }

    fn insert_card(conn: &Connection, id: &str, ws: &str, topic_id: &str, repetitions: i64) {
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, topic_id, repetitions)
             VALUES (?1, ?2, 'f', 'b', ?3, ?4)",
            rusqlite::params![id, ws, topic_id, repetitions],
        )
        .unwrap();
    }

    fn quality_rows(conn: &Connection, ws: &str) -> Vec<TopicQualityRow> {
        let mut stmt = conn
            .prepare(
                "SELECT ft.id, ft.topic, ft.card_count,
                        COALESCE(SUM(CASE WHEN lc.repetitions > 0 THEN 1 ELSE 0 END), 0)
                 FROM flashcard_topics ft
                 LEFT JOIN learning_cards lc ON lc.topic_id = ft.id
                 WHERE ft.workspace_id = ?1
                 GROUP BY ft.id
                 ORDER BY ft.created_at ASC, ft.id ASC",
            )
            .unwrap();
        stmt.query_map(rusqlite::params![ws], |r| {
            Ok(TopicQualityRow {
                id: r.get(0)?,
                topic: r.get(1)?,
                card_count: r.get(2)?,
                reviewed_count: r.get(3)?,
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    #[test]
    fn junk_topics_are_deleted_with_their_cards_unless_reviewed() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        insert_ws(&conn, "ws");
        insert_topic(&conn, "t_what", "ws");
        insert_topic(&conn, "t_studied", "ws");
        insert_card(&conn, "c1", "ws", "t_what", 0);
        insert_card(&conn, "c2", "ws", "t_studied", 3);

        let topics = quality_rows(&conn, "ws");
        let what_idx = topics.iter().position(|t| t.id == "t_what").unwrap();
        let studied_idx = topics.iter().position(|t| t.id == "t_studied").unwrap();
        let plan = TopicCleanupPlan {
            junk: vec![what_idx, studied_idx],
            duplicates: vec![],
        };
        let (deleted, merged) = apply_topic_cleanup(&mut conn, &topics, &plan).unwrap();
        assert_eq!((deleted, merged), (1, 0));

        // "what" and its card are gone; the reviewed topic survived intact.
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM flashcard_topics", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 1);
        let cards: i64 = conn
            .query_row("SELECT COUNT(*) FROM learning_cards", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cards, 1);
    }

    #[test]
    fn duplicate_topics_merge_into_most_studied_keeper() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        insert_ws(&conn, "ws");
        insert_topic(&conn, "t_memoisation", "ws");
        insert_topic(&conn, "t_memoization", "ws");
        insert_card(&conn, "c1", "ws", "t_memoisation", 0);
        insert_card(&conn, "c2", "ws", "t_memoization", 2);
        insert_card(&conn, "c3", "ws", "t_memoization", 0);

        let topics = quality_rows(&conn, "ws");
        let plan = TopicCleanupPlan {
            junk: vec![],
            duplicates: vec![vec![0, 1]],
        };
        let (deleted, merged) = apply_topic_cleanup(&mut conn, &topics, &plan).unwrap();
        assert_eq!((deleted, merged), (0, 1));

        // The reviewed topic won; the loser's card moved over.
        let keeper_cards: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM learning_cards WHERE topic_id = 't_memoization'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(keeper_cards, 3);
        let topics_left: i64 = conn
            .query_row("SELECT COUNT(*) FROM flashcard_topics", [], |r| r.get(0))
            .unwrap();
        assert_eq!(topics_left, 1);
        // card_count was recomputed for the keeper.
        let count: i64 = conn
            .query_row(
                "SELECT card_count FROM flashcard_topics WHERE id = 't_memoization'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn out_of_range_and_singleton_groups_are_ignored() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        insert_ws(&conn, "ws");
        insert_topic(&conn, "t_a", "ws");
        let topics = quality_rows(&conn, "ws");
        let plan = TopicCleanupPlan {
            junk: vec![99],
            duplicates: vec![vec![0], vec![0, 99]],
        };
        let (deleted, merged) = apply_topic_cleanup(&mut conn, &topics, &plan).unwrap();
        assert_eq!((deleted, merged), (0, 0));
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
