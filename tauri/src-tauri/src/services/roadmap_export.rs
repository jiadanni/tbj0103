//! Roadmap export — pure rendering helpers for the Chapter → Section → Concept
//! tree (built from `concept_nodes` + `concept_links` where `link_type = 'part_of'`).
//!
//! No DB access. Callers pass already-fetched `Vec<ConceptNode>` + `Vec<ConceptLink>`.
//! Mirrors `src/lib/conceptTree.ts::buildForest` — `part_of` link convention is
//! `source_id = child`, `target_id = parent`.

use crate::models::knowledge_graph::{ConceptLink, ConceptNode};
use crate::services::concept_hierarchy::is_valid_parent_pair;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

// Hierarchy invariants live in `services::concept_hierarchy`.

#[derive(Debug, Clone, Serialize)]
pub struct RoadmapTreeNode {
    pub id: String,
    pub name: String,
    pub hierarchy_level: String,
    pub concept_type: String,
    pub description: String,
    pub tags: Vec<String>,
    pub children: Vec<RoadmapTreeNode>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoadmapTree {
    pub roots: Vec<RoadmapTreeNode>,
    /// Non-`part_of` edges (prerequisite / supports / contradicts / related / example).
    pub cross_links: Vec<ConceptLink>,
}

/// Export-time metadata (workspace name + a preformatted timestamp string),
/// kept separate from `RoadmapTree` so the renderers stay pure and the
/// caller controls formatting. An empty `workspace_name` falls back to a
/// generic "# Roadmap" header.
#[derive(Debug, Clone, Serialize, Default)]
pub struct ExportMeta {
    pub workspace_name: String,
    pub exported_at: String,
}

/// Build the Chapter/Section/Concept forest from concepts + links.
///
/// Convention: a `part_of` link has `source_id = child`, `target_id = parent`.
pub fn build_tree(nodes: Vec<ConceptNode>, links: Vec<ConceptLink>) -> RoadmapTree {
    let levels: HashMap<String, String> = nodes
        .iter()
        .map(|n| (n.id.clone(), n.hierarchy_level.to_string()))
        .collect();

    // child_id -> parent_id
    let mut parent_of: HashMap<String, String> = HashMap::new();
    let mut cross_links: Vec<ConceptLink> = Vec::new();
    for link in &links {
        if link.link_type.to_string() == "part_of" {
            let child_level = levels.get(&link.source_id).map(|s| s.as_str());
            let parent_level = levels.get(&link.target_id).map(|s| s.as_str());
            if let (Some(child_level), Some(parent_level)) = (child_level, parent_level) {
                if is_valid_parent_pair(child_level, parent_level) {
                    parent_of.insert(link.source_id.clone(), link.target_id.clone());
                }
            }
        } else {
            cross_links.push(link.clone());
        }
    }

    // Materialise nodes into a map of partial tree nodes
    let mut tree_nodes: HashMap<String, RoadmapTreeNode> = HashMap::with_capacity(nodes.len());
    let mut order: Vec<String> = Vec::with_capacity(nodes.len());
    for n in nodes {
        order.push(n.id.clone());
        tree_nodes.insert(
            n.id.clone(),
            RoadmapTreeNode {
                id: n.id,
                name: n.name,
                hierarchy_level: n.hierarchy_level.to_string(),
                concept_type: n.concept_type.to_string(),
                description: n.concept_description,
                tags: n.tags,
                children: Vec::new(),
            },
        );
    }

    let known: HashSet<String> = tree_nodes.keys().cloned().collect();

    // Sort children stable: by hierarchy then name, but easier to keep input order.
    // Iterate children in insertion order to keep determinism.
    let mut child_ids_per_parent: HashMap<String, Vec<String>> = HashMap::new();
    let mut roots: Vec<String> = Vec::new();
    for id in &order {
        match parent_of.get(id) {
            Some(parent_id) if known.contains(parent_id) => {
                child_ids_per_parent
                    .entry(parent_id.clone())
                    .or_default()
                    .push(id.clone());
            }
            _ => roots.push(id.clone()),
        }
    }

    // Recursively attach children, draining from tree_nodes.
    fn attach(
        id: &str,
        tree_nodes: &mut HashMap<String, RoadmapTreeNode>,
        child_ids_per_parent: &HashMap<String, Vec<String>>,
    ) -> Option<RoadmapTreeNode> {
        let mut node = tree_nodes.remove(id)?;
        if let Some(children) = child_ids_per_parent.get(id) {
            for child_id in children {
                if let Some(child) = attach(child_id, tree_nodes, child_ids_per_parent) {
                    node.children.push(child);
                }
            }
        }
        Some(node)
    }

    let mut root_nodes: Vec<RoadmapTreeNode> = Vec::with_capacity(roots.len());
    for root_id in &roots {
        if let Some(node) = attach(root_id, &mut tree_nodes, &child_ids_per_parent) {
            root_nodes.push(node);
        }
    }

    RoadmapTree {
        roots: root_nodes,
        cross_links,
    }
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

pub fn render_markdown_outline(tree: &RoadmapTree, meta: &ExportMeta) -> String {
    let mut out = String::new();
    if meta.workspace_name.trim().is_empty() {
        out.push_str("# Roadmap\n\n");
    } else {
        out.push_str(&format!("# {} roadmap\n\n", meta.workspace_name));
    }
    if !meta.exported_at.trim().is_empty() {
        out.push_str(&format!("_Exported {}_\n\n", meta.exported_at));
    }
    for root in &tree.roots {
        write_markdown(&mut out, root, 0);
    }
    if !tree.cross_links.is_empty() {
        out.push_str("\n## Cross-References\n\n");
        for link in &tree.cross_links {
            out.push_str(&format!(
                "- `{}` → `{}` ({})\n",
                link.source_id, link.target_id, link.link_type
            ));
        }
    }
    out
}

fn write_markdown(out: &mut String, node: &RoadmapTreeNode, depth: usize) {
    match node.hierarchy_level.as_str() {
        "chapter" => out.push_str(&format!("\n## {} _(group)_\n\n", node.name)),
        "section" => out.push_str(&format!("\n### {} _(subgroup)_\n\n", node.name)),
        _ => {
            let indent = "  ".repeat(depth.saturating_sub(2));
            out.push_str(&format!(
                "{}- **{}** _({})_\n",
                indent, node.name, node.concept_type
            ));
        }
    }
    if !node.description.is_empty() {
        let indent_block = "  ".repeat(depth.saturating_sub(2));
        for line in node.description.lines() {
            out.push_str(&format!("{indent_block}  {line}\n"));
        }
    }
    for child in &node.children {
        write_markdown(out, child, depth + 1);
    }
}

/// Additive JSON wrapper — `{ workspace_name, exported_at, roots, cross_links }`.
/// The frontend only writes this string to disk; nothing parses it back, so
/// adding fields here is safe.
#[derive(Debug, Clone, Serialize)]
struct RoadmapExportJson<'a> {
    workspace_name: &'a str,
    exported_at: &'a str,
    roots: &'a [RoadmapTreeNode],
    cross_links: &'a [ConceptLink],
}

pub fn render_json(tree: &RoadmapTree, meta: &ExportMeta) -> Result<String, String> {
    let wrapper = RoadmapExportJson {
        workspace_name: &meta.workspace_name,
        exported_at: &meta.exported_at,
        roots: &tree.roots,
        cross_links: &tree.cross_links,
    };
    serde_json::to_string_pretty(&wrapper).map_err(|e| e.to_string())
}

pub fn render_mermaid(tree: &RoadmapTree, meta: &ExportMeta) -> String {
    let mut out = String::new();
    out.push_str("graph TD\n");
    if !meta.workspace_name.trim().is_empty() {
        out.push_str(&format!("  %% Workspace: {}\n", meta.workspace_name));
    }
    if !meta.exported_at.trim().is_empty() {
        out.push_str(&format!("  %% Exported: {}\n", meta.exported_at));
    }

    // Map raw id -> sanitized mermaid id
    let mut id_map: HashMap<String, String> = HashMap::new();
    let mut counter: usize = 0;
    fn declare(
        out: &mut String,
        node: &RoadmapTreeNode,
        id_map: &mut HashMap<String, String>,
        counter: &mut usize,
    ) {
        let mid = format!("n{counter}");
        *counter += 1;
        id_map.insert(node.id.clone(), mid.clone());
        let label = mermaid_escape(&node.name);
        let suffix = match node.hierarchy_level.as_str() {
            "chapter" => "[/{name}/]".replace("{name}", &label),
            "section" => format!("[[{label}]]"),
            _ => format!("[{label}]"),
        };
        out.push_str(&format!("  {mid}{suffix}\n"));
        for child in &node.children {
            declare(out, child, id_map, counter);
        }
    }
    for root in &tree.roots {
        declare(&mut out, root, &mut id_map, &mut counter);
    }

    fn edges(out: &mut String, node: &RoadmapTreeNode, id_map: &HashMap<String, String>) {
        if let Some(parent_id) = id_map.get(&node.id) {
            for child in &node.children {
                if let Some(child_id) = id_map.get(&child.id) {
                    out.push_str(&format!("  {parent_id} --> {child_id}\n"));
                }
                edges(out, child, id_map);
            }
        }
    }
    for root in &tree.roots {
        edges(&mut out, root, &id_map);
    }

    // Cross-links with labeled edges
    for link in &tree.cross_links {
        if let (Some(src), Some(tgt)) = (id_map.get(&link.source_id), id_map.get(&link.target_id)) {
            out.push_str(&format!(
                "  {src} -. {label} .-> {tgt}\n",
                label = mermaid_escape(&link.link_type.to_string())
            ));
        }
    }

    out
}

fn mermaid_escape(s: &str) -> String {
    // Quoting via &quot; not supported pre-9.4; safer to strip quotes/brackets.
    s.replace('"', "'")
        .replace('[', "(")
        .replace(']', ")")
        .replace('|', "/")
        .replace('\n', " ")
}

pub fn render_csv(tree: &RoadmapTree) -> String {
    let mut out = String::new();
    out.push_str("id,parent_id,depth,hierarchy_level,concept_type,name,description,tags\n");
    for root in &tree.roots {
        write_csv_row(&mut out, root, None, 0);
    }
    out
}

fn write_csv_row(out: &mut String, node: &RoadmapTreeNode, parent: Option<&str>, depth: usize) {
    let tags = node.tags.join(";");
    out.push_str(&format!(
        "{},{},{},{},{},{},{},{}\n",
        csv_field(&node.id),
        csv_field(parent.unwrap_or("")),
        depth,
        csv_field(&node.hierarchy_level),
        csv_field(&node.concept_type),
        csv_field(&node.name),
        csv_field(&node.description),
        csv_field(&tags),
    ));
    for child in &node.children {
        write_csv_row(out, child, Some(&node.id), depth + 1);
    }
}

fn csv_field(s: &str) -> String {
    let needs_quote = s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r');
    if !needs_quote {
        return s.to_string();
    }
    let escaped = s.replace('"', "\"\"");
    format!("\"{escaped}\"")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::knowledge_graph::{
        ConceptLink, ConceptNode, ConceptType, HierarchyLevel, LinkType,
    };

    fn make_node(id: &str, name: &str, level: HierarchyLevel) -> ConceptNode {
        ConceptNode {
            id: id.into(),
            workspace_id: "ws".into(),
            name: name.into(),
            concept_description: String::new(),
            concept_type: ConceptType::Topic,
            tags: vec![],
            aliases: vec![],
            references: vec![],
            x_position: 0.0,
            y_position: 0.0,
            review_count: 0,
            hierarchy_level: level,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn part_of(src: &str, tgt: &str) -> ConceptLink {
        ConceptLink {
            id: format!("{src}-{tgt}"),
            source_id: src.into(),
            target_id: tgt.into(),
            link_type: LinkType::PartOf,
            strength: 1.0,
            context: String::new(),
            created_at: String::new(),
        }
    }

    #[test]
    fn builds_chapter_section_concept_forest() {
        let nodes = vec![
            make_node("c1", "Chapter 1", HierarchyLevel::Chapter),
            make_node("s1", "Section 1", HierarchyLevel::Section),
            make_node("n1", "Concept A", HierarchyLevel::Concept),
            make_node("n2", "Concept B", HierarchyLevel::Concept),
        ];
        let links = vec![
            part_of("s1", "c1"),
            part_of("n1", "s1"),
            part_of("n2", "s1"),
        ];
        let tree = build_tree(nodes, links);
        assert_eq!(tree.roots.len(), 1);
        assert_eq!(tree.roots[0].id, "c1");
        assert_eq!(tree.roots[0].children.len(), 1);
        assert_eq!(tree.roots[0].children[0].id, "s1");
        assert_eq!(tree.roots[0].children[0].children.len(), 2);
    }

    #[test]
    fn cross_links_are_separated() {
        let nodes = vec![
            make_node("a", "A", HierarchyLevel::Concept),
            make_node("b", "B", HierarchyLevel::Concept),
        ];
        let mut prereq = part_of("a", "b");
        prereq.link_type = LinkType::Prerequisite;
        let tree = build_tree(nodes, vec![prereq]);
        assert_eq!(tree.cross_links.len(), 1);
        assert_eq!(tree.roots.len(), 2);
    }

    #[test]
    fn markdown_outline_contains_hierarchy() {
        let nodes = vec![
            make_node("c1", "Intro", HierarchyLevel::Chapter),
            make_node("n1", "Variables", HierarchyLevel::Concept),
        ];
        let links = vec![part_of("n1", "c1")];
        let md = render_markdown_outline(&build_tree(nodes, links), &ExportMeta::default());
        assert!(md.contains("## Intro"));
        assert!(md.contains("- **Variables**"));
    }

    #[test]
    fn markdown_outline_uses_workspace_meta() {
        let nodes = vec![make_node("c1", "Intro", HierarchyLevel::Chapter)];
        let meta = ExportMeta {
            workspace_name: "Python and ML".to_string(),
            exported_at: "2026-07-26 09:00".to_string(),
        };
        let md = render_markdown_outline(&build_tree(nodes, vec![]), &meta);
        assert!(md.starts_with("# Python and ML roadmap"));
        assert!(md.contains("_Exported 2026-07-26 09:00_"));
    }

    #[test]
    fn csv_has_header_and_rows() {
        let nodes = vec![
            make_node("c1", "Intro", HierarchyLevel::Section),
            make_node("n1", "Variables, scoped", HierarchyLevel::Concept),
        ];
        let links = vec![part_of("n1", "c1")];
        let csv = render_csv(&build_tree(nodes, links));
        assert!(csv.starts_with("id,parent_id,depth"));
        assert!(csv.contains("\"Variables, scoped\""));
        assert!(csv.contains(",c1,1,"));
    }

    #[test]
    fn mermaid_emits_graph_td_and_edges() {
        let nodes = vec![
            make_node("c1", "Intro", HierarchyLevel::Section),
            make_node("n1", "Vars", HierarchyLevel::Concept),
        ];
        let links = vec![part_of("n1", "c1")];
        let m = render_mermaid(&build_tree(nodes, links), &ExportMeta::default());
        assert!(m.starts_with("graph TD"));
        assert!(m.contains("-->"));
    }

    #[test]
    fn mermaid_includes_meta_comments() {
        let nodes = vec![make_node("c1", "Intro", HierarchyLevel::Concept)];
        let meta = ExportMeta {
            workspace_name: "Python and ML".to_string(),
            exported_at: "2026-07-26 09:00".to_string(),
        };
        let m = render_mermaid(&build_tree(nodes, vec![]), &meta);
        assert!(m.contains("%% Workspace: Python and ML"));
        assert!(m.contains("%% Exported: 2026-07-26 09:00"));
    }

    #[test]
    fn json_roundtrips() {
        let nodes = vec![make_node("a", "A", HierarchyLevel::Concept)];
        let meta = ExportMeta {
            workspace_name: "WS".to_string(),
            exported_at: "2026-07-26 09:00".to_string(),
        };
        let json = render_json(&build_tree(nodes, vec![]), &meta).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed["roots"].is_array());
        assert!(parsed["cross_links"].is_array());
        assert_eq!(parsed["workspace_name"], "WS");
        assert_eq!(parsed["exported_at"], "2026-07-26 09:00");
    }
}
