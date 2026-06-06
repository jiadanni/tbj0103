import React from "react";
import { ChevronDown } from "lucide-react";
import { CompactMenuSelect } from "../CompactMenuSelect";

export type WorkspaceNavDropdownDensity = "comfortable" | "compact";

export interface WorkspaceNavDropdownOption {
  label: string;
  value: string;
}

export interface WorkspaceNavDropdownGroup {
  label: string;
  value: string;
  options: WorkspaceNavDropdownOption[];
}

interface WorkspaceNavDropdownSelectProps {
  /** Visible label used by CompactMenuSelect's accessible menu header
   *  (e.g. "Workspace", "Workspace primary"). Not rendered as a row
   *  prefix here — pair with a surrounding container when needed. */
  label: string;
  value: string;
  options: WorkspaceNavDropdownOption[];
  groups?: WorkspaceNavDropdownGroup[];
  onChange?: (value: string) => void;
  density?: WorkspaceNavDropdownDensity;
  /** Overrides the displayed selected text at compact density. When
   *  omitted, the matching option's label (or first option's label) is
   *  shown. */
  displayLabel?: string;
  /** Width class passed through to CompactMenuSelect at comfortable
   *  density. Ignored at compact density. */
  widthClassName?: string;
  /** Extra classes passed through to CompactMenuSelect's button at
   *  comfortable density. Ignored at compact density. */
  buttonClassName?: string;
}

const SIZES = {
  comfortable: {
    staticTrigger: "",
    chevronSize: 14,
    text: "",
  },
  compact: {
    staticTrigger:
      "flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] font-medium",
    chevronSize: 8,
    text: "text-[0.65em] text-[var(--text-primary)]",
  },
} as const;

/**
 * Workspace dropdown trigger shared between the real app's
 * SingleTitlebarWorkspaceDropdown and the Preferences Live App Preview
 * top-dropdown workspace selector. At `comfortable` density the trigger
 * is the real interactive `CompactMenuSelect`; at `compact` density it
 * renders a non-interactive facsimile sized for the preview iframe so
 * the preview cannot drift from the real chrome.
 */
export function WorkspaceNavDropdownSelect({
  label,
  value,
  options,
  groups,
  onChange,
  density = "comfortable",
  displayLabel,
  widthClassName = "min-w-0 w-full max-w-[280px] sm:w-[240px]",
  buttonClassName = "h-8 bg-[var(--bg-primary)]",
}: WorkspaceNavDropdownSelectProps) {
  const sizes = SIZES[density];

  if (density === "comfortable") {
    return (
      <CompactMenuSelect
        label={label}
        value={value}
        options={options}
        groups={groups}
        onChange={(next) => onChange?.(next)}
        widthClassName={widthClassName}
        buttonClassName={buttonClassName}
      />
    );
  }

  const resolvedLabel =
    displayLabel ??
    options.find((option) => option.value === value)?.label ??
    options[0]?.label ??
    "";

  return (
    <div className={`${sizes.staticTrigger} ${sizes.text}`}>
      <span>{resolvedLabel}</span>
      <ChevronDown
        size={sizes.chevronSize}
        className="text-[var(--text-muted)]"
      />
    </div>
  );
}

export default React.memo(WorkspaceNavDropdownSelect);
