import React from "react";
import type { TopicTag } from "../lib/api";

interface TopicChipsProps {
  tags: TopicTag[];
  onChipClick: (tag: string) => void;
}

export const TopicChips: React.FC<TopicChipsProps> = ({ tags, onChipClick }) => {
  if (!tags || tags.length === 0) {return null;}

  // Show top 8 tags
  const displayTags = tags.slice(0, 8);

  return (
    <div className="flex flex-row overflow-x-auto gap-2 py-1 px-1 mb-2" style={{ scrollbarWidth: "none" }}>
      {displayTags.map((t) => (
        <button
          key={t.tag}
          onClick={() => onChipClick(t.tag)}
          className="px-2 py-0.5 rounded-full bg-[var(--accent-color)]/10 text-[var(--accent-color)] text-[11px] whitespace-nowrap hover:bg-[var(--accent-color)]/20 transition-colors cursor-pointer"
          title={`Weight: ${t.weight} (${t.source})`}
        >
          {t.tag}
        </button>
      ))}
    </div>
  );
};
