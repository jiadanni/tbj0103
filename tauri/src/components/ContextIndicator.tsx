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
    <div className="mt-2 mb-4">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Zap size={10} className="text-amber-500 fill-amber-500" />
        Context Used ({totalSources})
      </button>

      {expanded && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {sources.memories_used.length > 0 && (
            <div className="flex items-start gap-2 p-2 rounded bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
              <Brain size={14} className="text-purple-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-zinc-500 uppercase">Memories</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">{sources.memories_used.length} active memories injected</p>
              </div>
            </div>
          )}

          {sources.artifacts_used.length > 0 && (
            <div className="flex items-start gap-2 p-2 rounded bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
              <FileText size={14} className="text-blue-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-zinc-500 uppercase">Artifacts</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">{sources.artifacts_used.length} artifacts referenced</p>
              </div>
            </div>
          )}

          {sources.summaries_used.length > 0 && (
            <div className="flex items-start gap-2 p-2 rounded bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
              <MessageSquare size={14} className="text-green-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-zinc-500 uppercase">Summaries</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">{sources.summaries_used.length} past turn summaries</p>
              </div>
            </div>
          )}

          {sources.documents_used.length > 0 && (
            <div className="flex items-start gap-2 p-2 rounded bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
              <FileText size={14} className="text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-zinc-500 uppercase">Documents (RAG)</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">{sources.documents_used.length} relevant chunks retrieved</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
