import { useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useChatStore, findUnusedSession, type ChatSession } from "../stores/chatStore";
import { useNavigate, useLocation } from "react-router-dom";
import {
  SquarePen, BarChart2, Folder, Settings,
  MessageSquare, ChevronRight, ChevronDown, FileEdit,
  FileText, Globe, Network, CreditCard, Inbox,
  Check, Trash2, Ghost, MoveRight, X, FolderPlus, Search, Shield,
} from "lucide-react";

import { api } from "../lib/api";
import { MOD_KEY } from "../lib/platform";

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
}

export default function Sidebar({ onOpenCommandPalette }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeProjectId, activeWorkspaceId, projects, setActiveProjectId, workspaces, setWorkspaces, setProjects, setWorkspaceTopicSignature } = useWorkspaceStore();
  const { sessions, messages, setActiveChatId } = useChatStore();

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
      // Trigger refresh by touching sessions
      const [refreshedSessions, refreshedProjects, refreshedSignature, refreshedWorkspaces] = await Promise.all([
        api.chat.listSessions(activeWorkspaceId, null),
        api.project.list(activeWorkspaceId),
        api.topicSignature.get(activeWorkspaceId),
        api.workspace.list(),
      ]);
      setAllSessions(refreshedSessions);
      setProjects(refreshedProjects);
      setWorkspaceTopicSignature(activeWorkspaceId, refreshedSignature);
      setWorkspaces(refreshedWorkspaces);
      exitSelectMode();
    } catch (e) {
      console.error("Failed to move sessions:", e);
    }
  }

  async function handleCreateFolder(nameOverride?: string) {
    const folderName = (nameOverride ?? newFolderName).trim();
    if (!folderName || !activeWorkspaceId) {
      setCreatingFolder(false);
      setNewFolderName("");
      return;
    }
    try {
      const p = await api.project.create(activeWorkspaceId, folderName);
      useWorkspaceStore.getState().addProject(p);
      setActiveProjectId(p.id);
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

  function renderThreadItem(s: ChatSession) {
    const msgCount = s.message_count_at_title_gen ?? 0;
    const isSelected = selectedIds.has(s.id);
    return (
      <div
        key={s.id}
        className="flex items-center gap-0.5"
        draggable={!selectMode}
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-chat-session-ids", JSON.stringify([s.id]));
          e.dataTransfer.effectAllowed = "move";
        }}
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
        <button
          onClick={() => selectMode ? toggleSelect(s.id) : navigate(`/chat/${s.id}`)}
          className={`w-full flex items-center justify-between ${selectMode ? "pl-1" : "pl-7"} pr-2 py-1.5 rounded-lg text-xs transition-colors group ${
            isSelected
              ? "bg-[var(--accent-color)]/10 text-[var(--accent-color)]"
              : activeChatId === s.id
                ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          }`}
        >
          <span className="truncate pr-2 flex-1 text-left flex items-center gap-1.5">
            <span className="truncate">{s.title || "New Chat"}</span>
            {s.is_incognito && <Ghost size={11} className="text-purple-400 flex-shrink-0" />}
            {!s.is_incognito && s.exclude_from_analytics && <Shield size={11} className="text-sky-400 flex-shrink-0" />}
          </span>
          <span className="flex items-center gap-1.5 flex-shrink-0 text-[10px] text-[var(--text-muted)]">
            {msgCount > 0 && <span>{msgCount}</span>}
            <ChevronRight size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            <span>{timeAgo(s.updated_at)}</span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-transparent text-sm select-none pt-3">
      {/* Active Workspace Label */}
      {activeWs && (
        <div className="px-3 pb-2 flex items-center justify-between group/ws">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] truncate">
            {activeWs.name}
          </span>
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

        <button
          onClick={() => navigate("/thoughts")}
          className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
            activeSegment === "/thoughts" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Inbox size={14} className="text-[var(--text-muted)]" />
          Thought Queue
        </button>
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
              className="flex-1 text-xs bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded px-1.5 py-1 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
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
                    const [refreshedSessions, refreshedProjects, refreshedSignature, refreshedWorkspaces] = await Promise.all([
                      api.chat.listSessions(activeWorkspaceId, null),
                      api.project.list(activeWorkspaceId),
                      api.topicSignature.get(activeWorkspaceId),
                      api.workspace.list(),
                    ]);
                    setAllSessions(refreshedSessions);
                    setProjects(refreshedProjects);
                    setWorkspaceTopicSignature(activeWorkspaceId, refreshedSignature);
                    setWorkspaces(refreshedWorkspaces);
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
                    const [refreshedSessions, refreshedProjects, refreshedSignature, refreshedWorkspaces] = await Promise.all([
                      api.chat.listSessions(activeWorkspaceId, null),
                      api.project.list(activeWorkspaceId),
                      api.topicSignature.get(activeWorkspaceId),
                      api.workspace.list(),
                    ]);
                    setAllSessions(refreshedSessions);
                    setProjects(refreshedProjects);
                    setWorkspaceTopicSignature(activeWorkspaceId, refreshedSignature);
                    setWorkspaces(refreshedWorkspaces);
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
    </div>
  );
}
