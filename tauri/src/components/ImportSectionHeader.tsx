import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

type Props = {
  /** Section name, matching its include toggle verbatim (e.g. "Projects"). */
  label: string;
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
export function ImportSectionHeader({ label, detail, open, onToggleOpen, actions }: Props) {
  const collapsible = typeof open === "boolean" && !!onToggleOpen;

  const title = (
    <span className="flex items-center gap-1.5 min-w-0">
      {collapsible && (
        open ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />
      )}
      {/* The accent bar is the visual link back to the toggle card above. */}
      <span className="h-3.5 w-[3px] shrink-0 rounded-full bg-[var(--accent-color)]" aria-hidden="true" />
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
      {actions != null && <span className="flex shrink-0 items-center gap-2">{actions}</span>}
    </div>
  );
}
