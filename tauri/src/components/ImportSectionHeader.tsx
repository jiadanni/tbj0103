import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

type Props = {
  /** Section name, matching its include toggle verbatim (e.g. "Projects"). */
  label: string;
  /**
   * Include state. When provided, the header owns the section's checkbox —
   * the control sits on the thing it governs, so no separate legend is needed.
   */
  included?: boolean;
  onToggleIncluded?: (next: boolean) => void;
  /** Export lacks this data: the checkbox is shown disabled. */
  unavailable?: boolean;
  /** Blocks the checkbox during a scan or import. */
  busy?: boolean;
  /** Secondary detail — counts, selection state. */
  detail?: ReactNode;
  /** Omit for a static header; provide to make the title a disclosure button. */
  open?: boolean;
  onToggleOpen?: () => void;
  /** Right-aligned controls (All / None, filters). */
  actions?: ReactNode;
};

/**
 * Header for a top-level Claude import section.
 *
 * Sections were titled in the same `text-xs` as their own body rows, so
 * nothing marked where one ended and the next began — and nothing tied a
 * section to the include toggle that governs it. This gives every section one
 * consistent, heavier title with an accent rule, and the label is written to
 * match its toggle exactly so the pairing is readable at a glance.
 */
export function ImportSectionHeader({
  label,
  detail,
  open,
  onToggleOpen,
  actions,
  included,
  onToggleIncluded,
  unavailable = false,
  busy = false,
}: Props) {
  const collapsible = typeof open === "boolean" && !!onToggleOpen;
  const hasCheckbox = typeof included === "boolean" && !!onToggleIncluded;

  const title = (
    <span className="flex items-center gap-1.5 min-w-0">
      {collapsible && (
        open ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />
      )}
      {!hasCheckbox && (
        <span
          className={`h-3.5 w-[3px] shrink-0 rounded-full ${included === false ? "bg-[var(--border-color)]" : "bg-[var(--accent-color)]"}`}
          aria-hidden="true"
        />
      )}
      <span className="text-[13px] font-semibold text-[var(--text-primary)]">{label}</span>
      {detail != null && (
        <span className="text-[11px] font-normal text-[var(--text-muted)] truncate">{detail}</span>
      )}
    </span>
  );

  return (
    <div
      data-testid={`import-header-${label.toLowerCase()}`}
      className="flex items-center justify-between gap-2 border-b border-[var(--border-color)] pb-1.5"
    >
      <span className="flex items-center gap-2 min-w-0">
        {hasCheckbox && (
          // Outside the disclosure button: nesting interactive controls would
          // make expanding the section also toggle it.
          <input
            type="checkbox"
            checked={included && !unavailable}
            disabled={unavailable || busy}
            onChange={(e) => onToggleIncluded?.(e.target.checked)}
            aria-label={`Include ${label}`}
            className="shrink-0 rounded"
          />
        )}
        {collapsible ? (
          <button
            type="button"
            onClick={onToggleOpen}
            aria-expanded={open}
            className="flex items-center min-w-0 text-left hover:opacity-80"
          >
            {title}
          </button>
        ) : (
          title
        )}
      </span>
      {actions != null && <span className="flex shrink-0 items-center gap-2">{actions}</span>}
    </div>
  );
}
