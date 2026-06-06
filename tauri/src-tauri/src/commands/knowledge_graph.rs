use crate::db::DbState;
use crate::models::knowledge_graph::{
    ConceptLink, ConceptMention, ConceptNode, CreateConceptRequest, CreateLinkRequest,
    GraphStatistics, HierarchyLevel, RoadmapSnapshot,
};
use crate::services::concept_extractor;
use crate::services::concept_hierarchy::normalize_concept_name;
use crate::services::workspace_hierarchy::{descendant_workspace_ids, workspace_filter_sql};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};

fn row_to_concept(row: &rusqlite::Row) -> rusqlite::Result<ConceptNode> {
    let type_str: String = row.get(4)?;
    let tags_json: String = row.get(5)?;
    let aliases_json: String = row.get(6)?;
    let refs_json: String = row.get(7)?;
    let level_str: String = row
        .get::<_, Option<String>>(13)?
        .unwrap_or_else(|| "concept".to_string());
    Ok(ConceptNode {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        name: row.get(2)?,
        concept_description: row.get(3)?,
        concept_type: type_str
            .parse()
            .unwrap_or(crate::models::knowledge_graph::ConceptType::Topic),
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        aliases: serde_json::from_str(&aliases_json).unwrap_or_default(),
        references: serde_json::from_str(&refs_json).unwrap_or_default(),
        x_position: row.get(8)?,
        y_position: row.get(9)?,
        review_count: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        hierarchy_level: level_str.parse().unwrap_or_default(),
    })
}

fn row_to_link(row: &rusqlite::Row) -> rusqlite::Result<ConceptLink> {
    let type_str: String = row.get(3)?;
    Ok(ConceptLink {
        id: row.get(0)?,
        source_id: row.get(1)?,
        target_id: row.get(2)?,
        link_type: type_str
            .parse()
            .unwrap_or(crate::models::knowledge_graph::LinkType::Related),
        strength: row.get(4)?,
        context: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn row_to_mention(row: &rusqlite::Row) -> rusqlite::Result<ConceptMention> {
    Ok(ConceptMention {
        id: row.get(0)?,
        concept_id: row.get(1)?,
        source_type: row.get(2)?,
        source_id: row.get(3)?,
        context: row.get(4)?,
        created_at: row.get(5)?,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RoadmapSnapshotPayload {
    nodes: Vec<ConceptNode>,
    links: Vec<ConceptLink>,
    mentions: Vec<ConceptMention>,
    graph_statistics: Option<GraphStatistics>,
}

const SNAPSHOT_RETENTION_DAYS: i64 = 60;

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
        "{cte}SELECT id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level
         FROM concept_nodes WHERE workspace_id {ws_cond} {superseded_cond}ORDER BY name ASC
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
pub fn delete_concept(state: State<DbState>, id: String) -> Result<(), String> {
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

/// Idempotent: returns the existing concept id when a case-insensitive match exists
/// on `concept_nodes.name` or any entry in the `aliases` JSON array. Otherwise inserts
/// a new concept with `hierarchy_level = 'concept'` and `concept_type = 'topic'`.
///
/// Used by the chat topic-signature bridge and exposed as a Tauri command for the UI.
pub fn upsert_concept_from_tag_inner(
    conn: &rusqlite::Connection,
    workspace_id: &str,
    name: &str,
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
        "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![c.id, c.workspace_id, c.name, c.concept_description, type_str, tags_json, aliases_json, refs_json, c.x_position, c.y_position, c.review_count, c.created_at, c.updated_at, level_str],
    )
    .map_err(|e| e.to_string())?;
    Ok(c.id)
}

#[tauri::command]
pub fn upsert_concept_from_tag(
    state: State<DbState>,
    workspace_id: String,
    name: String,
) -> Result<String, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    upsert_concept_from_tag_inner(&conn, &workspace_id, &name)
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
pub fn delete_concept_link(state: State<DbState>, id: String) -> Result<(), String> {
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
    let total_concepts: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = ?1",
            rusqlite::params![workspace_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let total_links: i64 = conn.query_row(
        "SELECT COUNT(*) FROM concept_links cl JOIN concept_nodes cn ON cl.source_id = cn.id WHERE cn.workspace_id = ?1",
        rusqlite::params![workspace_id], |r| r.get(0)
    ).unwrap_or(0);
    let avg_degree = if total_concepts > 0 {
        (total_links * 2) as f64 / total_concepts as f64
    } else {
        0.0
    };
    let max_links = total_concepts * (total_concepts - 1) / 2;
    let density = if max_links > 0 {
        total_links as f64 / max_links as f64
    } else {
        0.0
    };
    Ok(GraphStatistics {
        id: workspace_id.clone(),
        workspace_id: Some(workspace_id),
        total_concepts,
        total_links,
        avg_degree,
        density,
        updated_at: chrono::Utc::now().to_rfc3339(),
    })
}

fn load_graph_stats(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> Result<Option<GraphStatistics>, String> {
    conn.query_row(
        "SELECT id, workspace_id, total_concepts, total_links, avg_degree, density, updated_at
         FROM graph_statistics WHERE workspace_id = ?1",
        rusqlite::params![workspace_id],
        |row| {
            Ok(GraphStatistics {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                total_concepts: row.get(2)?,
                total_links: row.get(3)?,
                avg_degree: row.get(4)?,
                density: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map(Some)
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.to_string()),
    })
}

fn load_snapshot_payload(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> Result<RoadmapSnapshotPayload, String> {
    let mut node_stmt = conn
        .prepare(
            "SELECT id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json,
                    x_position, y_position, review_count, created_at, updated_at, hierarchy_level
             FROM concept_nodes
             WHERE workspace_id = ?1
             ORDER BY created_at ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let nodes = node_stmt
        .query_map(rusqlite::params![workspace_id], row_to_concept)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut link_stmt = conn
        .prepare(
            "SELECT cl.id, cl.source_id, cl.target_id, cl.link_type, cl.strength, cl.context, cl.created_at
             FROM concept_links cl
             JOIN concept_nodes cn ON cn.id = cl.source_id
             WHERE cn.workspace_id = ?1
             ORDER BY cl.created_at ASC, cl.id ASC",
        )
        .map_err(|e| e.to_string())?;
    let links = link_stmt
        .query_map(rusqlite::params![workspace_id], row_to_link)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut mention_stmt = conn
        .prepare(
            "SELECT cm.id, cm.concept_id, cm.source_type, cm.source_id, cm.context, cm.created_at
             FROM concept_mentions cm
             JOIN concept_nodes cn ON cn.id = cm.concept_id
             WHERE cn.workspace_id = ?1
             ORDER BY cm.created_at ASC, cm.id ASC",
        )
        .map_err(|e| e.to_string())?;
    let mentions = mention_stmt
        .query_map(rusqlite::params![workspace_id], row_to_mention)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(RoadmapSnapshotPayload {
        nodes,
        links,
        mentions,
        graph_statistics: load_graph_stats(conn, workspace_id)?,
    })
}

pub(crate) fn snapshot_workspace_roadmap(
    conn: &rusqlite::Connection,
    workspace_id: &str,
    source_job_id: Option<&str>,
    source_model: Option<&str>,
) -> Result<(), String> {
    let payload = load_snapshot_payload(conn, workspace_id)?;
    let snapshot_id = uuid::Uuid::new_v4().to_string();
    let payload_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO roadmap_snapshots (
            id, workspace_id, source_job_id, source_model, concept_count, link_count, payload, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            snapshot_id,
            workspace_id,
            source_job_id,
            source_model,
            payload.nodes.len() as i64,
            payload.links.len() as i64,
            payload_json,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM roadmap_snapshots
         WHERE workspace_id = ?1
           AND julianday(created_at) < julianday('now', ?2)",
        rusqlite::params![workspace_id, format!("-{} days", SNAPSHOT_RETENTION_DAYS)],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_roadmap_snapshots(
    state: State<DbState>,
    workspace_id: String,
) -> Result<Vec<RoadmapSnapshot>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, source_job_id, source_model, concept_count, link_count, created_at
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
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn restore_roadmap_snapshot<R: Runtime>(
    app: AppHandle<R>,
    state: State<DbState>,
    snapshot_id: String,
) -> Result<(), String> {
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
    tx.execute(
        "DELETE FROM concept_change_proposals WHERE workspace_id = ?1",
        rusqlite::params![workspace_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM graph_statistics WHERE workspace_id = ?1",
        rusqlite::params![workspace_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM concept_nodes WHERE workspace_id = ?1",
        rusqlite::params![workspace_id],
    )
    .map_err(|e| e.to_string())?;

    for node in &payload.nodes {
        let type_str = node.concept_type.to_string();
        let level_str = node.hierarchy_level.to_string();
        let tags_json = serde_json::to_string(&node.tags).unwrap_or_default();
        let aliases_json = serde_json::to_string(&node.aliases).unwrap_or_default();
        let refs_json = serde_json::to_string(&node.references).unwrap_or_default();
        tx.execute(
            "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![
                &node.id,
                &node.workspace_id,
                &node.name,
                &node.concept_description,
                type_str,
                tags_json,
                aliases_json,
                refs_json,
                node.x_position,
                node.y_position,
                node.review_count,
                &node.created_at,
                &node.updated_at,
                level_str,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    for link in &payload.links {
        tx.execute(
            "INSERT INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                &link.id,
                &link.source_id,
                &link.target_id,
                link.link_type.to_string(),
                link.strength,
                &link.context,
                &link.created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    for mention in &payload.mentions {
        tx.execute(
            "INSERT INTO concept_mentions (id, concept_id, source_type, source_id, context, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                &mention.id,
                &mention.concept_id,
                &mention.source_type,
                &mention.source_id,
                &mention.context,
                &mention.created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    if let Some(stats) = &payload.graph_statistics {
        tx.execute(
            "INSERT INTO graph_statistics (id, workspace_id, total_concepts, total_links, avg_degree, density, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                &stats.id,
                stats.workspace_id.clone(),
                stats.total_concepts,
                stats.total_links,
                stats.avg_degree,
                stats.density,
                &stats.updated_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

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

#[derive(Debug, serde::Serialize)]
pub struct LearningPathItem {
    pub concept_id: String,
    pub concept_name: String,
    pub concept_description: String,
    pub hierarchy_path: String,
    pub met_prereqs: usize,
    pub unmet_prereqs: usize,
}

#[tauri::command]
pub fn get_learning_path(
    state: State<DbState>,
    workspace_id: String,
) -> Result<Vec<LearningPathItem>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    // Load all concept nodes for workspace
    let mut all_nodes: std::collections::HashMap<String, ConceptNode> =
        std::collections::HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, \
                 x_position, y_position, review_count, created_at, updated_at, hierarchy_level \
                 FROM concept_nodes WHERE workspace_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![workspace_id], row_to_concept)
            .map_err(|e| e.to_string())?;
        for node in rows.flatten() {
            all_nodes.insert(node.id.clone(), node);
        }
    }

    // Load all links for this workspace
    let mut links: Vec<(String, String, String)> = Vec::new(); // (id, source_id, target_id, link_type)
    {
        let mut stmt = conn
            .prepare(
                "SELECT cl.id, cl.source_id, cl.target_id, cl.link_type \
                 FROM concept_links cl \
                 JOIN concept_nodes cn ON cl.source_id = cn.id \
                 WHERE cn.workspace_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![workspace_id], |row| {
                Ok((
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            links.push(row);
        }
    }

    // Build parent map from part_of links: child_id -> parent_id
    let mut parent_of: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for (src, tgt, ltype) in &links {
        if ltype == "part_of" {
            parent_of.insert(src.clone(), tgt.clone());
        }
    }

    // For each unreviewed concept node, count met/unmet prerequisites
    let mut items: Vec<LearningPathItem> = Vec::new();
    for (id, node) in &all_nodes {
        if node.review_count > 0 {
            continue;
        }
        if node.hierarchy_level != HierarchyLevel::Concept {
            continue;
        }

        let mut met = 0usize;
        let mut unmet = 0usize;
        for (src, tgt, ltype) in &links {
            if ltype == "prerequisite" && tgt == id {
                // src is a prerequisite of this concept
                if let Some(prereq) = all_nodes.get(src) {
                    if prereq.review_count > 0 {
                        met += 1;
                    } else {
                        unmet += 1;
                    }
                }
            }
        }

        // Build hierarchy_path by walking part_of links
        let mut path_parts: Vec<String> = Vec::new();
        let mut current_id = id.clone();
        let mut depth = 0;
        while let Some(parent_id) = parent_of.get(&current_id) {
            if let Some(parent_node) = all_nodes.get(parent_id) {
                path_parts.push(parent_node.name.clone());
            }
            current_id = parent_id.clone();
            depth += 1;
            if depth > 10 {
                break; // prevent cycles
            }
        }
        path_parts.reverse();
        let hierarchy_path = path_parts.join(" > ");

        items.push(LearningPathItem {
            concept_id: id.clone(),
            concept_name: node.name.clone(),
            concept_description: node.concept_description.clone(),
            hierarchy_path,
            met_prereqs: met,
            unmet_prereqs: unmet,
        });
    }

    // Sort by fewest unmet prereqs, then by name
    items.sort_by(|a, b| {
        a.unmet_prereqs
            .cmp(&b.unmet_prereqs)
            .then(a.concept_name.cmp(&b.concept_name))
    });
    items.truncate(5);

    Ok(items)
}

// ---------------------------------------------------------------------------
// Real-time concept extraction from arbitrary text
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ExtractConceptsRequest {
    pub workspace_id: String,
    pub text: String,
    pub source_type: String,
    pub source_id: String,
}

#[derive(Debug, Serialize)]
pub struct ExtractConceptsResult {
    pub created: Vec<String>,
    pub existing: Vec<String>,
    pub mentions_recorded: usize,
}

/// Stopwords that the heuristic extractor might pick up as Title-Case phrases
/// but are too generic to be useful concepts.
const EXTRACTION_STOPWORDS: &[&str] = &[
    "the", "this", "that", "with", "from", "have", "will", "would", "should", "could", "about",
    "there", "these", "those", "what", "when", "where", "which", "other", "some", "more", "also",
    "here", "just", "like", "then", "than", "each", "every", "does", "been", "being", "into",
    "over", "only", "very", "after", "before", "between", "through", "under", "above", "below",
    // generic CS/learning noise
    "code", "data", "test", "step", "task", "note", "item", "part", "type", "file", "list", "name",
    "info", "text", "help", "main", "work", "user", "next",
];

fn is_meaningful_concept(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    if lower.chars().count() < 4 {
        return false;
    }
    // Reject single stopwords
    if EXTRACTION_STOPWORDS.contains(&lower.as_str()) {
        return false;
    }
    // Reject if every word in a multi-word phrase is a stopword
    let words: Vec<&str> = lower.split_whitespace().collect();
    if words.len() > 1 && words.iter().all(|w| EXTRACTION_STOPWORDS.contains(w)) {
        return false;
    }
    true
}

/// Extract concepts from text using heuristic patterns ([[wiki-links]], CamelCase,
/// Title Case phrases), upsert them as concept_nodes, and record concept_mentions.
/// This is designed to be called after saving chat messages or notes.
#[tauri::command]
pub fn extract_and_link_concepts(
    state: State<DbState>,
    req: ExtractConceptsRequest,
) -> Result<ExtractConceptsResult, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    let candidates = concept_extractor::extract_concepts(&req.text);
    let meaningful: Vec<String> = candidates
        .into_iter()
        .filter(|c| is_meaningful_concept(c))
        .collect();

    if meaningful.is_empty() {
        return Ok(ExtractConceptsResult {
            created: vec![],
            existing: vec![],
            mentions_recorded: 0,
        });
    }

    // Load existing concepts for this workspace (lowercase name -> id)
    let mut existing_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    // Also index aliases
    if let Ok(mut stmt) =
        conn.prepare("SELECT id, LOWER(name), aliases FROM concept_nodes WHERE workspace_id = ?1")
    {
        let _ = stmt
            .query_map(rusqlite::params![req.workspace_id], |row| {
                let id: String = row.get(0)?;
                let lower_name: String = row.get(1)?;
                let aliases_json: String = row.get(2)?;
                Ok((id, lower_name, aliases_json))
            })
            .map(|rows| {
                for (id, lower_name, aliases_json) in rows.flatten() {
                    let normalized = normalize_concept_name(&lower_name);
                    existing_map.insert(lower_name, id.clone());
                    existing_map.insert(normalized, id.clone());
                    if let Ok(aliases) = serde_json::from_str::<Vec<String>>(&aliases_json) {
                        for alias in aliases {
                            let alias_lower = alias.to_lowercase();
                            let alias_norm = normalize_concept_name(&alias);
                            existing_map.insert(alias_lower, id.clone());
                            existing_map.insert(alias_norm, id.clone());
                        }
                    }
                }
            });
    }

    let now = chrono::Utc::now().to_rfc3339();
    let mut created: Vec<String> = Vec::new();
    let mut existing: Vec<String> = Vec::new();
    let mut mentions_recorded = 0usize;

    for name in &meaningful {
        let lower = name.to_lowercase();
        let normalized = normalize_concept_name(name);
        let concept_id = if let Some(id) = existing_map
            .get(&lower)
            .or_else(|| existing_map.get(&normalized))
        {
            existing.push(name.clone());
            // Bump review_count as a lightweight signal of relevance
            let _ = conn.execute(
                "UPDATE concept_nodes SET review_count = review_count + 1, updated_at = ?1 WHERE id = ?2",
                rusqlite::params![now, id],
            );
            id.clone()
        } else {
            // Create new concept node
            let id = uuid::Uuid::new_v4().to_string();
            let result = conn.execute(
                "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level) \
                 VALUES (?1, ?2, ?3, '', 'topic', '[]', '[]', '[]', 0.0, 0.0, 1, ?4, ?4, 'concept')",
                rusqlite::params![id, req.workspace_id, name.trim(), now],
            );
            if result.is_ok() {
                existing_map.insert(lower, id.clone());
                existing_map.insert(normalized, id.clone());
                created.push(name.clone());
                id
            } else {
                continue;
            }
        };

        // Record the mention
        let mention_id = uuid::Uuid::new_v4().to_string();
        if conn
            .execute(
                "INSERT INTO concept_mentions (id, concept_id, source_type, source_id, context, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    mention_id,
                    concept_id,
                    req.source_type,
                    req.source_id,
                    &req.text[..req.text.len().min(200)],
                    now
                ],
            )
            .is_ok()
        {
            mentions_recorded += 1;
        }
    }

    Ok(ExtractConceptsResult {
        created,
        existing,
        mentions_recorded,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChangeProposal {
    pub id: String,
    pub workspace_id: String,
    pub job_id: Option<String>,
    pub proposal_type: String,
    pub target_node_id: Option<String>,
    pub payload: String,
    pub reason: Option<String>,
    pub created_at: String,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeResetScope {
    Workspace,
    WorkspaceWithChildren,
    AllWorkspaces,
}

#[derive(Debug, Clone, Deserialize)]
pub struct KnowledgeResetOptions {
    pub clear_graph: Option<bool>,
    pub clear_topic_signatures: Option<bool>,
    pub clear_prompt_bank: Option<bool>,
    pub clear_analysis_jobs: Option<bool>,
    pub clear_legacy_topics: Option<bool>,
    pub delete_generated_cards: Option<bool>,
}

impl Default for KnowledgeResetOptions {
    fn default() -> Self {
        Self {
            clear_graph: Some(true),
            clear_topic_signatures: Some(true),
            clear_prompt_bank: Some(true),
            clear_analysis_jobs: Some(true),
            clear_legacy_topics: Some(true),
            delete_generated_cards: Some(true),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct KnowledgeResetRequest {
    pub scope: KnowledgeResetScope,
    pub workspace_id: Option<String>,
    pub options: Option<KnowledgeResetOptions>,
    pub dry_run: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct KnowledgeResetResult {
    pub dry_run: bool,
    pub workspace_count: i64,
    pub concept_nodes: i64,
    pub concept_links: i64,
    pub concept_mentions: i64,
    pub graph_statistics: i64,
    pub roadmap_snapshots: i64,
    pub analyze_jobs: i64,
    pub analyze_job_chunks: i64,
    pub change_proposals: i64,
    pub flashcard_topics: i64,
    pub generated_cards_deleted: i64,
    pub generated_cards_detached: i64,
    pub learning_goals_detached: i64,
    pub topic_signatures_cleared: i64,
    pub prompt_bank_prompts: i64,
    pub prompt_bank_jobs: i64,
}

#[tauri::command]
pub fn reset_knowledge_state<R: Runtime>(
    app: AppHandle<R>,
    state: State<DbState>,
    req: KnowledgeResetRequest,
) -> Result<KnowledgeResetResult, String> {
    let mut conn = state.0.get().map_err(|e| e.to_string())?;
    let result = reset_knowledge_state_inner(&mut conn, req)?;
    if !result.dry_run {
        let _ = app.emit("knowledge-state-reset", &result);
        let _ = app.emit("workspaces-changed", ());
    }
    Ok(result)
}

fn reset_knowledge_state_inner(
    conn: &mut rusqlite::Connection,
    req: KnowledgeResetRequest,
) -> Result<KnowledgeResetResult, String> {
    let dry_run = req.dry_run.unwrap_or(false);
    let workspace_ids = resolve_reset_workspace_ids(conn, &req)?;
    let options = req.options.unwrap_or_default();
    if workspace_ids.is_empty() {
        return Ok(KnowledgeResetResult {
            dry_run,
            ..Default::default()
        });
    }

    let mut result = preview_knowledge_reset(conn, &workspace_ids, &options)?;
    result.dry_run = dry_run;
    result.workspace_count = workspace_ids.len() as i64;

    if dry_run {
        return Ok(result);
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let applied = apply_knowledge_reset(&tx, &workspace_ids, &options)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(KnowledgeResetResult {
        dry_run: false,
        workspace_count: workspace_ids.len() as i64,
        ..applied
    })
}

fn resolve_reset_workspace_ids(
    conn: &rusqlite::Connection,
    req: &KnowledgeResetRequest,
) -> Result<Vec<String>, String> {
    match req.scope {
        KnowledgeResetScope::Workspace => {
            let id = req
                .workspace_id
                .as_deref()
                .ok_or_else(|| "workspace_id is required for workspace reset".to_string())?;
            Ok(vec![id.to_string()])
        }
        KnowledgeResetScope::WorkspaceWithChildren => {
            let id = req.workspace_id.as_deref().ok_or_else(|| {
                "workspace_id is required for workspace-with-children reset".to_string()
            })?;
            descendant_workspace_ids(conn, id)
        }
        KnowledgeResetScope::AllWorkspaces => {
            let mut stmt = conn
                .prepare("SELECT id FROM workspaces")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())
        }
    }
}

fn placeholders(count: usize) -> String {
    std::iter::repeat_n("?", count)
        .collect::<Vec<_>>()
        .join(",")
}

fn count_sql(
    conn: &rusqlite::Connection,
    sql: &str,
    workspace_ids: &[String],
) -> Result<i64, String> {
    conn.query_row(
        sql,
        rusqlite::params_from_iter(workspace_ids.iter().map(|s| s.as_str())),
        |row| row.get::<_, i64>(0),
    )
    .map_err(|e| e.to_string())
}

fn execute_sql(
    conn: &rusqlite::Connection,
    sql: &str,
    workspace_ids: &[String],
) -> Result<i64, String> {
    conn.execute(
        sql,
        rusqlite::params_from_iter(workspace_ids.iter().map(|s| s.as_str())),
    )
    .map(|count| count as i64)
    .map_err(|e| e.to_string())
}

fn scoped_concept_subquery(in_clause: &str) -> String {
    format!("SELECT id FROM concept_nodes WHERE workspace_id IN ({in_clause})")
}

fn scoped_job_subquery(in_clause: &str) -> String {
    format!("SELECT id FROM analyze_jobs WHERE workspace_id IN ({in_clause})")
}

fn count_by_workspace(
    conn: &rusqlite::Connection,
    table: &str,
    workspace_ids: &[String],
) -> Result<i64, String> {
    let in_clause = placeholders(workspace_ids.len());
    count_sql(
        conn,
        &format!("SELECT COUNT(*) FROM {table} WHERE workspace_id IN ({in_clause})"),
        workspace_ids,
    )
}

fn delete_by_workspace(
    conn: &rusqlite::Connection,
    table: &str,
    workspace_ids: &[String],
) -> Result<i64, String> {
    let in_clause = placeholders(workspace_ids.len());
    execute_sql(
        conn,
        &format!("DELETE FROM {table} WHERE workspace_id IN ({in_clause})"),
        workspace_ids,
    )
}

fn preview_knowledge_reset(
    conn: &rusqlite::Connection,
    workspace_ids: &[String],
    options: &KnowledgeResetOptions,
) -> Result<KnowledgeResetResult, String> {
    let mut result = KnowledgeResetResult::default();
    let in_clause = placeholders(workspace_ids.len());
    let concept_subquery = scoped_concept_subquery(&in_clause);
    let job_subquery = scoped_job_subquery(&in_clause);

    if options.clear_graph.unwrap_or(true) {
        result.concept_nodes = count_by_workspace(conn, "concept_nodes", workspace_ids)?;
        result.concept_links = count_sql(
            conn,
            &format!(
                "WITH scoped_concepts AS ({concept_subquery}) \
                 SELECT COUNT(*) FROM concept_links \
                 WHERE source_id IN (SELECT id FROM scoped_concepts) \
                    OR target_id IN (SELECT id FROM scoped_concepts)"
            ),
            workspace_ids,
        )?;
        result.concept_mentions = count_sql(
            conn,
            &format!(
                "SELECT COUNT(*) FROM concept_mentions WHERE concept_id IN ({concept_subquery})"
            ),
            workspace_ids,
        )?;
        result.graph_statistics = count_by_workspace(conn, "graph_statistics", workspace_ids)?;
        result.roadmap_snapshots = count_by_workspace(conn, "roadmap_snapshots", workspace_ids)?;
        result.change_proposals =
            count_by_workspace(conn, "concept_change_proposals", workspace_ids)?;
        result.learning_goals_detached = count_sql(
            conn,
            &format!(
                "SELECT COUNT(*) FROM learning_goals WHERE concept_id IN ({concept_subquery})"
            ),
            workspace_ids,
        )?;
    }

    if options.clear_analysis_jobs.unwrap_or(true) {
        result.analyze_jobs = count_by_workspace(conn, "analyze_jobs", workspace_ids)?;
        result.analyze_job_chunks = count_sql(
            conn,
            &format!("SELECT COUNT(*) FROM analyze_job_chunks WHERE job_id IN ({job_subquery})"),
            workspace_ids,
        )?;
    }

    if options.clear_legacy_topics.unwrap_or(true) {
        result.flashcard_topics = count_by_workspace(conn, "flashcard_topics", workspace_ids)?;
    }

    if options.delete_generated_cards.unwrap_or(true) {
        result.generated_cards_deleted = count_sql(
            conn,
            &format!(
                "SELECT COUNT(*) FROM learning_cards \
                 WHERE workspace_id IN ({in_clause}) \
                   AND (source_type = 'concept' OR topic_id IS NOT NULL OR source_type = 'chat_topic')"
            ),
            workspace_ids,
        )?;
    } else {
        result.generated_cards_detached = count_sql(
            conn,
            &format!(
                "SELECT COUNT(*) FROM learning_cards \
                 WHERE workspace_id IN ({in_clause}) \
                   AND (source_type = 'concept' OR topic_id IS NOT NULL OR source_type = 'chat_topic')"
            ),
            workspace_ids,
        )?;
    }

    if options.clear_topic_signatures.unwrap_or(true) {
        result.topic_signatures_cleared = count_sql(
            conn,
            &format!(
                "SELECT COUNT(*) FROM workspaces \
                 WHERE id IN ({in_clause}) AND (topic_signature != '{{}}' OR signature_updated_at IS NOT NULL)"
            ),
            workspace_ids,
        )?;
    }

    if options.clear_prompt_bank.unwrap_or(true) {
        result.prompt_bank_prompts =
            count_by_workspace(conn, "workspace_prompt_bank", workspace_ids)?;
        result.prompt_bank_jobs =
            count_by_workspace(conn, "workspace_prompt_bank_jobs", workspace_ids)?;
    }

    Ok(result)
}

fn apply_knowledge_reset(
    conn: &rusqlite::Connection,
    workspace_ids: &[String],
    options: &KnowledgeResetOptions,
) -> Result<KnowledgeResetResult, String> {
    let mut result = KnowledgeResetResult::default();
    let in_clause = placeholders(workspace_ids.len());
    let concept_subquery = scoped_concept_subquery(&in_clause);
    let job_subquery = scoped_job_subquery(&in_clause);

    if options.delete_generated_cards.unwrap_or(true) {
        result.generated_cards_deleted = execute_sql(
            conn,
            &format!(
                "DELETE FROM learning_cards \
                 WHERE workspace_id IN ({in_clause}) \
                   AND (source_type = 'concept' OR topic_id IS NOT NULL OR source_type = 'chat_topic')"
            ),
            workspace_ids,
        )?;
    } else {
        result.generated_cards_detached = execute_sql(
            conn,
            &format!(
                "UPDATE learning_cards \
                 SET source_type = 'manual', source_id = NULL, topic_id = NULL \
                 WHERE workspace_id IN ({in_clause}) \
                   AND (source_type = 'concept' OR topic_id IS NOT NULL OR source_type = 'chat_topic')"
            ),
            workspace_ids,
        )?;
    }

    if options.clear_graph.unwrap_or(true) {
        result.learning_goals_detached = execute_sql(
            conn,
            &format!("UPDATE learning_goals SET concept_id = NULL WHERE concept_id IN ({concept_subquery})"),
            workspace_ids,
        )?;
        result.concept_mentions = execute_sql(
            conn,
            &format!("DELETE FROM concept_mentions WHERE concept_id IN ({concept_subquery})"),
            workspace_ids,
        )?;
        result.concept_links = execute_sql(
            conn,
            &format!(
                "WITH scoped_concepts AS ({concept_subquery}) \
                 DELETE FROM concept_links \
                 WHERE source_id IN (SELECT id FROM scoped_concepts) \
                    OR target_id IN (SELECT id FROM scoped_concepts)"
            ),
            workspace_ids,
        )?;
        result.change_proposals =
            delete_by_workspace(conn, "concept_change_proposals", workspace_ids)?;
        result.graph_statistics = delete_by_workspace(conn, "graph_statistics", workspace_ids)?;
        result.roadmap_snapshots = delete_by_workspace(conn, "roadmap_snapshots", workspace_ids)?;
        result.concept_nodes = delete_by_workspace(conn, "concept_nodes", workspace_ids)?;
    }

    if options.clear_analysis_jobs.unwrap_or(true) {
        result.analyze_job_chunks = execute_sql(
            conn,
            &format!("DELETE FROM analyze_job_chunks WHERE job_id IN ({job_subquery})"),
            workspace_ids,
        )?;
        result.analyze_jobs = delete_by_workspace(conn, "analyze_jobs", workspace_ids)?;
    }

    if options.clear_legacy_topics.unwrap_or(true) {
        result.flashcard_topics = delete_by_workspace(conn, "flashcard_topics", workspace_ids)?;
    }

    if options.clear_topic_signatures.unwrap_or(true) {
        result.topic_signatures_cleared = execute_sql(
            conn,
            &format!(
                "UPDATE workspaces SET topic_signature = '{{}}', signature_updated_at = NULL \
                 WHERE id IN ({in_clause}) AND (topic_signature != '{{}}' OR signature_updated_at IS NOT NULL)"
            ),
            workspace_ids,
        )?;
    }

    if options.clear_prompt_bank.unwrap_or(true) {
        result.prompt_bank_prompts =
            delete_by_workspace(conn, "workspace_prompt_bank", workspace_ids)?;
        result.prompt_bank_jobs =
            delete_by_workspace(conn, "workspace_prompt_bank_jobs", workspace_ids)?;
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
    let proposal: ChangeProposal = conn.query_row(
        "SELECT id, workspace_id, job_id, proposal_type, target_node_id, payload, reason, created_at \
         FROM concept_change_proposals WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(ChangeProposal {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            job_id: row.get(2)?,
            proposal_type: row.get(3)?,
            target_node_id: row.get(4)?,
            payload: row.get(5)?,
            reason: row.get(6)?,
            created_at: row.get(7)?,
        })
    ).map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();
    let job_id = proposal.job_id.unwrap_or_default();

    if proposal.proposal_type == "upgrade" {
        if let Some(target_id) = proposal.target_node_id {
            if let Ok(payload_val) = serde_json::from_str::<serde_json::Value>(&proposal.payload) {
                let mut updates = Vec::new();
                let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
                let mut param_idx = 1;

                if let Some(desc) = payload_val
                    .get("concept_description")
                    .and_then(|v| v.as_str())
                {
                    updates.push(format!("concept_description = ?{}", param_idx));
                    params.push(Box::new(desc.to_string()));
                    param_idx += 1;
                }
                if let Some(ctype) = payload_val.get("concept_type").and_then(|v| v.as_str()) {
                    updates.push(format!("concept_type = ?{}", param_idx));
                    params.push(Box::new(ctype.to_string()));
                    param_idx += 1;
                }
                if let Some(level) = payload_val.get("hierarchy_level").and_then(|v| v.as_str()) {
                    updates.push(format!("hierarchy_level = ?{}", param_idx));
                    params.push(Box::new(level.to_string()));
                    param_idx += 1;
                }
                if let Some(source_model) = payload_val.get("source_model").and_then(|v| v.as_str())
                {
                    updates.push(format!("source_model = ?{}", param_idx));
                    params.push(Box::new(source_model.to_string()));
                    param_idx += 1;
                }
                if let Some(confidence) = payload_val.get("confidence").and_then(|v| v.as_f64()) {
                    updates.push(format!("confidence = ?{}", param_idx));
                    params.push(Box::new(confidence));
                    param_idx += 1;
                }

                if !updates.is_empty() {
                    updates.push(format!("updated_at = ?{}", param_idx));
                    params.push(Box::new(now));
                    param_idx += 1;

                    let query = format!(
                        "UPDATE concept_nodes SET {} WHERE id = ?{}",
                        updates.join(", "),
                        param_idx
                    );
                    params.push(Box::new(target_id));

                    let ref_params: Vec<&dyn rusqlite::ToSql> =
                        params.iter().map(|p| p.as_ref()).collect();
                    conn.execute(&query, ref_params.as_slice())
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    } else if proposal.proposal_type == "supersede" || proposal.proposal_type == "merge" {
        if let Some(target_id) = proposal.target_node_id {
            if let Ok(payload_val) = serde_json::from_str::<serde_json::Value>(&proposal.payload) {
                if let Some(successor_id) = payload_val.get("successor_id").and_then(|v| v.as_str())
                {
                    let reason_str = proposal.reason.unwrap_or_else(|| "superseded".to_string());

                    if !would_create_cycle_local(&conn, successor_id, &target_id).unwrap_or(true) {
                        conn.execute(
                            "UPDATE concept_nodes \
                             SET superseded_by = ?1, superseded_at = ?2, supersede_reason = ?3, \
                                 last_modified_by_job = ?4, updated_at = ?5 \
                             WHERE id = ?6 AND (superseded_by IS NULL OR superseded_by = '');",
                            rusqlite::params![
                                successor_id,
                                now,
                                reason_str,
                                job_id,
                                now,
                                target_id
                            ],
                        )
                        .map_err(|e| e.to_string())?;

                        conn.execute(
                            "UPDATE concept_nodes \
                             SET review_count = review_count + (SELECT COALESCE(review_count, 0) FROM concept_nodes WHERE id = ?1) \
                             WHERE id = ?2;",
                            rusqlite::params![target_id, successor_id],
                        ).map_err(|e| e.to_string())?;

                        conn.execute(
                            "UPDATE concept_links \
                             SET target_id = ?1, last_modified_by_job = ?2 \
                             WHERE target_id = ?3 AND json_array_length(user_edited_fields) > 0;",
                            rusqlite::params![successor_id, job_id, target_id],
                        )
                        .map_err(|e| e.to_string())?;
                        conn.execute(
                            "UPDATE concept_links \
                             SET source_id = ?1, last_modified_by_job = ?2 \
                             WHERE source_id = ?3 AND json_array_length(user_edited_fields) > 0;",
                            rusqlite::params![successor_id, job_id, target_id],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
    }

    conn.execute(
        "DELETE FROM concept_change_proposals WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn would_create_cycle_local(
    conn: &rusqlite::Connection,
    start_id: &str,
    target_id: &str,
) -> rusqlite::Result<bool> {
    if start_id == target_id {
        return Ok(true);
    }
    let mut current = start_id.to_string();
    for _ in 0..64 {
        let next: Option<String> = conn
            .query_row(
                "SELECT target_id FROM concept_links
                 WHERE source_id = ?1 AND link_type = 'part_of'
                 LIMIT 1",
                rusqlite::params![current],
                |r| r.get(0),
            )
            .ok();
        match next {
            None => return Ok(false),
            Some(parent) => {
                if parent == target_id {
                    return Ok(true);
                }
                current = parent;
            }
        }
    }
    Ok(true)
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

#[cfg(test)]
mod knowledge_reset_tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;
    use rusqlite::Connection;

    fn ensure_reset_test_tables(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS analyze_jobs (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                model TEXT NOT NULL,
                total_chunks INTEGER NOT NULL,
                completed_chunks INTEGER NOT NULL DEFAULT 0,
                failed_chunks INTEGER NOT NULL DEFAULT 0,
                chunk_budget INTEGER NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                error TEXT
            );
            CREATE TABLE IF NOT EXISTS analyze_job_chunks (
                job_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                label TEXT NOT NULL,
                char_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                nodes_created INTEGER NOT NULL DEFAULT 0,
                links_created INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                finished_at TEXT,
                PRIMARY KEY (job_id, chunk_index)
            );",
        )
        .unwrap();
        let _ = conn.execute_batch(
            "ALTER TABLE learning_goals ADD COLUMN concept_id TEXT;
             ALTER TABLE learning_cards ADD COLUMN topic_id TEXT;
             ALTER TABLE learning_cards ADD COLUMN source_id TEXT;",
        );
    }

    fn insert_workspace(conn: &Connection, id: &str, parent_id: Option<&str>) {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO workspaces (id, name, description, icon, is_hidden, parent_workspace_id, topic_signature, signature_updated_at, created_at, updated_at, order_index)
             VALUES (?1, ?2, '', '📁', 0, ?3, '{\"auto_detected_tags\":[]}', ?4, ?4, ?4, 0)",
            rusqlite::params![id, id, parent_id, now],
        )
        .unwrap();
    }

    fn insert_reset_fixture(conn: &Connection, workspace_id: &str, suffix: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        let concept_id = format!("concept-{suffix}");
        let concept_2_id = format!("concept-2-{suffix}");
        let link_id = format!("link-{suffix}");
        let mention_id = format!("mention-{suffix}");
        let job_id = format!("job-{suffix}");
        let proposal_id = format!("proposal-{suffix}");
        let topic_id = format!("topic-{suffix}");
        let graph_id = format!("stats-{suffix}");
        let prompt_id = format!("prompt-{suffix}");
        let prompt_job_id = format!("prompt-job-{suffix}");
        let goal_id = format!("goal-{suffix}");
        let card_concept_id = format!("card-concept-{suffix}");
        let card_topic_id = format!("card-topic-{suffix}");
        let card_manual_id = format!("card-manual-{suffix}");
        let note_id = format!("note-{suffix}");
        let snapshot_id = format!("snapshot-{suffix}");

        conn.execute(
            "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, created_at, updated_at, hierarchy_level)
             VALUES (?1, ?2, ?3, '', 'topic', '[]', '[]', '[]', ?4, ?4, 'concept')",
            rusqlite::params![concept_id, workspace_id, format!("Concept {suffix}"), now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, created_at, updated_at, hierarchy_level)
             VALUES (?1, ?2, ?3, '', 'topic', '[]', '[]', '[]', ?4, ?4, 'concept')",
            rusqlite::params![concept_2_id, workspace_id, format!("Concept 2 {suffix}"), now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at)
             VALUES (?1, ?2, ?3, 'related', 0.5, '', ?4)",
            rusqlite::params![link_id, concept_id, concept_2_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO concept_mentions (id, concept_id, source_type, source_id, context, created_at)
             VALUES (?1, ?2, 'note', ?3, '', ?4)",
            rusqlite::params![mention_id, concept_id, note_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO analyze_jobs (id, workspace_id, model, total_chunks, completed_chunks, failed_chunks, chunk_budget, status, started_at)
             VALUES (?1, ?2, 'test-model', 1, 1, 0, 2000, 'completed', ?3)",
            rusqlite::params![job_id, workspace_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO analyze_job_chunks (job_id, chunk_index, label, char_count, status)
             VALUES (?1, 0, 'Batch 1/1', 100, 'completed')",
            rusqlite::params![job_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO concept_change_proposals (id, workspace_id, job_id, proposal_type, target_node_id, payload, created_at)
             VALUES (?1, ?2, ?3, 'upgrade', ?4, '{}', ?5)",
            rusqlite::params![proposal_id, workspace_id, job_id, concept_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO graph_statistics (id, workspace_id, total_concepts, total_links, updated_at)
             VALUES (?1, ?2, 2, 1, ?3)",
            rusqlite::params![graph_id, workspace_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO roadmap_snapshots (id, workspace_id, source_job_id, source_model, concept_count, link_count, payload, created_at)
             VALUES (?1, ?2, ?3, 'test-model', 2, 1, '{\"nodes\":[],\"links\":[],\"mentions\":[],\"graph_statistics\":null}', ?4)",
            rusqlite::params![snapshot_id, workspace_id, job_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO flashcard_topics (id, workspace_id, topic, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![topic_id, workspace_id, format!("Topic {suffix}"), now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, source_id, created_at)
             VALUES (?1, ?2, 'front', 'back', 'concept', ?3, ?4)",
            rusqlite::params![card_concept_id, workspace_id, concept_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, topic_id, created_at)
             VALUES (?1, ?2, 'front', 'back', 'chat_topic', ?3, ?4)",
            rusqlite::params![card_topic_id, workspace_id, topic_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, created_at)
             VALUES (?1, ?2, 'front', 'back', 'manual', ?3)",
            rusqlite::params![card_manual_id, workspace_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO learning_goals (id, workspace_id, title, concept_id, created_at, updated_at)
             VALUES (?1, ?2, 'Goal', ?3, ?4, ?4)",
            rusqlite::params![goal_id, workspace_id, concept_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspace_prompt_bank (id, workspace_id, prompt, normalized_prompt, created_at, updated_at)
             VALUES (?1, ?2, 'Prompt', ?3, ?4, ?4)",
            rusqlite::params![prompt_id, workspace_id, format!("prompt-{suffix}"), now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspace_prompt_bank_jobs (id, workspace_id, status, created_at, updated_at)
             VALUES (?1, ?2, 'completed', ?3, ?3)",
            rusqlite::params![prompt_job_id, workspace_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO project_notes (id, workspace_id, title, content, created_at, updated_at)
             VALUES (?1, ?2, 'Note', 'Source material', ?3, ?3)",
            rusqlite::params![note_id, workspace_id, now],
        )
        .unwrap();
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get::<_, i64>(0)).unwrap()
    }

    #[test]
    fn reset_workspace_clears_derived_state_and_preserves_source_material() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-1", None);
        insert_workspace(&conn, "ws-2", None);
        insert_reset_fixture(&conn, "ws-1", "one");
        insert_reset_fixture(&conn, "ws-2", "two");

        let preview = reset_knowledge_state_inner(
            &mut conn,
            KnowledgeResetRequest {
                scope: KnowledgeResetScope::Workspace,
                workspace_id: Some("ws-1".to_string()),
                options: None,
                dry_run: Some(true),
            },
        )
        .unwrap();
        assert_eq!(preview.concept_nodes, 2);
        assert_eq!(preview.roadmap_snapshots, 1);
        assert_eq!(preview.generated_cards_deleted, 2);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = 'ws-1'"
            ),
            2
        );

        let result = reset_knowledge_state_inner(
            &mut conn,
            KnowledgeResetRequest {
                scope: KnowledgeResetScope::Workspace,
                workspace_id: Some("ws-1".to_string()),
                options: None,
                dry_run: Some(false),
            },
        )
        .unwrap();
        assert_eq!(result.concept_nodes, 2);
        assert_eq!(result.learning_goals_detached, 1);

        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = 'ws-1'"
            ),
            0
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM analyze_jobs WHERE workspace_id = 'ws-1'"
            ),
            0
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM roadmap_snapshots WHERE workspace_id = 'ws-1'"
            ),
            0
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM workspace_prompt_bank WHERE workspace_id = 'ws-1'"
            ),
            0
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM flashcard_topics WHERE workspace_id = 'ws-1'"
            ),
            0
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM learning_cards WHERE workspace_id = 'ws-1' AND source_type != 'manual'"), 0);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM learning_cards WHERE workspace_id = 'ws-1'"
            ),
            1
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM project_notes WHERE workspace_id = 'ws-1'"
            ),
            1
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM learning_goals WHERE workspace_id = 'ws-1' AND concept_id IS NULL"), 1);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = 'ws-2'"
            ),
            2
        );
    }

    #[test]
    fn reset_workspace_with_children_includes_descendants() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "root", None);
        insert_workspace(&conn, "child", Some("root"));
        insert_workspace(&conn, "sibling", None);
        insert_reset_fixture(&conn, "root", "root");
        insert_reset_fixture(&conn, "child", "child");
        insert_reset_fixture(&conn, "sibling", "sibling");

        let result = reset_knowledge_state_inner(
            &mut conn,
            KnowledgeResetRequest {
                scope: KnowledgeResetScope::WorkspaceWithChildren,
                workspace_id: Some("root".to_string()),
                options: None,
                dry_run: Some(false),
            },
        )
        .unwrap();

        assert_eq!(result.workspace_count, 2);
        assert_eq!(result.concept_nodes, 4);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id IN ('root', 'child')"
            ),
            0
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = 'sibling'"
            ),
            2
        );
    }

    #[test]
    fn reset_can_detach_generated_cards_instead_of_deleting_them() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-1", None);
        insert_reset_fixture(&conn, "ws-1", "one");

        let result = reset_knowledge_state_inner(
            &mut conn,
            KnowledgeResetRequest {
                scope: KnowledgeResetScope::Workspace,
                workspace_id: Some("ws-1".to_string()),
                options: Some(KnowledgeResetOptions {
                    delete_generated_cards: Some(false),
                    ..Default::default()
                }),
                dry_run: Some(false),
            },
        )
        .unwrap();

        assert_eq!(result.generated_cards_deleted, 0);
        assert_eq!(result.generated_cards_detached, 2);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM learning_cards WHERE workspace_id = 'ws-1'"
            ),
            3
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM learning_cards WHERE workspace_id = 'ws-1' AND source_type = 'manual' AND source_id IS NULL AND topic_id IS NULL"), 3);
    }

    #[test]
    fn snapshot_restore_replaces_workspace_graph_state() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-1", None);
        insert_reset_fixture(&conn, "ws-1", "one");

        snapshot_workspace_roadmap(&conn, "ws-1", Some("job-one"), Some("test-model")).unwrap();
        let snapshot_id: String = conn
            .query_row(
                "SELECT id FROM roadmap_snapshots WHERE workspace_id = 'ws-1' ORDER BY created_at DESC, id DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        conn.execute("DELETE FROM concept_nodes WHERE workspace_id = 'ws-1'", [])
            .unwrap();
        conn.execute(
            "DELETE FROM graph_statistics WHERE workspace_id = 'ws-1'",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, created_at, updated_at, hierarchy_level)
             VALUES ('replacement-node', 'ws-1', 'Replacement', '', 'topic', '[]', '[]', '[]', datetime('now'), datetime('now'), 'concept')",
            [],
        )
        .unwrap();

        let payload_json: String = conn
            .query_row(
                "SELECT payload FROM roadmap_snapshots WHERE id = ?1",
                rusqlite::params![snapshot_id],
                |row| row.get(0),
            )
            .unwrap();
        let payload: RoadmapSnapshotPayload = serde_json::from_str(&payload_json).unwrap();

        let tx = conn.transaction().unwrap();
        tx.execute(
            "DELETE FROM concept_change_proposals WHERE workspace_id = 'ws-1'",
            [],
        )
        .unwrap();
        tx.execute(
            "DELETE FROM graph_statistics WHERE workspace_id = 'ws-1'",
            [],
        )
        .unwrap();
        tx.execute("DELETE FROM concept_nodes WHERE workspace_id = 'ws-1'", [])
            .unwrap();
        for node in &payload.nodes {
            tx.execute(
                "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                rusqlite::params![
                    &node.id,
                    &node.workspace_id,
                    &node.name,
                    &node.concept_description,
                    node.concept_type.to_string(),
                    serde_json::to_string(&node.tags).unwrap(),
                    serde_json::to_string(&node.aliases).unwrap(),
                    serde_json::to_string(&node.references).unwrap(),
                    node.x_position,
                    node.y_position,
                    node.review_count,
                    &node.created_at,
                    &node.updated_at,
                    node.hierarchy_level.to_string(),
                ],
            )
            .unwrap();
        }
        for link in &payload.links {
            tx.execute(
                "INSERT INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    &link.id,
                    &link.source_id,
                    &link.target_id,
                    link.link_type.to_string(),
                    link.strength,
                    &link.context,
                    &link.created_at,
                ],
            )
            .unwrap();
        }
        for mention in &payload.mentions {
            tx.execute(
                "INSERT INTO concept_mentions (id, concept_id, source_type, source_id, context, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    &mention.id,
                    &mention.concept_id,
                    &mention.source_type,
                    &mention.source_id,
                    &mention.context,
                    &mention.created_at,
                ],
            )
            .unwrap();
        }
        if let Some(stats) = &payload.graph_statistics {
            tx.execute(
                "INSERT INTO graph_statistics (id, workspace_id, total_concepts, total_links, avg_degree, density, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    &stats.id,
                    stats.workspace_id.clone(),
                    stats.total_concepts,
                    stats.total_links,
                    stats.avg_degree,
                    stats.density,
                    &stats.updated_at,
                ],
            )
            .unwrap();
        }
        tx.commit().unwrap();

        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = 'ws-1'"
            ),
            2
        );
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = 'ws-1' AND name = 'Replacement'"),
            0
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM concept_links"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM concept_mentions"), 1);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM graph_statistics WHERE workspace_id = 'ws-1'"
            ),
            1
        );
    }
}
