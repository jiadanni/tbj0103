import React, { useState } from "react";
import { MessageSquare, ExternalLink } from "lucide-react";
import type { QuickSearchResult } from "../lib/api";

interface RelatedChatPillsProps {
  relatedChats: QuickSearchResult[];
  onChatClick: (chat: QuickSearchResult) => void;
  className?: string;
}

export const RelatedChatPills: React.FC<RelatedChatPillsProps> = ({
  relatedChats,
  onChatClick,
  className = "",
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (relatedChats.length === 0) {
    return null;
  }

  return (
    <div className={`flex items-center gap-2 px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)] overflow-x-auto no-scrollbar ${className}`}>
      <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mr-2">
        <MessageSquare size={12} />
        Related
      </div>
      
      <div className="flex items-center gap-2">
        {relatedChats.map((chat) => (
          <div key={chat.doc_id} className="relative">
            <button
              onClick={() => onChatClick(chat)}
              onMouseEnter={() => setHoveredId(chat.doc_id)}
              onMouseLeave={() => setHoveredId(null)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-1 text-[11px] font-medium text-[var(--text-primary)] transition-all hover:bg-[var(--bg-hover)] hover:border-[var(--accent-color)] whitespace-nowrap"
            >
              <span className="truncate max-w-[150px]">{chat.title}</span>
              <ExternalLink size={10} className="text-[var(--text-muted)]" />
            </button>

            {hoveredId === chat.doc_id && chat.excerpt && (
              <div className="absolute top-[calc(100%+8px)] left-0 z-[100] w-72 p-3 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl shadow-2xl animate-in fade-in slide-in-from-top-1 duration-200 pointer-events-none">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                  Preview
                </div>
                <p className="text-xs leading-relaxed text-[var(--text-secondary)] line-clamp-4">
                  {chat.excerpt}
                </p>
                <div className="absolute -top-1.5 left-6 w-3 h-3 rotate-45 bg-[var(--bg-elevated)] border-l border-t border-[var(--border-color)]" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
