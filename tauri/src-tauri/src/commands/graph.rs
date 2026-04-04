use crate::db::DbState;
use crate::services::graph_algorithms::{
    CommunityResult, GraphEdge, GraphNode, PageRankResult, ShortestPathResult,
};
use tauri::State;

/// Fetch all concept nodes and links for `workspace_id` from the database.
fn load_graph(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> Result<(Vec<GraphNode>, Vec<GraphEdge>), String> {
    let mut stmt = conn
        .prepare("SELECT id, name FROM concept_nodes WHERE workspace_id = ?1")
        .map_err(|e| e.to_string())?;
    let nodes: Vec<GraphNode> = stmt
        .query_map(rusqlite::params![workspace_id], |row| {
            Ok(GraphNode {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT cl.source_id, cl.target_id, cl.strength
         FROM concept_links cl
         JOIN concept_nodes cn ON cl.source_id = cn.id
         WHERE cn.workspace_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let edges: Vec<GraphEdge> = stmt
        .query_map(rusqlite::params![workspace_id], |row| {
            Ok(GraphEdge {
                source: row.get(0)?,
                target: row.get(1)?,
                weight: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok((nodes, edges))
}

#[tauri::command]
pub fn compute_pagerank(
    state: State<DbState>,
    workspace_id: String,
    damping: Option<f64>,
    iterations: Option<usize>,
) -> Result<Vec<PageRankResult>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let (nodes, edges) = load_graph(&conn, &workspace_id)?;
    Ok(crate::services::graph_algorithms::compute_pagerank(
        &nodes,
        &edges,
        damping.unwrap_or(0.85),
        iterations.unwrap_or(100),
    ))
}

#[tauri::command]
pub fn detect_communities(
    state: State<DbState>,
    workspace_id: String,
) -> Result<Vec<CommunityResult>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let (nodes, edges) = load_graph(&conn, &workspace_id)?;
    Ok(crate::services::graph_algorithms::detect_communities(
        &nodes, &edges,
    ))
}

#[tauri::command]
pub fn find_shortest_path(
    state: State<DbState>,
    workspace_id: String,
    source_id: String,
    target_id: String,
) -> Result<ShortestPathResult, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let (nodes, edges) = load_graph(&conn, &workspace_id)?;
    Ok(crate::services::graph_algorithms::find_shortest_path(
        &nodes, &edges, &source_id, &target_id,
    ))
}
