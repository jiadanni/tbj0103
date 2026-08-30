import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Check } from "lucide-react";
import { ImportSectionHeader } from "./ImportSectionHeader";
import { api } from "../lib/api";

type AccountMemory = {
  key: string;
  category: string;
  label: string;
  content: string;
  kind: "fact" | "preference";
  updated_at: string | null;
  status: "new" | "updated" | "unchanged";
};

type Props = {
  /** Export folder to read; the panel renders nothing until one is chosen. */
  folderPath: string | null;
  /** Blocks interaction while the parent runs its own import. */
  disabled?: boolean;
  /** Fired after a successful import so the parent can refresh counts. */
  onImported?: (result: { imported: number; updated: number; skipped: number }) => void;
};

const STATUS_LABEL: Record<AccountMemory["status"], string> = {
  new: "New",
  updated: "Changed",
  unchanged: "Already imported",
};

/**
 * Import Claude's account-level memories — profile, preferences and topics —
 * as a separate step from conversations and project memories.
 *
 * Account memories describe the user rather than a project, so they import at
 * global scope with no project mapping. Re-importing is idempotent: unchanged
 * entries are skipped and changed ones update in place, which is why entries
 * already imported are deselected by default.
 */
export function ClaudeAccountMemoriesPanel({ folderPath, disabled, onImported }: Props) {
  const [memories, setMemories] = useState<AccountMemory[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; updated: number; skipped: number } | null>(null);

  useEffect(() => {
    if (!folderPath) {
      setMemories([]);
      setSelected(new Set());
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    api.chatFile
      .previewClaudeAccountMemories(folderPath)
      .then((res) => {
        if (cancelled) { return; }
        setMemories(res.memories);
        // Default to everything that would actually change something.
        setSelected(new Set(res.memories.filter((m) => m.status !== "unchanged").map((m) => m.key)));
      })
      .catch((e) => {
        if (!cancelled) {
          setMemories([]);
          setError(String(e));
        }
      })
      .finally(() => {
        if (!cancelled) { setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [folderPath]);

  const grouped = useMemo(() => {
    const groups = new Map<string, AccountMemory[]>();
    for (const m of memories) {
      const list = groups.get(m.category);
      if (list) { list.push(m); } else { groups.set(m.category, [m]); }
    }
    return [...groups.entries()];
  }, [memories]);

  const toggle = useCallback((key: string) => {
    // Any change to the selection makes the last import's summary stale, so
    // drop it and show the live count again.
    setResult(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setResult(null);
    setSelected((prev) => (prev.size === memories.length ? new Set() : new Set(memories.map((m) => m.key))));
  }, [memories]);

  const runImport = useCallback(async () => {
    if (!folderPath || selected.size === 0) { return; }
    setImporting(true);
    setError(null);
    try {
      const res = await api.chatFile.importClaudeAccountMemories(folderPath, [...selected]);
      setResult(res);
      onImported?.(res);
      // Re-preview so statuses reflect what was just written.
      const refreshed = await api.chatFile.previewClaudeAccountMemories(folderPath);
      setMemories(refreshed.memories);
      setSelected(new Set(refreshed.memories.filter((m) => m.status !== "unchanged").map((m) => m.key)));
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }, [folderPath, selected, onImported]);

  if (!folderPath) { return null; }

  if (loading) {
    return (
      <div className="shrink-0 flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
        <RefreshCw size={12} className="animate-spin text-[var(--text-muted)]" />
        <span className="text-xs text-[var(--text-muted)]">Reading account memories…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shrink-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
        <div className="text-xs text-[var(--text-muted)]">Could not read account memories: {error}</div>
      </div>
    );
  }

  // A v2 export has no account memories; say nothing rather than showing an
  // empty panel the user cannot act on.
  if (memories.length === 0) { return null; }

  const busy = importing || disabled;

  return (
    <div className="shrink-0 flex flex-col gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <ImportSectionHeader
        label="Memories"
        detail={`Account · ${memories.length} ${memories.length === 1 ? "entry" : "entries"}`}
        actions={
          <button
            type="button"
            onClick={toggleAll}
            disabled={busy}
            className="text-[11px] text-[var(--accent-color)] hover:underline disabled:opacity-50"
          >
            {selected.size === memories.length ? "Select none" : "Select all"}
          </button>
        }
      />

      <p className="text-[11px] text-[var(--text-muted)]">
        Profile, preferences and topics Claude remembered about you. Imported globally, not tied to a workspace.
      </p>

      <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
        {grouped.map(([category, items]) => (
          <div key={category} className="flex flex-col gap-1">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{category}</div>
            {items.map((m) => (
              <label key={m.key} className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={selected.has(m.key)}
                  disabled={busy}
                  onChange={() => toggle(m.key)}
                  className="mt-0.5 rounded"
                />
                <span className="flex-1 min-w-0">
                  <span className="text-xs text-[var(--text-primary)]">{m.content}</span>
                  <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">
                    {m.label}
                    {m.kind === "preference" && " · preference"}
                    {m.status !== "new" && ` · ${STATUS_LABEL[m.status]}`}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        {result ? (
          <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            <Check size={11} className="text-[var(--accent-color)]" />
            {result.imported} imported, {result.updated} updated, {result.skipped} unchanged
          </span>
        ) : (
          <span className="text-[11px] text-[var(--text-muted)]">{selected.size} selected</span>
        )}
        <button
          type="button"
          onClick={runImport}
          disabled={busy || selected.size === 0}
          className="flex items-center gap-1.5 rounded-md bg-[var(--accent-color)] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
        >
          {importing && <RefreshCw size={11} className="animate-spin" />}
          Import memories
        </button>
      </div>
    </div>
  );
}
