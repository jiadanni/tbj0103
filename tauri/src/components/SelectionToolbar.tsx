import React, { useState } from "react";
import { MessageSquare, Copy, BookOpen } from "lucide-react";
import { useChatStore } from "../stores/chatStore";
import { Tooltip } from "./Tooltip";
import { api } from "../lib/api";

interface SelectionToolbarProps {
  x: number;
  y: number;
  text: string;
  onDismiss: () => void;
  innerRef?: React.RefObject<HTMLDivElement>;
  workspaceId?: string | null;
}

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  x,
  y,
  text,
  onDismiss,
  innerRef,
  workspaceId,
}) => {
  const isStreaming = useChatStore((s) => s.streamingSessionId !== null);
  const setPendingPromptText = useChatStore((s) => s.setPendingPromptText);
  const [definition, setDefinition] = useState<{ term: string; definition: string } | null>(null);
  const [defLoading, setDefLoading] = useState(false);
  const [defNotFound, setDefNotFound] = useState(false);

  const handleSendAsPrompt = () => {
    if (isStreaming) {return;}
    setPendingPromptText(text);
    onDismiss();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
    onDismiss();
  };

  const handleDefine = async () => {
    if (!workspaceId || defLoading) {return;}
    setDefLoading(true);
    setDefNotFound(false);
    setDefinition(null);
    try {
      const phrase = text.trim().toLowerCase();
      const result = await api.workspaceGlossary.resolve(workspaceId, [phrase]);
      if (result) {
        setDefinition({ term: result.term, definition: result.definition });
      } else {
        setDefNotFound(true);
      }
    } catch (err) {
      console.error("Glossary lookup error:", err);
      setDefNotFound(true);
    } finally {
      setDefLoading(false);
    }
  };

  return (
    <div
      ref={innerRef}
      className="fixed z-50 flex flex-col -translate-x-1/2 -translate-y-[calc(100%+8px)] bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-lg shadow-xl animate-in fade-in zoom-in duration-200"
      style={{ left: x, top: y }}
    >
      <div className="flex items-center gap-1 p-1">
        <Tooltip content="Send selection as prompt" position="top">
          <button
            onClick={handleSendAsPrompt}
            disabled={isStreaming}
            className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <MessageSquare size={14} className="w-3.5 h-3.5" />
            <span>Prompt</span>
          </button>
        </Tooltip>

        <div className="w-px h-3 bg-[var(--border-color)] mx-0.5" />

        <Tooltip content="Copy selection" position="top">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
          >
            <Copy size={14} className="w-3.5 h-3.5" />
            <span>Copy</span>
          </button>
        </Tooltip>

        {workspaceId && (
          <>
            <div className="w-px h-3 bg-[var(--border-color)] mx-0.5" />
            <Tooltip content="Look up in workspace glossary" position="top">
              <button
                onClick={handleDefine}
                disabled={defLoading}
                className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded disabled:opacity-50 transition-colors"
              >
                <BookOpen size={14} className="w-3.5 h-3.5" />
                <span>{defLoading ? "..." : "Define"}</span>
              </button>
            </Tooltip>
          </>
        )}
      </div>

      {definition && (
        <div className="px-3 pb-2 pt-0 border-t border-[var(--border-color)] max-w-xs">
          <p className="text-xs font-semibold text-[var(--text-primary)] mt-2">{definition.term}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">{definition.definition}</p>
        </div>
      )}

      {defNotFound && (
        <div className="px-3 pb-2 pt-0 border-t border-[var(--border-color)]">
          <p className="text-xs text-[var(--text-muted)] mt-2 italic">No glossary entry found.</p>
        </div>
      )}
    </div>
  );
};
