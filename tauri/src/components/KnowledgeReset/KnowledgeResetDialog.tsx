import { Loader2, RotateCcw } from "lucide-react";
import type { KnowledgeResetOptions, KnowledgeResetResult } from "../../lib/api";
import { KnowledgeResetCountGrid } from "./KnowledgeResetCountGrid";
import { KNOWLEDGE_RESET_OPTION_GROUPS, totalKnowledgeResetRows } from "./knowledgeReset";

export interface KnowledgeResetDialogProps {
  title: string;
  description: string;
  options: KnowledgeResetOptions;
  preview: KnowledgeResetResult | null;
  loadingPreview: boolean;
  running: boolean;
  error: string | null;
  onOptionChange: (key: keyof KnowledgeResetOptions, value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Presentational "Reset AI-Inferred Data" confirmation dialog. Fully
 * controlled — the parent owns the reset state (options/preview/running) and
 * supplies the scope-specific `title`/`description` copy. Shared by
 * DataControlsPreferences and WorkspaceSettingsView.
 */
export function KnowledgeResetDialog({
  title,
  description,
  options,
  preview,
  loadingPreview,
  running,
  error,
  onOptionChange,
  onConfirm,
  onCancel,
}: KnowledgeResetDialogProps) {
  const busy = running || loadingPreview;
  const totalRows = totalKnowledgeResetRows(preview);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm"
      onClick={() => {
        if (!busy) {
          onCancel();
        }
      }}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-red-500/25 bg-[var(--bg-elevated)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/12 text-red-400">
              <RotateCcw size={18} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
              <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs leading-5 text-red-200">
            This cannot be undone. Source material is preserved, but selected AI-inferred data will be cleared.
          </div>

          {loadingPreview ? (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-secondary)]">
              <Loader2 size={14} className="animate-spin" />
              Calculating affected data…
            </div>
          ) : preview ? (
            <KnowledgeResetCountGrid result={preview} />
          ) : null}

          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Advanced options</div>
            <div className="space-y-4">
              {KNOWLEDGE_RESET_OPTION_GROUPS.map((group) => (
                <div key={group.title} className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{group.title}</div>
                  <div className="space-y-2">
                    {group.rows.map((option) => {
                      const checked = options[option.key] ?? true;
                      return (
                        <label
                          key={option.key}
                          className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy}
                            onChange={(event) => onOptionChange(option.key, event.target.checked)}
                            className="mt-1 h-4 w-4 accent-[var(--accent-color)]"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-[var(--text-primary)]">{option.label}</span>
                            <span className="block text-xs leading-5 text-[var(--text-muted)]">{option.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {options.delete_generated_cards === false && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-200">
              Generated cards will be kept as manual cards, but their concept and legacy topic links will be removed.
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs leading-5 text-red-200">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-color)] px-5 py-4">
          <div className="text-xs text-[var(--text-muted)]">
            {preview && !loadingPreview ? `${totalRows} affected derived row${totalRows === 1 ? "" : "s"}` : ""}
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
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running && <Loader2 size={14} className="animate-spin" />}
              Reset AI-Inferred Data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
