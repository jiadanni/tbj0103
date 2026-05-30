use crate::db::DbState;
use crate::models::knowledge_graph::{
    ConceptLink, ConceptNode, CreateConceptRequest, CreateLinkRequest, GraphStatistics,
    HierarchyLevel,
};
use crate::services::concept_extractor;
use crate::services::workspace_hierarchy::workspace_filter_sql;
use serde::{Deserialize, Serialize};
use tauri::State;

fn row_to_concept(row: &rusqlite::Row) -> rusqlite::Result<ConceptNode> {
    let type_str: String = row.get(4)?;
    let tags_json: String = row.get(5)?;
    let aliases_json: String = row.get(6)?;
    let refs_json: String = row.get(7)?;
    let level_str: String = row.get::<_, Option<String>>(13)?.unwrap_or_else(|| "concept".to_string());
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
) -> Result<Vec<ConceptNode>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(500).clamp(1, 5000);
    let offset = offset.unwrap_or(0).max(0);
    let (cte, ws_cond) = workspace_filter_sql(include_descendants.unwrap_or(false));
    let sql = format!(
        "{cte}SELECT id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level
         FROM concept_nodes WHERE workspace_id {ws_cond} ORDER BY name ASC
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
        if aliases.iter().any(|a| a.trim().to_lowercase() == lower_trim) {
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
        .query_map(rusqlite::params![workspace_id, limit, offset], |row| {
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
        })
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
    let mut parent_of: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
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
    items.sort_by(|a, b| a.unmet_prereqs.cmp(&b.unmet_prereqs).then(a.concept_name.cmp(&b.concept_name)));
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
    "the",
    "this",
    "that",
    "with",
    "from",
    "have",
    "will",
    "would",
    "should",
    "could",
    "about",
    "there",
    "these",
    "those",
    "what",
    "when",
    "where",
    "which",
    "other",
    "some",
    "more",
    "also",
    "here",
    "just",
    "like",
    "then",
    "than",
    "each",
    "every",
    "does",
    "been",
    "being",
    "into",
    "over",
    "only",
    "very",
    "after",
    "before",
    "between",
    "through",
    "under",
    "above",
    "below",
    // generic CS/learning noise
    "code",
    "data",
    "test",
    "step",
    "task",
    "note",
    "item",
    "part",
    "type",
    "file",
    "list",
    "name",
    "info",
    "text",
    "help",
    "main",
    "work",
    "user",
    "next",
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
                    existing_map.insert(lower_name, id.clone());
                    if let Ok(aliases) = serde_json::from_str::<Vec<String>>(&aliases_json) {
                        for alias in aliases {
                            existing_map.insert(alias.to_lowercase(), id.clone());
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
        let concept_id = if let Some(id) = existing_map.get(&lower) {
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
