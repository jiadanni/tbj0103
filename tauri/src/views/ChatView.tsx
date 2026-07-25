import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { WaterfallSuggestions } from "../components/WaterfallSuggestions";
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { Send, Plus, Trash2, ChevronDown, ArrowLeft, ArrowUpCircle, Pencil, Check, MessageSquare, SplitSquareHorizontal, RefreshCw, Paperclip, Image, FileText, ChevronUp, Zap, Inbox, Clock, CheckCircle2, Loader2, X, Globe, Ghost, Shield, Info } from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { message } from "@tauri-apps/plugin-dialog";
import { open } from "@tauri-apps/plugin-shell";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { api, type AiModel, type OllamaModel, type SearchResult, type QuickSearchResult, type ThoughtItem, type AppSettings, type Memory, type TopicSignature, type ConversationSummary } from "../lib/api";
import { useChatStore, findUnusedSession } from "../stores/chatStore";
import { useWorkspaceStore, type Folder, type Workspace } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { ChatSession, Message } from "../stores/chatStore";
import ComposerSuggestionRows from "../components/ComposerSuggestionRows";
import { RelatedChatPills } from "../components/RelatedChatPills";
import { WorkspaceMigrationBanner } from "../components/WorkspaceMigrationBanner";
import ChatMessageBubble from "../components/ChatMessageBubble";
import ChatMinimap from "../components/ChatMinimap";
import { Tooltip } from "../components/Tooltip";
import SuccessDialog from "../components/SuccessDialog";
import { useScopedChat, useScopedFolders, useScopedWorkspace, useWorkspacePane, useBubbleUpFlag } from "../lib/workspacePane";
import {
  mergeComposerInput,
  type ComposerSuggestion,
} from "../lib/composerSuggestions";
import { useComposerSuggestions } from "../hooks/useComposerSuggestions";
import { useDueThoughts } from "../hooks/useDueThoughts";
import { resolveModelDisplayName } from "../lib/modelDisplayName";
import { useModelPickerGroups } from "../hooks/useModelPickerGroups";
import { useModelFamilyPicker } from "../hooks/useModelFamilyPicker";
import { useTopicSignatureRefresh } from "../hooks/useTopicSignatureRefresh";
import { resolveChatTitle } from "../lib/chatTitles";
import { useTextSelectionToolbar } from "../hooks/useTextSelectionToolbar";
import { SelectionToolbar } from "../components/SelectionToolbar";
import { ContextWindowBar } from "../components/ContextWindowBar";
import { useUIStore } from "../stores/uiStore";
import { CodeBlockRenderer } from "../components/CodeBlockRenderer";
import { StreamingBubble } from "../components/StreamingBubble";
import { FamilyPickerMenu } from "../components/FamilyPickerMenu";
import { SessionSidebar, clampSessionSidebarWidth } from "../components/SessionSidebar";

import type { ChatSubView } from "../components/navigationItems";
import {
  hasPendingWorkspacePrompts,
  markWorkspacePromptsInFlight,
  clearWorkspacePromptsInFlight,
} from "./chatViewDedup";


// Diagnostic logger for chat-mount/load timing investigation. Off by default;
// enable from DevTools with `localStorage.setItem("aetherium:chat-diag","1")`
// (or `?chatdiag=1` in the URL) and reload. Disabled checks are cheap so this
// is safe to leave in production code.
const chatViewBootStart = (typeof window !== "undefined" && window.performance ? window.performance.now() : 0);
// Resolve once at module load. Toggling the flag requires a reload, which is
// fine for a diagnostic. Keeps the per-render branch a single boolean read.
const CHAT_DIAG_ENABLED = (() => {
  try {
    if (typeof window === "undefined") { return false; }
    if (window.localStorage?.getItem("aetherium:chat-diag") === "1") { return true; }
    if (window.location?.search?.includes("chatdiag=1")) { return true; }
  } catch {
    // localStorage / location access can throw in sandboxed contexts
  }
  return false;
})();
// High-frequency events ("ChatView render") only go to the DevTools console;
// they fire dozens of times per navigation and IPC-forwarding each one would
// itself create the kind of load we're trying to diagnose. Anything tagged in
// HIGH_FREQUENCY_STAGES is console-only. Everything else also mirrors to the
// persistent backend log so post-mortem diagnosis doesn't require DevTools
// being open at the moment of the bug.
const HIGH_FREQUENCY_STAGES = new Set(["ChatView render"]);
function chatViewDiag(stage: string, extra?: Record<string, unknown>) {
  if (!CHAT_DIAG_ENABLED) { return; }
  const t = typeof window !== "undefined" && window.performance ? window.performance.now() : 0;
  const since = (t - chatViewBootStart).toFixed(1);
  const message = `+${since}ms ${stage}`;
  // eslint-disable-next-line no-console
  console.log(`[chat-diag] ${message}`, extra ?? {});
  if (HIGH_FREQUENCY_STAGES.has(stage)) { return; }
  try {
    const metadata = extra && Object.keys(extra).length > 0 ? JSON.stringify(extra) : undefined;
    api.logs.logFrontendEvent("info", "chat-diag", message, metadata).catch(() => {});
  } catch {
    // Never let logging fail the caller.
  }
}

function splitAttachmentIntoExcerpts(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) { return []; }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const segments = paragraphs.length > 0 ? paragraphs : [normalized];
  return segments.flatMap((segment) => {
    if (segment.length <= 1200) { return [segment]; }
    const chunkSize = 1200;
    const overlap = 200;
    const chunks: string[] = [];
    for (let start = 0; start < segment.length; start += chunkSize - overlap) {
      chunks.push(segment.slice(start, start + chunkSize).trim());
      if (start + chunkSize >= segment.length) { break; }
    }
    return chunks;
  });
}

function pickInfoSummary(summaries: ConversationSummary[]): ConversationSummary | null {
  return summaries.find((summary) => summary.summary_type === "info" && summary.content.trim().length > 0) ?? null;
}

function buildAttachmentContext(query: string, attachments: Array<{ title: string; content: string }>) {
  const queryTerms = Array.from(new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 3),
  ));
  const excerpts: string[] = [];

  for (const attachment of attachments.slice(0, 4)) {
    const rankedExcerpts = splitAttachmentIntoExcerpts(attachment.content)
      .map((excerpt) => {
        const haystack = excerpt.toLowerCase();
        const score = queryTerms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
        return { excerpt, score };
      })
      .sort((left, right) => {
        if (right.score !== left.score) { return right.score - left.score; }
        return left.excerpt.length - right.excerpt.length;
      })
      .slice(0, 2)
      .map(({ excerpt }) => excerpt);

    if (rankedExcerpts.length === 0) { continue; }

    excerpts.push(
      `Attachment: ${attachment.title}\n` +
      rankedExcerpts.map((excerpt, index) => `[${index + 1}] ${excerpt}`).join("\n\n"),
    );
  }

  if (excerpts.length === 0) { return null; }

  return [
    "Use the attached source material below when it is relevant to the user request.",
    "Cite the attachment title when you rely on it.",
    "",
    excerpts.join("\n\n"),
  ].join("\n");
}

function buildWorkspaceDomainContext(
  workspace: Workspace | null,
  folder: Folder | null,
  topicSignature: TopicSignature | null,
): string | null {
  const parts: string[] = [];

  // Use topic signature domain tags as the primary context signal (more
  // reliable than workspace name which may be abbreviated, sentimental, or a
  // misspelling).
  if (topicSignature) {
    const activeTags = topicSignature.auto_detected_tags
      .filter((t) => !topicSignature.excluded_tags.includes(t.tag))
      .map((t) => t.tag);
    for (const tag of topicSignature.custom_tags) {
      if (!topicSignature.excluded_tags.includes(tag) && !activeTags.includes(tag)) {
        activeTags.push(tag);
      }
    }
    if (activeTags.length > 0) {
      parts.push(`Domain context: ${activeTags.join(", ")}`);
    }
  }

  // Workspace description provides additional semantic context
  if (workspace?.description?.trim()) {
    parts.push(workspace.description.trim());
  }

  // Workspace-level instructions
  if (workspace?.prompt_instructions?.trim()) {
    parts.push(workspace.prompt_instructions.trim());
  }

  // Folder-level instructions
  if (folder?.custom_instructions?.trim()) {
    parts.push(folder.custom_instructions.trim());
  }

  if (parts.length === 0) { return null; }
  return parts.join("\n");
}

interface ConfirmDialogState {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string | null;
  tone?: "danger" | "default";
}

function canRefreshSessionTitle(
  session: ChatSession,
  messageMap: Record<string, Message[]>,
) {
  const loadedMessages = messageMap[session.id];
  if (loadedMessages) {
    return loadedMessages.some((message) => message.role === "user" || message.role === "assistant");
  }
  return (session.message_count_at_title_gen ?? 0) > 0;
}

function chatExportFilename(title: string) {
  const base = (title || "chat")
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${base || "chat"}.json`;
}

function persistedUserMessageWithFallback(optimistic: Message, persisted: Message): Message {
  return {
    ...optimistic,
    ...persisted,
    id: optimistic.id,
  };
}

export default function ChatView() {
  chatViewDiag("ChatView render");
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId: routeSessionId } = useParams();
  const workspacePane = useWorkspacePane();
  const isSplitPane = workspacePane !== null;
  const currentPaneId = workspacePane?.paneId ?? null;

  const { activeChatId, setActiveChatId } = useScopedChat();
  const globalSessions = useChatStore((s) => s.sessions);
  // Granular selectors to avoid re-rendering entire view on every message update in background sessions
  const activeChatMessages = useChatStore(useCallback((s) => activeChatId ? (s.messages[activeChatId] ?? []) : [], [activeChatId]));
  const hasLoadedActiveMessages = useChatStore(useCallback((s) => activeChatId ? s.messages[activeChatId] !== undefined : false, [activeChatId]));
  const setMessages = useChatStore((s) => s.setMessages);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const appendStreamChunk = useChatStore((s) => s.appendStreamChunk);
  const finalizeStream = useChatStore((s) => s.finalizeStream);
  const setStreamingSession = useChatStore((s) => s.setStreamingSession);
  const streamingSessionId = useChatStore((s) => s.streamingSessionId);
  const streamingContentForMinimap = useChatStore((s) => s.streamingContent);
  const updateMessage = useChatStore((s) => s.updateMessage);

  const activeFolderId = useWorkspaceStore((s) => s.activeFolderId);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activePaneId = useWorkspaceStore((s) => s.activePaneId);
  const isDemoMode = useWorkspaceStore((s) => s.isDemoMode);
  const setFoldersForWorkspace = useWorkspaceStore((s) => s.setFoldersForWorkspace);
  const foldersByWorkspace = useWorkspaceStore((s) => s.foldersByWorkspace);
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const {
    activeFolderId: scopedFolderId,
    setActiveWorkspaceId: setScopedWorkspaceId,
    setActiveFolderId: setScopedFolderId,
    activeWorkspaceId: scopedWorkspaceId,
  } = useScopedWorkspace();
  const activeTopicSignature = useWorkspaceStore((s) => s.activeTopicSignature);
  const setActiveTopicSignature = useWorkspaceStore((s) => s.setActiveTopicSignature);
  const setWorkspaceTopicSignature = useWorkspaceStore((s) => s.setWorkspaceTopicSignature);
  const setMigrationSuggestion = useWorkspaceStore((s) => s.setMigrationSuggestion);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const folders = useScopedFolders();
  const preferredModel = useSettingsStore((s) => s.preferredModel);
  const draftModel = useSettingsStore((s) => s.draftModel);
  const setPreferredModel = useSettingsStore((s) => s.setPreferredModel);
  const ollamaUrl = useSettingsStore((s) => s.ollamaUrl);
  const savedCompareA = useSettingsStore((s) => s.compareModelA);
  const savedCompareB = useSettingsStore((s) => s.compareModelB);
  const saveCompareA = useSettingsStore((s) => s.setCompareModelA);
  const saveCompareB = useSettingsStore((s) => s.setCompareModelB);
  const modelLabels = useSettingsStore((s) => s.modelLabels);
  const skipLinkConfirm = useSettingsStore((s) => s.skipLinkConfirm);
  const setSkipLinkConfirm = useSettingsStore((s) => s.setSkipLinkConfirm);
  const showGenInfo = useSettingsStore((s) => s.showGenInfo);
  const showGenInfoModel = useSettingsStore((s) => s.showGenInfoModel);
  const showGenInfoTokenCount = useSettingsStore((s) => s.showGenInfoTokenCount);
  const showGenInfoDuration = useSettingsStore((s) => s.showGenInfoDuration);
  const showGenInfoSpeed = useSettingsStore((s) => s.showGenInfoSpeed);
  const scrollToTopOnSend = useSettingsStore((s) => s.scrollToTopOnSend);
  const chatMessageStyle = useSettingsStore((s) => s.chatMessageStyle);
  const expandChatToWindowWidth = useSettingsStore((s) => s.expandChatToWindowWidth);
  const codeBlockContainerStyle = useSettingsStore((s) => s.codeBlockContainerStyle);
  const codeBlockColorPalette = useSettingsStore((s) => s.codeBlockColorPalette);
  const codeBlockKeywordColor = useSettingsStore((s) => s.codeBlockKeywordColor);
  const showComposerWorkspaceSuggestions = useSettingsStore((s) => s.showComposerWorkspaceSuggestions);
  const showComposerChatFollowUps = useSettingsStore((s) => s.showComposerChatFollowUps);
  const sidebarWidth = useSettingsStore((state) => state.sidebarWidth);
  const setSidebarWidth = useSettingsStore((state) => state.setSidebarWidth);
  const modelRefreshCounter = useSettingsStore((s) => s.modelRefreshCounter);
  const composerMode = useSettingsStore((s) => s.composerMode);
  const modelFamilyLabels = useSettingsStore((s) => s.modelFamilyLabels);
  const customModelFamilies = useSettingsStore((s) => s.customModelFamilies);
  const composerSelectClassName = "h-10 w-full appearance-none rounded-full bg-black/20 shadow-inner pl-4 pr-10 text-[12px] font-semibold tracking-[0.01em] text-[var(--text-primary)] outline-none transition-all duration-300 hover:bg-[var(--bg-secondary)]/50 focus:bg-[var(--bg-secondary)]/60 focus:ring-1 focus:ring-[var(--accent-color)]";
  const composerToggleBaseClass = "inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-[12px] font-semibold tracking-[0.01em] transition-all duration-200 hover:-translate-y-px hover:shadow-md active:scale-95";
  const composerToggleInactiveClass = "bg-white/[0.03] ring-1 ring-white/5 text-[var(--text-secondary)] hover:bg-white/[0.08] hover:text-[var(--text-primary)]";
  const composerToggleActiveClass = "bg-[var(--bg-hover)] text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--accent-color)]/30";
  const composerIconOnlyButtonClass = "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl text-[var(--text-muted)] transition-all duration-200 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] hover:shadow-sm active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";


  const [input, setInput] = useState("");
  const [isPolishingPrompt, setIsPolishingPrompt] = useState(false);
  const [polishUndoInput, setPolishUndoInput] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [scopedSessions, setScopedSessions] = useState<ChatSession[]>([]);
  const [sidebarSessions, setSidebarSessions] = useState<ChatSession[]>([]);
  const [selectedModel, setSelectedModel] = useState(preferredModel || "");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [ollamaModelStatus, setOllamaModelStatus] = useState<"idle" | "available" | "empty" | "unreachable">("idle");
  const [aiModelList, setAiModelList] = useState<AiModel[]>([]);
  const [messageVariations, setMessageVariations] = useState<Map<string, Message[]>>(new Map());
  const [variationIndex, setVariationIndex] = useState<Map<string, number>>(new Map());
  const [redoPickerOpenForId, setRedoPickerOpenForId] = useState<string | null>(null);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [isFamilyPickerOpen, setIsFamilyPickerOpen] = useState(false);
  const [isModelSendMenuOpen, setIsModelSendMenuOpen] = useState(false);
  const [activeTierPickerIdx, setActiveTierPickerIdx] = useState<number | null>(null);
  type ContextSources = { memories_used: string[]; artifacts_used: string[]; summaries_used: string[]; documents_used: string[] };
  const [activeContextSources, setActiveContextSources] = useState<Record<string, ContextSources>>({});
  const [loadedSessionScopeKey, setLoadedSessionScopeKey] = useState<string | null>(null);
  const [sessionSidebarDragActive, setSessionSidebarDragActive] = useState(false);
  const syncedSessionModelRef = useRef<{ sessionId: string | null; modelName: string }>({ sessionId: null, modelName: "" });
  const chatViewRef = useRef<HTMLDivElement | null>(null);
  const emptyStatePrivacyMenuRef = useRef<HTMLDivElement | null>(null);
  const streamUnlistenRef = useRef<(() => void) | null>(null);
  const refineUnlistenRef = useRef<(() => void) | null>(null);
  const handledLocationActionKeyRef = useRef<string | null>(null);
  const currentSessionId = routeSessionId ?? activeChatId ?? null;
  const effectiveWorkspaceId = scopedWorkspaceId ?? activeWorkspaceId;
  const effectiveFolderId = scopedFolderId ?? activeFolderId;
  const includeDescendants = useBubbleUpFlag();
  const sessionScopeKey = `${effectiveWorkspaceId ?? ""}::${effectiveFolderId ?? ""}`;
  const sessions = isSplitPane ? scopedSessions : globalSessions;

  const applySessionList = useCallback((transform: (prev: ChatSession[]) => ChatSession[]) => {
    if (isSplitPane) {
      setScopedSessions((prev) => transform(prev));
      return;
    }

    const store = useChatStore.getState();
    store.setSessions(transform(store.sessions));
  }, [isSplitPane]);

  const replaceSessions = useCallback((nextSessions: ChatSession[]) => {
    if (isSplitPane) {
      setScopedSessions(nextSessions);
      return;
    }

    useChatStore.getState().setSessions(nextSessions);
  }, [isSplitPane]);

  const mergeSessionIntoScope = useCallback((session: ChatSession) => {
    applySessionList((prev) => {
      const existingIndex = prev.findIndex((existingSession) => existingSession.id === session.id);
      if (existingIndex === -1) {
        return [session, ...prev];
      }

      const next = [...prev];
      next[existingIndex] = session;
      return next;
    });
  }, [applySessionList]);

  const updateSessionInScope = useCallback((session: ChatSession) => {
    applySessionList((prev) => prev.map((existingSession) => (
      existingSession.id === session.id ? session : existingSession
    )));
  }, [applySessionList]);

  const removeSessionFromScope = useCallback((sessionId: string) => {
    applySessionList((prev) => prev.filter((session) => session.id !== sessionId));
  }, [applySessionList]);

  useEffect(() => {
    if (!currentSessionId) { return; }
    const unlistenPromise = api.context.listenContextSources(currentSessionId, (sources) => {
      setActiveContextSources(prev => ({ ...prev, [currentSessionId]: sources as ContextSources }));
    });
    return () => {
      unlistenPromise.then(fn => fn());
    };
  }, [currentSessionId]);

  useEffect(() => {
    if (!sessionSidebarDragActive) {
      return;
    }

    function handleMouseMove(event: MouseEvent) {
      const container = chatViewRef.current;
      if (!container) {
        return;
      }

      const bounds = container.getBoundingClientRect();
      const relativeWidth = event.clientX - bounds.left;
      setSidebarWidth(clampSessionSidebarWidth(relativeWidth, isSplitPane));
    }

    function handleMouseUp() {
      setSessionSidebarDragActive(false);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isSplitPane, sessionSidebarDragActive, setSidebarWidth]);

  // Persist model choice to global settings
  const persistModelChoice = useCallback(async (model: string) => {
    if (!model) { return; }
    setPreferredModel(model);
    try {
      await api.settings.updateOne("preferred_model", model);
    } catch (err) {
      console.error("Failed to persist model choice:", err);
    }
  }, [setPreferredModel]);

  // Persist other settings

  const persistSetting = useCallback(async (key: keyof AppSettings, value: unknown) => {
    try {
      await api.settings.updateOne(key as string, value);
    } catch (err) {
      console.error(`Failed to persist ${key}:`, err);
    }
  }, []);

  // Sync selectedModel with store if store hydrates after initial render
  useEffect(() => {
    if (preferredModel && !selectedModel && availableModels.includes(preferredModel)) {
      setSelectedModel(preferredModel);
    }
  }, [availableModels, preferredModel, selectedModel]);

  const [lastUserMessage, setLastUserMessage] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [expandedThoughtIds, setExpandedThoughtIds] = useState<Set<string>>(new Set());

  // Integrated subview state (Standard Chat, Grounded, Compare)
  const [activeSubView, setActiveSubView] = useState<ChatSubView>("chat");
  const [relatedChats, setRelatedChats] = useState<QuickSearchResult[]>([]);

  // A brand-new chat (only an optimistic user message, still "Waiting for
  // response...") has no topic of its own yet. The topic signature driving
  // related chats is workspace-scoped, so without this gate every freshly
  // started chat would immediately surface workspace-wide chats that have
  // nothing to do with the current conversation. Require a real exchange —
  // at least one non-empty assistant reply — before showing related chats.
  const hasAssistantReply = useMemo(
    () => activeChatMessages.some((m) => m.role === "assistant" && m.content.trim().length > 0),
    [activeChatMessages],
  );

  // Fetch related chats when topic signature changes
  useEffect(() => {
    let active = true;
    const fetchRelated = async () => {
      if (!hasAssistantReply) {
        setRelatedChats([]);
        return;
      }
      const tags = (() => {
        if (!activeTopicSignature) { return []; }
        const ignored = new Set(activeTopicSignature.excluded_tags);
        const active = activeTopicSignature.auto_detected_tags
          .filter(t => !ignored.has(t.tag) && t.weight >= 0.4)
          .map(t => t.tag);
        for (const tag of activeTopicSignature.custom_tags) {
          if (!ignored.has(tag) && !active.includes(tag)) {
            active.push(tag);
          }
        }
        return active;
      })();
      if (tags.length === 0 || !effectiveWorkspaceId) {
        setRelatedChats([]);
        return;
      }
      try {
        const results = await api.chat.getRelatedChats(effectiveWorkspaceId, tags, currentSessionId || undefined, 5);
        if (active) {
          setRelatedChats(results);
        }
      } catch (error) {
        console.error("Failed to fetch related chats:", error);
      }
    };
    void fetchRelated();
    return () => { active = false; };
  }, [activeTopicSignature, effectiveWorkspaceId, currentSessionId, hasAssistantReply]);

  // Handle external subview switching via router state
  useEffect(() => {
    const locState = location.state as { subView?: ChatSubView } | null;
    if (locState?.subView) {
      setActiveSubView(locState.subView as ChatSubView);
      // Clear state so it doesn't persist on manual refreshes
      window.history.replaceState({}, document.title);
    }
  }, [location.state, setActiveSubView]);

  // Session list features
  const [sessionQuery, setSessionQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingFolderPending, setCreatingFolderPending] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [successDialog, setSuccessDialog] = useState<{ title: string; description: string } | null>(null);
  const [activeChatSummary, setActiveChatSummary] = useState<ConversationSummary | null>(null);
  const [isChatSummaryOpen, setIsChatSummaryOpen] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const creatingFolderRequestRef = useRef(false);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const messagesScrollContainerRef = useRef<HTMLDivElement>(null);
  const [messagesScrollerElement, setMessagesScrollerElement] = useState<HTMLDivElement | null>(null);
  const chatSummaryButtonRef = useRef<HTMLButtonElement>(null);
  const chatSummaryPopoverRef = useRef<HTMLDivElement>(null);

  const openConfirmDialog = useCallback((options: ConfirmDialogState) => {
    setConfirmDialog(options);
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
    });
  }, []);

  const openAlertDialog = useCallback((title: string, description: string, tone: ConfirmDialogState["tone"] = "default") => {
    setConfirmDialog({
      title,
      description,
      confirmLabel: "OK",
      cancelLabel: null,
      tone,
    });
  }, []);

  const closeConfirmDialog = useCallback((confirmed: boolean) => {
    confirmResolverRef.current?.(confirmed);
    confirmResolverRef.current = null;
    setConfirmDialog(null);
  }, []);

  const handleCreateFolder = useCallback(async (nameOverride?: string) => {
    if (creatingFolderRequestRef.current) { return; }
    const folderName = (nameOverride ?? newFolderName).trim();
    const previousFolderId = effectiveFolderId;
    if (!folderName || !effectiveWorkspaceId) {
      setCreatingFolder(false);
      setNewFolderName("");
      return;
    }
    creatingFolderRequestRef.current = true;
    setCreatingFolderPending(true);
    try {
      await api.folder.create(effectiveWorkspaceId, folderName);
      const refreshedFolders = await api.folder.list(effectiveWorkspaceId, { includeDescendants });
      setFoldersForWorkspace(effectiveWorkspaceId, refreshedFolders);
      setScopedFolderId(previousFolderId);
    } catch (e) {
      console.error(e);
    } finally {
      creatingFolderRequestRef.current = false;
      setCreatingFolderPending(false);
      setCreatingFolder(false);
      setNewFolderName("");
    }
  }, [newFolderName, effectiveFolderId, effectiveWorkspaceId, includeDescendants, setScopedFolderId, setFoldersForWorkspace]);

  useEffect(() => {
    if (!creatingFolder || !folderInputRef.current) { return; }
    if (document.activeElement !== folderInputRef.current) {
      folderInputRef.current.focus();
    }
  }, [creatingFolder]);

  useEffect(() => {
    return () => {
      confirmResolverRef.current?.(false);
      confirmResolverRef.current = null;
    };
  }, []);

  // Model comparison state
  const [compareModelA, setCompareModelA] = useState(savedCompareA || "");
  const [compareModelB, setCompareModelB] = useState(savedCompareB || "");

  // Sync comparison models when store hydrates
  useEffect(() => {
    if (savedCompareA) {
      setCompareModelA((current) => current || savedCompareA);
    }
    if (savedCompareB) {
      setCompareModelB((current) => current || savedCompareB);
    }
  }, [savedCompareA, savedCompareB]);

  // External link confirmation dialog
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [linkDontAsk, setLinkDontAsk] = useState(false);

  const handleLinkClick = useCallback((href: string) => {
    if (skipLinkConfirm) {
      open(href);
    } else {
      setPendingLink(href);
      setLinkDontAsk(false);
    }
  }, [skipLinkConfirm]);

  const confirmOpenLink = useCallback(() => {
    if (pendingLink) { open(pendingLink); }
    if (linkDontAsk) { setSkipLinkConfirm(true); }
    setPendingLink(null);
  }, [pendingLink, linkDontAsk, setSkipLinkConfirm]);

  const cancelOpenLink = useCallback(() => {
    setPendingLink(null);
  }, []);

  const clearStreamListener = useCallback(() => {
    streamUnlistenRef.current?.();
    streamUnlistenRef.current = null;
  }, []);

  const clearRefineListener = useCallback(() => {
    refineUnlistenRef.current?.();
    refineUnlistenRef.current = null;
  }, []);

  const _clearActiveStreamListeners = useCallback(() => {
    clearStreamListener();
    clearRefineListener();
  }, [clearRefineListener, clearStreamListener]);

  // Intentionally no unmount cleanup for stream listeners: if the user
  // navigates away from the chat view while a generation is in progress,
  // the listener must stay alive so the response is finalised and persisted
  // in the background. Each listener self-cleans when the stream finishes.

  // ── Stabilized callbacks for ChatMessageBubble ──────────────────────────
  const handleCopyMessage = useCallback((msgId: string, content: string) => {
    window.navigator.clipboard.writeText(content);
    setCopiedMessageId(msgId);
    setTimeout(() => setCopiedMessageId(null), 1500);
  }, []);

  const handleStartEditing = useCallback((msgId: string, content: string) => {
    setEditingMessageId(msgId);
    setEditContent(content);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
  }, []);

  const handleToggleThought = useCallback((msgId: string) => {
    setExpandedThoughtIds((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) { next.delete(msgId); } else { next.add(msgId); }
      return next;
    });
  }, []);

  const handleToggleSources = useCallback((msgId: string) => {
    setExpandedSources((prev) => prev === msgId ? null : msgId);
  }, []);

  const redoMessageRef = useRef<((msgId: string, modelId: string) => void) | null>(null);
  const submitEditRef = useRef<((msgId: string) => void) | null>(null);
  const handleVariationChangeRef = useRef<((msgId: string, newIndex: number) => void) | null>(null);

  const handleRedoWithModelStable = useCallback((id: string, model: string) => {
    setRedoPickerOpenForId(null);
    redoMessageRef.current?.(id, model);
  }, []);
  const handleToggleRedoPickerStable = useCallback((id: string) => {
    setRedoPickerOpenForId((prev) => prev === id ? null : id);
  }, []);
  const handleSubmitEditStable = useCallback((msgId: string) => {
    submitEditRef.current?.(msgId);
  }, []);
  const handleVariationChangeStable = useCallback((msgId: string, newIndex: number) => {
    handleVariationChangeRef.current?.(msgId, newIndex);
  }, []);

  const handleDeleteMessageRef = useRef<((msgId: string) => void) | null>(null);
  const handleDeleteMessageStable = useCallback((msgId: string) => {
    handleDeleteMessageRef.current?.(msgId);
  }, []);

  const markdownComponents = useMemo(() => ({
    pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        {...props}
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href) { handleLinkClick(href); }
        }}
        style={{ cursor: "pointer" }}
      >
        {children}
      </a>
    ),

    code: ({ node: _node, inline, className, children, ...props }: Record<string, unknown> & { inline?: boolean, className?: string, children?: React.ReactNode }) => {
      const match = /language-(\w+)/.exec(className || "");
      const lang = match ? match[1] : "";
      const content = String(children).replace(/\n$/, "");

      if (!inline) {
        return (
          <CodeBlockRenderer
            content={content}
            lang={lang}
            containerStyle={codeBlockContainerStyle}
            colorPalette={codeBlockColorPalette}
            keywordColor={codeBlockKeywordColor}
          />
        );
      }
      return <code className={className} {...props}>{children}</code>;
    }
  }), [codeBlockColorPalette, codeBlockContainerStyle, codeBlockKeywordColor, handleLinkClick]);

  const [comparePrompt, setComparePrompt] = useState("");
  const [compareResponseA, setCompareResponseA] = useState("");
  const [compareResponseB, setCompareResponseB] = useState("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [isEmptyStatePrivacyMenuOpen, setIsEmptyStatePrivacyMenuOpen] = useState(false);
  const [compareModels, setCompareModels] = useState<OllamaModel[]>([]);

  const [attachedSources, setAttachedSources] = useState<Array<{ id: string; title: string; content: string }>>([]);
  const [isAttachingFiles, setIsAttachingFiles] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [messageSources] = useState<Record<string, SearchResult[]>>({});
  const [expandedSources, setExpandedSources] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [promptBankPrompts, setPromptBankPrompts] = useState<string[]>([]);
  const followUpsGenRef = useRef(0);

  // Per-message metadata (tok/s and duration) persisted on the Message itself;
  // no in-memory state needed — loaded from DB on session open.;

  // ── Thought Queue panel ────────────────────────────────────────────────
  const [thoughtPanelOpen, setThoughtPanelOpen] = useState(false);
  const [thoughts, setThoughts] = useState<ThoughtItem[]>([]);
  const [thoughtDraft, setThoughtDraft] = useState("");
  const [thoughtSchedule, setThoughtSchedule] = useState("");
  const [thoughtScheduleEnabled, setThoughtScheduleEnabled] = useState(false);
  const [thoughtSubmitting, setThoughtSubmitting] = useState(false);
  const [thoughtExpandedId, setThoughtExpandedId] = useState<string | null>(null);

  const loadThoughts = useCallback(async () => {
    if (!effectiveWorkspaceId) { return; }
    try {
      const items = await api.thoughtQueue.list(effectiveWorkspaceId);
      setThoughts(items);
    } catch { /* ignore */ }
  }, [effectiveWorkspaceId]);

  useEffect(() => {
    if (!thoughtPanelOpen) { return; }
    loadThoughts();
  }, [thoughtPanelOpen, loadThoughts]);

  const { processDueThought } = useDueThoughts({
    workspaceId: effectiveWorkspaceId,
    enabled: thoughtPanelOpen,
    ollamaUrl,
    setThoughts,
    onProcessed: setThoughtExpandedId,
  });

  async function submitThought() {
    if (!effectiveWorkspaceId || !thoughtDraft.trim()) { return; }
    setThoughtSubmitting(true);
    try {
      const processAt = thoughtScheduleEnabled && thoughtSchedule ? new Date(thoughtSchedule).toISOString() : undefined;
      const item = await api.thoughtQueue.create(effectiveWorkspaceId, thoughtDraft.trim(), {
        processAt, modelName: selectedModel || undefined,
      });
      setThoughts((prev) => [item, ...prev]);
      setThoughtDraft("");
      setThoughtScheduleEnabled(false);
    } finally {
      setThoughtSubmitting(false);
    }
  }

  // Web AI session settings
  const preserveWebSession = useSettingsStore((s) => s.webSessionPreserve);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const prevScrollChatIdRef = useRef<string | null>(null);
  const wasStreamingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingSentScrollId = useRef<string | null>(null);
  const pendingNewSessionRef = useRef<Promise<ChatSession | null> | null>(null);
  const incognitoSessionIdsRef = useRef<Set<string>>(new Set());
  const migrationDismissedSessionsRef = useRef<Set<string>>(new Set());

  const resizeAndFocusComposer = useCallback((cursorPosition?: number) => {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) { return; }
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
      el.focus();
      const nextCursorPosition = cursorPosition ?? el.value.length;
      el.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }, []);

  const activeMessages = activeChatMessages;
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session] as const)),
    [sessions],
  );
  const workspaceById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace] as const)),
    [workspaces],
  );
  const effectiveWorkspaceFolders = useMemo(
    () => foldersByWorkspace[effectiveWorkspaceId ?? ""] ?? folders,
    [foldersByWorkspace, effectiveWorkspaceId, folders],
  );
  const folderById = useMemo(
    () => new Map(effectiveWorkspaceFolders.map((folder) => [folder.id, folder] as const)),
    [effectiveWorkspaceFolders],
  );

  const {
    aiModelById,
    modelPickerOptions,
    enabledWebModels,
    groupedModelPickerOptions,
    alternateSendModels,
    groupedAlternateSendModels,
  } = useModelPickerGroups({
    availableModels,
    aiModelList,
    modelFamilyLabels,
    customModelFamilies,
    modelLabels,
    selectedModel,
  });
  const [isWebPickerOpen, setIsWebPickerOpen] = useState(false);
  // uses granular selector from above
  const sessionTokensUsed = activeMessages.reduce((sum, m) => sum + (m.tokens_used ?? 0), 0);
  const setTitlebarTokenCount = useUIStore((s) => s.setTitlebarTokenCount);
  useEffect(() => {
    setTitlebarTokenCount(sessionTokensUsed);
  }, [sessionTokensUsed, setTitlebarTokenCount]);
  const isCurrentlyStreaming = streamingSessionId === activeChatId;

  const activeSession = activeChatId ? (sessionById.get(activeChatId) ?? null) : null;
  const activeSessionWorkspaceId = activeSession?.workspace_id ?? effectiveWorkspaceId;
  const activeWorkspaceName = workspaceById.get(effectiveWorkspaceId ?? "")?.name ?? "No workspace";
  const effectiveFolderName = (
    effectiveFolderId
      ? folderById.get(effectiveFolderId)?.name ?? null
      : null
  );

  // Web AI provider detection
  const selectedModelMeta = aiModelById.get(selectedModel);
  const effectiveContextSize = selectedModelMeta?.context_size ?? 8192;
  const isWebProvider = selectedModelMeta?.provider.startsWith("web_") ?? false;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const webProviderKey = isWebProvider ? selectedModelMeta!.provider.replace("web_", "") : "";
  const { toolbarState, toolbarRef, dismiss: dismissToolbar } = useTextSelectionToolbar(messagesScrollContainerRef);

  useEffect(() => {
    if (!activeChatId) {
      setActiveChatSummary(null);
      setIsChatSummaryOpen(false);
      return;
    }

    let cancelled = false;
    setIsChatSummaryOpen(false);
    api.summary.list(activeChatId)
      .then((summaries) => {
        if (cancelled) { return; }
        setActiveChatSummary(pickInfoSummary(summaries));
      })
      .catch(() => {
        if (!cancelled) {
          setActiveChatSummary(null);
        }
      });
    return () => { cancelled = true; };
  }, [activeChatId, activeMessages.length]);

  useEffect(() => {
    if (!isChatSummaryOpen) { return; }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (
        target &&
        (chatSummaryButtonRef.current?.contains(target) || chatSummaryPopoverRef.current?.contains(target))
      ) {
        return;
      }
      setIsChatSummaryOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsChatSummaryOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isChatSummaryOpen]);

  const pendingPromptText = useChatStore((s) => s.pendingPromptText);
  const setPendingPromptText = useChatStore((s) => s.setPendingPromptText);

  useEffect(() => {
    if (pendingPromptText) {
      const newText = input.trim() ? `${input}\n\n${pendingPromptText}` : pendingPromptText;
      setInput(newText);
      setPendingPromptText(null);
      resizeAndFocusComposer(newText.length);
      window.getSelection()?.removeAllRanges();
    }
  }, [pendingPromptText, input, resizeAndFocusComposer, setPendingPromptText]);

  useEffect(() => {
    if (!isModelSendMenuOpen) { return; }

    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-send-model-menu]")) { return; }
      setIsModelSendMenuOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsModelSendMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isModelSendMenuOpen]);

  useEffect(() => {
    if (!isAttachmentMenuOpen) { return; }

    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-attachment-menu]")) { return; }
      setIsAttachmentMenuOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsAttachmentMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isAttachmentMenuOpen]);

  useEffect(() => {
    if (!isWebPickerOpen) { return; }
    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-web-model-menu]")) { return; }
      setIsWebPickerOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); setIsWebPickerOpen(false); }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isWebPickerOpen]);

  useEffect(() => {
    if (!isEmptyStatePrivacyMenuOpen) { return; }

    function handleClick(event: MouseEvent) {
      if (emptyStatePrivacyMenuRef.current?.contains(event.target as Node)) { return; }
      setIsEmptyStatePrivacyMenuOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsEmptyStatePrivacyMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isEmptyStatePrivacyMenuOpen]);

  useEffect(() => {
    if (!isModelPickerOpen && !isFamilyPickerOpen) { return; }

    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-active-model-menu]")) { return; }
      setIsModelPickerOpen(false);
      setIsFamilyPickerOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsModelPickerOpen(false);
        setIsFamilyPickerOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isModelPickerOpen, isFamilyPickerOpen]);

  useEffect(() => {
    if (activeTierPickerIdx === null) { return; }
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-tier-picker]")) { setActiveTierPickerIdx(null); }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") { setActiveTierPickerIdx(null); }
    }
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [activeTierPickerIdx]);

  useEffect(() => {
    if (!redoPickerOpenForId) { return; }

    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-redo-picker]")) { return; }
      setRedoPickerOpenForId(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") { setRedoPickerOpenForId(null); }
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [redoPickerOpenForId]);

  useEffect(() => {
    if (!effectiveWorkspaceId) {
      setSidebarSessions([]);
      return;
    }

    let cancelled = false;
    const trimmedQuery = sessionQuery.trim();
    setSidebarSessions([]);
    if (trimmedQuery) {
      // Allow searching to trigger queries for the current workspace
      const timeoutId = window.setTimeout(() => {
        api.chat.searchSessions(effectiveWorkspaceId, trimmedQuery, null, { includeDescendants })
          .then((results) => { if (!cancelled) { setSidebarSessions(results); } }).catch(() => { });
      }, 150);
      return () => { cancelled = true; window.clearTimeout(timeoutId); };
    } else {
      // When not searching, only fetch on initial mount or workspace change.
      // Other updates (move, create, delete, rename) should handle UI updates via optimistic
      // changes or explicit refresh events.
      api.chat.listSessions(effectiveWorkspaceId, null, { limit: 200, offset: 0, includeDescendants })
        .then((results) => { if (!cancelled) { setSidebarSessions(results); } }).catch(() => { });
      return () => { cancelled = true; };
    }
  }, [effectiveWorkspaceId, sessionQuery, includeDescendants]);

  async function refreshFolderTree(workspaceId: string) {
    const refreshedFolders = await api.folder.list(workspaceId, { includeDescendants });
    const refreshedSidebarSessions = await api.chat.listSessions(workspaceId, null, { limit: 200, offset: 0, includeDescendants });
    setFoldersForWorkspace(workspaceId, refreshedFolders);
    setSidebarSessions(refreshedSidebarSessions);
  }

  async function refreshScopedSessions(workspaceId: string, folderId: string | null) {
    const refreshedSessions = await api.chat.listSessions(workspaceId, folderId, { limit: 200, offset: 0, includeDescendants });
    replaceSessions(refreshedSessions);
  }

  const bulkDeleteSessions = useCallback(async (sessionIds: string[], folderIds: string[] = []) => {
    if (isDemoMode) {
      await message("Session deletion is not available in Demo Mode.", { title: "Demo Mode" });
      return;
    }
    if (!effectiveWorkspaceId || (sessionIds.length === 0 && folderIds.length === 0)) { return; }
    const settings = useSettingsStore.getState();
    const isImmediate = settings.immediateDelete;
    const skipConfirm = !isImmediate && !settings.confirmMoveToTrash;
    const totalCount = sessionIds.length + folderIds.length;

    if (!skipConfirm) {
      const confirmMsg = isImmediate
        ? `Permanently delete ${totalCount} selected item${totalCount === 1 ? "" : "s"}? Chats will be deleted and folders removed. This cannot be undone.`
        : `Delete ${totalCount} selected item${totalCount === 1 ? "" : "s"}? Chats will move to the recycle bin and folders will be removed.`;

      if (!await openConfirmDialog({
        title: isImmediate ? "Delete selected items?" : "Move selected items to recycle bin?",
        description: confirmMsg,
        confirmLabel: isImmediate ? "Delete" : "Move to Recycle Bin",
        tone: "danger",
      })) { return; }
    }

    await Promise.all(sessionIds.map((id) => api.chat.deleteSession(effectiveWorkspaceId, id)));
    for (const folderId of folderIds) {
      const folderSessionIds = sidebarSessions
        .filter((session) => session.folder_id === folderId && !sessionIds.includes(session.id))
        .map((session) => session.id);
      if (folderSessionIds.length > 0) {
        await api.chat.moveSessions(folderSessionIds, effectiveWorkspaceId, undefined);
      }
      await api.folder.delete(folderId);
    }
    const removedSessionIds = new Set(sessionIds);
    replaceSessions(sessions.filter((session) => !removedSessionIds.has(session.id)));

    await Promise.all([
      refreshFolderTree(effectiveWorkspaceId),
      refreshScopedSessions(effectiveWorkspaceId, folderIds.includes(effectiveFolderId ?? "") ? null : effectiveFolderId),
    ]);
    if (folderIds.includes(effectiveFolderId ?? "")) {
      setScopedFolderId(null);
    }
    if (activeChatId && sessionIds.includes(activeChatId)) {
      setActiveChatId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemoMode, effectiveWorkspaceId, openConfirmDialog, refreshFolderTree, refreshScopedSessions, replaceSessions, activeChatId, setActiveChatId, setScopedFolderId]);

  useEffect(() => {
    setAttachedSources([]);
  }, [effectiveWorkspaceId, activeChatId]);

  // Load sessions (scoped to active folder, or unscoped when none selected)
  useEffect(() => {
    if (!effectiveWorkspaceId) {
      setLoadedSessionScopeKey(null);
      replaceSessions([]);
      return;
    }

    const scopeKey = `${effectiveWorkspaceId}::${effectiveFolderId ?? ""}`;
    let cancelled = false;
    replaceSessions([]);
    setLoadedSessionScopeKey(null);

    api.chat.listSessions(effectiveWorkspaceId, effectiveFolderId, { limit: 200, offset: 0, includeDescendants })
      .then((nextSessions) => {
        if (cancelled) { return; }
        replaceSessions(nextSessions);
        setLoadedSessionScopeKey(scopeKey);
      })
      .catch(() => {
        if (cancelled) { return; }
        setLoadedSessionScopeKey(scopeKey);
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveWorkspaceId, effectiveFolderId, replaceSessions, includeDescendants]);

  useEffect(() => {
    if (!effectiveWorkspaceId || !currentSessionId) { return; }
    if (loadedSessionScopeKey !== sessionScopeKey) { return; }

    const sessionStillVisible = sessions.some(
      (session) => session.id === currentSessionId && session.workspace_id === effectiveWorkspaceId
    );
    const sessionStillVisibleInSidebar = sidebarSessions.some(
      (session) => session.id === currentSessionId && session.workspace_id === effectiveWorkspaceId
    );
    if (sessionStillVisible || sessionStillVisibleInSidebar) { return; }

    if (activeChatId === currentSessionId) {
      setActiveChatId(null);
    }

    if (routeSessionId === currentSessionId) {
      navigate("/chat", { replace: true });
    }
  }, [
    activeChatId,
    currentSessionId,
    effectiveWorkspaceId,
    loadedSessionScopeKey,
    navigate,
    routeSessionId,
    sessionScopeKey,
    sidebarSessions,
    sessions,
    setActiveChatId,
  ]);

  useEffect(() => {
    chatViewDiag("ChatView mounted (post-commit)");
    return () => { chatViewDiag("ChatView unmounted"); };
  }, []);

  // Load active topic signature when workspace changes
  useEffect(() => {
    chatViewDiag("topic-signature loader run", { effectiveWorkspaceId });
    if (effectiveWorkspaceId) {
      const cachedWorkspace = useWorkspaceStore.getState().workspaces.find(
        (workspace) => workspace.id === effectiveWorkspaceId
      );
      if (cachedWorkspace?.topic_signature) {
        setActiveTopicSignature(cachedWorkspace.topic_signature);
      } else {
        setActiveTopicSignature(null);
      }

      const fetchStarted = window.performance.now();
      chatViewDiag("topicSignature.get start", { effectiveWorkspaceId });
      api.topicSignature.get(effectiveWorkspaceId)
        .then(sig => {
          chatViewDiag("topicSignature.get resolved", {
            effectiveWorkspaceId,
            durationMs: Number((window.performance.now() - fetchStarted).toFixed(1)),
          });
          setWorkspaceTopicSignature(effectiveWorkspaceId, sig);
        })
        .catch(() => { });
    } else {
      setActiveTopicSignature(null);
    }
  }, [effectiveWorkspaceId, setActiveTopicSignature, setWorkspaceTopicSignature]);

  useEffect(() => {
    if (!effectiveWorkspaceId || activeChatMessages.length > 0) {
      setPromptBankPrompts([]);
      return;
    }

    let cancelled = false;
    api.workspace.listPromptSuggestions(effectiveWorkspaceId, 12)
      .then((suggestions) => {
        if (!cancelled) {
          setPromptBankPrompts(suggestions.map((suggestion) => suggestion.prompt));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPromptBankPrompts([]);
        }
      });

    return () => { cancelled = true; };
  }, [effectiveWorkspaceId, activeChatMessages.length]);

  useTopicSignatureRefresh(effectiveWorkspaceId);

  // Generate AI workspace prompts if needed
  const suggestedPromptsCount = activeTopicSignature?.suggested_prompts?.length ?? 0;
  const promptBankPromptsCount = promptBankPrompts.length;
  const autoDetectedTagsCount = activeTopicSignature?.auto_detected_tags?.length ?? 0;
  const customTagsCount = activeTopicSignature?.custom_tags?.length ?? 0;
  const topicSignatureLoaded = activeTopicSignature !== undefined;
  useEffect(() => {
    chatViewDiag("prompt-gen effect run", {
      effectiveWorkspaceId,
      activeChatMessagesLength: activeChatMessages.length,
      suggestedPromptsCount,
      promptBankPromptsCount,
      topicSignatureLoaded,
      autoDetectedTagsCount,
      customTagsCount,
    });
    if (!effectiveWorkspaceId) { return; }
    if (activeChatMessages.length > 0) { return; } // Only when no messages (new chat)
    if (promptBankPromptsCount > 0) { return; }
    if (suggestedPromptsCount > 0) { return; }
    // Only run once the topic signature has loaded from the backend.
    if (!topicSignatureLoaded) { return; }
    // Skip generation for workspaces with no real content — generating prompts
    // from a bare workspace name produces generic, unhelpful suggestions.
    if (autoDetectedTagsCount === 0 && customTagsCount === 0) { return; }

    // Dedup across remounts: if a prior mount already kicked off this call for
    // this workspace, do not fire it again.
    if (hasPendingWorkspacePrompts(effectiveWorkspaceId)) {
      chatViewDiag("prompt-gen skipped (dedup)", { effectiveWorkspaceId });
      return;
    }
    chatViewDiag("prompt-gen scheduling LLM call", { effectiveWorkspaceId });

    const currentWorkspace = useWorkspaceStore.getState().workspaces.find(w => w.id === effectiveWorkspaceId);
    if (!currentWorkspace) { return; }

    let cancelled = false;
    const workspaceId = effectiveWorkspaceId;
    markWorkspacePromptsInFlight(workspaceId);

    // Defer the LLM call past commit so the chat surface paints first.
    const timer = window.setTimeout(() => {
      if (cancelled) {
        clearWorkspacePromptsInFlight(workspaceId);
        return;
      }
      api.workspace.generateWorkspacePrompts(workspaceId, currentWorkspace.name, currentWorkspace.survey_data)
        .then((prompts) => {
          if (!cancelled && prompts.length > 0) {
            api.topicSignature.get(workspaceId)
              .then(sig => {
                if (!cancelled) { setWorkspaceTopicSignature(workspaceId, sig); }
              })
              .catch(() => {});
          }
        })
        .catch((err) => {
          console.error("Failed to generate workspace prompts:", err);
          // Clear the in-flight marker on failure so a later retry can run.
          clearWorkspacePromptsInFlight(workspaceId);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [effectiveWorkspaceId, activeChatMessages.length, promptBankPromptsCount, suggestedPromptsCount, autoDetectedTagsCount, customTagsCount, topicSignatureLoaded, setWorkspaceTopicSignature]);

  // Activate session from URL
  useEffect(() => {
    if (routeSessionId) {
      setActiveChatId(routeSessionId);
      api.chat.touchSessionAccessed(routeSessionId).catch(() => { });
    }
  }, [routeSessionId, setActiveChatId]);

  useEffect(() => {
    incognitoSessionIdsRef.current = new Set(
      sessions.filter((session) => session.is_incognito).map((session) => session.id)
    );
  }, [sessions]);

  const cleanupIncognitoSession = useCallback(async (sessionToDelete: string) => {
    if (!effectiveWorkspaceId) { return; }
    try {
      await api.chat.deleteSession(effectiveWorkspaceId, sessionToDelete);
    } catch {
      // Ignore cleanup failures during navigation away.
    }
    removeSessionFromScope(sessionToDelete);
    if (activeChatId === sessionToDelete) {
      setActiveChatId(null);
    }
  }, [effectiveWorkspaceId, activeChatId, removeSessionFromScope, setActiveChatId]);

  useEffect(() => {
    const previousSessionId = activeChatId;
    return () => {
      if (!previousSessionId || !incognitoSessionIdsRef.current.has(previousSessionId)) { return; }
      void cleanupIncognitoSession(previousSessionId);
    };
  }, [activeChatId, cleanupIncognitoSession]);

  // Reset local streaming flag when switching to a chat that isn't streaming
  useEffect(() => {
    if (!isCurrentlyStreaming) {
      setIsStreaming(false);
    }
  }, [activeChatId, isCurrentlyStreaming]);

  // Load messages when session changes
  useEffect(() => {
    chatViewDiag("message-load effect run", {
      activeChatId,
      hasLoadedActiveMessages,
      activeSessionWorkspaceId,
    });
    if (!activeChatId || hasLoadedActiveMessages || !activeSessionWorkspaceId) { return; }
    setMessageVariations(new Map());
    setVariationIndex(new Map());
    setRedoPickerOpenForId(null);
    const fetchStarted = window.performance.now();
    chatViewDiag("getMessages start", { sessionId: activeChatId });
    api.chat.getMessages(activeSessionWorkspaceId, activeChatId)
      .then((msgs) => {
        chatViewDiag("getMessages resolved", {
          sessionId: activeChatId,
          durationMs: Number((window.performance.now() - fetchStarted).toFixed(1)),
          count: msgs.length,
        });
        setMessages(activeChatId, msgs);
      })
      .catch((error) => {
        console.error("Failed to load chat messages", {
          sessionId: activeChatId,
          workspaceId: activeSessionWorkspaceId,
          error,
        });
      });
  }, [activeChatId, activeSessionWorkspaceId, hasLoadedActiveMessages, setMessages]);

  // Load AI model priority list + fallback to raw Ollama models
  useEffect(() => {
    const sessionModel = activeSession?.model_name?.trim() ?? "";
    const shouldAdoptSessionModel =
      !!sessionModel &&
      (
        syncedSessionModelRef.current.sessionId !== activeChatId ||
        syncedSessionModelRef.current.modelName !== sessionModel
      );

    Promise.allSettled([
      api.aiModel.list(),
      // Use the cached list — `modelRefreshCounter` is the explicit invalidation
      // signal. User-triggered refresh paths still call `listModelsFresh` directly.
      api.ollama.listModels(ollamaUrl),
    ]).then(([aiModelsResult, ollamaModelsResult]) => {
      const aiModels = aiModelsResult.status === "fulfilled" ? aiModelsResult.value : [];
      const installedOllamaModels = ollamaModelsResult.status === "fulfilled"
        ? ollamaModelsResult.value
          .filter((model) => !model.name.toLowerCase().includes("embed"))
          .map((model) => model.name)
        : [];

      if (ollamaModelsResult.status === "fulfilled") {
        setOllamaModelStatus(installedOllamaModels.length > 0 ? "available" : "empty");
      } else {
        setOllamaModelStatus("unreachable");
      }

      setAiModelList(aiModels);
      aiModels.forEach((model) => {
        if (model.name && useSettingsStore.getState().modelLabels[model.model_id] !== model.name) {
          useSettingsStore.getState().setModelLabel(model.model_id, model.name);
        }
      });

      const enabledModels = aiModels
        .filter((model) => model.enabled)
        .sort((a, b) => a.priority - b.priority);
      const enabledInstalledOllamaModels = enabledModels
        .filter((model) => model.provider === "ollama" && installedOllamaModels.includes(model.model_id))
        .map((model) => model.model_id);
      const enabledNonOllamaModels = enabledModels
        .filter((model) => model.provider !== "ollama")
        .map((model) => model.model_id);
      const managedModelIds = aiModels.map((m) => m.model_id);
      const unmanagedInstalledModels = installedOllamaModels
        .filter((modelId) => !managedModelIds.includes(modelId));

      const nextAvailableModels = [
        ...enabledInstalledOllamaModels,
        ...enabledNonOllamaModels,
        ...unmanagedInstalledModels,
      ];

      // Keep session model in the list ONLY if it's already selected, 
      // but don't add it back if it's disabled unless it's the current session's model.
      const isSessionModelEnabled = aiModels.find((m) => m.model_id === sessionModel)?.enabled ?? true;
      const withSessionModel = sessionModel && (!nextAvailableModels.includes(sessionModel) && isSessionModelEnabled)
        ? [sessionModel, ...nextAvailableModels]
        : nextAvailableModels;
      const canAdoptSessionModel = shouldAdoptSessionModel && withSessionModel.includes(sessionModel);

      setAvailableModels(withSessionModel);
      setSelectedModel((current) => {
        if (canAdoptSessionModel) { return sessionModel; }
        if (withSessionModel.includes(current)) { return current; }
        if (preferredModel && withSessionModel.includes(preferredModel)) { return preferredModel; }
        return withSessionModel[0] ?? "";
      });
      syncedSessionModelRef.current = { sessionId: activeChatId, modelName: sessionModel };
    }).catch(() => {
      setOllamaModelStatus("unreachable");
      setAvailableModels(sessionModel ? [sessionModel] : []);
      setSelectedModel((current) => shouldAdoptSessionModel ? sessionModel : current);
      syncedSessionModelRef.current = { sessionId: activeChatId, modelName: sessionModel };
    });
  }, [ollamaUrl, activeChatId, activeSession?.model_name, preferredModel, modelRefreshCounter]);

  // Scroll to bottom on new messages or session switch.
  // During active streaming, followOutput="auto" on the Virtuoso component owns
  // scroll-pinning via the Footer; firing scrollToIndex at the same time causes
  // competing animations that make the view jerk.
  useEffect(() => {
    const sessionChanged = prevScrollChatIdRef.current !== activeChatId;
    const justFinishedStreaming = wasStreamingRef.current && !isCurrentlyStreaming;
    prevScrollChatIdRef.current = activeChatId;
    wasStreamingRef.current = isCurrentlyStreaming;

    // Let followOutput="auto" handle pinning while tokens are arriving.
    if (isCurrentlyStreaming) { return; }

    // followOutput already kept us at the bottom during streaming — no jump needed.
    if (justFinishedStreaming && !sessionChanged) { return; }

    if (scrollToTopOnSend && pendingSentScrollId.current) {
      const msgId = pendingSentScrollId.current;
      pendingSentScrollId.current = null;
      const msgIndex = activeMessages.findIndex((m) => m.id === msgId);
      if (msgIndex !== -1) {
        requestAnimationFrame(() => {
          virtuosoRef.current?.scrollToIndex({ index: msgIndex, behavior: "smooth", align: "start" });
        });
        return;
      }
    }

    if (activeMessages.length > 0) {
      virtuosoRef.current?.scrollToIndex({
        index: activeMessages.length - 1,
        behavior: "auto",
      });
    }
  }, [activeChatId, activeMessages, isCurrentlyStreaming, scrollToTopOnSend]);

  // Virtuoso's followOutput + Footer handle scroll-pinning during streaming;
  // no manual interval needed.

  useEffect(() => {
    if (!activeChatId || !hasLoadedActiveMessages || activeMessages.length > 0 || isStreaming) { return; }

    requestAnimationFrame(() => {
      if (!inputRef.current || document.activeElement === inputRef.current) { return; }
      inputRef.current.focus();
      const cursorPosition = inputRef.current.value.length;
      inputRef.current.setSelectionRange(cursorPosition, cursorPosition);
    });
  }, [activeChatId, hasLoadedActiveMessages, activeMessages.length, isStreaming]);

  const activateSession = useCallback((session: ChatSession) => {
    setScopedFolderId(session.folder_id || null);
    setActiveChatId(session.id);
    if (!isSplitPane && routeSessionId !== session.id) {
      navigate(`/chat/${session.id}`);
    }
    api.chat.touchSessionAccessed(session.id).catch(() => { });

    mergeSessionIntoScope(session);
    setSidebarSessions((prev) => {
      const existingIndex = prev.findIndex((existingSession) => existingSession.id === session.id);
      if (existingIndex === -1) {
        return [session, ...prev];
      }

      const next = [...prev];
      next[existingIndex] = session;
      return next;
    });
  }, [setScopedFolderId, setActiveChatId, isSplitPane, routeSessionId, navigate, mergeSessionIntoScope, setSidebarSessions]);

  const onChatClick = useCallback(async (chat: QuickSearchResult) => {
    if (chat.target_id === currentSessionId) { return; }
    // Look up the session in the current local list first to avoid an extra
    // round-trip. Fall back to a backend fetch for sessions in other folders
    // or workspaces that haven't been loaded into this pane yet.
    let session = sessions.find((s) => s.id === chat.target_id) ?? null;
    if (!session && effectiveWorkspaceId) {
      try {
        session = await api.chat.getSession(effectiveWorkspaceId, chat.target_id);
      } catch {
        // session remains null; fall through to graceful no-op
      }
    }
    if (session) {
      activateSession(session);
    }
  }, [currentSessionId, sessions, effectiveWorkspaceId, activateSession]);

  const findOrCreateEmptySession = useCallback(async (options?: { isIncognito?: boolean; excludeFromAnalytics?: boolean }) => {
    if (!effectiveWorkspaceId) { return null; }

    const privacy = {
      isIncognito: options?.isIncognito ?? false,
      excludeFromAnalytics: options?.excludeFromAnalytics ?? false,
    };
    const localUnusedSession = findUnusedSession(
      sessions,
      useChatStore.getState().messages,
      effectiveWorkspaceId,
      privacy,
    );
    if (localUnusedSession) {
      return localUnusedSession;
    }

    const workspaceSessions = await api.chat.listSessions(effectiveWorkspaceId, null, { limit: 200, offset: 0 });
    const unusedSession = findUnusedSession(
      workspaceSessions,
      useChatStore.getState().messages,
      effectiveWorkspaceId,
      privacy,
    );
    if (unusedSession) {
      return unusedSession;
    }

    return api.chat.createSession(effectiveWorkspaceId, effectiveFolderId, {
      modelName: selectedModel,
      is_incognito: privacy.isIncognito,
      exclude_from_analytics: privacy.excludeFromAnalytics,
    });
  }, [effectiveWorkspaceId, sessions, effectiveFolderId, selectedModel]);

  const createNewSession = useCallback(async (options?: { isIncognito?: boolean; excludeFromAnalytics?: boolean }) => {
    if (!effectiveWorkspaceId) { return; }

    if (pendingNewSessionRef.current) {
      const pendingSession = await pendingNewSessionRef.current;
      if (pendingSession) {
        activateSession(pendingSession);
      }
      return;
    }

    const nextSessionPromise = findOrCreateEmptySession(options).finally(() => {
      if (pendingNewSessionRef.current === nextSessionPromise) {
        pendingNewSessionRef.current = null;
      }
    });
    pendingNewSessionRef.current = nextSessionPromise;

    const session = await nextSessionPromise;
    if (session) {
      activateSession(session);
    }
  }, [effectiveWorkspaceId, activateSession, findOrCreateEmptySession]);

  useEffect(() => {
    const state = location.state as { createNewChat?: boolean; searchQuery?: string } | null;
    if (!state?.createNewChat) {
      return;
    }

    if (isSplitPane && currentPaneId !== activePaneId) {
      return;
    }

    if (handledLocationActionKeyRef.current === location.key) {
      return;
    }

    handledLocationActionKeyRef.current = location.key;
    const query = state.searchQuery;

    async function initSession() {
      const session = await findOrCreateEmptySession();
      if (session) {
        activateSession(session);
        if (query) {
          setInput(query);
          setTimeout(() => {
            resizeAndFocusComposer(query.length);
          }, 50);
        }
      }
    }

    void initSession();
    navigate(location.pathname, { replace: true, state: null });
  }, [
    activePaneId,
    currentPaneId,
    isSplitPane,
    location.key,
    location.pathname,
    location.state,
    navigate,
    findOrCreateEmptySession,
    activateSession,
    setInput,
    resizeAndFocusComposer,
  ]);

  async function ensureSessionForChat(modelId: string, options?: { isIncognito?: boolean; excludeFromAnalytics?: boolean }) {
    if (!effectiveWorkspaceId) { return null; }

    let sessionId = activeChatId;
    let session = sessionId
      ? sessions.find((existingSession) => existingSession.id === sessionId) ?? null
      : null;

    if (!sessionId) {
      const nextSession = await findOrCreateEmptySession(options);
      if (!nextSession) { return null; }
      activateSession(nextSession);
      sessionId = nextSession.id;
      session = nextSession;
    }

    if (session && session.model_name !== modelId) {
      await api.chat.updateSession(effectiveWorkspaceId, session.id, { model_name: modelId });
      const updatedSession = {
        ...session,
        model_name: modelId,
        updated_at: new Date().toISOString(),
      };
      updateSessionInScope(updatedSession);
      session = updatedSession;
    }

    return { sessionId, session };
  }

  function resolveTitleGenerationModel(fallbackModel?: string | null) {
    const preferredTitleModel = useSettingsStore.getState().backgroundModel?.trim();
    if (preferredTitleModel) { return preferredTitleModel; }
    return fallbackModel?.trim() || "";
  }

  async function refreshSessionMetadataAfterAssistant(sessionId: string, model: string, firstMessage?: string, knownSession?: ChatSession) {
    const settingsSnapshot = useSettingsStore.getState();
    const mode = settingsSnapshot.chatTitleAutoRefresh;
    if (mode === "disabled") { return; }

    // Use the provided session object when available to avoid stale-closure misses
    // (e.g. a brand-new session that hasn't propagated through React state yet).
    const session = knownSession
      ?? sessions.find((s) => s.id === sessionId)
      ?? useChatStore.getState().sessions.find((s) => s.id === sessionId)
      ?? null;
    if (!session) { return; }
    if (session.is_incognito || session.exclude_from_analytics || session.is_imported) { return; }

    const sessionMessages = useChatStore.getState().messages[sessionId] ?? [];
    const userMessageCount = sessionMessages.filter(m => m.role === "user").length;
    const hasAssistantMessage = sessionMessages.some(m => m.role === "assistant" && m.content.trim().length > 0);
    const firstUserMessage = firstMessage ?? sessionMessages.find((m) => m.role === "user")?.content ?? "";
    if (!firstUserMessage.trim()) { return; }
    const isFirstMessage = userMessageCount <= 1;
    const lastTitleGenCount = session.message_count_at_title_gen ?? 0;
    const interval = settingsSnapshot.chatTitleRefreshInterval || 5;
    const shouldRefresh = isFirstMessage || (
      settingsSnapshot.chatTitleAutoRefresh === "periodic" &&
      userMessageCount - lastTitleGenCount >= interval
    );
    if (!shouldRefresh) { return; }
    const titleModel = resolveTitleGenerationModel(model);
    if (!titleModel) { return; }

    // Initial title generation on first message
    if (isFirstMessage && effectiveWorkspaceId) {
      try {
        const aiTitle = await api.ollama.generateTitle(titleModel, firstUserMessage, ollamaUrl).catch(() => null);
        const title = resolveChatTitle({ aiTitle, firstMessage: firstUserMessage });
        // Persist to DB
        await api.chat.updateSession(effectiveWorkspaceId, sessionId, { title });
        // Update scoped sessions list and sidebar
        updateSessionInScope({
          ...session,
          title,
          title_generated_at: new Date().toISOString(),
          message_count_at_title_gen: 1
        });
        setSidebarSessions((prev) => prev.map((item) => item.id === sessionId ? { ...item, title } : item));
      } catch {
        // Leave the existing title untouched if persistence fails.
      }
    } else if (settingsSnapshot.chatTitleAutoRefresh === "periodic" && effectiveWorkspaceId) {
      // Periodic title refresh — only in "periodic" mode, skip if "initial_only"
      try {
        // Send conversation context for a better title
        const conversation = sessionMessages.map(m => ({ role: m.role, content: m.content }));
        const aiTitle = await api.ollama.generateTitleFromConversation(titleModel, conversation, ollamaUrl).catch(() => null);
        const title = resolveChatTitle({ aiTitle, firstMessage: firstUserMessage });
        // Persist to DB
        await api.chat.updateSession(effectiveWorkspaceId, sessionId, { title });
        // Update scoped sessions list and sidebar
        updateSessionInScope({
          ...session,
          title,
          title_generated_at: new Date().toISOString(),
          message_count_at_title_gen: userMessageCount
        });
        setSidebarSessions((prev) => prev.map((item) => item.id === sessionId ? { ...item, title } : item));
      } catch {
        // Silently fail if title generation errors
      }
    }

    if (hasAssistantMessage) {
      const workspaceId = session.workspace_id || effectiveWorkspaceId;
      if (!workspaceId) { return; }
      await api.summary.generate(sessionId, workspaceId, "info", true).catch(() => {});
      if (useChatStore.getState().activeChatId === sessionId) {
        const summaries = await api.summary.list(sessionId).catch(() => []);
        setActiveChatSummary(pickInfoSummary(summaries));
      }
    }
  }

  function triggerFollowUps(sessionId: string) {
    const gen = ++followUpsGenRef.current;
    const history = (useChatStore.getState().messages[sessionId] ?? []).map(m => ({ role: m.role, content: m.content }));
    const bgModel = useSettingsStore.getState().backgroundModel;
    const model = bgModel || selectedModel || sessions.find((s) => s.id === sessionId)?.model_name || "";
    if (!model) { return; }
    const memoryPromise: Promise<Memory[]> = effectiveWorkspaceId
      ? api.memory.listActive(effectiveWorkspaceId).catch(() => [])
      : Promise.resolve([]);
    memoryPromise.then((memories) => {
      const memoryContext = memories.length > 0
        ? memories.map((m) => m.content).join("\n")
        : undefined;
      api.ollama.generateFollowUps(model, history, ollamaUrl, memoryContext)
        .then((suggestions) => { if (followUpsGenRef.current === gen) { setFollowUps(suggestions); } })
        .catch((e) => { console.warn("[follow-ups] failed:", e); });
    });
  }

  function invalidateFollowUps() {
    followUpsGenRef.current += 1;
    setFollowUps([]);
  }

  async function sendMessage() {
    const modelForSend = composerMode === "family"
      ? (activeFamilyDefaultModelId ?? selectedModel)
      : selectedModel;
    await sendMessageWithModel(modelForSend);
  }

  async function handleAttachFiles() {
    if (!effectiveWorkspaceId || isAttachingFiles || isStreaming) { return; }

    setIsAttachingFiles(true);
    try {
      const paths = await openDialog({
        multiple: true,
        filters: [{ name: "Documents", extensions: ["txt", "md", "json", "csv"] }],
      }) as string[] | null;
      if (!paths || paths.length === 0) { return; }

      const uploaded = await Promise.all(paths.map(async (path) => {
        const content = await readTextFile(path);
        const filename = path.split("/").pop() ?? path;
        const fileType = filename.split(".").pop() ?? "txt";
        const source = await api.source.create({
          workspace_id: effectiveWorkspaceId,
          source_type: "document",
          title: filename,
          filename,
          file_type: fileType,
          file_size: content.length,
          content,
        });
        void api.source.process(source.id).catch(() => {});
        return {
          id: source.id,
          title: source.title,
          content: source.content || content,
        };
      }));

      setAttachedSources((prev) => {
        const next = [...prev];
        for (const source of uploaded) {
          if (next.some((item) => item.id === source.id)) { continue; }
          next.push(source);
        }
        return next;
      });
      resizeAndFocusComposer();
    } catch (error) {
      const description = error instanceof Error ? error.message : "Aetherium could not attach those files.";
      openAlertDialog("Attachment failed", description, "danger");
    } finally {
      setIsAttachingFiles(false);
    }
  }

  function handleAttachImage() {
    setIsAttachmentMenuOpen(false);
    openAlertDialog(
      "Image attachments are not available yet",
      "This model can be marked for vision, but chat transport still sends text-only messages. Native image attachment support needs provider-level multimodal payloads before this menu item can be enabled.",
      "default",
    );
  }

  async function polishComposerPrompt() {
    const originalInput = input;
    const trimmedInput = originalInput.trim();
    const polishModel = draftModel || selectedModel || preferredModel;

    if (!trimmedInput || isStreaming || isPolishingPrompt || !polishModel) { return; }

    setIsPolishingPrompt(true);
    try {
      const polished = await api.ollama.polishPrompt(polishModel, originalInput, ollamaUrl);
      if (inputRef.current?.value !== originalInput) {
        return;
      }

      const nextInput = polished.trim();
      if (!nextInput || nextInput === trimmedInput) {
        resizeAndFocusComposer();
        return;
      }

      setPolishUndoInput(originalInput);
      setInput(nextInput);
      resizeAndFocusComposer(nextInput.length);
    } catch (error) {
      const description = error instanceof Error ? error.message : "Aetherium could not polish that prompt.";
      openAlertDialog("Prompt polish failed", description, "danger");
    } finally {
      setIsPolishingPrompt(false);
    }
  }

  function undoPolishedPrompt() {
    if (polishUndoInput === null || isPolishingPrompt || isStreaming) { return; }
    setInput(polishUndoInput);
    resizeAndFocusComposer(polishUndoInput.length);
    setPolishUndoInput(null);
  }

  function maybeExtractFlashcards(responseText: string, sessionId: string, modelId: string) {
    const { autoGenerateFlashcards } = useSettingsStore.getState();
    if (!autoGenerateFlashcards || !effectiveWorkspaceId || responseText.length < 100) { return; }
    api.flashcard.extractFromContent(effectiveWorkspaceId, responseText, "chat", modelId, sessionId, ollamaUrl || undefined)
      .catch(() => { });
  }

  async function queueWithModel(modelId: string) {
    if (!input.trim() || !effectiveWorkspaceId || !modelId) { return; }
    const ensured = await ensureSessionForChat(modelId);
    if (!ensured) { return; }
    await api.thoughtQueue.create(effectiveWorkspaceId, input.trim(), {
      modelName: modelId,
      sessionId: ensured.sessionId,
      processAt: new Date(Date.now() + 60_000).toISOString(),
    });
    setInput("");
  }

  async function sendMessageWithModel(modelId: string, contentOverride?: string) {
    const userContent = (contentOverride ?? input).trim();
    if (!userContent || isStreaming || !modelId || !effectiveWorkspaceId) { return; }

    const modelMeta = aiModelById.get(modelId);
    const isOneOffWebProvider = modelMeta?.provider.startsWith("web_") ?? false;
    const isLlamacppProvider = modelMeta?.provider === "llamacpp";
    const isMlxProvider = modelMeta?.provider === "mlx";
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const oneOffWebProviderKey = isOneOffWebProvider ? modelMeta!.provider.replace("web_", "") : "";

    const ensuredSession = await ensureSessionForChat(modelId);
    if (!ensuredSession) { return; }
    const sid = ensuredSession.sessionId;

    if (contentOverride === undefined) {
      setInput("");
    }
    setIsStreaming(true);
    setStreamingSession(sid);
    setLastUserMessage(userContent);
    setFollowUps([]);

    // Guard migration check: skip for incognito / analytics-excluded sessions,
    // very short messages (prone to false positives), and sessions where the
    // user already dismissed the suggestion.
    const sessionForMigrationCheck = ensuredSession.session;
    const skipMigrationCheck =
      !effectiveWorkspaceId ||
      workspaces.length < 2 ||
      sessionForMigrationCheck?.is_incognito ||
      sessionForMigrationCheck?.exclude_from_analytics ||
      userContent.length < 20 ||
      migrationDismissedSessionsRef.current.has(sid);

    if (!skipMigrationCheck) {
      api.topicSignature.checkMatch(effectiveWorkspaceId, userContent)
        .then(result => { if (!result.is_match && result.suggestion) { setMigrationSuggestion(result); } })
        .catch(() => { });
    }

    const optimisticUserMsg: Message = {
      id: window.crypto.randomUUID(),
      session_id: sid,
      role: "user",
      content: userContent,
      created_at: new Date().toISOString(),
    };
    appendMessage(sid, optimisticUserMsg);
    pendingSentScrollId.current = optimisticUserMsg.id;

    const userMsg = await api.chat.addMessage(effectiveWorkspaceId, sid, "user", userContent);
    updateMessage(sid, persistedUserMessageWithFallback(optimisticUserMsg, userMsg));

    const history = (useChatStore.getState().messages[sid] ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Inject workspace domain context as a system message so the model
    // understands the topic area without requiring explicit user clarification.
    const activeWs = workspaceById.get(effectiveWorkspaceId ?? "") ?? null;
    const activeFolderObj = folderById.get(effectiveFolderId ?? "") ?? null;
    const domainContext = buildWorkspaceDomainContext(activeWs, activeFolderObj, activeTopicSignature);
    if (domainContext && (history.length === 0 || history[0].role !== "system")) {
      history.unshift({ role: "system", content: domainContext });
    }

    let finalUserContent = userContent;
    const attachmentContext = buildAttachmentContext(userContent, attachedSources);
    if (attachmentContext) {
      finalUserContent =
        `${attachmentContext}\n\n` +
        `User request: ${userContent}`;
    }

    if (attachedSources.length > 0) {
      setAttachedSources([]);
    }

    history.push({ role: "user", content: finalUserContent });

    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    if (isOneOffWebProvider && oneOffWebProviderKey) {
      try {
        clearStreamListener();
        const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs, loadDurationMs) => {
          if (done) {
            const assembled = useChatStore.getState().streamingContent;
            finalizeStream(sid!, modelId, tokensUsed, durationMs, loadDurationMs);
            setIsStreaming(false);
            clearStreamListener();
            api.chat.addMessage(effectiveWorkspaceId, sid!, "assistant", assembled, modelId, tokensUsed, durationMs)
              .then((persisted) => {
                updateMessage(sid!, persisted);
                void refreshSessionMetadataAfterAssistant(sid!, modelId, userContent, ensuredSession.session ?? undefined);
                triggerFollowUps(sid!);
              })
              .catch(() => { });
            if (tokensUsed && tokensUsed > 0) {
              api.aiModel.recordTokenUsage(modelId, `web_${oneOffWebProviderKey}`, tokensUsed).catch(() => { });
            }
            maybeExtractFlashcards(assembled, sid!, modelId);
          } else {
            appendStreamChunk(sid!, chunk);
          }
        });
        streamUnlistenRef.current = unlisten;
        await api.webAI.sendMessage(sid, oneOffWebProviderKey, finalUserContent, preserveWebSession);
      } catch (err) {
        clearStreamListener();
        setIsStreaming(false);
        const errMsg = err instanceof Error ? err.message : String(err);
        appendStreamChunk(sid, `\n\n⚠️ Error: ${errMsg}`);
        finalizeStream(sid, modelId);
      }
    } else if (isLlamacppProvider) {
      try {
        clearStreamListener();
        const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs, loadDurationMs) => {
          if (done) {
            const assembled = useChatStore.getState().streamingContent;
            finalizeStream(sid!, modelId, tokensUsed, durationMs, loadDurationMs);
            setIsStreaming(false);
            clearStreamListener();
            api.chat.addMessage(effectiveWorkspaceId, sid!, "assistant", assembled, modelId, tokensUsed, durationMs)
              .then((persisted) => {
                updateMessage(sid!, persisted);
                void refreshSessionMetadataAfterAssistant(sid!, modelId, userContent, ensuredSession.session ?? undefined);
                triggerFollowUps(sid!);
              })
              .catch(() => { });
            if (tokensUsed && tokensUsed > 0) {
              api.aiModel.recordTokenUsage(modelId, "llamacpp", tokensUsed).catch(() => { });
            }
            maybeExtractFlashcards(assembled, sid!, modelId);
          } else {
            appendStreamChunk(sid!, chunk);
          }
        });
        streamUnlistenRef.current = unlisten;
        await api.llamacpp.sendMessage(sid, modelId, history);
      } catch (err) {
        clearStreamListener();
        setIsStreaming(false);
        const errMsg = err instanceof Error ? err.message : String(err);
        appendStreamChunk(sid, `\n\n⚠️ Error: ${errMsg}`);
        finalizeStream(sid, modelId);
      }
    } else if (isMlxProvider) {
      try {
        clearStreamListener();
        const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs, loadDurationMs) => {
          if (done) {
            const assembled = useChatStore.getState().streamingContent;
            finalizeStream(sid!, modelId, tokensUsed, durationMs, loadDurationMs);
            setIsStreaming(false);
            clearStreamListener();
            api.chat.addMessage(effectiveWorkspaceId, sid!, "assistant", assembled, modelId, tokensUsed, durationMs)
              .then((persisted) => {
                updateMessage(sid!, persisted);
                void refreshSessionMetadataAfterAssistant(sid!, modelId, userContent, ensuredSession.session ?? undefined);
                triggerFollowUps(sid!);
              })
              .catch(() => { });
            if (tokensUsed && tokensUsed > 0) {
              api.aiModel.recordTokenUsage(modelId, "mlx", tokensUsed).catch(() => { });
            }
            maybeExtractFlashcards(assembled, sid!, modelId);
          } else {
            appendStreamChunk(sid!, chunk);
          }
        });
        streamUnlistenRef.current = unlisten;
        await api.mlx.sendMessage(sid, modelId, history, useSettingsStore.getState().mlxUrl);
      } catch (err) {
        clearStreamListener();
        setIsStreaming(false);
        const errMsg = err instanceof Error ? err.message : String(err);
        appendStreamChunk(sid, `\n\n⚠️ Error: ${errMsg}`);
        finalizeStream(sid, modelId);
      }
    } else {
      try {
        clearStreamListener();
        const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs, loadDurationMs) => {
          if (done) {
            const assembled = useChatStore.getState().streamingContent;
            finalizeStream(sid!, modelId, tokensUsed, durationMs, loadDurationMs);
            setIsStreaming(false);
            clearStreamListener();
            api.chat.addMessage(effectiveWorkspaceId, sid!, "assistant", assembled, modelId, tokensUsed, durationMs)
              .then((persisted) => {
                updateMessage(sid!, persisted);
                void refreshSessionMetadataAfterAssistant(sid!, modelId, userContent, ensuredSession.session ?? undefined);
                triggerFollowUps(sid!);
              })
              .catch(() => { });
            if (tokensUsed && tokensUsed > 0) {
              api.aiModel.recordTokenUsage(modelId, "ollama", tokensUsed).catch(() => { });
            }
            maybeExtractFlashcards(assembled, sid!, modelId);
          } else {
            appendStreamChunk(sid!, chunk);
          }
        });
        streamUnlistenRef.current = unlisten;

        await api.ollama.sendMessage(sid, modelId, history, true, ollamaUrl || undefined);
      } catch (err) {
        clearStreamListener();
        setIsStreaming(false);
        const errMsg = err instanceof Error ? err.message : String(err);
        appendStreamChunk(sid, `\n\n⚠️ Error: ${errMsg}`);
        finalizeStream(sid, modelId);
      }
    }
    /* eslint-enable @typescript-eslint/no-non-null-assertion */

  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function handleComposerSuggestion(suggestion: ComposerSuggestion, sendImmediately?: boolean) {
    const modelForSend = composerMode === "family"
      ? (activeFamilyDefaultModelId ?? selectedModel)
      : selectedModel;

    if (suggestion.action === "send_immediately" || sendImmediately) {
      await sendMessageWithModel(modelForSend, suggestion.prompt);
      return;
    }

    if (!activeChatId) {
      const session = await findOrCreateEmptySession();
      if (session) {
        activateSession(session);
      }
    }

    setInput((prev) => mergeComposerInput(prev, suggestion.prompt));
    requestAnimationFrame(() => resizeAndFocusComposer(suggestion.prompt.length));
  }
  const handleComposerSuggestionRef = useRef(handleComposerSuggestion);
  handleComposerSuggestionRef.current = handleComposerSuggestion;

  const deleteSession = useCallback(async (id: string) => {
    if (!effectiveWorkspaceId) { return; }
    const settings = useSettingsStore.getState();
    const isImmediate = settings.immediateDelete;
    const skipConfirm = !isImmediate && !settings.confirmMoveToTrash;

    if (!skipConfirm) {
      const confirmMsg = isImmediate
        ? "Permanently delete this chat session and all its messages? This cannot be undone."
        : "Move this chat to the recycle bin?";

      if (!await openConfirmDialog({
        title: isImmediate ? "Delete chat?" : "Move chat to recycle bin?",
        description: confirmMsg,
        confirmLabel: isImmediate ? "Delete" : "Move to Recycle Bin",
        tone: "danger",
      })) { return; }
    }

    await api.chat.deleteSession(effectiveWorkspaceId, id);
    removeSessionFromScope(id);
    setSidebarSessions((prev) => prev.filter((session) => session.id !== id));
    if (activeChatId === id) { setActiveChatId(null); }
  }, [effectiveWorkspaceId, openConfirmDialog, removeSessionFromScope, activeChatId, setActiveChatId]);

  const togglePin = useCallback(async (session: ChatSession) => {
    if (!effectiveWorkspaceId) { return; }
    await api.chat.updateSession(effectiveWorkspaceId, session.id, { is_pinned: !session.is_pinned });
    replaceSessions(
      sessions.map((s) =>
        s.id === session.id ? { ...s, is_pinned: !s.is_pinned } : s
      )
    );
    setSidebarSessions((prev) => prev.map((item) => item.id === session.id ? { ...item, is_pinned: !item.is_pinned } : item));
  }, [effectiveWorkspaceId, sessions, replaceSessions]);

  const toggleExcludeFromAnalytics = useCallback(async (session: ChatSession) => {
    if (!effectiveWorkspaceId) { return; }
    const next = !session.exclude_from_analytics;
    await api.chat.updateSession(effectiveWorkspaceId, session.id, { exclude_from_analytics: next });
    replaceSessions(sessions.map((s) => s.id === session.id ? { ...s, exclude_from_analytics: next } : s));
    setSidebarSessions((prev) => prev.map((item) => item.id === session.id ? { ...item, exclude_from_analytics: next } : item));
  }, [effectiveWorkspaceId, sessions, replaceSessions]);

  const renameSession = useCallback(async (id: string) => {
    if (!renameTitle.trim() || !effectiveWorkspaceId) { setRenamingId(null); return; }
    await api.chat.updateSession(effectiveWorkspaceId, id, { title: renameTitle });
    replaceSessions(sessions.map((s) => s.id === id ? { ...s, title: renameTitle } : s));
    setSidebarSessions((prev) => prev.map((session) => session.id === id ? { ...session, title: renameTitle } : session));
    setRenamingId(null);
  }, [effectiveWorkspaceId, renameTitle, sessions, replaceSessions]);

  const refreshSessionTitle = useCallback(async (session: ChatSession) => {
    if (!effectiveWorkspaceId) { return; }

    const sessionMessages = (useChatStore.getState().messages[session.id] ?? [])
      .filter((message) => message.role === "user" || message.role === "assistant");
    const firstUserMessage = sessionMessages.find((message) => message.role === "user")?.content?.trim() ?? "";
    if (!firstUserMessage) { return; }

    const model = resolveTitleGenerationModel(session.model_name || selectedModel);
    if (!model) { return; }

    try {
      const aiTitle = sessionMessages.filter((message) => message.role === "user").length > 1
        ? await api.ollama.generateTitleFromConversation(
          model,
          sessionMessages.map((message) => ({ role: message.role, content: message.content })),
          ollamaUrl,
        ).catch(() => null)
        : await api.ollama.generateTitle(model, firstUserMessage, ollamaUrl).catch(() => null);

      const title = resolveChatTitle({ aiTitle, firstMessage: firstUserMessage });
      await api.chat.updateSession(effectiveWorkspaceId, session.id, { title });
      updateSessionInScope({
        ...session,
        title,
        title_generated_at: new Date().toISOString(),
        message_count_at_title_gen: sessionMessages.filter((message) => message.role === "user").length,
      });
      setSidebarSessions((prev) => prev.map((item) => item.id === session.id ? { ...item, title } : item));
    } catch {
      // Leave the current title in place if refresh fails.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveWorkspaceId, selectedModel]);

  const moveSessionsToTarget = useCallback(async (sessionIds: string[], workspaceId: string, folderId: string | null) => {
    if (sessionIds.length === 0) { return; }
    const sessionIdSet = new Set(sessionIds);
    const isCrossWorkspaceMove = workspaceId !== effectiveWorkspaceId;
    const shouldPreserveFolderStructure = isCrossWorkspaceMove && folderId === null;

    // Optimistic UI update: remove from source immediately
    if (isCrossWorkspaceMove) {
      setSidebarSessions((prev) => prev.filter((session) => !sessionIdSet.has(session.id)));
      replaceSessions(sessions.filter((session) => !sessionIdSet.has(session.id)));
    }

    if (isCrossWorkspaceMove && shouldPreserveFolderStructure) {
      // Use batch move: single IPC call handles folder lookup/create + all moves
      const result = await api.chat.batchMoveSessions(sessionIds, workspaceId, true);

      // Determine which folder to navigate to
      const mappedFolderIds = Object.values(result.folder_mapping);
      const destinationFolderIdForView = mappedFolderIds.length === 1 ? mappedFolderIds[0] : null;

      setScopedWorkspaceId(workspaceId);
      setScopedFolderId(destinationFolderIdForView);

      // Refresh only the destination workspace tree (source already updated optimistically)
      await refreshFolderTree(workspaceId);

      if (activeChatId && sessionIds.includes(activeChatId)) {
        setActiveChatId(sessionIds.length === 1 ? activeChatId : null);
      }
    } else if (isCrossWorkspaceMove) {
      // Cross-workspace move to specific folder or root
      await api.chat.moveSessions(sessionIds, workspaceId, folderId ?? undefined);

      setScopedWorkspaceId(workspaceId);
      setScopedFolderId(folderId);

      // Refresh only the destination workspace tree
      await refreshFolderTree(workspaceId);

      if (activeChatId && sessionIds.includes(activeChatId)) {
        setActiveChatId(sessionIds.length === 1 ? activeChatId : null);
      }
    } else {
      // Same-workspace move
      await api.chat.moveSessions(sessionIds, workspaceId, folderId ?? undefined);

      // Optimistic local update for same-workspace
      setScopedFolderId(folderId);
      setSidebarSessions((prev) => prev.map((session) => (
        sessionIdSet.has(session.id)
          ? { ...session, workspace_id: workspaceId, folder_id: folderId ?? "" }
          : session
      )));
      replaceSessions(sessions.map((session) => (
        sessionIdSet.has(session.id)
          ? { ...session, workspace_id: workspaceId, folder_id: folderId ?? "" }
          : session
      )));

      // Light refresh for project counts (sessions already updated optimistically)
      if (effectiveWorkspaceId) {
        const refreshedFolders = await api.folder.list(effectiveWorkspaceId, { includeDescendants });
        setFoldersForWorkspace(effectiveWorkspaceId, refreshedFolders);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveWorkspaceId, sessions, sidebarSessions, activeChatId, includeDescendants, setScopedWorkspaceId, setScopedFolderId, setFoldersForWorkspace]);

  const renameFolder = useCallback(async (folderId: string, name: string) => {
    if (!effectiveWorkspaceId || !name.trim()) { return; }
    await api.folder.update(folderId, { name: name.trim() });
    await refreshFolderTree(effectiveWorkspaceId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveWorkspaceId]);

  const moveFolderToWorkspace = useCallback(async (folder: Folder, targetWorkspaceId: string) => {
    if (folder.workspace_id === targetWorkspaceId) { return; }

    const folderSessionIds = sidebarSessions
      .filter((session) => session.folder_id === folder.id)
      .map((session) => session.id);

    // Snapshot state for potential rollback
    const prevSidebarSessions = [...sidebarSessions];
    const prevSessions = [...sessions];
    const prevWorkspaceProjects = useWorkspaceStore.getState().foldersByWorkspace[folder.workspace_id] ?? [];

    // Optimistic UI update: remove from source workspace locally without doing a full refresh
    // Instead we just remove it from sidebarSessions and sessions, and let the background refresh
    // or navigation handle the rest, specifically avoiding refreshFolderTree(effectiveWorkspaceId).
    setSidebarSessions((prev) => prev.filter((session) => session.folder_id !== folder.id));
    replaceSessions(sessions.filter((session) => session.folder_id !== folder.id));

    // For the projects list, we can optimistically update the workspace store
    useWorkspaceStore.getState().setFoldersForWorkspace(
      folder.workspace_id,
      prevWorkspaceProjects.filter(p => p.id !== folder.id)
    );

    try {
      // Use the single transaction Rust backend command
      const movedProject = await api.folder.moveToWorkspace(folder.id, targetWorkspaceId);

      // Now navigate to the target workspace and refresh only its tree.
      setScopedWorkspaceId(targetWorkspaceId);
      setScopedFolderId(movedProject.id);
      await refreshFolderTree(targetWorkspaceId);

      if (activeChatId && folderSessionIds.includes(activeChatId)) {
        // If we had the active chat open, keep it open if it was a single move, or reset if multiple
        setActiveChatId(folderSessionIds.length === 1 ? activeChatId : null);
      } else if (effectiveFolderId === folder.id) {
        // If we had the project open but not a chat, we navigate to the new project.
        setScopedFolderId(movedProject.id);
      }
    } catch (error) {
      // Rollback on failure
      setSidebarSessions(prevSidebarSessions);
      replaceSessions(prevSessions);
      useWorkspaceStore.getState().setFoldersForWorkspace(folder.workspace_id, prevWorkspaceProjects);

      const description = error instanceof Error
        ? error.message
        : typeof error === "string" && error.trim()
          ? error
          : "Failed to move folder.";
      openAlertDialog("Move failed", description, "danger");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarSessions, sessions, activeChatId, effectiveFolderId, openAlertDialog, setScopedWorkspaceId, setScopedFolderId, setFoldersForWorkspace]);

  const deleteFolder = useCallback(async (folderId: string) => {
    if (!effectiveWorkspaceId) { return; }
    const projectSessions = sidebarSessions.filter((session) => session.folder_id === folderId).map((session) => session.id);
    const confirmMsg = projectSessions.length > 0
      ? `Delete this folder? ${projectSessions.length} chat${projectSessions.length === 1 ? "" : "s"} will be moved to the workspace root.`
      : "Delete this empty folder?";

    if (!await openConfirmDialog({
      title: "Delete folder?",
      description: confirmMsg,
      confirmLabel: "Delete Folder",
      tone: "danger",
    })) { return; }

    if (projectSessions.length > 0) {
      await api.chat.moveSessions(projectSessions, effectiveWorkspaceId, undefined);
    }
    await api.folder.delete(folderId);
    if (effectiveFolderId === folderId) {
      setScopedFolderId(null);
    }
    await Promise.all([
      refreshFolderTree(effectiveWorkspaceId),
      refreshScopedSessions(effectiveWorkspaceId, effectiveFolderId === folderId ? null : effectiveFolderId),
    ]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveWorkspaceId, sidebarSessions, effectiveFolderId, openConfirmDialog, setScopedFolderId]);

  const createWorkspaceForMove = useCallback(async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Workspace name cannot be empty.");
    }

    const workspace = await api.workspace.create(trimmedName);
    addWorkspace(workspace);
    return workspace;
  }, [addWorkspace]);

  const saveSession = useCallback(async (session: ChatSession) => {
    try {
      const destPath = await saveDialog({
        defaultPath: chatExportFilename(session.title || "chat"),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!destPath) { return; }
      await api.chatFile.exportAsJson(session.id, destPath);
      setSuccessDialog({
        title: "Export complete",
        description: `Successfully exported chat "${session.title || "chat"}" as JSON.`,
      });
    } catch (err) {
      const description = err instanceof Error
        ? err.message
        : typeof err === "string" && err.trim()
          ? err
          : "Failed to save chat.";
      console.error("Failed to save chat:", err);
      openAlertDialog("Save failed", description, "danger");
    }
  }, [openAlertDialog]);

  function _copyMessage(msgId: string, content: string) {
    window.navigator.clipboard.writeText(content);
    setCopiedMessageId(msgId);
    setTimeout(() => setCopiedMessageId(null), 1500);
  }

  function _startEditing(msgId: string, content: string) {
    setEditingMessageId(msgId);
    setEditContent(content);
  }

  async function submitEdit(msgId: string) {
    if (!activeChatId || !editContent.trim() || !effectiveWorkspaceId) { return; }
    setEditingMessageId(null);
    const idx = activeMessages.findIndex((m) => m.id === msgId);
    if (idx < 0) { return; }

    const hasSubsequentUserMessages = activeMessages.slice(idx + 1).some((m) => m.role === "user");
    if (hasSubsequentUserMessages) {
      if (!await openConfirmDialog({
        title: "Edit Message?",
        description: "Editing this message will delete all subsequent messages in this conversation. This cannot be undone.",
        confirmLabel: "Edit Message",
        tone: "danger",
      })) {
        return;
      }
    }

    const trimmedMessages = activeMessages.slice(0, idx);
    setMessages(activeChatId, trimmedMessages);
    setInput("");
    setIsStreaming(true);
    setStreamingSession(activeChatId);
    setLastUserMessage(editContent.trim());
    invalidateFollowUps();

    const optimisticUserMsg: Message = {
      id: window.crypto.randomUUID(),
      session_id: activeChatId,
      role: "user",
      content: editContent.trim(),
      created_at: new Date().toISOString(),
    };
    appendMessage(activeChatId, optimisticUserMsg);

    const userMsg = await api.chat.addMessage(effectiveWorkspaceId, activeChatId, "user", editContent.trim());
    updateMessage(activeChatId, persistedUserMessageWithFallback(optimisticUserMsg, userMsg));

    const history = trimmedMessages.map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content: editContent.trim() });

    try {
      const sid = activeChatId;
      clearStreamListener();
      const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs, loadDurationMs) => {
        if (done) {
          const assembled = useChatStore.getState().streamingContent;
          finalizeStream(sid, selectedModel, tokensUsed, durationMs, loadDurationMs);
          setIsStreaming(false);
          clearStreamListener();
          api.chat.addMessage(effectiveWorkspaceId, sid, "assistant", assembled, selectedModel, tokensUsed, durationMs)
            .then((persisted) => {
              updateMessage(sid, persisted);
              void refreshSessionMetadataAfterAssistant(sid, selectedModel, editContent.trim());
              triggerFollowUps(sid);
            })
            .catch(() => { });
          if (tokensUsed && tokensUsed > 0) {
            api.aiModel.recordTokenUsage(selectedModel, "ollama", tokensUsed).catch(() => { });
          }
        } else {
          appendStreamChunk(sid, chunk);
        }
      });
      streamUnlistenRef.current = unlisten;
      await api.ollama.sendMessage(sid, selectedModel, history, true, ollamaUrl || undefined);
    } catch (err) {
      clearStreamListener();
      setIsStreaming(false);
      const errMsg = err instanceof Error ? err.message : String(err);
      appendStreamChunk(activeChatId, `\n\n⚠️ Error: ${errMsg}`);
      finalizeStream(activeChatId, selectedModel);
    }
  }

  async function redoMessage(msgId: string, modelId: string) {
    if (!activeChatId || isStreaming || !effectiveWorkspaceId) { return; }
    const idx = activeMessages.findIndex((m) => m.id === msgId);
    if (idx < 0) { return; }

    const hasSubsequentUserMessages = activeMessages.slice(idx + 1).some((m) => m.role === "user");
    if (idx < activeMessages.length - 1) {
      if (hasSubsequentUserMessages) {
        if (!await openConfirmDialog({
          title: "Regenerate Message?",
          description: "Redoing this message will delete all subsequent messages in this conversation. This cannot be undone.",
          confirmLabel: "Regenerate",
          tone: "danger",
        })) {
          return;
        }
      }
      // Clear variation state for deleted messages and the redo'd message since history changes
      const deletedIds = activeMessages.slice(idx + 1).map((m) => m.id);
      setMessageVariations((prev) => {
        const next = new Map(prev);
        deletedIds.forEach((id) => next.delete(id));
        next.delete(msgId);
        return next;
      });
      setVariationIndex((prev) => {
        const next = new Map(prev);
        deletedIds.forEach((id) => next.delete(id));
        next.delete(msgId);
        return next;
      });
    }

    // Capture original message as variation 0 before overwriting
    const existingVariations = messageVariations.get(msgId) ?? [];
    const originalMsg = activeMessages[idx];
    if (existingVariations.length === 0) {
      setMessageVariations((prev) => new Map(prev).set(msgId, [originalMsg]));
    }

    const trimmedMessages = activeMessages.slice(0, idx);
    setMessages(activeChatId, trimmedMessages);
    invalidateFollowUps();

    setIsStreaming(true);
    setStreamingSession(activeChatId);
    try {
      const sid = activeChatId;
      clearStreamListener();
      const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs, loadDurationMs) => {
        if (done) {
          const assembled = useChatStore.getState().streamingContent;
          finalizeStream(sid, modelId, tokensUsed, durationMs, loadDurationMs);
          setIsStreaming(false);
          clearStreamListener();
          api.chat.addMessage(effectiveWorkspaceId, sid, "assistant", assembled, modelId, tokensUsed, durationMs)
            .then((persisted) => {
              updateMessage(sid, persisted);
              void refreshSessionMetadataAfterAssistant(sid, modelId);
              triggerFollowUps(sid);
              setMessageVariations((prev) => {
                const existing: Message[] = prev.get(msgId) ?? [];
                const updated = [...existing, persisted];
                setVariationIndex((vi) => new Map(vi).set(msgId, updated.length - 1));
                return new Map(prev).set(msgId, updated);
              });
            })
            .catch(() => { });
          if (tokensUsed && tokensUsed > 0) {
            api.aiModel.recordTokenUsage(modelId, "ollama", tokensUsed).catch(() => { });
          }
        } else {
          appendStreamChunk(sid, chunk);
        }
      });
      streamUnlistenRef.current = unlisten;
      await api.ollama.sendMessage(sid, modelId, trimmedMessages.map((m) => ({ role: m.role, content: m.content })), true, ollamaUrl || undefined);
    } catch (err) {
      clearStreamListener();
      setIsStreaming(false);
      const errMsg = err instanceof Error ? err.message : String(err);
      appendStreamChunk(activeChatId, `\n\n⚠️ Error: ${errMsg}`);
      finalizeStream(activeChatId, modelId);
    }
  }

  function handleVariationChange(msgId: string, newIndex: number) {
    const vars = messageVariations.get(msgId);
    if (!vars || newIndex < 0 || newIndex >= vars.length) { return; }
    setVariationIndex((prev) => new Map(prev).set(msgId, newIndex));
    if (activeChatId) { updateMessage(activeChatId, vars[newIndex]); }
  }

  async function deleteMessageAndFollowing(msgId: string) {
    if (!activeChatId || isStreaming) { return; }
    const idx = activeMessages.findIndex((m) => m.id === msgId);
    if (idx < 0) { return; }
    const followingCount = activeMessages.length - idx - 1;
    const description = followingCount > 0
      ? `This will permanently delete this message and ${followingCount} message${followingCount === 1 ? "" : "s"} that follow it. This cannot be undone.`
      : "This will permanently delete this message. This cannot be undone.";
    if (!await openConfirmDialog({
      title: "Delete Message?",
      description,
      confirmLabel: "Delete",
      tone: "danger",
    })) {
      return;
    }

    const deletedIds = activeMessages.slice(idx).map((m) => m.id);
    setMessages(activeChatId, activeMessages.slice(0, idx));
    invalidateFollowUps();
    setMessageVariations((prev) => {
      const next = new Map(prev);
      deletedIds.forEach((id) => next.delete(id));
      return next;
    });
    setVariationIndex((prev) => {
      const next = new Map(prev);
      deletedIds.forEach((id) => next.delete(id));
      return next;
    });

    try {
      await api.chat.deleteMessageAndFollowing(activeChatId, msgId);
    } catch (err) {
      console.error("Failed to delete message", err);
    }
  }

  redoMessageRef.current = redoMessage;
  submitEditRef.current = submitEdit;
  handleVariationChangeRef.current = handleVariationChange;
  handleDeleteMessageRef.current = deleteMessageAndFollowing;

  // Load models for comparison mode
  useEffect(() => {
    if (activeSubView !== "compare") { return; }
    api.ollama.listModels(ollamaUrl || undefined).then((list) => {
      const filtered = list.filter((m) => !m.name.toLowerCase().includes("embed"));
      setCompareModels(filtered);
      if (filtered.length > 0) {
        setCompareModelA((current) => current || filtered[0].name);
      }
      if (filtered.length > 1) {
        setCompareModelB((current) => current || filtered[1].name);
      } else if (filtered.length === 1) {
        setCompareModelB((current) => current || filtered[0].name);
      }
    }).catch(() => { });
  }, [activeSubView, ollamaUrl]);

  async function runComparison() {
    if (!comparePrompt.trim() || compareLoading) { return; }
    const p = comparePrompt.trim();
    setComparePrompt("");
    setCompareResponseA("");
    setCompareResponseB("");
    setCompareError(null);
    setCompareLoading(true);
    try {
      const msgs = [{ role: "user", content: p }];
      const [resA, resB] = await Promise.all([
        api.ollama.sendMessage("compare-a", compareModelA, msgs, false, ollamaUrl || undefined),
        api.ollama.sendMessage("compare-b", compareModelB, msgs, false, ollamaUrl || undefined),
      ]);
      setCompareResponseA(resA);
      setCompareResponseB(resB);

    } catch (err) {
      setCompareError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompareLoading(false);
    }
  }

  const activeFolder = folderById.get(effectiveFolderId ?? "") ?? null;
  const activeWorkspace = workspaceById.get(effectiveWorkspaceId ?? "") ?? null;

  // Bucket enabled models into Fast / Balanced / Powerful tiers
  const enabledModels = aiModelList.filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
  const tierSize = Math.ceil(enabledModels.length / 3);
  const modelTiers = [
    enabledModels.slice(0, tierSize),
    enabledModels.slice(tierSize, tierSize * 2),
    enabledModels.slice(tierSize * 2),
  ].filter((tier) => tier.length > 0);
  const _activeTierIdx = modelTiers.findIndex((tier) =>
    tier.some((m) => m.model_id === selectedModel)
  );

  // Family mode: group enabled models by ID prefix
  const {
    modelFamilies,
    selectedFamily,
    setSelectedFamily,
    activeFamilyModels,
    activeFamilyDefaultModelId,
    setShowFamilyVariant,
  } = useModelFamilyPicker({
    enabledModels,
    modelFamilyLabels,
    selectedModel,
    composerMode,
    isStreaming,
  });

  const {
    chatFollowUpRow,
    composerSuggestionRows,
    setIsComposerHeaderCollapsed,
    hasComposerHeader,
    showComposerHeader,
    waterfallSuggestions,
    handleDismissSuggestion,
  } = useComposerSuggestions({
    activeWorkspace,
    activeFolder,
    activeTopicSignature,
    promptBankPrompts,
    attachedSourcesCount: attachedSources.length,
    activeMessages,
    followUps,
    showComposerWorkspaceSuggestions,
    showComposerChatFollowUps,
    activeChatId,
    effectiveWorkspaceId,
  });

  // Map model_id to display name from global labels or priority list
  const modelDisplayName = (modelId: string) => resolveModelDisplayName(modelId, modelLabels, aiModelList);
  const selectedModelSupportsVision = !!aiModelList.find((model) => model.model_id === selectedModel)?.role_tags?.includes("vision");

  const modelPickerLabel = (modelId: string) => {
    return modelDisplayName(modelId);
  };
  const _activeFamilyDefaultModelLabel = activeFamilyDefaultModelId
    ? modelPickerLabel(activeFamilyDefaultModelId)
    : null;

  const canRefreshActiveSessionTitle = activeSession
    ? canRefreshSessionTitle(activeSession, useChatStore.getState().messages)
    : false;

  // Stable Virtuoso Footer — lives inside the scroll area so growing content
  // doesn't resize the Virtuoso container (which causes layout thrashing).
  const VirtuosoFooter = useCallback(() => {
    const shouldShowFollowUps =
      !!chatFollowUpRow
      && !isCurrentlyStreaming
      && activeMessages.length > 0
      && activeMessages[activeMessages.length - 1].role === "assistant";

    return (
      <>
        <StreamingBubble
          activeChatId={activeChatId}
          chatMessageStyle={chatMessageStyle}
          expandChatToWindowWidth={expandChatToWindowWidth}
        />
        {shouldShowFollowUps && (
          <div
            data-testid="chat-follow-ups"
            className={`${chatMessageStyle === "minimal" ? "px-8 pb-8" : "pl-4 pr-[52px] pb-4"}`}
          >
            <div className={`${expandChatToWindowWidth ? "w-full" : "w-full max-w-5xl"} mx-auto min-w-0`}>
              <ComposerSuggestionRows
                rows={[chatFollowUpRow]}
                disabled={isStreaming}
                disableImmediateSend={!selectedModel || !effectiveWorkspaceId}
                variant="follow-up"
                onSuggestionClick={(s, send) => handleComposerSuggestionRef.current(s, send)}
              />
            </div>
          </div>
        )}
      </>
    );
  }, [
    activeChatId,
    activeMessages,
    chatFollowUpRow,
    chatMessageStyle,
    effectiveWorkspaceId,
    expandChatToWindowWidth,
    isCurrentlyStreaming,
    isStreaming,
    selectedModel,
  ]);

  const virtuosoComponents = useMemo(() => ({ Footer: VirtuosoFooter }), [VirtuosoFooter]);

  const isComparePanelOpen = activeSubView === "compare";
  const chatWorkspaceClassName = "flex flex-1 min-w-0 min-h-0 overflow-hidden";

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <div ref={chatViewRef} className="flex h-full min-h-0 w-full min-w-0 overflow-hidden">
      <SessionSidebar
        sidebarSessions={sidebarSessions}
        workspaces={workspaces}
        foldersByWorkspace={foldersByWorkspace}
        folders={folders}
        activeFolderId={effectiveFolderId}
        setActiveFolderId={setScopedFolderId}
        activeFolder={activeFolder}
        moveSessionsToTarget={moveSessionsToTarget}
        bulkDeleteSessions={bulkDeleteSessions}
        renameFolder={renameFolder}
        deleteFolder={deleteFolder}
        moveFolderToWorkspace={moveFolderToWorkspace}
        createWorkspaceForMove={createWorkspaceForMove}
        sessionQuery={sessionQuery}
        setSessionQuery={setSessionQuery}
        creatingFolder={creatingFolder}
        creatingFolderPending={creatingFolderPending}
        setCreatingFolder={setCreatingFolder}
        newFolderName={newFolderName}
        setNewFolderName={setNewFolderName}
        folderInputRef={folderInputRef}
        handleCreateFolder={handleCreateFolder}
        createNewSession={createNewSession}
        activeChatId={activeChatId}
        renamingId={renamingId}
        renameTitle={renameTitle}
        setRenamingId={setRenamingId}
        setRenameTitle={setRenameTitle}
        setActiveChatId={setActiveChatId}
        renameSession={renameSession}
        refreshSessionTitle={refreshSessionTitle}
        togglePin={togglePin}
        toggleExcludeFromAnalytics={toggleExcludeFromAnalytics}
        saveSession={saveSession}
        deleteSession={deleteSession}
        showAlertDialog={openAlertDialog}
        sidebarWidth={sidebarWidth}
        openSession={activateSession}
      />

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize conversations sidebar"
        onMouseDown={(event) => {
          event.preventDefault();
          setSessionSidebarDragActive(true);
        }}
        className="group relative w-2 shrink-0 cursor-col-resize bg-transparent"
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--border-color)] transition-colors group-hover:bg-[var(--accent-color)]" />
      </div>

      <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
        <div className={chatWorkspaceClassName}>
          {!isComparePanelOpen ? (
            <div className="flex-1 min-w-0 flex min-h-0 flex-col overflow-hidden">
              {!activeChatId ? (
                <div className="relative flex-1 min-w-0 flex flex-col items-center justify-center gap-6 text-center overflow-hidden">
                  <WaterfallSuggestions
                    suggestions={waterfallSuggestions}
                    onSelect={(suggestion) => void handleComposerSuggestion(suggestion, true)}
                    onDismiss={handleDismissSuggestion}
                  />
                  <div className="relative z-10 flex flex-col items-center gap-5">
                    <div
                      ref={emptyStatePrivacyMenuRef}
                      className="relative flex flex-wrap justify-center gap-3"
                    >
                      <span
                        aria-hidden
                        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-20 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.35),rgba(var(--accent-color-rgb),0.25),transparent)] blur-2xl"
                      />
                      <div className="flex overflow-hidden rounded-xl border border-[rgba(var(--accent-color-rgb),0.38)] bg-[var(--accent-color)] text-white shadow-[0_18px_44px_-24px_rgba(var(--accent-color-rgb),0.9)] ring-1 ring-white/10 transition-transform hover:-translate-y-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            setIsEmptyStatePrivacyMenuOpen(false);
                            void createNewSession();
                          }}
                          className="px-5 py-3 text-base font-semibold tracking-[0.01em] transition-colors hover:bg-white/10"
                        >
                          Start a new chat
                        </button>
                        <button
                          type="button"
                          aria-label="Choose new chat privacy mode"
                          aria-haspopup="menu"
                          aria-expanded={isEmptyStatePrivacyMenuOpen}
                          onClick={() => setIsEmptyStatePrivacyMenuOpen((open) => !open)}
                          className="flex items-center justify-center border-l border-white/20 px-3.5 transition-colors hover:bg-white/10"
                        >
                          <ChevronDown size={16} className={`transition-transform ${isEmptyStatePrivacyMenuOpen ? "rotate-180" : ""}`} />
                        </button>
                      </div>
                      {isEmptyStatePrivacyMenuOpen && (
                        <div
                          role="menu"
                          aria-label="New chat privacy options"
                          className="absolute top-full z-20 mt-2 w-full min-w-[240px] max-w-xs overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1.5 text-left shadow-[0_24px_50px_-24px_rgba(15,23,42,0.7)]"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setIsEmptyStatePrivacyMenuOpen(false);
                              void createNewSession({ isIncognito: true });
                            }}
                            className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
                          >
                            <Ghost size={14} className="mt-0.5 shrink-0 text-purple-400" />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-[var(--text-primary)]">Incognito</span>
                              <span className="block text-xs text-[var(--text-secondary)]">Starts a chat that stays private.</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setIsEmptyStatePrivacyMenuOpen(false);
                              void createNewSession({ excludeFromAnalytics: true });
                            }}
                            className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
                          >
                            <Shield size={14} className="mt-0.5 shrink-0 text-sky-400" />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-[var(--text-primary)]">Exclude from analytics</span>
                              <span className="block text-xs text-[var(--text-secondary)]">Starts a chat without analytics collection.</span>
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
                  {/* Slim title bar */}
                  <div className="flex min-w-0 items-center gap-2 px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                        <span className="truncate">{activeWorkspaceName}</span>
                        {effectiveFolderName && (
                          <>
                            <span>/</span>
                            <span className="truncate">{effectiveFolderName}</span>
                          </>
                        )}
                      </div>
                      <span className="mt-0.5 flex min-w-0 items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                        <Tooltip content={activeSession?.title || "New Chat"} position="bottom">
                          <span className="truncate">{activeSession?.title || "New Chat"}</span>
                        </Tooltip>
                        <span className="relative inline-flex shrink-0">
                          <Tooltip content={activeChatSummary ? "Show chat summary" : "No summary available yet"} position="bottom">
                            <button
                              ref={chatSummaryButtonRef}
                              type="button"
                              aria-label="Chat summary"
                              aria-haspopup="dialog"
                              aria-expanded={isChatSummaryOpen}
                              aria-disabled={!activeChatSummary}
                              onClick={() => {
                                if (!activeChatSummary) { return; }
                                setIsChatSummaryOpen((open) => !open);
                              }}
                              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors ${
                                activeChatSummary
                                  ? "hover:bg-[var(--bg-hover)] hover:text-[var(--accent-color)]"
                                  : "cursor-not-allowed opacity-40"
                              }`}
                            >
                              <Info size={13} />
                            </button>
                          </Tooltip>
                          {activeChatSummary && isChatSummaryOpen && (
                            <div
                              ref={chatSummaryPopoverRef}
                              role="dialog"
                              aria-label="Chat summary details"
                              className="absolute left-1/2 top-full z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3 text-left shadow-[0_24px_60px_-24px_rgba(15,23,42,0.75)]"
                            >
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <div className="text-xs font-semibold text-[var(--text-primary)]">Chat Info</div>
                                <div className="rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                                  {activeChatSummary.summary_type}
                                </div>
                              </div>
                              <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs font-normal leading-relaxed text-[var(--text-secondary)]">
                                {activeChatSummary.content}
                              </p>
                            </div>
                          )}
                        </span>
                        {activeSession?.is_incognito && (
                          <Tooltip content="Incognito thread" position="bottom">
                            <span><Ghost size={14} className="text-purple-400" /></span>
                          </Tooltip>
                        )}
                        {!activeSession?.is_incognito && activeSession?.exclude_from_analytics && (
                          <Tooltip content="Excluded from analytics" position="bottom">
                            <span><Shield size={14} className="text-sky-400" /></span>
                          </Tooltip>
                        )}
                      </span>
                    </div>
                    {activeChatId && sessionTokensUsed > 0 && (
                      <ContextWindowBar
                        tokensUsed={sessionTokensUsed}
                        contextSize={effectiveContextSize}
                        isOverride={selectedModelMeta?.context_size != null}
                        modelName={selectedModel || undefined}
                        onConfigure={() => navigate("/preferences", { state: { settingsTab: "inference" } })}
                      />
                    )}
                    {activeSession && (
                      <Tooltip content={canRefreshActiveSessionTitle ? "Refresh chat name" : "Refresh is unavailable for empty chats"} position="bottom">
                        <button
                          onClick={() => { if (canRefreshActiveSessionTitle) { refreshSessionTitle(activeSession); } }}
                          disabled={!canRefreshActiveSessionTitle}
                          className={`p-1.5 rounded-lg text-[var(--text-muted)] transition-colors ${canRefreshActiveSessionTitle
                            ? "hover:bg-[var(--bg-hover)] hover:text-[var(--accent-color)]"
                            : "cursor-not-allowed opacity-40"
                            }`}
                        >
                          <RefreshCw size={14} />
                        </button>
                      </Tooltip>
                    )}
                    {availableModels.length === 0 && ollamaModelStatus === "unreachable" && (
                      <span className="text-xs text-red-400">Ollama unavailable</span>
                    )}
                    {availableModels.length === 0 && ollamaModelStatus !== "unreachable" && (
                      <span className="text-xs text-amber-400">No Ollama models installed</span>
                    )}
                  </div>
                  
                  <WorkspaceMigrationBanner
                    onDismiss={() => { if (activeChatId) { migrationDismissedSessionsRef.current.add(activeChatId); } }}
                    onMove={(targetWorkspaceId) => {
                      if (activeChatId) {
                        moveSessionsToTarget([activeChatId], targetWorkspaceId, null);
                        migrationDismissedSessionsRef.current.add(activeChatId);
                      }
                    }}
                  />
                  <RelatedChatPills 
                    relatedChats={relatedChats} 
                    onChatClick={onChatClick}
                    className="sticky top-0 z-10"
                  />

                  {activeSession?.is_incognito && (
                    <div className="mx-4 mt-2 px-3 py-2 rounded bg-purple-500/10 border border-purple-500/20 text-[11px] text-purple-300 flex items-start gap-2">
                      <Ghost size={12} className="mt-0.5 flex-shrink-0" />
                      <span>This incognito chat is excluded from analytics, memory, and topic discovery. Leaving this chat deletes it.</span>
                    </div>
                  )}

                  {!activeSession?.is_incognito && activeSession?.exclude_from_analytics && (
                    <div className="mx-4 mt-2 px-3 py-2 rounded bg-sky-500/10 border border-sky-500/20 text-[11px] text-sky-300 flex items-start gap-2">
                      <Shield size={12} className="mt-0.5 flex-shrink-0" />
                      <span>This chat stays saved, but it is excluded from analytics, memory extraction, and topic discovery.</span>
                    </div>
                  )}

                  {/* Browser automation notice */}
                  {isWebProvider && webProviderKey && (
                    <div className="mx-4 mt-2 px-3 py-1.5 rounded bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-400 flex items-center gap-1.5">
                      <Globe size={12} />
                      A browser window will open for your configured browser target, and your query will be submitted automatically after sign-in.
                      {!preserveWebSession && (
                        <span className="ml-auto text-[10px] opacity-60">Session cleared after query</span>
                      )}
                    </div>
                  )}

                  {/* Messages */}
                  <div data-testid="chat-messages-area" className={`min-h-0 min-w-0 flex-1 flex flex-col overflow-hidden relative ${activeMessages.length > 0 || isStreaming ? "" : "hidden"}`}>
                    <div ref={messagesScrollContainerRef} className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">
                      <Virtuoso
                        ref={virtuosoRef}
                        scrollerRef={(element) => {
                          setMessagesScrollerElement(element instanceof HTMLDivElement ? element : null);
                        }}
                        data={activeMessages}
                        initialTopMostItemIndex={activeMessages.length > 0 ? activeMessages.length - 1 : 0}
                        followOutput={isCurrentlyStreaming ? "smooth" : false}
                        alignToBottom={true}
                        className="w-full min-w-0 overflow-x-hidden py-4"
                        increaseViewportBy={{ top: 1200, bottom: 1200 }}
                        computeItemKey={(_, msg) => msg.id}
                        itemContent={(i, msg) => {
                          const isEditingThis = editingMessageId === msg.id;
                          return (
                            <div className={`${chatMessageStyle === "minimal" ? "px-8 pb-8" : "pl-4 pr-[52px] pb-4"}`}>
                              <ChatMessageBubble
                                key={msg.id}
                                msg={msg}
                                isLastMessage={i === activeMessages.length - 1}
                                isStreaming={isStreaming}
                                chatMessageStyle={chatMessageStyle}
                                expandChatToWindowWidth={expandChatToWindowWidth}
                                showGenInfo={showGenInfo}
                                isEditing={isEditingThis}
                                editValue={isEditingThis ? editContent : ""}
                                isCopied={copiedMessageId === msg.id}
                                isThoughtExpanded={expandedThoughtIds.has(msg.id)}
                                sources={messageSources[msg.id]}
                                isSourcesExpanded={expandedSources === msg.id}
                                contextSources={i === activeMessages.length - 1 && currentSessionId ? activeContextSources[currentSessionId] ?? null : null}
                                markdownComponents={markdownComponents}
                                variations={messageVariations.get(msg.id)}
                                currentVariationIndex={variationIndex.get(msg.id)}
                                redoPickerOpen={redoPickerOpenForId === msg.id}
                                availableModels={availableModels}
                                aiModelList={aiModelList}
                                selectedModel={selectedModel}
                                showGenInfoModel={showGenInfoModel}
                                showGenInfoTokenCount={showGenInfoTokenCount}
                                showGenInfoDuration={showGenInfoDuration}
                                showGenInfoSpeed={showGenInfoSpeed}
                                onCopy={handleCopyMessage}
                                onStartEdit={handleStartEditing}
                                onSubmitEdit={handleSubmitEditStable}
                                onSetEditContent={setEditContent}
                                onCancelEdit={handleCancelEdit}
                                onRedoWithModel={handleRedoWithModelStable}
                                onToggleRedoPicker={handleToggleRedoPickerStable}
                                onVariationChange={handleVariationChangeStable}
                                onToggleThought={handleToggleThought}
                                onToggleSources={handleToggleSources}
                                onDelete={handleDeleteMessageStable}
                              />
                            </div>
                          );
                        }}
                        components={virtuosoComponents}
                      />
                    </div>
                    <ChatMinimap
                      messages={activeMessages}
                      virtuosoRef={virtuosoRef}
                      scrollContainer={messagesScrollerElement}
                      streamingContent={streamingContentForMinimap}
                      isStreaming={isCurrentlyStreaming}
                    />
                  </div>

                  {toolbarState && (
                    <SelectionToolbar
                      x={toolbarState.x}
                      y={toolbarState.y}
                      text={toolbarState.text}
                      onDismiss={dismissToolbar}
                      innerRef={toolbarRef}
                      workspaceId={effectiveWorkspaceId}
                    />
                  )}

                  {/* Input / composer area */}
                  <div className={`min-w-0 bg-transparent flex flex-col items-center ${activeMessages.length === 0 && !isStreaming ? "flex-1 justify-center px-6 py-10" : "flex-shrink-0 px-4 pb-6 pt-3 sm:px-6"}`}>
                    <div
                      data-testid="composer-shell"
                      className={`${expandChatToWindowWidth ? "w-full" : "w-full max-w-5xl"} min-w-0 rounded-[28px] bg-[var(--bg-elevated)] ring-1 ring-[var(--border-color)] ${showComposerHeader ? "p-3" : "p-2"} shadow-[0_8px_24px_-8px_rgba(0,0,0,0.3)] transition-all duration-300`}
                    >
                      <div className="flex flex-col gap-2 min-w-0">

                        {showComposerHeader && (
                          <ComposerSuggestionRows
                            rows={composerSuggestionRows}
                            disabled={isStreaming}
                            disableImmediateSend={!selectedModel || !effectiveWorkspaceId}
                            onSuggestionClick={handleComposerSuggestion}
                            onToggleCollapse={() => setIsComposerHeaderCollapsed((c) => !c)}
                          />
                        )}

                        {hasComposerHeader && !showComposerHeader && (
                          <div className="flex justify-end px-1">
                            <Tooltip content="Show suggestions" position="top">
                              <button
                                type="button"
                                onClick={() => setIsComposerHeaderCollapsed((collapsed) => !collapsed)}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[var(--text-muted)] transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                                aria-label="Show suggestions"
                              >
                                <ChevronUp size={13} />
                              </button>
                            </Tooltip>
                          </div>
                        )}

                        {/* Tool buttons row */}
                        <div className={`flex flex-wrap items-center gap-1.5 px-1 ${showComposerHeader ? "pt-2" : ""}`}>
                              {/* Normal mode model picker stays in tool row */}
                              <div className="relative" data-active-model-menu>
                                {composerMode !== "family" && (
                                <Tooltip content={selectedModel ? `Active model: ${modelPickerLabel(selectedModel)}` : "Select a model"} position="top">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (modelPickerOptions.length === 0) { return; }
                                      setIsModelSendMenuOpen(false);
                                      setIsModelPickerOpen((open) => !open);
                                    }}
                                    disabled={modelPickerOptions.length === 0 || isStreaming}
                                    className="inline-flex h-8 max-w-[min(62vw,260px)] items-center gap-2 rounded-xl bg-[var(--bg-hover)] border border-[var(--border-color)] px-3 text-[12px] font-semibold tracking-[0.01em] text-[var(--text-secondary)] transition-all duration-200 hover:border-[var(--accent-color)]/50 hover:text-[var(--text-primary)] hover:shadow-sm active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                                    aria-label={selectedModel ? `Active model: ${modelPickerLabel(selectedModel)}` : "Select a model"}
                                    aria-haspopup="menu"
                                    aria-expanded={isModelPickerOpen}
                                  >
                                    <span className="min-w-0 truncate">
                                      {selectedModel ? modelPickerLabel(selectedModel) : "Select model"}
                                    </span>
                                    <ChevronDown size={14} strokeWidth={2.2} />
                                  </button>
                                </Tooltip>
                                )}
                                {isModelPickerOpen && modelPickerOptions.length > 0 && (
                                  <div className="absolute left-0 bottom-full z-20 mb-2 w-[240px] max-w-[min(80vw,240px)] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1.5 shadow-2xl">
                                    <div className="max-h-72 overflow-y-auto">
                                      {groupedModelPickerOptions.map((group) => (
                                        <div key={group.key} className="pb-1 last:pb-0">
                                          {groupedModelPickerOptions.length > 1 && (
                                            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                                              {group.label}
                                            </div>
                                          )}
                                          {group.modelIds.map((modelId) => {
                                            const isSelected = modelId === selectedModel;
                                            return (
                                              <Tooltip content={modelPickerLabel(modelId)} position="right" key={modelId}>
                                                <button
                                                  type="button"
                                                  onClick={async () => {
                                                    setSelectedModel(modelId);
                                                    setIsModelPickerOpen(false);
                                                    await persistModelChoice(modelId);
                                                  }}
                                                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${isSelected
                                                    ? "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--text-primary)]"
                                                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                                                    }`}
                                                >
                                                  <div className="min-w-0 truncate">{modelDisplayName(modelId)}</div>
                                                  {isSelected && <Check size={14} className="shrink-0 text-[var(--accent-color)]" />}
                                                </button>
                                              </Tooltip>
                                            );
                                          })}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Compare button icon-only */}
                              <Tooltip content={isComparePanelOpen ? "Close model comparison" : "Compare two models side by side"} position="top">
                                <button
                                  onClick={() => setActiveSubView(isComparePanelOpen ? "chat" : "compare")}
                                  className={`${composerIconOnlyButtonClass} ${isComparePanelOpen ? "bg-[rgba(var(--accent-color-rgb),0.15)] text-[var(--accent-color)]" : ""}`}
                                >
                                  <SplitSquareHorizontal size={13} />
                                </button>
                              </Tooltip>

                              {/* Browser Assistant picker */}
                              {enabledWebModels.length > 0 && (
                                <div className="relative" data-web-model-menu>
                                  <Tooltip content="Send with a browser assistant" position="top">
                                    <button
                                      type="button"
                                      onClick={() => setIsWebPickerOpen((open) => !open)}
                                      disabled={!input.trim() || isStreaming}
                                      aria-label="Send with browser assistant"
                                      aria-haspopup="menu"
                                      aria-expanded={isWebPickerOpen}
                                      className={`${composerIconOnlyButtonClass} ${isWebPickerOpen ? "bg-[rgba(var(--accent-color-rgb),0.15)] text-[var(--accent-color)]" : ""}`}
                                    >
                                      <Globe size={13} />
                                    </button>
                                  </Tooltip>
                                  {isWebPickerOpen && (
                                    <div className="absolute left-0 bottom-full z-20 mb-2 min-w-[200px] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1.5 shadow-2xl">
                                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                                        Browser Targets
                                      </div>
                                      <div className="max-h-48 overflow-y-auto">
                                        {enabledWebModels.map((m) => (
                                          <button
                                            key={m.id}
                                            type="button"
                                            onClick={async () => {
                                              setIsWebPickerOpen(false);
                                              await sendMessageWithModel(m.model_id);
                                            }}
                                            disabled={!input.trim() || isStreaming}
                                            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                                          >
                                            <Globe size={14} className="shrink-0 text-[var(--text-muted)]" />
                                            <span className="min-w-0 truncate">{modelDisplayName(m.model_id)}</span>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Attachment menu */}
                              <div className="relative" data-attachment-menu>
                                <Tooltip content={attachedSources.length > 0 ? `Attached ${attachedSources.length} file${attachedSources.length === 1 ? "" : "s"}` : "Attach to this message"} position="top">
                                  <button
                                    type="button"
                                    onClick={() => setIsAttachmentMenuOpen((open) => !open)}
                                    disabled={!effectiveWorkspaceId || isStreaming}
                                    aria-label="Open attachment menu"
                                    aria-haspopup="menu"
                                    aria-expanded={isAttachmentMenuOpen}
                                    className={`relative ${composerIconOnlyButtonClass} ${attachedSources.length > 0 || isAttachmentMenuOpen ? "bg-[rgba(var(--accent-color-rgb),0.15)] text-[var(--accent-color)]" : ""}`}
                                  >
                                    {isAttachingFiles ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
                                    {attachedSources.length > 0 && (
                                      <span className="absolute -top-1 -right-1 text-[9px] bg-[var(--accent-color)] text-white rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
                                        {attachedSources.length > 9 ? "9+" : attachedSources.length}
                                      </span>
                                    )}
                                  </button>
                                </Tooltip>
                                {isAttachmentMenuOpen && (
                                  <div className="absolute bottom-full left-0 z-20 mb-2 min-w-[188px] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1.5 shadow-2xl">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsAttachmentMenuOpen(false);
                                        void handleAttachFiles();
                                      }}
                                      disabled={isAttachingFiles}
                                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                                      role="menuitem"
                                    >
                                      <Paperclip size={15} />
                                      <span>Attach file</span>
                                    </button>
                                    {selectedModelSupportsVision && (
                                      <button
                                        type="button"
                                        onClick={handleAttachImage}
                                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                                        role="menuitem"
                                      >
                                        <Image size={15} />
                                        <span>Attach image</span>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Queue button icon-only */}
                              <Tooltip content="Thought Queue — schedule follow-up questions to process in background" position="top">
                                <button
                                  onClick={() => setThoughtPanelOpen((v) => !v)}
                                  className={`relative ${composerIconOnlyButtonClass} ${thoughtPanelOpen ? "bg-[rgba(var(--accent-color-rgb),0.15)] text-[var(--accent-color)]" : ""}`}
                                >
                                  <Inbox size={13} />
                                  {(() => {
                                    const pending = thoughts.filter((t) => t.status === "scheduled" || t.status === "processing").length;
                                    return pending > 0 ? (
                                      <span className="absolute -top-1 -right-1 text-[9px] bg-[var(--accent-color)] text-white rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
                                        {pending > 9 ? "9+" : pending}
                                      </span>
                                    ) : null;
                                  })()}
                                </button>
                              </Tooltip>

                              <Tooltip content={isPolishingPrompt ? "Polishing prompt…" : "Polish prompt with a smaller model"} position="top">
                                <button
                                  type="button"
                                  onClick={() => { void polishComposerPrompt(); }}
                                  disabled={!input.trim() || isStreaming || isPolishingPrompt || !(draftModel || selectedModel || preferredModel)}
                                  aria-label={isPolishingPrompt ? "Polishing prompt" : "Polish prompt"}
                                  className={`${composerIconOnlyButtonClass} ${isPolishingPrompt ? "bg-[rgba(var(--accent-color-rgb),0.15)] text-[var(--accent-color)]" : ""}`}
                                >
                                  {isPolishingPrompt ? <Loader2 size={13} className="animate-spin" /> : <Pencil size={13} />}
                                </button>
                              </Tooltip>

                              {polishUndoInput !== null && (
                                <Tooltip content="Undo prompt polish" position="top">
                                  <button
                                    type="button"
                                    onClick={undoPolishedPrompt}
                                    disabled={isStreaming || isPolishingPrompt}
                                    aria-label="Undo prompt polish"
                                    className={composerIconOnlyButtonClass}
                                  >
                                    <ArrowLeft size={13} />
                                  </button>
                                </Tooltip>
                              )}
                            </div>

                        {/* Textarea */}
                        <div className="flex items-end gap-2.5 px-2 py-1.5">
                                <textarea
                                  ref={inputRef}
                                  value={input}
                                  onChange={(e) => {
                                    setInput(e.target.value);
                                    if (polishUndoInput !== null) {
                                      setPolishUndoInput(null);
                                    }
                                  }}
                                  onKeyDown={handleKeyDown}
                                  disabled={isStreaming}
                                  placeholder={
                                    isStreaming
                                      ? "Waiting for response…"
                                      : !selectedModel
                                        ? ollamaModelStatus === "unreachable"
                                          ? "Ollama is unavailable — start it or enable auto-start in Preferences > AI"
                                          : "No models available — install one via ollama pull"
                                        : activeMessages.length > 0
                                          ? "Continue this thread…"
                                          : "Start a new thread…"
                                  }
                                  rows={1}
                                  className="flex-1 appearance-none resize-none border-0 bg-transparent px-4 py-3 text-[15px] font-medium leading-6 tracking-[0.01em] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] shadow-none outline-none ring-0 transition-colors max-h-40 overflow-y-auto focus:border-0 focus:shadow-none focus:ring-0"
                                  style={{ minHeight: 56 }}
                                  onInput={(e) => {
                                    const el = e.currentTarget;
                                    el.style.height = "auto";
                                    el.style.height = Math.min(el.scrollHeight, 160) + "px";
                                  }}
                                />
                                {isStreaming ? (
                                  <Tooltip content="Stop generation" position="top">
                                    <button
                                      onClick={() => {
                                        if (activeChatId) {
                                          setIsStreaming(false);
                                          api.ollama.stopStream(activeChatId).catch(() => { });
                                          api.llamacpp.stopStream(activeChatId).catch(() => { });
                                          api.webAI.stopStream(activeChatId).catch((error) => {
                                            const message = error instanceof Error ? error.message : String(error);
                                            void api.logs.logFrontendEvent(
                                              "warn",
                                              "chat",
                                              "Failed to stop web AI stream",
                                              JSON.stringify({ session_id: activeChatId, error: message }),
                                            ).catch(() => {});
                                          });
                                          if (lastUserMessage) {
                                            setInput(lastUserMessage);
                                            requestAnimationFrame(() => {
                                              if (inputRef.current) {
                                                inputRef.current.style.height = "auto";
                                                inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + "px";
                                                inputRef.current.focus();
                                              }
                                            });
                                          }
                                        }
                                      }}
                                      className="mb-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-red-400/30 bg-red-500/90 text-white transition-opacity hover:opacity-90"
                                    >
                                      <X size={16} />
                                    </button>
                                  </Tooltip>
                                ) : (
                                  <div className="mb-1 mr-0.5 flex items-center gap-1.5">
                                    {/* ── Family picker (family mode) — right corner ── */}
                                    {composerMode === "family" && (
                                      <div className="relative" data-active-model-menu>
                                        <button
                                          type="button"
                                          onClick={() => setIsFamilyPickerOpen((open) => !open)}
                                          disabled={isStreaming}
                                          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                                          aria-haspopup="menu"
                                          aria-expanded={isFamilyPickerOpen}
                                        >
                                          <span>{selectedFamily ? (modelFamilyLabels[selectedFamily] ?? "Family") : "Family"}</span>
                                          <ChevronDown size={12} strokeWidth={2.2} />
                                        </button>
                                        {isFamilyPickerOpen && modelFamilies.length > 0 && (
                                          <FamilyPickerMenu
                                            modelFamilies={modelFamilies}
                                            selectedFamily={selectedFamily}
                                            selectedModel={selectedModel}
                                            onSelect={async (familyPrefix, modelId) => {
                                              setSelectedFamily(familyPrefix);
                                              setSelectedModel(modelId);
                                              await persistModelChoice(modelId);
                                              setIsFamilyPickerOpen(false);
                                            }}
                                          />
                                        )}
                                      </div>
                                    )}
                                    {/* ── Family send buttons (family mode) ── */}
                                    {composerMode === "family" && activeFamilyModels.map((m) => {
                                      const tag = m.model_id.includes(":") ? m.model_id.split(":")[1] : m.model_id;
                                      const isActive = m.model_id === selectedModel;
                                      const isDefault = m.model_id === activeFamilyDefaultModelId;
                                      return (
                                        <Tooltip content={`${isDefault ? "Default for Enter in this family" : `Send with ${modelPickerLabel(m.model_id)}`} · Ctrl+click to queue`} position="top" key={m.model_id}>
                                          <button
                                            onClick={async (e) => {
                                              setSelectedModel(m.model_id);
                                              setShowFamilyVariant(true);
                                              await persistModelChoice(m.model_id);
                                              if (e.metaKey || e.ctrlKey) {
                                                await queueWithModel(m.model_id);
                                              } else {
                                                await sendMessageWithModel(m.model_id);
                                              }
                                            }}
                                            disabled={!input.trim() || isStreaming}
                                            className={`flex h-8 items-center justify-center rounded-lg px-2.5 text-[11px] font-medium tracking-[0.01em] transition-colors duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
                                              isActive
                                                ? "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)]"
                                                : isDefault
                                                  ? "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                                                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                                            }`}
                                          >
                                            {tag}
                                          </button>
                                        </Tooltip>
                                      );
                                    })}
                                    {/* ── Normal send button (normal mode) ── */}
                                    {composerMode === "normal" && (
                                    <div className="relative flex flex-shrink-0 items-center" data-send-model-menu>
                                      <div className={`flex overflow-hidden rounded-2xl shadow-[0_4px_14px_0_rgba(var(--accent-color-rgb),0.39)] transition-all duration-200 hover:shadow-[0_6px_20px_rgba(var(--accent-color-rgb),0.43)] ${(!input.trim() || !selectedModel) ? "opacity-40" : ""}`}>
                                        <Tooltip content={selectedModel ? `Send with ${modelPickerLabel(selectedModel)}` : "Send"} position="top">
                                          <button
                                            type="button"
                                            aria-label="Send message"
                                            onClick={async () => {
                                              setIsModelSendMenuOpen(false);
                                              await sendMessage();
                                            }}
                                            disabled={!input.trim() || !selectedModel}
                                            className="flex h-10 w-10 items-center justify-center bg-[var(--accent-color)] text-white transition-all duration-200 hover:-translate-y-px hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:brightness-100"
                                          >
                                            <ArrowUpCircle size={19} strokeWidth={2.2} />
                                          </button>
                                        </Tooltip>
                                        {alternateSendModels.length > 0 && (
                                          <Tooltip content="Send with a different model" position="top">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setIsModelPickerOpen(false);
                                                setIsModelSendMenuOpen((open) => !open);
                                              }}
                                              disabled={!input.trim() || isStreaming}
                                              className="flex h-10 w-7 items-center justify-center border-l border-black/10 bg-[var(--accent-color)] text-white transition-all duration-200 hover:-translate-y-px hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:brightness-100"
                                              aria-label="Send with a different model"
                                              aria-haspopup="menu"
                                              aria-expanded={isModelSendMenuOpen}
                                            >
                                              <ChevronDown size={13} strokeWidth={2.2} />
                                            </button>
                                          </Tooltip>
                                        )}
                                      </div>
                                      {isModelSendMenuOpen && alternateSendModels.length > 0 && (
                                        <div className="absolute bottom-full right-0 z-20 mb-2 min-w-[220px] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1.5 shadow-2xl">
                                          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                                            Send With
                                          </div>
                                          {groupedAlternateSendModels.map((group) => (
                                            <div key={group.key} className="pb-1 last:pb-0">
                                              {groupedAlternateSendModels.length > 1 && (
                                                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]/60">
                                                  {group.label}
                                                </div>
                                              )}
                                              {group.modelIds.map((modelId) => (
                                                <Tooltip key={modelId} content={`Send with ${modelPickerLabel(modelId)}`}>
                                                  <button
                                                    key={modelId}
                                                    type="button"
                                                    onClick={async () => {
                                                      setIsModelSendMenuOpen(false);
                                                      await sendMessageWithModel(modelId);
                                                    }}
                                                    disabled={!input.trim() || isStreaming}
                                                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                                                  >
                                                    <div className="min-w-0 truncate">{modelDisplayName(modelId)}</div>
                                                  </button>
                                                </Tooltip>
                                              ))}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    )}
                                  </div>
                                )}
                        </div>

                          {attachedSources.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 px-1 pt-1">
                              {attachedSources.map((source) => (
                                <span
                                  key={source.id}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-primary)]"
                                >
                                  <FileText size={11} />
                                  <span className="max-w-44 truncate">{source.title}</span>
                                  <Tooltip content={`Remove ${source.title}`}>
                                    <button
                                      type="button"
                                      onClick={() => setAttachedSources((prev) => prev.filter((item) => item.id !== source.id))}
                                      className="rounded-full text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                                      aria-label={`Remove ${source.title}`}
                                    >
                                      <X size={11} />
                                    </button>
                                  </Tooltip>
                                </span>
                              ))}
                            </div>
                          )}

                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary)]">
              <div className="grid min-h-0 min-w-0 flex-1 grid-cols-2 overflow-hidden">
                {[
                  {
                    label: "Model A",
                    model: compareModelA,
                    text: compareResponseA,
                    borderClassName: "border-r border-[var(--border-color)]",
                  },
                  {
                    label: "Model B",
                    model: compareModelB,
                    text: compareResponseB,
                    borderClassName: "",
                  },
                ].map((panel) => (
                  <div key={panel.label} className={`${panel.borderClassName} flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--bg-primary)]`}>
                    <div className="border-b border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-2">
                      <span className="text-xs font-medium text-[var(--text-primary)]">{panel.label}</span>
                      {panel.model && <span className="ml-2 text-xs text-[var(--text-muted)]">{modelDisplayName(panel.model)}</span>}
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-4">
                      {compareLoading && !panel.text ? (
                        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><span className="animate-pulse">●</span> Generating…</div>
                      ) : panel.text ? (
                        <pre className="whitespace-pre-wrap text-sm font-[inherit] leading-relaxed text-[var(--text-primary)]">{panel.text}</pre>
                      ) : (
                        <p className="text-sm italic text-[var(--text-muted)]">Response will appear here…</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col border-t border-[var(--border-color)] bg-[var(--bg-primary)]">
                {compareError && (
                  <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-400">{compareError}</div>
                )}
                <div className="px-4 pb-6 pt-4">
                  <div className="mx-auto w-full min-w-0 max-w-5xl rounded-[28px] border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.45)]">
                    <div className="flex flex-col gap-3.5 min-w-0">
                      <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--bg-primary)]/80 p-2.5 shadow-[0_18px_45px_-35px_rgba(15,23,42,0.5)] transition-all focus-within:border-[var(--accent-color)] focus-within:shadow-[0_0_0_4px_rgba(var(--accent-color-rgb),0.11),0_18px_45px_-35px_rgba(15,23,42,0.5)]">
                        <div className="flex items-end gap-2">
                          <textarea
                            rows={1}
                            value={comparePrompt}
                            onChange={(e) => setComparePrompt(e.target.value)}
                            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runComparison(); } }}
                            placeholder="Ask both models… (⌘↵ to send)"
                            className="flex-1 resize-none bg-transparent px-3.5 py-3 text-[15px] leading-6 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-colors max-h-40 overflow-y-auto"
                            style={{ minHeight: 56 }}
                            onInput={(e) => {
                              const el = e.currentTarget;
                              el.style.height = "auto";
                              el.style.height = Math.min(el.scrollHeight, 160) + "px";
                            }}
                          />
                          <button
                            onClick={runComparison}
                            disabled={!comparePrompt.trim() || compareLoading}
                            className="mb-1 flex items-center gap-1.5 rounded-2xl bg-[var(--accent-color)] px-3 py-2 text-sm text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                          >
                            <Send size={14} /> {compareLoading ? "Running…" : "Compare"}
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-color)] px-1 pt-0.5">
                        <div className="relative max-w-[220px]">
                          <Tooltip content="Compare model A" position="top">
                            <select
                              value={compareModelA}
                              onChange={(e) => {
                                setCompareModelA(e.target.value);
                                saveCompareA(e.target.value);
                                persistSetting("compare_model_a", e.target.value);
                              }}
                              className={`${composerSelectClassName} max-w-[220px] bg-[var(--bg-primary)] text-[var(--text-primary)]`}
                            >
                              {compareModels.length > 0
                                ? compareModels.map((m) => <option key={m.name} value={m.name}>A: {modelDisplayName(m.name)}</option>)
                                : <option value={compareModelA}>{compareModelA ? `A: ${modelDisplayName(compareModelA)}` : "Model A"}</option>
                              }
                            </select>
                          </Tooltip>
                          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        </div>

                        <div className="relative max-w-[220px]">
                          <Tooltip content="Compare model B" position="top">
                            <select
                              value={compareModelB}
                              onChange={(e) => {
                                setCompareModelB(e.target.value);
                                saveCompareB(e.target.value);
                                persistSetting("compare_model_b", e.target.value);
                              }}
                              className={`${composerSelectClassName} max-w-[220px] bg-[var(--bg-primary)] text-[var(--text-primary)]`}
                            >
                              {compareModels.length > 0
                                ? compareModels.map((m) => <option key={m.name} value={m.name}>B: {modelDisplayName(m.name)}</option>)
                                : <option value={compareModelB}>{compareModelB ? `B: ${modelDisplayName(compareModelB)}` : "Model B"}</option>
                              }
                            </select>
                          </Tooltip>
                          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        </div>

                        <Tooltip content="Close model comparison" position="top">
                          <button
                            onClick={() => setActiveSubView("chat")}
                            className={`${composerToggleBaseClass} ${composerToggleActiveClass}`}
                          >
                            <SplitSquareHorizontal size={13} />
                            <span>Compare</span>
                          </button>
                        </Tooltip>

                        <Tooltip content="Refresh models" position="top">
                          <button
                            onClick={async () => {
                              try {
                                const [ollamaList, managedModels] = await Promise.all([
                                  api.ollama.listModelsFresh(ollamaUrl || undefined),
                                  api.aiModel.list()
                                ]);
                                const disabledManagedIds = managedModels.filter(m => !m.enabled).map(m => m.model_id);

                                const filtered = ollamaList
                                  .filter((m) => !m.name.toLowerCase().includes("embed"))
                                  .filter((m) => !disabledManagedIds.includes(m.name));

                                setCompareModels(filtered);
                              } catch (e) {
                                console.error("Failed to refresh models in comparison view:", e);
                              }
                            }}
                            className={`${composerToggleBaseClass} ${composerToggleInactiveClass}`}
                          >
                            <RefreshCw size={13} />
                            <span>Refresh</span>
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Thought Queue overlay panel ───────────────────────────────────── */}
        {thoughtPanelOpen && (
          <div className="pointer-events-none absolute inset-y-0 right-0 z-30 flex w-72 max-w-[min(24rem,100%)] justify-end">
            <div className="pointer-events-auto flex h-full w-full flex-col overflow-hidden border-l border-[var(--border-color)] bg-[var(--bg-sidebar)] shadow-[-20px_0_50px_-30px_rgba(0,0,0,0.8)]">
              {/* header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-color)] shrink-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                  <Inbox size={13} /> Thought Queue
                </div>
                <button onClick={() => setThoughtPanelOpen(false)} className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                  <X size={13} />
                </button>
              </div>

              {/* quick-add */}
              <div className="p-3 border-b border-[var(--border-color)] shrink-0 space-y-2">
                <textarea
                  value={thoughtDraft}
                  onChange={(e) => setThoughtDraft(e.target.value)}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { submitThought(); } }}
                  placeholder="Dump a thought… (⌘↵ to add)"
                  rows={3}
                  className="w-full text-xs px-2.5 py-1.5 rounded-md bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none resize-none focus:border-[var(--accent-color)]"
                />
                <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] cursor-pointer select-none">
                  <input type="checkbox" checked={thoughtScheduleEnabled} onChange={(e) => setThoughtScheduleEnabled(e.target.checked)} className="rounded" />
                  <Clock size={11} /> Schedule
                </label>
                {thoughtScheduleEnabled && (
                  <input
                    type="datetime-local"
                    value={thoughtSchedule}
                    onChange={(e) => setThoughtSchedule(e.target.value)}
                    className="w-full text-[11px] px-2 py-1 rounded-md bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                  />
                )}
                <button
                  onClick={submitThought}
                  disabled={thoughtSubmitting || !thoughtDraft.trim()}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-[var(--accent-color)] text-white text-xs font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  {thoughtSubmitting ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  {thoughtScheduleEnabled ? "Schedule" : "Add"}
                </button>
              </div>

              {/* list */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {thoughts.length === 0 ? (
                  <p className="text-[11px] text-[var(--text-muted)] text-center pt-6">No thoughts yet.</p>
                ) : (
                  [...thoughts.filter((t) => t.status === "processing"), ...thoughts.filter((t) => t.status === "scheduled"), ...thoughts.filter((t) => t.status === "pending"), ...thoughts.filter((t) => t.status === "done")].map((t) => (
                    <div
                      key={t.id}
                      className={`rounded-lg border text-[11px] ${t.status === "processing" ? "border-yellow-500/30 bg-yellow-500/5" :
                        t.status === "done" ? "border-green-500/20 bg-[var(--bg-primary)]" :
                          "border-[var(--border-color)] bg-[var(--bg-primary)]"
                        }`}
                    >
                      <div className="p-2">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          {t.status === "pending" && <span className="text-[var(--text-muted)]">pending</span>}
                          {t.status === "scheduled" && <span className="flex items-center gap-0.5 text-blue-400"><Clock size={9} /> scheduled</span>}
                          {t.status === "processing" && <span className="flex items-center gap-0.5 text-yellow-400"><Loader2 size={9} className="animate-spin" /> running</span>}
                          {t.status === "done" && <span className="flex items-center gap-0.5 text-green-400"><CheckCircle2 size={9} /> done</span>}
                          <span className="ml-auto text-[var(--text-muted)] opacity-60">{new Date(t.created_at).toLocaleDateString()}</span>
                        </div>
                        <p className="text-[var(--text-primary)] leading-snug line-clamp-3 whitespace-pre-wrap">{t.content}</p>
                        <div className="flex items-center gap-1 mt-1.5">
                          {(t.status === "pending" || t.status === "scheduled") && (
                            <Tooltip content="Process now">
                              <button onClick={() => processDueThought({ ...t, status: "scheduled" })} className="text-[var(--text-muted)] hover:text-[var(--accent-color)] transition-colors">
                                <Zap size={11} />
                              </button>
                            </Tooltip>
                          )}
                          {t.result && (
                            <button onClick={() => setThoughtExpandedId(thoughtExpandedId === t.id ? null : t.id)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                              {thoughtExpandedId === t.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                          )}
                          <Tooltip content="Delete">
                            <button onClick={async () => { await api.thoughtQueue.delete(t.id).catch(() => { }); setThoughts((prev) => prev.filter((x) => x.id !== t.id)); }} className="ml-auto text-[var(--text-muted)] hover:text-red-400 transition-colors">
                              <Trash2 size={11} />
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                      {thoughtExpandedId === t.id && t.result && (
                        <div className="border-t border-[var(--border-color)] px-2 py-2">
                          <p className="text-[var(--text-primary)] whitespace-pre-wrap leading-snug">{t.result}</p>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {confirmDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => closeConfirmDialog(false)}
        >
          <div
            className="mx-4 flex w-full max-w-md flex-col gap-5 rounded-3xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${confirmDialog.tone === "danger"
                ? "bg-red-500/12 text-red-400"
                : "bg-[var(--accent-color)]/12 text-[var(--accent-color)]"
                }`}>
                {confirmDialog.tone === "danger" ? <Trash2 size={18} /> : <MessageSquare size={18} />}
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <h3 className="text-base font-semibold text-[var(--text-primary)]">{confirmDialog.title}</h3>
                <p className="text-sm leading-6 text-[var(--text-secondary)]">{confirmDialog.description}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {confirmDialog.cancelLabel !== null && (
                <button
                  onClick={() => closeConfirmDialog(false)}
                  className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  {confirmDialog.cancelLabel ?? "Cancel"}
                </button>
              )}
              <button
                onClick={() => closeConfirmDialog(true)}
                className={`rounded-xl px-4 py-2 text-sm text-white hover:opacity-90 ${confirmDialog.tone === "danger" ? "bg-red-500" : "bg-[var(--accent-color)]"
                  }`}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* External link confirmation dialog */}
      {pendingLink && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={cancelOpenLink}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); cancelOpenLink(); } }}
        >
          <div
            className="bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-2xl shadow-2xl max-w-sm w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Open External Link</h3>
            <p className="text-xs text-[var(--text-secondary)] mb-1">This will open in your browser:</p>
            <p className="text-xs text-[var(--accent-color)] break-all mb-4 font-mono">{pendingLink}</p>
            <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
              <span className={`flex h-4 w-4 items-center justify-center rounded border ${linkDontAsk ? "border-[var(--accent-color)] bg-[var(--accent-color)]" : "border-[var(--border-color)] bg-[var(--bg-input)]"}`}>
                {linkDontAsk && <svg viewBox="0 0 12 12" className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth={2}><path d="M2 6l3 3 5-5" /></svg>}
              </span>
              <input
                type="checkbox"
                checked={linkDontAsk}
                onChange={(e) => setLinkDontAsk(e.target.checked)}
                className="sr-only"
              />
              <span className="text-xs text-[var(--text-secondary)]">Don&apos;t ask again</span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={cancelOpenLink}
                className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={confirmOpenLink}
                className="rounded-xl bg-[var(--accent-color)] px-4 py-2 text-sm text-white hover:opacity-90"
              >
                Open Link
              </button>
            </div>
          </div>
        </div>
      )}
      {successDialog && (
        <SuccessDialog
          title={successDialog.title}
          description={successDialog.description}
          onConfirm={() => setSuccessDialog(null)}
        />
      )}
    </div>
  );
}
