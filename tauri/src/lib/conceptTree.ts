/**
 * conceptTree — pure helpers for building a Chapter → Section → Concept forest
 * from `concept_nodes` + `concept_links` (`link_type = 'part_of'`).
 * Used by both `RoadmapGraph` (the D3 SVG) and `LearningHubSidebar` (the tree list).
 */
import type { ConceptLink, ConceptNode } from "./api";

export interface RoadmapNode {
  id: string;
  name: string;
  hierarchy_level: string;
  concept_type: string;
  children?: RoadmapNode[];
}

/** Build a single virtual root with the chapter/section/concept forest as children.
 *
 * Convention: a `part_of` link has `source_id = child`, `target_id = parent`
 * (matches `commands/ai_knowledge.rs` and `commands/knowledge_graph.rs`).
 */
export function buildForest(nodes: ConceptNode[], links: ConceptLink[]): RoadmapNode {
  const parentOf = new Map<string, string>();
  links.forEach((link) => {
    if (link.link_type === "part_of") {
      parentOf.set(link.source_id, link.target_id);
    }
  });

  const nodeMap = new Map<string, RoadmapNode>(
    nodes.map((n) => [
      n.id,
      {
        id: n.id,
        name: n.name,
        hierarchy_level: n.hierarchy_level || "concept",
        concept_type: n.concept_type,
        children: [],
      },
    ]),
  );

  nodeMap.forEach((node, id) => {
    const parentId = parentOf.get(id);
    if (parentId && nodeMap.has(parentId)) {
      const parent = nodeMap.get(parentId);
      if (parent?.children) {
        parent.children.push(node);
      }
    }
  });

  const roots: RoadmapNode[] = [];
  nodeMap.forEach((node, id) => {
    if (!parentOf.has(id)) {
      roots.push(node);
    }
  });

  return {
    id: "__root__",
    name: "Knowledge Map",
    hierarchy_level: "root",
    concept_type: "topic",
    children: roots,
  };
}
