/**
 * LearningHubSidebar — collapsible Chapter → Section → Concept tree shared by
 * the three Learning hub tabs. Selecting a concept lifts `selectedConceptId`
 * into `LearningHubView`, which then passes it down to each pane so the
 * Roadmap focuses on it, the Review tab filters cards to it, and the Goals
 * tab can later use it for goal scoping.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { api, type ConceptNode, type ConceptLink } from "../lib/api";
import { buildForest, type RoadmapNode } from "../lib/conceptTree";

interface Props {
  workspaceId: string | null;
  selectedConceptId: string | null;
  onSelect: (id: string | null) => void;
  /** Bumped by the parent whenever an action elsewhere (e.g. card generation)
   * may have introduced new concepts. Triggers a refetch. */
  refreshKey?: number;
}

function levelIndent(level: string): string {
  if (level === "chapter") {return "pl-2";}
  if (level === "section") {return "pl-5";}
  return "pl-8";
}

function levelStyle(level: string): string {
  if (level === "chapter") {return "font-semibold text-[var(--text-primary)]";}
  if (level === "section") {return "text-[var(--text-secondary)]";}
  return "text-[var(--text-muted)]";
}

interface RowProps {
  node: RoadmapNode;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: string;
}

function matchesFilter(node: RoadmapNode, filter: string): boolean {
  if (!filter) {return true;}
  const needle = filter.toLowerCase();
  if (node.name.toLowerCase().includes(needle)) {return true;}
  return (node.children ?? []).some((c) => matchesFilter(c, needle));
}

function TreeRow({ node, depth, expanded, toggle, selectedId, onSelect, filter }: RowProps) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isOpen = expanded.has(node.id) || filter.length > 0;
  const isActive = selectedId === node.id;

  if (!matchesFilter(node, filter)) {return null;}

  return (
    <>
      <div
        className={`group flex items-center gap-1 py-1 text-sm cursor-pointer rounded ${levelIndent(node.hierarchy_level)} ${
          isActive
            ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
            : `hover:bg-[var(--bg-hover)] ${levelStyle(node.hierarchy_level)}`
        }`}
        style={{ marginLeft: `${depth * 4}px` }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); toggle(node.id); }}
            className="shrink-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-[18px] shrink-0" />
        )}
        <button
          onClick={() => onSelect(node.id)}
          className="flex-1 min-w-0 truncate text-left"
          title={node.name}
        >
          {node.name}
        </button>
      </div>
      {isOpen && hasChildren && (node.children ?? []).map((child) => (
        <TreeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          toggle={toggle}
          selectedId={selectedId}
          onSelect={onSelect}
          filter={filter}
        />
      ))}
    </>
  );
}

export default function LearningHubSidebar({ workspaceId, selectedConceptId, onSelect, refreshKey = 0 }: Props) {
  const [nodes, setNodes] = useState<ConceptNode[]>([]);
  const [links, setLinks] = useState<ConceptLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!workspaceId) {return;}
    let cancelled = false;
    // Defer the loading flip out of the effect body so we satisfy the
    // react-hooks/set-state-in-effect rule. Microtask scheduling is cheap and
    // the small race (no spinner for one tick) is acceptable.
    void Promise.resolve().then(() => {
      if (!cancelled) {setLoading(true);}
    });
    Promise.all([
      api.graph.listConcepts(workspaceId, undefined, undefined, { includeDescendants: true }),
      api.graph.listLinks(workspaceId, undefined, undefined, { includeDescendants: true }),
    ])
      .then(([n, l]) => {
        if (cancelled) {return;}
        setNodes(n);
        setLinks(l);
      })
      .catch(() => {
        if (!cancelled) {
          setNodes([]);
          setLinks([]);
        }
      })
      .finally(() => {
        if (!cancelled) {setLoading(false);}
      });
    return () => { cancelled = true; };
  }, [workspaceId, refreshKey]);

  // When there is no active workspace, render an empty forest without touching
  // the fetched-data state; the next fetch will replace it cleanly.
  const forest = useMemo(
    () => buildForest(workspaceId ? nodes : [], workspaceId ? links : []),
    [workspaceId, nodes, links],
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {next.delete(id);} else {next.add(id);}
      return next;
    });
  }

  const roots = forest.children ?? [];

  return (
    <aside className="w-64 shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--border-color)]">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Concepts</h2>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="w-full pl-7 pr-2 py-1 text-xs rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-color)]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        <button
          onClick={() => onSelect(null)}
          className={`w-full text-left text-xs px-2 py-1 rounded mb-2 ${
            selectedConceptId === null
              ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)] font-medium"
              : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
          }`}
        >
          All concepts
        </button>
        {loading && roots.length === 0 && (
          <div className="text-xs text-[var(--text-muted)] px-2 py-4">Loading…</div>
        )}
        {!loading && roots.length === 0 && (
          <div className="text-xs text-[var(--text-muted)] px-2 py-4">
            No concepts yet. They appear as you chat and topics are detected.
          </div>
        )}
        {roots.map((node) => (
          <TreeRow
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            toggle={toggle}
            selectedId={selectedConceptId}
            onSelect={onSelect}
            filter={filter}
          />
        ))}
      </div>
    </aside>
  );
}
