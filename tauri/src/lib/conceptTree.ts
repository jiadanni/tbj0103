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
  hiddenChildCount?: number;
}

function isLegacyUncategorizedScaffold(node: Pick<RoadmapNode, "name" | "hierarchy_level">): boolean {
  return node.hierarchy_level === "chapter" && node.name.trim().toLowerCase() === "uncategorized";
}

function siblingKey(node: RoadmapNode): string {
  return `${node.hierarchy_level}::${node.name.trim().toLowerCase()}`;
}

function mergeDuplicateSiblings(nodes: RoadmapNode[]): RoadmapNode[] {
  const merged = new Map<string, RoadmapNode>();
  const orderedKeys: string[] = [];

  for (const node of nodes) {
    const withMergedChildren: RoadmapNode = {
      ...node,
      children: mergeDuplicateSiblings(node.children ?? []),
    };
    const key = siblingKey(withMergedChildren);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, withMergedChildren);
      orderedKeys.push(key);
      continue;
    }

    existing.children = mergeDuplicateSiblings([
      ...(existing.children ?? []),
      ...(withMergedChildren.children ?? []),
    ]);
  }

  return orderedKeys
    .map((key) => merged.get(key))
    .filter((node): node is RoadmapNode => Boolean(node));
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

  const mergedRoots = mergeDuplicateSiblings(roots);

  return {
    id: "__root__",
    name: "Knowledge Map",
    hierarchy_level: "root",
    concept_type: "topic",
    children: mergedRoots.filter((node) => !isLegacyUncategorizedScaffold(node)),
  };
}

/**
 * Walk a forest and strip children from `section` nodes whose IDs are not in
 * `expandedSectionIds`, recording the count of removed children in
 * `hiddenChildCount` so the renderer can show a `+N` affordance.
 *
 * Pure: returns a new tree; the input is not mutated.
 */
export function pruneCollapsedSections(
  root: RoadmapNode,
  expandedSectionIds: Set<string>,
): RoadmapNode {
  const visit = (node: RoadmapNode): RoadmapNode => {
    const children = node.children ?? [];
    if (node.hierarchy_level === "section" && !expandedSectionIds.has(node.id)) {
      const hiddenChildCount = children.length;
      return { ...node, children: [], hiddenChildCount };
    }
    return { ...node, children: children.map(visit) };
  };
  return visit(root);
}
