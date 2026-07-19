/**
 * RoadmapGraph — hierarchical SVG roadmap renderer for the knowledge graph.
 * Renders chapters → sections → concepts as a top-down tree of labeled boxes
 * connected by dashed/curved paths. Supports zoom/pan and node selection.
 */
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import * as d3 from "d3";
import type { ConceptNode, ConceptLink } from "../lib/api";
import { buildForest, pruneCollapsedSections, type RoadmapNode } from "../lib/conceptTree";

const TYPE_COLORS: Record<string, string> = {
  person: "#60a5fa",
  place: "#34d399",
  event: "#f472b6",
  topic: "#a78bfa",
  object: "#fb923c",
  theory: "#facc15",
  technology: "#38bdf8",
  definition: "#f87171",
  question: "#fb923c",
  insight: "#4ade80",
  resource: "#94a3b8",
  custom: "#e879f9",
  other: "#94a3b8",
};

function colorFor(type: string) {
  return TYPE_COLORS[type.toLowerCase()] ?? TYPE_COLORS.other;
}

/** Gradient ids are keyed by the normalized type name so defs stay stable. */
function gradientIdFor(type: string): string {
  const key = type.toLowerCase();
  return `rg-grad-${TYPE_COLORS[key] ? key : "other"}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

interface BoxDims {
  width: number;
  height: number;
}

function dimsFor(level: string): BoxDims {
  if (level === "chapter") { return { width: 230, height: 64 }; }
  if (level === "section") { return { width: 180, height: 46 }; }
  return { width: 150, height: 36 };
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
}

export interface RoadmapGraphHandle {
  /**
   * Snapshot the current SVG for export. Clones the live `<svg>`, applies the
   * laid-out bbox as `width`/`height`/`viewBox` so the markup renders
   * standalone, and serializes to a string. Returns `null` when no layout has
   * been computed yet (e.g., empty roadmap).
   */
  getExportableSvg: () => { svg: string; width: number; height: number } | null;
}

function RoadmapGraphInner(
  {
    nodes,
    links,
    selectedConceptId,
    onSelectConcept,
    searchFilter,
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
    // Chapter boxes are 230 wide; add a 40px gutter so siblings cannot overlap.
    const treeLayout = d3.tree<RoadmapNode>().nodeSize([270, 120]);

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

  // Auto-fit when layout or dims change
  useEffect(() => {
    if (!layout || !svgRef.current || dims.width === 0 || dims.height === 0) { return; }

    const w = layout.bbox.maxX - layout.bbox.minX;
    const h = layout.bbox.maxY - layout.bbox.minY;
    if (w === 0 || h === 0) { return; }

    const fitScale = Math.min(dims.width / w, dims.height / h);
    const scale = Math.min(Math.max(fitScale, 0.6), 1.5);
    const tx = dims.width / 2 - ((layout.bbox.minX + layout.bbox.maxX) / 2) * scale;
    // Center vertically when the map fits; otherwise pin the top edge in view.
    const contentHeight = h * scale;
    const ty = contentHeight <= dims.height
      ? (dims.height - contentHeight) / 2 - layout.bbox.minY * scale
      : -layout.bbox.minY * scale;

    const newTransform = d3.zoomIdentity.translate(tx, ty).scale(scale);

    // Sync d3.zoom's internal state first, then update React state via
    // requestAnimationFrame to avoid a synchronous setState inside an effect.
    if (zoomRef.current) {
      d3.select(svgRef.current).call(zoomRef.current.transform, newTransform);
    }
    requestAnimationFrame(() => setTransform(newTransform));
  }, [layout, dims]);

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
    }),
    [layout],
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
          <filter id="rg-card-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#0f172a" floodOpacity="0.3" />
          </filter>
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <linearGradient key={type} id={`rg-grad-${type}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={hexToRgba(color, 0.26)} />
              <stop offset="100%" stopColor={hexToRgba(color, 0.07)} />
            </linearGradient>
          ))}
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
            const isSelected = d.data.id === selectedConceptId;
            const matchesFilter = !filter || d.data.name.toLowerCase().includes(filter);
            const opacity = matchesFilter ? 1 : 0.2;

            const typeColor = colorFor(d.data.concept_type);
            const fillColor = isChapter || isSection ? "var(--bg-elevated)" : "var(--bg-primary)";
            const borderColor = isSelected
              ? "var(--accent-color)"
              : hexToRgba(typeColor, isChapter ? 0.6 : isSection ? 0.45 : 0.3);
            const borderWidth = isSelected ? 2.5 : isChapter ? 1.5 : 1.25;
            const maxLen = isChapter ? 26 : isSection ? 21 : 18;
            const lines = wrapLabel(d.data.name, maxLen);
            const fontSize = isChapter ? 13.5 : isSection ? 12 : 11;
            const lineHeight = isChapter ? 17 : isSection ? 15 : 13;
            const fontWeight = isChapter ? 700 : isSection ? 600 : 500;
            const tintOpacity = isChapter ? 1 : isSection ? 0.8 : 0.45;

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
            const badgeText = isExpanded ? "Hide" : `Show ${hiddenCount}`;
            const badgeHeight = 20;
            const badgeWidth = Math.max(56, badgeText.length * 6.2 + 24);
            const badgeX = (dim.width - badgeWidth) / 2;
            const badgeY = dim.height - badgeHeight / 2;
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
                <rect
                  width={dim.width}
                  height={dim.height}
                  rx={isChapter ? 14 : 10}
                  fill={fillColor}
                  filter="url(#rg-card-shadow)"
                />
                <rect
                  width={dim.width}
                  height={dim.height}
                  rx={isChapter ? 14 : 10}
                  fill={`url(#${gradientIdFor(d.data.concept_type)})`}
                  opacity={tintOpacity}
                  stroke={borderColor}
                  strokeWidth={borderWidth}
                />
                {lines.map((line, i) => (
                  <text
                    key={i}
                    x={dim.width / 2}
                    y={dim.height / 2 + (i - (lines.length - 1) / 2) * lineHeight}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={fontSize}
                    fontWeight={fontWeight}
                    fill="var(--text-primary)"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {line}
                  </text>
                ))}
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
                      fill="var(--bg-elevated)"
                      stroke={hexToRgba(typeColor, 0.65)}
                      strokeWidth={1.25}
                      filter="url(#rg-card-shadow)"
                    />
                    <g transform={`translate(${badgeX + 13},${badgeY + badgeHeight / 2})`}>
                      <path
                        d={chevronD}
                        fill="none"
                        stroke={typeColor}
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                    <text
                      x={badgeX + badgeWidth / 2 + 6}
                      y={badgeY + badgeHeight / 2 + 0.5}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={10.5}
                      fontWeight={600}
                      fill="var(--text-primary)"
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
