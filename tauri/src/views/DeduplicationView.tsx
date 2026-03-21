/**
 * DeduplicationView — find and merge duplicate/similar concept nodes.
 * Mirrors DeduplicationView.swift: shows candidate pairs, lets user merge or dismiss.
 */
import { useEffect, useState } from "react";
import { GitMerge, X, Check, Search, RefreshCw, Network } from "lucide-react";
import { api, type ConceptNode } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface DuplicatePair {
  a: ConceptNode;
  b: ConceptNode;
  score: number; // name similarity 0-1
  dismissed: boolean;
}

function nameSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) {return 1;}
  if (na.includes(nb) || nb.includes(na)) {return 0.85;}
  // Levenshtein-inspired: count common chars
  const la = na.split("");
  let common = 0;
  for (const c of la) {
    const idx = nb.indexOf(c);
    if (idx !== -1) { common++; }
  }
  return common / Math.max(na.length, nb.length, 1);
}

export default function DeduplicationView() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [concepts, setConcepts] = useState<ConceptNode[]>([]);
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [threshold, setThreshold] = useState(0.75);
  const [merging, setMerging] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function scan() {
    if (!activeWorkspaceId) {return;}
    setLoading(true);
    try {
      const all = await api.graph.listConcepts(activeWorkspaceId);
      setConcepts(all);
      const found: DuplicatePair[] = [];
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const score = nameSimilarity(all[i].name, all[j].name);
          if (score >= threshold) {
            found.push({ a: all[i], b: all[j], score, dismissed: false });
          }
        }
      }
      found.sort((a, b) => b.score - a.score);
      setPairs(found);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (activeWorkspaceId) {scan();}
  }, [activeWorkspaceId]);

  function dismiss(idx: number) {
    setPairs((prev) => prev.map((p, i) => i === idx ? { ...p, dismissed: true } : p));
  }

  async function merge(pair: DuplicatePair, keepIdx: number) {
    // Keep concept A or B; delete the other; update links
    const keep = keepIdx === 0 ? pair.a : pair.b;
    const remove = keepIdx === 0 ? pair.b : pair.a;

    setMerging(pair.a.id + pair.b.id);
    try {
      // Update the kept concept to include aliases from both
      const mergedAliases = [...new Set([...(keep.aliases ?? []), ...(remove.aliases ?? []), remove.name])];
      await api.graph.updateConcept(keep.id, { aliases: mergedAliases });
      // Delete the duplicate
      await api.graph.deleteConcept(remove.id);
      // Update local state
      setConcepts((prev) => prev.filter((c) => c.id !== remove.id));
      setPairs((prev) => prev.filter((p) => p.a.id !== pair.a.id || p.b.id !== pair.b.id));
    } finally {
      setMerging(null);
    }
  }

  const activePairs = pairs.filter((p) => !p.dismissed);
  const filteredPairs = activePairs.filter(
    (p) =>
      !query ||
      p.a.name.toLowerCase().includes(query.toLowerCase()) ||
      p.b.name.toLowerCase().includes(query.toLowerCase())
  );

  function pct(score: number) { return `${Math.round(score * 100)}%`; }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">Concept Deduplication</h1>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            {concepts.length} concepts · {activePairs.length} duplicate candidate{activePairs.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={scan}
          disabled={loading || !activeWorkspaceId}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40"
        >
          {loading ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {loading ? "Scanning…" : "Re-scan"}
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border-color)] shrink-0">
        <div className="flex items-center gap-1.5 bg-[var(--bg-elevated)] rounded-lg px-3 py-1.5 flex-1">
          <Search size={12} className="text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by concept name…"
            className="flex-1 text-xs bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span>Min similarity:</span>
          <input
            type="range" min={0.5} max={0.99} step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-24 accent-[var(--accent-color)]"
          />
          <span className="w-10 text-right text-[var(--text-muted)]">{pct(threshold)}</span>
          <button
            onClick={scan}
            className="px-2 py-1 text-[11px] rounded bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] border border-[var(--border-color)]"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Pairs list */}
      <div className="flex-1 overflow-y-auto">
        {!activeWorkspaceId ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] gap-2">
            <Network size={32} className="opacity-30" />
            <p className="text-sm">Select a workspace to scan for duplicates.</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] gap-2">
            <RefreshCw size={16} className="animate-spin" />
            <span className="text-sm">Scanning concepts…</span>
          </div>
        ) : filteredPairs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] gap-2">
            <Check size={32} className="opacity-30 text-green-400" />
            <p className="text-sm">
              {activePairs.length === 0
                ? "No duplicates found at this threshold."
                : "No matches for your filter."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-color)]">
            {filteredPairs.map((pair, idx) => {
              const isMerging = merging === pair.a.id + pair.b.id;
              return (
                <div key={`${pair.a.id}-${pair.b.id}`} className="px-5 py-4">
                  {/* Similarity badge */}
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full font-mono"
                      style={{
                        background: pair.score >= 0.95 ? "rgba(239,68,68,0.15)" : pair.score >= 0.85 ? "rgba(251,146,60,0.15)" : "rgba(59,130,246,0.15)",
                        color: pair.score >= 0.95 ? "#ef4444" : pair.score >= 0.85 ? "#fb923c" : "#3b82f6",
                      }}
                    >
                      {pct(pair.score)} similar
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">Choose which to keep, or dismiss</span>
                    <button
                      onClick={() => dismiss(idx)}
                      className="ml-auto p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      title="Dismiss (not a duplicate)"
                    >
                      <X size={13} />
                    </button>
                  </div>

                  {/* Two concept cards */}
                  <div className="grid grid-cols-2 gap-3">
                    {[pair.a, pair.b].map((concept, ci) => (
                      <div key={concept.id} className="bg-[var(--bg-elevated)] rounded-xl p-3 border border-[var(--border-color)]">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="font-medium text-xs text-[var(--text-primary)] truncate">{concept.name}</div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)] capitalize shrink-0">
                            {concept.concept_type}
                          </span>
                        </div>
                        {concept.concept_description && (
                          <p className="text-[11px] text-[var(--text-secondary)] line-clamp-2 mb-2">
                            {concept.concept_description}
                          </p>
                        )}
                        {concept.aliases?.length > 0 && (
                          <p className="text-[10px] text-[var(--text-muted)]">
                            Aliases: {concept.aliases.join(", ")}
                          </p>
                        )}
                        <button
                          onClick={() => merge(pair, ci)}
                          disabled={!!isMerging}
                          className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] rounded-lg bg-[var(--accent-color)]/15 text-[var(--accent-color)] hover:bg-[var(--accent-color)]/25 disabled:opacity-40 transition-colors"
                        >
                          {isMerging ? (
                            <RefreshCw size={11} className="animate-spin" />
                          ) : (
                            <GitMerge size={11} />
                          )}
                          Keep this one
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
