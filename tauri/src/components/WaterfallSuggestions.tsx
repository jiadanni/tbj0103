import React, { useMemo } from "react";
import type { ComposerSuggestion } from "../lib/composerSuggestions";

interface WaterfallSuggestionsProps {
  suggestions: ComposerSuggestion[];
  onSelect: (suggestion: ComposerSuggestion) => void;
}

export function WaterfallSuggestions({ suggestions, onSelect }: WaterfallSuggestionsProps) {
  const columns = useMemo(() => {
    const cols: ComposerSuggestion[][] = [[], []];
    suggestions.forEach((s, i) => {
      cols[i % 2].push(s);
    });
    return cols.map((col, colIndex) => {
      const source = col.length > 0 ? col : suggestions;
      const filled: ComposerSuggestion[] = [];
      for (let i = 0; i < 5; i += 1) {
        filled.push(source[(i + colIndex) % source.length]);
      }
      return filled;
    });
  }, [suggestions]);

  if (suggestions.length === 0) { return null; }

  const renderSuggestion = (suggestion: ComposerSuggestion, key: string) => (
    <button
      key={key}
      type="button"
      className="pointer-events-auto max-w-[min(34vw,30rem)] cursor-pointer truncate rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)]/40 px-4 py-2 text-left text-[13px] font-medium text-[var(--text-muted)] backdrop-blur-sm transition-colors hover:border-[rgba(var(--accent-color-rgb),0.45)] hover:bg-[rgba(var(--accent-color-rgb),0.10)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]"
      onClick={() => onSelect(suggestion)}
    >
      {suggestion.label}
    </button>
  );

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none grid grid-cols-[minmax(0,1fr)_minmax(18rem,28rem)_minmax(0,1fr)] gap-8 px-10 opacity-55 [mask-image:linear-gradient(to_bottom,transparent_0%,black_18%,black_76%,transparent_100%)]">
      {columns.map((col, i) => (
        <div
          key={i}
          className={`flex min-w-0 flex-col gap-5 hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] ${i === 1 ? "animate-waterfall-reverse col-start-3 items-start" : "animate-waterfall col-start-1 items-end"} ${i === 0 ? "[animation-duration:48s]" : "[animation-duration:44s]"}`}
        >
          {col.map((s, j) => renderSuggestion(s, `${s.id}-${j}`))}
          {col.map((s, j) => renderSuggestion(s, `${s.id}-dup-${j}`))}
        </div>
      ))}
    </div>
  );
}
