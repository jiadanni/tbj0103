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
          <div className="px-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-[rgba(255,255,255,0.48)]">
            {row.label}
          </div>
          <div className="flex flex-wrap gap-2.5">
            {row.suggestions.map((suggestion) => {
              const isImmediate = suggestion.action === "send_immediately";
              const isDisabled = disabled || (isImmediate && disableImmediateSend);

              return (
                <button
                  key={suggestion.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => onSuggestionClick(suggestion)}
                  className={`inline-flex items-center rounded-full border px-3.5 py-2 text-left text-[12px] font-semibold leading-none tracking-[0.01em] shadow-[0_10px_26px_-20px_rgba(0,0,0,0.9)] transition-all duration-150 hover:-translate-y-px ${
                    isImmediate
                      ? "border-[rgba(255,255,255,0.1)] bg-[rgba(var(--accent-color-rgb),0.05)] text-[rgba(255,255,255,0.94)] hover:border-[rgba(var(--accent-color-rgb),0.3)] hover:bg-[rgba(var(--accent-color-rgb),0.12)]"
                      : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.8)] hover:border-[rgba(var(--accent-color-rgb),0.22)] hover:bg-[rgba(var(--accent-color-rgb),0.05)] hover:text-white"
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
