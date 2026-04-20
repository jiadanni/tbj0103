import React, { useState } from 'react';
import { 
  Zap, Brain, FileText, MessageSquare, 
  ChevronDown, ChevronRight 
} from 'lucide-react';

interface ContextIndicatorProps {
  sources: {
    memories_used: string[];
    artifacts_used: string[];
    summaries_used: string[];
    documents_used: string[];
  };
}

export default function ContextIndicator({ sources }: ContextIndicatorProps) {
  const [expanded, setExpanded] = useState(false);
  
  const totalSources = 
    sources.memories_used.length + 
    sources.artifacts_used.length + 
    sources.summaries_used.length + 
    sources.documents_used.length;

  if (totalSources === 0) { return null; }

  return (
    <div className="mb-4 mt-2">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
      >
        {expanded ? <ChevronDown size={12} strokeWidth={1.5} /> : <ChevronRight size={12} strokeWidth={1.5} />}
        <Zap size={10} strokeWidth={1.5} className="text-amber-400" />
        Context Used ({totalSources})
      </button>

      {expanded && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {sources.memories_used.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--message-assistant-bg)] px-3 py-2.5">
              <Brain size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-purple-400" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Memories</p>
                <p className="text-xs text-[var(--text-secondary)]">{sources.memories_used.length} active memories injected</p>
              </div>
            </div>
          )}

          {sources.artifacts_used.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--message-assistant-bg)] px-3 py-2.5">
              <FileText size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-[var(--link-color)]" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Artifacts</p>
                <p className="text-xs text-[var(--text-secondary)]">{sources.artifacts_used.length} artifacts referenced</p>
              </div>
            </div>
          )}

          {sources.summaries_used.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--message-assistant-bg)] px-3 py-2.5">
              <MessageSquare size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-emerald-400" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Summaries</p>
                <p className="text-xs text-[var(--text-secondary)]">{sources.summaries_used.length} past turn summaries</p>
              </div>
            </div>
          )}

          {sources.documents_used.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--message-assistant-bg)] px-3 py-2.5">
              <FileText size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-amber-400" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Documents</p>
                <p className="text-xs text-[var(--text-secondary)]">{sources.documents_used.length} relevant chunks retrieved</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
