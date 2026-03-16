/**
 * KnowledgeGraphView — D3 force-directed graph of concept nodes and links.
 * Supports node dragging, zoom/pan, node detail panel, concept creation.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { Plus, Search, Info, X, Trash2, Link, ZoomIn, ZoomOut } from "lucide-react";
import { api, type ConceptNode, type ConceptLink } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  concept_type: string;
  x: number;
  y: number;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  id: string;
  link_type: string;
  strength: number;
  source: D3Node | string;
  target: D3Node | string;
}

const TYPE_COLORS: Record<string, string> = {
  Person:      "#60a5fa",
  Place:       "#34d399",
  Event:       "#f472b6",
  Concept:     "#a78bfa",
  Object:      "#fb923c",
  Theory:      "#facc15",
  Technology:  "#38bdf8",
  Other:       "#94a3b8",
};

export default function KnowledgeGraphView() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes] = useState<ConceptNode[]>([]);
  const [links, setLinks] = useState<ConceptLink[]>([]);
  const [selected, setSelected] = useState<ConceptNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newConceptName, setNewConceptName] = useState("");
  const [newConceptType, setNewConceptType] = useState("Concept");
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const filteredNodes = searchQuery
    ? nodes.filter((n) => n.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : nodes;

  async function loadGraph() {
    if (!activeWorkspaceId) return;
    const [ns, ls] = await Promise.all([
      api.graph.listConcepts(activeWorkspaceId),
      api.graph.listLinks(activeWorkspaceId),
    ]);
    setNodes(ns);
    setLinks(ls);
  }

  useEffect(() => { loadGraph(); }, [activeWorkspaceId]);

  // D3 simulation
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const { width, height } = containerRef.current.getBoundingClientRect();
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g").attr("class", "graph-container");

    // Zoom + pan
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);
    zoomRef.current = zoom;

    const d3Nodes: D3Node[] = filteredNodes.map((n) => ({
      ...n, x: n.x_position || Math.random() * width, y: n.y_position || Math.random() * height,
    }));

    const nodeById = new Map(d3Nodes.map((n) => [n.id, n]));
    const d3Links: D3Link[] = links
      .filter((l) => nodeById.has(l.source_id) && nodeById.has(l.target_id))
      .map((l) => ({
        id: l.id, link_type: l.link_type, strength: l.strength,
        source: l.source_id, target: l.target_id,
      }));

    const sim = d3.forceSimulation<D3Node>(d3Nodes)
      .force("link", d3.forceLink<D3Node, D3Link>(d3Links).id((d) => d.id).distance(120))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(30));

    // Edges
    const link = g.append("g").selectAll<SVGLineElement, D3Link>("line")
      .data(d3Links).join("line")
      .attr("stroke", "#475569").attr("stroke-opacity", 0.6)
      .attr("stroke-width", (d) => Math.max(1, d.strength * 2));

    // Link labels
    const linkLabel = g.append("g").selectAll<SVGTextElement, D3Link>("text")
      .data(d3Links).join("text")
      .text((d) => d.link_type)
      .attr("fill", "#64748b")
      .attr("font-size", "10px")
      .attr("text-anchor", "middle");

    // Node groups
    const node = g.append("g").selectAll<SVGGElement, D3Node>("g")
      .data(d3Nodes).join("g")
      .attr("cursor", "pointer")
      .on("click", (_, d) => {
        setSelected(nodes.find((n) => n.id === d.id) ?? null);
      })
      .call(
        d3.drag<SVGGElement, D3Node>()
          .on("start", (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on("end", (event, d) => {
            if (!event.active) sim.alphaTarget(0);
            d.fx = null; d.fy = null;
          })
      );

    node.append("circle")
      .attr("r", 18)
      .attr("fill", (d) => (TYPE_COLORS[d.concept_type] ?? TYPE_COLORS.Other) + "33")
      .attr("stroke", (d) => TYPE_COLORS[d.concept_type] ?? TYPE_COLORS.Other)
      .attr("stroke-width", 1.5);

    node.append("text")
      .text((d) => d.name.slice(0, 14) + (d.name.length > 14 ? "…" : ""))
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("fill", "#e2e8f0")
      .attr("font-size", "11px")
      .attr("pointer-events", "none");

    // Hover tooltip circle expand
    node.on("mouseover", function () {
      d3.select(this).select("circle").attr("r", 22);
    }).on("mouseout", function () {
      d3.select(this).select("circle").attr("r", 18);
    });

    sim.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as D3Node).x)
        .attr("y1", (d) => (d.source as D3Node).y)
        .attr("x2", (d) => (d.target as D3Node).x)
        .attr("y2", (d) => (d.target as D3Node).y);

      linkLabel
        .attr("x", (d) => ((d.source as D3Node).x + (d.target as D3Node).x) / 2)
        .attr("y", (d) => ((d.source as D3Node).y + (d.target as D3Node).y) / 2);

      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    return () => { sim.stop(); };
  }, [filteredNodes, links]);

  async function createConcept() {
    if (!newConceptName.trim() || !activeWorkspaceId) return;
    const concept = await api.graph.createConcept(activeWorkspaceId, newConceptName.trim(), {
      concept_type: newConceptType,
    } as any);
    setNodes((prev) => [...prev, concept]);
    setNewConceptName("");
    setShowCreateForm(false);
  }

  async function deleteConcept(id: string) {
    await api.graph.deleteConcept(id);
    setNodes((p) => p.filter((n) => n.id !== id));
    setLinks((p) => p.filter((l) => l.source_id !== id && l.target_id !== id));
    setSelected(null);
  }

  function zoomIn() {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().call(zoomRef.current.scaleBy, 1.4);
  }
  function zoomOut() {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().call(zoomRef.current.scaleBy, 1 / 1.4);
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main graph */}
      <div className="flex-1 relative" ref={containerRef}>
        {/* Toolbar */}
        <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter concepts…"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--bg-elevated)]/90 border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none backdrop-blur"
            />
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90"
          >
            <Plus size={13} /> Concept
          </button>
          <button onClick={zoomIn} className="p-1.5 rounded-lg bg-[var(--bg-elevated)]/90 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] backdrop-blur">
            <ZoomIn size={14} />
          </button>
          <button onClick={zoomOut} className="p-1.5 rounded-lg bg-[var(--bg-elevated)]/90 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] backdrop-blur">
            <ZoomOut size={14} />
          </button>
          <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-elevated)]/80 px-2 py-1 rounded backdrop-blur">
            {filteredNodes.length} concepts, {links.length} links
          </span>
        </div>

        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-[var(--text-muted)] text-sm">
              {activeWorkspaceId ? "No concepts yet — create one to begin" : "Select a workspace first"}
            </p>
          </div>
        )}

        <svg ref={svgRef} className="w-full h-full bg-[var(--bg-primary)]" />

        {/* Create form overlay */}
        {showCreateForm && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-20 backdrop-blur-sm">
            <div className="w-72 bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-color)] p-5 shadow-xl flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">New Concept</h3>
                <button onClick={() => setShowCreateForm(false)}>
                  <X size={14} className="text-[var(--text-muted)]" />
                </button>
              </div>
              <input
                autoFocus
                value={newConceptName}
                onChange={(e) => setNewConceptName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createConcept(); if (e.key === "Escape") setShowCreateForm(false); }}
                placeholder="Concept name"
                className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
              />
              <select
                value={newConceptType}
                onChange={(e) => setNewConceptType(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-secondary)] outline-none"
              >
                {Object.keys(TYPE_COLORS).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button
                onClick={createConcept}
                className="py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm hover:opacity-90"
              >
                Create
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-64 border-l border-[var(--border-color)] bg-[var(--bg-sidebar)] flex flex-col overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">{selected.name}</h2>
            <button onClick={() => setSelected(null)}>
              <X size={14} className="text-[var(--text-muted)]" />
            </button>
          </div>
          <div className="px-4 py-3 space-y-3 text-xs text-[var(--text-secondary)]">
            <div>
              <span className="text-[var(--text-muted)]">Type</span>
              <p
                className="mt-0.5 font-medium"
                style={{ color: TYPE_COLORS[selected.concept_type] ?? TYPE_COLORS.Other }}
              >
                {selected.concept_type}
              </p>
            </div>
            {selected.concept_description && (
              <div>
                <span className="text-[var(--text-muted)]">Description</span>
                <p className="mt-0.5">{selected.concept_description}</p>
              </div>
            )}
            {selected.tags?.length > 0 && (
              <div>
                <span className="text-[var(--text-muted)]">Tags</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selected.tags.map((t) => (
                    <span key={t} className="px-1.5 py-0.5 bg-[var(--bg-hover)] rounded text-[10px]">{t}</span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <span className="text-[var(--text-muted)]">Review count</span>
              <p className="mt-0.5">{selected.review_count}</p>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Created</span>
              <p className="mt-0.5">{new Date(selected.created_at).toLocaleDateString()}</p>
            </div>
          </div>
          <div className="px-4 pb-4 mt-auto">
            <button
              onClick={() => deleteConcept(selected.id)}
              className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
            >
              <Trash2 size={12} /> Delete concept
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
