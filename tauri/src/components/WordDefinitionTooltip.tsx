import React from "react";
import { WordDefinition } from "../hooks/useWordHover";

interface WordDefinitionTooltipProps {
  definition: WordDefinition;
}

/**
 * Tooltip that displays a word definition.
 * Positioned above the cursor.
 */
export const WordDefinitionTooltip: React.FC<WordDefinitionTooltipProps> = ({
  definition,
}) => {
  return (
    <div
      className="fixed z-[60] pointer-events-none -translate-x-1/2 -translate-y-[calc(100%+16px)] w-64 rounded-xl border border-[var(--tooltip-border)] bg-[var(--tooltip-bg)] p-3 shadow-2xl animate-in fade-in slide-in-from-bottom-1 duration-200"
      style={{ left: definition.x, top: definition.y }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-bold text-[var(--text-primary)]">
          {definition.word}
        </span>
        <span className="rounded-md border border-[var(--tooltip-border)] bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
          {definition.source === "workspace" ? "Workspace" : definition.source === "tech" ? "Tech" : "Dictionary"}
        </span>
      </div>

      {(definition.phonetic || definition.partOfSpeech) && (
        <div className="flex items-center gap-2 mb-2 text-[10px] font-medium">
          {definition.phonetic && (
            <span className="text-[var(--text-muted)]">{definition.phonetic}</span>
          )}
          {definition.partOfSpeech && (
            <span className="italic text-accent">{definition.partOfSpeech}</span>
          )}
        </div>
      )}

      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
        {definition.definition}
      </p>

      {/* Triangle pointer */}
      <div 
        className="absolute left-1/2 -bottom-1.5 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-[var(--tooltip-border)] bg-[var(--tooltip-bg)]"
      />
    </div>
  );
};
