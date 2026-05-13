import React from "react";
import { ChevronDown } from "lucide-react";
import type { ComposerSuggestionRow, ComposerSuggestion } from "../lib/composerSuggestions";
import { Tooltip } from "./Tooltip";

interface ComposerSuggestionRowsProps {
  rows: ComposerSuggestionRow[];
  disabled?: boolean;
  disableImmediateSend?: boolean;
  onSuggestionClick: (suggestion: ComposerSuggestion, sendImmediately?: boolean) => void;
  onToggleCollapse?: () => void;
}

export default function ComposerSuggestionRows({
  rows,
  disabled = false,
  disableImmediateSend = false,
  onSuggestionClick,
  onToggleCollapse,
}: ComposerSuggestionRowsProps) {
  const allSuggestions = rows.flatMap((row) => row.suggestions);
  if (allSuggestions.length === 0) {return null;}

  const quickSendGroup = allSuggestions.filter(s => s.action === "send_immediately");
  const insertGroup = allSuggestions.filter(s => s.action !== "send_immediately");

  const renderSuggestion = (suggestion: ComposerSuggestion) => {
    const isImmediate = suggestion.action === "send_immediately";
    const isDisabled = disabled || (isImmediate && disableImmediateSend);

    return (
      <Tooltip key={suggestion.id} delay={600} className={isImmediate ? "" : "!whitespace-normal text-center"} content={isImmediate ? "Send immediately" : <span>Add to composer<br />Ctrl+click to send</span>}>
        <button
          key={suggestion.id}
          type="button"
          disabled={isDisabled}
          onClick={(e) => onSuggestionClick(suggestion, e.ctrlKey || e.metaKey)}
          className={`inline-flex shrink-0 [scroll-snap-align:start] items-center rounded-full px-3.5 py-1.5 text-left text-[12px] font-semibold leading-none tracking-[0.01em] transition-all duration-200 hover:-translate-y-px hover:shadow-md ${
            isImmediate
              ? "bg-[rgba(var(--accent-color-rgb),0.1)] text-[var(--accent-color)] hover:bg-[rgba(var(--accent-color-rgb),0.15)] ring-1 ring-[rgba(var(--accent-color-rgb),0.3)]"
              : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] ring-1 ring-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          } disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:shadow-none`}
        >
          {suggestion.label}
        </button>
      </Tooltip>
    );
  };

  return (
    <div className="px-1.5 pt-1 pb-0.5 flex items-center gap-2 group">
      <div className="flex-1 min-w-0 flex items-center gap-2.5 overflow-x-hidden group-hover:overflow-x-auto scroll-smooth [scroll-snap-type:x_mandatory] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden h-8">
        {quickSendGroup.map(renderSuggestion)}

        {quickSendGroup.length > 0 && insertGroup.length > 0 && (
          <div className="shrink-0 text-[var(--text-muted)] font-bold leading-none select-none">·</div>
        )}

        {insertGroup.map(renderSuggestion)}
      </div>

      {onToggleCollapse && (
        <Tooltip content="Hide suggestions">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[var(--text-muted)] transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="Hide suggestions"
          >
            <ChevronDown size={13} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
