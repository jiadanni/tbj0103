use crate::commands::security::{require_auth_for_destructive_ops, AuthState};
use crate::db::DbState;
use crate::models::knowledge_graph::{
    ConceptLink, ConceptNode, CreateConceptRequest, CreateLinkRequest, GraphStatistics,
    RoadmapSnapshot,
};
use crate::services::knowledge_graph_service::{
    self, row_to_concept, row_to_link, ChangeProposal, ExtractConceptsRequest,
    ExtractConceptsResult, KnowledgeResetRequest, KnowledgeResetResult, LearningPathItem,
    RoadmapSnapshotPayload,
};
use crate::services::workspace_hierarchy::workspace_filter_sql;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};

#[tauri::command]
pub fn create_concept(
    state: State<DbState>,
    req: CreateConceptRequest,
) -> Result<ConceptNode, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut c = ConceptNode::new(req.workspace_id, req.name);
    if let Some(d) = req.concept_description {
        c.concept_description = d;
    }
    if let Some(t) = req.concept_type {
        c.concept_type = t;
    }
    if let Some(tags) = req.tags {
        c.tags = tags;
    }
    if let Some(aliases) = req.aliases {
        c.aliases = aliases;
    }
    if let Some(level) = req.hierarchy_level {
        c.hierarchy_level = level;
    }
    let type_str = c.concept_type.to_string();
    let level_str = c.hierarchy_level.to_string();
    let tags_json = serde_json::to_string(&c.tags).unwrap_or_default();
    let aliases_json = serde_json::to_string(&c.aliases).unwrap_or_default();
    let refs_json = serde_json::to_string(&c.references).unwrap_or_default();
    conn.execute(
        "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![c.id, c.workspace_id, c.name, c.concept_description, type_str, tags_json, aliases_json, refs_json, c.x_position, c.y_position, c.review_count, c.created_at, c.updated_at, level_str],
    ).map_err(|e| e.to_string())?;
    Ok(c)
}

#[tauri::command]
pub fn list_concepts(
    state: State<DbState>,
    workspace_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
    include_descendants: Option<bool>,
    include_superseded: Option<bool>,
) -> Result<Vec<ConceptNode>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(500).clamp(1, 5000);
    let offset = offset.unwrap_or(0).max(0);
    let (cte, ws_cond) = workspace_filter_sql(include_descendants.unwrap_or(false));
    let include_superseded = include_superseded.unwrap_or(false);
    let superseded_cond = if include_superseded {
        ""
    } else {
        "AND (superseded_by IS NULL OR superseded_by = '') "
    };
    let sql = format!(
        "{cte}SELECT cn.id, cn.workspace_id, cn.name, cn.concept_description, cn.concept_type, cn.tags, cn.aliases, cn.references_json, cn.x_position, cn.y_position, cn.review_count, cn.created_at, cn.updated_at, cn.hierarchy_level
         FROM concept_nodes cn
         WHERE cn.workspace_id {ws_cond} {superseded_cond}\
         AND NOT EXISTS (SELECT 1 FROM blocked_topics bt WHERE bt.workspace_id = cn.workspace_id AND bt.normalized_name = lower(cn.name))
         ORDER BY cn.name ASC
         LIMIT ?2 OFFSET ?3"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(
            rusqlite::params![workspace_id, limit, offset],
            row_to_concept,
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_concept(state: State<DbState>, id: String) -> Result<Option<ConceptNode>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level
         FROM concept_nodes WHERE id = ?1",
        rusqlite::params![id],
        row_to_concept,
    );
    match result {
        Ok(c) => Ok(Some(c)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn update_concept(
    state: State<DbState>,
    id: String,
    name: Option<String>,
    concept_description: Option<String>,
    x_position: Option<f64>,
    y_position: Option<f64>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE concept_nodes SET
            name = COALESCE(?1, name),
            concept_description = COALESCE(?2, concept_description),
            x_position = COALESCE(?3, x_position),
            y_position = COALESCE(?4, y_position),
            updated_at = ?5
         WHERE id = ?6",
        rusqlite::params![name, concept_description, x_position, y_position, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_concept(auth: State<AuthState>, state: State<DbState>, id: String) -> Result<(), String> {
    require_auth_for_destructive_ops(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM concept_nodes WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Manually set or clear the `part_of` parent of a concept. Used by the
/// Learning hub sidebar's "Set parent…" action and as a manual override for
/// the LLM hierarchy job. Passing `parent_id = None` removes any existing
/// `part_of` link on `child_id`.
///
/// Rejects self-links and cycles. Marks `parent_checked_at` so the auto job
/// does not overwrite a deliberate choice on its next pass.
#[tauri::command]
pub fn set_concept_parent(
    state: State<DbState>,
    child_id: String,
    parent_id: Option<String>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    // Always remove any existing part_of links first, so a fresh parent (or
    // explicit clear) starts from a clean state and we don't violate the
    // unique index on (source_id, target_id, link_type).
    conn.execute(
        "DELETE FROM concept_links WHERE source_id = ?1 AND link_type = 'part_of'",
        rusqlite::params![child_id],
    )
    .map_err(|e| e.to_string())?;

    if let Some(parent) = parent_id {
        if parent == child_id {
            return Err("a concept cannot be its own parent".to_string());
        }
        // Walk upward from parent — if child_id is reachable, the link would
        // create a cycle. This re-uses the same iteration cap (64) as the
        // background service for consistency.
        let mut current = parent.clone();
        for _ in 0..64 {
            if current == child_id {
                return Err("setting this parent would create a cycle".to_string());
            }
            let next: Option<String> = conn
                .query_row(
                    "SELECT target_id FROM concept_links
                     WHERE source_id = ?1 AND link_type = 'part_of' LIMIT 1",
                    rusqlite::params![current],
                    |r| r.get(0),
                )
                .ok();
            match next {
                Some(p) => current = p,
                None => break,
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO concept_links
                (id, source_id, target_id, link_type, strength, context, created_at)
             VALUES (?1, ?2, ?3, 'part_of', 1.0, 'manual', ?4)",
            rusqlite::params![id, child_id, parent, now],
        )
        .map_err(|e| e.to_string())?;
    }

    // Stamp parent_checked_at either way so the auto job skips this row.
    conn.execute(
        "UPDATE concept_nodes SET parent_checked_at = datetime('now') WHERE id = ?1",
        rusqlite::params![child_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// `last_modified_by_job` stamp for concept nodes created by the periodic
/// signature\u2192concept sync loop (see `flashcard_topic_service::sync_concepts_from_signatures`).
/// Lets [`prune_stale_signature_topics`](crate::services::flashcard_topic_service::prune_stale_signature_topics)
/// safely remove these nodes later if their tag falls out of the allowed set.
pub const ORIGIN_SIGNATURE_TOPIC_SYNC: &str = "signature_topic_sync";
/// `last_modified_by_job` stamp for concept nodes created via the manual
/// "add tag" UI command ([`upsert_concept_from_tag`]) \u2014 never pruned by the
/// signature-sync cleanup.
pub const ORIGIN_MANUAL_TAG: &str = "manual_tag";

/// Idempotent: returns the existing concept id when a case-insensitive match exists
/// on `concept_nodes.name` or any entry in the `aliases` JSON array. Otherwise inserts
/// a new concept with `hierarchy_level = 'concept'` and `concept_type = 'topic'`,
/// stamping `last_modified_by_job = origin` on insert only \u2014 an existing match is
/// left untouched, so the stamp always reflects the node's original creator.
pub fn upsert_concept_from_tag_with_origin(
    conn: &rusqlite::Connection,
    workspace_id: &str,
    name: &str,
    origin: Option<&str>,
) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("tag name is empty".to_string());
    }
    // Fast path: exact (case-insensitive) name match.
    if let Ok(id) = conn.query_row(
        "SELECT id FROM concept_nodes
         WHERE workspace_id = ?1 AND lower(name) = lower(?2)
         LIMIT 1",
        rusqlite::params![workspace_id, trimmed],
        |r| r.get::<_, String>(0),
    ) {
        return Ok(id);
    }
    // Slower path: scan aliases JSON.
    let lower_trim = trimmed.to_lowercase();
    let mut stmt = conn
        .prepare("SELECT id, aliases FROM concept_nodes WHERE workspace_id = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params![workspace_id])
        .map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: String = row.get(0).map_err(|e| e.to_string())?;
        let aliases_json: String = row.get(1).map_err(|e| e.to_string())?;
        let aliases: Vec<String> = serde_json::from_str(&aliases_json).unwrap_or_default();
        if aliases
            .iter()
            .any(|a| a.trim().to_lowercase() == lower_trim)
        {
            return Ok(id);
        }
    }
    // Insert.
    let c = ConceptNode::new(workspace_id, trimmed);
    let type_str = c.concept_type.to_string();
    let level_str = c.hierarchy_level.to_string();
    let tags_json = serde_json::to_string(&c.tags).unwrap_or_else(|_| "[]".to_string());
    let aliases_json = serde_json::to_string(&c.aliases).unwrap_or_else(|_| "[]".to_string());
    let refs_json = serde_json::to_string(&c.references).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level, last_modified_by_job)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        rusqlite::params![c.id, c.workspace_id, c.name, c.concept_description, type_str, tags_json, aliases_json, refs_json, c.x_position, c.y_position, c.review_count, c.created_at, c.updated_at, level_str, origin],
    )
    .map_err(|e| e.to_string())?;
    Ok(c.id)
}

/// Back-compat delegate for callers that don't need to stamp an origin
/// (e.g. tests, non-sync callers). See [`upsert_concept_from_tag_with_origin`].
pub fn upsert_concept_from_tag_inner(
    conn: &rusqlite::Connection,
    workspace_id: &str,
    name: &str,
) -> Result<String, String> {
    upsert_concept_from_tag_with_origin(conn, workspace_id, name, None)
}

#[tauri::command]
pub fn upsert_concept_from_tag(
    state: State<DbState>,
    workspace_id: String,
    name: String,
) -> Result<String, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    upsert_concept_from_tag_with_origin(&conn, &workspace_id, &name, Some(ORIGIN_MANUAL_TAG))
}

#[cfg(test)]
mod upsert_concept_tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;

    #[test]
    fn idempotent_and_case_insensitive() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO workspaces (id, name, created_at, updated_at)
             VALUES ('ws_uc', 'WS', datetime('now'), datetime('now'))",
            [],
        )
        .ok();
        let a = upsert_concept_from_tag_inner(&conn, "ws_uc", "Rust").unwrap();
        let b = upsert_concept_from_tag_inner(&conn, "ws_uc", "rust").unwrap();
        let c = upsert_concept_from_tag_inner(&conn, "ws_uc", "  RUST  ").unwrap();
        assert_eq!(a, b);
        assert_eq!(a, c);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = 'ws_uc'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn empty_name_errors() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        let err = upsert_concept_from_tag_inner(&conn, "ws_any", "   ").unwrap_err();
        assert!(err.contains("empty"));
    }

    #[test]
    fn stamps_origin_on_insert_only() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO workspaces (id, name, created_at, updated_at)
             VALUES ('ws_origin', 'WS', datetime('now'), datetime('now'))",
            [],
        )
        .ok();

        let id = upsert_concept_from_tag_with_origin(
            &conn,
            "ws_origin",
            "Rust",
            Some(ORIGIN_SIGNATURE_TOPIC_SYNC),
        )
        .unwrap();
        let stamp: Option<String> = conn
            .query_row(
                "SELECT last_modified_by_job FROM concept_nodes WHERE id = ?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stamp.as_deref(), Some(ORIGIN_SIGNATURE_TOPIC_SYNC));

        // Second upsert (case-insensitive match) with a different origin must
        // not overwrite the existing node's stamp.
        let id2 = upsert_concept_from_tag_with_origin(
            &conn,
            "ws_origin",
            "rust",
            Some(ORIGIN_MANUAL_TAG),
        )
        .unwrap();
        assert_eq!(id, id2);
        let stamp2: Option<String> = conn
            .query_row(
                "SELECT last_modified_by_job FROM concept_nodes WHERE id = ?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            stamp2.as_deref(),
            Some(ORIGIN_SIGNATURE_TOPIC_SYNC),
            "existing node's origin stamp must not be overwritten"
        );
    }
}

#[tauri::command]
pub fn create_concept_link(
    state: State<DbState>,
    req: CreateLinkRequest,
) -> Result<ConceptLink, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let link = ConceptLink {
        id: uuid::Uuid::new_v4().to_string(),
        source_id: req.source_id,
        target_id: req.target_id,
        link_type: req
            .link_type
            .unwrap_or(crate::models::knowledge_graph::LinkType::Related),
        strength: req.strength.unwrap_or(0.5).clamp(0.0, 1.0),
        context: req.context.unwrap_or_default(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let type_str = link.link_type.to_string();
    conn.execute(
        "INSERT INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![link.id, link.source_id, link.target_id, type_str, link.strength, link.context, link.created_at],
    ).map_err(|e| e.to_string())?;
    Ok(link)
}

#[tauri::command]
pub fn list_concept_links(
    state: State<DbState>,
    workspace_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
    include_descendants: Option<bool>,
) -> Result<Vec<ConceptLink>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(1000).clamp(1, 10000);
    let offset = offset.unwrap_or(0).max(0);
    let (cte, ws_cond) = workspace_filter_sql(include_descendants.unwrap_or(false));
    let sql = format!(
        "{cte}SELECT cl.id, cl.source_id, cl.target_id, cl.link_type, cl.strength, cl.context, cl.created_at
         FROM concept_links cl
         JOIN concept_nodes cn ON cl.source_id = cn.id
         WHERE cn.workspace_id {ws_cond}
         LIMIT ?2 OFFSET ?3"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(rusqlite::params![workspace_id, limit, offset], row_to_link)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn delete_concept_link(auth: State<AuthState>, state: State<DbState>, id: String) -> Result<(), String> {
    require_auth_for_destructive_ops(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM concept_links WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_graph_stats(
    state: State<DbState>,
    workspace_id: String,
) -> Result<GraphStatistics, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    knowledge_graph_service::compute_graph_stats(&conn, workspace_id)
}
#[tauri::command]
pub fn list_roadmap_snapshots(
    state: State<DbState>,
    workspace_id: String,
) -> Result<Vec<RoadmapSnapshot>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, source_job_id, source_model, concept_count, link_count, created_at, reason
             FROM roadmap_snapshots
             WHERE workspace_id = ?1
             ORDER BY created_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(rusqlite::params![workspace_id], |row| {
            Ok(RoadmapSnapshot {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                source_job_id: row.get(2)?,
                source_model: row.get(3)?,
                concept_count: row.get(4)?,
                link_count: row.get(5)?,
                created_at: row.get(6)?,
                reason: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

/// Result of an on-demand snapshot request. `created == false` is a normal
/// outcome (nothing to snapshot, or nothing changed), not an error.
#[derive(Debug, Serialize)]
pub struct CaptureSnapshotResult {
    pub created: bool,
    pub reason_skipped: Option<String>,
    pub snapshot_id: Option<String>,
}

#[tauri::command]
pub async fn capture_roadmap_snapshot(
    auth: State<'_, AuthState>,
    state: State<'_, DbState>,
    workspace_id: String,
) -> Result<CaptureSnapshotResult, String> {
    require_auth_for_destructive_ops(&auth, &state)?;
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let outcome = knowledge_graph_service::capture_workspace_snapshot(
            &conn,
            &workspace_id,
            knowledge_graph_service::SnapshotReason::Manual,
            None,
            None,
        )?;
        Ok(match outcome {
            knowledge_graph_service::SnapshotOutcome::Created(id) => CaptureSnapshotResult {
                created: true,
                reason_skipped: None,
                snapshot_id: Some(id),
            },
            knowledge_graph_service::SnapshotOutcome::SkippedEmpty => CaptureSnapshotResult {
                created: false,
                reason_skipped: Some("empty".to_string()),
                snapshot_id: None,
            },
            knowledge_graph_service::SnapshotOutcome::SkippedUnchanged => CaptureSnapshotResult {
                created: false,
                reason_skipped: Some("unchanged".to_string()),
                snapshot_id: None,
            },
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn restore_roadmap_snapshot<R: Runtime>(
    app: AppHandle<R>,
    auth: State<AuthState>,
    state: State<DbState>,
    snapshot_id: String,
) -> Result<(), String> {
    // Replaces the workspace's entire graph — gate it like every other
    // destructive command so strict auth mode actually covers it.
    require_auth_for_destructive_ops(&auth, &state)?;
    let mut conn = state.0.get().map_err(|e| e.to_string())?;
    let (workspace_id, payload_json): (String, String) = conn
        .query_row(
            "SELECT workspace_id, payload FROM roadmap_snapshots WHERE id = ?1",
            rusqlite::params![snapshot_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let payload: RoadmapSnapshotPayload =
        serde_json::from_str(&payload_json).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    knowledge_graph_service::restore_snapshot_inner(&tx, &workspace_id, &payload)?;
    tx.commit().map_err(|e| e.to_string())?;

    let _ = app.emit(
        "knowledge-state-reset",
        &serde_json::json!({
            "restored_snapshot_id": snapshot_id,
            "workspace_id": workspace_id,
        }),
    );
    let _ = app.emit("workspaces-changed", ());
    Ok(())
}

#[tauri::command]
pub fn get_learning_path(
    state: State<DbState>,
    workspace_id: String,
) -> Result<Vec<LearningPathItem>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    knowledge_graph_service::compute_learning_path(&conn, workspace_id)
}

// ---------------------------------------------------------------------------
// Real-time concept extraction from arbitrary text
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn extract_and_link_concepts(
    state: State<DbState>,
    req: ExtractConceptsRequest,
) -> Result<ExtractConceptsResult, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    knowledge_graph_service::extract_and_link_concepts(&conn, req)
}

#[tauri::command]
pub fn undo_last_analysis(state: State<DbState>, workspace_id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let last_job: Option<(String, String)> = conn.query_row(
        "SELECT id, started_at FROM analyze_jobs WHERE workspace_id = ?1 AND status IN ('completed', 'running') ORDER BY started_at DESC LIMIT 1",
        rusqlite::params![workspace_id],
        |row| Ok((row.get(0)?, row.get(1)?))
    ).ok();

    if let Some((job_id, started_at)) = last_job {
        conn.execute(
            "DELETE FROM concept_nodes WHERE last_modified_by_job = ?1 OR (created_at >= ?2 AND last_modified_by_job = ?1)",
            rusqlite::params![job_id, started_at]
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE concept_nodes SET superseded_by = NULL, superseded_at = NULL, supersede_reason = NULL, last_modified_by_job = NULL \
             WHERE last_modified_by_job = ?1",
            rusqlite::params![job_id]
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "DELETE FROM concept_links WHERE last_modified_by_job = ?1",
            rusqlite::params![job_id],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE concept_links SET last_modified_by_job = NULL WHERE last_modified_by_job = ?1",
            rusqlite::params![job_id],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "DELETE FROM concept_change_proposals WHERE job_id = ?1",
            rusqlite::params![job_id],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE analyze_jobs SET status = 'undone' WHERE id = ?1",
            rusqlite::params![job_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn reset_knowledge_state<R: Runtime>(
    app: AppHandle<R>,
    auth: State<AuthState>,
    state: State<DbState>,
    req: KnowledgeResetRequest,
) -> Result<KnowledgeResetResult, String> {
    require_auth_for_destructive_ops(&auth, &state)?;
    let mut conn = state.0.get().map_err(|e| e.to_string())?;
    let result = knowledge_graph_service::reset_knowledge_state_inner(&mut conn, req)?;
    if !result.dry_run {
        let _ = app.emit("knowledge-state-reset", &result);
        let _ = app.emit("workspaces-changed", ());
    }
    Ok(result)
}

#[tauri::command]
pub fn list_change_proposals(
    state: State<DbState>,
    workspace_id: String,
) -> Result<Vec<ChangeProposal>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, job_id, proposal_type, target_node_id, payload, reason, created_at \
         FROM concept_change_proposals WHERE workspace_id = ?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(rusqlite::params![workspace_id], |row| {
            Ok(ChangeProposal {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                job_id: row.get(2)?,
                proposal_type: row.get(3)?,
                target_node_id: row.get(4)?,
                payload: row.get(5)?,
                reason: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn apply_change_proposal(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    knowledge_graph_service::apply_change_proposal(&conn, &id)
}

#[tauri::command]
pub fn dismiss_change_proposal(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM concept_change_proposals WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KnowledgeSettings {
    pub upgrade_mode: String,
    pub supersede_mode: String,
    pub confidence_threshold: f64,
}

#[tauri::command]
pub fn get_knowledge_settings(state: State<DbState>) -> Result<KnowledgeSettings, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    let up_mode = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'knowledge.upgrade_mode'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "\"auto\"".to_string());
    let up_mode: String = serde_json::from_str(&up_mode).unwrap_or_else(|_| "auto".to_string());

    let sup_mode = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'knowledge.supersede_mode'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "\"auto\"".to_string());
    let sup_mode: String = serde_json::from_str(&sup_mode).unwrap_or_else(|_| "auto".to_string());

    let threshold_str = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'knowledge.confidence_threshold'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "0.05".to_string());
    let threshold: f64 = threshold_str.parse().unwrap_or(0.05);

    Ok(KnowledgeSettings {
        upgrade_mode: up_mode,
        supersede_mode: sup_mode,
        confidence_threshold: threshold,
    })
}
