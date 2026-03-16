use serde::{Deserialize, Serialize};
use crate::services::graph_algorithms::{GraphNode, GraphEdge, PageRankResult, CommunityResult, ShortestPathResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphInput {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[tauri::command]
pub fn compute_pagerank(input: GraphInput, damping: Option<f64>, iterations: Option<usize>) -> Vec<PageRankResult> {
    crate::services::graph_algorithms::compute_pagerank(
        &input.nodes,
        &input.edges,
        damping.unwrap_or(0.85),
        iterations.unwrap_or(100),
    )
}

#[tauri::command]
pub fn detect_communities(input: GraphInput) -> Vec<CommunityResult> {
    crate::services::graph_algorithms::detect_communities(&input.nodes, &input.edges)
}

#[tauri::command]
pub fn find_shortest_path(input: GraphInput, source_id: String, target_id: String) -> ShortestPathResult {
    crate::services::graph_algorithms::find_shortest_path(&input.nodes, &input.edges, &source_id, &target_id)
}
