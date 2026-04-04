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
      className="fixed z-[60] pointer-events-none -translate-x-1/2 -translate-y-[calc(100%+16px)] w-64 p-3 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl shadow-2xl animate-in fade-in slide-in-from-bottom-1 duration-200"
      style={{ left: definition.x, top: definition.y }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-bold text-[var(--text-primary)]">
          {definition.word}
        </span>
        {definition.isTechTerm && (
          <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-accent/20 text-accent rounded-md border border-accent/20">
            Tech
          </span>
        )}
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
        className="absolute left-1/2 -bottom-1.5 -translate-x-1/2 w-3 h-3 rotate-45 bg-[var(--bg-elevated)] border-r border-b border-[var(--border-color)]"
      />
    </div>
  );
};
