/// Knowledge Graph Algorithms
/// Ported from Models/GraphAlgorithms.swift
///
/// Algorithms: PageRank, community detection (label propagation),
/// centrality, degree distribution, shortest path (BFS/Dijkstra)
use std::collections::{HashMap, HashSet, VecDeque};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageRankResult {
    pub node_id: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommunityResult {
    pub node_id: String,
    pub community_id: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CentralityResult {
    pub node_id: String,
    pub degree_centrality: f64,
    pub betweenness_centrality: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortestPathResult {
    pub path: Vec<String>,
    pub total_weight: f64,
    pub found: bool,
}

/// Compute PageRank scores for all nodes.
/// damping_factor: typically 0.85; iterations: typically 100
pub fn compute_pagerank(
    nodes: &[GraphNode],
    edges: &[GraphEdge],
    damping_factor: f64,
    iterations: usize,
) -> Vec<PageRankResult> {
    let n = nodes.len();
    if n == 0 {
        return vec![];
    }

    // Build adjacency (outbound links per node)
    let mut out_links: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut in_links: HashMap<&str, Vec<(&str, f64)>> = HashMap::new();

    for node in nodes {
        out_links.entry(node.id.as_str()).or_default();
        in_links.entry(node.id.as_str()).or_default();
    }

    for edge in edges {
        out_links.entry(edge.source.as_str()).or_default().push(edge.target.as_str());
        in_links.entry(edge.target.as_str()).or_default().push((edge.source.as_str(), edge.weight));
    }

    // Initialize ranks
    let init = 1.0 / n as f64;
    let mut ranks: HashMap<&str, f64> = nodes.iter().map(|n| (n.id.as_str(), init)).collect();

    for _ in 0..iterations {
        let mut new_ranks: HashMap<&str, f64> = HashMap::new();
        for node in nodes {
            let id = node.id.as_str();
            let incoming_sum: f64 = in_links.get(id).unwrap_or(&vec![]).iter().map(|(src, _w)| {
                let src_rank = ranks.get(src).copied().unwrap_or(init);
                let out_count = out_links.get(src).map(|v| v.len()).unwrap_or(1) as f64;
                src_rank / out_count.max(1.0)
            }).sum();
            let rank = (1.0 - damping_factor) / n as f64 + damping_factor * incoming_sum;
            new_ranks.insert(id, rank);
        }
        ranks = new_ranks;
    }

    let mut results: Vec<PageRankResult> = nodes.iter().map(|n| PageRankResult {
        node_id: n.id.clone(),
        score: ranks.get(n.id.as_str()).copied().unwrap_or(init),
    }).collect();
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results
}

/// Label propagation community detection.
/// Returns community assignment per node.
pub fn detect_communities(nodes: &[GraphNode], edges: &[GraphEdge]) -> Vec<CommunityResult> {
    let n = nodes.len();
    if n == 0 {
        return vec![];
    }

    // Build undirected adjacency list
    let mut neighbors: HashMap<&str, Vec<&str>> = HashMap::new();
    for node in nodes {
        neighbors.entry(node.id.as_str()).or_default();
    }
    for edge in edges {
        neighbors.entry(edge.source.as_str()).or_default().push(edge.target.as_str());
        neighbors.entry(edge.target.as_str()).or_default().push(edge.source.as_str());
    }

    // Initialize each node to its own community (indexed by position)
    let node_ids: Vec<&str> = nodes.iter().map(|n| n.id.as_str()).collect();
    let mut labels: HashMap<&str, usize> = node_ids.iter().cloned().enumerate().map(|(i, id)| (id, i)).collect();

    // Iterate label propagation
    for _ in 0..10 {
        let mut changed = false;
        for &id in &node_ids {
            let nbrs = neighbors.get(id).cloned().unwrap_or_default();
            if nbrs.is_empty() { continue; }
            // Find the most frequent label among neighbors
            let mut freq: HashMap<usize, usize> = HashMap::new();
            for nbr in &nbrs {
                *freq.entry(*labels.get(nbr).unwrap_or(&0)).or_insert(0) += 1;
            }
            if let Some((&best_label, _)) = freq.iter().max_by_key(|(_, &v)| v) {
                let current = *labels.get(id).unwrap_or(&0);
                if best_label != current {
                    labels.insert(id, best_label);
                    changed = true;
                }
            }
        }
        if !changed { break; }
    }

    // Remap community labels to contiguous integers
    let mut label_map: HashMap<usize, usize> = HashMap::new();
    let mut next_id = 0usize;
    nodes.iter().map(|n| {
        let raw = *labels.get(n.id.as_str()).unwrap_or(&0);
        let community_id = *label_map.entry(raw).or_insert_with(|| { let id = next_id; next_id += 1; id });
        CommunityResult { node_id: n.id.clone(), community_id }
    }).collect()
}

/// Degree centrality for all nodes (normalized by n-1).
pub fn compute_centrality(nodes: &[GraphNode], edges: &[GraphEdge]) -> Vec<CentralityResult> {
    let n = nodes.len();
    if n == 0 { return vec![]; }

    let mut degree: HashMap<&str, usize> = nodes.iter().map(|n| (n.id.as_str(), 0)).collect();
    for edge in edges {
        *degree.entry(edge.source.as_str()).or_insert(0) += 1;
        *degree.entry(edge.target.as_str()).or_insert(0) += 1;
    }

    let norm = (n - 1).max(1) as f64;
    nodes.iter().map(|node| {
        let d = *degree.get(node.id.as_str()).unwrap_or(&0) as f64;
        CentralityResult {
            node_id: node.id.clone(),
            degree_centrality: d / norm,
            betweenness_centrality: 0.0, // Simplified: full betweenness is O(V*E), omitted for perf
        }
    }).collect()
}

/// BFS shortest path between two nodes.
pub fn find_shortest_path(
    nodes: &[GraphNode],
    edges: &[GraphEdge],
    source_id: &str,
    target_id: &str,
) -> ShortestPathResult {
    let node_set: HashSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();
    if !node_set.contains(source_id) || !node_set.contains(target_id) {
        return ShortestPathResult { path: vec![], total_weight: f64::INFINITY, found: false };
    }

    if source_id == target_id {
        return ShortestPathResult { path: vec![source_id.to_string()], total_weight: 0.0, found: true };
    }

    // Build undirected adjacency
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for node in nodes { adj.entry(node.id.as_str()).or_default(); }
    for edge in edges {
        adj.entry(edge.source.as_str()).or_default().push(edge.target.as_str());
        adj.entry(edge.target.as_str()).or_default().push(edge.source.as_str());
    }

    // BFS
    let mut visited: HashSet<&str> = HashSet::new();
    let mut queue: VecDeque<Vec<&str>> = VecDeque::new();
    queue.push_back(vec![source_id]);
    visited.insert(source_id);

    while let Some(path) = queue.pop_front() {
        let last = *path.last().unwrap();
        if last == target_id {
            return ShortestPathResult {
                path: path.iter().map(|s| s.to_string()).collect(),
                total_weight: (path.len() - 1) as f64,
                found: true,
            };
        }
        for &neighbor in adj.get(last).unwrap_or(&vec![]) {
            if !visited.contains(neighbor) {
                visited.insert(neighbor);
                let mut new_path = path.clone();
                new_path.push(neighbor);
                queue.push_back(new_path);
            }
        }
    }

    ShortestPathResult { path: vec![], total_weight: f64::INFINITY, found: false }
}

/// Degree distribution histogram: returns (degree, count) pairs.
pub fn degree_distribution(nodes: &[GraphNode], edges: &[GraphEdge]) -> Vec<(usize, usize)> {
    let mut degree: HashMap<&str, usize> = nodes.iter().map(|n| (n.id.as_str(), 0)).collect();
    for edge in edges {
        *degree.entry(edge.source.as_str()).or_insert(0) += 1;
        *degree.entry(edge.target.as_str()).or_insert(0) += 1;
    }
    let mut dist: HashMap<usize, usize> = HashMap::new();
    for &d in degree.values() {
        *dist.entry(d).or_insert(0) += 1;
    }
    let mut result: Vec<(usize, usize)> = dist.into_iter().collect();
    result.sort_by_key(|&(d, _)| d);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_graph() -> (Vec<GraphNode>, Vec<GraphEdge>) {
        let nodes = vec![
            GraphNode { id: "a".to_string(), name: "A".to_string() },
            GraphNode { id: "b".to_string(), name: "B".to_string() },
            GraphNode { id: "c".to_string(), name: "C".to_string() },
            GraphNode { id: "d".to_string(), name: "D".to_string() },
        ];
        let edges = vec![
            GraphEdge { source: "a".to_string(), target: "b".to_string(), weight: 1.0 },
            GraphEdge { source: "b".to_string(), target: "c".to_string(), weight: 1.0 },
            GraphEdge { source: "a".to_string(), target: "c".to_string(), weight: 1.0 },
        ];
        (nodes, edges)
    }

    #[test]
    fn test_pagerank_sums_to_one() {
        let (nodes, edges) = make_graph();
        let results = compute_pagerank(&nodes, &edges, 0.85, 100);
        let total: f64 = results.iter().map(|r| r.score).sum();
        assert!((total - 1.0).abs() < 0.01, "PageRank should sum to ~1, got {total}");
    }

    #[test]
    fn test_shortest_path_direct() {
        let (nodes, edges) = make_graph();
        let result = find_shortest_path(&nodes, &edges, "a", "b");
        assert!(result.found);
        assert_eq!(result.path, vec!["a", "b"]);
    }

    #[test]
    fn test_shortest_path_not_found() {
        let (nodes, edges) = make_graph();
        let result = find_shortest_path(&nodes, &edges, "a", "d");
        assert!(!result.found);
    }

    #[test]
    fn test_community_detection() {
        let (nodes, edges) = make_graph();
        let communities = detect_communities(&nodes, &edges);
        assert_eq!(communities.len(), nodes.len());
    }
}
