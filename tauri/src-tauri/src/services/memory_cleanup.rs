use crate::db::DbState;
use rusqlite::Connection;

/// Hours between memory-quality sweeps. Overridable via the
/// `memory_cleanup_interval_hours` setting.
pub(crate) const DEFAULT_CLEANUP_INTERVAL_HOURS: i64 = 24;
/// Workspaces examined per sweep (one LLM call each).
const CLEANUP_WORKSPACES_PER_RUN: i64 = 5;

/// One memory row as seen by the quality sweep.
struct MemoryQualityRow {
    id: String,
    content: String,
    memory_type: String,
    is_pinned: i64,
    reinforcement_count: i64,
}

/// Parsed LLM verdict for one workspace's memories. Indices are 0-based
/// after [`parse_cleanup_response`] converts them from the 1-based prompt
/// numbering.
#[derive(Debug, Default, serde::Deserialize)]
struct MemoryCleanupPlan {
    #[serde(default)]
    junk: Vec<usize>,
    #[serde(default)]
    duplicates: Vec<Vec<usize>>,
}

fn parse_cleanup_response(raw: &str) -> Result<MemoryCleanupPlan, String> {
    let trimmed = raw.trim();
    let json_str = match (trimmed.find('{'), trimmed.rfind('}')) {
        (Some(start), Some(end)) if end > start => &trimmed[start..=end],
        _ => return Err("response contained no JSON object".to_string()),
    };
    let mut plan: MemoryCleanupPlan =
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

/// Apply a parsed cleanup plan. Junk memories are hard-deleted, but only when
/// not pinned — a pinned memory reflects a deliberate user choice and must
/// never be silently removed. Duplicate groups are merged: the keeper is the
/// most-reinforced (falling back to pinned, then newest by id ordering in
/// the input), and the losers are marked superseded rather than deleted so
/// review history and any embeddings tied to them remain inspectable.
/// Returns (junk_deleted, duplicate_groups_merged).
fn apply_cleanup(
    conn: &mut Connection,
    memories: &[MemoryQualityRow],
    plan: &MemoryCleanupPlan,
    now: &str,
) -> Result<(usize, usize), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut claimed = vec![false; memories.len()];
    let mut junk_deleted = 0usize;
    for &i in &plan.junk {
        if i >= memories.len() || claimed[i] || memories[i].is_pinned != 0 {
            continue;
        }
        claimed[i] = true;
        tx.execute(
            "DELETE FROM memory_embeddings WHERE memory_id = ?1",
            rusqlite::params![memories[i].id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM memories WHERE id = ?1",
            rusqlite::params![memories[i].id],
        )
        .map_err(|e| e.to_string())?;
        junk_deleted += 1;
    }

    let mut groups_merged = 0usize;
    for group in &plan.duplicates {
        // Only merge within the same memory_type — a fact and a preference
        // are never the "same statement" even if worded similarly.
        let mut indices: Vec<usize> = group
            .iter()
            .copied()
            .filter(|&i| i < memories.len() && !claimed[i])
            .collect();
        indices.sort_unstable();
        indices.dedup();
        if let Some(&first) = indices.first() {
            let expected_type = &memories[first].memory_type;
            indices.retain(|&i| &memories[i].memory_type == expected_type);
        }
        if indices.len() < 2 {
            continue;
        }
        for &i in &indices {
            claimed[i] = true;
        }
        // Keeper: pinned wins outright, then most-reinforced, then the
        // earliest-listed (rows are ordered by created_at ASC).
        let keeper = *indices
            .iter()
            .max_by(|&&a, &&b| {
                memories[a]
                    .is_pinned
                    .cmp(&memories[b].is_pinned)
                    .then_with(|| {
                        memories[a]
                            .reinforcement_count
                            .cmp(&memories[b].reinforcement_count)
                    })
                    .then_with(|| b.cmp(&a))
            })
            .unwrap_or(&indices[0]);
        for &i in &indices {
            if i == keeper {
                continue;
            }
            tx.execute(
                "UPDATE memories
                   SET is_active = 0,
                       superseded_by = ?1,
                       superseded_at = ?2,
                       superseded_reason = 'MERGED_DUPLICATE',
                       updated_at = ?2
                 WHERE id = ?3",
                rusqlite::params![memories[keeper].id, now, memories[i].id],
            )
            .map_err(|e| e.to_string())?;
        }
        groups_merged += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok((junk_deleted, groups_merged))
}

/// LLM-assisted memory-quality sweep: per workspace, ask the model which
/// memories are junk (generic filler, not genuinely useful context) and
/// which groups restate the same underlying fact or preference, then
/// delete/merge accordingly. Workspaces are sampled randomly so every
/// workspace is eventually covered across sweeps.
async fn quality_pass(
    state: &DbState,
    client: &crate::ollama::client::OllamaClient,
    model: &str,
) -> Result<(), String> {
    let workspaces: Vec<String> = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT m.workspace_id
                 FROM memories m
                 JOIN workspaces w ON w.id = m.workspace_id
                 WHERE m.is_active = 1 AND w.is_hidden = 0
                 ORDER BY random()
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map(rusqlite::params![CLEANUP_WORKSPACES_PER_RUN], |r| {
                r.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        ids
    };

    for ws_id in &workspaces {
        let memories: Vec<MemoryQualityRow> = {
            let conn = state.0.get().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare(
                    "SELECT id, content, memory_type, is_pinned, reinforcement_count
                     FROM memories
                     WHERE workspace_id = ?1 AND is_active = 1
                     ORDER BY created_at ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows: Vec<MemoryQualityRow> = stmt
                .query_map(rusqlite::params![ws_id], |r| {
                    Ok(MemoryQualityRow {
                        id: r.get(0)?,
                        content: r.get(1)?,
                        memory_type: r.get(2)?,
                        is_pinned: r.get(3)?,
                        reinforcement_count: r.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();
            rows
        };
        if memories.len() < 2 {
            continue;
        }

        let listing = memories
            .iter()
            .enumerate()
            .map(|(i, m)| {
                let truncated: String = m.content.chars().take(140).collect();
                format!("{}. [{}] {}", i + 1, m.memory_type, truncated)
            })
            .collect::<Vec<_>>()
            .join("\n");
        let prompt = format!(
            "These are stored memories (facts and preferences) about one user in one workspace:\n{listing}\n\n\
            Return ONLY a JSON object of the form {{\"junk\": [], \"duplicates\": []}}.\n\
            - \"junk\": numbers of entries that are not genuinely useful standalone \
            context (vague filler, restatements of the obvious, or statements about \
            the conversation rather than the user).\n\
            - \"duplicates\": groups of numbers whose entries restate the same \
            underlying fact or preference in different words, e.g. [[1,4],[2,7]]. \
            Group ONLY entries that are genuinely the same statement; related but \
            distinct statements (e.g. \"prefers concise answers\" vs \"prefers visual \
            examples\") must NOT be grouped.\n\
            Use empty arrays when nothing applies. No markdown, no explanation."
        );
        let raw = client
            .send_message(
                "memory_cleanup",
                model,
                vec![crate::ollama::client::OllamaMessage {
                    role: "user".to_string(),
                    content: prompt,
                }],
            )
            .await
            .map_err(|e| format!("Memory cleanup for workspace {ws_id} failed: {e}"))?;
        let plan = parse_cleanup_response(&raw)
            .map_err(|e| format!("Memory cleanup for workspace {ws_id} failed: {e}"))?;
        if plan.junk.is_empty() && plan.duplicates.is_empty() {
            continue;
        }
        let now = chrono::Utc::now().to_rfc3339();
        let mut conn = state.0.get().map_err(|e| e.to_string())?;
        apply_cleanup(&mut conn, &memories, &plan, &now)?;
    }
    Ok(())
}

/// Entry point invoked by the background scheduler. Runs the quality pass
/// and records a watermark so the scheduler doesn't re-sweep until the
/// configured interval elapses.
pub async fn cleanup_tick(state: &DbState, ollama_url: Option<String>) -> Result<(), String> {
    let model = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        crate::services::model_settings::get_model_for_job(&conn, "memory_cleanup_model")
            .unwrap_or_default()
    };
    if model.is_empty() {
        return Ok(());
    }

    let client = crate::ollama::client::OllamaClient::new(ollama_url)?;
    quality_pass(state, &client, &model).await?;

    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('memory_cleanup_last_run_at', ?1)",
        rusqlite::params![format!("\"{}\"", chrono::Utc::now().to_rfc3339())],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(
        id: &str,
        content: &str,
        memory_type: &str,
        is_pinned: i64,
        reinforcement_count: i64,
    ) -> MemoryQualityRow {
        MemoryQualityRow {
            id: id.to_string(),
            content: content.to_string(),
            memory_type: memory_type.to_string(),
            is_pinned,
            reinforcement_count,
        }
    }

    #[test]
    fn parse_response_converts_to_zero_based() {
        let raw = r#"{"junk": [2], "duplicates": [[1, 3]]}"#;
        let plan = parse_cleanup_response(raw).expect("parse");
        assert_eq!(plan.junk, vec![1]);
        assert_eq!(plan.duplicates, vec![vec![0, 2]]);
    }

    #[test]
    fn parse_response_rejects_missing_json() {
        assert!(parse_cleanup_response("not json").is_err());
    }

    #[test]
    fn apply_cleanup_skips_pinned_junk() {
        let pool = crate::db::test_utils::tests::setup_test_db();
        let mut conn = pool.get().expect("get conn");
        conn.execute(
            "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('ws1', 'Test', ?1, ?1)",
            rusqlite::params!["2025-01-01T00:00:00Z"],
        )
        .expect("insert workspace");
        conn.execute(
            "INSERT INTO memories (id, workspace_id, content, memory_type, scope, is_pinned, is_active, created_at, updated_at)
             VALUES ('m1', 'ws1', 'Pinned junk', 'fact', 'workspace', 1, 1, ?1, ?1)",
            rusqlite::params!["2025-01-01T00:00:00Z"],
        )
        .expect("insert memory");

        let memories = vec![row("m1", "Pinned junk", "fact", 1, 1)];
        let plan = MemoryCleanupPlan {
            junk: vec![0],
            duplicates: vec![],
        };
        let (junk_deleted, groups_merged) =
            apply_cleanup(&mut conn, &memories, &plan, "2025-02-01T00:00:00Z").expect("apply");
        assert_eq!(junk_deleted, 0, "pinned memory must never be deleted");
        assert_eq!(groups_merged, 0);

        let is_active: i64 = conn
            .query_row("SELECT is_active FROM memories WHERE id = 'm1'", [], |r| {
                r.get(0)
            })
            .expect("read");
        assert_eq!(is_active, 1);
    }

    #[test]
    fn apply_cleanup_deletes_unpinned_junk() {
        let pool = crate::db::test_utils::tests::setup_test_db();
        let mut conn = pool.get().expect("get conn");
        conn.execute(
            "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('ws1', 'Test', ?1, ?1)",
            rusqlite::params!["2025-01-01T00:00:00Z"],
        )
        .expect("insert workspace");
        conn.execute(
            "INSERT INTO memories (id, workspace_id, content, memory_type, scope, is_pinned, is_active, created_at, updated_at)
             VALUES ('m1', 'ws1', 'Filler', 'fact', 'workspace', 0, 1, ?1, ?1)",
            rusqlite::params!["2025-01-01T00:00:00Z"],
        )
        .expect("insert memory");

        let memories = vec![row("m1", "Filler", "fact", 0, 1)];
        let plan = MemoryCleanupPlan {
            junk: vec![0],
            duplicates: vec![],
        };
        let (junk_deleted, _) =
            apply_cleanup(&mut conn, &memories, &plan, "2025-02-01T00:00:00Z").expect("apply");
        assert_eq!(junk_deleted, 1);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM memories WHERE id = 'm1'", [], |r| {
                r.get(0)
            })
            .expect("read");
        assert_eq!(count, 0);
    }

    #[test]
    fn apply_cleanup_merges_duplicates_keeping_most_reinforced() {
        let pool = crate::db::test_utils::tests::setup_test_db();
        let mut conn = pool.get().expect("get conn");
        conn.execute(
            "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('ws1', 'Test', ?1, ?1)",
            rusqlite::params!["2025-01-01T00:00:00Z"],
        )
        .expect("insert workspace");
        conn.execute(
            "INSERT INTO memories (id, workspace_id, content, memory_type, scope, is_pinned, reinforcement_count, is_active, created_at, updated_at)
             VALUES ('m1', 'ws1', 'User prefers simple explanations', 'fact', 'workspace', 0, 1, 1, ?1, ?1)",
            rusqlite::params!["2025-01-01T00:00:00Z"],
        )
        .expect("insert m1");
        conn.execute(
            "INSERT INTO memories (id, workspace_id, content, memory_type, scope, is_pinned, reinforcement_count, is_active, created_at, updated_at)
             VALUES ('m2', 'ws1', 'User wants non-technical language', 'fact', 'workspace', 0, 4, 1, ?1, ?1)",
            rusqlite::params!["2025-01-01T00:05:00Z"],
        )
        .expect("insert m2");

        let memories = vec![
            row("m1", "User prefers simple explanations", "fact", 0, 1),
            row("m2", "User wants non-technical language", "fact", 0, 4),
        ];
        let plan = MemoryCleanupPlan {
            junk: vec![],
            duplicates: vec![vec![0, 1]],
        };
        let (_, groups_merged) =
            apply_cleanup(&mut conn, &memories, &plan, "2025-02-01T00:00:00Z").expect("apply");
        assert_eq!(groups_merged, 1);

        let (is_active, superseded_by): (i64, Option<String>) = conn
            .query_row(
                "SELECT is_active, superseded_by FROM memories WHERE id = 'm1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("read m1");
        assert_eq!(is_active, 0, "less-reinforced duplicate must be superseded");
        assert_eq!(superseded_by.as_deref(), Some("m2"));

        let keeper_active: i64 = conn
            .query_row("SELECT is_active FROM memories WHERE id = 'm2'", [], |r| {
                r.get(0)
            })
            .expect("read m2");
        assert_eq!(keeper_active, 1, "most-reinforced duplicate must remain active");
    }

    #[test]
    fn apply_cleanup_never_merges_across_memory_types() {
        let pool = crate::db::test_utils::tests::setup_test_db();
        let mut conn = pool.get().expect("get conn");
        conn.execute(
            "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('ws1', 'Test', ?1, ?1)",
            rusqlite::params!["2025-01-01T00:00:00Z"],
        )
        .expect("insert workspace");
        conn.execute(
            "INSERT INTO memories (id, workspace_id, content, memory_type, scope, is_pinned, is_active, created_at, updated_at)
             VALUES ('m1', 'ws1', 'User is learning Rust', 'fact', 'workspace', 0, 1, ?1, ?1)",
            rusqlite::params!["2025-01-01T00:00:00Z"],
        )
        .expect("insert m1");
        conn.execute(
            "INSERT INTO memories (id, workspace_id, content, memory_type, scope, is_pinned, is_active, created_at, updated_at)
             VALUES ('m2', 'ws1', 'User prefers Rust examples', 'preference', 'workspace', 0, 1, ?1, ?1)",
            rusqlite::params!["2025-01-01T00:05:00Z"],
        )
        .expect("insert m2");

        let memories = vec![
            row("m1", "User is learning Rust", "fact", 0, 1),
            row("m2", "User prefers Rust examples", "preference", 0, 1),
        ];
        let plan = MemoryCleanupPlan {
            junk: vec![],
            duplicates: vec![vec![0, 1]],
        };
        let (_, groups_merged) =
            apply_cleanup(&mut conn, &memories, &plan, "2025-02-01T00:00:00Z").expect("apply");
        assert_eq!(groups_merged, 0, "fact and preference must never be merged");

        let both_active: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM memories WHERE workspace_id = 'ws1' AND is_active = 1",
                [],
                |r| r.get(0),
            )
            .expect("read");
        assert_eq!(both_active, 2);
    }
}
