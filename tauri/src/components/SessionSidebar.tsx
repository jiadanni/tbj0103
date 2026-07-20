/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useLayoutEffect, useRef, useState, memo, useMemo, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Virtuoso } from "react-virtuoso";
import { Plus, Trash2, ChevronDown, ChevronRight, Pencil, Check, Search, Pin, PinOff, MessageSquare, RefreshCw, Ghost, Shield, Folder as FolderIcon, FolderOpen, FolderPlus, MoreHorizontal, MoveRight, X, Loader2, Copy, ExternalLink, Save, FileText, BookOpen, BarChart2 } from "lucide-react";
import { api } from "../lib/api";
import { useChatStore } from "../stores/chatStore";
import { useWorkspaceStore, type Folder, type Workspace } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { ChatSession, Message } from "../stores/chatStore";
import { Tooltip } from "./Tooltip";
import ConvertChatModal, { type ConvertKind } from "./ConvertChatModal";
import { useScopedWorkspace, useWorkspacePane, useBubbleUpFlag } from "../lib/workspacePane";

// ── Session sidebar types ─────────────────────────────────────────────────────
export interface SessionItemProps {
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
  onSessionClick: (id: string, modifiers: { shift: boolean; meta: boolean; ctrl: boolean }) => void;
  openContextMenu: (event: ReactMouseEvent, session: ChatSession) => void;
  renameSession: (id: string) => void;
}

export interface SessionSidebarProps {
  sidebarSessions: ChatSession[];
  workspaces: Workspace[];
  foldersByWorkspace: Record<string, Folder[]>;
  folders: Folder[];
  activeFolderId: string | null;
  setActiveFolderId: (folderId: string | null) => void;
  activeFolder: Folder | null;
  moveSessionsToTarget: (sessionIds: string[], workspaceId: string, folderId: string | null) => Promise<void>;
  bulkDeleteSessions: (sessionIds: string[], folderIds?: string[]) => Promise<void>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  moveFolderToWorkspace: (folder: Folder, targetWorkspaceId: string) => Promise<void>;
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
  toggleExcludeFromAnalytics: (session: ChatSession) => void;
  saveSession: (session: ChatSession) => void;
  deleteSession: (id: string) => void;
  showAlertDialog: (title: string, description: string, tone?: "danger" | "default") => void;
  sidebarWidth: number;
  openSession: (session: ChatSession) => void;
}

type WorkspaceFolderFlyoutState = {
  mode: "session-move" | "bulk-move";
  workspaceId: string;
  workspaceName: string;
  folders: Folder[];
  left: number;
  top: number;
  maxHeight: number;
};

type SessionSidebarRow =
  | { type: "session"; key: string; session: ChatSession; depth: number; showFolderBorder: boolean }
  | { type: "folder"; key: string; folder: Folder; isOpen: boolean; expandKey: string; depth: number }
  | { type: "workspace"; key: string; workspace: Workspace; isOpen: boolean };

const MIN_SESSION_SIDEBAR_WIDTH = 220;
const MAX_SESSION_SIDEBAR_WIDTH = 420;
const MIN_SPLIT_SESSION_SIDEBAR_WIDTH = 180;
const MAX_SPLIT_SESSION_SIDEBAR_WIDTH = 248;

export function clampSessionSidebarWidth(width: number, isSplitPane = false) {
  const minWidth = isSplitPane ? MIN_SPLIT_SESSION_SIDEBAR_WIDTH : MIN_SESSION_SIDEBAR_WIDTH;
  const maxWidth = isSplitPane ? MAX_SPLIT_SESSION_SIDEBAR_WIDTH : MAX_SESSION_SIDEBAR_WIDTH;
  return Math.max(minWidth, Math.min(width, maxWidth));
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

export function SessionItem({
  session, activeChatId, selectMode, isSelected, renamingId, renameTitle,
  depth = 0,
  setRenamingId, setRenameTitle, openSession,
  toggleSelect, onSessionClick, openContextMenu,
  renameSession,
}: SessionItemProps) {
  const isSplitPane = useWorkspacePane() !== null;
  const isActive = activeChatId === session.id;
  const isRenaming = renamingId === session.id;

  const timeAgo = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const diff = Date.now() - new Date(session.updated_at).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) { return "now"; }
    if (m < 60) { return `${m}m`; }
    const h = Math.floor(m / 60);
    if (h < 24) { return `${h}h`; }
    return `${Math.floor(h / 24)}d`;
  }, [session.updated_at]);

  return (
    <div
      draggable={!selectMode}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", session.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onContextMenu={(e) => openContextMenu(e, session)}
      onClick={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          onSessionClick(session.id, { shift: e.shiftKey, meta: e.metaKey, ctrl: e.ctrlKey });
        } else if (selectMode) {
          toggleSelect(session.id);
        } else {
          openSession(session);
        }
      }}
      className={`group flex min-w-0 cursor-pointer select-none items-center gap-1 rounded-xl border border-transparent px-3 py-2 transition-colors ${isSelected
        ? "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)]"
        : isActive
          ? "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        }`}
      style={{ paddingLeft: `${12 + depth * 20}px` }}
    >
      {selectMode && (
        <button
          onClick={(e) => { e.stopPropagation(); toggleSelect(session.id); }}
          className={`mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${isSelected
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
            if (e.key === "Enter") { renameSession(session.id); }
            if (e.key === "Escape") { setRenamingId(null); }
          }}
          onBlur={() => renameSession(session.id)}
          onClick={(e) => e.stopPropagation()}
          className={`min-w-0 flex-1 bg-[var(--bg-elevated)] border border-[var(--accent-color)] rounded px-1.5 py-0.5 text-[var(--text-primary)] outline-none ${isSplitPane ? "text-xs" : "text-[11px]"
            }`}
        />
      ) : (
        <div className="min-w-0 flex flex-1 items-center gap-1.5">
          <Tooltip content={session.title || "New Chat"} position="right">
            <span className={`min-w-0 flex-1 truncate ${isSplitPane ? "text-sm" : "text-xs"}`}>
              {session.title || "New Chat"}
            </span>
          </Tooltip>
          {session.is_incognito && <Ghost size={isSplitPane ? 12 : 11} className="text-purple-400 shrink-0" />}
          {!session.is_incognito && session.exclude_from_analytics && <Shield size={isSplitPane ? 12 : 11} className="text-sky-400 shrink-0" />}
        </div>
      )}
      <div className={`relative ml-1 shrink-0 ${isSplitPane ? "h-5 w-[42px]" : "h-5 w-[44px]"}`}>
        <div
          className={`absolute inset-y-0 right-0 flex items-center justify-end transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 ${isRenaming ? "opacity-0" : "opacity-100"
            }`}
        >
          <span className={`text-[var(--text-muted)] ${isSplitPane ? "text-[10px]" : "text-[10px]"}`}>
            {timeAgo}
          </span>
        </div>
        <div className="invisible absolute inset-y-0 right-0 flex items-center justify-end opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
          <Tooltip content="More actions" position="top">
            <button
              onClick={(e) => { e.stopPropagation(); openContextMenu(e, session); }}
              className={`rounded hover:text-[var(--accent-color)] transition-colors ${isSplitPane ? "p-1" : "p-0.5"}`}
            >
              <MoreHorizontal size={isSplitPane ? 12 : 10} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

export const SessionSidebar = memo(function SessionSidebar({
  sidebarSessions, workspaces, foldersByWorkspace, folders, activeFolderId: _activeFolderId, setActiveFolderId,
  activeFolder: _activeFolder, moveSessionsToTarget, bulkDeleteSessions, renameFolder, deleteFolder, moveFolderToWorkspace, createWorkspaceForMove, sessionQuery, setSessionQuery,
  creatingFolder, setCreatingFolder, newFolderName, setNewFolderName,
  creatingFolderPending,
  folderInputRef,
  handleCreateFolder,
  createNewSession,
  activeChatId,
  sidebarWidth,
  openSession,
  renamingId,
  renameTitle,
  setRenamingId,
  setRenameTitle,
  renameSession,
  refreshSessionTitle,
  togglePin,
  toggleExcludeFromAnalytics,
  saveSession,
  deleteSession,
  showAlertDialog,
}: SessionSidebarProps) {
  const isSplitPane = useWorkspacePane() !== null;
  const includeDescendants = useBubbleUpFlag();
  const { activeWorkspaceId: scopedWsId } = useScopedWorkspace();
  const childWorkspaces = useMemo(
    () => includeDescendants && scopedWsId
      ? workspaces.filter((ws) => ws.parent_workspace_id === scopedWsId)
      : [],
    [workspaces, scopedWsId, includeDescendants],
  );
  const clampedSidebarWidth = clampSessionSidebarWidth(sidebarWidth, isSplitPane);
  const [childWorkspaceSessionCounts, setChildWorkspaceSessionCounts] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIdRef = useRef<string | null>(null);
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [bulkFolderMoveOpen, setBulkFolderMoveOpen] = useState(false);
  const [_bulkMoveWorkspaceId, setBulkMoveWorkspaceId] = useState<string | null>(null);
  const [bulkActionPending, setBulkActionPending] = useState<"move" | "delete" | null>(null);
  const [folderRenamingId, setFolderRenamingId] = useState<string | null>(null);
  const [folderRenameValue, setFolderRenameValue] = useState("");
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const dragSessionIdsRef = useRef<string[] | null>(null);
  const [ctxMoveOpen, setCtxMoveOpen] = useState(false);
  const [ctxFolderMoveOpen, setCtxFolderMoveOpen] = useState(false);
  const [_ctxMoveWorkspaceId, setCtxMoveWorkspaceId] = useState<string | null>(null);
  const [ctxFolderMoveWorkspaceId, setCtxFolderMoveWorkspaceId] = useState<string | null>(null);
  const [folderMoveShowCreate, setFolderMoveShowCreate] = useState(false);
  const [folderMoveNewName, setFolderMoveNewName] = useState("");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [showNewWorkspaceInput, setShowNewWorkspaceInput] = useState(false);
  const [workspaceMoveQuery, setWorkspaceMoveQuery] = useState("");
  const [workspaceFolderFlyout, setWorkspaceFolderFlyout] = useState<WorkspaceFolderFlyoutState | null>(null);
  const [ctxMenu, setCtxMenu] = useState<
    | { type: "session"; x: number; y: number; session: ChatSession }
    | { type: "folder"; x: number; y: number; folder: Folder }
    | null
  >(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (ctxMenu && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const padding = 8;
      const { innerWidth, innerHeight } = window;

      let newX = ctxMenu.x;
      let newY = ctxMenu.y;

      if (newX + rect.width > innerWidth - padding) {
        newX = innerWidth - rect.width - padding;
      }
      if (newY + rect.height > innerHeight - padding) {
        newY = innerHeight - rect.height - padding;
      }

      newX = Math.max(padding, newX);
      newY = Math.max(padding, newY);

      if (newX !== ctxMenu.x || newY !== ctxMenu.y) {
        setCtxMenu((current) => current ? { ...current, x: newX, y: newY } : null);
      }
    }
  }, [ctxMenu]);
  const [convertTarget, setConvertTarget] = useState<{ session: ChatSession; kind: ConvertKind } | null>(null);
  const ollamaUrl = useSettingsStore((s) => s.ollamaUrl);
  const navigate = useNavigate();
  const cancelCreateFolder = () => {
    setCreatingFolder(false);
    setNewFolderName("");
  };
  const visibleSessions = sidebarSessions;
  const byFolder: Record<string, ChatSession[]> = {};
  const ungrouped: ChatSession[] = [];
  const [sidebarTooltip, setSidebarTooltip] = useState<{ label: string; top: number; left: number } | null>(null);
  const selectedCount = selectedIds.size + selectedFolderIds.size;

  const showSidebarTooltip = (label: string, e: ReactMouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setSidebarTooltip({
      label,
      top: rect.top + rect.height / 2,
      left: rect.right + 8,
    });
  };

  const hideSidebarTooltip = () => setSidebarTooltip(null);

  useEffect(() => {
    if (!scopedWsId || childWorkspaces.length === 0) {
      setChildWorkspaceSessionCounts({});
      return;
    }
    api.chat.countSessionsPerChildWorkspace(scopedWsId)
      .then(setChildWorkspaceSessionCounts)
      .catch(() => {});
  }, [scopedWsId, childWorkspaces.length]);

  visibleSessions.forEach((session) => {
    if (session.folder_id) {
      (byFolder[session.folder_id] ??= []).push(session);
    } else {
      ungrouped.push(session);
    }
  });

  // Group sessions by child workspace when in overview mode
  const byWorkspace: Record<string, ChatSession[]> = {};
  if (childWorkspaces.length > 0) {
    const childWsIds = new Set(childWorkspaces.map((ws) => ws.id));
    // Re-partition ungrouped into parent-owned vs child-owned
    const parentUngrouped: ChatSession[] = [];
    for (const session of ungrouped) {
      if (childWsIds.has(session.workspace_id)) {
        (byWorkspace[session.workspace_id] ??= []).push(session);
      } else {
        parentUngrouped.push(session);
      }
    }
    ungrouped.length = 0;
    ungrouped.push(...parentUngrouped);
    // Also partition folder-grouped sessions by workspace
    for (const [folderId, sessions] of Object.entries(byFolder)) {
      const parentSessions: ChatSession[] = [];
      for (const session of sessions) {
        if (childWsIds.has(session.workspace_id)) {
          (byWorkspace[session.workspace_id] ??= []).push(session);
        } else {
          parentSessions.push(session);
        }
      }
      if (parentSessions.length > 0) {
        byFolder[folderId] = parentSessions;
      } else {
        delete byFolder[folderId];
      }
    }
  }

  // Flat ordered list mirroring display order: ungrouped then per-folder sessions
  const flatOrderedSessionIds: string[] = [
    ...ungrouped.map((s) => s.id),
    ...folders.flatMap((p) => (byFolder[p.id] ?? []).map((s) => s.id)),
  ];

  function handleSessionClick(id: string, modifiers: { shift: boolean; meta: boolean; ctrl: boolean }) {
    if (modifiers.shift && lastSelectedIdRef.current) {
      // Range select from last selected to current
      const anchorIdx = flatOrderedSessionIds.indexOf(lastSelectedIdRef.current);
      const targetIdx = flatOrderedSessionIds.indexOf(id);
      if (anchorIdx !== -1 && targetIdx !== -1) {
        const lo = Math.min(anchorIdx, targetIdx);
        const hi = Math.max(anchorIdx, targetIdx);
        const rangeIds = flatOrderedSessionIds.slice(lo, hi + 1);
        setSelectMode(true);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const sid of rangeIds) { next.add(sid); }
          return next;
        });
        return;
      }
    }
    // Cmd/Ctrl+click: toggle individual item
    setSelectMode(true);
    lastSelectedIdRef.current = id;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  const shouldShowWorkspaceSearch = workspaces.length > 12;
  const normalizedWorkspaceMoveQuery = workspaceMoveQuery.trim().toLowerCase();
  const filteredWorkspaces = normalizedWorkspaceMoveQuery
    ? workspaces.filter((workspace) => workspace.name.toLowerCase().includes(normalizedWorkspaceMoveQuery))
    : workspaces;

  function openWorkspaceFolderFlyout(
    mode: WorkspaceFolderFlyoutState["mode"],
    workspace: Workspace,
    workspaceFolders: Folder[],
    anchor: HTMLElement,
  ) {
    const rect = anchor.getBoundingClientRect();
    const estimatedHeight = Math.min(28 * 16, (workspaceFolders.length + 1) * 32 + 16);
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - estimatedHeight - 8));
    const maxHeight = Math.max(120, window.innerHeight - top - 8);
    const left = Math.min(rect.right + 4, window.innerWidth - 220 - 8);

    setWorkspaceFolderFlyout({
      mode,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      folders: workspaceFolders,
      left,
      top,
      maxHeight,
    });
  }

  function toggleFolderSelection(folderId: string) {
    const folderSessionIds = (byFolder[folderId] ?? []).map((session) => session.id);
    const shouldSelect = !selectedFolderIds.has(folderId);

    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (shouldSelect) {
        next.add(folderId);
      } else {
        next.delete(folderId);
      }
      return next;
    });

    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const sessionId of folderSessionIds) {
        if (shouldSelect) {
          next.add(sessionId);
        } else {
          next.delete(sessionId);
        }
      }
      return next;
    });
  }

  function renderSessionRow(session: ChatSession, depth = 0, showFolderBorder = false) {
    return (
      <div
        className={showFolderBorder ? "ml-3 border-l border-[var(--border-color)]/70" : undefined}
        onDragStart={() => { dragSessionIdsRef.current = [session.id]; }}
        onDragEnd={() => { dragSessionIdsRef.current = null; setDragOverFolderId(null); }}
      >
        <div className="pb-[2px]">
          <SessionItem
            session={session}
            activeChatId={activeChatId}
            isSelected={selectedIds.has(session.id)}
            selectMode={selectMode}
            toggleSelect={(id) => {
              lastSelectedIdRef.current = id;
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) { next.delete(id); } else { next.add(id); }
                return next;
              });
            }}
            onSessionClick={handleSessionClick}
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
              openSession(targetSession);
            }}
            depth={depth}
          />
        </div>
      </div>
    );
  }

  const sessionSidebarRows: SessionSidebarRow[] = [
    ...childWorkspaces.flatMap((ws) => {
      const wsRows: SessionSidebarRow[] = [{
        type: "workspace" as const,
        key: `ws-${ws.id}`,
        workspace: ws,
        isOpen: expanded[`ws-${ws.id}`] ?? false,
      }];
      if (expanded[`ws-${ws.id}`] ?? false) {
        const wsSessions = byWorkspace[ws.id] ?? [];
        const wsFolders = foldersByWorkspace[ws.id] ?? [];
        // Sub-group workspace sessions by folder
        const wsByFolder: Record<string, ChatSession[]> = {};
        const wsUngrouped: ChatSession[] = [];
        for (const session of wsSessions) {
          if (session.folder_id) {
            (wsByFolder[session.folder_id] ??= []).push(session);
          } else {
            wsUngrouped.push(session);
          }
        }
        // Ungrouped sessions first
        wsRows.push(
          ...wsUngrouped.map((session) => ({
            type: "session" as const,
            key: session.id,
            session,
            depth: 1,
            showFolderBorder: true,
          })),
        );
        // Then folders
        for (const proj of wsFolders) {
          if (!(wsByFolder[proj.id]?.length)) { continue; }
          const projKey = `ws-${ws.id}-folder-${proj.id}`;
          const projOpen = expanded[projKey] ?? true;
          wsRows.push({
            type: "folder" as const,
            key: projKey,
            folder: proj,
            isOpen: projOpen,
            expandKey: projKey,
            depth: 1,
          });
          if (projOpen) {
            wsRows.push(
              ...(wsByFolder[proj.id] ?? []).map((session) => ({
                type: "session" as const,
                key: session.id,
                session,
                depth: 2,
                showFolderBorder: true,
              })),
            );
          }
        }
      }
      return wsRows;
    }),
    ...ungrouped.map((session) => ({
      type: "session" as const,
      key: session.id,
      session,
      depth: 0,
      showFolderBorder: false,
    })),
    ...folders.flatMap(( folder) => {
      const folderRows: SessionSidebarRow[] = [{
        type: "folder" as const,
        key: `folder-${folder.id}`,
        folder,
        isOpen: expanded[folder.id] ?? true,
        expandKey: folder.id,
        depth: 0,
      }];

      if (expanded[folder.id] ?? true) {
        folderRows.push(
          ...(byFolder[folder.id] ?? []).map((session) => ({
            type: "session" as const,
            key: session.id,
            session,
            depth: 1,
            showFolderBorder: true,
          })),
        );
      }

      return folderRows;
    }),
  ];

  function resetSelectionState() {
    setSelectMode(false);
    setSelectedIds(new Set());
    setSelectedFolderIds(new Set());
    lastSelectedIdRef.current = null;
    setMoveMenuOpen(false);
    setBulkFolderMoveOpen(false);
    setBulkMoveWorkspaceId(null);
    setDragOverFolderId(null);
    setCtxMoveOpen(false);
    setCtxFolderMoveOpen(false);
    setCtxMoveWorkspaceId(null);
    setCtxFolderMoveWorkspaceId(null);
    setShowNewWorkspaceInput(false);
    setNewWorkspaceName("");
    setFolderMoveShowCreate(false);
    setFolderMoveNewName("");
    setWorkspaceFolderFlyout(null);
  }

  async function handleFolderDrop(event: React.DragEvent, folder: Folder) {
    event.preventDefault();
    event.stopPropagation();
    setDragOverFolderId(null);

    const sessionIds = dragSessionIdsRef.current;
    dragSessionIdsRef.current = null;
    if (!sessionIds || sessionIds.length === 0) {
      return;
    }

    try {
      const sessionsToMove = sessionIds.filter((sessionId) => {
        const session = sidebarSessions.find((item) => item.id === sessionId);
        return session && session.folder_id !== folder.id;
      });

      if (sessionsToMove.length === 0) {
        return;
      }

      await moveSessionsToTarget(sessionsToMove, folder.workspace_id, folder.id);
      setExpanded((prev) => ({ ...prev, [folder.id]: true }));
    } catch (error) {
      console.error("Failed to drop chat into folder:", error);
    }
  }

  function renderSessionMoveSubmenu(
    onSelect: (workspaceId: string, folderId: string | null) => void,
    flipUp = false,
  ) {
    function handleCreateWorkspace() {
      const name = newWorkspaceName.trim();
      if (!name) { return; }
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
      <div className={`absolute left-full z-30 ml-1 min-w-[180px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-lg ${flipUp ? "bottom-0" : "top-0"}`}>
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
            const workspaceFolders = foldersByWorkspace[workspace.id] ?? [];
            const hasFolders = workspaceFolders.length > 0;
            return (
              <div
                key={workspace.id}
                className="relative"
                onMouseEnter={(event) => {
                  if (!hasFolders) {
                    setWorkspaceFolderFlyout((current) => current?.mode === "session-move" ? null : current);
                    setCtxMoveWorkspaceId(null);
                    return;
                  }
                  setCtxMoveWorkspaceId(workspace.id);
                  openWorkspaceFolderFlyout("session-move", workspace, workspaceFolders, event.currentTarget);
                }}
              >
                <button
                  onClick={() => {
                    if (!hasFolders) {
                      setWorkspaceFolderFlyout(null);
                      onSelect(workspace.id, null);
                      return;
                    }
                    setCtxMoveWorkspaceId((current) => current === workspace.id ? null : workspace.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  <span className="truncate flex-1">{workspace.name}</span>
                  {hasFolders && <ChevronRight size={11} />}
                </button>
              </div>
            );
          })}
          {filteredWorkspaces.length === 0 && (
            normalizedWorkspaceMoveQuery ? (
              <button
                onClick={() => {
                  const name = workspaceMoveQuery.trim();
                  setWorkspaceMoveQuery("");
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
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <Plus size={11} /> Create &ldquo;{workspaceMoveQuery.trim()}&rdquo;
              </button>
            ) : (
              <p className="px-3 py-2 text-xs text-[var(--text-muted)]">No matching workspaces.</p>
            )
          )}
        </div>
      </div>
    );
  }

  function renderFolderMoveSubmenu(
    currentFolderId: string | null,
    workspaceId: string,
    onSelect: (folderId: string | null) => void,
  ) {
    async function handleCreateFolderAndMove() {
      const name = folderMoveNewName.trim();
      if (!name) { return; }
      setFolderMoveShowCreate(false);
      setFolderMoveNewName("");
      try {
        const newFolder = await api.folder.create(workspaceId, name);
        const refreshedFolders = await api.folder.list(workspaceId, { includeDescendants });
        useWorkspaceStore.getState().setFoldersForWorkspace(workspaceId, refreshedFolders);
        onSelect(newFolder.id);
      } catch (error) {
        const description = error instanceof Error ? error.message : "Failed to create folder.";
        showAlertDialog("Create folder failed", description, "danger");
      }
    }

    const isAtRoot = !currentFolderId;
    return (
      <div className="absolute left-full top-0 z-30 ml-1 min-w-[180px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-lg">
        <div className="max-h-[min(28rem,calc(100vh-32px))] overflow-y-auto py-1">
          <button
            onClick={() => onSelect(null)}
            disabled={isAtRoot}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MessageSquare size={11} />
            <span className="truncate flex-1">No folder{isAtRoot ? " (Current)" : ""}</span>
          </button>
          {folders.length > 0 && <div className="my-1 border-t border-[var(--border-color)]" />}
          {folders.map(( folder) => {
            const isCurrent = folder.id === currentFolderId;
            return (
              <button
                key={folder.id}
                onClick={() => onSelect(folder.id)}
                disabled={isCurrent}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FolderIcon size={11} style={folder.color ? { color: folder.color } : undefined} />
                <span className="truncate flex-1">
                  {folder.name}{isCurrent ? " (Current)" : ""}
                </span>
              </button>
            );
          })}
          <div className="my-1 border-t border-[var(--border-color)]" />
          {folderMoveShowCreate ? (
            <form
              onSubmit={(e) => { e.preventDefault(); void handleCreateFolderAndMove(); }}
              className="px-2 py-1"
            >
              <input
                autoFocus
                value={folderMoveNewName}
                onChange={(e) => setFolderMoveNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setFolderMoveShowCreate(false); setFolderMoveNewName(""); } }}
                placeholder="Folder name"
                className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
              />
            </form>
          ) : (
            <button
              onClick={() => setFolderMoveShowCreate(true)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <Plus size={11} /> Create folder...
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderFolderWorkspaceMoveSubmenu(
    folder: Folder,
    onSelect: (workspaceId: string) => void,
    flipUp = false,
  ) {
    function handleCreateWorkspace() {
      const name = newWorkspaceName.trim();
      if (!name) { return; }
      setShowNewWorkspaceInput(false);
      setNewWorkspaceName("");
      setCtxFolderMoveWorkspaceId(null);
      setCtxMenu(null);
      void createWorkspaceForMove(name)
        .then((workspace) => moveFolderToWorkspace(folder, workspace.id))
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
      <div className={`absolute left-full z-30 ml-1 min-w-[180px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-lg ${flipUp ? "bottom-0" : "top-0"}`}>
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
            const isCurrentWorkspace = workspace.id === folder.workspace_id;
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
            normalizedWorkspaceMoveQuery ? (
              <button
                onClick={() => {
                  const name = workspaceMoveQuery.trim();
                  setWorkspaceMoveQuery("");
                  setCtxFolderMoveWorkspaceId(null);
                  setCtxMenu(null);
                  void createWorkspaceForMove(name)
                    .then((workspace) => moveFolderToWorkspace(folder, workspace.id))
                    .catch((error) => {
                      const description = error instanceof Error
                        ? error.message
                        : typeof error === "string" && error.trim()
                          ? error
                          : "Failed to move to new workspace.";
                      showAlertDialog("Move to new workspace failed", description, "danger");
                    });
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <Plus size={11} /> Create &ldquo;{workspaceMoveQuery.trim()}&rdquo;
              </button>
            ) : (
              <p className="px-3 py-2 text-xs text-[var(--text-muted)]">No matching workspaces.</p>
            )
          )}
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (!ctxMenu) { return; }

    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-chat-tree-context-menu]")) { return; }
      setCtxMenu(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
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
            Chats
          </span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => {
                hideSidebarTooltip();
                setSelectMode((value) => !value);
              }}
              onMouseEnter={(e) => showSidebarTooltip("Select items", e)}
              onMouseLeave={hideSidebarTooltip}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ${selectMode ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""
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
                <Tooltip content="Move selected chats" position="bottom">
                  <button
                    onClick={() => setMoveMenuOpen((value) => !value)}
                    disabled={selectedIds.size === 0 || bulkActionPending !== null}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[var(--text-muted)] transition-colors ${isSplitPane ? "text-xs" : "text-[11px]"} hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-30`}
                  >
                    <MoveRight size={12} />
                    {bulkActionPending === "move" ? "Moving..." : "Move"}
                  </button>
                </Tooltip>
                {moveMenuOpen && bulkActionPending === null && (
                  <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-lg">
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
                            if (!name) { return; }
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
                        const workspaceFolders = foldersByWorkspace[workspace.id] ?? [];
                        const hasFolders = workspaceFolders.length > 0;
                        return (
                          <div
                            key={workspace.id}
                            className="relative"
                            onMouseEnter={(event) => {
                              if (!hasFolders) {
                                setWorkspaceFolderFlyout((current) => current?.mode === "bulk-move" ? null : current);
                                setBulkMoveWorkspaceId(null);
                                return;
                              }
                              setBulkMoveWorkspaceId(workspace.id);
                              openWorkspaceFolderFlyout("bulk-move", workspace, workspaceFolders, event.currentTarget);
                            }}
                          >
                            <button
                              onClick={() => {
                                if (!hasFolders) {
                                  setWorkspaceFolderFlyout(null);
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
                              {hasFolders && <ChevronRight size={11} />}
                            </button>
                          </div>
                        );
                      })}
                      {filteredWorkspaces.length === 0 && (
                        normalizedWorkspaceMoveQuery ? (
                          <button
                            onClick={() => {
                              const name = workspaceMoveQuery.trim();
                              setWorkspaceMoveQuery("");
                              setMoveMenuOpen(false);
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
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                          >
                            <Plus size={11} /> Create &ldquo;{workspaceMoveQuery.trim()}&rdquo;
                          </button>
                        ) : (
                          <p className="px-3 py-2 text-xs text-[var(--text-muted)]">No matching workspaces.</p>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="relative">
                <Tooltip content="Move selected chats to a folder" position="bottom">
                  <button
                    onClick={() => { setBulkFolderMoveOpen((v) => !v); setMoveMenuOpen(false); }}
                    disabled={selectedIds.size === 0 || bulkActionPending !== null}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[var(--text-muted)] transition-colors ${isSplitPane ? "text-xs" : "text-[11px]"} hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-30`}
                  >
                    <FolderIcon size={12} />
                    To folder
                  </button>
                </Tooltip>
                {bulkFolderMoveOpen && bulkActionPending === null && (() => {
                  const bulkWorkspaceId = sidebarSessions.find((s) => selectedIds.has(s.id))?.workspace_id;
                  return (
                  <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-lg">
                    <div className="max-h-[min(28rem,calc(100vh-32px))] overflow-y-auto py-1">
                      <button
                        onClick={() => {
                          if (!bulkWorkspaceId) { return; }
                          setBulkFolderMoveOpen(false);
                          setBulkActionPending("move");
                          void moveSessionsToTarget(Array.from(selectedIds), bulkWorkspaceId, null).then(() => {
                            resetSelectionState();
                          }).finally(() => {
                            setBulkActionPending(null);
                          });
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      >
                        <MessageSquare size={11} /> No folder
                      </button>
                      {folders.length > 0 && <div className="my-1 border-t border-[var(--border-color)]" />}
                      {folders.map(( folder) => (
                        <button
                          key={folder.id}
                          onClick={() => {
                            if (!bulkWorkspaceId) { return; }
                            setBulkFolderMoveOpen(false);
                            setBulkActionPending("move");
                            void moveSessionsToTarget(Array.from(selectedIds), bulkWorkspaceId, folder.id).then(() => {
                              resetSelectionState();
                            }).finally(() => {
                              setBulkActionPending(null);
                            });
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        >
                          <FolderIcon size={11} style={folder.color ? { color: folder.color } : undefined} />
                          <span className="truncate">{folder.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  );
                })()}
              </div>
              <Tooltip content="Delete selected items" position="bottom">
                <button
                  onClick={() => {
                    setBulkActionPending("delete");
                    void bulkDeleteSessions(Array.from(selectedIds), Array.from(selectedFolderIds)).then(() => {
                      resetSelectionState();
                    }).finally(() => {
                      setBulkActionPending(null);
                    });
                  }}
                  disabled={selectedCount === 0 || bulkActionPending !== null}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-red-400 transition-colors ${isSplitPane ? "text-xs" : "text-[11px]"} hover:bg-[var(--bg-hover)] disabled:opacity-30`}
                >
                  <Trash2 size={12} />
                  {bulkActionPending === "delete" ? "Deleting..." : "Delete"}
                </button>
              </Tooltip>
              <Tooltip content="Exit selection mode" position="bottom">
                <button
                  onClick={() => {
                    resetSelectionState();
                  }}
                  disabled={bulkActionPending !== null}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-[var(--text-muted)] transition-colors ${isSplitPane ? "text-xs" : "text-[11px]"} hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-30`}
                >
                  <X size={12} />
                  Cancel
                </button>
              </Tooltip>
              <span className={`ml-auto text-[var(--text-muted)] ${isSplitPane ? "text-xs" : "text-[11px]"}`}>
                {selectedCount} selected
              </span>
            </div>
          </div>
        )}

        {/* Search */}
        <div className={`border-b border-[var(--border-color)] ${isSplitPane ? "px-1.5 py-1" : "px-2 py-1.5"}`}>
          <div className={`flex min-w-0 items-center gap-1.5 bg-[var(--bg-elevated)] ${isSplitPane ? "rounded-md px-1.5 py-1" : "rounded-lg px-2 py-1"}`}>
            <Search size={isSplitPane ? 12 : 11} className="text-[var(--text-muted)]" />
            <input
              value={sessionQuery}
              onChange={(e) => setSessionQuery(e.target.value)}
              placeholder="Search…"
              className={`min-w-0 flex-1 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none ${isSplitPane ? "text-xs" : "text-[11px]"}`}
            />
          </div>
        </div>

        {/* Inline folder creation */}
        {creatingFolder && (
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-color)]">
            <FolderIcon size={isSplitPane ? 13 : 12} className="text-[var(--text-muted)] flex-shrink-0" />
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
            <Tooltip content="Create folder" position="top">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void handleCreateFolder(folderInputRef.current?.value)}
                disabled={creatingFolderPending}
                className="p-1 rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors disabled:cursor-wait disabled:opacity-50"
              >
                {creatingFolderPending ? (
                  <Loader2 size={isSplitPane ? 13 : 12} className="animate-spin" />
                ) : (
                  <Check size={isSplitPane ? 13 : 12} />
                )}
              </button>
            </Tooltip>
            <Tooltip content="Cancel folder creation" position="top">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={cancelCreateFolder}
                disabled={creatingFolderPending}
                className="p-1 rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X size={isSplitPane ? 13 : 12} />
              </button>
            </Tooltip>
          </div>
        )}

        {/* Session list */}
        <div className="flex-1 min-h-0">
          {visibleSessions.length === 0 && folders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-3">
              <MessageSquare size={isSplitPane ? 22 : 20} className="text-[var(--text-muted)] opacity-30" />
              <p className={`text-[var(--text-muted)] ${isSplitPane ? "text-xs" : "text-[11px]"}`}>No conversations yet</p>
            </div>
          ) : sessionQuery.trim() && visibleSessions.length === 0 ? (
            <p className={`px-3 py-4 text-[var(--text-muted)] text-center ${isSplitPane ? "text-xs" : "text-[11px]"}`}>No matches</p>
          ) : (
            <Virtuoso
              className="h-full"
              data={sessionSidebarRows}
              initialItemCount={Math.min(sessionSidebarRows.length, 20)}
              computeItemKey={(_, row) => row.key}
              itemContent={(_, row) => {
                if (row.type === "session") {
                  return renderSessionRow(row.session, row.depth, row.showFolderBorder);
                }

                if (row.type === "workspace") {
                  const { workspace: wsItem, isOpen: wsOpen } = row;
                  const wsSessionCount = childWorkspaceSessionCounts[wsItem.id] ?? 0;
                  return (
                    <button
                      onClick={() => setExpanded((prev) => ({ ...prev, [`ws-${wsItem.id}`]: !wsOpen }))}
                      className={`w-full flex items-center gap-1.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                        "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <FolderOpen size={isSplitPane ? 14 : 13} className="text-[var(--accent-color)] shrink-0" />
                      <span className={`truncate font-medium flex-1 min-w-0 ${isSplitPane ? "text-xs" : "text-[11px]"}`}>{wsItem.name}</span>
                      {wsSessionCount > 0 && (
                        <span className={`shrink-0 text-[var(--text-muted)] ${isSplitPane ? "text-[10px]" : "text-[9px]"}`}>{wsSessionCount}</span>
                      )}
                      {wsOpen ? <ChevronDown size={isSplitPane ? 13 : 12} className="shrink-0 text-[var(--text-muted)]" /> : <ChevronRight size={isSplitPane ? 13 : 12} className="shrink-0 text-[var(--text-muted)]" />}
                    </button>
                  );
                }

                const { folder, isOpen, expandKey, depth: folderDepth } = row;
                return (
                  <button
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setCtxMenu({ type: "folder", x: event.clientX, y: event.clientY, folder });
                    }}
                    onDragOver={(event) => {
                      if (selectMode || !dragSessionIdsRef.current) {
                        return;
                      }
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverFolderId(folder.id);
                    }}
                    onDragLeave={(event) => {
                      const relatedTarget = event.relatedTarget as Node | null;
                      if (relatedTarget && event.currentTarget.contains(relatedTarget)) {
                        return;
                      }
                      setDragOverFolderId((current) => current === folder.id ? null : current);
                    }}
                    onDrop={(event) => {
                      void handleFolderDrop(event, folder);
                    }}
                    onClick={() => {
                      if (selectMode) {
                        toggleFolderSelection(folder.id);
                        return;
                      }
                      setExpanded((prev) => ({ ...prev, [expandKey]: !isOpen }));
                    }}
                    className={`w-full flex items-center gap-1.5 rounded-xl border px-3 py-2 text-left transition-colors ${dragOverFolderId === folder.id
                      ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)] ring-1 ring-inset ring-[var(--accent-color)]"
                      : selectedFolderIds.has(folder.id)
                        ? "border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                        : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      }`}
                    style={{ paddingLeft: folderDepth > 0 ? `${folderDepth * 12 + 12}px` : undefined }}
                  >
                    {selectMode && (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleFolderSelection(folder.id);
                        }}
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${selectedFolderIds.has(folder.id)
                          ? "border-[var(--accent-color)] bg-[var(--accent-color)] text-white"
                          : "border-[var(--text-muted)] text-transparent"
                          }`}
                      >
                        <Check size={10} />
                      </button>
                    )}
                    <FolderIcon size={isSplitPane ? 14 : 13} className="text-[var(--text-muted)] shrink-0" />
                    {folderRenamingId === folder.id ? (
                      <input
                        autoFocus
                        value={folderRenameValue}
                        onChange={(event) => setFolderRenameValue(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void renameFolder(folder.id, folderRenameValue).then(() => {
                              setFolderRenamingId(null);
                              setFolderRenameValue("");
                            });
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setFolderRenamingId(null);
                            setFolderRenameValue("");
                          }
                        }}
                        onBlur={() => {
                          void renameFolder(folder.id, folderRenameValue).then(() => {
                            setFolderRenamingId(null);
                            setFolderRenameValue("");
                          });
                        }}
                        className={`flex-1 rounded border border-[var(--accent-color)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-primary)] outline-none ${isSplitPane ? "text-sm" : "text-xs"}`}
                      />
                    ) : (
                      <span className={`flex-1 truncate ${isSplitPane ? "text-sm" : "text-xs"}`}>{folder.name}</span>
                    )}
                    <ChevronDown size={12} className={`text-[var(--text-muted)] transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                  </button>
                );
              }}
            />
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
            ref={menuRef}
            data-chat-tree-context-menu
            className="fixed z-50 min-w-[180px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-xl"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            {ctxMenu.type === "session" ? (
              <>
                <button
                  onClick={() => {
                    openSession(ctxMenu.session);
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
                    void window.navigator.clipboard.writeText(ctxMenu.session.title || "New Chat");
                    setCtxMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  <Copy size={11} /> Copy chat name
                </button>
                <button
                  onClick={() => {
                    const currentMessages = useChatStore.getState().messages;
                    if (canRefreshSessionTitle(ctxMenu.session, currentMessages)) {
                      void refreshSessionTitle(ctxMenu.session);
                    }
                    setCtxMenu(null);
                  }}
                  disabled={!canRefreshSessionTitle(ctxMenu.session, useChatStore.getState().messages)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${canRefreshSessionTitle(ctxMenu.session, useChatStore.getState().messages)
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
                      console.error("Failed to reveal chat file:", error);
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
                  onMouseEnter={() => { setCtxFolderMoveOpen(true); setCtxMoveOpen(false); }}
                  onMouseLeave={() => { setCtxFolderMoveOpen(false); setFolderMoveShowCreate(false); setFolderMoveNewName(""); }}
                >
                  <button
                    onClick={() => setCtxFolderMoveOpen((v) => !v)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  >
                    <FolderIcon size={11} />
                    <span className="truncate flex-1">Move to folder</span>
                    <ChevronRight size={11} />
                  </button>
                  {ctxFolderMoveOpen && renderFolderMoveSubmenu(
                    ctxMenu.session.folder_id || null,
                    ctxMenu.session.workspace_id,
                    (targetFolderId) => {
                      void moveSessionsToTarget([ctxMenu.session.id], ctxMenu.session.workspace_id, targetFolderId).catch((error: unknown) => {
                        const description = error instanceof Error
                          ? error.message
                          : typeof error === "string" && error.trim()
                            ? error
                            : "Failed to move chat.";
                        console.error("Failed to move chat:", error);
                        showAlertDialog("Move failed", description, "danger");
                      });
                      setCtxFolderMoveOpen(false);
                      setCtxMenu(null);
                    },
                  )}
                </div>
                <div
                  className="relative"
                  onMouseEnter={() => { setCtxMoveOpen(true); setCtxFolderMoveOpen(false); }}
                  onMouseLeave={() => { setCtxMoveOpen(false); setCtxMoveWorkspaceId(null); }}
                >
                  <button
                    onClick={() => setCtxMoveOpen((v) => !v)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  >
                    <MoveRight size={11} />
                    <span className="truncate flex-1">Move to workspace</span>
                    <ChevronRight size={11} />
                  </button>
                  {ctxMoveOpen && renderSessionMoveSubmenu((targetWorkspaceId, targetFolderId) => {
                    void moveSessionsToTarget([ctxMenu.session.id], targetWorkspaceId, targetFolderId).catch((error: unknown) => {
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
                  }, ctxMenu.y > window.innerHeight * 0.55)}
                </div>
                <div className="my-1 border-t border-[var(--border-color)]" />
                <button
                  onClick={() => {
                    void toggleExcludeFromAnalytics(ctxMenu.session);
                    setCtxMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  {ctxMenu.session.exclude_from_analytics
                    ? <><BarChart2 size={11} /> Include in analytics</>
                    : <><BarChart2 size={11} /> Exclude from analytics</>
                  }
                </button>
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
                    setActiveFolderId(ctxMenu.folder.id);
                    setCtxMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  <ExternalLink size={11} /> Open folder
                </button>
                <button
                  onClick={() => {
                    setFolderRenamingId(ctxMenu.folder.id);
                    setFolderRenameValue(ctxMenu.folder.name);
                    setCtxMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  <Pencil size={11} /> Rename folder
                </button>
                <div className="my-1 border-t border-[var(--border-color)]" />
                <div
                  className="relative"
                  onMouseEnter={() => setCtxFolderMoveWorkspaceId("open")}
                  onMouseLeave={() => setCtxFolderMoveWorkspaceId(null)}
                >
                  <button
                    onClick={() => setCtxFolderMoveWorkspaceId((current) => current === "open" ? null : "open")}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  >
                    <MoveRight size={11} />
                    <span className="truncate flex-1">Move to workspace</span>
                    <ChevronRight size={11} />
                  </button>
                  {ctxFolderMoveWorkspaceId === "open" && (() => {
                    const folder = ctxMenu.folder;
                    return renderFolderWorkspaceMoveSubmenu(folder, (targetWorkspaceId) => {
                      setCtxFolderMoveWorkspaceId(null);
                      setCtxMenu(null);
                      void moveFolderToWorkspace(folder, targetWorkspaceId);
                    }, ctxMenu.y > window.innerHeight * 0.55);
                  })()}
                </div>
                <button
                  onClick={() => {
                    void deleteFolder(ctxMenu.folder.id);
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
        {workspaceFolderFlyout && (
          <div
            data-chat-tree-context-menu={workspaceFolderFlyout.mode === "session-move" ? "" : undefined}
            className="fixed z-[55] min-w-[180px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-xl"
            style={{
              left: workspaceFolderFlyout.left,
              top: workspaceFolderFlyout.top,
              maxHeight: `${workspaceFolderFlyout.maxHeight}px`,
            }}
          >
            <div className="max-h-full overflow-y-auto">
              <button
                onClick={() => {
                  if (workspaceFolderFlyout.mode === "session-move" && ctxMenu?.type === "session") {
                    void moveSessionsToTarget([ctxMenu.session.id], workspaceFolderFlyout.workspaceId, null).catch((error: unknown) => {
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
                  } else if (workspaceFolderFlyout.mode === "bulk-move") {
                    setBulkActionPending("move");
                    void moveSessionsToTarget(Array.from(selectedIds), workspaceFolderFlyout.workspaceId, null).then(() => {
                      resetSelectionState();
                    }).finally(() => {
                      setBulkActionPending(null);
                    });
                  }
                  setWorkspaceFolderFlyout(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <MessageSquare size={11} /> Workspace root
              </button>
              {workspaceFolderFlyout.folders.map(( folder) => (
                <button
                  key={folder.id}
                  onClick={() => {
                    if (workspaceFolderFlyout.mode === "session-move" && ctxMenu?.type === "session") {
                      void moveSessionsToTarget([ctxMenu.session.id], workspaceFolderFlyout.workspaceId, folder.id).catch((error: unknown) => {
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
                    } else if (workspaceFolderFlyout.mode === "bulk-move") {
                      setBulkActionPending("move");
                      void moveSessionsToTarget(Array.from(selectedIds), workspaceFolderFlyout.workspaceId, folder.id).then(() => {
                        resetSelectionState();
                      }).finally(() => {
                        setBulkActionPending(null);
                      });
                    }
                    setWorkspaceFolderFlyout(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  <FolderIcon size={11} /> <span className="truncate">{folder.name}</span>
                </button>
              ))}
            </div>
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
});
