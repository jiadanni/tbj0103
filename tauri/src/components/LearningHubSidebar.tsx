/**
 * LearningHubSidebar — collapsible Chapter → Section → Concept tree shared by
 * the three Learning hub tabs. Selecting a concept lifts `selectedConceptId`
 * into `LearningHubView`, which then passes it down to each pane so the
 * Roadmap focuses on it, the Review tab filters cards to it, and the Goals
 * tab can later use it for goal scoping.
 */
import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
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
  onContextMenu: (e: ReactMouseEvent, node: RoadmapNode) => void;
}

function matchesFilter(node: RoadmapNode, filter: string): boolean {
  if (!filter) {return true;}
  const needle = filter.toLowerCase();
  if (node.name.toLowerCase().includes(needle)) {return true;}
  return (node.children ?? []).some((c) => matchesFilter(c, needle));
}

function TreeRow({ node, depth, expanded, toggle, selectedId, onSelect, filter, onContextMenu }: RowProps) {
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
        onContextMenu={(e) => onContextMenu(e, node)}
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
          onContextMenu={onContextMenu}
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
  const [menu, setMenu] = useState<{ x: number; y: number; node: RoadmapNode } | null>(null);
  const [parentPicker, setParentPicker] = useState<RoadmapNode | null>(null);
  const [parentFilter, setParentFilter] = useState("");
  const [localRefresh, setLocalRefresh] = useState(0);

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
  }, [workspaceId, refreshKey, localRefresh]);
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

  function openContextMenu(e: ReactMouseEvent, node: RoadmapNode) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, node });
  }

  function closeMenu() {
    setMenu(null);
  }

  async function applyParent(parentId: string | null) {
    if (!parentPicker) {return;}
    try {
      await api.graph.setConceptParent(parentPicker.id, parentId);
      setParentPicker(null);
      setParentFilter("");
      setLocalRefresh((n) => n + 1);
    } catch {
      // Swallow — the next refresh will reflect the actual state. Surfacing
      // this would need a toast system; the sidebar deliberately stays
      // chrome-free.
    }
  }

  useEffect(() => {
    if (!menu) {return;}
    const handler = () => closeMenu();
    window.addEventListener("click", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("click", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [menu]);

  const roots = forest.children ?? [];

  // Flat list of all concepts for the parent picker — excludes the target
  // concept itself and any of its descendants (preventing trivial cycles).
  function descendantsOf(id: string): Set<string> {
    const childOf = new Map<string, string[]>();
    links.forEach((link) => {
      if (link.link_type === "part_of") {
        const arr = childOf.get(link.target_id) ?? [];
        arr.push(link.source_id);
        childOf.set(link.target_id, arr);
      }
    });
    const visited = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const next = stack.pop();
      if (!next || visited.has(next)) {continue;}
      visited.add(next);
      for (const c of childOf.get(next) ?? []) {stack.push(c);}
    }
    return visited;
  }
  const parentOptions = parentPicker
    ? (() => {
        const blocked = descendantsOf(parentPicker.id);
        const needle = parentFilter.trim().toLowerCase();
        return nodes
          .filter((n) => !blocked.has(n.id))
          .filter((n) => !needle || n.name.toLowerCase().includes(needle))
          .slice(0, 100);
      })()
    : [];

  return (
    <aside className="w-64 shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--border-color)]">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Topics</h2>
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
          All topics
        </button>
        {loading && roots.length === 0 && (
          <div className="text-xs text-[var(--text-muted)] px-2 py-4">Loading…</div>
        )}
        {!loading && roots.length === 0 && (
          <div className="text-xs text-[var(--text-muted)] px-2 py-4">
            No topics yet. They appear as you chat and topics are detected.
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
            onContextMenu={openContextMenu}
          />
        ))}
      </div>

      {menu && (
        <div
          role="menu"
          className="fixed z-50 min-w-[160px] rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 text-sm shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="block w-full px-3 py-1.5 text-left hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
            onClick={() => {
              setParentPicker(menu.node);
              setParentFilter("");
              closeMenu();
            }}
          >
            Set parent…
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
            onClick={() => {
              const target = menu.node;
              closeMenu();
              void api.graph
                .setConceptParent(target.id, null)
                .then(() => setLocalRefresh((n) => n + 1))
                .catch(() => undefined);
            }}
          >
            Clear parent
          </button>
        </div>
      )}

      {parentPicker && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
          onClick={() => setParentPicker(null)}
        >
          <div
            className="w-[360px] max-h-[60vh] flex flex-col rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-[var(--border-color)]">
              <div className="text-xs text-[var(--text-muted)]">
                Set parent for
              </div>
              <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                {parentPicker.name}
              </div>
              <input
                autoFocus
                value={parentFilter}
                onChange={(e) => setParentFilter(e.target.value)}
                placeholder="Search concepts…"
                className="mt-2 w-full px-2 py-1 text-xs rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-color)]"
              />
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {parentOptions.length === 0 && (
                <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
                  No eligible concepts.
                </div>
              )}
              {parentOptions.map((opt) => (
                <button
                  key={opt.id}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
                  onClick={() => { void applyParent(opt.id); }}
                >
                  {opt.name}
                </button>
              ))}
            </div>
            <div className="px-3 py-2 border-t border-[var(--border-color)] flex justify-between">
              <button
                onClick={() => { void applyParent(null); }}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Clear parent
              </button>
              <button
                onClick={() => setParentPicker(null)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
