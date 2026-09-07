/**
 * RoadmapGraph — hierarchical SVG roadmap renderer for the knowledge graph.
 * Renders chapters → sections → concepts as a top-down tree of labeled boxes
 * connected by dashed/curved paths. Supports zoom/pan and node selection.
 */
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import * as d3 from "d3";
import type { ConceptNode, ConceptLink } from "../lib/api";
import {
  computeRoadmapFit,
  type RoadmapViewportInset,
} from "../lib/roadmapFit";
import { buildForest, pruneCollapsedSections, type RoadmapNode } from "../lib/conceptTree";
import { formatTimestamp } from "../lib/dates";

const TYPE_COLORS: Record<string, string> = {
  person: "#60a5fa",
  place: "#34d399",
  event: "#f472b6",
  topic: "var(--accent-color)",
  object: "#fb923c",
  theory: "#facc15",
  technology: "#38bdf8",
  definition: "#f87171",
  question: "#2dd4bf",
  insight: "#4ade80",
  resource: "#a1a1aa",
  custom: "#e879f9",
  other: "#94a3b8",
};

function colorFor(type: string) {
  return TYPE_COLORS[type.toLowerCase()] ?? TYPE_COLORS.other;
}

function getResolvedColor(hexOrVar: string): string {
  if (hexOrVar.startsWith("var(")) {
    if (typeof window !== "undefined") {
      const varName = hexOrVar.slice(4, -1).trim();
      const val = window.getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      if (val) { return val; }
    }
    return "#6366f1";
  }
  return hexOrVar;
}

interface BoxDims {
  width: number;
  height: number;
}

function dimsFor(level: string): BoxDims {
  // Heights allow a wrapped label plus the child-count line, with clearance at
  // the bottom for the collapse badge that hangs off chapters and sections.
  if (level === "chapter") { return { width: 236, height: 74 }; }
  if (level === "section") { return { width: 192, height: 62 }; }
  return { width: 158, height: 38 };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Greedy word-wrap into at most `maxLines` lines of ~`maxChars` characters.
 * The final line is ellipsis-truncated if the name still overflows — this
 * replaces the old single-line truncation that chopped most titles.
 */
function wrapLabel(s: string, maxChars: number, maxLines = 2): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || current === "") {
      current = candidate;
      continue;
    }
    lines.push(truncate(current, maxChars));
    current = word;
    if (lines.length === maxLines - 1) {
      current = words.slice(i).join(" ");
      break;
    }
  }
  if (current) { lines.push(truncate(current, maxChars)); }
  return lines.length > 0 ? lines : [""];
}

interface RoadmapGraphProps {
  nodes: ConceptNode[];
  links: ConceptLink[];
  selectedConceptId?: string | null;
  onSelectConcept: (concept: ConceptNode | null) => void;
  searchFilter?: string;
  viewportInset?: RoadmapViewportInset;
}

export interface RoadmapGraphHandle {
  /**
   * Snapshot the current SVG for export. Clones the live `<svg>`, applies the
   * laid-out bbox as `width`/`height`/`viewBox` so the markup renders
   * standalone, and serializes to a string. Returns `null` when no layout has
   * been computed yet (e.g., empty roadmap).
   */
  getExportableSvg: () => { svg: string; width: number; height: number } | null;
  /** Scale about the viewport center by `factor` (>1 zooms in). */
  zoomBy: (factor: number) => void;
  /** Re-fit the whole roadmap into view, matching the initial framing. */
  resetView: () => void;
}

function RoadmapGraphInner(
  {
    nodes,
    links,
    selectedConceptId,
    onSelectConcept,
    searchFilter,
    viewportInset,
  }: RoadmapGraphProps,
  ref: Ref<RoadmapGraphHandle>,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set());

  // Stale section IDs (kept across data refreshes) are filtered out lazily
  // inside the layout memo below rather than via a setState-in-effect pass.

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) { next.delete(sectionId); } else { next.add(sectionId); }
      return next;
    });
  };

  // Track container dimensions
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") { return; }
    let rafId = 0;
    const update = () => {
      rafId = 0;
      const width = el.clientWidth;
      const height = el.clientHeight;
      setDims((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    update();
    const obs = new ResizeObserver(() => {
      if (rafId !== 0) { return; }
      rafId = window.requestAnimationFrame(update);
    });
    obs.observe(el);
    return () => {
      if (rafId !== 0) { window.cancelAnimationFrame(rafId); }
      obs.disconnect();
    };
  }, []);

  // Compute layout via d3.tree() — top-down (root at top, children below).
  // Each chapter subtree is laid out independently, then the subtrees are
  // wrapped into rows (like word-wrap) so the overall shape tracks the
  // container's aspect ratio instead of one endless horizontal strip.
  const layout = useMemo(() => {
    if (nodes.length === 0) { return null; }

    const forest = buildForest(nodes, links);
    const sectionIds = new Set(
      nodes.filter((n) => (n.hierarchy_level || "concept") === "section").map((n) => n.id),
    );
    const effectiveExpanded = new Set<string>();
    expandedSections.forEach((id) => { if (sectionIds.has(id)) { effectiveExpanded.add(id); } });
    const pruned = pruneCollapsedSections(forest, effectiveExpanded);
    const chapterTrees = pruned.children ?? [];
    if (chapterTrees.length === 0) { return null; }

    type PositionedNode = d3.HierarchyPointNode<RoadmapNode>;
    type PositionedLink = d3.HierarchyPointLink<RoadmapNode>;

    // node size: [horizontal between siblings, vertical between levels]
    // Chapter boxes are 236 wide and 74 tall; the gutters here keep siblings
    // clear horizontally and leave room for the connector curves vertically.
    const treeLayout = d3.tree<RoadmapNode>().nodeSize([276, 132]);

    interface LaidTree {
      treeNodes: PositionedNode[];
      treeLinks: PositionedLink[];
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
      width: number;
      height: number;
    }

    const laidTrees: LaidTree[] = chapterTrees.map((tree) => {
      const root = d3.hierarchy<RoadmapNode>(tree);
      treeLayout(root);
      const treeNodes = root.descendants() as PositionedNode[];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      treeNodes.forEach((d) => {
        const dim = dimsFor(d.data.hierarchy_level);
        if (d.x - dim.width / 2 < minX) { minX = d.x - dim.width / 2; }
        if (d.x + dim.width / 2 > maxX) { maxX = d.x + dim.width / 2; }
        if (d.y - dim.height / 2 < minY) { minY = d.y - dim.height / 2; }
        if (d.y + dim.height / 2 > maxY) { maxY = d.y + dim.height / 2; }
      });
      return {
        treeNodes,
        treeLinks: root.links() as PositionedLink[],
        minX, maxX, minY, maxY,
        width: maxX - minX,
        height: maxY - minY,
      };
    });

    // Pack the chapter subtrees into rows. Try every row-count and keep the
    // packing whose overall bounds fit the container at the largest scale
    // (fall back to a 2:1 aspect target before dims are measured).
    const colGap = 64;
    const rowGap = 72;
    const targetAspect = dims.width > 0 && dims.height > 0 ? dims.width / dims.height : 2;

    interface Packing { rows: LaidTree[][]; width: number; height: number; }
    const packInto = (rowCount: number): Packing => {
      const totalWidth = laidTrees.reduce((sum, t) => sum + t.width + colGap, 0) - colGap;
      const targetRowWidth = totalWidth / rowCount;
      const rows: LaidTree[][] = [[]];
      let cursor = 0;
      laidTrees.forEach((tree) => {
        const row = rows[rows.length - 1];
        const nextWidth = cursor === 0 ? tree.width : cursor + colGap + tree.width;
        if (row.length > 0 && nextWidth > targetRowWidth && rows.length < rowCount) {
          rows.push([tree]);
          cursor = tree.width;
        } else {
          row.push(tree);
          cursor = nextWidth;
        }
      });
      const width = Math.max(
        ...rows.map((row) => row.reduce((sum, t) => sum + t.width + colGap, 0) - colGap),
      );
      const height = rows.reduce((sum, row) => sum + Math.max(...row.map((t) => t.height)) + rowGap, 0) - rowGap;
      return { rows, width, height };
    };

    let best: Packing | null = null;
    let bestScore = -Infinity;
    for (let rowCount = 1; rowCount <= laidTrees.length; rowCount++) {
      const candidate = packInto(rowCount);
      const score = dims.width > 0 && dims.height > 0
        ? Math.min(dims.width / candidate.width, dims.height / candidate.height)
        : -Math.abs(Math.log((candidate.width / candidate.height) / targetAspect));
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    const packed = best ?? packInto(1);

    // Apply row/column offsets by shifting the freshly-built hierarchy nodes
    // in place (links reference the same node objects, so they follow).
    let rowY = 0;
    packed.rows.forEach((row) => {
      const rowWidth = row.reduce((sum, t) => sum + t.width + colGap, 0) - colGap;
      const rowHeight = Math.max(...row.map((t) => t.height));
      let cursorX = (packed.width - rowWidth) / 2;
      row.forEach((tree) => {
        const dx = cursorX - tree.minX;
        const dy = rowY - tree.minY;
        tree.treeNodes.forEach((n) => {
          n.x += dx;
          n.y += dy;
        });
        cursorX += tree.width + colGap;
      });
      rowY += rowHeight + rowGap;
    });

    const visibleNodes: PositionedNode[] = laidTrees.flatMap((t) => t.treeNodes);
    const hierarchyLinks: PositionedLink[] = laidTrees.flatMap((t) => t.treeLinks);

    const padding = 40;
    const bbox = {
      minX: -padding,
      maxX: packed.width + padding,
      minY: -padding,
      maxY: packed.height + padding,
    };

    return { visibleNodes, hierarchyLinks, bbox };
  }, [nodes, links, expandedSections, dims]);

  // Compute the transform that fits the current layout into the viewport.
  // Shared by the auto-fit effect and the "reset view" control so both land on
  // exactly the same framing.
  // Depend on the four numbers, not the object: callers pass an inline literal,
  // whose identity changes every render. Keying the fit callback (and therefore
  // the auto-fit effect) off the object would re-fit the map on every render.
  const insetTop = viewportInset?.top ?? 0;
  const insetRight = viewportInset?.right ?? 0;
  const insetBottom = viewportInset?.bottom ?? 0;
  const insetLeft = viewportInset?.left ?? 0;

  const computeFitTransform = useCallback(() => {
    if (!layout) { return null; }
    const fit = computeRoadmapFit(layout.bbox, dims, {
      top: insetTop,
      right: insetRight,
      bottom: insetBottom,
      left: insetLeft,
    });
    if (!fit) { return null; }
    return d3.zoomIdentity.translate(fit.tx, fit.ty).scale(fit.scale);
  }, [layout, dims, insetTop, insetRight, insetBottom, insetLeft]);

  // Auto-fit when layout or dims change
  useEffect(() => {
    if (!svgRef.current) { return; }
    const newTransform = computeFitTransform();
    if (!newTransform) { return; }

    // Sync d3.zoom's internal state first, then update React state via
    // requestAnimationFrame to avoid a synchronous setState inside an effect.
    if (zoomRef.current) {
      d3.select(svgRef.current).call(zoomRef.current.transform, newTransform);
    }
    requestAnimationFrame(() => setTransform(newTransform));
  }, [computeFitTransform]);

  // Wire up zoom/pan
  useEffect(() => {
    if (!svgRef.current) { return; }
    const svg = d3.select(svgRef.current);
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        setTransform(event.transform);
      });
    zoomRef.current = zoomBehavior;
    svg.call(zoomBehavior);
    return () => {
      zoomRef.current = null;
      svg.on(".zoom", null);
    };
  }, []);

  // Expose an exportable, standalone SVG snapshot to parent (Export menu).
  // Clones the live `<svg>`, resizes it to the layout bbox, inlines computed
  // CSS variable colors so the markup renders correctly outside the app, and
  // serializes via `XMLSerializer`.
  useImperativeHandle(
    ref,
    () => ({
      getExportableSvg: () => {
        const live = svgRef.current;
        if (!live || !layout) { return null; }
        const width = Math.max(1, Math.round(layout.bbox.maxX - layout.bbox.minX));
        const height = Math.max(1, Math.round(layout.bbox.maxY - layout.bbox.minY));
        const clone = live.cloneNode(true) as SVGSVGElement;
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
        clone.setAttribute("width", String(width));
        clone.setAttribute("height", String(height));
        clone.setAttribute(
          "viewBox",
          `${layout.bbox.minX} ${layout.bbox.minY} ${width} ${height}`,
        );
        // Remove the live pan/zoom transform so the bbox-aligned viewBox controls framing.
        const inner = clone.querySelector("g");
        if (inner) { inner.removeAttribute("transform"); }

        // Inline CSS-variable colors so the SVG is portable.
        const computed = window.getComputedStyle(live);
        const replacements: Array<[string, string]> = [
          ["var(--bg-primary)", computed.getPropertyValue("--bg-primary").trim() || "#0b0f17"],
          ["var(--bg-elevated)", computed.getPropertyValue("--bg-elevated").trim() || "#131a26"],
          ["var(--border-color)", computed.getPropertyValue("--border-color").trim() || "#1f2a3a"],
          ["var(--text-primary)", computed.getPropertyValue("--text-primary").trim() || "#e2e8f0"],
          ["var(--accent-color)", computed.getPropertyValue("--accent-color").trim() || "#6366f1"],
        ];
        clone.querySelectorAll<SVGElement>("*").forEach((el) => {
          for (const attr of ["fill", "stroke"] as const) {
            const value = el.getAttribute(attr);
            if (!value) { continue; }
            const match = replacements.find(([token]) => value.includes(token));
            if (match) { el.setAttribute(attr, value.replace(match[0], match[1])); }
          }
        });

        const svg = new XMLSerializer().serializeToString(clone);
        return { svg, width, height };
      },
      zoomBy: (factor: number) => {
        if (!svgRef.current || !zoomRef.current) { return; }
        d3.select(svgRef.current)
          .transition()
          .duration(180)
          .call(zoomRef.current.scaleBy, factor);
      },
      resetView: () => {
        if (!svgRef.current || !zoomRef.current) { return; }
        const fit = computeFitTransform();
        if (!fit) { return; }
        d3.select(svgRef.current)
          .transition()
          .duration(220)
          .call(zoomRef.current.transform, fit);
      },
    }),
    [layout, computeFitTransform],
  );

  if (!layout) {
    return <div ref={containerRef} className="h-full w-full" />;
  }

  const filter = searchFilter?.trim().toLowerCase();

  return (
    <div ref={containerRef} className="h-full w-full">
      <svg
        ref={svgRef}
        width={dims.width}
        height={dims.height}
        className="block"
        style={{ cursor: "grab" }}
        fontFamily="'Inter', 'SF Pro Text', system-ui, -apple-system, sans-serif"
      >
        <defs>
          <marker
            id="arrow-hier"
            viewBox="0 -5 10 10"
            refX="8"
            refY="0"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,-5L10,0L0,5" fill="rgba(148,163,184,0.55)" />
          </marker>
          <pattern id="rg-dot-grid" width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.2" fill="rgba(148,163,184,0.16)" />
          </pattern>
          {/* Two-part shadow: a tight contact shadow plus a wider ambient one,
              which reads as elevation rather than as a single soft blur. */}
          <filter id="rg-card-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000000" floodOpacity="0.22" />
          </filter>
        </defs>

        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {/* Canvas dot grid — pans/zooms with the content so the map reads as a board, not a void */}
          <rect
            x={layout.bbox.minX - 4000}
            y={layout.bbox.minY - 4000}
            width={layout.bbox.maxX - layout.bbox.minX + 8000}
            height={layout.bbox.maxY - layout.bbox.minY + 8000}
            fill="url(#rg-dot-grid)"
            pointerEvents="none"
          />
          {/* Hierarchy edges (dashed curved connectors) */}
          {layout.hierarchyLinks.map((link, i) => {
            const sx = link.source.x;
            const sy = link.source.y + dimsFor(link.source.data.hierarchy_level).height / 2;
            const tx = link.target.x;
            const ty = link.target.y - dimsFor(link.target.data.hierarchy_level).height / 2;
            const midY = (sy + ty) / 2;
            const path = `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;
            return (
              <path
                key={`hl-${i}`}
                d={path}
                fill="none"
                stroke="rgba(148,163,184,0.4)"
                strokeWidth={1.5}
                strokeDasharray="5,4"
              />
            );
          })}

          {/* Non-hierarchy links (related, prerequisite, etc.) — render thin colored curves */}
          {links
            .filter((l) => l.link_type !== "part_of")
            .map((link) => {
              const src = layout.visibleNodes.find((n) => n.data.id === link.source_id);
              const tgt = layout.visibleNodes.find((n) => n.data.id === link.target_id);
              if (!src || !tgt) { return null; }
              const color = link.link_type === "prerequisite" ? "#f59e0b"
                : link.link_type === "supports" ? "#34d399"
                : link.link_type === "contradicts" ? "#f87171"
                : "#64748b";
              const dx = tgt.x - src.x;
              const dy = tgt.y - src.y;
              const dr = Math.sqrt(dx * dx + dy * dy) * 1.2;
              return (
                <path
                  key={`xl-${link.id}`}
                  d={`M ${src.x} ${src.y} A ${dr} ${dr} 0 0 1 ${tgt.x} ${tgt.y}`}
                  fill="none"
                  stroke={color}
                  strokeOpacity={0.5}
                  strokeWidth={1}
                />
              );
            })}

          {/* Nodes — labeled rounded rectangles */}
          {layout.visibleNodes.map((d) => {
            const dim = dimsFor(d.data.hierarchy_level);
            const isChapter = d.data.hierarchy_level === "chapter";
            const isSection = d.data.hierarchy_level === "section";
            const isConcept = !isChapter && !isSection;
            const isSelected = d.data.id === selectedConceptId;
            const matchesFilter = !filter || d.data.name.toLowerCase().includes(filter);
            const opacity = matchesFilter ? 1 : 0.2;

            const typeColor = colorFor(d.data.concept_type);
            // Chapters/sections sit on the raised tier so they read as cards
            // lifted off the canvas; concepts stay on the plain surface tier so
            // the hierarchy is legible by elevation alone.
            const fillColor = isChapter || isSection ? "var(--surface-raised)" : "var(--surface)";
            // Neutral hairline, not a type tint. concept_type is uniformly
            // "topic" in practice, so tinting the border by type painted every
            // node the same accent color and flattened the whole canvas. Type is
            // carried by the dot below instead, where it can vary harmlessly.
            const borderColor = isSelected ? "var(--accent-color)" : "var(--surface-border)";
            const borderWidth = isSelected ? 2 : 1;
            // Child count is the one substantive per-node fact available on the
            // client (concept_description is empty for ~90% of rows), so it is
            // what the sub-label shows. Collapsed sections have their children
            // pruned into hiddenChildCount, so read both or the count vanishes
            // precisely when the node is collapsed.
            const childCount =
              (d.data.children?.length ?? 0) + (d.data.hiddenChildCount ?? 0);
            const metaLineHeight = 12;
            // Slightly tighter than the box would allow: text starts after the
            // dot inset, so the usable width is less than the full node width.
            const maxLen = isChapter ? 24 : isSection ? 19 : 16;
            const lines = wrapLabel(d.data.name, maxLen);
            const fontSize = isChapter ? 13.5 : isSection ? 12 : 11;
            const lineHeight = isChapter ? 17 : isSection ? 15 : 13;
            const fontWeight = isChapter ? "600" : isSection ? "550" : "500";
            // Left-anchored internal layout: dot, then label, then an optional
            // count line. Fixed insets mean nothing depends on measuring text.
            const padX = isChapter ? 14 : 11;
            const dotR = isChapter ? 3.5 : 3;
            const labelX = padX + dotR * 2 + 7;

            const sourceNode = nodes.find((n) => n.id === d.data.id) ?? null;

            // Section expansion affordance: pill hanging off the bottom of the
            // section box, showing chevron-down + count when collapsed, or
            // chevron-up when expanded. Sized large enough to be obvious on
            // first paint. Chapters that absorbed a redundant same-named
            // section carry the section's id as `collapseId` and get the same
            // affordance.
            const collapseKey = isSection ? d.data.id : d.data.collapseId;
            const isExpanded = collapseKey !== undefined && expandedSections.has(collapseKey);
            const hiddenCount = d.data.hiddenChildCount ?? 0;
            const showBadge = collapseKey !== undefined && (hiddenCount > 0 || isExpanded);
            // Chapters and sections carry a child-count line; leaf concepts have
            // no children to count. Note this must NOT be gated on !showBadge:
            // every chapter absorbs a same-named section and so inherits a
            // collapseId, which means such a gate silently excluded every node
            // the line was written for.
            const showMeta = !isConcept && childCount > 0;
            // Vertical origin of the text block. Sits above the collapse badge
            // when there is one so the two never overlap.
            const contentHeight =
              lines.length * lineHeight + (showMeta ? metaLineHeight : 0);
            const textTop = (dim.height - contentHeight) / 2 + lineHeight / 2;
            const badgeText = isExpanded ? "Hide" : `Show ${hiddenCount}`;
            const badgeHeight = 18;
            const badgeWidth = Math.max(50, badgeText.length * 6.2 + 22);
            // Right-aligned inside the card, on the count line's row, rather
            // than hanging off the bottom edge: with the label left-aligned, a
            // centred badge below would collide with the count line.
            const badgeX = dim.width - badgeWidth - padX;
            const badgeY = showMeta
              ? textTop + lines.length * lineHeight - badgeHeight / 2 - 1
              : dim.height - badgeHeight / 2;
            const chevronD = isExpanded
              ? "M -4 2 L 0 -2 L 4 2"
              : "M -4 -2 L 0 2 L 4 -2";

            return (
              <g
                key={d.data.id}
                transform={`translate(${d.x - dim.width / 2},${d.y - dim.height / 2})`}
                style={{ cursor: "pointer", opacity }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectConcept(sourceNode);
                }}
              >
                <title>{`${d.data.name} (${d.data.concept_type})${sourceNode?.created_at ? ` • Extracted ${formatTimestamp(sourceNode.created_at)}` : ""}`}</title>
                <rect
                  width={dim.width}
                  height={dim.height}
                  rx={isChapter ? 12 : 8}
                  fill={fillColor}
                  stroke={borderColor}
                  strokeWidth={borderWidth}
                  filter="url(#rg-card-shadow)"
                />
                {/* Type indicator, parked at a fixed inset. Left-anchored so it
                    never has to be positioned relative to measured text — SVG
                    has no cheap text metrics, and estimating label width put the
                    dot on top of the first letter for longer names. */}
                <circle
                  cx={padX + dotR}
                  cy={textTop}
                  r={dotR}
                  fill={getResolvedColor(typeColor)}
                  opacity={isSelected ? 1 : 0.8}
                />
                {/* Label block, left-aligned beside the dot. */}
                {lines.map((line, i) => (
                  <text
                    key={i}
                    x={labelX}
                    y={textTop + i * lineHeight}
                    dominantBaseline="middle"
                    fontSize={fontSize}
                    fontWeight={fontWeight}
                    fill="var(--text-primary)"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {line}
                  </text>
                ))}
                {showMeta && (
                  <text
                    x={labelX}
                    y={textTop + lines.length * lineHeight - 1}
                    dominantBaseline="middle"
                    fontSize={isChapter ? 10 : 9.5}
                    fontFamily='"JetBrains Mono", "Fira Code", Menlo, monospace'
                    fill="var(--text-muted)"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {childCount === 1 ? "1 node" : `${childCount} nodes`}
                  </text>
                )}
                {showBadge && (
                  <g
                    onClick={(event) => {
                      event.stopPropagation();
                      if (collapseKey !== undefined) { toggleSection(collapseKey); }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <rect
                      x={badgeX}
                      y={badgeY}
                      width={badgeWidth}
                      height={badgeHeight}
                      rx={badgeHeight / 2}
                      fill="var(--surface-hover)"
                      stroke="var(--surface-border)"
                      strokeWidth={1}
                    />
                    <g transform={`translate(${badgeX + 13},${badgeY + badgeHeight / 2})`}>
                      <path
                        d={chevronD}
                        fill="none"
                        stroke="var(--text-secondary)"
                        strokeWidth={1.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                    <text
                      x={badgeX + badgeWidth / 2 + 6}
                      y={badgeY + badgeHeight / 2 + 0.5}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={10}
                      fontFamily='"JetBrains Mono", "Fira Code", Menlo, monospace'
                      fill="var(--text-secondary)"
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {badgeText}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

const RoadmapGraph = memo(forwardRef<RoadmapGraphHandle, RoadmapGraphProps>(RoadmapGraphInner));
export default RoadmapGraph;
