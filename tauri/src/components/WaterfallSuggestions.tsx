import React, { useMemo } from "react";
import type { ComposerSuggestion } from "../lib/composerSuggestions";

interface WaterfallSuggestionsProps {
  suggestions: ComposerSuggestion[];
  onSelect: (suggestion: ComposerSuggestion) => void;
}

export function WaterfallSuggestions({ suggestions, onSelect }: WaterfallSuggestionsProps) {
  const columns = useMemo(() => {
    const cols: ComposerSuggestion[][] = [[], [], []];
    suggestions.forEach((s, i) => {
      cols[i % 3].push(s);
    });
    return cols;
  }, [suggestions]);

  if (suggestions.length === 0) return null;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-40 select-none flex justify-center gap-16 px-12 [mask-image:linear-gradient(to_bottom,transparent_0%,black_30%,black_70%,transparent_100%)]">
      {columns.map((col, i) => (
        <div
          key={i}
          className={`flex flex-col gap-8 ${i === 1 ? "animate-waterfall-reverse" : "animate-waterfall"} ${i === 0 ? "duration-[25s]" : "duration-[20s]"}`}
        >
          {col.map((s, j) => (
            <div
              key={`${s.id}-${j}`}
              className="text-2xl font-medium text-[var(--text-muted)] whitespace-nowrap pointer-events-auto cursor-pointer hover:text-[var(--accent-color)] transition-colors"
              onClick={() => onSelect(s)}
            >
              {s.label}
            </div>
          ))}
          {/* duplicate for seamless loop */}
          {col.map((s, j) => (
            <div
              key={`${s.id}-dup-${j}`}
              className="text-2xl font-medium text-[var(--text-muted)] whitespace-nowrap pointer-events-auto cursor-pointer hover:text-[var(--accent-color)] transition-colors"
              onClick={() => onSelect(s)}
            >
              {s.label}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
