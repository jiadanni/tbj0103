import { Eye } from "lucide-react";

type Props = {
  /** Section name, matching its toggle exactly (e.g. "Projects"). */
  label: string;
  /** What is being withheld, e.g. "25 projects". */
  summary: string;
  /** Re-enables the section — the same setter the toggle uses. */
  onEnable: () => void;
  /** Number of placeholder rows to draw. */
  rows?: number;
};

/**
 * Placeholder shown where a section would render, when its include toggle is
 * off.
 *
 * Hiding a section outright made the checkboxes look inert — nothing visibly
 * connected a toggle to the region it controlled. Leaving a labelled ghost in
 * place keeps that mapping obvious and gives the content somewhere to come back
 * to, rather than the page reflowing on every click.
 */
export function ImportSectionSkeleton({ label, summary, onEnable, rows = 3 }: Props) {
  return (
    <div
      data-testid={`import-skeleton-${label.toLowerCase()}`}
      className="shrink-0 flex flex-col gap-2 rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
          <span className="text-[11px] text-[var(--text-muted)] truncate">· {summary} not being imported</span>
        </div>
        <button
          type="button"
          onClick={onEnable}
          className="flex items-center gap-1 shrink-0 text-[11px] text-[var(--accent-color)] hover:underline"
        >
          <Eye size={11} />
          Include
        </button>
      </div>

      {/* Inert bars standing in for the hidden rows. */}
      <div className="flex flex-col gap-1.5" aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-3 w-3 shrink-0 rounded-sm bg-[var(--border-color)]/60" />
            <div
              className="h-3 rounded bg-[var(--border-color)]/60"
              style={{ width: `${72 - i * 14}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
