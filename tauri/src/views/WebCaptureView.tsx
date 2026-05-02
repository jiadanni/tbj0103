/**
 * WebCaptureView — capture, browse, and manage web page captures.
 * Mirrors the web capture functionality from Swift app.
 */
import { useEffect, useState } from "react";
import { Plus, Trash2, Globe, Search, ExternalLink, RefreshCw } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface WebCapture {
  id: string;
  workspace_id: string;
  url: string;
  title: string;
  content: string;
  summary?: string;
  is_processed: boolean;
  created_at: string;
}

export default function WebCaptureView() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [captures, setCaptures] = useState<WebCapture[]>([]);
  const [selected, setSelected] = useState<WebCapture | null>(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) {return;}
    api.webCapture.list(activeWorkspaceId, { limit: 200, offset: 0, includeDescendants: true }).then(setCaptures).catch(() => {});
  }, [activeWorkspaceId]);

  const filtered = captures.filter(
    (c) =>
      c.title.toLowerCase().includes(query.toLowerCase()) ||
      c.url.toLowerCase().includes(query.toLowerCase()) ||
      (c.summary ?? "").toLowerCase().includes(query.toLowerCase())
  );

  async function addCapture() {
    if (!activeWorkspaceId || !newUrl.trim()) {return;}
    setSaving(true);
    setError(null);
    try {
      const url = newUrl.trim();
      const title = newTitle.trim() || url;
      const capture = await api.webCapture.create(activeWorkspaceId, url, title, "");
      setCaptures((prev) => [capture, ...prev]);
      setSelected(capture);
      setAdding(false);
      setNewUrl("");
      setNewTitle("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCapture(id: string) {
    const confirmed = await ask("Delete this web capture?", {
      title: "Confirm Deletion",
      kind: "warning",
    });
    if (!confirmed) { return; }
    await api.webCapture.delete(id);
    setCaptures((prev) => prev.filter((c) => c.id !== id));
    if (selected?.id === id) { setSelected(null); }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left pane */}
      <div className="w-72 flex flex-col border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] shrink-0">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border-color)]">
          <div className="flex-1 flex items-center gap-1.5 bg-[var(--bg-elevated)] rounded-lg px-2 py-1">
            <Search size={12} className="text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search captures…"
              className="flex-1 text-xs bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
          </div>
          <button
            onClick={() => setAdding(true)}
            disabled={!activeWorkspaceId}
            title="Add web capture"
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--accent-color)] disabled:opacity-40"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Add form */}
        {adding && (
          <div className="p-3 border-b border-[var(--border-color)] space-y-2 bg-[var(--bg-elevated)]">
            <input
              autoFocus
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://…"
              className="w-full text-xs px-2 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") {addCapture();} if (e.key === "Escape") {setAdding(false);} }}
              placeholder="Title (optional)"
              className="w-full text-xs px-2 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
            {error && <p className="text-[11px] text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={addCapture}
                disabled={saving || !newUrl.trim()}
                className="flex-1 text-xs py-1.5 rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-1"
              >
                {saving ? <RefreshCw size={11} className="animate-spin" /> : null}
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => { setAdding(false); setNewUrl(""); setNewTitle(""); setError(null); }}
                className="px-3 text-xs py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {!activeWorkspaceId ? (
            <p className="p-4 text-xs text-[var(--text-muted)] text-center">Select a workspace first.</p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-xs text-[var(--text-muted)] text-center">
              {captures.length === 0 ? "No captures yet. Click + to add one." : "No matches."}
            </p>
          ) : (
            filtered.map((capture) => (
              <button
                key={capture.id}
                onClick={() => setSelected(capture)}
                className={`w-full text-left px-3 py-2.5 border-b border-[var(--border-color)] transition-colors ${
                  selected?.id === capture.id
                    ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                    : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                }`}
              >
                <div className="flex items-start gap-2">
                  <Globe size={12} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{capture.title || capture.url}</div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">{capture.url}</div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{formatDate(capture.created_at)}</div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right pane: capture viewer */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border-color)] shrink-0">
            <Globe size={14} className="text-[var(--accent-color)]" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[var(--text-primary)] truncate">{selected.title}</div>
              <a
                href={selected.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-[var(--accent-color)] hover:underline truncate flex items-center gap-1"
              >
                {selected.url}
                <ExternalLink size={10} />
              </a>
            </div>
            <button
              onClick={() => deleteCapture(selected.id)}
              className="p-1.5 text-[var(--text-muted)] hover:text-red-400 rounded-lg hover:bg-red-400/10 transition-colors"
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {selected.summary && (
              <div className="mb-5 p-4 bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-color)]">
                <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Summary</div>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{selected.summary}</p>
              </div>
            )}
            {selected.content ? (
              <div className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap font-mono text-[11px]">
                {selected.content}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-[var(--text-muted)] gap-2">
                <Globe size={24} className="opacity-30" />
                <p className="text-sm">No content captured. Open the URL to view content.</p>
              </div>
            )}
          </div>

          <div className="px-5 py-2 border-t border-[var(--border-color)] shrink-0">
            <p className="text-[11px] text-[var(--text-muted)]">
              Captured {formatDate(selected.created_at)} · {selected.is_processed ? "Processed" : "Unprocessed"}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
          <div className="text-center space-y-2">
            <Globe size={32} className="mx-auto opacity-30" />
            <p className="text-sm">Select a capture to view</p>
            {activeWorkspaceId && (
              <button onClick={() => setAdding(true)} className="text-xs text-[var(--accent-color)] hover:underline">
                + Add web capture
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
