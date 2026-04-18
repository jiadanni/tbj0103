import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

interface CompactMenuSelectOption {
  value: string;
  label: string;
}

interface CompactMenuSelectGroup {
  /** Displayed as a non-interactive header above the group's options. */
  label: string;
  /**
   * If provided the group header is itself clickable and calls onChange with
   * this value (e.g. to select the parent workspace which auto-resolves to its
   * first child).
   */
  value?: string;
  options: CompactMenuSelectOption[];
}

interface CompactMenuSelectProps {
  label: string;
  value: string;
  options: CompactMenuSelectOption[];
  onChange: (value: string) => void;
  /**
   * When provided the dropdown renders groups with headers instead of a flat
   * list.  `options` is still used to look up the label shown in the button.
   */
  groups?: CompactMenuSelectGroup[];
  widthClassName?: string;
  buttonClassName?: string;
  menuClassName?: string;
}

const defaultButtonClassName = "flex h-8 w-full items-center justify-between gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] shadow-sm outline-none transition-colors hover:border-[var(--accent-color)] focus-visible:border-[var(--accent-color)]";
const defaultMenuClassName = "absolute left-0 top-full z-40 mt-2 w-full overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1 shadow-xl backdrop-blur-xl";

export default function CompactMenuSelect({
  label,
  value,
  options,
  onChange,
  groups,
  widthClassName = "w-full",
  buttonClassName = "",
  menuClassName = "",
}: CompactMenuSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? options[0] ?? { value, label: value },
    [options, value]
  );

  useEffect(() => {
    if (!open) {return;}

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) {return;}
      setOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${widthClassName}`}>
      <button
        type="button"
        aria-label={`${label}: ${selectedOption.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        className={`${defaultButtonClassName} ${buttonClassName}`.trim()}
      >
        <span className="truncate">{selectedOption.label}</span>
        <ChevronDown size={14} className={`shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className={`${defaultMenuClassName} ${menuClassName}`.trim()}
        >
          {groups ? (
            groups.map((group) => (
              <div key={group.label}>
                {group.value !== undefined ? (
                  <button
                    type="button"
                    role="option"
                    aria-selected={group.value === selectedOption.value}
                    onClick={() => {
                      onChange(group.value ?? "");
                      setOpen(false);
                    }}
                    className={`flex w-full items-center rounded-lg px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors ${
                      group.value === selectedOption.value
                        ? "text-[var(--accent-color)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {group.label}
                  </button>
                ) : (
                  <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {group.label}
                  </div>
                )}
                {group.options.map((option) => {
                  const isSelected = option.value === selectedOption.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center rounded-lg py-2 pl-6 pr-3 text-left text-sm transition-colors ${
                        isSelected
                          ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <span className="truncate">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            ))
          ) : (
            options.map((option) => {
              const isSelected = option.value === selectedOption.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    isSelected
                      ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
