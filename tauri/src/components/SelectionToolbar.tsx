import React from "react";
import { MessageSquare, Copy } from "lucide-react";
import { useChatStore } from "../stores/chatStore";
import { Tooltip } from "./Tooltip";

interface SelectionToolbarProps {
  x: number;
  y: number;
  text: string;
  onDismiss: () => void;
  innerRef?: React.RefObject<HTMLDivElement>;
}

/**
 * Floating toolbar that appears above selected text.
 */
export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  x,
  y,
  text,
  onDismiss,
  innerRef,
}) => {
  const isStreaming = useChatStore((s) => s.streamingSessionId !== null);
  const setPendingPromptText = useChatStore((s) => s.setPendingPromptText);

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

  return (
    <div
      ref={innerRef}
      className="fixed z-50 flex items-center gap-1 p-1 -translate-x-1/2 -translate-y-[calc(100%+8px)] bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-lg shadow-xl animate-in fade-in zoom-in duration-200"
      style={{ left: x, top: y }}
    >
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
    </div>
  );
};
