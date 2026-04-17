import React, { useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Pencil, RotateCcw, ChevronDown, ChevronRight, ChevronUp, ChevronLeft, BookOpen, Sparkles, Loader } from "lucide-react";
import type { Message } from "../stores/chatStore";
import type { AiModel, SearchResult } from "../lib/api";
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
  showGenInfoModel?: boolean;
  showGenInfoTokenCount?: boolean;
  showGenInfoDuration?: boolean;
  showGenInfoSpeed?: boolean;
  editingMessageId: string | null;
  editContent: string;
  copiedMessageId: string | null;
  expandedThoughtIds: Set<string>;
  messageSources: Record<string, SearchResult[]>;
  expandedSources: string | null;
  contextSources: ContextSources | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  markdownComponents: any;
  variations?: Message[];
  currentVariationIndex?: number;
  redoPickerOpen?: boolean;
  availableModels?: string[];
  aiModelList?: AiModel[];
  selectedModel?: string;
  onCopy: (msgId: string, content: string) => void;
  onStartEdit: (msgId: string, content: string) => void;
  onSubmitEdit: (msgId: string) => void;
  onSetEditContent: (content: string) => void;
  onCancelEdit: () => void;
  onRedoWithModel?: (msgId: string, modelId: string) => void;
  onToggleRedoPicker?: (msgId: string) => void;
  onVariationChange?: (msgId: string, newIndex: number) => void;
  onToggleThought: (msgId: string) => void;
  onToggleSources: (msgId: string) => void;
  onGenerateFlashcards?: (msgId: string, content: string) => void;
  flashcardGeneratingId?: string | null;
}

const ChatMessageBubble = React.memo(function ChatMessageBubble({
  msg,
  isLastMessage,
  isStreaming,
  chatMessageStyle,
  expandChatToWindowWidth,
  showGenInfo,
  showGenInfoModel,
  showGenInfoTokenCount,
  showGenInfoDuration,
  showGenInfoSpeed,
  editingMessageId,
  editContent,
  copiedMessageId,
  expandedThoughtIds,
  messageSources,
  expandedSources,
  contextSources,
  markdownComponents,
  variations,
  currentVariationIndex,
  redoPickerOpen,
  availableModels,
  aiModelList,
  selectedModel,
  onCopy,
  onStartEdit,
  onSubmitEdit,
  onSetEditContent,
  onCancelEdit,
  onRedoWithModel,
  onToggleRedoPicker,
  onVariationChange,
  onToggleThought,
  onToggleSources,
  onGenerateFlashcards,
  flashcardGeneratingId,
}: ChatMessageBubbleProps) {
  const displayMsg = (variations && currentVariationIndex !== undefined)
    ? (variations[currentVariationIndex] ?? msg)
    : msg;

  const parts = useMemo(
    () => (msg.role === "assistant" ? splitAssistantMessage(displayMsg.content) : null),
    [msg.role, displayMsg.content]
  );

  const thoughtExpanded = expandedThoughtIds.has(msg.id);
  const sources = messageSources[msg.id];
  const hasSources = sources && sources.length > 0;
  const isSourcesExpanded = expandedSources === msg.id;

  const assistantProseRef = useRef<HTMLDivElement>(null);
  const wordDefinition = useWordHover(assistantProseRef);
  const messageWidthClassName = expandChatToWindowWidth ? "max-w-[90%]" : "max-w-[75%]";
  const assistantColumnClassName = msg.role === "assistant" ? "w-full self-center" : "";
  const userBubbleWidthClassName = msg.role === "user" ? "w-fit self-end" : "";

  const varCount = variations?.length ?? 0;
  const varIdx = currentVariationIndex ?? 0;

  return (
    <div
      data-msg-id={msg.id}
      className={`group/msg flex w-full min-w-0 flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-center"}`}
    >
      {wordDefinition && <WordDefinitionTooltip definition={wordDefinition} />}
      {editingMessageId === msg.id ? (
        <div className={`w-full min-w-0 ${messageWidthClassName} flex flex-col gap-2`}>
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
            className={`min-w-0 ${messageWidthClassName} ${assistantColumnClassName} ${userBubbleWidthClassName} break-words px-4 py-2.5 text-left text-sm ${
              chatMessageStyle === "flat"
                ? msg.role === "user"
                  ? "rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "rounded border-l-2 border-[var(--accent-color)]/40 bg-transparent text-[var(--text-primary)]"
                : msg.role === "user"
                  ? "rounded-2xl message-user"
                  : "rounded-2xl message-assistant overflow-hidden"
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
                    {parts?.answer || displayMsg.content}
                  </ReactMarkdown>
                </div>
                {varCount > 1 && (
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border-color)]">
                    <button
                      onClick={() => onVariationChange?.(msg.id, varIdx - 1)}
                      disabled={varIdx === 0 || isStreaming || !onVariationChange}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-30 transition-colors"
                      title="Previous variation"
                    >
                      <ChevronLeft size={13} />
                    </button>
                    <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                      <span>{varIdx + 1} / {varCount}</span>
                      {displayMsg.model_name && (
                        <span className="px-1.5 py-0.5 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-secondary)] font-medium text-[10px]">
                          {displayMsg.model_name}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => onVariationChange?.(msg.id, varIdx + 1)}
                      disabled={varIdx >= varCount - 1 || isStreaming || !onVariationChange}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-30 transition-colors"
                      title="Next variation"
                    >
                      <ChevronRight size={13} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="break-words whitespace-pre-wrap">{msg.content}</p>
            )}
          </div>
          <div className={`flex gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity ${msg.role === "user" ? "self-end flex-row-reverse" : "self-center"}`}>
            <button
              onClick={() => onCopy(msg.id, displayMsg.content)}
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
            {msg.role === "assistant" && !isStreaming && onRedoWithModel && (
              <div className="relative flex items-center" data-redo-picker="true">
                <button
                  onClick={() => onRedoWithModel?.(msg.id, selectedModel ?? "")}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                  title={`Redo with ${selectedModel ?? "default"}`}
                >
                  <RotateCcw size={11} />
                </button>
                <button
                  onClick={() => onToggleRedoPicker?.(msg.id)}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                  title="Redo with different model"
                >
                  <ChevronDown size={10} />
                </button>
                {redoPickerOpen && availableModels && (
                  <div className="absolute bottom-full right-0 z-30 mb-1.5 w-[200px] overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1 shadow-[0_16px_40px_-16px_rgba(15,23,42,0.7)]">
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      Regenerate with
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                        {availableModels.map((modelId) => {
                          const modelMeta = aiModelList?.find((m) => m.model_id === modelId);
                          const modelName = modelMeta?.name ?? modelId;
                          const isCurrent = modelId === selectedModel;
                          return (
                            <button
                              key={modelId}
                              type="button"
                              onClick={() => onRedoWithModel?.(msg.id, modelId)}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${
                              isCurrent
                                ? "bg-[rgba(var(--accent-color-rgb),0.10)] text-[var(--text-primary)]"
                                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                            }`}
                          >
                            <span className="min-w-0 truncate">{modelName}</span>
                            {isCurrent && <Check size={11} className="shrink-0 text-[var(--accent-color)]" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {msg.role === "assistant" && !isStreaming && onGenerateFlashcards && (
              <button
                onClick={() => onGenerateFlashcards(msg.id, displayMsg.content)}
                disabled={flashcardGeneratingId === msg.id}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-color)] transition-colors disabled:opacity-50"
                title="Generate flashcards"
              >
                {flashcardGeneratingId === msg.id ? <Loader size={11} className="animate-spin" /> : <Sparkles size={11} />}
              </button>
            )}
          </div>
          <div className={`flex items-center gap-2 text-[11px] text-[var(--text-muted)] tabular-nums ${msg.role === "user" ? "self-end flex-row-reverse" : "self-center"}`}>
            <span>{formatMessageTimestamp(msg.created_at)}</span>
            {showGenInfo && showGenInfoModel && msg.role === "assistant" && displayMsg.model_name && varCount <= 1 ? (
              <span className="text-[var(--text-secondary)]">{displayMsg.model_name}</span>
            ) : null}
            {showGenInfo && showGenInfoTokenCount && msg.role === "assistant" && displayMsg.tokens_used ? (
              <span>{displayMsg.tokens_used.toLocaleString()} tok</span>
            ) : null}
            {showGenInfo && showGenInfoDuration && msg.role === "assistant" && displayMsg.duration_ms ? (
              <span>
                {displayMsg.duration_ms >= 1000
                  ? `${(displayMsg.duration_ms / 1000).toFixed(1)}s`
                  : `${displayMsg.duration_ms}ms`}
              </span>
            ) : null}
            {showGenInfo && showGenInfoSpeed && msg.role === "assistant" && displayMsg.tokens_used && displayMsg.duration_ms && displayMsg.duration_ms > 0 ? (
              <span className="text-[var(--accent-color)] font-medium">
                {(displayMsg.tokens_used / (displayMsg.duration_ms / 1000)).toFixed(1)} tok/s
              </span>
            ) : null}
          </div>
          {/* Grounded sources for this message */}
          {hasSources && (
            <div className={`min-w-0 ${messageWidthClassName} ${msg.role === "user" ? "self-end" : "w-full self-center"}`}>
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
