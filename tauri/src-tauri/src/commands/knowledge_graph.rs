use crate::db::DbState;
use crate::models::knowledge_graph::{
    ConceptLink, ConceptNode, CreateConceptRequest, CreateLinkRequest, GraphStatistics,
    HierarchyLevel,
};
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
) -> Result<Vec<ConceptNode>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(500).clamp(1, 5000);
    let offset = offset.unwrap_or(0).max(0);
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level
         FROM concept_nodes WHERE workspace_id = ?1 ORDER BY name ASC
         LIMIT ?2 OFFSET ?3"
    ).map_err(|e| e.to_string())?;
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
) -> Result<Vec<ConceptLink>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(1000).clamp(1, 10000);
    let offset = offset.unwrap_or(0).max(0);
    let mut stmt = conn.prepare(
        "SELECT cl.id, cl.source_id, cl.target_id, cl.link_type, cl.strength, cl.context, cl.created_at
         FROM concept_links cl
         JOIN concept_nodes cn ON cl.source_id = cn.id
         WHERE cn.workspace_id = ?1
         LIMIT ?2 OFFSET ?3"
    ).map_err(|e| e.to_string())?;
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
