import React from "react";
import { ChevronUp } from "lucide-react";
import type { ComposerSuggestionRow, ComposerSuggestion } from "../lib/composerSuggestions";

interface ComposerSuggestionRowsProps {
  rows: ComposerSuggestionRow[];
  disabled?: boolean;
  disableImmediateSend?: boolean;
  onSuggestionClick: (suggestion: ComposerSuggestion) => void;
  onToggleCollapse?: () => void;
}

export default function ComposerSuggestionRows({
  rows,
  disabled = false,
  disableImmediateSend = false,
  onSuggestionClick,
  onToggleCollapse,
}: ComposerSuggestionRowsProps) {
  const visibleRows = rows.filter((row) => row.suggestions.length > 0);
  if (visibleRows.length === 0) {return null;}

  return (
    <div className="px-1.5 pt-1 pb-0.5 space-y-1.5">
      {visibleRows.map((row, rowIndex) => (
        <div key={row.id} className="flex flex-col gap-1.5">
          <div className="px-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-[rgba(255,255,255,0.48)]">
            {row.label}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {row.suggestions.map((suggestion) => {
              const isImmediate = suggestion.action === "send_immediately";
              const isDisabled = disabled || (isImmediate && disableImmediateSend);

              return (
                <button
                  key={suggestion.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => onSuggestionClick(suggestion)}
                  className={`inline-flex items-center rounded-full border px-3.5 py-1.5 text-left text-[12px] font-semibold leading-none tracking-[0.01em] transition-all duration-150 ${
                    isImmediate
                      ? "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.94)] hover:border-[rgba(255,255,255,0.22)] hover:bg-[rgba(255,255,255,0.08)]"
                      : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.8)] hover:border-[rgba(255,255,255,0.16)] hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
                  } disabled:cursor-not-allowed disabled:opacity-45`}
                  title={isImmediate ? "Send immediately" : "Add to composer"}
                >
                  {suggestion.label}
                </button>
              );
            })}
            {onToggleCollapse && rowIndex === visibleRows.length - 1 && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="ml-auto flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.42)] transition-all hover:bg-[rgba(255,255,255,0.08)] hover:text-white"
                aria-label="Hide suggestions"
                title="Hide suggestions"
              >
                <ChevronUp size={13} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
