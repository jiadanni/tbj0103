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
    <div className="flex flex-row overflow-x-auto gap-2.5 px-1 py-0.5" style={{ scrollbarWidth: "none" }}>
      {displayTags.map((t) => (
        <button
          key={t.tag}
          onClick={() => onChipClick(t.tag)}
          className="inline-flex items-center rounded-full border border-transparent bg-[rgba(255,255,255,0.06)] px-3.5 py-1 text-[11px] font-semibold whitespace-nowrap tracking-[0.01em] text-[rgba(255,255,255,0.65)] transition-all duration-150 hover:bg-[rgba(255,255,255,0.10)] hover:text-white"
          title={`Weight: ${t.weight} (${t.source})`}
        >
          {t.tag}
        </button>
      ))}
    </div>
  );
};
