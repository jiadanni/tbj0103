import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import type { DataDeletionPreview, DataDeletionTimeFilter } from "../../lib/api";
import { DATA_DELETION_CATEGORIES, TIME_FILTER_OPTIONS } from "./dataDeletion";

export interface DataDeletionDialogProps {
  scopeDescription: string;
  timeFilter: DataDeletionTimeFilter;
  selectedCategories: string[];
  preview: DataDeletionPreview | null;
  loadingPreview: boolean;
  running: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DataDeletionDialog({
  scopeDescription,
  timeFilter,
  selectedCategories: _selectedCategories,
  preview,
  loadingPreview,
  running,
  error,
  onConfirm,
  onCancel,
}: DataDeletionDialogProps) {
  const busy = running || loadingPreview;
  const [typedConfirmation, setTypedConfirmation] = useState("");

  const timeFilterLabel =
    TIME_FILTER_OPTIONS.find((t) => t.value === timeFilter)?.label ?? "All time";

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [busy, onCancel]);

  const totalItems = preview?.total_items ?? 0;
  const totalRows = preview?.total_rows ?? 0;
  const requiresTypedConfirm = totalItems >= 50;
  const confirmEnabled = !busy && (!requiresTypedConfirm || typedConfirmation.toLowerCase() === "delete");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={() => {
        if (!busy) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-deletion-dialog-title"
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-red-500/30 bg-[var(--bg-elevated)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-500">
                <Trash2 size={20} />
              </div>
              <div>
                <h3
                  id="data-deletion-dialog-title"
                  className="text-base font-semibold text-[var(--text-primary)]"
                >
                  Permanently Delete Workspace Data
                </h3>
                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  Target: <span className="font-medium text-[var(--text-primary)]">{scopeDescription}</span> · Time cutoff:{" "}
                  <span className="font-medium text-[var(--text-primary)]">{timeFilterLabel}</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs leading-5 text-red-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
            <div>
              <span className="font-semibold text-red-200">Warning: Permanent Data Loss.</span>
              <p className="mt-0.5">
                The selected user records, messages, notes, and local files will be permanently erased.
                This action cannot be undone.
              </p>
            </div>
          </div>

          {/* Counts preview */}
          {loadingPreview ? (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-4 text-sm text-[var(--text-secondary)]">
              <Loader2 size={16} className="animate-spin text-red-400" />
              <span>Scanning database and calculating affected records…</span>
            </div>
          ) : preview ? (
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Items to be Deleted ({totalItems} items · {totalRows} total records)
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {preview.categories.map((cat) => {
                  const meta = DATA_DELETION_CATEGORIES.find((c) => c.id === cat.id);
                  return (
                    <div
                      key={cat.id}
                      className="flex flex-col justify-between rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)]">
                          {cat.label}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            cat.item_count > 0
                              ? "bg-red-500/20 text-red-300"
                              : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"
                          }`}
                        >
                          {cat.item_count} {cat.item_count === 1 ? "item" : "items"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-muted)] leading-4">
                        {meta?.description}
                      </p>
                      {cat.total_rows > cat.item_count && (
                        <span className="mt-2 text-[10px] text-[var(--text-secondary)]">
                          Includes {cat.total_rows} cascading database rows
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {requiresTypedConfirm && (
            <div className="space-y-1.5 pt-2">
              <label className="text-xs font-medium text-[var(--text-primary)]">
                To confirm deletion of {totalItems} items, type <span className="font-bold text-red-400">delete</span> below:
              </label>
              <input
                type="text"
                value={typedConfirmation}
                onChange={(e) => setTypedConfirmation(e.target.value)}
                placeholder="delete"
                disabled={busy}
                className="w-full rounded-xl border border-red-500/30 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-red-500"
              />
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/15 px-4 py-3 text-xs leading-5 text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-color)] px-5 py-4">
          <div className="text-xs text-[var(--text-muted)]">
            {preview && !loadingPreview
              ? totalItems > 0
                ? `${totalItems} item${totalItems === 1 ? "" : "s"} selected`
                : "No matching records"
              : ""}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!confirmEnabled || (preview !== null && totalItems === 0 && totalRows === 0)}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            >
              {running && <Loader2 size={14} className="animate-spin" />}
              <span>Permanently Delete Data</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
