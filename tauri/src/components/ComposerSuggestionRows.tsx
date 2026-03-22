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
    <div className="px-2 pt-1 pb-2 space-y-2">
      {visibleRows.map((row) => (
        <div key={row.id} className="flex flex-col gap-1.5">
          <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {row.label}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {row.suggestions.map((suggestion) => {
              const isImmediate = suggestion.action === "send_immediately";
              const isDisabled = disabled || (isImmediate && disableImmediateSend);

              return (
                <button
                  key={suggestion.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => onSuggestionClick(suggestion)}
                  className={`rounded-full border px-3 py-1.5 text-left text-xs transition-colors ${
                    isImmediate
                      ? "border-[var(--accent-color)]/35 bg-[var(--accent-color)]/10 text-[var(--accent-color)] hover:border-[var(--accent-color)] hover:bg-[var(--accent-color)]/15"
                      : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
                  } disabled:cursor-not-allowed disabled:opacity-45`}
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
