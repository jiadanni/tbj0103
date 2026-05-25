import React, { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Check, Copy, Pencil, RotateCcw, ChevronDown, ChevronRight, ChevronUp, ChevronLeft, BookOpen, Sparkles, Loader } from "lucide-react";
import type { Message } from "../stores/chatStore";
import type { AiModel, SearchResult } from "../lib/api";
import ContextIndicator from "./ContextIndicator";
import { Tooltip } from "./Tooltip";
import HoverDefinitionSurface from "./HoverDefinitionSurface";
import { useScopedWorkspace } from "../lib/workspacePane";
import { useSettingsStore } from "../stores/settingsStore";

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

interface ChatMessageBubbleProps {
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

  const redoToggleRef = useRef<HTMLButtonElement>(null);
  const [redoPickerStyle, setRedoPickerStyle] = useState<{ bottom: number; right: number } | null>(null);
  const { activeWorkspaceId } = useScopedWorkspace();
  const userChatLabel = useSettingsStore((s) => s.userChatLabel);
  const assistantChatLabel = useSettingsStore((s) => s.assistantChatLabel);
  useEffect(() => {
    if (redoPickerOpen && redoToggleRef.current) {
      const rect = redoToggleRef.current.getBoundingClientRect();
      setRedoPickerStyle({ bottom: window.innerHeight - rect.top + 6, right: window.innerWidth - rect.right });
    } else {
      setRedoPickerStyle(null);
    }
  }, [redoPickerOpen]);
  const isMinimal = chatMessageStyle === "minimal";
  const messageWidthClassName = isMinimal ? "w-full" : expandChatToWindowWidth ? "max-w-[90%]" : "max-w-[75%]";
  const assistantColumnClassName = isMinimal ? "w-full" : msg.role === "assistant" ? "w-full self-center" : "";
  const userBubbleWidthClassName = isMinimal ? "w-full" : msg.role === "user" ? "w-fit self-end" : "";
  const assistantBubbleClassName = "rounded-[24px] message-assistant overflow-hidden shadow-none";
  const userBubbleClassName = "rounded-[24px] message-user shadow-none";

  const varCount = variations?.length ?? 0;
  const varIdx = currentVariationIndex ?? 0;
  const isWebModel = useMemo(() => {
    if (!aiModelList || !displayMsg.model_name) {return false;}
    const model = aiModelList.find((m) => m.model_id === displayMsg.model_name || m.name === displayMsg.model_name);
    return model?.provider.startsWith("web_") ?? false;
  }, [aiModelList, displayMsg.model_name]);

  return (
    <div
      data-msg-id={msg.id}
      className={`group/msg flex w-full min-w-0 flex-col ${isMinimal ? "gap-2 items-start" : `gap-1 ${msg.role === "user" ? "items-end" : "items-center"}`}`}
    >
      {isMinimal && (
        <div className="text-xs font-semibold text-[var(--text-muted)] tracking-wide">
          {msg.role === "user" ? userChatLabel : assistantChatLabel}
        </div>
      )}
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
            data-testid={msg.role === "assistant" ? "assistant-bubble" : "user-bubble"}
            className={`min-w-0 ${messageWidthClassName} ${assistantColumnClassName} ${userBubbleWidthClassName} break-words text-left text-sm ${
              isMinimal
                ? "px-0 py-2 text-[var(--text-primary)]"
                : chatMessageStyle === "flat"
                  ? msg.role === "user"
                    ? "px-4 py-2.5 rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                    : "px-4 py-2.5 rounded border-l-2 border-[var(--accent-color)]/40 bg-transparent text-[var(--text-primary)]"
                  : msg.role === "user"
                    ? "px-4 py-2.5 " + userBubbleClassName
                    : "px-4 py-2.5 " + assistantBubbleClassName
            }`}
          >
            {msg.role === "assistant" ? (
              <div className="space-y-3">
                {isLastMessage && contextSources && (
                  <ContextIndicator sources={contextSources} />
                )}
                {parts?.thought && (
                  <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)]/78">
                    <button
                      onClick={() => onToggleThought(msg.id)}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
                    >
                      {thoughtExpanded ? <ChevronDown size={12} strokeWidth={1.5} /> : <ChevronRight size={12} strokeWidth={1.5} />}
                      <span>{parts.thoughtTitle || "Thought"}</span>
                    </button>
                    {thoughtExpanded && (
                      <div className="border-t border-[var(--border-color)] px-3 py-2.5">
                        <div className="prose prose-sm prose-invert min-w-0 max-w-none text-[var(--text-secondary)]">
                          <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>{parts.thought}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <HoverDefinitionSurface
                  workspaceId={activeWorkspaceId}
                  className="prose prose-sm prose-invert min-w-0 max-w-none"
                >
                  <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                    {parts?.answer || displayMsg.content}
                  </ReactMarkdown>
                </HoverDefinitionSurface>
                {varCount > 1 && (
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border-color)]">
                    <Tooltip content="Previous variation">
                      <button
                        onClick={() => onVariationChange?.(msg.id, varIdx - 1)}
                        disabled={varIdx === 0 || isStreaming || !onVariationChange}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-30 transition-colors"
                      >
                        <ChevronLeft size={13} strokeWidth={1.5} />
                      </button>
                    </Tooltip>
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1 items-center">
                        {Array.from({ length: varCount }).map((_, i) => (
                            <Tooltip key={i} content={i === varIdx ? "Current variant" : "Other variant"}>
                              <span
                                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                                  i === varIdx
                                    ? "bg-[var(--accent-color)]"
                                    : "bg-[var(--border-color)] opacity-40"
                                }`}
                              />
                            </Tooltip>
                        ))}
                      </div>
                      {displayMsg.model_name && (
                        <span className="px-1.5 py-0.5 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-secondary)] font-medium text-[10px]">
                          {displayMsg.model_name}
                        </span>
                      )}
                    </div>
                    <Tooltip content="Next variation">
                      <button
                        onClick={() => onVariationChange?.(msg.id, varIdx + 1)}
                        disabled={varIdx >= varCount - 1 || isStreaming || !onVariationChange}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-30 transition-colors"
                      >
                        <ChevronRight size={13} strokeWidth={1.5} />
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>
            ) : (
              <p className="break-words whitespace-pre-wrap">{msg.content}</p>
            )}
          </div>
          <div className={`flex gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity ${isMinimal ? "self-start" : msg.role === "user" ? "self-end flex-row-reverse" : "self-center"}`}>
            <Tooltip content="Copy">
              <button
                onClick={() => onCopy(msg.id, displayMsg.content)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {copiedMessageId === msg.id ? <Check size={11} /> : <Copy size={11} />}
              </button>
            </Tooltip>
            {msg.role === "user" && !isStreaming && (
              <Tooltip content="Edit">
                <button
                  onClick={() => onStartEdit(msg.id, msg.content)}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                >
                  <Pencil size={11} />
                </button>
              </Tooltip>
            )}
            {msg.role === "assistant" && !isStreaming && onRedoWithModel && (
              <div className="relative flex items-center" data-redo-picker="true">
                <Tooltip content={`Redo with ${selectedModel ?? "default"}`}>
                  <button
                    onClick={() => onRedoWithModel?.(msg.id, selectedModel ?? "")}
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    <RotateCcw size={11} strokeWidth={1.5} />
                  </button>
                </Tooltip>
                <Tooltip content="Redo with different model">
                  <button
                    ref={redoToggleRef}
                    onClick={() => onToggleRedoPicker?.(msg.id)}
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    <ChevronDown size={10} strokeWidth={1.5} />
                  </button>
                </Tooltip>
                {redoPickerOpen && availableModels && redoPickerStyle && createPortal((() => {
                  const providerOrder: Record<string, number> = { ollama: 0, mlx: 1, llamacpp: 2, openai: 3 };
                  const groups = new Map<string, { label: string; order: number; modelIds: string[] }>();
                  availableModels.forEach((modelId) => {
                    const meta = aiModelList?.find((m) => m.model_id === modelId);
                    const provider = meta?.provider ?? "other";
                    const label = provider === "ollama" ? "Ollama" : provider === "mlx" ? "MLX" : provider === "llamacpp" ? "llama.cpp" : provider.startsWith("web_") ? "Web" : provider;
                    const existing = groups.get(label);
                    if (existing) { existing.modelIds.push(modelId); }
                    else { groups.set(label, { label, order: providerOrder[provider] ?? 99, modelIds: [modelId] }); }
                  });
                  const sortedGroups = Array.from(groups.values()).sort((a, b) => a.order - b.order);
                  return (
                    <div
                      data-redo-picker="true"
                      className="fixed z-[9999] w-[220px] overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1 shadow-[0_16px_40px_-16px_rgba(15,23,42,0.7)]"
                      style={{ bottom: redoPickerStyle.bottom, right: redoPickerStyle.right }}
                    >
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        Regenerate with
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {sortedGroups.map((group) => (
                          <div key={group.label}>
                            <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] opacity-60">
                              {group.label}
                            </div>
                            {group.modelIds.map((modelId) => {
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
                                  {isCurrent && <Check size={11} strokeWidth={1.5} className="shrink-0 text-[var(--accent-color)]" />}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })(), document.body)}
              </div>
            )}
            {msg.role === "assistant" && !isStreaming && onGenerateFlashcards && (
              <Tooltip content="Generate flashcards">
                <button
                  onClick={() => onGenerateFlashcards(msg.id, displayMsg.content)}
                  disabled={flashcardGeneratingId === msg.id}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-color)] transition-colors disabled:opacity-50"
                >
                  {flashcardGeneratingId === msg.id ? <Loader size={11} className="animate-spin" /> : <Sparkles size={11} />}
                </button>
              </Tooltip>
            )}
          </div>
          <div className={`flex items-center gap-2.5 text-[10px] font-medium tracking-[0.02em] text-[var(--text-muted)] tabular-nums ${isMinimal ? "self-start" : msg.role === "user" ? "self-end flex-row-reverse" : "self-center"}`}>
            <span>{formatMessageTimestamp(msg.created_at)}</span>
            {showGenInfo && showGenInfoModel && msg.role === "assistant" && displayMsg.model_name && varCount <= 1 ? (
              <span className="text-[var(--text-secondary)]">{displayMsg.model_name}</span>
            ) : null}
            {showGenInfo && showGenInfoTokenCount && !isWebModel && msg.role === "assistant" && displayMsg.tokens_used ? (
              <span>{displayMsg.tokens_used.toLocaleString()} tok</span>
            ) : null}
            {showGenInfo && showGenInfoDuration && msg.role === "assistant" && displayMsg.duration_ms ? (
              <span>
                {displayMsg.duration_ms >= 1000
                  ? `${(displayMsg.duration_ms / 1000).toFixed(1)}s`
                  : `${displayMsg.duration_ms}ms`}
              </span>
            ) : null}
            {showGenInfo && showGenInfoSpeed && !isWebModel && msg.role === "assistant" && displayMsg.tokens_used && displayMsg.duration_ms && displayMsg.duration_ms > 0 ? (
              <span className="text-[var(--accent-color)] font-medium">
                {(displayMsg.tokens_used / (displayMsg.duration_ms / 1000)).toFixed(1)} tok/s
              </span>
            ) : null}
            {showGenInfo && showGenInfoSpeed && !isWebModel && msg.role === "assistant" && displayMsg.load_duration_ms && displayMsg.load_duration_ms > 500 ? (
              <span className="text-[var(--text-muted)]">
                · loaded {displayMsg.load_duration_ms >= 1000
                  ? `${(displayMsg.load_duration_ms / 1000).toFixed(1)}s`
                  : `${displayMsg.load_duration_ms}ms`}
              </span>
            ) : null}
          </div>
          {/* Grounded sources for this message */}
          {hasSources && (
            <div className={`min-w-0 ${messageWidthClassName} ${msg.role === "user" ? "self-end" : "w-full self-center"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => onToggleSources(msg.id)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
                >
                  <BookOpen size={10} strokeWidth={1.5} className="text-[var(--link-color)]" />
                  Sources
                  <span className="text-[var(--text-secondary)]">({sources.length})</span>
                  {isSourcesExpanded ? <ChevronUp size={10} strokeWidth={1.5} /> : <ChevronDown size={10} strokeWidth={1.5} />}
                </button>
                {sources.map((s, idx) => (
                    <Tooltip key={s.id} content={s.title}>
                      <button
                        type="button"
                        data-testid="grounded-source-chip"
                        onClick={() => {
                          if (!isSourcesExpanded) {
                            onToggleSources(msg.id);
                          }
                        }}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--message-assistant-bg)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[rgba(var(--accent-color-rgb),0.24)] hover:text-[var(--link-color)]"
                      >
                        <BookOpen size={11} strokeWidth={1.5} className="shrink-0 text-[var(--link-color)]" />
                        <span className="truncate">{s.title || `Source ${idx + 1}`}</span>
                      </button>
                    </Tooltip>
                ))}
              </div>
              {isSourcesExpanded && (
                <div className="mt-2 space-y-2">
                  {sources.map((s, idx) => (
                    <div key={s.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-2.5 text-[11px]">
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        <BookOpen size={10} strokeWidth={1.5} className="text-[var(--link-color)]" />
                        <span>Source {idx + 1}</span>
                      </div>
                      <div className="mt-1 text-[var(--text-secondary)]">{s.title}</div>
                      <div className="mt-1 line-clamp-2 text-[var(--text-muted)]">{s.excerpt}</div>
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
