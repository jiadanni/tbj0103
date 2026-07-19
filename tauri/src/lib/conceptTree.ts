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
  /**
   * Set when a redundant same-named section was merged into this chapter.
   * Holds the merged section's node id — the key used for expand/collapse
   * state, since collapse tracking predates the merge and stores section ids.
   */
  collapseId?: string;
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

/**
 * Auto-synthesized topic groups are materialized as a chapter plus a single
 * section with the exact same name (the hierarchy rules require concepts to
 * hang off a section). Rendering both boxes reads as duplication, so when a
 * chapter's only child is a same-named section, fold the section away and
 * hoist its children onto the chapter. The section's id is kept as
 * `collapseId` so expand/collapse state (keyed by section id) still applies.
 */
function collapseRedundantSections(nodes: RoadmapNode[]): RoadmapNode[] {
  return nodes.map((node) => {
    const children = collapseRedundantSections(node.children ?? []);
    const only = children.length === 1 ? children[0] : null;
    if (
      node.hierarchy_level === "chapter" &&
      only &&
      only.hierarchy_level === "section" &&
      only.name.trim().toLowerCase() === node.name.trim().toLowerCase()
    ) {
      return { ...node, children: only.children ?? [], collapseId: only.id };
    }
    return { ...node, children };
  });
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

  const mergedRoots = collapseRedundantSections(mergeDuplicateSiblings(roots));

  // Hide the "Uncategorized" scaffold only when there is other categorized
  // content to show in its place — otherwise every concept the hierarchy job
  // couldn't place would vanish from the roadmap entirely, leaving a blank
  // map even though nodes exist (they're still visible via sidebar orphans).
  const categorizedRoots = mergedRoots.filter((node) => !isLegacyUncategorizedScaffold(node));
  const visibleRoots = categorizedRoots.length > 0 ? categorizedRoots : mergedRoots;

  return {
    id: "__root__",
    name: "Knowledge Map",
    hierarchy_level: "root",
    concept_type: "topic",
    children: visibleRoots,
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
    const collapseKey = node.hierarchy_level === "section" ? node.id : node.collapseId;
    if (collapseKey !== undefined && !expandedSectionIds.has(collapseKey)) {
      const hiddenChildCount = children.length;
      return { ...node, children: [], hiddenChildCount };
    }
    return { ...node, children: children.map(visit) };
  };
  return visit(root);
}
