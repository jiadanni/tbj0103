import React from "react";
import { ChevronDown } from "lucide-react";
import type { ComposerSuggestionRow, ComposerSuggestion } from "../lib/composerSuggestions";
import { Tooltip } from "./Tooltip";

interface ComposerSuggestionRowsProps {
  rows: ComposerSuggestionRow[];
  disabled?: boolean;
  disableImmediateSend?: boolean;
  variant?: "composer" | "follow-up";
  onSuggestionClick: (suggestion: ComposerSuggestion, sendImmediately?: boolean) => void;
  onToggleCollapse?: () => void;
}

export default function ComposerSuggestionRows({
  rows,
  disabled = false,
  disableImmediateSend = false,
  variant = "composer",
  onSuggestionClick,
  onToggleCollapse,
}: ComposerSuggestionRowsProps) {
  const allSuggestions = rows.flatMap((row) => row.suggestions);
  if (allSuggestions.length === 0) {return null;}

  const quickSendGroup = allSuggestions.filter(s => s.action === "send_immediately");
  const insertGroup = allSuggestions.filter(s => s.action !== "send_immediately");
  const isFollowUpVariant = variant === "follow-up";

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
          className={`inline-flex [scroll-snap-align:start] items-center rounded-full text-left text-[12px] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:shadow-none ${
            isFollowUpVariant
              ? `max-w-full whitespace-normal px-3 py-1.5 font-medium leading-4 ${
                  isImmediate
                    ? "border border-[rgba(var(--accent-color-rgb),0.28)] bg-[rgba(var(--accent-color-rgb),0.08)] text-[var(--accent-color)] hover:bg-[rgba(var(--accent-color-rgb),0.13)]"
                    : "border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[rgba(var(--accent-color-rgb),0.35)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`
              : `shrink-0 px-3.5 py-1.5 font-semibold leading-none tracking-[0.01em] hover:-translate-y-px hover:shadow-md ${
                  isImmediate
                    ? "bg-[rgba(var(--accent-color-rgb),0.1)] text-[var(--accent-color)] hover:bg-[rgba(var(--accent-color-rgb),0.15)] ring-1 ring-[rgba(var(--accent-color-rgb),0.3)]"
                    : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] ring-1 ring-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`
          }`}
        >
          {suggestion.label}
        </button>
      </Tooltip>
    );
  };

  return (
    <div className={`${isFollowUpVariant ? "px-0 py-0" : "px-1.5 pt-1 pb-0.5"} flex items-center gap-2 group`}>
      <div className={`flex-1 min-w-0 flex gap-2.5 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
        isFollowUpVariant
          ? "h-auto flex-wrap items-start overflow-visible"
          : "h-8 items-center overflow-x-hidden group-hover:overflow-x-auto [scroll-snap-type:x_mandatory]"
      }`}>
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
