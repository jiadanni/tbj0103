import React from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CompactMenuSelect } from "../CompactMenuSelect";

export type SectionNavDropdownDensity = "comfortable" | "compact";

export interface SectionNavDropdownOption {
  label: string;
  value: string;
  icon?: LucideIcon;
}

interface SectionNavDropdownSelectProps {
  options: SectionNavDropdownOption[];
  value: string;
  onChange?: (value: string) => void;
  density?: SectionNavDropdownDensity;
  /** When true, prefix the dropdown with a "Section" label and render the
   *  surrounding bar. When false, render the trigger only (used inside the
   *  combined titlebar breadcrumbs). */
  showRow?: boolean;
}

const SIZES = {
  comfortable: {
    row: "h-10 px-3 gap-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]",
    label: "shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]",
    staticTrigger: "",
    chevronSize: 14,
  },
  compact: {
    row: "h-7 px-3 gap-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]",
    label: "text-[0.5em] font-bold uppercase tracking-wider text-[var(--text-muted)]",
    staticTrigger:
      "flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[0.6em] text-[var(--text-secondary)] font-medium",
    chevronSize: 8,
  },
} as const;

/**
 * Section dropdown row shared between the real app's CompactSectionNavigation
 * and the Preferences Live App Preview "top-dropdown" mode. At `comfortable`
 * density the trigger is the real interactive `CompactMenuSelect`; at
 * `compact` density it renders a non-interactive facsimile sized for the
 * preview iframe so the preview cannot drift from the real chrome.
 */
export function SectionNavDropdownSelect({
  options,
  value,
  onChange,
  density = "comfortable",
  showRow = true,
}: SectionNavDropdownSelectProps) {
  const sizes = SIZES[density];
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? options[0]?.label ?? "";

  const trigger =
    density === "comfortable" ? (
      <CompactMenuSelect
        label="Section"
        value={value}
        options={options}
        onChange={(next) => onChange?.(next)}
        widthClassName="min-w-0 w-full max-w-[260px] sm:w-[240px]"
      />
    ) : (
      <div className={sizes.staticTrigger}>
        <span>{selectedLabel}</span>
        <ChevronDown
          size={sizes.chevronSize}
          className="text-[var(--text-muted)]"
        />
      </div>
    );

  if (!showRow) {
    return trigger;
  }

  return (
    <div className={`flex items-center shrink-0 select-none ${sizes.row}`}>
      <span className={sizes.label}>Section</span>
      {trigger}
    </div>
  );
}

export default React.memo(SectionNavDropdownSelect);
