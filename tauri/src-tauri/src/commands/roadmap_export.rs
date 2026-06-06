//! Roadmap export commands — text (Markdown / JSON / Mermaid / CSV) and image
//! (PNG / PDF) export of the Chapter → Section → Concept tree for a workspace.

use crate::commands::security::{require_auth, AuthState};
use crate::db::DbState;
use crate::models::knowledge_graph::{ConceptLink, ConceptNode, ConceptType, LinkType};
use crate::services::{roadmap_export, roadmap_render};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadmapExportRequest {
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadmapImageRequest {
    pub workspace_id: String,
    pub svg: String,
    pub width: u32,
    pub height: u32,
}

fn load_tree(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> Result<roadmap_export::RoadmapTree, String> {
    // Concepts
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, name, concept_description, concept_type, tags, aliases, \
             references_json, x_position, y_position, review_count, created_at, updated_at, \
             hierarchy_level FROM concept_nodes WHERE workspace_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let nodes: Vec<ConceptNode> = stmt
        .query_map(rusqlite::params![workspace_id], |r| {
            let type_str: String = r.get(4)?;
            let tags_json: String = r.get(5)?;
            let aliases_json: String = r.get(6)?;
            let refs_json: String = r.get(7)?;
            let level_str: String = r
                .get::<_, Option<String>>(13)?
                .unwrap_or_else(|| "concept".to_string());
            Ok(ConceptNode {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                name: r.get(2)?,
                concept_description: r.get(3)?,
                concept_type: type_str.parse().unwrap_or(ConceptType::Topic),
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                aliases: serde_json::from_str(&aliases_json).unwrap_or_default(),
                references: serde_json::from_str(&refs_json).unwrap_or_default(),
                x_position: r.get(8)?,
                y_position: r.get(9)?,
                review_count: r.get(10)?,
                created_at: r.get(11)?,
                updated_at: r.get(12)?,
                hierarchy_level: level_str.parse().unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Links scoped to the workspace via concept_nodes.source_id
    let mut stmt = conn
        .prepare(
            "SELECT cl.id, cl.source_id, cl.target_id, cl.link_type, cl.strength, cl.context, \
             cl.created_at FROM concept_links cl JOIN concept_nodes cn ON cl.source_id = cn.id \
             WHERE cn.workspace_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let links: Vec<ConceptLink> = stmt
        .query_map(rusqlite::params![workspace_id], |r| {
            let type_str: String = r.get(3)?;
            Ok(ConceptLink {
                id: r.get(0)?,
                source_id: r.get(1)?,
                target_id: r.get(2)?,
                link_type: type_str.parse().unwrap_or(LinkType::Related),
                strength: r.get(4)?,
                context: r.get(5)?,
                created_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(roadmap_export::build_tree(nodes, links))
}

// ---------------------------------------------------------------------------
// Text-format commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn export_roadmap_markdown(
    auth: State<AuthState>,
    state: State<DbState>,
    req: RoadmapExportRequest,
) -> Result<String, String> {
    require_auth(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let tree = load_tree(&conn, &req.workspace_id)?;
    Ok(roadmap_export::render_markdown_outline(&tree))
}

#[tauri::command]
pub fn export_roadmap_json(
    auth: State<AuthState>,
    state: State<DbState>,
    req: RoadmapExportRequest,
) -> Result<String, String> {
    require_auth(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let tree = load_tree(&conn, &req.workspace_id)?;
    roadmap_export::render_json(&tree)
}

#[tauri::command]
pub fn export_roadmap_mermaid(
    auth: State<AuthState>,
    state: State<DbState>,
    req: RoadmapExportRequest,
) -> Result<String, String> {
    require_auth(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let tree = load_tree(&conn, &req.workspace_id)?;
    Ok(roadmap_export::render_mermaid(&tree))
}

#[tauri::command]
pub fn export_roadmap_csv(
    auth: State<AuthState>,
    state: State<DbState>,
    req: RoadmapExportRequest,
) -> Result<String, String> {
    require_auth(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let tree = load_tree(&conn, &req.workspace_id)?;
    Ok(roadmap_export::render_csv(&tree))
}

// ---------------------------------------------------------------------------
// Image-format commands (PNG / PDF) — rasterized server-side from the live SVG
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn export_roadmap_png(
    auth: State<'_, AuthState>,
    state: State<'_, DbState>,
    req: RoadmapImageRequest,
) -> Result<Vec<u8>, String> {
    require_auth(&auth, &state)?;
    roadmap_render::render_png(&req.svg, req.width.max(1), req.height.max(1)).await
}

#[tauri::command]
pub async fn export_roadmap_pdf(
    auth: State<'_, AuthState>,
    state: State<'_, DbState>,
    req: RoadmapImageRequest,
) -> Result<Vec<u8>, String> {
    require_auth(&auth, &state)?;
    roadmap_render::render_pdf(&req.svg, req.width.max(1), req.height.max(1)).await
}
