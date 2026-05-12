import React, { useState } from "react";
import type { TopicTag } from "../lib/api";

interface TopicChipsProps {
  tags: TopicTag[];
  onChipClick: (tag: string) => void;
  onChipRemove?: (tag: string) => void;
}

export const TopicChips: React.FC<TopicChipsProps> = ({ tags, onChipClick, onChipRemove }) => {
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);
  if (!tags || tags.length === 0) {return null;}

  // Show top 8 tags
  const displayTags = tags.slice(0, 8);

  return (
    <div className="flex flex-row overflow-x-auto gap-2.5 px-1 py-0.5" style={{ scrollbarWidth: "none" }}>
      {displayTags.map((t) => (
        <button
          key={t.tag}
          onClick={() => onChipClick(t.tag)}
          onMouseEnter={() => setHoveredTag(t.tag)}
          onMouseLeave={() => setHoveredTag(null)}
          className="group inline-flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] px-3.5 py-1 text-[11px] font-semibold whitespace-nowrap tracking-[0.01em] text-[var(--text-secondary)] transition-all duration-300 ease-out hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] hover:-translate-y-px hover:shadow-md"
        >
          {t.tag}
          {onChipRemove && hoveredTag === t.tag && (
            <span
              role="button"
              aria-label={`Remove ${t.tag}`}
              onClick={(e) => { e.stopPropagation(); onChipRemove(t.tag); }}
              className="ml-0.5 flex items-center justify-center w-3.5 h-3.5 rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </span>
          )}
        </button>
      ))}
    </div>
  );
};
