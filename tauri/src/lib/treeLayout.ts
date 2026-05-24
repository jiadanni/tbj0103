import type { ConceptNode, ConceptLink } from "./api";
import * as d3 from 'd3';

export interface TreeNode {
  id: string;
  name: string;
  hierarchy_level: string;
  children?: TreeNode[];
}

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  fx: number; // fixed x for force graph
  fy: number; // fixed y for force graph
}

/**
 * Builds a tree structure from flat node/link arrays
 * Assumes links represent parent->child relationships via 'part_of' links
 * which means: target is a child of source in the concept hierarchy
 */
export function buildTreeFromLinks(

  nodes: Pick<ConceptNode, "id" | "hierarchy_level" | "name">[],

  links: Pick<ConceptLink, "source_id" | "target_id" | "link_type">[],
  rootId: string
): TreeNode {
  const nodeMap = new Map<string, TreeNode>(
    nodes.map((n) => [n.id, { ...n, children: [] }])
  );

  const parentMap = new Map<string, string>(); // id -> parent_id (for part_of)
  links.forEach((link) => {
    if (link.link_type === 'part_of') {
      // In 'part_of', target IS the child, source IS the parent
      parentMap.set(link.target_id, link.source_id);
    }
  });

  // Start from root and recursively build children
  function buildTree(nodeId: string): TreeNode {
    const node = nodeMap.get(nodeId);
    if (!node) {
      return { id: nodeId, name: 'Unknown', hierarchy_level: 'concept', children: [] };
    }

    // Find all children (nodes where this node is the parent)
    const children: TreeNode[] = [];
    parentMap.forEach((parentId, childId) => {
      if (parentId === nodeId) {
        children.push(buildTree(childId));
      }
    });

    return {
      ...node,
      children,
    };
  }

  return buildTree(rootId);
}

/**
 * Computes radial tree layout positions using D3 hierarchy
 * Returns nodes with fixed (fx, fy) positions for react-force-graph-2d
 *
 * Configuration examples:
 * - Tight radial (compact): radius=150, baseNodeSize=35 — good for small trees
 * - Balanced (default): radius=200, baseNodeSize=40 — good for 3-4 levels
 * - Spacious (large): radius=280, baseNodeSize=50 — good for deep hierarchies
 *
 * @param treeRoot - Root of the hierarchical tree where children[i] are branches
 * @param config - Optional layout parameters
 * @returns Map of node IDs to positions with fixed x/y
 */
export function computeRadialTreeLayout(
  treeRoot: TreeNode,
  config?: {
    radius?: number;
    angleStartOffset?: number;
    baseNodeSize?: number;
  }
): Map<string, PositionedNode> {
  const radius = config?.radius ?? 200;
  const angleStartOffset = config?.angleStartOffset ?? -Math.PI / 2;

  // Use D3 hierarchy to compute tree structure
  const root = d3.hierarchy<TreeNode>(treeRoot);
  root.count(); // Compute node counts for sizing

  // Create radial (cluster) layout
  const layout = d3.cluster<TreeNode>().size([2 * Math.PI, radius]);
  layout(root);

  const positions = new Map<string, PositionedNode>();


  root.descendants().forEach((node) => {
    const angle = (node.x ?? 0) + angleStartOffset;
    const r = node.y ?? 0;

    const x = r * Math.cos(angle);
    const y = r * Math.sin(angle);

    positions.set(node.data.id, {
      id: node.data.id,
      x,
      y,
      fx: x,
      fy: y,
    });
  });

  return positions;
}

/**
 * Alternative: Rectangular hierarchy layout (Reingold-Tilford style)
 * Positions nodes in a top-down tree layout
 *
 * Config:
 * - leafMargin: horizontal spacing between leaf nodes (default 50)
 * - levelHeight: vertical space per tree level (default 120)
 */
export function computeRectangularTreeLayout(
  treeRoot: TreeNode,
  config?: {
    leafMargin?: number;
    levelHeight?: number;
  }
): Map<string, PositionedNode> {
  const leafMargin = config?.leafMargin ?? 50;
  const levelHeight = config?.levelHeight ?? 120;

  const root = d3.hierarchy<TreeNode>(treeRoot);

  // Reingold-Tilford tree layout
  const layout = d3
    .tree<TreeNode>()
    .size([1200, 600])
    .nodeSize([leafMargin, levelHeight]);

  layout(root);

  const positions = new Map<string, PositionedNode>();


  root.descendants().forEach((node) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    positions.set(node.data.id, {
      id: node.data.id,
      x: x,
      y: y,
      fx: x,
      fy: y,
    });
  });

  return positions;
}

/**
 * Selects an appropriate root node for tree layout
 * Strategy:
 * 1. Use provided rootId if valid
 * 2. Fallback to first chapter-level node
 * 3. Fallback to first top-level node with no parent
 * 4. Last resort: first node in the list
 */

export function selectRootNode(nodes: Pick<ConceptNode, "id" | "hierarchy_level">[], links: Pick<ConceptLink, "source_id" | "target_id" | "link_type">[], overrideRootId?: string): string {
  if (overrideRootId && nodes.some((n) => n.id === overrideRootId)) {
    return overrideRootId;
  }

  // Build parent map
  const hasParent = new Set<string>();
  links.forEach((link) => {
    if (link.link_type === 'part_of') {
      hasParent.add(link.target_id);
    }
  });

  // Try to find first chapter-level concept with no parent
  const chapterWithNoParent = nodes.find(
    (n) => n.hierarchy_level === 'chapter' && !hasParent.has(n.id)
  );
  if (chapterWithNoParent) { return chapterWithNoParent.id; }

  // Try to find any node with no parent
  const orphanNode = nodes.find((n) => !hasParent.has(n.id));
  if (orphanNode) { return orphanNode.id; }

  // Last resort
  return nodes[0]?.id ?? '';
}

/**
 * Checks if a link represents a tree relationship (parent-child via 'part_of')
 * These should be respected in the tree layout
 */

export function isTreeLink(link: Pick<ConceptLink, "link_type">): boolean {
  return link.link_type === 'part_of';
}

/**
 * Filters additional non-tree links (related, prerequisite, etc.)
 * Useful for toggling tree-only links vs all graph edges
 */

export function filterAdditionalLinks(links: Pick<ConceptLink, "source_id" | "target_id" | "link_type">[]): Pick<ConceptLink, "source_id" | "target_id" | "link_type">[] {
  return links.filter((link) => !isTreeLink(link));
}

/**
 * Estimates optimal radius based on tree depth
 * Deeper trees need more radial space to avoid crowding
 *
 * @param treeRoot - Root of the hierarchical tree
 * @returns Recommended radius in pixels
 */
export function estimateOptimalRadius(treeRoot: TreeNode): number {
  function getDepth(node: TreeNode): number {
    if (!node.children || node.children.length === 0) { return 1; }
    return 1 + Math.max(...node.children.map(getDepth));
  }

  const depth = getDepth(treeRoot);
  
  // Scale radius by depth: more levels need more space
  // depth 1-2: compact (120px), depth 3-4: balanced (200px), depth 5+: spacious (280px)
  if (depth <= 2) { return 120; }
  if (depth <= 4) { return 200; }
  return 280;
}
