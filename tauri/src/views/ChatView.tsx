import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import React, { useEffect, useRef, useState, useCallback, useMemo, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { Send, Plus, Trash2, ChevronDown, ChevronRight, ArrowUpCircle, Pencil, Check, Search, Pin, PinOff, MessageSquare, SplitSquareHorizontal, RefreshCw, BookOpen, FileText, ChevronUp, Zap, Inbox, Clock, CheckCircle2, Loader2, X, Globe, Folder, FolderPlus, Ghost, Shield, Save, MoreHorizontal, MoveRight, ExternalLink } from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { open } from "@tauri-apps/plugin-shell";
import { api, type AiModel, type OllamaModel, type SearchResult, type ThoughtItem, type AppSettings } from "../lib/api";
import { useChatStore, findUnusedSession } from "../stores/chatStore";
import { useArtifactStore } from "../stores/artifactStore";
import { useWorkspaceStore, type Project, type Workspace } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { ChatSession, Message } from "../stores/chatStore";
import ComposerSuggestionRows from "../components/ComposerSuggestionRows";
import { TopicChips } from "../components/TopicChips";
import { WorkspaceMigrationBanner } from "../components/WorkspaceMigrationBanner";
import ChatMessageBubble from "../components/ChatMessageBubble";
import ConvertChatModal, { type ConvertKind } from "../components/ConvertChatModal";
import { useScopedChat, useScopedProjects, useScopedWorkspace, useWorkspacePane } from "../lib/workspacePane";
import {
  buildChatSuggestionRow,
  buildWorkspaceSuggestionRow,
  mergeComposerInput,
  type ComposerSuggestion,
} from "../lib/composerSuggestions";
import { resolveChatTitle } from "../lib/chatTitles";
import { useTextSelectionToolbar } from "../hooks/useTextSelectionToolbar";
import { SelectionToolbar } from "../components/SelectionToolbar";

import type { ChatSubView } from "../components/navigationItems";

const MIN_SESSION_SIDEBAR_WIDTH = 220;
const MAX_SESSION_SIDEBAR_WIDTH = 420;

function clampSessionSidebarWidth(width: number) {
  return Math.max(MIN_SESSION_SIDEBAR_WIDTH, Math.min(width, MAX_SESSION_SIDEBAR_WIDTH));
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

// ── Session sidebar types ─────────────────────────────────────────────────────
interface SessionItemProps {
  session: ChatSession;
  activeChatId: string | null;
  selectMode: boolean;
  isSelected: boolean;
  depth?: number;
  renamingId: string | null;
  renameTitle: string;
  setRenamingId: (id: string | null) => void;
  setRenameTitle: (title: string) => void;
  openSession: (session: ChatSession) => void;
  toggleSelect: (id: string) => void;
  openContextMenu: (event: ReactMouseEvent, session: ChatSession) => void;
  renameSession: (id: string) => void;
}

interface SessionSidebarProps {
  sidebarSessions: ChatSession[];
  workspaces: Workspace[];
  projectsByWorkspace: Record<string, Project[]>;
  projects: Project[];
  activeProjectId: string | null;
  setActiveProjectId: (projectId: string | null) => void;
  activeProject: Project | null;
  moveSessionsToTarget: (sessionIds: string[], workspaceId: string, projectId: string | null) => Promise<void>;
  bulkDeleteSessions: (sessionIds: string[], projectIds?: string[]) => Promise<void>;
  renameProject: (projectId: string, name: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  moveProjectToWorkspace: (project: Project, targetWorkspaceId: string) => Promise<void>;
  createWorkspaceForMove: (name: string) => Promise<Workspace>;
  sessionQuery: string;
  setSessionQuery: (q: string) => void;
  creatingFolder: boolean;
  creatingFolderPending: boolean;
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
  refreshSessionTitle: (session: ChatSession) => void;
  togglePin: (session: ChatSession) => void;
  saveSession: (session: ChatSession) => void;
  deleteSession: (id: string) => void;
  showAlertDialog: (title: string, description: string, tone?: ConfirmDialogState["tone"]) => void;
}

function SessionItem({
  session, activeChatId, selectMode, isSelected, renamingId, renameTitle,
  depth = 0,
  setRenamingId, setRenameTitle, openSession,
  toggleSelect, openContextMenu,
  renameSession,
}: SessionItemProps) {
  const isSplitPane = useWorkspacePane() !== null;
  const isActive = activeChatId === session.id;
  const isRenaming = renamingId === session.id;

  const timeAgo = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const diff = Date.now() - new Date(session.updated_at).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) {return "now";}
    if (m < 60) {return `${m}m`;}
    const h = Math.floor(m / 60);
    if (h < 24) {return `${h}h`;}
    return `${Math.floor(h / 24)}d`;
  }, [session.updated_at]);

  return (
    <div
      draggable={!selectMode}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-chat-session-ids", JSON.stringify([session.id]));
        e.dataTransfer.effectAllowed = "move";
      }}
      onContextMenu={(e) => openContextMenu(e, session)}
      onClick={() => selectMode ? toggleSelect(session.id) : openSession(session)}
      className={`group flex min-w-0 items-center gap-1 px-3 py-2 cursor-pointer transition-colors ${
        isSelected
          ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
          : isActive
          ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
      }`}
      style={{ paddingLeft: `${12 + depth * 20}px` }}
    >
      {selectMode && (
        <button
          onClick={(e) => { e.stopPropagation(); toggleSelect(session.id); }}
          className={`mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
            isSelected
              ? "border-[var(--accent-color)] bg-[var(--accent-color)] text-white"
              : "border-[var(--text-muted)] text-transparent"
          }`}
        >
          <Check size={10} />
        </button>
      )}
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
          className={`min-w-0 flex-1 bg-[var(--bg-elevated)] border border-[var(--accent-color)] rounded px-1.5 py-0.5 text-[var(--text-primary)] outline-none ${
            isSplitPane ? "text-xs" : "text-[11px]"
          }`}
        />
      ) : (
        <div className="min-w-0 flex flex-1 items-center gap-1.5">
          <span className={`min-w-0 flex-1 truncate ${isSplitPane ? "text-sm" : "text-xs"}`}>{session.title || "New Chat"}</span>
          {session.is_incognito && <Ghost size={isSplitPane ? 12 : 11} className="text-purple-400 shrink-0" />}
          {!session.is_incognito && session.exclude_from_analytics && <Shield size={isSplitPane ? 12 : 11} className="text-sky-400 shrink-0" />}
        </div>
      )}
      <div className={`relative ml-1 shrink-0 ${isSplitPane ? "h-6 w-[132px]" : "h-5 w-[92px]"}`}>
        <div
          className={`absolute inset-y-0 right-0 flex items-center justify-end transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 ${
            isRenaming ? "opacity-0" : "opacity-100"
          }`}
        >
          <span className={`text-[var(--text-muted)] ${isSplitPane ? "text-[11px]" : "text-[10px]"}`}>
            {timeAgo}
          </span>
        </div>
        <div className="invisible absolute inset-y-0 right-0 flex items-center justify-end opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); openContextMenu(e, session); }}
            className={`rounded hover:text-[var(--accent-color)] transition-colors ${isSplitPane ? "p-1" : "p-0.5"}`}
            title="More actions"
          >
            <MoreHorizontal size={isSplitPane ? 12 : 10} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionSidebar({
  sidebarSessions, workspaces, projectsByWorkspace, projects, activeProjectId, setActiveProjectId,
  activeProject: _activeProject, moveSessionsToTarget, bulkDeleteSessions, renameProject, deleteProject, moveProjectToWorkspace, createWorkspaceForMove, sessionQuery, setSessionQuery,
  creatingFolder, setCreatingFolder, newFolderName, setNewFolderName,
  creatingFolderPending,
  folderInputRef, handleCreateFolder, createNewSession,
  activeChatId, renamingId, renameTitle, setRenamingId, setRenameTitle,
  setActiveChatId, renameSession, refreshSessionTitle, togglePin, saveSession, deleteSession, showAlertDialog,
}: SessionSidebarProps) {
  const isSplitPane = useWorkspacePane() !== null;
  const sidebarWidth = useSettingsStore((state) => state.sidebarWidth);
  const clampedSidebarWidth = clampSessionSidebarWidth(sidebarWidth);
  const messages = useChatStore((state) => state.messages);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [bulkMoveWorkspaceId, setBulkMoveWorkspaceId] = useState<string | null>(null);
  const [bulkActionPending, setBulkActionPending] = useState<"move" | "delete" | null>(null);
  const [projectRenamingId, setProjectRenamingId] = useState<string | null>(null);
  const [projectRenameValue, setProjectRenameValue] = useState("");
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);
  const [ctxMoveOpen, setCtxMoveOpen] = useState(false);
  const [ctxMoveWorkspaceId, setCtxMoveWorkspaceId] = useState<string | null>(null);
  const [ctxProjectMoveWorkspaceId, setCtxProjectMoveWorkspaceId] = useState<string | null>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [showNewWorkspaceInput, setShowNewWorkspaceInput] = useState(false);
  const [workspaceMoveQuery, setWorkspaceMoveQuery] = useState("");
  const [ctxMenu, setCtxMenu] = useState<
    | { type: "session"; x: number; y: number; session: ChatSession }
    | { type: "project"; x: number; y: number; project: Project }
    | null
  >(null);
  const [convertTarget, setConvertTarget] = useState<{ session: ChatSession; kind: ConvertKind } | null>(null);
  const ollamaUrl = useSettingsStore((s) => s.ollamaUrl);
  const navigate = useNavigate();
  const cancelCreateFolder = () => {
    setCreatingFolder(false);
    setNewFolderName("");
  };
  const visibleSessions = sidebarSessions;
  const byProject: Record<string, ChatSession[]> = {};
  const ungrouped: ChatSession[] = [];
  const [sidebarTooltip, setSidebarTooltip] = useState<{ label: string; top: number; left: number } | null>(null);
  const selectedCount = selectedIds.size + selectedProjectIds.size;

  const showSidebarTooltip = (label: string, e: ReactMouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setSidebarTooltip({
      label,
      top: rect.top + rect.height / 2,
      left: rect.right + 8,
    });
  };

  const hideSidebarTooltip = () => setSidebarTooltip(null);


  visibleSessions.forEach((session) => {
    if (session.project_id) {
      (byProject[session.project_id] ??= []).push(session);
    } else {
      ungrouped.push(session);
    }
  });

  const shouldShowWorkspaceSearch = workspaces.length > 12;
  const normalizedWorkspaceMoveQuery = workspaceMoveQuery.trim().toLowerCase();
  const filteredWorkspaces = normalizedWorkspaceMoveQuery
    ? workspaces.filter((workspace) => workspace.name.toLowerCase().includes(normalizedWorkspaceMoveQuery))
    : workspaces;

  function toggleProjectSelection(projectId: string) {
    const projectSessionIds = (byProject[projectId] ?? []).map((session) => session.id);
    const shouldSelect = !selectedProjectIds.has(projectId);

    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (shouldSelect) {
        next.add(projectId);
      } else {
        next.delete(projectId);
      }
      return next;
    });

    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const sessionId of projectSessionIds) {
        if (shouldSelect) {
          next.add(sessionId);
        } else {
          next.delete(sessionId);
        }
      }
      return next;
    });
  }

  function renderSessionList(items: ChatSession[], depth = 0) {
    if (items.length === 0) { return null; }
    return (
      <div className="flex min-w-0 flex-col">
        {items.map((session) => (
          <div key={session.id} className="pb-[2px]">
            <SessionItem
              session={session}
              activeChatId={activeChatId}
              isSelected={selectedIds.has(session.id)}
              selectMode={selectMode}
              toggleSelect={(id) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) {next.delete(id);} else {next.add(id);}
                  return next;
                });
              }}
              openContextMenu={(event, targetSession) => {
                event.preventDefault();
                event.stopPropagation();
                setCtxMenu({ type: "session", x: event.clientX, y: event.clientY, session: targetSession });
              }}
              renameSession={renameSession}
              renamingId={renamingId}
              renameTitle={renameTitle}
              setRenamingId={setRenamingId}
              setRenameTitle={setRenameTitle}
              openSession={(targetSession) => {
                setActiveProjectId(targetSession.project_id || null);
                setActiveChatId(targetSession.id);
                api.chat.touchSessionAccessed(targetSession.id).catch(() => {});
              }}
              depth={depth}
            />
          </div>
        ))}
      </div>
    );
  }

  function resetSelectionState() {
    setSelectMode(false);
    setSelectedIds(new Set());
    setSelectedProjectIds(new Set());
    setMoveMenuOpen(false);
    setBulkMoveWorkspaceId(null);
    setDragOverProjectId(null);
    setCtxMoveOpen(false);
    setCtxMoveWorkspaceId(null);
    setCtxProjectMoveWorkspaceId(null);
    setShowNewWorkspaceInput(false);
    setNewWorkspaceName("");
  }

  async function handleProjectDrop(event: React.DragEvent, project: Project) {
    event.preventDefault();
    event.stopPropagation();
    setDragOverProjectId(null);

    const raw = event.dataTransfer.getData("application/x-chat-session-ids");
    if (!raw) {
      return;
    }

    try {
      const sessionIds = JSON.parse(raw) as string[];
      const sessionsToMove = sessionIds.filter((sessionId) => {
        const session = sidebarSessions.find((item) => item.id === sessionId);
        return session && session.project_id !== project.id;
      });

      if (sessionsToMove.length === 0) {
        return;
      }

      await moveSessionsToTarget(sessionsToMove, project.workspace_id, project.id);
      setActiveProjectId(project.id);
      setExpanded((prev) => ({ ...prev, [project.id]: true }));
    } catch (error) {
      console.error("Failed to drop chat into folder:", error);
    }
  }

  function renderSessionMoveSubmenu(
    onSelect: (workspaceId: string, projectId: string | null) => void,
  ) {
    function handleCreateWorkspace() {
      const name = newWorkspaceName.trim();
      if (!name) {return;}
      setShowNewWorkspaceInput(false);
      setNewWorkspaceName("");
      void createWorkspaceForMove(name)
        .then((workspace) => onSelect(workspace.id, null))
        .catch((error) => {
          const description = error instanceof Error
            ? error.message
            : typeof error === "string" && error.trim()
              ? error
              : "Failed to create workspace.";
          showAlertDialog("Create workspace failed", description, "danger");
        });
    }

    return (
      <div className="absolute left-full top-0 z-30 ml-1 min-w-[180px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] backdrop-blur-xl shadow-lg">
        <div className="max-h-[min(28rem,calc(100vh-32px))] overflow-y-auto py-1">
          {shouldShowWorkspaceSearch && !showNewWorkspaceInput && (
            <div className="px-2 pb-2">
              <input
                value={workspaceMoveQuery}
                onChange={(e) => setWorkspaceMoveQuery(e.target.value)}
                placeholder="Search workspaces..."
                className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
              />
            </div>
          )}
          {showNewWorkspaceInput ? (
            <form
              onSubmit={(e) => { e.preventDefault(); handleCreateWorkspace(); }}
              className="px-2 py-1"
            >
              <input
                autoFocus
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setShowNewWorkspaceInput(false); setNewWorkspaceName(""); } }}
                placeholder="Workspace name"
                className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
              />
            </form>
          ) : (
            <button
              onClick={() => setShowNewWorkspaceInput(true)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <Plus size={11} /> Create workspace...
            </button>
          )}
          <div className="my-1 border-t border-[var(--border-color)]" />
          {filteredWorkspaces.map((workspace) => {
            const workspaceProjects = projectsByWorkspace[workspace.id] ?? [];
            const hasProjects = workspaceProjects.length > 0;
            return (
              <div
                key={workspace.id}
                className="relative"
                onMouseEnter={() => setCtxMoveWorkspaceId(hasProjects ? workspace.id : null)}
              >
                <button
                  onClick={() => {
                    if (!hasProjects) {
                      onSelect(workspace.id, null);
                      return;
                    }
                    setCtxMoveWorkspaceId((current) => current === workspace.id ? null : workspace.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  <span className="truncate flex-1">{workspace.name}</span>
                  {hasProjects && <ChevronRight size={11} />}
                </button>
                {hasProjects && ctxMoveWorkspaceId === workspace.id && (
                  <div className="absolute left-full top-0 z-30 ml-1 min-w-[180px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] backdrop-blur-xl py-1 shadow-lg">
                    <button
                      onClick={() => onSelect(workspace.id, null)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    >
                      <MessageSquare size={11} /> Workspace root
                    </button>
                    {workspaceProjects.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => onSelect(workspace.id, project.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      >
                        <Folder size={11} /> <span className="truncate">{project.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {filteredWorkspaces.length === 0 && (
            <p className="px-3 py-2 text-xs text-[var(--text-muted)]">No matching workspaces.</p>
          )}
        </div>
      </div>
    );
  }

  function renderProjectWorkspaceMoveSubmenu(
    project: Project,
    onSelect: (workspaceId: string) => void,
  ) {
    function handleCreateWorkspace() {
      const name = newWorkspaceName.trim();
      if (!name) {return;}
      setShowNewWorkspaceInput(false);
      setNewWorkspaceName("");
      setCtxProjectMoveWorkspaceId(null);
      setCtxMenu(null);
      void createWorkspaceForMove(name)
        .then((workspace) => moveProjectToWorkspace(project, workspace.id))
        .catch((error) => {
          const description = error instanceof Error
            ? error.message
            : typeof error === "string" && error.trim()
              ? error
              : "Failed to move to new workspace.";
          showAlertDialog("Move to new workspace failed", description, "danger");
        });
    }

    return (
      <div className="absolute left-full top-0 z-30 ml-1 min-w-[180px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] backdrop-blur-xl shadow-lg">
        <div className="max-h-[min(28rem,calc(100vh-32px))] overflow-y-auto py-1">
          {shouldShowWorkspaceSearch && !showNewWorkspaceInput && (
            <div className="px-2 pb-2">
              <input
                value={workspaceMoveQuery}
                onChange={(e) => setWorkspaceMoveQuery(e.target.value)}
                placeholder="Search workspaces..."
                className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
              />
            </div>
          )}
          {showNewWorkspaceInput ? (
            <form
              onSubmit={(e) => { e.preventDefault(); handleCreateWorkspace(); }}
              className="px-2 py-1"
            >
              <input
                autoFocus
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setShowNewWorkspaceInput(false); setNewWorkspaceName(""); } }}
                placeholder="Workspace name"
                className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
              />
            </form>
          ) : (
            <button
              onClick={() => setShowNewWorkspaceInput(true)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <Plus size={11} /> Create workspace...
            </button>
          )}
          <div className="my-1 border-t border-[var(--border-color)]" />
          {filteredWorkspaces.map((workspace) => {
            const isCurrentWorkspace = workspace.id === project.workspace_id;
            return (
              <button
                key={workspace.id}
                onClick={() => onSelect(workspace.id)}
                disabled={isCurrentWorkspace}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="truncate flex-1">
                  {workspace.name}
                  {isCurrentWorkspace ? " (Current)" : ""}
                </span>
              </button>
            );
          })}
          {filteredWorkspaces.length === 0 && (
            <p className="px-3 py-2 text-xs text-[var(--text-muted)]">No matching workspaces.</p>
          )}
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (!ctxMenu) {return;}

    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-chat-tree-context-menu]")) {return;}
      setCtxMenu(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCtxMenu(null);
      }
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [ctxMenu]);

  return (
    <>
    <div
      className="relative z-10 flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-[var(--border-color)] bg-[var(--bg-sidebar)]"
      style={{
        flexBasis: `${clampedSidebarWidth}px`,
        width: `${clampedSidebarWidth}px`,
        minWidth: `${clampedSidebarWidth}px`,
        maxWidth: `${clampedSidebarWidth}px`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-1 border-b border-[var(--border-color)] px-3 py-2">
        <span className={`truncate font-medium text-[var(--text-secondary)] ${isSplitPane ? "text-sm" : "text-xs"}`}>
          Conversations
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => {
              hideSidebarTooltip();
              setSelectMode((value) => !value);
            }}
            onMouseEnter={(e) => showSidebarTooltip("Select items", e)}
            onMouseLeave={hideSidebarTooltip}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ${
              selectMode ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""
            }`}
            aria-label="Select items"
          >
            <Check size={12} />
          </button>
          <button
            onClick={() => {
              hideSidebarTooltip();
              setCreatingFolder(true);
              setNewFolderName("");
            }}
            onMouseEnter={(e) => showSidebarTooltip("New folder", e)}
            onMouseLeave={hideSidebarTooltip}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="New folder"
          >
            <FolderPlus size={12} />
          </button>
          <button
            onClick={() => {
              hideSidebarTooltip();
              createNewSession();
            }}
            onMouseEnter={(e) => showSidebarTooltip("New chat", e)}
            onMouseLeave={hideSidebarTooltip}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="New chat"
          >
            <Plus size={12} />
          </button>
          <button
            onClick={() => {
              hideSidebarTooltip();
              createNewSession({ isIncognito: true });
            }}
            onMouseEnter={(e) => showSidebarTooltip("New incognito chat", e)}
            onMouseLeave={hideSidebarTooltip}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-purple-500/10 hover:text-purple-400"
            aria-label="New incognito chat"
          >
            <Ghost size={12} />
          </button>
          <button
            onClick={() => {
              hideSidebarTooltip();
              createNewSession({ excludeFromAnalytics: true });
            }}
            onMouseEnter={(e) => showSidebarTooltip("New private chat", e)}
            onMouseLeave={hideSidebarTooltip}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-sky-500/10 hover:text-sky-400"
            aria-label="New private chat"
          >
            <Shield size={12} />
          </button>
        </div>
      </div>

      {selectMode && (
        <div className="px-2 py-1.5 border-b border-[var(--border-color)]">
          <div className="flex flex-wrap items-center gap-1">
            <div className="relative">
              <button
                onClick={() => setMoveMenuOpen((value) => !value)}
                disabled={selectedIds.size === 0 || bulkActionPending !== null}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[var(--text-muted)] transition-colors ${isSplitPane ? "text-xs" : "text-[11px]"} hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-30`}
                title="Move selected chats"
              >
                <MoveRight size={12} />
                {bulkActionPending === "move" ? "Moving..." : "Move"}
              </button>
              {moveMenuOpen && bulkActionPending === null && (
                <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] backdrop-blur-xl shadow-lg">
                  <div className="max-h-[min(28rem,calc(100vh-32px))] overflow-y-auto py-1">
                    {shouldShowWorkspaceSearch && !showNewWorkspaceInput && (
                      <div className="px-2 pb-2">
                        <input
                          value={workspaceMoveQuery}
                          onChange={(e) => setWorkspaceMoveQuery(e.target.value)}
                          placeholder="Search workspaces..."
                          className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                        />
                      </div>
                    )}
                    {showNewWorkspaceInput ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const name = newWorkspaceName.trim();
                          if (!name) {return;}
                          setShowNewWorkspaceInput(false);
                          setNewWorkspaceName("");
                          void createWorkspaceForMove(name)
                            .then((workspace) => {
                              setBulkActionPending("move");
                              void moveSessionsToTarget(Array.from(selectedIds), workspace.id, null).then(() => {
                                resetSelectionState();
                              }).finally(() => {
                                setBulkActionPending(null);
                              });
                            })
                            .catch((error) => {
                              const description = error instanceof Error
                                ? error.message
                                : typeof error === "string" && error.trim()
                                  ? error
                                  : "Failed to create workspace.";
                              showAlertDialog("Create workspace failed", description, "danger");
                            });
                        }}
                        className="px-2 py-1"
                      >
                        <input
                          autoFocus
                          value={newWorkspaceName}
                          onChange={(e) => setNewWorkspaceName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Escape") { setShowNewWorkspaceInput(false); setNewWorkspaceName(""); } }}
                          placeholder="Workspace name"
                          className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                        />
                      </form>
                    ) : (
                      <button
                        onClick={() => setShowNewWorkspaceInput(true)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      >
                        <Plus size={11} /> Create workspace...
                      </button>
                    )}
                    <div className="my-1 border-t border-[var(--border-color)]" />
                    {filteredWorkspaces.map((workspace) => {
                      const workspaceProjects = projectsByWorkspace[workspace.id] ?? [];
                      const hasProjects = workspaceProjects.length > 0;
                      return (
                        <div
                          key={workspace.id}
                          className="relative"
                          onMouseEnter={() => setBulkMoveWorkspaceId(hasProjects ? workspace.id : null)}
                        >
                          <button
                            onClick={() => {
                              if (!hasProjects) {
                                setBulkActionPending("move");
                                void moveSessionsToTarget(Array.from(selectedIds), workspace.id, null).then(() => {
                                  resetSelectionState();
                                }).finally(() => {
                                  setBulkActionPending(null);
                                });
                                return;
                              }
                              setBulkMoveWorkspaceId((current) => current === workspace.id ? null : workspace.id);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                          >
                            <span className="truncate flex-1">{workspace.name}</span>
                            {hasProjects && <ChevronRight size={11} />}
                          </button>
                          {hasProjects && bulkMoveWorkspaceId === workspace.id && (
                            <div className="absolute left-full top-0 z-30 ml-1 min-w-[180px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] backdrop-blur-xl py-1 shadow-lg">
                              <button
                                onClick={() => {
                                  setBulkActionPending("move");
                                  void moveSessionsToTarget(Array.from(selectedIds), workspace.id, null).then(() => {
                                    resetSelectionState();
                                  }).finally(() => {
                                    setBulkActionPending(null);
                                  });
                                }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                              >
                                <MessageSquare size={11} /> Workspace root
                              </button>
                              {workspaceProjects.map((project) => (
                                <button
                                  key={project.id}
                                  onClick={() => {
                                    setBulkActionPending("move");
                                    void moveSessionsToTarget(Array.from(selectedIds), workspace.id, project.id).then(() => {
                                      resetSelectionState();
                                    }).finally(() => {
                                      setBulkActionPending(null);
                                    });
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                >
                                  <Folder size={11} /> <span className="truncate">{project.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {filteredWorkspaces.length === 0 && (
                      <p className="px-3 py-2 text-xs text-[var(--text-muted)]">No matching workspaces.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => {
                setBulkActionPending("delete");
                void bulkDeleteSessions(Array.from(selectedIds), Array.from(selectedProjectIds)).then(() => {
                  resetSelectionState();
                }).finally(() => {
                  setBulkActionPending(null);
                });
              }}
              disabled={selectedCount === 0 || bulkActionPending !== null}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-red-400 transition-colors ${isSplitPane ? "text-xs" : "text-[11px]"} hover:bg-[var(--bg-hover)] disabled:opacity-30`}
              title="Delete selected items"
            >
              <Trash2 size={12} />
              {bulkActionPending === "delete" ? "Deleting..." : "Delete"}
            </button>
            <button
              onClick={() => {
                resetSelectionState();
              }}
              disabled={bulkActionPending !== null}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[var(--text-muted)] transition-colors ${isSplitPane ? "text-xs" : "text-[11px]"} hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-30`}
              title="Exit selection mode"
            >
              <X size={12} />
              Cancel
            </button>
            <span className={`ml-auto text-[var(--text-muted)] ${isSplitPane ? "text-xs" : "text-[11px]"}`}>
              {selectedCount} selected
            </span>
          </div>
        </div>
      )}

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
            disabled={creatingFolderPending}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (creatingFolderPending) {
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                void handleCreateFolder(e.currentTarget.value);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                cancelCreateFolder();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder="Folder name…"
            className={`flex-1 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded px-1.5 py-0.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] disabled:cursor-wait disabled:opacity-70 ${isSplitPane ? "text-xs" : "text-[11px]"}`}
          />
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handleCreateFolder(folderInputRef.current?.value)}
            disabled={creatingFolderPending}
            className="p-1 rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors disabled:cursor-wait disabled:opacity-50"
            title="Create folder"
          >
            {creatingFolderPending ? (
              <Loader2 size={isSplitPane ? 13 : 12} className="animate-spin" />
            ) : (
              <Check size={isSplitPane ? 13 : 12} />
            )}
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={cancelCreateFolder}
            disabled={creatingFolderPending}
            className="p-1 rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            title="Cancel folder creation"
          >
            <X size={isSplitPane ? 13 : 12} />
          </button>
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {visibleSessions.length === 0 && projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-3">
            <MessageSquare size={isSplitPane ? 22 : 20} className="text-[var(--text-muted)] opacity-30" />
            <p className={`text-[var(--text-muted)] ${isSplitPane ? "text-xs" : "text-[11px]"}`}>No conversations yet</p>
          </div>
        ) : sessionQuery.trim() && visibleSessions.length === 0 ? (
          <p className={`px-3 py-4 text-[var(--text-muted)] text-center ${isSplitPane ? "text-xs" : "text-[11px]"}`}>No matches</p>
        ) : (
          <>
            {ungrouped.length > 0 && (
              renderSessionList(ungrouped)
            )}
            {projects.map((project) => {
              const projectSessions = byProject[project.id] ?? [];
              const isOpen = expanded[project.id] ?? true;
              return (
                <div key={project.id}>
                  <button
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setCtxMenu({ type: "project", x: event.clientX, y: event.clientY, project });
                    }}
                    onDragOver={(event) => {
                      if (selectMode || !event.dataTransfer.types.includes("application/x-chat-session-ids")) {
                        return;
                      }
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverProjectId(project.id);
                    }}
                    onDragLeave={(event) => {
                      const relatedTarget = event.relatedTarget as Node | null;
                      if (relatedTarget && event.currentTarget.contains(relatedTarget)) {
                        return;
                      }
                      setDragOverProjectId((current) => current === project.id ? null : current);
                    }}
                    onDrop={(event) => {
                      void handleProjectDrop(event, project);
                    }}
                    onClick={() => {
                      if (selectMode) {
                        toggleProjectSelection(project.id);
                        return;
                      }
                      setActiveProjectId(project.id);
                      if (activeProjectId === project.id) {
                        setExpanded((prev) => ({ ...prev, [project.id]: !isOpen }));
                      }
                    }}
                    className={`w-full flex items-center gap-1.5 px-3 py-2 text-left transition-colors ${
                      dragOverProjectId === project.id
                        ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)] ring-1 ring-inset ring-[var(--accent-color)]"
                        : selectedProjectIds.has(project.id)
                        ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                        : activeProjectId === project.id
                        ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {selectMode && (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleProjectSelection(project.id);
                        }}
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                          selectedProjectIds.has(project.id)
                            ? "border-[var(--accent-color)] bg-[var(--accent-color)] text-white"
                            : "border-[var(--text-muted)] text-transparent"
                        }`}
                      >
                        <Check size={10} />
                      </button>
                    )}
                    <Folder size={isSplitPane ? 14 : 13} className="text-[var(--text-muted)] shrink-0" />
                    {projectRenamingId === project.id ? (
                      <input
                        autoFocus
                        value={projectRenameValue}
                        onChange={(event) => setProjectRenameValue(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void renameProject(project.id, projectRenameValue).then(() => {
                              setProjectRenamingId(null);
                              setProjectRenameValue("");
                            });
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setProjectRenamingId(null);
                            setProjectRenameValue("");
                          }
                        }}
                        onBlur={() => {
                          void renameProject(project.id, projectRenameValue).then(() => {
                            setProjectRenamingId(null);
                            setProjectRenameValue("");
                          });
                        }}
                        className={`flex-1 rounded border border-[var(--accent-color)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-primary)] outline-none ${isSplitPane ? "text-sm" : "text-xs"}`}
                      />
                    ) : (
                      <span className={`flex-1 truncate ${isSplitPane ? "text-sm" : "text-xs"}`}>{project.name}</span>
                    )}
                    <ChevronDown size={12} className={`text-[var(--text-muted)] transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                  </button>
                  {isOpen && (
                    <div className="ml-3 border-l border-[var(--border-color)]/70">
                      {renderSessionList(projectSessions, 1)}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {sidebarTooltip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] shadow-lg"
          style={{ top: sidebarTooltip.top, left: sidebarTooltip.left }}
        >
          {sidebarTooltip.label}
        </div>
      )}

      {/* Footer stats */}
      {sidebarSessions.length > 0 && (
        <div className="px-3 py-1.5 border-t border-[var(--border-color)] shrink-0">
          <p className={`text-[var(--text-muted)] ${isSplitPane ? "text-[11px]" : "text-[10px]"}`}>
            {sidebarSessions.length} session{sidebarSessions.length !== 1 ? "s" : ""}{sidebarSessions.some((session) => session.is_pinned) ? ` · ${sidebarSessions.filter((session) => session.is_pinned).length} pinned` : ""}
          </p>
        </div>
      )}

      {ctxMenu && (
        <div
          data-chat-tree-context-menu
          className="fixed z-50 min-w-[180px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-xl"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {ctxMenu.type === "session" ? (
            <>
              <button
                onClick={() => {
                  setActiveChatId(ctxMenu.session.id);
                  api.chat.touchSessionAccessed(ctxMenu.session.id).catch(() => {});
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <ExternalLink size={11} /> Open chat
              </button>
              <button
                onClick={() => {
                  setRenamingId(ctxMenu.session.id);
                  setRenameTitle(ctxMenu.session.title);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <Pencil size={11} /> Rename
              </button>
              <button
                onClick={() => {
                  if (canRefreshSessionTitle(ctxMenu.session, messages)) {
                    void refreshSessionTitle(ctxMenu.session);
                  }
                  setCtxMenu(null);
                }}
                disabled={!canRefreshSessionTitle(ctxMenu.session, messages)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                  canRefreshSessionTitle(ctxMenu.session, messages)
                    ? "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    : "cursor-not-allowed text-[var(--text-muted)] opacity-40"
                }`}
              >
                <RefreshCw size={11} /> Refresh chat name
              </button>
              <button
                onClick={() => {
                  void saveSession(ctxMenu.session);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <Save size={11} /> Save chat
              </button>
              <button
                onClick={() => {
                  void api.chatFile.reveal(ctxMenu.session.id).catch((error) => {
                    const description = error instanceof Error
                      ? error.message
                      : typeof error === "string" && error.trim()
                        ? error
                        : "Failed to reveal chat file.";
                    console.error("Failed to reveal chat file:", error);
                    showAlertDialog("Show in Explorer failed", description, "danger");
                  });
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <ExternalLink size={11} /> Show in Explorer
              </button>
              <button
                onClick={() => {
                  void togglePin(ctxMenu.session);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                {ctxMenu.session.is_pinned ? <PinOff size={11} /> : <Pin size={11} />}
                {ctxMenu.session.is_pinned ? "Unpin" : "Pin"}
              </button>
              <button
                onClick={() => {
                  setConvertTarget({ session: ctxMenu.session, kind: "note" });
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <FileText size={11} /> Convert to note
              </button>
              <button
                onClick={() => {
                  setConvertTarget({ session: ctxMenu.session, kind: "document" });
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <BookOpen size={11} /> Convert to document
              </button>
              <div className="my-1 border-t border-[var(--border-color)]" />
              <div
                className="relative"
                onMouseEnter={() => setCtxMoveOpen(true)}
                onMouseLeave={() => { setCtxMoveOpen(false); setCtxMoveWorkspaceId(null); }}
              >
                <button
                  onClick={() => setCtxMoveOpen((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  <MoveRight size={11} />
                  <span className="truncate flex-1">Move to</span>
                  <ChevronRight size={11} />
                </button>
                {ctxMoveOpen && renderSessionMoveSubmenu((targetWorkspaceId, targetProjectId) => {
                  void moveSessionsToTarget([ctxMenu.session.id], targetWorkspaceId, targetProjectId).catch((error) => {
                    const description = error instanceof Error
                      ? error.message
                      : typeof error === "string" && error.trim()
                        ? error
                        : "Failed to move chat.";
                    console.error("Failed to move chat:", error);
                    showAlertDialog("Move failed", description, "danger");
                  });
                  setCtxMoveWorkspaceId(null);
                  setCtxMoveOpen(false);
                  setCtxMenu(null);
                })}
              </div>
              <div className="my-1 border-t border-[var(--border-color)]" />
              <button
                onClick={() => {
                  void deleteSession(ctxMenu.session.id);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-[var(--bg-hover)]"
              >
                <Trash2 size={11} /> Delete
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setActiveProjectId(ctxMenu.project.id);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <ExternalLink size={11} /> Open folder
              </button>
              <button
                onClick={() => {
                  setProjectRenamingId(ctxMenu.project.id);
                  setProjectRenameValue(ctxMenu.project.name);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <Pencil size={11} /> Rename folder
              </button>
              <div className="my-1 border-t border-[var(--border-color)]" />
              <div
                className="relative"
                onMouseEnter={() => setCtxProjectMoveWorkspaceId("open")}
                onMouseLeave={() => setCtxProjectMoveWorkspaceId(null)}
              >
                <button
                  onClick={() => setCtxProjectMoveWorkspaceId((current) => current === "open" ? null : "open")}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  <MoveRight size={11} />
                  <span className="truncate flex-1">Move to workspace</span>
                  <ChevronRight size={11} />
                </button>
                {ctxProjectMoveWorkspaceId === "open" && (() => {
                  const project = ctxMenu.project;
                  return renderProjectWorkspaceMoveSubmenu(project, (targetWorkspaceId) => {
                    setCtxProjectMoveWorkspaceId(null);
                    setCtxMenu(null);
                    void moveProjectToWorkspace(project, targetWorkspaceId);
                  });
                })()}
              </div>
              <button
                onClick={() => {
                  void deleteProject(ctxMenu.project.id);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-[var(--bg-hover)]"
              >
                <Trash2 size={11} /> Delete folder
              </button>
            </>
          )}
        </div>
      )}
    </div>
    {convertTarget && (
      <ConvertChatModal
        session={convertTarget.session}
        kind={convertTarget.kind}
        ollamaUrl={ollamaUrl}
        onClose={() => setConvertTarget(null)}
        onSuccess={(kind) => {
          if (kind === "note") {
            navigate("/notes");
          } else {
            navigate("/documents");
          }
        }}
      />
    )}
    </>
  );
}

function _formatMessageTimestamp(value: string) {
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
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${base || "chat"}.json`;
}

function _splitAssistantMessage(content: string) {
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

function StreamingBubble({
  activeChatId,
  chatMessageStyle,
  expandChatToWindowWidth,
}: {
  activeChatId: string | null;
  chatMessageStyle: string;
  expandChatToWindowWidth: boolean;
}) {
  const streamingSessionId = useChatStore((s) => s.streamingSessionId);
  const isCurrentlyStreaming = activeChatId ? streamingSessionId === activeChatId : false;

  // Direct DOM updates via rAF — avoids React reconciliation on every token.
  const textRef = useRef<HTMLParagraphElement>(null);
  const rafRef = useRef(0);
  const visibleRef = useRef(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isCurrentlyStreaming) {
      visibleRef.current = false;
      return;
    }
    const unsub = useChatStore.subscribe((state) => {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (textRef.current) {
          textRef.current.textContent = state.streamingContent;
        }
        if (state.streamingContent && !visibleRef.current) {
          visibleRef.current = true;
          setVisible(true);
        }
      });
    });
    return () => {
      unsub();
      window.cancelAnimationFrame(rafRef.current);
      setVisible(false);
      visibleRef.current = false;
    };
  }, [isCurrentlyStreaming]);

  if (!isCurrentlyStreaming || !visible) { return null; }

  return (
    <div className="flex flex-col gap-1 items-start px-4 pb-4">
      <div className={`${expandChatToWindowWidth ? "max-w-[90%]" : "max-w-[75%]"} break-words rounded-2xl px-4 py-2.5 text-sm message-assistant ${
        chatMessageStyle === "flat"
          ? "border border-[var(--border-color)] bg-[var(--bg-elevated)]"
          : ""
      }`}>
        <p ref={textRef} className="whitespace-pre-wrap" />
        <span className="streaming-cursor" />
      </div>
    </div>
  );
}

export default function ChatView() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId: routeSessionId } = useParams();

  const sessions = useChatStore((s) => s.sessions);
  const messages = useChatStore((s) => s.messages);
  const setSessions = useChatStore((s) => s.setSessions);
  const setMessages = useChatStore((s) => s.setMessages);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const appendStreamChunk = useChatStore((s) => s.appendStreamChunk);
  const finalizeStream = useChatStore((s) => s.finalizeStream);
  const streamingSessionId = useChatStore((s) => s.streamingSessionId);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const { activeChatId, setActiveChatId } = useScopedChat();

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setProjectsForWorkspace = useWorkspaceStore((s) => s.setProjectsForWorkspace);
  const projectsByWorkspace = useWorkspaceStore((s) => s.projectsByWorkspace);
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const {
    activeProjectId: scopedProjectId,
    setActiveWorkspaceId: setScopedWorkspaceId,
    setActiveProjectId: setScopedProjectId,
    activeWorkspaceId: scopedWorkspaceId,
  } = useScopedWorkspace();
  const activeTopicSignature = useWorkspaceStore((s) => s.activeTopicSignature);
  const setActiveTopicSignature = useWorkspaceStore((s) => s.setActiveTopicSignature);
  const setWorkspaceTopicSignature = useWorkspaceStore((s) => s.setWorkspaceTopicSignature);
  const setMigrationSuggestion = useWorkspaceStore((s) => s.setMigrationSuggestion);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const projects = useScopedProjects();
  const preferredModel = useSettingsStore((s) => s.preferredModel);
  const setPreferredModel = useSettingsStore((s) => s.setPreferredModel);
  const ollamaUrl = useSettingsStore((s) => s.ollamaUrl);
  const savedCompareA = useSettingsStore((s) => s.compareModelA);
  const savedCompareB = useSettingsStore((s) => s.compareModelB);
  const saveCompareA = useSettingsStore((s) => s.setCompareModelA);
  const saveCompareB = useSettingsStore((s) => s.setCompareModelB);
  const modelLabels = useSettingsStore((s) => s.modelLabels);
  const quickSearchModels = useSettingsStore((s) => s.quickSearchModels);
  const skipLinkConfirm = useSettingsStore((s) => s.skipLinkConfirm);
  const setSkipLinkConfirm = useSettingsStore((s) => s.setSkipLinkConfirm);
  const showGenInfo = useSettingsStore((s) => s.showGenInfo);
  const scrollToTopOnSend = useSettingsStore((s) => s.scrollToTopOnSend);
  const chatMessageStyle = useSettingsStore((s) => s.chatMessageStyle);
  const expandChatToWindowWidth = useSettingsStore((s) => s.expandChatToWindowWidth);
  const setSidebarWidth = useSettingsStore((state) => state.setSidebarWidth);
  const modelRefreshCounter = useSettingsStore((s) => s.modelRefreshCounter);
  const composerSelectClassName = "h-10 w-full appearance-none rounded-full border border-[rgba(var(--accent-color-rgb),0.16)] bg-[rgba(255,255,255,0.02)] pl-4 pr-10 text-[12px] font-semibold tracking-[0.01em] text-[rgba(255,255,255,0.9)] shadow-[0_12px_30px_-22px_rgba(0,0,0,0.95)] outline-none transition-all hover:border-[rgba(var(--accent-color-rgb),0.34)] hover:bg-[rgba(var(--accent-color-rgb),0.05)] focus:border-[rgba(var(--accent-color-rgb),0.42)] focus:bg-[rgba(var(--accent-color-rgb),0.06)]";
  const composerToggleBaseClass = "inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-[12px] font-semibold tracking-[0.01em] shadow-[0_12px_30px_-22px_rgba(0,0,0,0.95)] transition-all";
  const composerToggleInactiveClass = "border-[rgba(var(--accent-color-rgb),0.16)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.78)] hover:border-[rgba(var(--accent-color-rgb),0.34)] hover:bg-[rgba(var(--accent-color-rgb),0.05)] hover:text-white";
  const composerToggleActiveClass = "border-[rgba(var(--accent-color-rgb),0.34)] bg-[rgba(var(--accent-color-rgb),0.12)] text-[rgba(255,255,255,0.96)]";
  const composerUtilitySelectClassName = "h-9 appearance-none rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)]/75 pl-3.5 pr-9 text-xs font-semibold text-[var(--text-secondary)] shadow-sm outline-none transition-all hover:border-[var(--accent-color)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)] focus:border-[var(--accent-color)]";

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarSessions, setSidebarSessions] = useState<ChatSession[]>([]);
  const [selectedModel, setSelectedModel] = useState(preferredModel || "");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [ollamaModelStatus, setOllamaModelStatus] = useState<"idle" | "available" | "empty" | "unreachable">("idle");
  const [aiModelList, setAiModelList] = useState<AiModel[]>([]);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [isModelSendMenuOpen, setIsModelSendMenuOpen] = useState(false);
  type ContextSources = { memories_used: string[]; artifacts_used: string[]; summaries_used: string[]; documents_used: string[] };
  const [activeContextSources, setActiveContextSources] = useState<Record<string, ContextSources>>({});
  const [loadedSessionScopeKey, setLoadedSessionScopeKey] = useState<string | null>(null);
  const [sessionSidebarDragActive, setSessionSidebarDragActive] = useState(false);
  const syncedSessionModelRef = useRef<{ sessionId: string | null; modelName: string }>({ sessionId: null, modelName: "" });
  const chatViewRef = useRef<HTMLDivElement | null>(null);
  const streamUnlistenRef = useRef<(() => void) | null>(null);
  const refineUnlistenRef = useRef<(() => void) | null>(null);
  const currentSessionId = routeSessionId ?? activeChatId ?? null;
  const effectiveWorkspaceId = scopedWorkspaceId ?? activeWorkspaceId;
  const effectiveProjectId = scopedProjectId ?? activeProjectId;
  const sessionScopeKey = `${effectiveWorkspaceId ?? ""}::${effectiveProjectId ?? ""}`;

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
      setSidebarWidth(clampSessionSidebarWidth(relativeWidth));
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
  }, [sessionSidebarDragActive, setSidebarWidth]);

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // Handle external subview switching via router state
  useEffect(() => {
    const state = location.state as { subView?: ChatSubView | "grounded" } | null;
    if (state?.subView) {
      if (state.subView === "grounded") {
        setGroundedEnabled(true);
        setActiveSubView("chat");
      } else {
        setActiveSubView(state.subView as ChatSubView);
      }
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
  const folderInputRef = useRef<HTMLInputElement>(null);
  const creatingFolderRequestRef = useRef(false);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const messagesScrollContainerRef = useRef<HTMLDivElement>(null);

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

  async function handleCreateFolder(nameOverride?: string) {
    if (creatingFolderRequestRef.current) {return;}
    const folderName = (nameOverride ?? newFolderName).trim();
    const previousProjectId = effectiveProjectId;
    if (!folderName || !effectiveWorkspaceId) {
      setCreatingFolder(false);
      setNewFolderName("");
      return;
    }
    creatingFolderRequestRef.current = true;
    setCreatingFolderPending(true);
    try {
      await api.project.create(effectiveWorkspaceId, folderName);
      const refreshedProjects = await api.project.list(effectiveWorkspaceId);
      setProjectsForWorkspace(effectiveWorkspaceId, refreshedProjects);
      setScopedProjectId(previousProjectId);
    } catch (e) {
      console.error(e);
    } finally {
      creatingFolderRequestRef.current = false;
      setCreatingFolderPending(false);
      setCreatingFolder(false);
      setNewFolderName("");
    }
  }

  useEffect(() => {
    if (!creatingFolder || !folderInputRef.current) {return;}
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
    if (pendingLink) {open(pendingLink);}
    if (linkDontAsk) {setSkipLinkConfirm(true);}
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

  const clearActiveStreamListeners = useCallback(() => {
    clearStreamListener();
    clearRefineListener();
  }, [clearRefineListener, clearStreamListener]);

  useEffect(() => () => {
    clearActiveStreamListeners();
  }, [clearActiveStreamListeners]);

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

  const markdownComponents = useMemo(() => ({
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    code: ({ node: _node, inline, className, children, ...props }: any) => {
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
                    title: `New ${lang || "Code"} Snippet`,
                    artifact_type: "code",
                    language: lang,
                    content,
                    description: "Extracted from chat session",
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
  }), [activeChatId, effectiveWorkspaceId, handleLinkClick]);

  const [comparePrompt, setComparePrompt] = useState("");
  const [compareResponseA, setCompareResponseA] = useState("");
  const [compareResponseB, setCompareResponseB] = useState("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [emptyStatePrivacyMode, setEmptyStatePrivacyMode] = useState<"standard" | "incognito" | "exclude">("standard");
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

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const prevScrollChatIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingSentScrollId = useRef<string | null>(null);
  const pendingNewSessionRef = useRef<Promise<ChatSession | null> | null>(null);
  const incognitoSessionIdsRef = useRef<Set<string>>(new Set());

  const activeMessages = useMemo(
    () => (activeChatId ? (messages[activeChatId] ?? []) : []),
    [activeChatId, messages]
  );
  const pinnedQuickSendModels = useMemo(
    () => quickSearchModels.filter((modelId) =>
      modelId !== selectedModel && aiModelList.some((model) => model.model_id === modelId && model.enabled)
    ),
    [aiModelList, quickSearchModels, selectedModel]
  );
  const modelPickerOptions = useMemo(
    () => availableModels,
    [availableModels]
  );
  const hasLoadedActiveMessages = activeChatId
    ? Object.prototype.hasOwnProperty.call(messages, activeChatId)
    : false;
  const sessionTokensUsed = activeMessages.reduce((sum, m) => sum + (m.tokens_used ?? 0), 0);
  const isCurrentlyStreaming = streamingSessionId === activeChatId;

  // Stable Virtuoso Footer — lives inside the scroll area so growing content
  // doesn't resize the Virtuoso container (which causes layout thrashing).
  const VirtuosoFooter = useCallback(() => (
    <>
      {isStreaming && !isCurrentlyStreaming && (
        <div className="flex flex-col gap-1 items-start px-4 pb-4">
          <div className="flex items-center gap-2.5 max-w-[75%] overflow-hidden rounded-2xl px-4 py-3 text-sm message-assistant">
            <span className="flex gap-1 items-center">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent-color)] opacity-80" style={{ animation: "thinking-dot 1.2s ease-in-out infinite" }} />
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent-color)] opacity-80" style={{ animation: "thinking-dot 1.2s ease-in-out 0.2s infinite" }} />
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent-color)] opacity-80" style={{ animation: "thinking-dot 1.2s ease-in-out 0.4s infinite" }} />
            </span>
          </div>
        </div>
      )}
      <StreamingBubble activeChatId={activeChatId} chatMessageStyle={chatMessageStyle} expandChatToWindowWidth={expandChatToWindowWidth} />
    </>
  ), [isStreaming, isCurrentlyStreaming, activeChatId, chatMessageStyle, expandChatToWindowWidth]);

  const virtuosoComponents = useMemo(() => ({ Footer: VirtuosoFooter }), [VirtuosoFooter]);

  const activeSession = activeChatId ? sessions.find((s) => s.id === activeChatId) ?? null : null;
  const activeSessionWorkspaceId = activeSession?.workspace_id ?? effectiveWorkspaceId;
  const activeWorkspaceName = workspaces.find((workspace) => workspace.id === effectiveWorkspaceId)?.name ?? "No workspace";
  const effectiveProjectName = (
    effectiveProjectId
      ? (projectsByWorkspace[effectiveWorkspaceId ?? ""] ?? projects).find((project) => project.id === effectiveProjectId)?.name ?? null
      : null
  );

  // Web AI provider detection
  const selectedModelMeta = aiModelList.find((m) => m.model_id === selectedModel);
  const isWebProvider = selectedModelMeta?.provider.startsWith("web_") ?? false;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const webProviderKey = isWebProvider ? selectedModelMeta!.provider.replace("web_", "") : "";
  const { toolbarState, toolbarRef, dismiss: dismissToolbar } = useTextSelectionToolbar(messagesScrollContainerRef);

  const pendingPromptText = useChatStore((s) => s.pendingPromptText);
  const setPendingPromptText = useChatStore((s) => s.setPendingPromptText);

  useEffect(() => {
    if (pendingPromptText) {
      const newText = input.trim() ? `${input}\n\n${pendingPromptText}` : pendingPromptText;
      setInput(newText);
      setPendingPromptText(null);
      // Wait for React to update the state before focusing
      setTimeout(() => {
        inputRef.current?.focus();
        window.getSelection()?.removeAllRanges();
      }, 0);
    }
  }, [pendingPromptText, input, setPendingPromptText]);

  useEffect(() => {
    if (!isModelSendMenuOpen) {return;}

    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-send-model-menu]")) {return;}
      setIsModelSendMenuOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
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
    if (!isModelPickerOpen) {return;}

    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-active-model-menu]")) {return;}
      setIsModelPickerOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsModelPickerOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isModelPickerOpen]);

  useEffect(() => {
    if (!effectiveWorkspaceId) {
      setSidebarSessions([]);
      return;
    }

    const trimmedQuery = sessionQuery.trim();
    setSidebarSessions([]);
    if (trimmedQuery) {
      // Allow searching to trigger queries for the current workspace
      const timeoutId = window.setTimeout(() => {
        api.chat.searchSessions(effectiveWorkspaceId, trimmedQuery, null)
          .then(setSidebarSessions).catch(() => {});
      }, 150);
      return () => window.clearTimeout(timeoutId);
    } else {
      // When not searching, only fetch on initial mount or workspace change.
      // Other updates (move, create, delete, rename) should handle UI updates via optimistic
      // changes or explicit refresh events.
      api.chat.listSessions(effectiveWorkspaceId, null, { limit: 200, offset: 0 })
        .then(setSidebarSessions).catch(() => {});
    }
  }, [effectiveWorkspaceId, sessionQuery]);

  async function refreshProjectTree(workspaceId: string) {
    const refreshedProjects = await api.project.list(workspaceId);
    const refreshedSidebarSessions = await api.chat.listSessions(workspaceId, null, { limit: 200, offset: 0 });
    setProjectsForWorkspace(workspaceId, refreshedProjects);
    setSidebarSessions(refreshedSidebarSessions);
  }

  async function refreshScopedSessions(workspaceId: string, projectId: string | null) {
    const refreshedSessions = await api.chat.listSessions(workspaceId, projectId, { limit: 200, offset: 0 });
    setSessions(refreshedSessions);
  }

  async function bulkDeleteSessions(sessionIds: string[], projectIds: string[] = []) {
    if (!effectiveWorkspaceId || (sessionIds.length === 0 && projectIds.length === 0)) {return;}
    const settings = useSettingsStore.getState();
    const isImmediate = settings.immediateDelete;
    const skipConfirm = !isImmediate && !settings.confirmMoveToTrash;
    const totalCount = sessionIds.length + projectIds.length;

    if (!skipConfirm) {
      const confirmMsg = isImmediate
        ? `Permanently delete ${totalCount} selected item${totalCount === 1 ? "" : "s"}? Chats will be deleted and folders removed. This cannot be undone.`
        : `Delete ${totalCount} selected item${totalCount === 1 ? "" : "s"}? Chats will move to the recycle bin and folders will be removed.`;

      if (!await openConfirmDialog({
        title: isImmediate ? "Delete selected items?" : "Move selected items to recycle bin?",
        description: confirmMsg,
        confirmLabel: isImmediate ? "Delete" : "Move to Recycle Bin",
        tone: "danger",
      })) {return;}
    }

    await Promise.all(sessionIds.map((id) => api.chat.deleteSession(effectiveWorkspaceId, id)));
    for (const projectId of projectIds) {
      const projectSessionIds = sidebarSessions
        .filter((session) => session.project_id === projectId && !sessionIds.includes(session.id))
        .map((session) => session.id);
      if (projectSessionIds.length > 0) {
        await api.chat.moveSessions(projectSessionIds, effectiveWorkspaceId, undefined);
      }
      await api.project.delete(projectId);
    }
    const removedSessionIds = new Set(sessionIds);
    setSessions(sessions.filter((session) => !removedSessionIds.has(session.id)));
    sessionIds.forEach((id) => useChatStore.getState().removeSession(id));

    await Promise.all([
      refreshProjectTree(effectiveWorkspaceId),
      refreshScopedSessions(effectiveWorkspaceId, projectIds.includes(effectiveProjectId ?? "") ? null : effectiveProjectId),
    ]);
    if (projectIds.includes(effectiveProjectId ?? "")) {
      setScopedProjectId(null);
    }
    if (activeChatId && sessionIds.includes(activeChatId)) {
      setActiveChatId(null);
    }
  }

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
      setSessions([]);
      return;
    }

    const scopeKey = `${effectiveWorkspaceId}::${effectiveProjectId ?? ""}`;
    let cancelled = false;
    setSessions([]);
    setLoadedSessionScopeKey(null);

    api.chat.listSessions(effectiveWorkspaceId, effectiveProjectId, { limit: 200, offset: 0 })
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
    const sessionStillVisibleInSidebar = sidebarSessions.some(
      (session) => session.id === currentSessionId && session.workspace_id === effectiveWorkspaceId
    );
    if (sessionStillVisible || sessionStillVisibleInSidebar) {return;}

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
    if (routeSessionId) {
      setActiveChatId(routeSessionId);
      api.chat.touchSessionAccessed(routeSessionId).catch(() => {});
    }
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

  // Reset local streaming flag when switching to a chat that isn't streaming
  useEffect(() => {
    if (!isCurrentlyStreaming) {
      setIsStreaming(false);
    }
  }, [activeChatId, isCurrentlyStreaming]);

  // Load messages when session changes
  useEffect(() => {
    if (!activeChatId || messages[activeChatId] || !activeSessionWorkspaceId) {return;}
    api.chat.getMessages(activeSessionWorkspaceId, activeChatId)
      .then((msgs) => setMessages(activeChatId, msgs))
      .catch((error) => {
        console.error("Failed to load chat messages", {
          sessionId: activeChatId,
          workspaceId: activeSessionWorkspaceId,
          error,
        });
      });
  }, [activeChatId, activeSessionWorkspaceId, messages, setMessages]);

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
      api.ollama.listModelsFresh(ollamaUrl),
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
        if (canAdoptSessionModel) {return sessionModel;}
        if (withSessionModel.includes(current)) {return current;}
        if (preferredModel && withSessionModel.includes(preferredModel)) {return preferredModel;}
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
  // Does NOT depend on streamingContent — a separate interval handles that.
  useEffect(() => {
    const isSessionSwitch = prevScrollChatIdRef.current !== activeChatId;
    prevScrollChatIdRef.current = activeChatId;

    if (scrollToTopOnSend && pendingSentScrollId.current && !isCurrentlyStreaming && !isSessionSwitch) {
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
        behavior: isSessionSwitch ? "auto" : "smooth",
      });
    }
  }, [activeChatId, activeMessages, isCurrentlyStreaming, scrollToTopOnSend]);

  // Virtuoso's followOutput + Footer handle scroll-pinning during streaming;
  // no manual interval needed.

  useEffect(() => {
    if (!activeChatId || !hasLoadedActiveMessages || activeMessages.length > 0 || isStreaming) {return;}

    requestAnimationFrame(() => {
      if (!inputRef.current || document.activeElement === inputRef.current) {return;}
      inputRef.current.focus();
      const cursorPosition = inputRef.current.value.length;
      inputRef.current.setSelectionRange(cursorPosition, cursorPosition);
    });
  }, [activeChatId, hasLoadedActiveMessages, activeMessages.length, isStreaming]);

  function activateSession(session: ChatSession) {
    setActiveChatId(session.id);
    api.chat.touchSessionAccessed(session.id).catch(() => {});

    const store = useChatStore.getState();
    if (!store.sessions.some((existingSession) => existingSession.id === session.id)) {
      store.addSession(session);
    }
    if (store.messages[session.id] === undefined) {
      setMessages(session.id, []);
    }
  }

  async function findOrCreateEmptySession(options?: { isIncognito?: boolean; excludeFromAnalytics?: boolean }) {
    if (!effectiveWorkspaceId) {return null;}

    const privacy = {
      isIncognito: options?.isIncognito ?? false,
      excludeFromAnalytics: options?.excludeFromAnalytics ?? false,
    };
    const store = useChatStore.getState();
    const localUnusedSession = findUnusedSession(
      store.sessions,
      store.messages,
      effectiveWorkspaceId,
    );
    if (localUnusedSession) {
      return localUnusedSession;
    }

    const workspaceSessions = await api.chat.listSessions(effectiveWorkspaceId, null, { limit: 200, offset: 0 });
    const unusedSession = findUnusedSession(
      workspaceSessions,
      useChatStore.getState().messages,
      effectiveWorkspaceId,
    );
    if (unusedSession) {
      return unusedSession;
    }

    return api.chat.createSession(effectiveWorkspaceId, effectiveProjectId, {
      modelName: selectedModel,
      is_incognito: privacy.isIncognito,
      exclude_from_analytics: privacy.excludeFromAnalytics,
    });
  }

  async function createNewSession(options?: { isIncognito?: boolean; excludeFromAnalytics?: boolean }) {
    if (!effectiveWorkspaceId) {return;}

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
  }

  async function ensureSessionForChat(modelId: string, options?: { isIncognito?: boolean; excludeFromAnalytics?: boolean }) {
    if (!effectiveWorkspaceId) {return null;}

    let sessionId = activeChatId;
    let session = sessionId
      ? useChatStore.getState().sessions.find((existingSession) => existingSession.id === sessionId) ?? null
      : null;

    if (!sessionId) {
      const nextSession = await findOrCreateEmptySession(options);
      if (!nextSession) {return null;}
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
      useChatStore.getState().updateSession(updatedSession);
      session = updatedSession;
    }

    return { sessionId, session };
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
        const aiTitle = await api.ollama.generateTitle(model, firstMessage, ollamaUrl).catch(() => null);
        const title = resolveChatTitle({ aiTitle, firstMessage });
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
        // Leave the existing title untouched if persistence fails.
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
          const aiTitle = await api.ollama.generateTitleFromConversation(model, conversation, ollamaUrl).catch(() => null);
          const title = resolveChatTitle({ aiTitle, firstMessage });
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

  function maybeExtractFlashcards(responseText: string, sessionId: string, modelId: string) {
    const { autoGenerateFlashcards } = useSettingsStore.getState();
    if (!autoGenerateFlashcards || !effectiveWorkspaceId || responseText.length < 100) {return;}
    api.flashcard.extractFromContent(effectiveWorkspaceId, responseText, "chat", modelId, sessionId, ollamaUrl || undefined)
      .catch(() => {});
  }

  async function sendMessageWithModel(modelId: string, contentOverride?: string) {
    const userContent = (contentOverride ?? input).trim();
    if (!userContent || isStreaming || !modelId || !effectiveWorkspaceId) {return;}

    const modelMeta = aiModelList.find((m) => m.model_id === modelId);
    const isOneOffWebProvider = modelMeta?.provider.startsWith("web_") ?? false;
    const isLlamacppProvider = modelMeta?.provider === "llamacpp";
    const isMlxProvider = modelMeta?.provider === "mlx";
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const oneOffWebProviderKey = isOneOffWebProvider ? modelMeta!.provider.replace("web_", "") : "";

    const ensuredSession = await ensureSessionForChat(modelId);
    if (!ensuredSession) {return;}
    const sid = ensuredSession.sessionId;

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
    pendingSentScrollId.current = optimisticUserMsg.id;

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
        // grounded search failures are non-critical
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

    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    if (isOneOffWebProvider && oneOffWebProviderKey) {
      try {
        clearStreamListener();
        const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs) => {
          if (done) {
            const assembled = useChatStore.getState().streamingContent;
            finalizeStream(sid!, modelId, tokensUsed, durationMs);
            setIsStreaming(false);
            clearStreamListener();
            api.chat.addMessage(effectiveWorkspaceId, sid!, "assistant", assembled, modelId, tokensUsed, durationMs)
              .then((persisted) => { updateMessage(sid!, persisted); triggerFollowUps(sid!); })
              .catch(() => {});
            if (tokensUsed && tokensUsed > 0) {
              api.aiModel.recordTokenUsage(modelId, `web_${oneOffWebProviderKey}`, tokensUsed).catch(() => {});
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
        const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs) => {
          if (done) {
            const assembled = useChatStore.getState().streamingContent;
            finalizeStream(sid!, modelId, tokensUsed, durationMs);
            setIsStreaming(false);
            clearStreamListener();
            api.chat.addMessage(effectiveWorkspaceId, sid!, "assistant", assembled, modelId, tokensUsed, durationMs)
              .then((persisted) => { updateMessage(sid!, persisted); triggerFollowUps(sid!); })
              .catch(() => {});
            if (tokensUsed && tokensUsed > 0) {
              api.aiModel.recordTokenUsage(modelId, "llamacpp", tokensUsed).catch(() => {});
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
        const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs) => {
          if (done) {
            const assembled = useChatStore.getState().streamingContent;
            finalizeStream(sid!, modelId, tokensUsed, durationMs);
            setIsStreaming(false);
            clearStreamListener();
            api.chat.addMessage(effectiveWorkspaceId, sid!, "assistant", assembled, modelId, tokensUsed, durationMs)
              .then((persisted) => { updateMessage(sid!, persisted); triggerFollowUps(sid!); })
              .catch(() => {});
            if (tokensUsed && tokensUsed > 0) {
              api.aiModel.recordTokenUsage(modelId, "mlx", tokensUsed).catch(() => {});
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
        const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs) => {
          if (done) {
            const assembled = useChatStore.getState().streamingContent;
            finalizeStream(sid!, modelId, tokensUsed, durationMs);
            setIsStreaming(false);
            clearStreamListener();
            api.chat.addMessage(effectiveWorkspaceId, sid!, "assistant", assembled, modelId, tokensUsed, durationMs)
              .then((persisted) => { updateMessage(sid!, persisted); triggerFollowUps(sid!); })
              .catch(() => {});
            if (tokensUsed && tokensUsed > 0) {
              api.aiModel.recordTokenUsage(modelId, "ollama", tokensUsed).catch(() => {});
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

      if (!await openConfirmDialog({
        title: isImmediate ? "Delete chat?" : "Move chat to recycle bin?",
        description: confirmMsg,
        confirmLabel: isImmediate ? "Delete" : "Move to Recycle Bin",
        tone: "danger",
      })) {return;}
    }

    await api.chat.deleteSession(effectiveWorkspaceId, id);
    useChatStore.getState().removeSession(id);
    setSidebarSessions((prev) => prev.filter((session) => session.id !== id));
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
    setSidebarSessions((prev) => prev.map((item) => item.id === session.id ? { ...item, is_pinned: !item.is_pinned } : item));
  }

  async function renameSession(id: string) {
    if (!renameTitle.trim() || !effectiveWorkspaceId) { setRenamingId(null); return; }
    await api.chat.updateSession(effectiveWorkspaceId, id, { title: renameTitle });
    setSessions(sessions.map((s) => s.id === id ? { ...s, title: renameTitle } : s));
    setSidebarSessions((prev) => prev.map((session) => session.id === id ? { ...session, title: renameTitle } : session));
    setRenamingId(null);
  }

  async function refreshSessionTitle(session: ChatSession) {
    if (!effectiveWorkspaceId) {return;}

    const sessionMessages = (useChatStore.getState().messages[session.id] ?? messages[session.id] ?? [])
      .filter((message) => message.role === "user" || message.role === "assistant");
    const firstUserMessage = sessionMessages.find((message) => message.role === "user")?.content?.trim() ?? "";
    if (!firstUserMessage) {return;}

    const model = session.model_name || selectedModel;
    if (!model) {return;}

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
      useChatStore.getState().updateSession({
        ...session,
        title,
        title_generated_at: new Date().toISOString(),
        message_count_at_title_gen: sessionMessages.filter((message) => message.role === "user").length,
      });
      setSidebarSessions((prev) => prev.map((item) => item.id === session.id ? { ...item, title } : item));
    } catch {
      // Leave the current title in place if refresh fails.
    }
  }

  async function moveSessionsToTarget(sessionIds: string[], workspaceId: string, projectId: string | null) {
    if (sessionIds.length === 0) {return;}
    const sessionIdSet = new Set(sessionIds);
    const isCrossWorkspaceMove = workspaceId !== effectiveWorkspaceId;
    const shouldPreserveProjectStructure = isCrossWorkspaceMove && projectId === null;

    // Optimistic UI update: remove from source immediately
    if (isCrossWorkspaceMove) {
      setSidebarSessions((prev) => prev.filter((session) => !sessionIdSet.has(session.id)));
      setSessions(sessions.filter((session) => !sessionIdSet.has(session.id)));
    }

    if (isCrossWorkspaceMove && shouldPreserveProjectStructure) {
      // Use batch move: single IPC call handles project lookup/create + all moves
      const result = await api.chat.batchMoveSessions(sessionIds, workspaceId, true);
      
      // Determine which project to navigate to
      const mappedProjectIds = Object.values(result.project_mapping);
      const destinationProjectIdForView = mappedProjectIds.length === 1 ? mappedProjectIds[0] : null;
      
      setScopedWorkspaceId(workspaceId);
      setScopedProjectId(destinationProjectIdForView);
      
      // Refresh only the destination workspace tree (source already updated optimistically)
      await refreshProjectTree(workspaceId);
      
      if (activeChatId && sessionIds.includes(activeChatId)) {
        setActiveChatId(sessionIds.length === 1 ? activeChatId : null);
      }
    } else if (isCrossWorkspaceMove) {
      // Cross-workspace move to specific project or root
      await api.chat.moveSessions(sessionIds, workspaceId, projectId ?? undefined);
      
      setScopedWorkspaceId(workspaceId);
      setScopedProjectId(projectId);
      
      // Refresh only the destination workspace tree
      await refreshProjectTree(workspaceId);
      
      if (activeChatId && sessionIds.includes(activeChatId)) {
        setActiveChatId(sessionIds.length === 1 ? activeChatId : null);
      }
    } else {
      // Same-workspace move
      await api.chat.moveSessions(sessionIds, workspaceId, projectId ?? undefined);
      
      // Optimistic local update for same-workspace
      setScopedProjectId(projectId);
      setSidebarSessions((prev) => prev.map((session) => (
        sessionIdSet.has(session.id)
          ? { ...session, workspace_id: workspaceId, project_id: projectId ?? "" }
          : session
      )));
      setSessions(sessions.map((session) => (
        sessionIdSet.has(session.id)
          ? { ...session, workspace_id: workspaceId, project_id: projectId ?? "" }
          : session
      )));
      
      // Light refresh for project counts (sessions already updated optimistically)
      if (effectiveWorkspaceId) {
        const refreshedProjects = await api.project.list(effectiveWorkspaceId);
        setProjectsForWorkspace(effectiveWorkspaceId, refreshedProjects);
      }
    }
  }

  async function renameProject(projectId: string, name: string) {
    if (!effectiveWorkspaceId || !name.trim()) {return;}
    await api.project.update(projectId, { name: name.trim() });
    await refreshProjectTree(effectiveWorkspaceId);
  }

  async function moveProjectToWorkspace(project: Project, targetWorkspaceId: string) {
    if (project.workspace_id === targetWorkspaceId) {return;}

    const projectSessionIds = sidebarSessions
      .filter((session) => session.project_id === project.id)
      .map((session) => session.id);

    // Snapshot state for potential rollback
    const prevSidebarSessions = [...sidebarSessions];
    const prevSessions = [...sessions];
    const prevWorkspaceProjects = useWorkspaceStore.getState().projectsByWorkspace[project.workspace_id] ?? [];

    // Optimistic UI update: remove from source workspace locally without doing a full refresh
    // Instead we just remove it from sidebarSessions and sessions, and let the background refresh
    // or navigation handle the rest, specifically avoiding refreshProjectTree(effectiveWorkspaceId).
    setSidebarSessions((prev) => prev.filter((session) => session.project_id !== project.id));
    setSessions(sessions.filter((session) => session.project_id !== project.id));

    // For the projects list, we can optimistically update the workspace store
    useWorkspaceStore.getState().setProjectsForWorkspace(
      project.workspace_id,
      prevWorkspaceProjects.filter(p => p.id !== project.id)
    );

    try {
      // Use the single transaction Rust backend command
      const movedProject = await api.project.moveToWorkspace(project.id, targetWorkspaceId);

      // Now navigate to the target workspace and refresh only its tree.
      setScopedWorkspaceId(targetWorkspaceId);
      setScopedProjectId(movedProject.id);
      await refreshProjectTree(targetWorkspaceId);

      if (activeChatId && projectSessionIds.includes(activeChatId)) {
        // If we had the active chat open, keep it open if it was a single move, or reset if multiple
        setActiveChatId(projectSessionIds.length === 1 ? activeChatId : null);
      } else if (effectiveProjectId === project.id) {
        // If we had the project open but not a chat, we navigate to the new project.
        setScopedProjectId(movedProject.id);
      }
    } catch (error) {
      // Rollback on failure
      setSidebarSessions(prevSidebarSessions);
      setSessions(prevSessions);
      useWorkspaceStore.getState().setProjectsForWorkspace(project.workspace_id, prevWorkspaceProjects);

      const description = error instanceof Error
        ? error.message
        : typeof error === "string" && error.trim()
          ? error
          : "Failed to move folder.";
      openAlertDialog("Move failed", description, "danger");
    }
  }

  async function deleteProject(projectId: string) {
    if (!effectiveWorkspaceId) {return;}
    const projectSessions = sidebarSessions.filter((session) => session.project_id === projectId).map((session) => session.id);
    const confirmMsg = projectSessions.length > 0
      ? `Delete this folder? ${projectSessions.length} chat${projectSessions.length === 1 ? "" : "s"} will be moved to the workspace root.`
      : "Delete this empty folder?";

    if (!await openConfirmDialog({
      title: "Delete folder?",
      description: confirmMsg,
      confirmLabel: "Delete Folder",
      tone: "danger",
    })) {return;}

    if (projectSessions.length > 0) {
      await api.chat.moveSessions(projectSessions, effectiveWorkspaceId, undefined);
    }
    await api.project.delete(projectId);
    if (effectiveProjectId === projectId) {
      setScopedProjectId(null);
    }
    await Promise.all([
      refreshProjectTree(effectiveWorkspaceId),
      refreshScopedSessions(effectiveWorkspaceId, effectiveProjectId === projectId ? null : effectiveProjectId),
    ]);
  }

  async function createWorkspaceForMove(name: string) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Workspace name cannot be empty.");
    }

    const workspace = await api.workspace.create(trimmedName);
    addWorkspace(workspace);
    return workspace;
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
      const description = err instanceof Error
        ? err.message
        : typeof err === "string" && err.trim()
          ? err
          : "Failed to save chat.";
      console.error("Failed to save chat:", err);
      openAlertDialog("Save failed", description, "danger");
    }
  }

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
      clearStreamListener();
      const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs) => {
        if (done) {
          finalizeStream(sid, selectedModel, tokensUsed, durationMs);
          setIsStreaming(false);
          clearStreamListener();
          const assembled = useChatStore.getState().streamingContent;
          api.chat.addMessage(effectiveWorkspaceId, sid, "assistant", assembled, selectedModel, tokensUsed, durationMs)
            .then((persisted) => updateMessage(sid, persisted))
            .catch(() => {});
          if (tokensUsed && tokensUsed > 0) {
            api.aiModel.recordTokenUsage(selectedModel, "ollama", tokensUsed).catch(() => {});
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

  async function redoMessage(msgId: string) {
    if (!activeChatId || isStreaming || !effectiveWorkspaceId) {return;}
    const idx = activeMessages.findIndex((m) => m.id === msgId);
    if (idx < 0) {return;}
    const trimmedMessages = activeMessages.slice(0, idx);
    setMessages(activeChatId, trimmedMessages);

    const _history = trimmedMessages.map((m) => ({ role: m.role, content: m.content }));

    setIsStreaming(true);
    try {
      const sid = activeChatId;
      clearStreamListener();
      const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs) => {
        if (done) {
          finalizeStream(sid, selectedModel, tokensUsed, durationMs);
          setIsStreaming(false);
          clearStreamListener();
          const assembled = useChatStore.getState().streamingContent;
          api.chat.addMessage(effectiveWorkspaceId, sid, "assistant", assembled, selectedModel, tokensUsed, durationMs)
            .then((persisted) => updateMessage(sid, persisted))
            .catch(() => {});
          if (tokensUsed && tokensUsed > 0) {
            api.aiModel.recordTokenUsage(selectedModel, "ollama", tokensUsed).catch(() => {});
          }
        } else {
          appendStreamChunk(sid, chunk);
        }
      });
      streamUnlistenRef.current = unlisten;
      await api.ollama.sendMessage(sid, selectedModel, trimmedMessages.map((m) => ({ role: m.role, content: m.content })), true, ollamaUrl || undefined);
    } catch (err) {
      clearStreamListener();
      setIsStreaming(false);
      const errMsg = err instanceof Error ? err.message : String(err);
      appendStreamChunk(activeChatId, `\n\n⚠️ Error: ${errMsg}`);
      finalizeStream(activeChatId, selectedModel);
    }
  }

  // Load models for comparison mode
  useEffect(() => {
    if (activeSubView !== "compare") {return;}
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
    }).catch(() => {});
  }, [activeSubView, ollamaUrl]);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const [isComposerHeaderCollapsed, setIsComposerHeaderCollapsed] = useState(false);
  const hasComposerHeader =
    (activeTopicSignature?.domain_tags.length ?? 0) > 0 || composerSuggestionRows.length > 0;
  const showComposerHeader = hasComposerHeader && !isComposerHeaderCollapsed;

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

  const canRefreshActiveSessionTitle = activeSession
    ? canRefreshSessionTitle(activeSession, messages)
    : false;
  const isComparePanelOpen = activeSubView === "compare";
  const chatWorkspaceClassName = "flex flex-1 min-w-0 min-h-0 overflow-hidden";

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <div ref={chatViewRef} className="flex h-full min-h-0 w-full min-w-0 overflow-hidden">
      <SessionSidebar
        sidebarSessions={sidebarSessions}
        workspaces={workspaces}
        projectsByWorkspace={projectsByWorkspace}
        projects={projects}
        activeProjectId={effectiveProjectId}
        setActiveProjectId={setScopedProjectId}
        activeProject={activeProject}
        moveSessionsToTarget={moveSessionsToTarget}
        bulkDeleteSessions={bulkDeleteSessions}
        renameProject={renameProject}
        deleteProject={deleteProject}
        moveProjectToWorkspace={moveProjectToWorkspace}
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
        saveSession={saveSession}
        deleteSession={deleteSession}
        showAlertDialog={openAlertDialog}
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
          <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-4 text-center">
            <MessageSquare size={40} className="text-[var(--text-muted)] opacity-30" />
            <p className="text-[var(--text-muted)] text-sm">Select a conversation or start a new one</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                onClick={() => createNewSession({
                  isIncognito: emptyStatePrivacyMode === "incognito",
                  excludeFromAnalytics: emptyStatePrivacyMode === "exclude",
                })}
                className="px-4 py-2 bg-[var(--accent-color)] text-white rounded-lg text-sm hover:opacity-90"
              >
                Start a new chat
              </button>
            </div>
            <div className="w-full max-w-xs rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 py-3 text-left">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <input
                    type="radio"
                    name="empty-state-privacy"
                    checked={emptyStatePrivacyMode === "incognito"}
                    onChange={() => setEmptyStatePrivacyMode("incognito")}
                    className="accent-[var(--accent-color)]"
                  />
                  <Ghost size={14} className="text-purple-400" />
                  Incognito
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <input
                    type="radio"
                    name="empty-state-privacy"
                    checked={emptyStatePrivacyMode === "exclude"}
                    onChange={() => setEmptyStatePrivacyMode("exclude")}
                    className="accent-[var(--accent-color)]"
                  />
                  <Shield size={14} className="text-sky-400" />
                  Exclude from analytics
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <input
                    type="radio"
                    name="empty-state-privacy"
                    checked={emptyStatePrivacyMode === "standard"}
                    onChange={() => setEmptyStatePrivacyMode("standard")}
                    className="accent-[var(--accent-color)]"
                  />
                  <MessageSquare size={14} className="text-[var(--text-muted)]" />
                  Standard
                </label>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
            {/* Slim title bar */}
            <div className="flex min-w-0 items-center gap-2 px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  <span className="truncate">{activeWorkspaceName}</span>
                  {effectiveProjectName && (
                    <>
                      <span>/</span>
                      <span className="truncate">{effectiveProjectName}</span>
                    </>
                  )}
                </div>
                <span className="mt-0.5 flex min-w-0 items-center gap-2 truncate text-sm font-medium text-[var(--text-primary)]">
                  <span className="truncate">{activeSession?.title || "New Chat"}</span>
                  {activeSession?.is_incognito && (
                    <span title="Incognito thread"><Ghost size={14} className="text-purple-400" /></span>
                  )}
                  {!activeSession?.is_incognito && activeSession?.exclude_from_analytics && (
                    <span title="Excluded from analytics"><Shield size={14} className="text-sky-400" /></span>
                  )}
                </span>
              </div>
              {activeSession && (
                <button
                  onClick={() => { if (canRefreshActiveSessionTitle) {refreshSessionTitle(activeSession);} }}
                  disabled={!canRefreshActiveSessionTitle}
                  className={`p-1.5 rounded-lg text-[var(--text-muted)] transition-colors ${
                    canRefreshActiveSessionTitle
                      ? "hover:bg-[var(--bg-hover)] hover:text-[var(--accent-color)]"
                      : "cursor-not-allowed opacity-40"
                  }`}
                  title={canRefreshActiveSessionTitle ? "Refresh chat name" : "Refresh is unavailable for empty chats"}
                >
                  <RefreshCw size={14} />
                </button>
              )}
              {availableModels.length === 0 && ollamaModelStatus === "unreachable" && (
                <span className="text-xs text-red-400">Ollama unavailable</span>
              )}
              {availableModels.length === 0 && ollamaModelStatus !== "unreachable" && (
                <span className="text-xs text-amber-400">No Ollama models installed</span>
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

            {/* Grounded mode warning if no processed docs */}
            {groundedEnabled && processedDocCount === 0 && effectiveProjectId && (
              <div className="mx-4 mt-2 px-3 py-1.5 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-500 flex items-center gap-1.5">
                <FileText size={12} />
                No processed documents. Upload and process docs in the Document Browser.
              </div>
            )}

            {/* Messages */}
            <div className={`min-h-0 min-w-0 flex-1 flex flex-col overflow-hidden ${activeMessages.length > 0 || isStreaming ? "" : "hidden"}`}>
              <div ref={messagesScrollContainerRef} className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">
                <Virtuoso
                  ref={virtuosoRef}
                  data={activeMessages}
                  initialTopMostItemIndex={activeMessages.length > 0 ? activeMessages.length - 1 : 0}
                  followOutput={isCurrentlyStreaming ? "auto" : "smooth"}
                  alignToBottom={true}
                  className="w-full min-w-0 overflow-x-hidden py-4"
                  computeItemKey={(_, msg) => msg.id}
                  itemContent={(i, msg) => (
                    <div className="pb-4 px-4">
                      <ChatMessageBubble
                        key={msg.id}
                        msg={msg}
                        isLastMessage={i === activeMessages.length - 1}
                        isStreaming={isStreaming}
                        chatMessageStyle={chatMessageStyle}
                        expandChatToWindowWidth={expandChatToWindowWidth}
                        showGenInfo={showGenInfo}
                        editingMessageId={editingMessageId}
                        editContent={editContent}
                        copiedMessageId={copiedMessageId}
                        expandedThoughtIds={expandedThoughtIds}
                        messageSources={messageSources}
                        expandedSources={expandedSources}
                        contextSources={i === activeMessages.length - 1 && currentSessionId ? activeContextSources[currentSessionId] ?? null : null}
                        markdownComponents={markdownComponents}
                        onCopy={handleCopyMessage}
                        onStartEdit={handleStartEditing}
                        onSubmitEdit={submitEdit}
                        onSetEditContent={setEditContent}
                        onCancelEdit={handleCancelEdit}
                        onRedo={redoMessage}
                        onToggleThought={handleToggleThought}
                        onToggleSources={handleToggleSources}
                      />
                    </div>
                  )}
                  components={virtuosoComponents}
                />
              </div>
            </div>

            {toolbarState && (
              <SelectionToolbar
                x={toolbarState.x}
                y={toolbarState.y}
                text={toolbarState.text}
                onDismiss={dismissToolbar}
                innerRef={toolbarRef}
              />
            )}

            {/* Input / composer area */}
            <div className={`min-w-0 bg-transparent flex flex-col items-center ${activeMessages.length === 0 && !isStreaming ? "flex-1 justify-center px-6 py-6" : "flex-shrink-0 px-4 pb-6 pt-3 sm:px-5"}`}>
              <div className={`${expandChatToWindowWidth ? "w-full" : "w-full max-w-5xl"} min-w-0 rounded-[28px] border border-[rgba(var(--accent-color-rgb),0.12)] bg-[rgba(11,14,19,0.94)] ${showComposerHeader ? "p-3" : "p-1.5"} shadow-[0_30px_90px_-46px_rgba(0,0,0,0.95)] backdrop-blur-xl`}>
                <div className="flex flex-col gap-3.5 min-w-0">
                  {showComposerHeader && activeTopicSignature && activeTopicSignature.domain_tags.length > 0 && (
                    <div className="px-1 pt-1">
                      <div className="px-1.5 pb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[rgba(255,255,255,0.48)]">
                        General
                      </div>
                      <TopicChips
                        tags={activeTopicSignature.domain_tags}
                        onChipClick={(tag) => setInput(prev => `[${tag}] ${prev}`)}
                      />
                    </div>
                  )}

                  {showComposerHeader && (
                    <ComposerSuggestionRows
                      rows={composerSuggestionRows}
                      disabled={isStreaming}
                      disableImmediateSend={!selectedModel || !effectiveWorkspaceId}
                      onSuggestionClick={handleComposerSuggestion}
                    />
                  )}

                  {hasComposerHeader && (
                    <div className={`flex justify-end ${showComposerHeader ? "-mt-1 px-1 pb-0.5" : "px-1"}`}>
                      <button
                        type="button"
                        onClick={() => setIsComposerHeaderCollapsed((collapsed) => !collapsed)}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(var(--accent-color-rgb),0.14)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.46)] transition-all hover:border-[rgba(var(--accent-color-rgb),0.34)] hover:text-white"
                        aria-label={showComposerHeader ? "Hide suggestions" : "Show suggestions"}
                        aria-expanded={showComposerHeader}
                        title={showComposerHeader ? "Hide suggestions" : "Show suggestions"}
                      >
                        {showComposerHeader ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  )}

                  <div className={`${showComposerHeader ? "rounded-[24px] border border-[rgba(255,255,255,0.09)] bg-[rgba(9,12,16,0.96)] p-2.5 shadow-[0_22px_52px_-34px_rgba(0,0,0,0.95)]" : "rounded-[24px] border border-transparent bg-transparent p-1 shadow-none"} transition-all focus-within:border-[rgba(var(--accent-color-rgb),0.3)] focus-within:shadow-[0_0_0_2px_rgba(var(--accent-color-rgb),0.07),0_22px_52px_-34px_rgba(0,0,0,0.95)]`}>
                    {/* Textarea + send button */}
                    <div className="flex items-end gap-2.5">
                      <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
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
                                ? "Message this thread…"
                                : "Start a new thread…"
                        }
                        rows={1}
                        className="flex-1 resize-none bg-transparent px-4 py-3 text-[15px] font-medium leading-6 tracking-[0.01em] text-[rgba(255,255,255,0.94)] placeholder:text-[rgba(255,255,255,0.34)] outline-none transition-colors max-h-40 overflow-y-auto"
                        style={{ minHeight: 56 }}
                        onInput={(e) => {
                          const el = e.currentTarget;
                          el.style.height = "auto";
                          el.style.height = Math.min(el.scrollHeight, 160) + "px";
                        }}
                      />
                      {isStreaming ? (
                        <button
                          onClick={() => {
                            if (activeChatId) {
                              api.ollama.stopStream(activeChatId).catch(() => {});
                              api.llamacpp.stopStream(activeChatId).catch(() => {});
                              api.webAI.stopStream(activeChatId).catch(() => {});
                            }
                          }}
                          className="mb-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-red-500 text-white shadow-[0_12px_30px_-18px_rgba(239,68,68,0.65)] transition-opacity hover:opacity-90"
                          title="Stop generation"
                        >
                          <X size={16} />
                        </button>
                      ) : (
                        <div className="mb-1 mr-0.5 flex items-center gap-2">
                          <div className="relative flex flex-shrink-0 items-center" data-send-model-menu>
                            <button
                              onClick={async () => {
                                setIsModelSendMenuOpen(false);
                                await sendMessage();
                              }}
                              disabled={!input.trim() || !selectedModel}
                              className={`flex h-10 items-center justify-center border border-[rgba(var(--accent-color-rgb),0.28)] bg-[rgba(var(--accent-color-rgb),0.14)] text-white shadow-[0_14px_32px_-20px_rgba(var(--accent-color-rgb),0.45)] transition-all hover:-translate-y-px hover:border-[rgba(var(--accent-color-rgb),0.42)] hover:bg-[rgba(var(--accent-color-rgb),0.18)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 ${
                                pinnedQuickSendModels.length > 0 ? "w-10 rounded-l-2xl rounded-r-md" : "w-10 rounded-2xl"
                              }`}
                              title={selectedModel ? `Send with ${modelDisplayName(selectedModel)}` : "Send"}
                            >
                              <ArrowUpCircle size={19} strokeWidth={2.2} />
                            </button>
                            {pinnedQuickSendModels.length > 0 && (
                              <>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsModelPickerOpen(false);
                                  setIsModelSendMenuOpen((open) => !open);
                                }}
                                disabled={!input.trim() || isStreaming}
                                className="flex h-10 w-8 items-center justify-center rounded-l-md rounded-r-2xl border border-[rgba(var(--accent-color-rgb),0.28)] border-l-white/20 bg-[rgba(var(--accent-color-rgb),0.14)] text-white shadow-[0_14px_32px_-20px_rgba(var(--accent-color-rgb),0.45)] transition-all hover:-translate-y-px hover:border-[rgba(var(--accent-color-rgb),0.42)] hover:bg-[rgba(var(--accent-color-rgb),0.18)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                                title="Send with another pinned model"
                                  aria-label="Send with another pinned model"
                                  aria-haspopup="menu"
                                  aria-expanded={isModelSendMenuOpen}
                                >
                                  <ChevronDown size={14} strokeWidth={2.2} />
                                </button>
                                {isModelSendMenuOpen && (
                                  <div className="absolute bottom-full right-0 z-20 mb-2 min-w-[220px] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_24px_50px_-24px_rgba(15,23,42,0.7)]">
                                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                                      Send With
                                    </div>
                                    {pinnedQuickSendModels.map((modelId) => (
                                      <button
                                        key={modelId}
                                        type="button"
                                        onClick={async () => {
                                          setIsModelSendMenuOpen(false);
                                          await sendMessageWithModel(modelId);
                                        }}
                                        disabled={!input.trim() || isStreaming}
                                        title={`Send with ${modelDisplayName(modelId)}`}
                                        className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        <span className="truncate">{modelDisplayName(modelId)}</span>
                                        <Globe size={14} className="shrink-0 text-[var(--text-muted)]" />
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          <button
                            onClick={async () => {
                              if (!input.trim() || !effectiveWorkspaceId || !selectedModel) {return;}
                              const ensuredSession = await ensureSessionForChat(selectedModel);
                              if (!ensuredSession) {return;}
                              await api.thoughtQueue.create(effectiveWorkspaceId, input.trim(), {
                                modelName: selectedModel,
                                sessionId: ensuredSession.sessionId,
                                processAt: new Date(Date.now() + 60_000).toISOString(),
                              });
                              setInput("");
                            }}
                            disabled={!input.trim() || !selectedModel}
                            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-[rgba(var(--accent-color-rgb),0.16)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.56)] shadow-[0_12px_30px_-22px_rgba(0,0,0,0.95)] transition-all hover:-translate-y-px hover:border-[rgba(var(--accent-color-rgb),0.34)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                            title="Schedule for background processing"
                          >
                            <Clock size={14} strokeWidth={2.2} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                {/* ── Composer tool row ─────────────────────────────────────── */}
                <div className="flex items-center gap-2.5 border-t border-[rgba(var(--accent-color-rgb),0.1)] px-1 pt-2 flex-wrap">
                  {/* Model picker */}
                  <div className="relative max-w-[220px]" data-active-model-menu>
                    <button
                      type="button"
                      onClick={() => {
                        if (modelPickerOptions.length === 0) {return;}
                        setIsModelSendMenuOpen(false);
                        setIsModelPickerOpen((open) => !open);
                      }}
                      disabled={modelPickerOptions.length === 0}
                      className={`${composerSelectClassName} flex max-w-[220px] items-center justify-between gap-2 bg-[var(--bg-primary)] text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60`}
                      title="Active model"
                      aria-haspopup="menu"
                      aria-expanded={isModelPickerOpen}
                    >
                      <span className="truncate text-left">
                        {selectedModel ? modelDisplayName(selectedModel) : "No models available"}
                      </span>
                      <ChevronDown size={14} strokeWidth={2.2} className={`shrink-0 text-[rgba(255,255,255,0.46)] transition-transform ${isModelPickerOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isModelPickerOpen && modelPickerOptions.length > 0 && (
                      <div className="absolute left-0 bottom-full z-20 mb-2 w-[240px] max-w-[min(80vw,240px)] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_24px_50px_-24px_rgba(15,23,42,0.7)]">
                        <div className="max-h-72 overflow-y-auto">
                          {modelPickerOptions.map((modelId) => {
                            const isSelected = modelId === selectedModel;
                            return (
                              <button
                                key={modelId}
                                type="button"
                                onClick={async () => {
                                  setSelectedModel(modelId);
                                  setIsModelPickerOpen(false);
                                  await persistModelChoice(modelId);
                                }}
                                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                                  isSelected
                                    ? "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--text-primary)]"
                                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                                }`}
                                title={modelDisplayName(modelId)}
                              >
                                <span className="truncate">{modelDisplayName(modelId)}</span>
                                {isSelected && <Check size={14} className="shrink-0 text-[var(--accent-color)]" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
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

                    <button
                      onClick={() => setActiveSubView(isComparePanelOpen ? "chat" : "compare")}
                      title={isComparePanelOpen ? "Close model comparison" : "Compare two models side by side"}
                      className={`${composerToggleBaseClass} ${
                        isComparePanelOpen ? composerToggleActiveClass : composerToggleInactiveClass
                      }`}
                    >
                      <SplitSquareHorizontal size={13} />
                      <span>Compare</span>
                    </button>

                    {/* Grounded (RAG) toggle */}
                    <button
                      onClick={() => setGroundedEnabled((v) => !v)}
                      title={groundedEnabled ? `Grounded ON (${processedDocCount} docs)` : "Grounded mode — use your documents as context (RAG)"}
                      className={`relative ${composerToggleBaseClass} ${
                        groundedEnabled
                          ? composerToggleActiveClass
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
                          className={composerUtilitySelectClassName}
                          title="Document chunks to retrieve"
                        >
                          {[3, 5, 8, 10].map((v) => <option key={v} value={v}>Top {v}</option>)}
                        </select>
                        <ChevronDown size={14} strokeWidth={2.2} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.46)]" />
                      </div>
                    )}

                    {/* Thought queue toggle */}
                    <button
                      onClick={() => setThoughtPanelOpen((v) => !v)}
                      title="Thought Queue — schedule follow-up questions to process in background"
                      className={`relative ${composerToggleBaseClass} ${
                        thoughtPanelOpen
                          ? composerToggleActiveClass
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
                      <div className="ml-auto flex h-10 items-center gap-2 rounded-full border border-[rgba(var(--accent-color-rgb),0.14)] bg-[rgba(255,255,255,0.02)] px-3.5 text-[11px] font-semibold tracking-[0.01em] text-[rgba(255,255,255,0.78)] shadow-[0_12px_30px_-22px_rgba(0,0,0,0.95)]">
                        <span className="text-[rgba(255,255,255,0.42)]">Tokens</span>
                        <span className="font-mono text-[rgba(255,255,255,0.95)]">
                          {sessionTokensUsed >= 1000 ? `${(sessionTokensUsed / 1000).toFixed(1)}k` : sessionTokensUsed}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className={`${expandChatToWindowWidth ? "w-full" : "w-full max-w-5xl"} min-w-0 mt-3`}>
                <WorkspaceMigrationBanner />
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
                  <div className="mx-auto w-full min-w-0 max-w-5xl rounded-[28px] border border-[var(--border-color)] bg-[var(--bg-elevated)]/90 p-3 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.45)] backdrop-blur-xl">
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
                          <select
                            value={compareModelA}
                            onChange={(e) => {
                              setCompareModelA(e.target.value);
                              saveCompareA(e.target.value);
                              persistSetting("compare_model_a", e.target.value);
                            }}
                            className={`${composerSelectClassName} max-w-[220px] bg-[var(--bg-primary)] text-[var(--text-primary)]`}
                            title="Compare model A"
                          >
                            {compareModels.length > 0
                              ? compareModels.map((m) => <option key={m.name} value={m.name}>A: {modelDisplayName(m.name)}</option>)
                              : <option value={compareModelA}>{compareModelA ? `A: ${modelDisplayName(compareModelA)}` : "Model A"}</option>
                            }
                          </select>
                          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        </div>

                        <div className="relative max-w-[220px]">
                          <select
                            value={compareModelB}
                            onChange={(e) => {
                              setCompareModelB(e.target.value);
                              saveCompareB(e.target.value);
                              persistSetting("compare_model_b", e.target.value);
                            }}
                            className={`${composerSelectClassName} max-w-[220px] bg-[var(--bg-primary)] text-[var(--text-primary)]`}
                            title="Compare model B"
                          >
                            {compareModels.length > 0
                              ? compareModels.map((m) => <option key={m.name} value={m.name}>B: {modelDisplayName(m.name)}</option>)
                              : <option value={compareModelB}>{compareModelB ? `B: ${modelDisplayName(compareModelB)}` : "Model B"}</option>
                            }
                          </select>
                          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        </div>

                        <button
                          onClick={() => setActiveSubView("chat")}
                          title="Close model comparison"
                          className={`${composerToggleBaseClass} ${composerToggleActiveClass}`}
                        >
                          <SplitSquareHorizontal size={13} />
                          <span>Compare</span>
                        </button>

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
                          title="Refresh models"
                          className={`${composerToggleBaseClass} ${composerToggleInactiveClass}`}
                        >
                          <RefreshCw size={13} />
                          <span>Refresh</span>
                        </button>
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
              <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                confirmDialog.tone === "danger"
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
                className={`rounded-xl px-4 py-2 text-sm text-white hover:opacity-90 ${
                  confirmDialog.tone === "danger" ? "bg-red-500" : "bg-[var(--accent-color)]"
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
