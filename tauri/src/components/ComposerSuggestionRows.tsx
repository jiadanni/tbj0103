import React from "react";
import type { ComposerSuggestionRow, ComposerSuggestion } from "../lib/composerSuggestions";

interface ComposerSuggestionRowsProps {
  rows: ComposerSuggestionRow[];
  disabled?: boolean;
  disableImmediateSend?: boolean;
  onSuggestionClick: (suggestion: ComposerSuggestion) => void;
}

export default function ComposerSuggestionRows({
  rows,
  disabled = false,
  disableImmediateSend = false,
  onSuggestionClick,
}: ComposerSuggestionRowsProps) {
  const visibleRows = rows.filter((row) => row.suggestions.length > 0);
  if (visibleRows.length === 0) {return null;}

  return (
    <div className="px-1.5 pt-1 pb-0.5 space-y-3">
      {visibleRows.map((row) => (
        <div key={row.id} className="flex flex-col gap-2">
          <div className="px-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-muted)]">
            {row.label}
          </div>
          <div className="flex flex-wrap gap-2">
            {row.suggestions.map((suggestion) => {
              const isImmediate = suggestion.action === "send_immediately";
              const isDisabled = disabled || (isImmediate && disableImmediateSend);

              return (
                <button
                  key={suggestion.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => onSuggestionClick(suggestion)}
                  className={`inline-flex items-center rounded-full border px-3.5 py-2 text-left text-[12px] font-medium leading-none shadow-sm transition-all duration-150 hover:-translate-y-px ${
                    isImmediate
                      ? "border-[rgba(var(--accent-color-rgb),0.24)] bg-[rgba(var(--accent-color-rgb),0.08)] text-[var(--accent-color)] hover:border-[rgba(var(--accent-color-rgb),0.38)] hover:bg-[rgba(var(--accent-color-rgb),0.12)]"
                      : "border-[var(--border-color)] bg-[var(--bg-primary)]/75 text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
                  } disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0`}
                  title={isImmediate ? "Send immediately" : "Add to composer"}
                >
                  {suggestion.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
