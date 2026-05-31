/**
 * RoadmapGraph — hierarchical SVG roadmap renderer for the knowledge graph.
 * Renders chapters → sections → concepts as a top-down tree of labeled boxes
 * connected by dashed/curved paths. Supports zoom/pan and node selection.
 */
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import * as d3 from "d3";
import type { ConceptNode, ConceptLink } from "../lib/api";
import { buildForest, type RoadmapNode } from "../lib/conceptTree";

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

interface BoxDims {
  width: number;
  height: number;
}

function dimsFor(level: string): BoxDims {
  if (level === "chapter") { return { width: 180, height: 50 }; }
  if (level === "section") { return { width: 150, height: 38 }; }
  return { width: 130, height: 30 };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
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

  // Compute layout via d3.tree() — top-down (root at top, children below)
  const layout = useMemo(() => {
    if (nodes.length === 0) { return null; }

    const forest = buildForest(nodes, links);
    const root = d3.hierarchy<RoadmapNode>(forest);

    // node size: [horizontal between siblings, vertical between levels]
    const treeLayout = d3.tree<RoadmapNode>().nodeSize([160, 110]);
    treeLayout(root);

    // Drop the synthetic root from visible output, but keep its children's positions
    type PositionedNode = d3.HierarchyPointNode<RoadmapNode>;
    const visibleNodes: PositionedNode[] = root
      .descendants()
      .filter((d) => d.data.id !== "__root__") as PositionedNode[];

    // Collect bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    visibleNodes.forEach((d) => {
      const dim = dimsFor(d.data.hierarchy_level);
      const left = d.x - dim.width / 2;
      const right = d.x + dim.width / 2;
      const top = d.y - dim.height / 2;
      const bottom = d.y + dim.height / 2;
      if (left < minX) { minX = left; }
      if (right > maxX) { maxX = right; }
      if (top < minY) { minY = top; }
      if (bottom > maxY) { maxY = bottom; }
    });

    const padding = 40;
    const bbox = {
      minX: minX - padding,
      maxX: maxX + padding,
      minY: minY - padding,
      maxY: maxY + padding,
    };

    // hierarchy links — excluding edges to synthetic root
    type PositionedLink = d3.HierarchyPointLink<RoadmapNode>;
    const hierarchyLinks: PositionedLink[] = (root.links() as PositionedLink[]).filter(
      (l) => l.source.data.id !== "__root__",
    );

    return { visibleNodes, hierarchyLinks, bbox };
  }, [nodes, links]);

  // Auto-fit when layout or dims change
  useEffect(() => {
    if (!layout || !svgRef.current || dims.width === 0 || dims.height === 0) { return; }

    const w = layout.bbox.maxX - layout.bbox.minX;
    const h = layout.bbox.maxY - layout.bbox.minY;
    if (w === 0 || h === 0) { return; }

    const fitScale = Math.min(dims.width / w, dims.height / h);
    const scale = Math.min(Math.max(fitScale, 0.6), 1.5);
    const tx = dims.width / 2 - ((layout.bbox.minX + layout.bbox.maxX) / 2) * scale;
    const ty = -layout.bbox.minY * scale + 40;

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
        </defs>

        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
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
                stroke="rgba(148,163,184,0.55)"
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

            const fillColor = isChapter || isSection ? "var(--bg-elevated)" : "var(--bg-primary)";
            const borderColor = isSelected
              ? "var(--accent-color)"
              : isChapter
                ? "var(--accent-color)"
                : "var(--border-color)";
            const borderWidth = isSelected ? 2.5 : isChapter ? 2 : 1;
            const maxLen = isChapter ? 22 : isSection ? 20 : 18;
            const label = truncate(d.data.name, maxLen);
            const fontSize = isChapter ? 14 : isSection ? 12 : 11;
            const fontWeight = isChapter ? 700 : isSection ? 600 : 500;
            const typeColor = colorFor(d.data.concept_type);

            const sourceNode = nodes.find((n) => n.id === d.data.id) ?? null;

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
                  rx={isChapter ? 10 : 8}
                  fill={fillColor}
                  stroke={borderColor}
                  strokeWidth={borderWidth}
                />
                <rect
                  x={0}
                  y={0}
                  width={4}
                  height={dim.height}
                  rx={2}
                  fill={typeColor}
                />
                <text
                  x={dim.width / 2}
                  y={dim.height / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={fontSize}
                  fontWeight={fontWeight}
                  fill="var(--text-primary)"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {label}
                </text>
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
