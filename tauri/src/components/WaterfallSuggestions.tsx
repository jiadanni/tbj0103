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

  const randomUnit = (seed: string) => {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return (hash % 1000) / 1000;
  };

  const renderSuggestion = (suggestion: ComposerSuggestion, key: string, columnIndex: number, rowIndex: number) => {
    const baseSeed = `${suggestion.id}-${columnIndex}-${rowIndex}`;
    const offsetX = Math.round((randomUnit(`${baseSeed}-x`) - 0.5) * 56);
    const offsetY = Math.round(randomUnit(`${baseSeed}-y`) * 18);
    const widthBoost = 32 + Math.round(randomUnit(`${baseSeed}-w`) * 96);
    const opacity = 0.58 + randomUnit(`${baseSeed}-o`) * 0.22;

    return (
      <button
        key={key}
        type="button"
        className="pointer-events-auto w-full cursor-pointer truncate rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)]/38 px-6 py-3 text-left text-[15px] font-medium leading-6 text-[var(--text-muted)] backdrop-blur-sm transition-colors duration-200 hover:border-[rgba(var(--accent-color-rgb),0.45)] hover:bg-[rgba(var(--accent-color-rgb),0.10)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]"
        style={{
          maxWidth: `calc(30rem + ${widthBoost}px)`,
          transform: `translate(${offsetX}px, ${offsetY}px)`,
          opacity,
        }}
        onClick={() => onSelect(suggestion)}
      >
        {suggestion.label}
      </button>
    );
  };

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none grid grid-cols-[minmax(0,1fr)_minmax(0,34rem)_minmax(0,1fr)] gap-10 px-6 md:px-12 opacity-70 [mask-image:linear-gradient(to_bottom,transparent_0%,black_14%,black_80%,transparent_100%)]">
      {columns.map((col, i) => (
        <div
          key={i}
          className={`flex min-w-0 flex-col gap-8 hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] ${i === 1 ? "animate-waterfall-reverse col-start-3 items-start" : "animate-waterfall col-start-1 items-end"} ${i === 0 ? "[animation-duration:48s]" : "[animation-duration:44s]"}`}
        >
          {col.map((s, j) => renderSuggestion(s, `${s.id}-${j}`, i, j))}
          {col.map((s, j) => renderSuggestion(s, `${s.id}-dup-${j}`, i, j + col.length))}
        </div>
      ))}
    </div>
  );
}
