use tauri::State;
use crate::db::DbState;
use crate::models::knowledge_graph::{ConceptNode, ConceptLink, GraphStatistics, CreateConceptRequest, CreateLinkRequest};

fn row_to_concept(row: &rusqlite::Row) -> rusqlite::Result<ConceptNode> {
    let type_str: String = row.get(4)?;
    let tags_json: String = row.get(5)?;
    let aliases_json: String = row.get(6)?;
    let refs_json: String = row.get(7)?;
    Ok(ConceptNode {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        name: row.get(2)?,
        concept_description: row.get(3)?,
        concept_type: type_str.parse().unwrap_or(crate::models::knowledge_graph::ConceptType::Topic),
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        aliases: serde_json::from_str(&aliases_json).unwrap_or_default(),
        references: serde_json::from_str(&refs_json).unwrap_or_default(),
        x_position: row.get(8)?,
        y_position: row.get(9)?,
        review_count: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

#[tauri::command]
pub fn create_concept(state: State<DbState>, req: CreateConceptRequest) -> Result<ConceptNode, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut c = ConceptNode::new(req.workspace_id, req.name);
    if let Some(d) = req.concept_description { c.concept_description = d; }
    if let Some(t) = req.concept_type { c.concept_type = t; }
    if let Some(tags) = req.tags { c.tags = tags; }
    if let Some(aliases) = req.aliases { c.aliases = aliases; }
    let type_str = c.concept_type.to_string();
    let tags_json = serde_json::to_string(&c.tags).unwrap_or_default();
    let aliases_json = serde_json::to_string(&c.aliases).unwrap_or_default();
    let refs_json = serde_json::to_string(&c.references).unwrap_or_default();
    conn.execute(
        "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![c.id, c.workspace_id, c.name, c.concept_description, type_str, tags_json, aliases_json, refs_json, c.x_position, c.y_position, c.review_count, c.created_at, c.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(c)
}

#[tauri::command]
pub fn list_concepts(state: State<DbState>, workspace_id: String) -> Result<Vec<ConceptNode>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at
         FROM concept_nodes WHERE workspace_id = ?1 ORDER BY name ASC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![workspace_id], |row| row_to_concept(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_concept(state: State<DbState>, id: String) -> Result<Option<ConceptNode>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at
         FROM concept_nodes WHERE id = ?1",
        rusqlite::params![id],
        |row| row_to_concept(row),
    );
    match result {
        Ok(c) => Ok(Some(c)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn update_concept(state: State<DbState>, id: String, name: Option<String>, concept_description: Option<String>, x_position: Option<f64>, y_position: Option<f64>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
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
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_concept(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM concept_nodes WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_concept_link(state: State<DbState>, req: CreateLinkRequest) -> Result<ConceptLink, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let link = ConceptLink {
        id: uuid::Uuid::new_v4().to_string(),
        source_id: req.source_id,
        target_id: req.target_id,
        link_type: req.link_type.unwrap_or(crate::models::knowledge_graph::LinkType::Related),
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
pub fn list_concept_links(state: State<DbState>, workspace_id: String) -> Result<Vec<ConceptLink>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT cl.id, cl.source_id, cl.target_id, cl.link_type, cl.strength, cl.context, cl.created_at
         FROM concept_links cl
         JOIN concept_nodes cn ON cl.source_id = cn.id
         WHERE cn.workspace_id = ?1"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![workspace_id], |row| {
        let type_str: String = row.get(3)?;
        Ok(ConceptLink {
            id: row.get(0)?,
            source_id: row.get(1)?,
            target_id: row.get(2)?,
            link_type: type_str.parse().unwrap_or(crate::models::knowledge_graph::LinkType::Related),
            strength: row.get(4)?,
            context: row.get(5)?,
            created_at: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn delete_concept_link(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM concept_links WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_graph_stats(state: State<DbState>, workspace_id: String) -> Result<GraphStatistics, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let total_concepts: i64 = conn.query_row(
        "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = ?1",
        rusqlite::params![workspace_id], |r| r.get(0)
    ).unwrap_or(0);
    let total_links: i64 = conn.query_row(
        "SELECT COUNT(*) FROM concept_links cl JOIN concept_nodes cn ON cl.source_id = cn.id WHERE cn.workspace_id = ?1",
        rusqlite::params![workspace_id], |r| r.get(0)
    ).unwrap_or(0);
    let avg_degree = if total_concepts > 0 { (total_links * 2) as f64 / total_concepts as f64 } else { 0.0 };
    let max_links = total_concepts * (total_concepts - 1) / 2;
    let density = if max_links > 0 { total_links as f64 / max_links as f64 } else { 0.0 };
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
