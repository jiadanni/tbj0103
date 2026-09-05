/**
 * BoomScrollExportDialog — pick which workspaces contribute flashcards to a
 * Boom Scroll deck, mirroring the selective backup import dialog.
 */
import { useEffect, useMemo, useState } from "react";
import { CheckSquare, RefreshCw, Smartphone, Square, X } from "lucide-react";
import type { Workspace } from "../stores/workspaceStore";

export interface BoomScrollPickerEntry {
  workspace: Workspace;
  depth: number;
}

interface BoomScrollExportDialogProps {
  entries: BoomScrollPickerEntry[];
  cardCounts: Record<string, number>;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onExport: (workspaceIds: string[]) => void;
}

export default function BoomScrollExportDialog({
  entries,
  cardCounts,
  busy,
  error,
  onCancel,
  onExport,
}: BoomScrollExportDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(entries.map((entry) => entry.workspace.id)),
  );

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [busy, onCancel]);

  const selectedIds = useMemo(
    () => entries.map((entry) => entry.workspace.id).filter((id) => selected.has(id)),
    [entries, selected],
  );

  const totalCards = selectedIds.reduce((total, id) => total + (cardCounts[id] ?? 0), 0);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {next.delete(id);}
    else {next.add(id);}
    setSelected(next);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => {
        if (!busy) {onCancel();}
      }}
    >
      <div
        className="mx-4 flex max-h-[85vh] w-full max-w-lg flex-col gap-5 rounded-3xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-color)]/12 text-[var(--accent-color)]">
            <Smartphone size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Export Boom Scroll deck</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Choose which workspaces contribute flashcards. Everything stays local — you move the
              file to your phone yourself.
            </p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-primary)]">
              Workspaces ({selectedIds.length}/{entries.length})
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setSelected(new Set(entries.map((entry) => entry.workspace.id)))}
                className="text-xs text-[var(--accent-color)] hover:underline"
              >
                All
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-[var(--text-muted)] hover:underline"
              >
                None
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
            {entries.map(({ workspace, depth }) => {
              const checked = selected.has(workspace.id);
              const count = cardCounts[workspace.id];
              return (
                <div
                  key={workspace.id}
                  onClick={() => toggle(workspace.id)}
                  style={{ paddingLeft: 12 + depth * 20 }}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-[var(--border-color)] py-2 pr-3 last:border-b-0 hover:bg-[var(--bg-hover)]"
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={workspace.name}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(workspace.id);
                    }}
                    className="shrink-0 text-[var(--accent-color)]"
                  >
                    {checked ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--text-muted)]" />}
                  </button>
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-primary)]">
                    {workspace.name}
                  </span>
                  {count !== undefined && (
                    <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                      {count} {count === 1 ? "card" : "cards"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-[var(--text-muted)]">
            {totalCards} card{totalCards === 1 ? "" : "s"} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X size={14} />
              Cancel
            </button>
            <button
              onClick={() => onExport(selectedIds)}
              disabled={busy || selectedIds.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-color)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <RefreshCw size={14} className="animate-spin" /> : <Smartphone size={14} />}
              {busy ? "Exporting..." : "Export deck"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
