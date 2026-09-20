import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Check, ChevronDown, ChevronRight, Folder } from "lucide-react";
import { ImportSectionHeader } from "./ImportSectionHeader";
import { api } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

type ProjectMemory = {
  project_uuid: string;
  project_name: string;
  memory: string;
  status: "new" | "updated" | "unchanged";
};

type Props = {
  /** Export folder to read; the panel renders nothing until one is chosen. */
  folderPath: string | null;
  /** Blocks interaction while a parent operation runs. */
  disabled?: boolean;
  /** Fired after a successful import so parent can refresh counts. */
  onImported?: (result: { imported: number; updated: number; skipped: number }) => void;
};

const STATUS_LABEL: Record<ProjectMemory["status"], string> = {
  new: "New",
  updated: "Changed",
  unchanged: "Already imported",
};

/**
 * Review and import Claude project-level memories (overview documents).
 *
 * Each project memory describes a specific project and is imported into a
 * target workspace (populating its Workspace Memory Summary and context).
 */
export function ClaudeProjectMemoriesPanel({ folderPath, disabled, onImported }: Props) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; updated: number; skipped: number } | null>(null);

  useEffect(() => {
    if (!folderPath) {
      setMemories([]);
      setSelected(new Set());
      setDestinations({});
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    api.chatFile
      .previewClaudeProjectMemories(folderPath)
      .then((res) => {
        if (cancelled) { return; }
        setMemories(res.memories);
        // Preselect all actionable items
        setSelected(new Set(res.memories.filter((m) => m.status !== "unchanged").map((m) => m.project_uuid)));

        // Pre-fill destination workspace by matching name or defaulting to first workspace
        const currentWorkspaces = useWorkspaceStore.getState().workspaces;
        const dests: Record<string, string> = {};
        for (const m of res.memories) {
          const match = currentWorkspaces.find((w) => w.name.toLowerCase() === m.project_name.toLowerCase());
          if (match) {
            dests[m.project_uuid] = match.id;
          } else if (currentWorkspaces.length > 0) {
            dests[m.project_uuid] = currentWorkspaces[0].id;
          }
        }
        setDestinations(dests);
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

  const toggle = useCallback((uuid: string) => {
    setResult(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) { next.delete(uuid); } else { next.add(uuid); }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setResult(null);
    setSelected((prev) => (prev.size === memories.length ? new Set() : new Set(memories.map((m) => m.project_uuid))));
  }, [memories]);

  const toggleExpand = useCallback((uuid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) { next.delete(uuid); } else { next.add(uuid); }
      return next;
    });
  }, []);

  const runImport = useCallback(async () => {
    if (!folderPath || selected.size === 0) { return; }
    setImporting(true);
    setError(null);
    try {
      const targets: Record<string, { workspace_id: string; folder_id: string }> = {};
      for (const uuid of selected) {
        const wsId = destinations[uuid];
        if (wsId) {
          targets[uuid] = { workspace_id: wsId, folder_id: "" };
        }
      }
      const res = await api.chatFile.importClaudeProjectMemories(folderPath, targets);
      setResult(res);
      onImported?.(res);
      const refreshed = await api.chatFile.previewClaudeProjectMemories(folderPath);
      setMemories(refreshed.memories);
      setSelected(new Set(refreshed.memories.filter((m) => m.status !== "unchanged").map((m) => m.project_uuid)));
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }, [folderPath, selected, destinations, onImported]);

  if (!folderPath) { return null; }

  if (loading) {
    return (
      <div className="shrink-0 flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
        <RefreshCw size={12} className="animate-spin text-[var(--text-muted)]" />
        <span className="text-xs text-[var(--text-muted)]">Reading project memories…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shrink-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
        <div className="text-xs text-[var(--text-muted)]">Could not read project memories: {error}</div>
      </div>
    );
  }

  if (memories.length === 0) { return null; }

  const busy = importing || disabled;

  return (
    <div className="shrink-0 flex flex-col gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <ImportSectionHeader
        label="Project Knowledge & Overviews"
        detail={`${memories.length} project ${memories.length === 1 ? "memory" : "memories"}`}
        busy={busy}
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
        Project overview documents from Claude. Imported directly into the target workspace as its live Workspace Memory Summary.
      </p>

      <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
        {memories.map((m) => {
          const isExpanded = expanded.has(m.project_uuid);
          return (
            <div
              key={m.project_uuid}
              className="flex flex-col gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 cursor-pointer min-w-0">
                  <input
                    type="checkbox"
                    checked={selected.has(m.project_uuid)}
                    disabled={busy}
                    onChange={() => toggle(m.project_uuid)}
                    className="rounded"
                  />
                  <Folder size={13} className="shrink-0 text-[var(--accent-color)]" />
                  <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                    {m.project_name}
                  </span>
                  {m.status !== "new" && (
                    <span className="text-[10px] text-[var(--text-muted)]">
                      · {STATUS_LABEL[m.status]}
                    </span>
                  )}
                </label>

                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={destinations[m.project_uuid] ?? ""}
                    disabled={busy || !selected.has(m.project_uuid)}
                    onChange={(e) =>
                      setDestinations((prev) => ({ ...prev, [m.project_uuid]: e.target.value }))
                    }
                    className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] focus:outline-none"
                  >
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        Workspace: {w.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => toggleExpand(m.project_uuid)}
                    className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    title={isExpanded ? "Collapse preview" : "Expand preview"}
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-[var(--bg-primary)] p-2 text-[11px] text-[var(--text-secondary)] font-mono border border-[var(--border-color)]">
                  {m.memory}
                </pre>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 mt-1">
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
          Import project memories
        </button>
      </div>
    </div>
  );
}
