import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Plus, Trash2, Copy, ChevronDown, ArrowUpCircle, Pencil, RotateCcw, Check, Search, Pin, PinOff, MessageSquare, SplitSquareHorizontal, RefreshCw, BookOpen, FileText, ChevronUp, Zap, Inbox, Clock, CheckCircle2, Loader2, X, Globe, Folder, FolderPlus, Ghost, Shield, Save } from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { open } from "@tauri-apps/plugin-shell";
import { api, type AiModel, type OllamaModel, type SearchResult, type ThoughtItem, type AppSettings } from "../lib/api";
import { useChatStore, findUnusedSession } from "../stores/chatStore";
import { useArtifactStore } from "../stores/artifactStore";
import { useWorkspaceStore, type Project } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { ChatSession, Message } from "../stores/chatStore";
import ComposerSuggestionRows from "../components/ComposerSuggestionRows";
import { TopicChips } from "../components/TopicChips";
import { WorkspaceMigrationBanner } from "../components/WorkspaceMigrationBanner";
import ContextIndicator from "../components/ContextIndicator";
import { useScopedChat, useScopedProjects, useScopedWorkspace, useWorkspacePane } from "../lib/workspacePane";
import {
  buildChatSuggestionRow,
  buildWorkspaceSuggestionRow,
  mergeComposerInput,
  type ComposerSuggestion,
} from "../lib/composerSuggestions";

type ChatMode = "chat" | "compare";

// ── Session sidebar types ─────────────────────────────────────────────────────
interface SessionItemProps {
  session: ChatSession;
  activeChatId: string | null;
  renamingId: string | null;
  renameTitle: string;
  setRenamingId: (id: string | null) => void;
  setRenameTitle: (title: string) => void;
  setActiveChatId: (id: string) => void;
  renameSession: (id: string) => void;
  togglePin: (session: ChatSession) => void;
  saveSession: (session: ChatSession) => void;
  deleteSession: (id: string) => void;
}

interface SessionSidebarProps {
  sessions: ChatSession[];
  pinnedSessions: ChatSession[];
  unpinnedSessions: ChatSession[];
  filteredSessions: ChatSession[];
  activeProject: Project | null;
  sessionQuery: string;
  setSessionQuery: (q: string) => void;
  creatingFolder: boolean;
  setCreatingFolder: (v: boolean) => void;
  newFolderName: string;
  setNewFolderName: (v: string) => void;
  folderInputRef: React.RefObject<HTMLInputElement>;
  handleCreateFolder: (nameOverride?: string) => void;
  createNewSession: (opts?: { isIncognito?: boolean; excludeFromAnalytics?: boolean }) => void;
  activeChatId: string | null;
  renamingId: string | null;
  renameTitle: string;
  setRenamingId: (id: string | null) => void;
  setRenameTitle: (title: string) => void;
  setActiveChatId: (id: string) => void;
  renameSession: (id: string) => void;
  togglePin: (session: ChatSession) => void;
  saveSession: (session: ChatSession) => void;
  deleteSession: (id: string) => void;
}

function SessionItem({
  session, activeChatId, renamingId, renameTitle,
  setRenamingId, setRenameTitle, setActiveChatId,
  renameSession, togglePin, saveSession, deleteSession,
}: SessionItemProps) {
  const isSplitPane = useWorkspacePane() !== null;
  const isActive = activeChatId === session.id;
  const isRenaming = renamingId === session.id;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-chat-session-ids", JSON.stringify([session.id]));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => setActiveChatId(session.id)}
      className={`group flex items-center gap-1 px-3 py-2 cursor-pointer transition-colors ${
        isActive
          ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
      }`}
    >
      {isRenaming ? (
        <input
          autoFocus
          value={renameTitle}
          onChange={(e) => setRenameTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {renameSession(session.id);}
            if (e.key === "Escape") {setRenamingId(null);}
          }}
          onBlur={() => renameSession(session.id)}
          onClick={(e) => e.stopPropagation()}
          className={`flex-1 bg-[var(--bg-elevated)] border border-[var(--accent-color)] rounded px-1.5 py-0.5 text-[var(--text-primary)] outline-none ${
            isSplitPane ? "text-xs" : "text-[11px]"
          }`}
        />
      ) : (
        <span className={`flex-1 truncate ${isSplitPane ? "text-sm" : "text-xs"}`}>{session.title || "New Chat"}</span>
      )}
      {session.is_incognito && <Ghost size={isSplitPane ? 12 : 11} className="text-purple-400 shrink-0" />}
      {!session.is_incognito && session.exclude_from_analytics && <Shield size={isSplitPane ? 12 : 11} className="text-sky-400 shrink-0" />}
      <span className={`text-[var(--text-muted)] shrink-0 mr-1 ${isSplitPane ? "text-[11px]" : "text-[10px]"}`}>
        {(() => {
          const diff = Date.now() - new Date(session.updated_at).getTime();
          const m = Math.floor(diff / 60000);
          if (m < 1) {return "now";}
          if (m < 60) {return `${m}m`;}
          const h = Math.floor(m / 60);
          if (h < 24) {return `${h}h`;}
          return `${Math.floor(h / 24)}d`;
        })()}
      </span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {!isRenaming && (
          <button
            onClick={(e) => { e.stopPropagation(); setRenamingId(session.id); setRenameTitle(session.title); }}
            className={`rounded hover:text-[var(--accent-color)] transition-colors ${isSplitPane ? "p-1" : "p-0.5 text-[10px]"}`}
            title="Rename"
          >
            <Pencil size={isSplitPane ? 12 : 10} />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); togglePin(session); }}
          className={`rounded hover:text-[var(--accent-color)] transition-colors ${isSplitPane ? "p-1" : "p-0.5"}`}
          title={session.is_pinned ? "Unpin" : "Pin"}
        >
          {session.is_pinned ? <PinOff size={isSplitPane ? 12 : 10} /> : <Pin size={isSplitPane ? 12 : 10} />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); saveSession(session); }}
          className={`rounded hover:text-[var(--accent-color)] transition-colors ${isSplitPane ? "p-1" : "p-0.5"}`}
          title="Save chat"
        >
          <Save size={isSplitPane ? 12 : 10} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
          className={`rounded hover:text-red-400 transition-colors ${isSplitPane ? "p-1" : "p-0.5"}`}
        >
          <Trash2 size={isSplitPane ? 12 : 10} />
        </button>
      </div>
    </div>
  );
}

function SessionSidebar({
  sessions, pinnedSessions, unpinnedSessions, filteredSessions,
  activeProject, sessionQuery, setSessionQuery,
  creatingFolder, setCreatingFolder, newFolderName, setNewFolderName,
  folderInputRef, handleCreateFolder, createNewSession,
  activeChatId, renamingId, renameTitle, setRenamingId, setRenameTitle,
  setActiveChatId, renameSession, togglePin, saveSession, deleteSession,
}: SessionSidebarProps) {
  const isSplitPane = useWorkspacePane() !== null;

  return (
    <div className={`relative z-10 border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-sidebar)] overflow-hidden shrink-0 ${isSplitPane ? "w-64" : "w-56"}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-color)]">
        <span className={`font-medium text-[var(--text-secondary)] truncate ${isSplitPane ? "text-sm" : "text-xs"}`}>
          {activeProject?.name ?? "Conversations"}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => { setCreatingFolder(true); setNewFolderName(""); }}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="New folder"
          >
            <FolderPlus size={14} />
          </button>
          <button
            onClick={() => createNewSession()}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="New chat"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => createNewSession({ isIncognito: true })}
            className="p-1 rounded hover:bg-purple-500/10 text-[var(--text-muted)] hover:text-purple-400 transition-colors"
            title="New incognito chat (deleted when you leave it)"
          >
            <Ghost size={14} />
          </button>
          <button
            onClick={() => createNewSession({ excludeFromAnalytics: true })}
            className="p-1 rounded hover:bg-sky-500/10 text-[var(--text-muted)] hover:text-sky-400 transition-colors"
            title="New private chat (saved, but excluded from analytics)"
          >
            <Shield size={14} />
          </button>
        </div>
      </div>

      {/* New Chat button */}
      <div className="mx-2 mt-2 mb-1">
        <button
          onClick={() => createNewSession()}
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-primary)] font-medium hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors ${isSplitPane ? "text-sm" : "text-xs"}`}
        >
          <Plus size={isSplitPane ? 15 : 14} />
          New Chat
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-1.5 bg-[var(--bg-elevated)] rounded-lg px-2 py-1">
          <Search size={isSplitPane ? 12 : 11} className="text-[var(--text-muted)]" />
          <input
            value={sessionQuery}
            onChange={(e) => setSessionQuery(e.target.value)}
            placeholder="Search…"
            className={`flex-1 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none ${isSplitPane ? "text-xs" : "text-[11px]"}`}
          />
        </div>
      </div>

      {/* Inline folder creation */}
      {creatingFolder && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-color)]">
          <Folder size={isSplitPane ? 13 : 12} className="text-[var(--text-muted)] flex-shrink-0" />
          <input
            ref={folderInputRef}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateFolder(e.currentTarget.value);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setCreatingFolder(false);
                setNewFolderName("");
              }
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder="Folder name…"
            className={`flex-1 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded px-1.5 py-0.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] ${isSplitPane ? "text-xs" : "text-[11px]"}`}
          />
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {filteredSessions.length === 0 && sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-3">
            <MessageSquare size={isSplitPane ? 22 : 20} className="text-[var(--text-muted)] opacity-30" />
            <p className={`text-[var(--text-muted)] ${isSplitPane ? "text-xs" : "text-[11px]"}`}>No conversations yet</p>
          </div>
        ) : filteredSessions.length === 0 ? (
          <p className={`px-3 py-4 text-[var(--text-muted)] text-center ${isSplitPane ? "text-xs" : "text-[11px]"}`}>No matches</p>
        ) : (
          <>
            {pinnedSessions.length > 0 && (
              <>
                <div className={`px-3 py-1 uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-sidebar)] ${isSplitPane ? "text-[11px]" : "text-[10px]"}`}>
                  Pinned
                </div>
                {pinnedSessions.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    activeChatId={activeChatId}
                    renamingId={renamingId}
                    renameTitle={renameTitle}
                    setRenamingId={setRenamingId}
                    setRenameTitle={setRenameTitle}
                    setActiveChatId={setActiveChatId}
                    renameSession={renameSession}
                    togglePin={togglePin}
                    saveSession={saveSession}
                    deleteSession={deleteSession}
                  />
                ))}
              </>
            )}
            {unpinnedSessions.length > 0 && (
              <>
                {pinnedSessions.length > 0 && (
                  <div className={`px-3 py-1 uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-sidebar)] ${isSplitPane ? "text-[11px]" : "text-[10px]"}`}>
                    All
                  </div>
                )}
                {unpinnedSessions.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    activeChatId={activeChatId}
                    renamingId={renamingId}
                    renameTitle={renameTitle}
                    setRenamingId={setRenamingId}
                    setRenameTitle={setRenameTitle}
                    setActiveChatId={setActiveChatId}
                    renameSession={renameSession}
                    togglePin={togglePin}
                    saveSession={saveSession}
                    deleteSession={deleteSession}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Footer stats */}
      {sessions.length > 0 && (
        <div className="px-3 py-1.5 border-t border-[var(--border-color)] shrink-0">
          <p className={`text-[var(--text-muted)] ${isSplitPane ? "text-[11px]" : "text-[10px]"}`}>
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}{pinnedSessions.length > 0 ? ` · ${pinnedSessions.length} pinned` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

function formatMessageTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {return value;}
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function chatExportFilename(title: string) {
  const base = (title || "chat")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${base || "chat"}.json`;
}

export default function ChatView() {
  const navigate = useNavigate();
  const { sessionId: routeSessionId } = useParams();

  const {
    sessions, messages,
    setSessions, setMessages, appendMessage, appendStreamChunk, finalizeStream,
    streamingSessionId, streamingContent, setStreamingSession, updateMessage,
  } = useChatStore();
  const { activeChatId, setActiveChatId } = useScopedChat();

  const { 
    activeProjectId, activeWorkspaceId,
  } = useWorkspaceStore();
  const {
    activeProjectId: scopedProjectId,
    setActiveProjectId: setScopedProjectId,
    activeWorkspaceId: scopedWorkspaceId,
  } = useScopedWorkspace();
  const {
    activeTopicSignature, setActiveTopicSignature, setWorkspaceTopicSignature, setMigrationSuggestion, workspaces,
  } = useWorkspaceStore();
  const projects = useScopedProjects();
  const {
    preferredModel, setPreferredModel, ollamaUrl, dualModelEnabled, draftModel,
    dualModelExecutionMode, setDualModelEnabled, setDraftModel, compareModelA: savedCompareA, compareModelB: savedCompareB,
    setCompareModelA: saveCompareA, setCompareModelB: saveCompareB, modelLabels, quickSearchModels,
    skipLinkConfirm, setSkipLinkConfirm,
  } = useSettingsStore();
  const topSelectClassName = "h-8 w-full appearance-none rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] pl-3 pr-8 text-xs font-medium text-[var(--text-primary)] shadow-sm outline-none transition-colors hover:border-[var(--accent-color)] focus:border-[var(--accent-color)]";
  const composerToggleBaseClass = "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium shadow-sm transition-colors";
  const composerToggleInactiveClass = "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]";

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState(preferredModel || "");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [aiModelList, setAiModelList] = useState<AiModel[]>([]);
  const [activeContextSources, setActiveContextSources] = useState<Record<string, any>>({});
  const [loadedSessionScopeKey, setLoadedSessionScopeKey] = useState<string | null>(null);
  const currentSessionId = routeSessionId ?? activeChatId ?? null;
  const effectiveWorkspaceId = scopedWorkspaceId ?? activeWorkspaceId;
  const effectiveProjectId = scopedProjectId ?? activeProjectId;
  const sessionScopeKey = `${effectiveWorkspaceId ?? ""}::${effectiveProjectId ?? ""}`;

  useEffect(() => {
    if (!currentSessionId) { return; }
    const unlistenPromise = api.context.listenContextSources(currentSessionId, (sources) => {
      setActiveContextSources(prev => ({ ...prev, [currentSessionId]: sources }));
    });
    return () => {
      unlistenPromise.then(fn => fn());
    };
  }, [currentSessionId]);

  // Persist model choice to global settings
  const persistModelChoice = useCallback(async (model: string) => {
    if (!model) {return;}
    setPreferredModel(model);
    try {
      const current = await api.settings.get();
      if (current.preferred_model !== model) {
        await api.settings.update({ ...current, preferred_model: model });
      }
    } catch (err) {
      console.error("Failed to persist model choice:", err);
    }
  }, [setPreferredModel]);

  // Persist other settings
  const persistSetting = useCallback(async (key: keyof AppSettings, value: any) => {
    try {
      const current = await api.settings.get();
      if (current[key] !== value) {
        await api.settings.update({ ...current, [key]: value });
      }
    } catch (err) {
      console.error(`Failed to persist ${key}:`, err);
    }
  }, []);

  // Sync selectedModel with store if store hydrates after initial render
  useEffect(() => {
    if (preferredModel && !selectedModel) {
      setSelectedModel(preferredModel);
    }
  }, [preferredModel, selectedModel]);

  const [lastUserMessage, setLastUserMessage] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // Chat mode: normal chat vs model comparison
  const [chatMode, setChatMode] = useState<ChatMode>("chat");

  // Session list features (merged from ChatSessionListView)
  const [sessionQuery, setSessionQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const folderInputRef = useRef<HTMLInputElement>(null);

  async function handleCreateFolder(nameOverride?: string) {
    const folderName = (nameOverride ?? newFolderName).trim();
    if (!folderName || !effectiveWorkspaceId) {
      setCreatingFolder(false);
      setNewFolderName("");
      return;
    }
    try {
      const p = await api.project.create(effectiveWorkspaceId, folderName);
      useWorkspaceStore.getState().addProject(p);
      setScopedProjectId(p.id);
    } catch (e) {
      console.error(e);
    }
    setCreatingFolder(false);
    setNewFolderName("");
  }

  useEffect(() => {
    if (!creatingFolder || !folderInputRef.current) {return;}
    if (document.activeElement !== folderInputRef.current) {
      folderInputRef.current.focus();
    }
  }, [creatingFolder, newFolderName]);

  // Model comparison state
  const [compareModelA, setCompareModelA] = useState(savedCompareA || "");
  const [compareModelB, setCompareModelB] = useState(savedCompareB || "");

  // Sync comparison models when store hydrates
  useEffect(() => {
    if (savedCompareA && !compareModelA) {setCompareModelA(savedCompareA);}
    if (savedCompareB && !compareModelB) {setCompareModelB(savedCompareB);}
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
    if (pendingLink) {open(pendingLink);}
    if (linkDontAsk) {setSkipLinkConfirm(true);}
    setPendingLink(null);
  }, [pendingLink, linkDontAsk, setSkipLinkConfirm]);

  const cancelOpenLink = useCallback(() => {
    setPendingLink(null);
  }, []);

  const markdownComponents = {
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        {...props}
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href) {handleLinkClick(href);}
        }}
        style={{ cursor: "pointer" }}
      >
        {children}
      </a>
    ),
    code: ({ node, inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || "");
      const lang = match ? match[1] : "";
      const content = String(children).replace(/\n$/, "");
      
      if (!inline && content.split("\n").length >= 5) {
        return (
          <div className="group relative">
            <pre className={`${className} p-4 rounded-lg overflow-x-auto bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800`}>
              <code {...props}>{children}</code>
            </pre>
            <button
              onClick={async () => {
                if (!effectiveWorkspaceId) { return; }
                try {
                  await useArtifactStore.getState().createArtifact({
                    workspace_id: effectiveWorkspaceId,
                    session_id: activeChatId,
                    title: `New ${lang || 'Code'} Snippet`,
                    artifact_type: 'code',
                    language: lang,
                    content: content,
                    description: `Extracted from chat session`,
                  });
                } catch (e) {
                  console.error("Failed to save artifact:", e);
                }
              }}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs px-2 py-1 rounded shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300"
            >
              <FileText size={12} />
              Save as Artifact
            </button>
          </div>
        );
      }
      return <code className={className} {...props}>{children}</code>;
    }
  };

  const [comparePrompt, setComparePrompt] = useState("");
  const [compareResponseA, setCompareResponseA] = useState("");
  const [compareResponseB, setCompareResponseB] = useState("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareModels, setCompareModels] = useState<OllamaModel[]>([]);

  // Grounded chat (RAG) state
  const [groundedEnabled, setGroundedEnabled] = useState(false);
  const [groundedTopK, setGroundedTopK] = useState(5);
  const [processedDocCount, setProcessedDocCount] = useState(0);
  const [messageSources, setMessageSources] = useState<Record<string, SearchResult[]>>({});
  const [expandedSources, setExpandedSources] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);

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
  const thoughtProcessingRef = useRef<Set<string>>(new Set());

  const loadThoughts = useCallback(async () => {
    if (!effectiveWorkspaceId) {return;}
    try {
      const items = await api.thoughtQueue.list(effectiveWorkspaceId);
      setThoughts(items);
    } catch { /* ignore */ }
  }, [effectiveWorkspaceId]);

  useEffect(() => {
    if (!thoughtPanelOpen) {return;}
    loadThoughts();
  }, [thoughtPanelOpen, loadThoughts]);

  const processDueThought = useCallback(async (thought: ThoughtItem) => {
    if (thoughtProcessingRef.current.has(thought.id)) {return;}
    thoughtProcessingRef.current.add(thought.id);
    try {
      await api.thoughtQueue.updateStatus(thought.id, "processing");
      setThoughts((prev) => prev.map((t) => t.id === thought.id ? { ...t, status: "processing" } : t));
      const userContent = thought.prompt_prefix.trim()
        ? `${thought.prompt_prefix}\n\n${thought.content}`
        : thought.content;
      const result = await api.ollama.sendMessage(thought.id, thought.model_name, [{ role: "user", content: userContent }], false, ollamaUrl);
      await api.thoughtQueue.updateResult(thought.id, result);
      setThoughts((prev) => prev.map((t) => t.id === thought.id ? { ...t, status: "done", result, result_at: new Date().toISOString() } : t));
      setThoughtExpandedId(thought.id);
    } catch {
      await api.thoughtQueue.updateStatus(thought.id, "scheduled").catch(() => {});
      setThoughts((prev) => prev.map((t) => t.id === thought.id ? { ...t, status: "scheduled" } : t));
    } finally {
      thoughtProcessingRef.current.delete(thought.id);
    }
  }, [ollamaUrl]);

  useEffect(() => {
    if (!effectiveWorkspaceId || !thoughtPanelOpen) {return;}
    async function pollDue() {
      if (!effectiveWorkspaceId) {return;}
      try {
        const due = await api.thoughtQueue.getDue(effectiveWorkspaceId);
        for (const t of due) {processDueThought(t);}
      } catch { /* ignore */ }
    }
    pollDue();
    const timer = setInterval(pollDue, 60_000);
    return () => clearInterval(timer);
  }, [effectiveWorkspaceId, thoughtPanelOpen, processDueThought]);

  async function submitThought() {
    if (!effectiveWorkspaceId || !thoughtDraft.trim()) {return;}
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
  const [preserveWebSession, setPreserveWebSession] = useState(false);

  useEffect(() => {
    api.settings.get().then((s) => setPreserveWebSession(s.web_session_preserve)).catch(() => {});
  }, []);

  // Dual-model (draft + refine) state
  const [isRefiningPhase, setIsRefiningPhase] = useState(false);
  const [draftSnapshot, setDraftSnapshot] = useState("");
  const [refineStreamingContent, setRefineStreamingContent] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const incognitoSessionIdsRef = useRef<Set<string>>(new Set());
  const refineContentRef = useRef("");

  const activeMessages = activeChatId ? (messages[activeChatId] ?? []) : [];
  const sessionTokensUsed = activeMessages.reduce((sum, m) => sum + (m.tokens_used ?? 0), 0);
  const isCurrentlyStreaming = streamingSessionId === activeChatId;
  const isCurrentlyRefining = isRefiningPhase && refineStreamingContent.length > 0;
  const activeSession = activeChatId ? sessions.find((s) => s.id === activeChatId) ?? null : null;

  function resetDualStreamingState() {
    setIsRefiningPhase(false);
    setDraftSnapshot("");
    refineContentRef.current = "";
    setRefineStreamingContent("");
  }

  function appendRefineChunk(chunk: string) {
    refineContentRef.current += chunk;
    setRefineStreamingContent(refineContentRef.current);
  }

  // Web AI provider detection
  const selectedModelMeta = aiModelList.find((m) => m.model_id === selectedModel);
  const isWebProvider = selectedModelMeta?.provider.startsWith("web_") ?? false;
  const webProviderKey = isWebProvider ? selectedModelMeta!.provider.replace("web_", "") : "";
  const webProviderLabel: Record<string, string> = {
    chatgpt: "ChatGPT", deepseek: "DeepSeek", claude: "Claude", gemini: "Gemini",
  };

  // Filter + sort sessions: pinned first, then by date
  const filteredSessions = sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(sessionQuery.toLowerCase()) ||
      s.model_name.toLowerCase().includes(sessionQuery.toLowerCase())
  );
  const pinnedSessions = filteredSessions.filter((s) => s.is_pinned);
  const unpinnedSessions = filteredSessions.filter((s) => !s.is_pinned);

  // Load processed doc count for grounded chat indicator
  useEffect(() => {
    if (!effectiveWorkspaceId) { setProcessedDocCount(0); return; }
    api.document.list(effectiveWorkspaceId).then((docs) => {
      setProcessedDocCount(docs.filter((d) => d.is_processed).length);
    }).catch(() => setProcessedDocCount(0));
  }, [effectiveWorkspaceId]);

  // Load sessions (scoped to active project, or unscoped when none selected)
  useEffect(() => {
    if (!effectiveWorkspaceId) {
      setLoadedSessionScopeKey(null);
      return;
    }

    const scopeKey = `${effectiveWorkspaceId}::${effectiveProjectId ?? ""}`;
    let cancelled = false;
    setLoadedSessionScopeKey(null);

    api.chat.listSessions(effectiveWorkspaceId, effectiveProjectId)
      .then((nextSessions) => {
        if (cancelled) {return;}
        setSessions(nextSessions);
        setLoadedSessionScopeKey(scopeKey);
      })
      .catch(() => {
        if (cancelled) {return;}
        setLoadedSessionScopeKey(scopeKey);
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveWorkspaceId, effectiveProjectId, setSessions]);

  useEffect(() => {
    if (!effectiveWorkspaceId || !currentSessionId) {return;}
    if (loadedSessionScopeKey !== sessionScopeKey) {return;}

    const sessionStillVisible = sessions.some(
      (session) => session.id === currentSessionId && session.workspace_id === effectiveWorkspaceId
    );
    if (sessionStillVisible) {return;}

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
    sessions,
    setActiveChatId,
  ]);

  // Load active topic signature when workspace changes
  useEffect(() => {
    if (effectiveWorkspaceId) {
      const cachedWorkspace = workspaces.find((workspace) => workspace.id === effectiveWorkspaceId);
      if (cachedWorkspace?.topic_signature) {
        setActiveTopicSignature(cachedWorkspace.topic_signature);
      } else {
        setActiveTopicSignature(null);
      }

      api.topicSignature.get(effectiveWorkspaceId)
        .then(sig => setWorkspaceTopicSignature(effectiveWorkspaceId, sig))
        .catch(() => {});
    } else {
      setActiveTopicSignature(null);
    }
  }, [effectiveWorkspaceId, setActiveTopicSignature, setWorkspaceTopicSignature, workspaces]);

  useEffect(() => {
    if (!effectiveWorkspaceId) {return;}

    let cancelled = false;

    const refreshSignature = () => {
      if (document.visibilityState === "hidden") {return;}
      api.topicSignature.get(effectiveWorkspaceId)
        .then((sig) => {
          if (!cancelled) {
            setWorkspaceTopicSignature(effectiveWorkspaceId, sig);
          }
        })
        .catch(() => {});
    };

    const intervalId = window.setInterval(refreshSignature, 60_000);
    document.addEventListener("visibilitychange", refreshSignature);
    window.addEventListener("focus", refreshSignature);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshSignature);
      window.removeEventListener("focus", refreshSignature);
    };
  }, [effectiveWorkspaceId, setWorkspaceTopicSignature]);

  // Activate session from URL
  useEffect(() => {
    if (routeSessionId) {setActiveChatId(routeSessionId);}
  }, [routeSessionId, setActiveChatId]);

  useEffect(() => {
    incognitoSessionIdsRef.current = new Set(
      sessions.filter((session) => session.is_incognito).map((session) => session.id)
    );
  }, [sessions]);

  const cleanupIncognitoSession = useCallback(async (sessionToDelete: string) => {
    if (!effectiveWorkspaceId) {return;}
    try {
      await api.chat.deleteSession(effectiveWorkspaceId, sessionToDelete);
    } catch {
      // Ignore cleanup failures during navigation away.
    }
    useChatStore.getState().removeSession(sessionToDelete);
    if (activeChatId === sessionToDelete) {
      setActiveChatId(null);
    }
  }, [effectiveWorkspaceId, activeChatId, setActiveChatId]);

  useEffect(() => {
    const previousSessionId = activeChatId;
    return () => {
      if (!previousSessionId || !incognitoSessionIdsRef.current.has(previousSessionId)) {return;}
      void cleanupIncognitoSession(previousSessionId);
    };
  }, [activeChatId, cleanupIncognitoSession]);

  // Sync selectedModel with active session's model
  useEffect(() => {
    if (activeChatId) {
      const session = sessions.find((s) => s.id === activeChatId);
      if (session && session.model_name && session.model_name !== selectedModel) {
        setSelectedModel(session.model_name);
      }
    }
  }, [activeChatId, sessions, selectedModel]);

  // Load messages when session changes
  useEffect(() => {
    if (!activeChatId || messages[activeChatId] || !effectiveWorkspaceId) {return;}
    api.chat.getMessages(effectiveWorkspaceId, activeChatId)
      .then((msgs) => setMessages(activeChatId, msgs))
      .catch(() => {});
  }, [activeChatId, effectiveWorkspaceId, messages, setMessages]);

  // Load AI model priority list + fallback to raw Ollama models
  useEffect(() => {
    api.aiModel.list().then((models) => {
      setAiModelList(models);
      const enabled = models.filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
      if (enabled.length > 0) {
        const modelIds = enabled.map((m) => m.model_id);
        setAvailableModels(modelIds);
        if (!modelIds.includes(selectedModel)) {
          setSelectedModel(modelIds[0]);
        }
        return;
      }
      // Fallback to raw Ollama models
      api.ollama.listModels(ollamaUrl).then((m) => {
        if (m.length > 0) {
          const names = m.map((x) => x.name);
          setAvailableModels(names);
          if (!names.includes(selectedModel)) {
            setSelectedModel(names[0]);
          }
        }
      }).catch(() => {});
    }).catch(() => {
      // If ai_model list fails, fallback to Ollama
      api.ollama.listModels(ollamaUrl).then((m) => {
        if (m.length > 0) {
          const names = m.map((x) => x.name);
          setAvailableModels(names);
          if (!names.includes(selectedModel)) {
            setSelectedModel(names[0]);
          }
        }
      }).catch(() => {});
    });
  }, [ollamaUrl]);

  // Scroll to bottom on new messages — use instant scroll during streaming
  // so rapid content updates don't cause smooth-scroll to fall behind
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: isCurrentlyStreaming ? "instant" : "smooth",
    });
  }, [activeMessages.length, streamingContent, isCurrentlyStreaming]);

  async function createNewSession(options?: { isIncognito?: boolean; excludeFromAnalytics?: boolean }) {
    if (!effectiveWorkspaceId) {return;}
    const privacy = {
      isIncognito: options?.isIncognito ?? false,
      excludeFromAnalytics: options?.excludeFromAnalytics ?? false,
    };

    const workspaceSessions = await api.chat.listSessions(effectiveWorkspaceId, null);
    const unusedSession = findUnusedSession(
      workspaceSessions,
      useChatStore.getState().messages,
      effectiveWorkspaceId,
    );
    if (unusedSession) {
      setActiveChatId(unusedSession.id);
      if (!sessions.some((session) => session.id === unusedSession.id)) {
        useChatStore.getState().addSession(unusedSession);
      }
      return;
    }

    const session = await api.chat.createSession(effectiveWorkspaceId, effectiveProjectId, {
      modelName: selectedModel,
      is_incognito: privacy.isIncognito,
      exclude_from_analytics: privacy.excludeFromAnalytics,
    });
    useChatStore.getState().addSession(session);
    setActiveChatId(session.id);
    setMessages(session.id, []);
  }
  async function generateSessionTitleIfNeeded(sessionId: string, model: string, firstMessage: string) {
    const settings = await api.settings.get().catch(() => null);
    if (!settings || settings.chat_title_auto_refresh === "disabled") {return;}

    const session = useChatStore.getState().sessions.find(s => s.id === sessionId);
    if (!session) {return;}

    const sessionMessages = useChatStore.getState().messages[sessionId] ?? [];
    const userMessageCount = sessionMessages.filter(m => m.role === "user").length;
    const isFirstMessage = userMessageCount <= 1;

    // Initial title generation on first message
    if (isFirstMessage && effectiveWorkspaceId) {
      try {
        const title = await api.ollama.generateTitle(model, firstMessage, ollamaUrl);
        // Persist to DB
        await api.chat.updateSession(effectiveWorkspaceId, sessionId, { title });
        // Update local store
        useChatStore.getState().updateSession({
          ...session,
          title,
          title_generated_at: new Date().toISOString(),
          message_count_at_title_gen: 1
        });
      } catch {
        // Silently fail if title generation errors
      }
      return;
    }

    // Periodic title refresh — only in "periodic" mode, skip if "initial_only"
    if (settings.chat_title_auto_refresh === "periodic" && effectiveWorkspaceId) {
      const lastTitleGenCount = session.message_count_at_title_gen ?? 0;
      const interval = settings.chat_title_refresh_interval || 5;

      if (userMessageCount - lastTitleGenCount >= interval) {
        try {
          // Send conversation context for a better title
          const conversation = sessionMessages.map(m => ({ role: m.role, content: m.content }));
          const title = await api.ollama.generateTitleFromConversation(model, conversation, ollamaUrl);
          // Persist to DB
          await api.chat.updateSession(effectiveWorkspaceId, sessionId, { title });
          // Update local store
          useChatStore.getState().updateSession({
            ...session,
            title,
            title_generated_at: new Date().toISOString(),
            message_count_at_title_gen: userMessageCount
          });
        } catch {
          // Silently fail if title generation errors
        }
      }
    }
  }

  function triggerFollowUps(sessionId: string) {
    const history = (useChatStore.getState().messages[sessionId] ?? []).map(m => ({ role: m.role, content: m.content }));
    const model = selectedModel || useChatStore.getState().sessions.find(s => s.id === sessionId)?.model_name || "";
    if (!model) {return;}
    api.ollama.generateFollowUps(model, history, ollamaUrl)
      .then(suggestions => setFollowUps(suggestions))
      .catch(() => {});
  }

  async function sendMessage() {
    await sendMessageWithModel(selectedModel);
  }

  async function sendMessageWithModel(modelId: string, contentOverride?: string) {
    const userContent = (contentOverride ?? input).trim();
    if (!userContent || isStreaming || !modelId || !effectiveWorkspaceId) {return;}

    const modelMeta = aiModelList.find((m) => m.model_id === modelId);
    const isOneOffWebProvider = modelMeta?.provider.startsWith("web_") ?? false;
    const oneOffWebProviderKey = isOneOffWebProvider ? modelMeta!.provider.replace("web_", "") : "";

    let sid = activeChatId;
    if (!sid) {
      const session = await api.chat.createSession(effectiveWorkspaceId, effectiveProjectId, { modelName: modelId });
      useChatStore.getState().addSession(session);
      sid = session.id;
      setActiveChatId(session.id);
      setMessages(session.id, []);
    }

    if (contentOverride === undefined) {
      setInput("");
    }
    setIsStreaming(true);
    setLastUserMessage(userContent);
    setFollowUps([]);

    if (effectiveWorkspaceId) {
      api.topicSignature.checkMatch(effectiveWorkspaceId, userContent)
        .then(result => { if (!result.is_match && result.suggestion) {setMigrationSuggestion(result);} })
        .catch(() => {});
    }

    const optimisticUserMsg: Message = {
      id: window.crypto.randomUUID(),
      session_id: sid,
      role: "user",
      content: userContent,
      created_at: new Date().toISOString(),
    };
    appendMessage(sid, optimisticUserMsg);

    const userMsg = await api.chat.addMessage(effectiveWorkspaceId, sid, "user", userContent);
    updateMessage(sid, persistedUserMessageWithFallback(optimisticUserMsg, userMsg));

    const history = (messages[sid] ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let finalUserContent = userContent;
    if (groundedEnabled && effectiveProjectId) {
      try {
        const keywordResults = await api.search.keyword(userContent, effectiveWorkspaceId, effectiveProjectId);
        const chunkResults = keywordResults.filter((r) => r.result_type === "document_chunk").slice(0, groundedTopK);
        if (chunkResults.length > 0) {
          const contextParts = chunkResults.map((r, i) => `[${i + 1}] **${r.title}**: ${r.excerpt}`);
          finalUserContent =
            `You have access to the following document excerpts:\n\n` +
            contextParts.join("\n\n") +
            `\n\nUsing the above context where relevant, answer: ${userContent}\n\n` +
            `Cite sources as [1], [2], etc. when referencing specific content.`;
          setMessageSources((prev) => ({ ...prev, [optimisticUserMsg.id]: chunkResults }));
        }
      } catch {
      }
    }

    if (optimisticUserMsg.id !== userMsg.id) {
      setMessageSources((prev) => {
        const pending = prev[optimisticUserMsg.id];
        if (!pending) {return prev;}
        const next = { ...prev, [userMsg.id]: pending };
        delete next[optimisticUserMsg.id];
        return next;
      });
    }

    history.push({ role: "user", content: finalUserContent });

    if (isOneOffWebProvider && oneOffWebProviderKey) {
      try {
        const unlisten = await api.listenStream(sid, (chunk, done) => {
          if (done) {
            const assembled = useChatStore.getState().streamingContent;
            finalizeStream(sid!, modelId);
            setIsStreaming(false);
            unlisten();
            api.chat.addMessage(effectiveWorkspaceId, sid!, "assistant", assembled, modelId)
              .then((persisted) => { updateMessage(sid!, persisted); triggerFollowUps(sid!); })
              .catch(() => {});
          } else {
            appendStreamChunk(sid!, chunk);
          }
        });
        await api.webAI.sendMessage(sid, oneOffWebProviderKey, finalUserContent, preserveWebSession);
      } catch (err) {
        setIsStreaming(false);
        const errMsg = err instanceof Error ? err.message : String(err);
        appendStreamChunk(sid, `\n\n⚠️ Error: ${errMsg}`);
        finalizeStream(sid, modelId);
      }
    } else if (dualModelEnabled && draftModel && draftModel !== modelId) {
      resetDualStreamingState();
      try {
        let draftUnlisten: (() => void) | null = null;
        draftUnlisten = await api.listenStream(sid!, (chunk, done) => {
          if (done) {
            const draftText = useChatStore.getState().streamingContent;
            setDraftSnapshot(draftText);
            setStreamingSession(null);
            if (dualModelExecutionMode === "serial") {
              setIsRefiningPhase(true);
            }
            draftUnlisten?.();
          } else {
            appendStreamChunk(sid!, chunk);
          }
        });

        let refineUnlisten: (() => void) | null = null;
        refineUnlisten = await api.listenRefineStream(sid!, (chunk, done, tokensUsed, durationMs) => {
          if (done) {
            const refineText = refineContentRef.current;
            appendMessage(sid!, {
              id: window.crypto.randomUUID(),
              session_id: sid!,
              role: "assistant",
              content: refineText,
              model_name: modelId,
              tokens_used: tokensUsed,
              duration_ms: durationMs,
              created_at: new Date().toISOString(),
            });
            resetDualStreamingState();
            setIsStreaming(false);
            refineUnlisten?.();
            api.chat.addMessage(effectiveWorkspaceId, sid!, "assistant", refineText, modelId, tokensUsed, durationMs)
              .then((persisted) => { updateMessage(sid!, persisted); triggerFollowUps(sid!); })
              .catch(() => {});
            if (tokensUsed && tokensUsed > 0) {
              api.aiModel.recordTokenUsage(modelId, tokensUsed).catch(() => {});
            }
          } else {
            setIsRefiningPhase(true);
            appendRefineChunk(chunk);
          }
        });

        await api.ollama.sendDualModelMessage(sid!, draftModel, modelId, history, dualModelExecutionMode, ollamaUrl);
      } catch (err) {
        setIsStreaming(false);
        resetDualStreamingState();
        const errMsg = err instanceof Error ? err.message : String(err);
        appendStreamChunk(sid!, `\n\n⚠️ Error: ${errMsg}`);
        finalizeStream(sid!, modelId);
      }
    } else {
      try {
        const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs) => {
          if (done) {
            const assembled = useChatStore.getState().streamingContent;
            finalizeStream(sid!, modelId);
            setIsStreaming(false);
            unlisten();
            api.chat.addMessage(effectiveWorkspaceId, sid!, "assistant", assembled, modelId, tokensUsed, durationMs)
              .then((persisted) => { updateMessage(sid!, persisted); triggerFollowUps(sid!); })
              .catch(() => {});
            if (tokensUsed && tokensUsed > 0) {
              api.aiModel.recordTokenUsage(modelId, tokensUsed).catch(() => {});
            }
          } else {
            appendStreamChunk(sid!, chunk);
          }
        });

        await api.context.assembleAndSend(sid, effectiveWorkspaceId, modelId, { ollama_url: ollamaUrl || undefined });
      } catch (err) {
        setIsStreaming(false);
        const errMsg = err instanceof Error ? err.message : String(err);
        appendStreamChunk(sid, `\n\n⚠️ Error: ${errMsg}`);
        finalizeStream(sid, modelId);
      }
    }

    await generateSessionTitleIfNeeded(sid, modelId, userContent);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function handleComposerSuggestion(suggestion: ComposerSuggestion) {
    if (suggestion.action === "send_immediately") {
      await sendMessageWithModel(selectedModel, suggestion.prompt);
      return;
    }

    setInput((prev) => mergeComposerInput(prev, suggestion.prompt));
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function deleteSession(id: string) {
    if (!effectiveWorkspaceId) {return;}
    const settings = useSettingsStore.getState();
    const isImmediate = settings.immediateDelete;
    const skipConfirm = !isImmediate && !settings.confirmMoveToTrash;

    if (!skipConfirm) {
      const confirmMsg = isImmediate 
        ? "Permanently delete this chat session and all its messages? This cannot be undone."
        : "Move this chat to the recycle bin?";

      if (!window.confirm(confirmMsg)) {return;}
    }

    await api.chat.deleteSession(effectiveWorkspaceId, id);
    useChatStore.getState().removeSession(id);
    if (activeChatId === id) {setActiveChatId(null);}
  }

  async function togglePin(session: ChatSession) {
    if (!effectiveWorkspaceId) {return;}
    await api.chat.updateSession(effectiveWorkspaceId, session.id, { is_pinned: !session.is_pinned });
    setSessions(
      sessions.map((s) =>
        s.id === session.id ? { ...s, is_pinned: !s.is_pinned } : s
      )
    );
  }

  async function renameSession(id: string) {
    if (!renameTitle.trim() || !effectiveWorkspaceId) { setRenamingId(null); return; }
    await api.chat.updateSession(effectiveWorkspaceId, id, { title: renameTitle });
    setSessions(sessions.map((s) => s.id === id ? { ...s, title: renameTitle } : s));
    setRenamingId(null);
  }

  async function saveSession(session: ChatSession) {
    try {
      const destPath = await saveDialog({
        defaultPath: chatExportFilename(session.title || "chat"),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!destPath) {return;}
      await api.chatFile.exportAsJson(session.id, destPath);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to save chat.");
    }
  }

  function copyMessage(msgId: string, content: string) {
    window.navigator.clipboard.writeText(content);
    setCopiedMessageId(msgId);
    setTimeout(() => setCopiedMessageId(null), 1500);
  }

  function startEditing(msgId: string, content: string) {
    setEditingMessageId(msgId);
    setEditContent(content);
  }

  async function submitEdit(msgId: string) {
    if (!activeChatId || !editContent.trim() || !effectiveWorkspaceId) {return;}
    setEditingMessageId(null);
    const idx = activeMessages.findIndex((m) => m.id === msgId);
    if (idx < 0) {return;}
    const trimmedMessages = activeMessages.slice(0, idx);
    setMessages(activeChatId, trimmedMessages);
    setInput("");
    setIsStreaming(true);
    setLastUserMessage(editContent.trim());

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
      const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs) => {
        if (done) {
          finalizeStream(sid, selectedModel);
          setIsStreaming(false);
          unlisten();
          const assembled = useChatStore.getState().streamingContent;
          api.chat.addMessage(effectiveWorkspaceId, sid, "assistant", assembled, selectedModel, tokensUsed, durationMs)
            .then((persisted) => updateMessage(sid, persisted))
            .catch(() => {});
          if (tokensUsed && tokensUsed > 0) {
            api.aiModel.recordTokenUsage(selectedModel, tokensUsed).catch(() => {});
          }
        } else {
          appendStreamChunk(sid, chunk);
        }
      });
      await api.context.assembleAndSend(sid, effectiveWorkspaceId, selectedModel, { ollama_url: ollamaUrl || undefined });
    } catch (err) {
      setIsStreaming(false);
      const errMsg = err instanceof Error ? err.message : String(err);
      appendStreamChunk(activeChatId, `\n\n⚠️ Error: ${errMsg}`);
      finalizeStream(activeChatId, selectedModel);
    }
  }

  async function redoMessage(msgId: string) {
    if (!activeChatId || isStreaming || !effectiveWorkspaceId) {return;}
    const idx = activeMessages.findIndex((m) => m.id === msgId);
    if (idx < 0) {return;}
    const trimmedMessages = activeMessages.slice(0, idx);
    setMessages(activeChatId, trimmedMessages);

    const history = trimmedMessages.map((m) => ({ role: m.role, content: m.content }));

    setIsStreaming(true);
    try {
      const sid = activeChatId;
      const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs) => {
        if (done) {
          finalizeStream(sid, selectedModel);
          setIsStreaming(false);
          unlisten();
          const assembled = useChatStore.getState().streamingContent;
          api.chat.addMessage(effectiveWorkspaceId, sid, "assistant", assembled, selectedModel, tokensUsed, durationMs)
            .then((persisted) => updateMessage(sid, persisted))
            .catch(() => {});
          if (tokensUsed && tokensUsed > 0) {
            api.aiModel.recordTokenUsage(selectedModel, tokensUsed).catch(() => {});
          }
        } else {
          appendStreamChunk(sid, chunk);
        }
      });
      await api.context.assembleAndSend(sid, effectiveWorkspaceId, selectedModel, { ollama_url: ollamaUrl || undefined });
    } catch (err) {
      setIsStreaming(false);
      const errMsg = err instanceof Error ? err.message : String(err);
      appendStreamChunk(activeChatId, `\n\n⚠️ Error: ${errMsg}`);
      finalizeStream(activeChatId, selectedModel);
    }
  }

  // Load models for comparison mode
  useEffect(() => {
    if (chatMode !== "compare") {return;}
    api.ollama.listModels(ollamaUrl || undefined).then((list) => {
      setCompareModels(list);
      if (list.length > 0 && !compareModelA) {setCompareModelA(list[0].name);}
      if (list.length > 1 && !compareModelB) {setCompareModelB(list[1].name);}
      else if (list.length === 1 && !compareModelB) {setCompareModelB(list[0].name);}
    }).catch(() => {});
  }, [chatMode, ollamaUrl]);

  async function runComparison() {
    if (!comparePrompt.trim() || compareLoading) {return;}
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
    } catch (err: any) {
      setCompareError(err?.message ?? String(err));
    } finally {
      setCompareLoading(false);
    }
  }

  const activeProject = projects.find((p) => p.id === effectiveProjectId) ?? null;
  const activeWorkspace = workspaces.find((workspace) => workspace.id === effectiveWorkspaceId) ?? null;

  // Compute next-priority enabled model for "Try better model" button
  const enabledModels = aiModelList.filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
  const currentModelIdx = enabledModels.findIndex((m) => m.model_id === selectedModel);
  const nextModel = currentModelIdx >= 0 && currentModelIdx < enabledModels.length - 1 ? enabledModels[currentModelIdx + 1] : null;
  const composerSuggestionRows = useMemo(() => {
    const suggestionContext = {
      workspaceName: activeWorkspace?.name ?? null,
      projectName: activeProject?.name ?? null,
      topicSignature: activeTopicSignature,
      processedDocCount,
      activeMessages,
      followUps,
    };

    return [buildWorkspaceSuggestionRow(suggestionContext), buildChatSuggestionRow(suggestionContext)]
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }, [
    activeWorkspace,
    activeProject,
    activeTopicSignature,
    processedDocCount,
    activeMessages,
    followUps,
  ]);

  // Map model_id to display name from global labels or priority list
  const modelDisplayName = (modelId: string) => {
    if (modelLabels[modelId]) {return modelLabels[modelId];}
    const found = aiModelList.find((m) => m.model_id === modelId);
    return found ? found.name : modelId;
  };

  const persistedUserMessageWithFallback = (optimistic: Message, persisted: Message): Message => ({
    ...optimistic,
    ...persisted,
    id: optimistic.id,
  });

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      <SessionSidebar
        sessions={sessions}
        pinnedSessions={pinnedSessions}
        unpinnedSessions={unpinnedSessions}
        filteredSessions={filteredSessions}
        activeProject={activeProject}
        sessionQuery={sessionQuery}
        setSessionQuery={setSessionQuery}
        creatingFolder={creatingFolder}
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
        togglePin={togglePin}
        saveSession={saveSession}
        deleteSession={deleteSession}
      />

      {/* Compare mode */}
      {chatMode === "compare" ? (
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden min-h-0">
          <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <SplitSquareHorizontal size={14} className="text-[var(--text-muted)]" />
              Compare Models
            </div>
            <button
              onClick={() => setChatMode("chat")}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors"
              title="Return to chat"
            >
              <MessageSquare size={12} />
              Chat
            </button>
          </div>

          {/* Model selectors header */}
          <div className="flex items-stretch border-b border-[var(--border-color)] flex-shrink-0 bg-[var(--bg-elevated)]">
            <div className="flex-1 px-4 py-3 flex flex-col gap-1 border-r border-[var(--border-color)]">
              <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Model A</label>
              {compareModels.length === 0 ? (
                <input
                  value={compareModelA}
                  onChange={(e) => {
                    setCompareModelA(e.target.value);
                    saveCompareA(e.target.value);
                    persistSetting("compare_model_a", e.target.value);
                  }}
                  placeholder="e.g. llama3"

                  className="text-sm bg-transparent border-b border-[var(--border-color)] text-[var(--text-primary)] outline-none py-0.5 w-full placeholder:text-[var(--text-muted)]"
                />
              ) : (
                <div className="relative">
                  <select
                    value={compareModelA}
                    onChange={(e) => {
                      setCompareModelA(e.target.value);
                      saveCompareA(e.target.value);
                      persistSetting("compare_model_a", e.target.value);
                    }}
                    className={topSelectClassName}
                  >
                    {compareModels.map((m) => <option key={m.name} value={m.name}>{modelDisplayName(m.name)}</option>)}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                </div>

              )}
            </div>
            <div className="flex items-center px-3">
              <button onClick={() => api.ollama.listModels(ollamaUrl || undefined).then(setCompareModels).catch(() => {})} title="Refresh models" className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors">
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="flex-1 px-4 py-3 flex flex-col gap-1 border-l border-[var(--border-color)]">
              <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Model B</label>
              {compareModels.length === 0 ? (
                <input
                  value={compareModelB}
                  onChange={(e) => {
                    setCompareModelB(e.target.value);
                    saveCompareB(e.target.value);
                    persistSetting("compare_model_b", e.target.value);
                  }}
                  placeholder="e.g. llama3:8b"
                  className="text-sm bg-transparent border-b border-[var(--border-color)] text-[var(--text-primary)] outline-none py-0.5 w-full placeholder:text-[var(--text-muted)]"
                />
              ) : (
                <div className="relative">
                  <select
                    value={compareModelB}
                    onChange={(e) => {
                      setCompareModelB(e.target.value);
                      saveCompareB(e.target.value);
                      persistSetting("compare_model_b", e.target.value);
                    }}
                    className={topSelectClassName}
                  >
                    {compareModels.map((m) => <option key={m.name} value={m.name}>{modelDisplayName(m.name)}</option>)}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                </div>

              )}
            </div>
          </div>

          {/* Side-by-side responses */}
          <div className="flex flex-1 min-w-0 overflow-hidden divide-x divide-[var(--border-color)]">
            {[{ label: "Model A", model: compareModelA, text: compareResponseA }, { label: "Model B", model: compareModelB, text: compareResponseB }].map((panel) => (
              <div key={panel.label} className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-elevated)] flex-shrink-0">
                  <span className="text-xs font-medium text-[var(--text-primary)]">{panel.label}</span>
                  {panel.model && <span className="ml-2 text-xs text-[var(--text-muted)]">{modelDisplayName(panel.model)}</span>}
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4">
                  {compareLoading && !panel.text ? (
                    <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm"><span className="animate-pulse">●</span> Generating…</div>
                  ) : panel.text ? (
                    <pre className="text-sm text-[var(--text-primary)] whitespace-pre-wrap font-[inherit] leading-relaxed">{panel.text}</pre>
                  ) : (
                    <p className="text-sm text-[var(--text-muted)] italic">Response will appear here…</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {compareError && (
            <div className="px-4 py-2 text-xs text-red-400 bg-red-500/10 border-t border-red-500/20 flex-shrink-0">{compareError}</div>
          )}

          {/* Compare input */}
          <div className="border-t border-[var(--border-color)] px-4 py-3 flex gap-3 items-end flex-shrink-0">
            <textarea
              rows={2}
              value={comparePrompt}
              onChange={(e) => setComparePrompt(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runComparison(); } }}
              placeholder="Enter prompt to compare… (⌘↵ to send)"
              className="flex-1 resize-none px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] min-h-[40px] max-h-[120px]"
            />
            <button
              onClick={runComparison}
              disabled={!comparePrompt.trim() || compareLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-white bg-[var(--accent-color)] hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              <Send size={14} /> {compareLoading ? "Running…" : "Compare"}
            </button>
          </div>
        </div>
      ) : !activeChatId ? (
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-4 text-center">
          <MessageSquare size={40} className="text-[var(--text-muted)] opacity-30" />
          <p className="text-[var(--text-muted)] text-sm">Select a conversation or start a new one</p>
          <div className="flex gap-2">
            <button
              onClick={() => createNewSession()}
              className="px-4 py-2 bg-[var(--accent-color)] text-white rounded-lg text-sm hover:opacity-90"
            >
              Start a new chat
            </button>

            <button
              onClick={() => createNewSession({ isIncognito: true })}
              className="px-4 py-2 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-lg text-sm hover:bg-purple-500/20"
            >
              Start incognito
            </button>
            <button
              onClick={() => createNewSession({ excludeFromAnalytics: true })}
              className="px-4 py-2 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-lg text-sm hover:bg-sky-500/20"
            >
              Exclude analytics
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {/* Slim title bar */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
            <span className="text-sm font-medium text-[var(--text-primary)] flex-1 truncate flex items-center gap-2">
              {activeSession?.title || "New Chat"}
              {activeSession?.is_incognito && (
                <span title="Incognito thread"><Ghost size={14} className="text-purple-400" /></span>
              )}
              {!activeSession?.is_incognito && activeSession?.exclude_from_analytics && (
                <span title="Excluded from analytics"><Shield size={14} className="text-sky-400" /></span>
              )}
            </span>
            {availableModels.length === 0 && (
              <span className="text-xs text-amber-400">No Ollama models found</span>
            )}
          </div>

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

          {/* Web AI provider notice */}
          {isWebProvider && webProviderKey && (
            <div className="mx-4 mt-2 px-3 py-1.5 rounded bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-400 flex items-center gap-1.5">
              <Globe size={12} />
              A browser window will open — log in to {webProviderLabel[webProviderKey] ?? webProviderKey} and your query will be submitted automatically.
              {!preserveWebSession && (
                <span className="ml-auto text-[10px] opacity-60">Session cleared after query</span>
              )}
            </div>
          )}

          {/* Grounded mode warning if no processed docs */}
          {groundedEnabled && processedDocCount === 0 && effectiveProjectId && (
            <div className="mx-4 mt-2 px-3 py-1.5 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-500 flex items-center gap-1.5">
              <FileText size={12} />
              No processed documents. Upload and process docs in the Document Browser.
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
            {activeMessages.map((msg, i) => (
              <div
                key={msg.id}
                className={`group/msg flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                {editingMessageId === msg.id ? (
                  <div className="max-w-[75%] w-full flex flex-col gap-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full resize-none px-3.5 py-2.5 text-sm rounded-xl bg-[var(--bg-elevated)] border border-[var(--accent-color)] text-[var(--text-primary)] outline-none max-h-40 overflow-y-auto"
                      rows={3}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(msg.id); }
                        if (e.key === "Escape") {setEditingMessageId(null);}
                      }}
                    />
                    <div className="flex gap-1.5 justify-end">
                      <button
                        onClick={() => setEditingMessageId(null)}
                        className="px-2.5 py-1 text-xs rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => submitEdit(msg.id)}
                        className="px-2.5 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 transition-opacity"
                      >
                        Send
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className={`max-w-[75%] break-words rounded-2xl px-4 py-2.5 text-sm ${
                        msg.role === "user"
                          ? "message-user"
                          : "message-assistant"
                      }`}
                    >
                      {msg.role === "assistant" ? (
                        <div className="prose prose-sm prose-invert max-w-none overflow-x-auto">
                          {i === activeMessages.length - 1 && currentSessionId && activeContextSources[currentSessionId] && (
                            <ContextIndicator sources={activeContextSources[currentSessionId]} />
                          )}
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      )}
                    </div>
                    <div className={`flex gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                      <button
                        onClick={() => copyMessage(msg.id, msg.content)}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                        title="Copy"
                      >
                        {copiedMessageId === msg.id ? <Check size={11} /> : <Copy size={11} />}
                      </button>
                      {msg.role === "user" && !isStreaming && (
                        <button
                          onClick={() => startEditing(msg.id, msg.content)}
                          className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                          title="Edit"
                        >
                          <Pencil size={11} />
                        </button>
                      )}
                      {msg.role === "assistant" && !isStreaming && (
                        <button
                          onClick={() => redoMessage(msg.id)}
                          className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                          title="Redo"
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}
                    </div>
                    <div className={`flex items-center gap-2 text-[10px] text-[var(--text-muted)] tabular-nums ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                      <span>{formatMessageTimestamp(msg.created_at)}</span>
                      {msg.role === "assistant" && msg.tokens_used ? (
                        <span>{msg.tokens_used.toLocaleString()} tok</span>
                      ) : null}
                      {msg.role === "assistant" && msg.duration_ms ? (
                        <span>
                          {msg.duration_ms >= 1000
                            ? `${(msg.duration_ms / 1000).toFixed(1)}s`
                            : `${msg.duration_ms}ms`}
                        </span>
                      ) : null}
                      {msg.role === "assistant" && msg.tokens_used && msg.duration_ms && msg.duration_ms > 0 ? (
                        <span className="text-[var(--accent-color)] font-medium">
                          {(msg.tokens_used / (msg.duration_ms / 1000)).toFixed(1)} tok/s
                        </span>
                      ) : null}
                    </div>
                    {/* Grounded sources for this message */}
                    {messageSources[msg.id] && messageSources[msg.id].length > 0 && (
                      <div className={`max-w-[75%] ${msg.role === "user" ? "self-end" : ""}`}>
                        <button
                          onClick={() => setExpandedSources(expandedSources === msg.id ? null : msg.id)}
                          className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                        >
                          <BookOpen size={10} />
                          {messageSources[msg.id].length} source{messageSources[msg.id].length !== 1 ? "s" : ""} used
                          {expandedSources === msg.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        </button>
                        {expandedSources === msg.id && (
                          <div className="mt-1.5 space-y-1">
                            {messageSources[msg.id].map((s, i) => (
                              <div key={s.id} className="rounded-lg p-2 bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[11px]">
                                <div className="font-medium text-[var(--text-secondary)]">[{i + 1}] {s.title}</div>
                                <div className="text-[var(--text-muted)] line-clamp-2 mt-0.5">{s.excerpt}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Follow-up suggestion pills */}
                    {msg.role === "assistant" && i === activeMessages.length - 1 && followUps.length > 0 && (
                      <div className="flex flex-col gap-1.5 mt-2 max-w-[75%]">
                        {followUps.map((q, j) => (
                          <button
                            key={j}
                            onClick={() => { setInput(q); inputRef.current?.focus(); }}
                            className="text-left px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}

            {/* Draft snapshot bubble — shown during refine phase */}
            {isRefiningPhase && draftSnapshot && (
              <div className="flex flex-col gap-1 items-start">
                <div className="max-w-[75%] break-words rounded-2xl px-4 py-2.5 text-sm message-assistant opacity-60 border border-amber-500/20">
                  <div className="flex items-center gap-1 mb-1 text-[10px] text-amber-400">
                    <Zap size={9} /> Draft ({draftModel})
                  </div>
                  <div className="prose prose-sm prose-invert max-w-none overflow-x-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{draftSnapshot}</ReactMarkdown>
                  </div>
                </div>
              </div>
            )}

            {/* Refining indicator — between draft done and first refine chunk */}
            {isRefiningPhase && !isCurrentlyRefining && (
              <div className="flex items-center gap-2 text-xs text-amber-400 px-1">
                <Zap size={11} className="animate-pulse" />
                <span className="animate-pulse">
                  {dualModelExecutionMode === "parallel" && isCurrentlyStreaming
                    ? `Refining in parallel with ${modelDisplayName(selectedModel)}…`
                    : `Refining with ${modelDisplayName(selectedModel)}…`}
                </span>
              </div>
            )}

            {/* Thinking indicator — spinner shown before the first token arrives */}
            {isStreaming && !isCurrentlyStreaming && !isRefiningPhase && (
              <div className="flex flex-col gap-1 items-start">
                <div className="flex items-center gap-2.5 max-w-[75%] rounded-2xl px-4 py-3 text-sm message-assistant">
                  <span className="flex gap-1 items-center">
                    <span
                      className="inline-block w-2 h-2 rounded-full bg-[var(--accent-color)] opacity-80"
                      style={{ animation: "thinking-dot 1.2s ease-in-out infinite" }}
                    />
                    <span
                      className="inline-block w-2 h-2 rounded-full bg-[var(--accent-color)] opacity-80"
                      style={{ animation: "thinking-dot 1.2s ease-in-out 0.2s infinite" }}
                    />
                    <span
                      className="inline-block w-2 h-2 rounded-full bg-[var(--accent-color)] opacity-80"
                      style={{ animation: "thinking-dot 1.2s ease-in-out 0.4s infinite" }}
                    />
                  </span>
                </div>
              </div>
            )}

            {/* Streaming bubble (draft phase or refine phase) */}
            {isCurrentlyStreaming && streamingContent && (
              <div className="flex flex-col gap-1 items-start">
                <div className="max-w-[75%] break-words rounded-2xl px-4 py-2.5 text-sm message-assistant">
                  {dualModelEnabled && draftModel && !isRefiningPhase && (
                    <div className="flex items-center gap-1 mb-1 text-[10px] text-amber-400">
                      <Zap size={9} /> Drafting with {modelDisplayName(draftModel)}…
                    </div>
                  )}
                  {isRefiningPhase && (
                    <div className="flex items-center gap-1 mb-1 text-[10px] text-[var(--accent-color)]">
                      <Zap size={9} /> Refining with {modelDisplayName(selectedModel)}…
                    </div>
                  )}
                  <div className="prose prose-sm prose-invert max-w-none overflow-x-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{streamingContent}</ReactMarkdown>
                  </div>
                  <span className="streaming-cursor" />
                </div>
              </div>
            )}

            {isCurrentlyRefining && (
              <div className="flex flex-col gap-1 items-start">
                <div className="max-w-[75%] break-words rounded-2xl px-4 py-2.5 text-sm message-assistant border border-[var(--accent-color)]/20">
                  <div className="flex items-center gap-1 mb-1 text-[10px] text-[var(--accent-color)]">
                    <Zap size={9} /> Refining with {modelDisplayName(selectedModel)}…
                  </div>
                  <div className="prose prose-sm prose-invert max-w-none overflow-x-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{refineStreamingContent}</ReactMarkdown>
                  </div>
                  <span className="streaming-cursor" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input / composer area */}
          <div className="px-4 pb-6 pt-2 bg-transparent flex flex-col items-center flex-shrink-0">
            <div className="w-full max-w-4xl min-w-0 flex flex-col bg-[var(--bg-elevated)]/80 border border-[var(--border-color)] rounded-2xl p-2.5 shadow-lg backdrop-blur-md">
              {activeTopicSignature && activeTopicSignature.domain_tags.length > 0 && (
                <div className="px-2 pt-1 pb-2">
                  <TopicChips
                    tags={activeTopicSignature.domain_tags}
                    onChipClick={(tag) => setInput(prev => `[${tag}] ${prev}`)}
                  />
                </div>
              )}

              <ComposerSuggestionRows
                rows={composerSuggestionRows}
                disabled={isStreaming}
                disableImmediateSend={!selectedModel || !effectiveWorkspaceId}
                onSuggestionClick={handleComposerSuggestion}
              />

              {/* Textarea + send button */}              <div className="flex items-end gap-2 px-1">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isStreaming}
                  placeholder={isStreaming ? "Waiting for response…" : !selectedModel ? "No models available — install one via ollama pull" : activeMessages.length > 0 ? "Message this Claude thread..." : "Start a new Claude thread..."}
                  rows={1}
                  className="flex-1 resize-none px-3 py-2 text-sm bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-colors max-h-40 overflow-y-auto"
                  style={{ minHeight: 40 }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = Math.min(el.scrollHeight, 160) + "px";
                  }}
                />
                {isStreaming ? (
                  <button
                    onClick={() => { if (activeChatId) {api.ollama.stopStream(activeChatId).catch(() => {});} }}
                    className="flex-shrink-0 rounded-full w-8 h-8 flex items-center justify-center bg-red-500 text-white hover:opacity-90 transition-opacity mb-1 mr-1"
                    title="Stop generation"
                  >
                    <X size={16} />
                  </button>
                ) : (
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim() || !selectedModel}
                    className="flex-shrink-0 rounded-full w-8 h-8 flex items-center justify-center bg-[var(--accent-color)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity mb-1 mr-1"
                  >
                    <ArrowUpCircle size={18} />
                  </button>
                )}
              </div>

              {/* ── Composer tool row ─────────────────────────────────────── */}
              <div className="flex items-center gap-1.5 mt-1 px-2 pb-1 flex-wrap">
              {quickSearchModels
                .filter((modelId) => aiModelList.some((model) => model.model_id === modelId && model.enabled))
                .map((modelId) => (
                  <button
                    key={modelId}
                    onClick={() => sendMessageWithModel(modelId)}
                    disabled={!input.trim() || isStreaming}
                    title={`Send with ${modelDisplayName(modelId)}`}
                    className={`${composerToggleBaseClass} ${composerToggleInactiveClass} disabled:opacity-40`}
                  >
                    <Globe size={13} />
                    <span>{modelDisplayName(modelId)}</span>
                  </button>
                ))}
              {/* Model picker */}
              <div className="relative max-w-[190px]">
                <select
                  value={selectedModel}
                  onChange={(e) => {
                    setSelectedModel(e.target.value);
                    persistModelChoice(e.target.value);
                  }}
                  className={`${topSelectClassName} max-w-[190px] bg-[var(--bg-primary)] text-[var(--text-primary)]`}
                  title="Active model"
                >
                  {availableModels.length > 0
                    ? availableModels.map((m) => <option key={m} value={m}>{modelDisplayName(m)}</option>)
                    : <option value={selectedModel}>{modelDisplayName(selectedModel)}</option>
                  }
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              </div>

              {/* Try better model */}
              {nextModel && !isStreaming && activeMessages.length > 0 && (
                <button
                  onClick={() => {
                    setSelectedModel(nextModel.model_id);
                    persistModelChoice(nextModel.model_id);
                    if (lastUserMessage) {setInput(lastUserMessage);}
                  }}
                  title={`Try ${modelDisplayName(nextModel.model_id)}`}
                  className={`${composerToggleBaseClass} ${composerToggleInactiveClass}`}
                >
                  <ArrowUpCircle size={13} />
                  <span>Try better</span>
                </button>
              )}

              {/* Dual-model toggle */}
              <button
                onClick={() => {
                  const newValue = !dualModelEnabled;
                  setDualModelEnabled(newValue);
                  persistSetting("dual_model_enabled", newValue);
                }}
                title={dualModelEnabled ? `Dual model ON — draft: ${draftModel || "(none)"} → refine: ${selectedModel}` : "Dual-model mode (draft + refine)"}
                className={`${composerToggleBaseClass} ${
                  dualModelEnabled
                    ? "border-amber-400/60 bg-amber-500/20 text-amber-200"
                    : composerToggleInactiveClass
                }`}
              >
                <Zap size={13} />
                <span>Dual</span>
              </button>

              <button
                onClick={() => setChatMode("compare")}
                title="Compare two models side by side"
                className={`${composerToggleBaseClass} ${composerToggleInactiveClass}`}
              >
                <SplitSquareHorizontal size={13} />
                <span>Compare</span>
              </button>

              {/* Draft model picker (only when dual is on) */}
              {dualModelEnabled && (
                <div className="relative max-w-[148px]">
                  <select
                    value={draftModel}
                    onChange={(e) => {
                      setDraftModel(e.target.value);
                      persistSetting("draft_model", e.target.value);
                    }}
                    title="Draft model (small/fast)"
                    className="h-8 w-full appearance-none rounded-full border border-amber-500/30 bg-amber-500/10 pl-3 pr-8 text-xs font-medium text-amber-300 outline-none transition-colors hover:border-amber-400/60 focus:border-amber-400/60"
                  >
                    <option value="">Draft…</option>
                    {availableModels.map((m) => (
                      <option key={m} value={m}>{modelDisplayName(m)}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-amber-300/80" />
                </div>
              )}

              {/* Grounded (RAG) toggle */}
              <button
                onClick={() => setGroundedEnabled((v) => !v)}
                title={groundedEnabled ? `Grounded ON (${processedDocCount} docs)` : "Grounded mode — use your documents as context (RAG)"}
                className={`relative ${composerToggleBaseClass} ${
                  groundedEnabled
                    ? "border-[var(--accent-color)] bg-[var(--accent-color)]/18 text-[var(--accent-color)]"
                    : composerToggleInactiveClass
                }`}
              >
                <BookOpen size={13} />
                <span>Docs</span>
                {groundedEnabled && processedDocCount > 0 && (
                  <span className="absolute -top-1 -right-1 text-[9px] bg-[var(--accent-color)] text-white rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
                    {processedDocCount > 9 ? "9+" : processedDocCount}
                  </span>
                )}
              </button>

              {/* Top-K picker (only when grounded is on) */}
              {groundedEnabled && (
                <div className="relative">
                  <select
                    value={groundedTopK}
                    onChange={(e) => setGroundedTopK(Number(e.target.value))}
                    className="h-8 appearance-none rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] pl-3 pr-8 text-xs font-medium text-[var(--text-secondary)] outline-none transition-colors hover:border-[var(--accent-color)] focus:border-[var(--accent-color)]"
                    title="Document chunks to retrieve"
                  >
                    {[3, 5, 8, 10].map((v) => <option key={v} value={v}>Top {v}</option>)}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                </div>
              )}

              {/* Thought queue toggle */}
              <button
                onClick={() => setThoughtPanelOpen((v) => !v)}
                title="Thought Queue — schedule follow-up questions to process in background"
                className={`relative ${composerToggleBaseClass} ${
                  thoughtPanelOpen
                    ? "border-[var(--accent-color)] bg-[var(--accent-color)]/18 text-[var(--accent-color)]"
                    : composerToggleInactiveClass
                }`}
              >
                <Inbox size={13} />
                <span>Queue</span>
                {(() => {
                  const pending = thoughts.filter((t) => t.status === "scheduled" || t.status === "processing").length;
                  return pending > 0 ? (
                    <span className="absolute -top-1 -right-1 text-[9px] bg-[var(--accent-color)] text-white rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
                      {pending > 9 ? "9+" : pending}
                    </span>
                  ) : null;
                })()}
              </button>

              {sessionTokensUsed > 0 && (
                <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[11px] text-[var(--text-secondary)]">
                  <span className="text-[var(--text-muted)]">Tokens</span>
                  <span className="font-mono text-[var(--text-primary)]">
                    {sessionTokensUsed >= 1000 ? `${(sessionTokensUsed / 1000).toFixed(1)}k` : sessionTokensUsed}
                  </span>
                </div>
              )}

            </div>
            </div>
            <div className="w-full max-w-4xl mt-3">
              <WorkspaceMigrationBanner />
            </div>
          </div>
        </div>
      )}

      {/* ── Thought Queue right panel ─────────────────────────────────────── */}
      {thoughtPanelOpen && (
        <div className="w-72 shrink-0 border-l border-[var(--border-color)] flex flex-col bg-[var(--bg-sidebar)] overflow-hidden">
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
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {submitThought();} }}
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
                  className={`rounded-lg border text-[11px] ${
                    t.status === "processing" ? "border-yellow-500/30 bg-yellow-500/5" :
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
                        <button onClick={() => processDueThought({ ...t, status: "scheduled" })} title="Process now" className="text-[var(--text-muted)] hover:text-[var(--accent-color)] transition-colors">
                          <Zap size={11} />
                        </button>
                      )}
                      {t.result && (
                        <button onClick={() => setThoughtExpandedId(thoughtExpandedId === t.id ? null : t.id)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                          {thoughtExpandedId === t.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        </button>
                      )}
                      <button onClick={async () => { await api.thoughtQueue.delete(t.id).catch(() => {}); setThoughts((prev) => prev.filter((x) => x.id !== t.id)); }} className="ml-auto text-[var(--text-muted)] hover:text-red-400 transition-colors">
                        <Trash2 size={11} />
                      </button>
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
      )}
      {/* External link confirmation dialog */}
      {pendingLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl shadow-xl max-w-sm w-full mx-4 p-5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Open External Link</h3>
            <p className="text-xs text-[var(--text-secondary)] mb-1">This will open in your browser:</p>
            <p className="text-xs text-[var(--accent-color)] break-all mb-4 font-mono">{pendingLink}</p>
            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={linkDontAsk}
                onChange={(e) => setLinkDontAsk(e.target.checked)}
                className="rounded border-[var(--border-color)] accent-[var(--accent-color)]"
              />
              <span className="text-xs text-[var(--text-secondary)]">Don&apos;t ask again</span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={cancelOpenLink}
                className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmOpenLink}
                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 transition-opacity"
              >
                Open Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
