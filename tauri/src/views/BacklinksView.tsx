/**
 * BacklinksView — shows all notes that contain [[wiki-links]] pointing to
 * concepts in the active project's workspace.
 */
import { useState, useEffect, useCallback } from "react";
import { Link2, Search, ArrowLeft, Loader2, Hash } from "lucide-react";
import { api, BacklinkEntry, ProjectNote } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface BacklinkGroup {
  conceptName: string;
  entries: BacklinkEntry[];
}

export default function BacklinksView() {
  const { activeWorkspaceId } = useWorkspaceStore();

  const [conceptSearch, setConceptSearch] = useState("");
  const [groups, setGroups] = useState<BacklinkGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedConcept, setSelectedConcept] = useState<string | null>(null);
  const [sourceNote, setSourceNote] = useState<ProjectNote | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);

  // Load concepts across this workspace that have mentions
  const loadBacklinks = useCallback(async () => {
    if (!activeWorkspaceId) {return;}
    setLoading(true);
    try {
      // Get concept nodes for this workspace, filter by search
      const concepts = await api.graph.listConcepts(activeWorkspaceId);
      const filtered = conceptSearch
        ? concepts.filter((c: { name: string }) =>
            c.name.toLowerCase().includes(conceptSearch.toLowerCase())
          )
        : concepts;

      const results: BacklinkGroup[] = [];
      for (const c of filtered.slice(0, 50)) {
        const entries = await api.note.getBacklinks(activeWorkspaceId, c.name);
        if (entries.length > 0) {
          results.push({ conceptName: c.name, entries });
        }
      }
      setGroups(results);
    } catch (err) {
      console.error("Failed to load backlinks:", err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, conceptSearch]);

  useEffect(() => {
    loadBacklinks();
  }, [loadBacklinks]);

  const openSource = async (entry: BacklinkEntry) => {
    if (entry.source_type !== "note") {return;}
    setNoteLoading(true);
    setSelectedConcept(entry.concept_name);
    try {
      const note = await api.note.get(entry.source_id);
      setSourceNote(note);
    } catch {
      setSourceNote(null);
    } finally {
      setNoteLoading(false);
    }
  };

  const clearNote = () => {
    setSourceNote(null);
    setSelectedConcept(null);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel – concept list with backlinks */}
      <div className="w-72 flex-shrink-0 border-r border-[var(--border)] flex flex-col">
        <div className="p-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2 mb-3">
            <Link2 size={18} className="text-[var(--accent)]" />
            <h2 className="font-semibold">Backlinks</h2>
          </div>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
            />
            <input
              type="text"
              value={conceptSearch}
              onChange={(e) => setConceptSearch(e.target.value)}
              placeholder="Filter concepts…"
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded bg-[var(--surface-2)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center pt-10 gap-2 text-[var(--text-secondary)]">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Indexing…</span>
            </div>
          ) : groups.length === 0 ? (
            <div className="p-4 text-center text-sm text-[var(--text-secondary)]">
              <Hash size={32} className="mx-auto mb-2 opacity-30" />
              <p>No backlinks yet.</p>
              <p className="text-xs mt-1">
                Use [[concept]] syntax in notes to create links.
              </p>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.conceptName} className="mb-1">
                <button
                  onClick={() => setSelectedConcept(g.conceptName)}
                  className={`w-full text-left px-3 py-2 rounded text-sm flex items-center justify-between hover:bg-[var(--surface-2)] transition-colors ${
                    selectedConcept === g.conceptName
                      ? "bg-[var(--surface-2)] text-[var(--accent)]"
                      : ""
                  }`}
                >
                  <span className="font-medium truncate">{g.conceptName}</span>
                  <span className="ml-2 text-xs text-[var(--text-secondary)] flex-shrink-0">
                    {g.entries.length}
                  </span>
                </button>

                {selectedConcept === g.conceptName && (
                  <div className="ml-3 mt-1 space-y-0.5">
                    {g.entries.map((e, i) => (
                      <button
                        key={i}
                        onClick={() => openSource(e)}
                        className="w-full text-left px-2 py-1.5 rounded text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] transition-colors truncate"
                      >
                        <span className="opacity-60">{e.source_type}</span>:{" "}
                        {e.source_id.slice(0, 8)}…
                        {e.context && (
                          <p className="opacity-50 truncate mt-0.5">
                            …{e.context.slice(0, 60)}…
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right panel – note preview */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {sourceNote ? (
          <>
            <div className="flex items-center gap-2 p-4 border-b border-[var(--border)]">
              <button
                onClick={clearNote}
                className="p-1.5 rounded hover:bg-[var(--surface-2)] text-[var(--text-secondary)] transition-colors"
              >
                <ArrowLeft size={16} />
              </button>
              <h3 className="font-semibold truncate">{sourceNote.title}</h3>
              {sourceNote.tags.length > 0 && (
                <div className="flex gap-1 ml-auto flex-shrink-0">
                  {sourceNote.tags.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded-full text-xs bg-[var(--surface-2)] text-[var(--text-secondary)]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="prose max-w-none">
                <pre className="whitespace-pre-wrap text-sm leading-relaxed font-normal">
                  {sourceNote.content || (
                    <span className="text-[var(--text-secondary)] italic">
                      Empty note
                    </span>
                  )}
                </pre>
              </div>
            </div>
          </>
        ) : noteLoading ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-[var(--text-secondary)]">
            <Loader2 size={18} className="animate-spin" />
            <span>Loading note…</span>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-secondary)]">
            <Link2 size={40} className="mb-4 opacity-20" />
            <p className="text-sm">
              {activeWorkspaceId
                ? `Backlinks for workspace ${activeWorkspaceId?.slice(0, 8)}…`
                : "No workspace active"}
            </p>
            <p className="text-xs mt-1 opacity-60">
              Click a concept → source to preview the note
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
