import React, { useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Pencil, RotateCcw, ChevronDown, ChevronRight, ChevronUp, BookOpen } from "lucide-react";
import type { Message } from "../stores/chatStore";
import type { SearchResult } from "../lib/api";
import ContextIndicator from "./ContextIndicator";
import { useWordHover } from "../hooks/useWordHover";
import { WordDefinitionTooltip } from "./WordDefinitionTooltip";

type ContextSources = { memories_used: string[]; artifacts_used: string[]; summaries_used: string[]; documents_used: string[] };

function splitAssistantMessage(content: string) {
  const thinkMatch = content.match(/^<think(?:\s+title="([^"]*)")?>\s*([\s\S]*?)\s*<\/think>\s*([\s\S]*)$/);
  if (thinkMatch) {
    return {
      thoughtTitle: thinkMatch[1]?.replace(/&quot;/g, "\"").trim() || null,
      thought: thinkMatch[2].trim(),
      answer: thinkMatch[3].trim(),
    };
  }

  const separatorMatch = content.match(/([\s\S]+?)\n{3,}([\s\S]+)/);
  if (!separatorMatch) {
    return null;
  }

  const thought = separatorMatch[1].trim();
  const answer = separatorMatch[2].trim();
  const looksLikeReasoning = /(I need to|I'll|Key points to cover:|I'll structure my response|The user is asking)/.test(thought);
  if (!looksLikeReasoning || !answer) {
    return null;
  }

  return { thought, answer };
}

function formatMessageTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) { return value; }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export interface ChatMessageBubbleProps {
  msg: Message;
  isLastMessage: boolean;
  isStreaming: boolean;
  chatMessageStyle: string;
  expandChatToWindowWidth: boolean;
  showGenInfo: boolean;
  editingMessageId: string | null;
  editContent: string;
  copiedMessageId: string | null;
  expandedThoughtIds: Set<string>;
  messageSources: Record<string, SearchResult[]>;
  expandedSources: string | null;
  contextSources: ContextSources | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  markdownComponents: any;
  onCopy: (msgId: string, content: string) => void;
  onStartEdit: (msgId: string, content: string) => void;
  onSubmitEdit: (msgId: string) => void;
  onSetEditContent: (content: string) => void;
  onCancelEdit: () => void;
  onRedo: (msgId: string) => void;
  onToggleThought: (msgId: string) => void;
  onToggleSources: (msgId: string) => void;
}

const ChatMessageBubble = React.memo(function ChatMessageBubble({
  msg,
  isLastMessage,
  isStreaming,
  chatMessageStyle,
  expandChatToWindowWidth,
  showGenInfo,
  editingMessageId,
  editContent,
  copiedMessageId,
  expandedThoughtIds,
  messageSources,
  expandedSources,
  contextSources,
  markdownComponents,
  onCopy,
  onStartEdit,
  onSubmitEdit,
  onSetEditContent,
  onCancelEdit,
  onRedo,
  onToggleThought,
  onToggleSources,
}: ChatMessageBubbleProps) {
  const parts = useMemo(
    () => (msg.role === "assistant" ? splitAssistantMessage(msg.content) : null),
    [msg.role, msg.content]
  );

  const thoughtExpanded = expandedThoughtIds.has(msg.id);
  const sources = messageSources[msg.id];
  const hasSources = sources && sources.length > 0;
  const isSourcesExpanded = expandedSources === msg.id;

  const assistantProseRef = useRef<HTMLDivElement>(null);
  const wordDefinition = useWordHover(assistantProseRef);

  return (
    <div
      data-msg-id={msg.id}
      className={`group/msg flex w-full min-w-0 flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
    >
      {wordDefinition && <WordDefinitionTooltip definition={wordDefinition} />}
      {editingMessageId === msg.id ? (
        <div className="w-full min-w-0 max-w-[75%] flex flex-col gap-2">
          <textarea
            value={editContent}
            onChange={(e) => onSetEditContent(e.target.value)}
            className="w-full resize-none px-3.5 py-2.5 text-sm rounded-xl bg-[var(--bg-elevated)] border border-[var(--accent-color)] text-[var(--text-primary)] outline-none max-h-40 overflow-y-auto"
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmitEdit(msg.id); }
              if (e.key === "Escape") { onCancelEdit(); }
            }}
          />
          <div className="flex gap-1.5 justify-end">
            <button
              onClick={onCancelEdit}
              className="px-2.5 py-1 text-xs rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onSubmitEdit(msg.id)}
              className="px-2.5 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 transition-opacity"
            >
              Send
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            className={`min-w-0 ${expandChatToWindowWidth ? "max-w-[90%]" : "max-w-[75%]"} break-words px-4 py-2.5 text-sm ${
              chatMessageStyle === "flat"
                ? msg.role === "user"
                  ? "rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "rounded border-l-2 border-[var(--accent-color)]/40 bg-transparent text-[var(--text-primary)]"
                : msg.role === "user"
                  ? "rounded-2xl message-user"
                  : "rounded-2xl message-assistant"
            }`}
          >
            {msg.role === "assistant" ? (
              <div className="space-y-3">
                {isLastMessage && contextSources && (
                  <ContextIndicator sources={contextSources} />
                )}
                {parts?.thought && (
                  <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/50">
                    <button
                      onClick={() => onToggleThought(msg.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    >
                      {thoughtExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span>{parts.thoughtTitle || "Thought"}</span>
                    </button>
                    {thoughtExpanded && (
                      <div className="border-t border-[var(--border-color)] px-3 py-2">
                        <div className="prose prose-sm prose-invert min-w-0 max-w-none text-[var(--text-secondary)]">
                          <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={markdownComponents}>{parts.thought}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="prose prose-sm prose-invert min-w-0 max-w-none" ref={assistantProseRef}>
                  <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {parts?.answer || msg.content}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              <p className="break-words whitespace-pre-wrap">{msg.content}</p>
            )}
          </div>
          <div className={`flex gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            <button
              onClick={() => onCopy(msg.id, msg.content)}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              title="Copy"
            >
              {copiedMessageId === msg.id ? <Check size={11} /> : <Copy size={11} />}
            </button>
            {msg.role === "user" && !isStreaming && (
              <button
                onClick={() => onStartEdit(msg.id, msg.content)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                title="Edit"
              >
                <Pencil size={11} />
              </button>
            )}
            {msg.role === "assistant" && !isStreaming && (
              <button
                onClick={() => onRedo(msg.id)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                title="Redo"
              >
                <RotateCcw size={11} />
              </button>
            )}
          </div>
          <div className={`flex items-center gap-2 text-[10px] text-[var(--text-muted)] tabular-nums ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            <span>{formatMessageTimestamp(msg.created_at)}</span>
            {showGenInfo && msg.role === "assistant" && msg.tokens_used ? (
              <span>{msg.tokens_used.toLocaleString()} tok</span>
            ) : null}
            {showGenInfo && msg.role === "assistant" && msg.duration_ms ? (
              <span>
                {msg.duration_ms >= 1000
                  ? `${(msg.duration_ms / 1000).toFixed(1)}s`
                  : `${msg.duration_ms}ms`}
              </span>
            ) : null}
            {showGenInfo && msg.role === "assistant" && msg.tokens_used && msg.duration_ms && msg.duration_ms > 0 ? (
              <span className="text-[var(--accent-color)] font-medium">
                {(msg.tokens_used / (msg.duration_ms / 1000)).toFixed(1)} tok/s
              </span>
            ) : null}
          </div>
          {/* Grounded sources for this message */}
          {hasSources && (
            <div className={`min-w-0 max-w-[75%] ${msg.role === "user" ? "self-end" : ""}`}>
              <button
                onClick={() => onToggleSources(msg.id)}
                className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                <BookOpen size={10} />
                {sources.length} source{sources.length !== 1 ? "s" : ""} used
                {isSourcesExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
              {isSourcesExpanded && (
                <div className="mt-1.5 space-y-1">
                  {sources.map((s, idx) => (
                    <div key={s.id} className="rounded-lg p-2 bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[11px]">
                      <div className="font-medium text-[var(--text-secondary)]">[{idx + 1}] {s.title}</div>
                      <div className="text-[var(--text-muted)] line-clamp-2 mt-0.5">{s.excerpt}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
});

export default ChatMessageBubble;
