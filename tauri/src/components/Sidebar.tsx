import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useChatStore, findUnusedSession, type ChatSession } from "../stores/chatStore";
import { useNavigate, useLocation } from "react-router-dom";
import {
  SquarePen, BarChart2, Folder, Settings,
  MessageSquare, ChevronRight, ChevronDown, FileEdit,
  FileText, Globe, Network, CreditCard,
  Check, Trash2, Ghost, MoveRight, X, FolderPlus, Search, Shield, Brain,
  MoreHorizontal, Pencil, Pin, PinOff, ExternalLink,
} from "lucide-react";

import { api } from "../lib/api";
import { MOD_KEY } from "../lib/platform";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "../stores/settingsStore";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) {return "now";}
  if (m < 60) {return `${m}m`;}
  const h = Math.floor(m / 60);
  if (h < 24) {return `${h}h`;}
  return `${Math.floor(h / 24)}d`;
}

interface SidebarProps {
  onOpenCommandPalette: () => void;
  showWorkspaceNavigation?: boolean;
  showSectionNavigation?: boolean;
}

export default function Sidebar({
  onOpenCommandPalette: _onOpenCommandPalette,
  showWorkspaceNavigation = true,
  showSectionNavigation = true,
}: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeProjectId, activeWorkspaceId, setActiveProjectId, setActiveWorkspaceId, workspaces, projectsByWorkspace, projects: fallbackProjects, setWorkspaces, setProjectsForWorkspace, setWorkspaceTopicSignature } = useWorkspaceStore();
  const { sessions, messages, setActiveChatId } = useChatStore();
  const { immediateDelete, confirmMoveToTrash } = useSettingsStore();
  const projects = activeWorkspaceId ? (projectsByWorkspace[activeWorkspaceId] ?? fallbackProjects) : fallbackProjects;

  const activeSegment = "/" + location.pathname.split("/")[1];
  const activeChatId = location.pathname.startsWith("/chat/") ? location.pathname.split("/")[2] : null;

  const activeWs = workspaces.find(w => w.id === activeWorkspaceId);

  // Load ALL workspace sessions for sidebar (unfiltered by project)
  const [allSessions, setAllSessions] = useState<ChatSession[]>([]);
  const [chatSearch, setChatSearch] = useState("");

  useEffect(() => {
    if (!activeWorkspaceId) {
      setAllSessions([]);
      return;
    }

    const trimmedQuery = chatSearch.trim();
    const timeoutId = window.setTimeout(() => {
      const request = trimmedQuery
        ? api.chat.searchSessions(activeWorkspaceId, trimmedQuery, null)
        : api.chat.listSessions(activeWorkspaceId, null);

      request.then(setAllSessions).catch(() => {});
    }, trimmedQuery ? 150 : 0);

    return () => window.clearTimeout(timeoutId);
  }, [activeWorkspaceId, chatSearch, sessions]);

  // Build project groups from all sessions
  const byProject: Record<string, ChatSession[]> = {};
  const ungrouped: ChatSession[] = [];
  allSessions.forEach((s) => {
    if (s.project_id) {
      (byProject[s.project_id] ??= []).push(s);
    } else {
      ungrouped.push(s);
    }
  });

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Inline folder creation
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; session: ChatSession } | null>(null);

  async function refreshSidebarData(workspaceId: string) {
    const [refreshedSessions, refreshedProjects, refreshedSignature, refreshedWorkspaces] = await Promise.all([
      api.chat.listSessions(workspaceId, null),
      api.project.list(workspaceId),
      api.topicSignature.get(workspaceId),
      api.workspace.list(),
    ]);
    setAllSessions(refreshedSessions);
    setProjectsForWorkspace(workspaceId, refreshedProjects);
    setWorkspaceTopicSignature(workspaceId, refreshedSignature);
    setWorkspaces(refreshedWorkspaces);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {next.delete(id);}
      else {next.add(id);}
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
    setMoveMenuOpen(false);
  }

  async function moveSelectedToFolder(projectId: string | null) {
    if (selectedIds.size === 0 || !activeWorkspaceId) {return;}
    try {
      await api.chat.moveSessions(Array.from(selectedIds), activeWorkspaceId, projectId ?? undefined);
      await refreshSidebarData(activeWorkspaceId);
      exitSelectMode();
    } catch (e) {
      console.error("Failed to move sessions:", e);
    }
  }

  async function moveSessionToFolder(sessionId: string, projectId: string | null) {
    if (!activeWorkspaceId) {return;}
    try {
      await api.chat.moveSessions([sessionId], activeWorkspaceId, projectId ?? undefined);
      await refreshSidebarData(activeWorkspaceId);
    } catch (e) {
      console.error("Failed to move session:", e);
    }
  }

  async function handleCreateFolder(nameOverride?: string) {
    const folderName = (nameOverride ?? newFolderName).trim();
    const previousProjectId = activeProjectId;
    if (!folderName || !activeWorkspaceId) {
      setCreatingFolder(false);
      setNewFolderName("");
      return;
    }
    try {
      await api.project.create(activeWorkspaceId, folderName);
      const refreshedProjects = await api.project.list(activeWorkspaceId);
      setProjectsForWorkspace(activeWorkspaceId, refreshedProjects);
      setActiveProjectId(previousProjectId);
    } catch (e) {
      console.error(e);
    }
    setCreatingFolder(false);
    setNewFolderName("");
  }

  function cancelCreateFolder() {
    setCreatingFolder(false);
    setNewFolderName("");
  }

  useEffect(() => {
    if (!creatingFolder || !folderInputRef.current) {return;}
    if (document.activeElement !== folderInputRef.current) {
      folderInputRef.current.focus();
    }
  }, [creatingFolder, newFolderName]);

  async function handleNewThread(options?: { isIncognito?: boolean; excludeFromAnalytics?: boolean }) {
    if (!activeWorkspaceId) {return;}
    const privacy = {
      isIncognito: options?.isIncognito ?? false,
      excludeFromAnalytics: options?.excludeFromAnalytics ?? false,
    };

    const workspaceSessions = await api.chat.listSessions(activeWorkspaceId, null);
    const unusedSession = findUnusedSession(
      workspaceSessions,
      messages,
      activeWorkspaceId,
    );
    if (unusedSession) {
      setActiveChatId(unusedSession.id);
      if (!sessions.some((session) => session.id === unusedSession.id)) {
        useChatStore.getState().addSession(unusedSession);
      }
      navigate(`/chat/${unusedSession.id}`);
      return;
    }

    try {
      const s = await api.chat.createSession(activeWorkspaceId, activeProjectId, {
        is_incognito: privacy.isIncognito,
        exclude_from_analytics: privacy.excludeFromAnalytics,
      });
      navigate(`/chat/${s.id}`);
    } catch (e) {
      console.error(e);
    }
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  useEffect(() => {
    if (!ctxMenu) {return;}

    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-chat-context-menu]")) {return;}
      setCtxMenu(null);
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
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

  function openSession(sessionId: string) {
    setActiveChatId(sessionId);
    navigate(`/chat/${sessionId}`);
  }

  async function renameSession(sessionId: string) {
    const nextTitle = renameTitle.trim();
    if (!nextTitle || !activeWorkspaceId) {
      setRenamingId(null);
      setRenameTitle("");
      return;
    }

    try {
      await api.chat.updateSession(activeWorkspaceId, sessionId, { title: nextTitle });
      useChatStore.getState().setSessions(
        useChatStore.getState().sessions.map((session) =>
          session.id === sessionId ? { ...session, title: nextTitle } : session
        )
      );
      setAllSessions((prev) => prev.map((session) => (
        session.id === sessionId ? { ...session, title: nextTitle } : session
      )));
    } catch (e) {
      console.error("Failed to rename session:", e);
    } finally {
      setRenamingId(null);
      setRenameTitle("");
    }
  }

  async function togglePinned(session: ChatSession) {
    if (!activeWorkspaceId) {return;}
    try {
      await api.chat.updateSession(activeWorkspaceId, session.id, { is_pinned: !session.is_pinned });
      const updateSession = (item: ChatSession) => item.id === session.id ? { ...item, is_pinned: !session.is_pinned } : item;
      useChatStore.getState().setSessions(useChatStore.getState().sessions.map(updateSession));
      setAllSessions((prev) => prev.map(updateSession));
    } catch (e) {
      console.error("Failed to toggle pin:", e);
    }
  }

  async function deleteSession(session: ChatSession) {
    if (!activeWorkspaceId) {return;}
    const isImmediate = immediateDelete;
    const skipConfirm = !isImmediate && !confirmMoveToTrash;

    if (!skipConfirm) {
      const confirmMsg = isImmediate
        ? "Permanently delete this chat session and all its messages? This cannot be undone."
        : "Move this chat to the recycle bin?";

      if (!await confirm(confirmMsg)) {return;}
    }

    try {
      await api.chat.deleteSession(activeWorkspaceId, session.id);
      useChatStore.getState().removeSession(session.id);
      setAllSessions((prev) => prev.filter((item) => item.id !== session.id));
      if (activeChatId === session.id) {
        setActiveChatId(null);
      }
    } catch (e) {
      console.error("Failed to delete session:", e);
    }
  }

  function openContextMenu(e: ReactMouseEvent, session: ChatSession) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, session });
  }

  function renderThreadItem(s: ChatSession) {
    const msgCount = s.message_count_at_title_gen ?? 0;
    const isSelected = selectedIds.has(s.id);
    const isRenaming = renamingId === s.id;
    return (
      <div
        key={s.id}
        className="flex items-center gap-0.5 group"
        draggable={!selectMode}
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-chat-session-ids", JSON.stringify([s.id]));
          e.dataTransfer.effectAllowed = "move";
        }}
        onContextMenu={(e) => openContextMenu(e, s)}
      >
        {selectMode && (
          <button
            onClick={(e) => { e.stopPropagation(); toggleSelect(s.id); }}
            className={`ml-2 w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
              isSelected
                ? "bg-[var(--accent-color)] border-[var(--accent-color)]"
                : "border-[var(--text-muted)] hover:border-[var(--text-primary)]"
            }`}
          >
            {isSelected && <Check size={8} className="text-white" />}
          </button>
        )}
        <div
          className={`w-full flex items-start justify-between gap-2 ${selectMode ? "pl-1" : "pl-7"} pr-2 py-1.5 rounded-lg text-xs transition-colors ${
            isSelected
              ? "bg-[var(--accent-color)]/10 text-[var(--accent-color)]"
              : activeChatId === s.id
                ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          }`}
        >
          <div className="min-w-0 flex-1 flex items-center gap-1.5 text-left">
            {isRenaming ? (
              <input
                autoFocus
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void renameSession(s.id);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setRenamingId(null);
                    setRenameTitle("");
                  }
                }}
                onBlur={() => void renameSession(s.id)}
                onClick={(e) => e.stopPropagation()}
                className="w-full rounded border border-[var(--accent-color)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs text-[var(--text-primary)] outline-none"
              />
            ) : (
              <button
                onClick={() => selectMode ? toggleSelect(s.id) : openSession(s.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span
                  className="block overflow-hidden text-ellipsis leading-4"
                  style={{
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: 2,
                  }}
                >
                  {s.title || "New Chat"}
                </span>
              </button>
            )}
            {s.is_incognito && <Ghost size={11} className="text-purple-400 flex-shrink-0" />}
            {!s.is_incognito && s.exclude_from_analytics && <Shield size={11} className="text-sky-400 flex-shrink-0" />}
          </div>
          <span className="mt-0.5 flex items-center gap-1.5 flex-shrink-0 text-[10px] text-[var(--text-muted)]">
            {msgCount > 0 && <span>{msgCount}</span>}
            <button
              onClick={(e) => openContextMenu(e, s)}
              className="rounded p-0.5 opacity-70 transition-opacity hover:bg-[var(--bg-hover)] hover:opacity-100"
              title="Thread actions"
            >
              <MoreHorizontal size={11} />
            </button>
            <span>{timeAgo(s.updated_at)}</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-transparent text-sm select-none pt-1">
      {showWorkspaceNavigation && activeWs && (
        <div className="px-3 pb-2">
          <div className="relative">
            <select
              value={activeWorkspaceId ?? ""}
              onChange={(e) => setActiveWorkspaceId(e.target.value || null)}
              className="h-9 w-full appearance-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] pl-3 pr-8 text-sm text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--accent-color)] focus:border-[var(--accent-color)]"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          </div>
        </div>
      )}

      {/* Top Primary Actions */}
      <div className="px-3 pb-4 space-y-0.5">
        <div className="flex gap-0.5 mb-1">
          <button
            onClick={() => handleNewThread()}
            className="flex-1 flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <SquarePen size={14} className="text-[var(--text-muted)]" />
            New thread
          </button>
          <button
            onClick={() => handleNewThread({ isIncognito: true })}
            className="px-2 py-1.5 rounded-lg text-[var(--text-muted)] hover:bg-purple-500/10 hover:text-purple-400 transition-colors"
            title="New incognito thread (excluded from analytics and deleted when you leave it)"
          >
            <Ghost size={14} />
          </button>
          <button
            onClick={() => handleNewThread({ excludeFromAnalytics: true })}
            className="px-2 py-1.5 rounded-lg text-[var(--text-muted)] hover:bg-sky-500/10 hover:text-sky-400 transition-colors"
            title="New private thread (saved, but excluded from analytics and memory)"
          >
            <Shield size={14} />
          </button>
        </div>

        {showSectionNavigation && (
          <>
            <button
              onClick={() => navigate("/project")}
              title={`Dashboard (${MOD_KEY}⇧D)`}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                activeSegment === "/project" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <BarChart2 size={14} className="text-[var(--text-muted)]" />
              Dashboard
            </button>

            <button
              onClick={() => navigate("/memory")}
              title={`Memory (${MOD_KEY}⇧M)`}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                activeSegment === "/memory" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Brain size={14} className="text-[var(--text-muted)]" />
              Memory
            </button>

            <button
              onClick={() => navigate("/notes")}
              title={`Notes (${MOD_KEY}⇧N)`}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                activeSegment === "/notes" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <FileEdit size={14} className="text-[var(--text-muted)]" />
              Notes
            </button>

            <button
              onClick={() => navigate("/documents")}
              title={`Documents (${MOD_KEY}⇧O)`}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                activeSegment === "/documents" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <FileText size={14} className="text-[var(--text-muted)]" />
              Documents
            </button>

            <button
              onClick={() => navigate("/recycle-bin")}
              title={`Recycle Bin (${MOD_KEY}⇧R)`}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                activeSegment === "/recycle-bin" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Trash2 size={14} className="text-[var(--text-muted)]" />
              Recycle Bin
            </button>

            <button
              onClick={() => navigate("/webcapture")}
              title={`Web Captures (${MOD_KEY}⇧W)`}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                activeSegment === "/webcapture" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Globe size={14} className="text-[var(--text-muted)]" />
              Web Captures
            </button>

            <button
              onClick={() => navigate("/graph")}
              title={`Knowledge Graph (${MOD_KEY}⇧G)`}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                activeSegment === "/graph" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Network size={14} className="text-[var(--text-muted)]" />
              Knowledge Graph
            </button>

            <button
              onClick={() => navigate("/flashcards")}
              title={`Flashcards (${MOD_KEY}⇧F)`}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                activeSegment === "/flashcards" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <CreditCard size={14} className="text-[var(--text-muted)]" />
              Flashcards
            </button>
          </>
        )}
      </div>

      {/* Threads Section */}
      <div className="flex-1 overflow-y-auto px-3 space-y-0.5 mt-2">
        <div className="flex items-center justify-between text-[10px] font-semibold tracking-wider text-[var(--text-muted)] px-2 mb-2 uppercase">
          <span>Threads</span>
          <div className="flex items-center gap-1">
            {selectMode ? (
              <>
                <div className="relative">
                  <button
                    onClick={() => setMoveMenuOpen((v) => !v)}
                    disabled={selectedIds.size === 0}
                    className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-30"
                    title="Move to folder"
                  >
                    <MoveRight size={12} />
                  </button>
                  {moveMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 z-50 w-40 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-lg shadow-lg py-1 text-[11px] text-[var(--text-primary)]">
                      <button
                        onClick={() => moveSelectedToFolder(null)}
                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2"
                      >
                        <MessageSquare size={11} className="text-[var(--text-muted)]" />
                        Ungrouped
                      </button>
                      {projects.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => moveSelectedToFolder(p.id)}
                          className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2"
                        >
                          <Folder size={11} className="text-[var(--text-muted)]" />
                          <span className="truncate">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-[9px] normal-case tracking-normal text-[var(--text-secondary)]">
                  {selectedIds.size} sel
                </span>
                <button
                  onClick={exitSelectMode}
                  className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  title="Cancel selection"
                >
                  <X size={12} />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setSelectMode(true)}
                  className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  title="Select & move threads"
                >
                  <Check size={12} />
                </button>
                <button
                  onClick={() => { setCreatingFolder(true); setNewFolderName(""); }}
                  className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  title="New folder"
                >
                  <FolderPlus size={12} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Inline folder creation */}
        {creatingFolder && (
          <div className="flex items-center gap-1 px-2 mb-2">
            <Folder size={12} className="text-[var(--text-muted)] flex-shrink-0" />
            <input
              ref={folderInputRef}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
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
              className="flex-1 text-xs bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded px-1.5 py-1 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void handleCreateFolder(folderInputRef.current?.value)}
              className="p-1 rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
              title="Create folder"
            >
              <Check size={12} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={cancelCreateFolder}
              className="p-1 rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
              title="Cancel folder creation"
            >
              <X size={12} />
            </button>
          </div>
        )}

        <div className="relative px-2 mb-2">
          <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          <input
            value={chatSearch}
            onChange={(e) => setChatSearch(e.target.value)}
            placeholder={activeProjectId ? "Search threads in workspace..." : "Search threads..."}
            className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1.5 pl-7 pr-7 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent-color)]"
          />
          {chatSearch && (
            <button
              onClick={() => setChatSearch("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="Clear chat search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {chatSearch.trim() && (
          <div className="px-2 mb-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Searching all chats in this workspace
          </div>
        )}

        {/* Unfiltered Conversations */}
        <button
          onClick={() => setActiveProjectId(null)}
          className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
            activeProjectId === null
              ? "text-[var(--text-primary)] bg-[var(--bg-hover)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <MessageSquare size={14} className="text-[var(--text-muted)] flex-shrink-0" />
          <span className="truncate">All Conversations</span>
        </button>

        {/* Project folders */}
        {projects.map((p) => {
          const threads = byProject[p.id] ?? [];
          const isOpen = expanded[p.id] ?? true; // default open
          const visibleThreads = isOpen ? threads.slice(0, expanded[`${p.id}_all`] ? undefined : 5) : [];
          const hasMore = threads.length > 5 && !expanded[`${p.id}_all`];

          return (
            <div key={p.id} className="mb-1">
              {/* Project folder header */}
              <button
                onClick={() => {
                  setActiveProjectId(p.id);
                  if (activeProjectId === p.id) {toggleExpand(p.id);}
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("application/x-chat-session-ids")) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverFolderId(p.id);
                  }
                }}
                onDragLeave={() => setDragOverFolderId(null)}
                onDrop={async (e) => {
                  e.preventDefault();
                  setDragOverFolderId(null);
                  const data = e.dataTransfer.getData("application/x-chat-session-ids");
                  if (!data || !activeWorkspaceId) {return;}
                  try {
                    const ids: string[] = JSON.parse(data);
                    await api.chat.moveSessions(ids, activeWorkspaceId, p.id);
                    await refreshSidebarData(activeWorkspaceId);
                  } catch (err) {
                    console.error("Failed to move sessions:", err);
                  }
                }}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                  dragOverFolderId === p.id
                    ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)] ring-1 ring-[var(--accent-color)]"
                    : activeProjectId === p.id
                      ? "text-[var(--text-primary)] bg-[var(--bg-hover)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Folder size={14} className="text-[var(--text-muted)] flex-shrink-0" />
                <span className="truncate flex-1 text-left">{p.name}</span>
                <ChevronDown size={12} className={`text-[var(--text-muted)] transition-transform ${isOpen ? "" : "-rotate-90"}`} />
              </button>

              {/* Threads under this project */}
              {isOpen && visibleThreads.map(renderThreadItem)}

              {isOpen && hasMore && (
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [`${p.id}_all`]: true }))}
                  className="w-full pl-7 pr-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-color)] text-left transition-colors"
                >
                  Show more
                </button>
              )}
              {isOpen && threads.length > 5 && expanded[`${p.id}_all`] && (
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [`${p.id}_all`]: false }))}
                  className="w-full pl-7 pr-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-color)] text-left transition-colors"
                >
                  Show less
                </button>
              )}
            </div>
          );
        })}

        {/* Ungrouped threads (no project) */}
        {(ungrouped.length > 0 || projects.length > 0) && (
          <div className="mb-1">
            {projects.length > 0 && (
              <div
                className={`px-2 py-1.5 text-[13px] font-medium flex items-center gap-1.5 rounded-lg transition-colors ${
                  dragOverFolderId === "__ungrouped"
                    ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)] ring-1 ring-[var(--accent-color)]"
                    : "text-[var(--text-secondary)]"
                }`}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("application/x-chat-session-ids")) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverFolderId("__ungrouped");
                  }
                }}
                onDragLeave={() => setDragOverFolderId(null)}
                onDrop={async (e) => {
                  e.preventDefault();
                  setDragOverFolderId(null);
                  const data = e.dataTransfer.getData("application/x-chat-session-ids");
                  if (!data || !activeWorkspaceId) {return;}
                  try {
                    const ids: string[] = JSON.parse(data);
                    await api.chat.moveSessions(ids, activeWorkspaceId);
                    await refreshSidebarData(activeWorkspaceId);
                  } catch (err) {
                    console.error("Failed to move sessions:", err);
                  }
                }}
              >
                <Folder size={14} className="text-[var(--text-muted)] flex-shrink-0" />
                <span>Ungrouped</span>
              </div>
            )}
            {ungrouped.slice(0, expanded["__ungrouped_all"] ? undefined : 5).map(renderThreadItem)}
            {ungrouped.length > 5 && !expanded["__ungrouped_all"] && (
              <button
                onClick={() => setExpanded((prev) => ({ ...prev, ["__ungrouped_all"]: true }))}
                className="w-full pl-7 pr-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-color)] text-left transition-colors"
              >
                Show more
              </button>
            )}
            {ungrouped.length > 5 && expanded["__ungrouped_all"] && (
              <button
                onClick={() => setExpanded((prev) => ({ ...prev, ["__ungrouped_all"]: false }))}
                className="w-full pl-7 pr-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-color)] text-left transition-colors"
              >
                Show less
              </button>
            )}
          </div>
        )}

        {chatSearch.trim() && allSessions.length === 0 && (
          <div className="px-2 py-4 text-xs text-[var(--text-muted)]">
            No chats matched this workspace search.
          </div>
        )}
      </div>

      {/* Bottom Actions */}
      <div className="p-3">
        <button
          onClick={() => navigate("/settings")}
          title={`Settings (${MOD_KEY},)`}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors border border-transparent ${
            activeSegment === "/settings"
              ? "bg-[var(--bg-elevated)] border-[var(--border-color)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:border-[var(--border-color)] hover:text-[var(--text-primary)]"
          }`}
        >
          <div className="flex items-center gap-2">
            <Settings size={14} />
            Settings
          </div>
          <ChevronRight size={14} className="text-[var(--text-muted)]" />
        </button>
      </div>

      {ctxMenu && (
        <div
          data-chat-context-menu
          className="fixed z-50 min-w-[180px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-xl"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            onClick={() => {
              openSession(ctxMenu.session.id);
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
              void togglePinned(ctxMenu.session);
              setCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            {ctxMenu.session.is_pinned ? <PinOff size={11} /> : <Pin size={11} />}
            {ctxMenu.session.is_pinned ? "Unpin" : "Pin"}
          </button>
          <div className="my-1 border-t border-[var(--border-color)]" />
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Move to
          </div>
          <button
            onClick={() => {
              void moveSessionToFolder(ctxMenu.session.id, null);
              setCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <MessageSquare size={11} /> Ungrouped
          </button>
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => {
                void moveSessionToFolder(ctxMenu.session.id, project.id);
                setCtxMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <Folder size={11} /> <span className="truncate">{project.name}</span>
            </button>
          ))}
          <div className="my-1 border-t border-[var(--border-color)]" />
          <button
            onClick={() => {
              void deleteSession(ctxMenu.session);
              setCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-[var(--bg-hover)]"
          >
            <Trash2 size={11} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
