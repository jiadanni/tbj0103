import React, { useEffect, useLayoutEffect, useRef, useState, Suspense } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import { message } from "@tauri-apps/plugin-dialog";
import {
  
} from "react-resizable-panels";
import { Plus, Settings as SettingsIcon, Pencil, Trash2, ExternalLink, Columns2, ChevronDown, History as HistoryIcon, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import WindowControls, { onDragRegionMouseDown, onDragRegionDoubleClick } from "./WindowControls";
import { PRIMARY_NAV_ITEMS } from "./navigationItems";
import type { NavigationItem } from "./navigationItems";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { Tooltip } from "./Tooltip";
import AppHeaderMenu from "./AppHeaderMenu";
import ArtifactPanel from "./ArtifactPanel";
import ConfirmDialog from "./ConfirmDialog";
import PromptDialog from "./PromptDialog";
import { api } from "../lib/api";
import { isMac, isLinux, isWindows } from "../lib/platform";
import SplitPaneLayout from "./SplitPaneLayout";
import ChatView from "../views/ChatView";
import { useArtifactStore } from "../stores/artifactStore";
import { useChatStore } from "../stores/chatStore";
import { CompactMenuSelect } from "./CompactMenuSelect";
import StatusBar from "./StatusBar";
import { useNavigationHistory } from "../hooks/useNavigationHistory";

// Lazy-load heavy views that import large dependencies (d3, CodeMirror, etc.)
const KnowledgeGraphView = React.lazy(() => import("../views/KnowledgeGraphView"));
const HistoryView = React.lazy(() => import("../views/HistoryView"));
const FolderDashboardView = React.lazy(() => import("../views/FolderDashboardView"));
const PreferencesView = React.lazy(() => import("../views/PreferencesView"));
const SourceBrowserView = React.lazy(() => import("../views/SourceBrowserView"));
const NoteEditorView = React.lazy(() => import("../views/NoteEditorView"));
const FlashcardReviewView = React.lazy(() => import("../views/FlashcardReviewView"));
const LearningPathView = React.lazy(() => import("../views/LearningPathView"));
const LogsView = React.lazy(() => import("../views/LogsView"));
import type { Workspace, PaneId } from "../stores/workspaceStore";
import type { ChatSession } from "../stores/chatStore";

type WorkspaceDialogState =
  | { kind: "last-workspace" }
  | { kind: "delete"; workspace: Workspace };

function getWorkspaceOptionLabel(workspace: Workspace, workspaces: Workspace[]) {
  if (!workspace.parent_workspace_id) {
    return workspace.name;
  }

  const parentWorkspace = workspaces.find((item) => item.id === workspace.parent_workspace_id);
  return parentWorkspace ? `${parentWorkspace.name} / ${workspace.name}` : workspace.name;
}

function resolveWorkspaceSelection(
  workspaces: Workspace[],
  workspaceId: string | null,
  { allowRoot = false }: { allowRoot?: boolean } = {},
) {
  if (!workspaceId) {
    return { workspaceId: null, parentWorkspaceId: null };
  }

  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    return { workspaceId, parentWorkspaceId: workspaceId };
  }

  if (workspace.parent_workspace_id) {
    return {
      workspaceId: workspace.id,
      parentWorkspaceId: workspace.parent_workspace_id,
    };
  }

  // Root workspace: resolve to first child unless the caller explicitly wants the root (overview)
  if (!allowRoot) {
    const firstChild = workspaces.find((w) => w.parent_workspace_id === workspace.id);
    if (firstChild) {
      return {
        workspaceId: firstChild.id,
        parentWorkspaceId: workspace.id,
      };
    }
  }

  return {
    workspaceId: workspace.id,
    parentWorkspaceId: workspace.id,
  };
}

function resolvePaneWorkspaceSelection(workspaces: Workspace[], workspaceId: string | null) {
  return resolveWorkspaceSelection(workspaces, workspaceId).workspaceId;
}

function handleHorizontalWheel(event: React.WheelEvent<HTMLDivElement>) {
  const element = event.currentTarget;
  if (element.scrollWidth <= element.clientWidth) {return;}
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {return;}
  element.scrollLeft += event.deltaY;
  event.preventDefault();
}

function resolveSplitWorkspaceNavigation(
  workspaceNavigation: ReturnType<typeof useWorkspaceStore.getState>["workspaceNavigation"]
): "sidebar" | "tabs" | "dropdown" {
  if (workspaceNavigation === "top-dropdown") { return "dropdown"; }
  if (workspaceNavigation === "sidebar") { return "sidebar"; }
  return "tabs";
}

function workspaceTabClassName({
  isActive,
  isDragTarget = false,
}: {
  isActive: boolean;
  isDragTarget?: boolean;
}) {
  return `relative mt-1 flex h-[34px] items-center gap-1.5 self-end rounded-t-xl border border-b-0 px-3.5 text-sm font-medium whitespace-nowrap transition-all select-none ${
    isDragTarget
      ? "border-[rgba(var(--accent-color-rgb),0.45)] bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)] shadow-sm"
      : isActive
      ? "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_-10px_25px_-20px_rgba(15,23,42,0.55)]"
      : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
  }`;
}

function WorkspaceNavigationTabs({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onContextMenu,
  paneId,
}: {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onContextMenu?: (workspace: Workspace, x: number, y: number) => void;
  paneId?: PaneId;
}) {
  const allWorkspaces = useWorkspaceStore((state) => state.workspaces);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOverWorkspaceId, setDragOverWorkspaceId] = useState<string | null>(null);
  const [_draggedWorkspaceId, setDraggedWorkspaceId] = useState<string | null>(null);
  const reorderWorkspaces = useWorkspaceStore((state) => state.reorderWorkspaces);
  const dragHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => {
    if (dragHoverTimerRef.current) { clearTimeout(dragHoverTimerRef.current); }
  }, []);

  useEffect(() => {
    if (!menuOpen) {return;}

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) {return;}
      setMenuOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  return (
    <div className="relative flex h-full min-w-0 items-center gap-1" data-no-drag>
      <div
        className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none"
        onWheel={handleHorizontalWheel}
      >
        {workspaces.map((workspace) => (
          <button
            key={`${paneId ? paneId + "-" : ""}${workspace.id}`}
            onClick={() => onSelect(workspace.id)}
            onContextMenu={(event) => {
              if (onContextMenu) {
                event.preventDefault();
                event.stopPropagation();
                onContextMenu(workspace, event.clientX, event.clientY);
              }
            }}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-workspace-id", workspace.id);
              event.dataTransfer.effectAllowed = "move";
              setDraggedWorkspaceId(workspace.id);
            }}
            onDragEnd={() => {
              setDraggedWorkspaceId(null);
              setDragOverWorkspaceId(null);
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("application/x-workspace-id")) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                return;
              }
              if (!event.dataTransfer.types.includes("application/x-chat-session-ids")) {
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDragEnter={(event) => {
              if (event.dataTransfer.types.includes("application/x-workspace-id")) {
                event.preventDefault();
                setDragOverWorkspaceId(workspace.id);
                return;
              }
              if (!event.dataTransfer.types.includes("application/x-chat-session-ids")) {
                return;
              }
              event.preventDefault();
              setDragOverWorkspaceId(workspace.id);
              if (dragHoverTimerRef.current) {
                clearTimeout(dragHoverTimerRef.current);
              }
              dragHoverTimerRef.current = setTimeout(() => {
                onSelect(workspace.id);
              }, 600);
            }}
            onDragLeave={(event) => {
              const related = event.relatedTarget as Node | null;
              if (related && event.currentTarget.contains(related)) {
                return;
              }
              if (dragOverWorkspaceId === workspace.id) {
                setDragOverWorkspaceId(null);
              }
              if (dragHoverTimerRef.current) {
                clearTimeout(dragHoverTimerRef.current);
                dragHoverTimerRef.current = null;
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragOverWorkspaceId(null);
              if (dragHoverTimerRef.current) {
                clearTimeout(dragHoverTimerRef.current);
                dragHoverTimerRef.current = null;
              }

              const wsId = event.dataTransfer.getData("application/x-workspace-id");
              if (wsId && wsId !== workspace.id) {
                const sourceIndex = workspaces.findIndex(w => w.id === wsId);
                const targetIndex = workspaces.findIndex(w => w.id === workspace.id);
                if (sourceIndex !== -1 && targetIndex !== -1) {
                  const nextWorkspaces = [...workspaces];
                  const [removed] = nextWorkspaces.splice(sourceIndex, 1);
                  nextWorkspaces.splice(targetIndex, 0, removed);
                  void reorderWorkspaces(nextWorkspaces.map(w => w.id));
                }
                return;
              }

              const raw = event.dataTransfer.getData("application/x-chat-session-ids");
              if (!raw) {
                return;
              }
              try {
                const sessionIds = JSON.parse(raw) as string[];
                if (sessionIds.length > 0) {
                  void api.chat.moveSessions(sessionIds, workspace.id).then(() => {
                    onSelect(workspace.id);
                  });
                }
              } catch {
                /* ignore malformed data */
              }
            }}
            className={workspaceTabClassName({
              isActive: activeWorkspaceId === workspace.id,
              isDragTarget: dragOverWorkspaceId === workspace.id,
            })}
          >
            {(dragOverWorkspaceId === workspace.id || activeWorkspaceId === workspace.id) && (
              <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-[var(--accent-color)]" />
            )}
            {workspace.name}
          </button>
        ))}
      </div>
      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          data-no-drag
          aria-label={paneId ? `More workspaces for ${paneId}` : "More workspaces"}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpen((current) => !current);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] shadow-sm transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
        >
          <ChevronDown size={14} />
        </button>

        {menuOpen && (
          <div
            role="menu"
            data-no-drag
            aria-label={paneId ? `Workspace menu ${paneId}` : "Workspace menu"}
            className="absolute right-0 top-full z-[100] mt-1 flex max-h-80 min-w-[220px] flex-col overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1 shadow-xl"
          >
            {(() => {
              const roots = allWorkspaces.filter((ws) => ws.parent_workspace_id === null);
              return roots.map((root) => {
                const children = allWorkspaces.filter((ws) => ws.parent_workspace_id === root.id);
                const isRootActive = root.id === activeWorkspaceId;
                return (
                  <React.Fragment key={root.id}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={isRootActive}
                      onClick={() => { onSelect(root.id); setMenuOpen(false); }}
                      className={`flex w-full items-center rounded-lg px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors ${
                        isRootActive
                          ? "text-[var(--accent-color)]"
                          : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <span className="truncate">{root.name}</span>
                    </button>
                    {children.map((child) => {
                      const isActive = child.id === activeWorkspaceId;
                      return (
                        <button
                          key={child.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isActive}
                          onClick={() => { onSelect(child.id); setMenuOpen(false); }}
                          className={`flex w-full items-center rounded-lg py-2 pl-6 pr-3 text-left text-sm transition-colors ${
                            isActive
                              ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                          }`}
                        >
                          <span className="truncate">{child.name}</span>
                        </button>
                      );
                    })}
                  </React.Fragment>
                );
              });
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

function SplitTitlebarWorkspaceTabs({ paneId }: { paneId: PaneId }) {
  const allWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const rootWorkspaces = allWorkspaces.filter((ws) => ws.parent_workspace_id === null);
  const paneWorkspaceId = useWorkspaceStore((s) => s.panes[paneId].workspaceId);
  const setPaneWorkspace = useWorkspaceStore((s) => s.setPaneWorkspace);
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId);
  const activeWorkspaceId = paneWorkspaceId ?? "";

  function selectWorkspace(workspaceId: string) {
    setActivePaneId(paneId);
    setPaneWorkspace(paneId, resolvePaneWorkspaceSelection(allWorkspaces, workspaceId));
  }

  return (
    <WorkspaceNavigationTabs
      workspaces={rootWorkspaces}
      activeWorkspaceId={activeWorkspaceId}
      onSelect={selectWorkspace}
      paneId={paneId}
    />
  );
}

function SubWorkspaceTabBar({
  parentWorkspaceId,
  activeWorkspaceId,
  onSelect,
  onSelectOverview,
  onAdd,
  onContextMenu,
}: {
  parentWorkspaceId: string | null;
  activeWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onSelectOverview?: (workspaceId: string) => void;
  onAdd?: () => void;
  onContextMenu?: (workspace: Workspace, x: number, y: number) => void;
}) {
  const allWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const parent = parentWorkspaceId ? allWorkspaces.find((ws) => ws.id === parentWorkspaceId) : null;
  const children = parentWorkspaceId
    ? allWorkspaces.filter((ws) => ws.parent_workspace_id === parentWorkspaceId)
    : [];
  if (!parentWorkspaceId) { return null; }

  return (
    <div
      data-tauri-drag-region
      onMouseDown={onDragRegionMouseDown}
      className={`relative flex items-center h-10 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2 shrink-0 select-none ${isMac ? "pl-[72px]" : ""} ${!isMac ? "pr-[112px]" : ""}`}
    >
      <div
        className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none"
        onWheel={handleHorizontalWheel}
      >
        {/* Pinned overview dot — navigates to the parent (overview) workspace */}
        {parent && (
          <Tooltip content={parent.name} position="bottom">
            <button
              data-no-drag
              onClick={() => (onSelectOverview ?? onSelect)(parent.id)}
              onContextMenu={(event) => {
                if (onContextMenu) {
                  event.preventDefault();
                  event.stopPropagation();
                  onContextMenu(parent, event.clientX, event.clientY);
                }
              }}
              className={`relative mt-0.5 flex h-[34px] w-8 items-center justify-center self-end rounded-t-lg border border-b-0 transition-all select-none border-r-2 border-r-[var(--accent-color)]/60 ${
                activeWorkspaceId === parent.id
                  ? "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--accent-color)]"
                  : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <svg width="6" height="6" viewBox="0 0 6 6" className="fill-current opacity-80 shrink-0"><circle cx="3" cy="3" r="3" /></svg>
            </button>
          </Tooltip>
        )}
        {children.map((workspace) => (
          <button
            key={workspace.id}
            onClick={() => onSelect(workspace.id)}
            onContextMenu={(event) => {
              if (onContextMenu) {
                event.preventDefault();
                event.stopPropagation();
                onContextMenu(workspace, event.clientX, event.clientY);
              }
            }}
            className={`relative mt-0.5 flex h-[34px] items-center gap-1.5 self-end rounded-t-lg border border-b-0 px-3 text-sm font-medium whitespace-nowrap transition-all select-none ${
              activeWorkspaceId === workspace.id
                ? "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                : "border-transparent text-[var(--text-secondary)] opacity-60 hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            }`}
          >
            {activeWorkspaceId === workspace.id && (
              <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-[var(--accent-color)]" />
            )}
            {workspace.name}
          </button>
        ))}
        {onAdd && (
          <Tooltip content="New Sub-workspace" position="bottom">
            <button
              data-no-drag
              onClick={onAdd}
              title="New Sub-workspace"
              className="ml-1 h-8 w-8 shrink-0 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
            >
              <Plus size={14} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function buildWorkspaceGroups(workspaces: Workspace[]) {
  const roots = workspaces.filter((ws) => ws.parent_workspace_id === null);
  return roots.map((root) => ({
    label: root.name,
    value: root.id,
    options: workspaces
      .filter((ws) => ws.parent_workspace_id === root.id)
      .map((ws) => ({ value: ws.id, label: ws.name })),
  }));
}

function SplitTitlebarWorkspaceDropdown({ paneId }: { paneId: PaneId }) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const paneWorkspaceId = useWorkspaceStore((s) => s.panes[paneId].workspaceId);
  const setPaneWorkspace = useWorkspaceStore((s) => s.setPaneWorkspace);
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId);
  const workspaceOptions = workspaces.map((workspace) => ({ value: workspace.id, label: getWorkspaceOptionLabel(workspace, workspaces) }));
  const workspaceGroups = buildWorkspaceGroups(workspaces);
  const selectedWorkspaceId = workspaceOptions.some((workspace) => workspace.value === paneWorkspaceId)
    ? paneWorkspaceId ?? workspaceOptions[0]?.value ?? ""
    : workspaceOptions[0]?.value ?? "";

  return (
    <CompactMenuSelect
      label={`Workspace ${paneId}`}
      value={selectedWorkspaceId}
      options={workspaceOptions}
      groups={workspaceGroups}
      onChange={(value) => {
        setActivePaneId(paneId);
        setPaneWorkspace(paneId, resolvePaneWorkspaceSelection(workspaces, value));
      }}
      widthClassName="w-full min-w-0"
      buttonClassName="h-8 bg-[var(--bg-primary)]"
    />
  );
}

function SingleTitlebarWorkspaceDropdown({
  activeWorkspaceId,
  onChange,
}: {
  activeWorkspaceId: string | null;
  onChange: (workspaceId: string) => void;
}) {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const workspaceOptions = workspaces.map((workspace) => ({
    value: workspace.id,
    label: getWorkspaceOptionLabel(workspace, workspaces),
  }));
  const workspaceGroups = buildWorkspaceGroups(workspaces);
  const selectedWorkspaceId = workspaceOptions.some((workspace) => workspace.value === activeWorkspaceId)
    ? activeWorkspaceId ?? workspaceOptions[0]?.value ?? ""
    : workspaceOptions[0]?.value ?? "";

  return (
    <CompactMenuSelect
      label="Workspace"
      value={selectedWorkspaceId}
      options={workspaceOptions}
      groups={workspaceGroups}
      onChange={onChange}
      widthClassName="min-w-0 w-full max-w-[280px] sm:w-[240px]"
      buttonClassName="h-8 bg-[var(--bg-primary)]"
    />
  );
}

function SplitTitlebarWorkspaceNavigation() {
  const splitSizes = useWorkspaceStore((s) => s.splitSizes);
  const workspaceNavigation = useWorkspaceStore((s) => s.workspaceNavigation);
  const resolvedSplitWorkspaceNavigation = resolveSplitWorkspaceNavigation(workspaceNavigation);
  const hasCustomWindowControls = isLinux || isWindows;
  const primaryPanePaddingClass = (isLinux ? "pl-[52px]" : isMac ? "pl-[80px]" : "pl-2") + " pr-2";
  const secondaryPaneTrailingInset = hasCustomWindowControls ? "pr-[192px]" : "pr-24";
  const secondaryPaneClass = "min-w-0 pl-2 " + secondaryPaneTrailingInset;

  return (
    <div
      className="absolute inset-y-0 left-0 right-0 z-0 flex items-center"
      data-split-titlebar-workspace-nav
    >
      <div className="min-w-0" style={{ flexBasis: 0, flexGrow: splitSizes[0] }}>
        <div className={primaryPanePaddingClass}>
          {resolvedSplitWorkspaceNavigation === "dropdown" ? (
            <SplitTitlebarWorkspaceDropdown paneId="primary" />
          ) : (
            <SplitTitlebarWorkspaceTabs paneId="primary" />
          )}
        </div>
      </div>
      <div className="relative z-20 h-10 w-px shrink-0 bg-[var(--border-color)]" aria-hidden="true" />
      <div className="min-w-0" style={{ flexBasis: 0, flexGrow: splitSizes[1] }}>
        <div className={secondaryPaneClass}>
          {resolvedSplitWorkspaceNavigation === "dropdown" ? (
            <SplitTitlebarWorkspaceDropdown paneId="secondary" />
          ) : (
            <SplitTitlebarWorkspaceTabs paneId="secondary" />
          )}
        </div>
      </div>
    </div>
  );
}


function formatHistoryTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const HISTORY_MENU_WORKSPACE_TIMEOUT_MS = 1500;

async function getRecentSessionsForWorkspace(workspaceId: string, limit: number, includeDescendants: boolean) {
  const timeoutPromise = new Promise<ChatSession[]>((resolve) => {
    window.setTimeout(() => resolve([]), HISTORY_MENU_WORKSPACE_TIMEOUT_MS);
  });

  return Promise.race([
    api.chat.getRecentSessions(workspaceId, limit, { includeDescendants }).catch(() => [] as ChatSession[]),
    timeoutPromise,
  ]);
}

function mergeRecentSessions(sessions: ChatSession[]) {
  return Array.from(new Map(
    sessions
      .filter((session) => !session.is_deleted)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map((session) => [session.id, session])
  ).values()).slice(0, 8);
}

/** Back/Forward navigation buttons in the titlebar */
function BackForwardNavigation() {
  const { goBack, goForward, canGoBack, canGoForward } = useNavigationHistory();

  return (
    <div className="flex items-center gap-1">
      <Tooltip content="Go back (Alt+Left / Cmd+Left / Cmd+[)" position="bottom">
        <button
          onClick={goBack}
          disabled={!canGoBack}
          aria-label="Go back"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={15} />
        </button>
      </Tooltip>
      <Tooltip content="Go forward (Alt+Right / Cmd+Right / Cmd+])" position="bottom">
        <button
          onClick={goForward}
          disabled={!canGoForward}
          aria-label="Go forward"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronRight size={15} />
        </button>
      </Tooltip>
    </div>
  );
}

function TitlebarHistoryMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);
  const setActiveParentWorkspaceId = useWorkspaceStore((state) => state.setActiveParentWorkspaceId);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isHistoryRoute = location.pathname.startsWith("/history");
  const workspaceNames = React.useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || workspaces.length === 0) {
      return;
    }

    let cancelled = false;
    let completed = 0;
    let aggregatedSessions: ChatSession[] = [];
    const stopLoadingTimer = window.setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
      }
    }, HISTORY_MENU_WORKSPACE_TIMEOUT_MS + 200);

    workspaces.forEach((workspace) => {
      void getRecentSessionsForWorkspace(workspace.id, 8, workspace.parent_workspace_id == null)
        .then((recentSessions) => {
          if (cancelled) {
            return;
          }

          aggregatedSessions = mergeRecentSessions([
            ...aggregatedSessions,
            ...recentSessions,
          ]);
          setSessions(aggregatedSessions);
        })
        .finally(() => {
          completed += 1;
          if (!cancelled && completed >= workspaces.length) {
            window.clearTimeout(stopLoadingTimer);
            setLoading(false);
          }
        });
    });

    return () => {
      cancelled = true;
      window.clearTimeout(stopLoadingTimer);
    };
  }, [open, workspaces]);

  function openSession(sessionId: string, sessionWorkspaceId: string) {
    // Switch workspace first if the session belongs to a different one.
    // Without this, ChatView would detect the session isn't in the current
    // workspace and immediately clear the route.
    if (sessionWorkspaceId && sessionWorkspaceId !== activeWorkspaceId) {
      const { workspaceId, parentWorkspaceId } = resolveWorkspaceSelection(workspaces, sessionWorkspaceId);
      if (workspaceId) {
        setActiveParentWorkspaceId(parentWorkspaceId);
        setActiveWorkspaceId(workspaceId);
      }
    }
    navigate(`/chat/${sessionId}`);
    setOpen(false);
  }

  function openFullHistory() {
    navigate("/history");
    setOpen(false);
  }

  function toggleMenu() {
    const nextOpen = !open;
    if (nextOpen) {
      setLoading(workspaces.length > 0);
      if (workspaces.length === 0) {
        setSessions([]);
      }
    } else {
      setLoading(false);
    }
    setOpen(nextOpen);
  }

  return (
    <div ref={rootRef} className="relative">
      <Tooltip content="History" position="bottom">
        <button
          onClick={toggleMenu}
          title="History"
          aria-label="Open History"
          aria-haspopup="menu"
          aria-expanded={open}
          className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
            open || isHistoryRoute
              ? "border-[var(--accent-color)] bg-[var(--accent-color)] text-white"
              : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
          }`}
        >
          <HistoryIcon size={15} />
        </button>
      </Tooltip>

      {open && (
        <div
          role="menu"
          aria-label="History menu"
          className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-xl"
        >
          <div className="border-b border-[var(--border-color)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[var(--text-primary)]">Recent history</div>
              {loading ? <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Refreshing</div> : null}
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              {workspaces.length > 0 ? "Recent chats across all workspaces" : "Open a workspace to see recent chats"}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto p-2">
            {sessions.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-[var(--text-muted)]">
                {loading ? "Loading recent chats…" : "No recent chats yet."}
              </div>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  role="menuitem"
                  onClick={() => openSession(session.id, session.workspace_id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
                >
                  <HistoryIcon size={14} className="shrink-0 text-[var(--text-muted)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {session.title || "Untitled"}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                      <span className="truncate">{workspaceNames.get(session.workspace_id) ?? "Workspace"}</span>
                      <span>{formatHistoryTimestamp(session.updated_at)}</span>
                      {session.model_name ? <span className="truncate opacity-70">{session.model_name}</span> : null}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="border-t border-[var(--border-color)] p-2">
            <button
              type="button"
              role="menuitem"
              onClick={openFullHistory}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              <span>Show full history</span>
              <ExternalLink size={14} className="shrink-0 text-[var(--text-muted)]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TitlebarSortMenu() {
  const workspaceSortOrder = useWorkspaceStore((state) => state.workspaceSortOrder);
  const setWorkspaceSortOrder = useWorkspaceStore((state) => state.setWorkspaceSortOrder);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) { return; }
    function handleDown(e: MouseEvent) { if (!rootRef.current?.contains(e.target as Node)) { setOpen(false); } }
    function handleEsc(e: KeyboardEvent) { if (e.key === "Escape") { setOpen(false); } }
    window.addEventListener("mousedown", handleDown);
    window.addEventListener("keydown", handleEsc);
    return () => { window.removeEventListener("mousedown", handleDown); window.removeEventListener("keydown", handleEsc); };
  }, [open]);

  const options = [
    { id: "manual", label: "Manual Order" },
    { id: "name-asc", label: "Name A–Z" },
    { id: "name-desc", label: "Name Z–A" },
    { id: "created-newest", label: "Newest First" },
    { id: "created-oldest", label: "Oldest First" },
    { id: "updated-newest", label: "Recently Updated" },
    { id: "last-message-newest", label: "Last Message" },
    { id: "updated-oldest", label: "Least Recently Updated" },
  ] as const;

  const reverseSortOrder = useWorkspaceStore((state) => state.reverseSortOrder);
  const isReverseApplicable = workspaceSortOrder !== "manual";

  return (
    <div ref={rootRef} className="relative">
      <Tooltip content="Sort Workspaces" position="bottom">
        <button
          onClick={() => setOpen(!open)}
          aria-label="Sort Workspaces"
          className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
            open
              ? "border-[var(--accent-color)] bg-[var(--accent-color)] text-white"
              : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
          }`}
        >
          <ArrowUpDown size={15} />
        </button>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-48 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-xl py-1">
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => { setWorkspaceSortOrder(opt.id); setOpen(false); }}
              className={`flex w-full items-center px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--bg-hover)] ${
                workspaceSortOrder === opt.id ? "text-[var(--accent-color)] font-medium" : "text-[var(--text-secondary)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
          {isReverseApplicable && (
            <>
              <div className="my-1 h-px bg-[var(--border-color)]" />
              <button
                onClick={() => { reverseSortOrder(); setOpen(false); }}
                className="flex w-full items-center px-3 py-2 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                <ArrowUpDown size={12} className="mr-2" />
                Reverse Sort
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SinglePaneWorkspaceSidebar() {
  const navigate = useNavigate();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const rootWorkspaces = workspaces.filter((ws) => ws.parent_workspace_id === null);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeParentWorkspaceId = useWorkspaceStore((state) => state.activeParentWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);
  const setActiveParentWorkspaceId = useWorkspaceStore((state) => state.setActiveParentWorkspaceId);
  const addWorkspace = useWorkspaceStore((state) => state.addWorkspace);
  const switchWorkspaceSection = useSettingsStore((state) => state.switchWorkspaceSection);
  const [creating, setCreating] = useState(false);
  const [dragOverWorkspaceId, setDragOverWorkspaceId] = useState<string | null>(null);
  const dragHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRootId = activeParentWorkspaceId ?? activeWorkspaceId;

  useEffect(() => () => {
    if (dragHoverTimerRef.current) { clearTimeout(dragHoverTimerRef.current); }
  }, []);

  function selectWorkspace(workspaceId: string) {
    const { workspaceId: nextWorkspaceId, parentWorkspaceId } = resolveWorkspaceSelection(workspaces, workspaceId);
    const isChanged = nextWorkspaceId !== activeWorkspaceId;
    setActiveParentWorkspaceId(parentWorkspaceId);
    setActiveWorkspaceId(nextWorkspaceId);
    if (isChanged && switchWorkspaceSection) { navigate(switchWorkspaceSection); }
  }

  async function handleCreate(name: string) {
    setCreating(false);
    const trimmed = name.trim();
    if (!trimmed) { return; }
    const ws = await api.workspace.create(trimmed, "");
    addWorkspace(ws);
    selectWorkspace(ws.id);
  }

  return (
    <div
      className="flex h-full w-[180px] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-sidebar)]"
      data-testid="single-pane-workspace-sidebar"
    >
      <div className="flex items-center justify-between px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        <span>Workspaces</span>
        <Tooltip content="New Workspace" position="right">
          <button
            onClick={() => setCreating(true)}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="New Workspace"
          >
            <Plus size={12} />
          </button>
        </Tooltip>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {rootWorkspaces.map((ws) => {
          const isActive = ws.id === activeRootId;
          const isDragTarget = dragOverWorkspaceId === ws.id;
          return (
            <button
              key={ws.id}
              onClick={() => selectWorkspace(ws.id)}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes("application/x-chat-session-ids")) {return;}
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverWorkspaceId(ws.id);
              }}
              onDragEnter={(event) => {
                if (!event.dataTransfer.types.includes("application/x-chat-session-ids")) {return;}
                event.preventDefault();
                setDragOverWorkspaceId(ws.id);
                if (dragHoverTimerRef.current) {clearTimeout(dragHoverTimerRef.current);}
                dragHoverTimerRef.current = setTimeout(() => selectWorkspace(ws.id), 600);
              }}
              onDragLeave={(event) => {
                const related = event.relatedTarget as Node | null;
                if (related && event.currentTarget.contains(related)) {return;}
                if (dragOverWorkspaceId === ws.id) {setDragOverWorkspaceId(null);}
                if (dragHoverTimerRef.current) {
                  clearTimeout(dragHoverTimerRef.current);
                  dragHoverTimerRef.current = null;
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragOverWorkspaceId(null);
                if (dragHoverTimerRef.current) {
                  clearTimeout(dragHoverTimerRef.current);
                  dragHoverTimerRef.current = null;
                }
                const raw = event.dataTransfer.getData("application/x-chat-session-ids");
                if (!raw) {return;}
                try {
                  const sessionIds = JSON.parse(raw) as string[];
                  if (sessionIds.length > 0) {
                    void api.chat.moveSessions(sessionIds, ws.id).then(() => selectWorkspace(ws.id));
                  }
                } catch { /* ignore malformed data */ }
              }}
              className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs truncate transition-colors ${
                isDragTarget
                  ? "bg-[var(--accent-color)]/20 text-[var(--accent-color)] ring-1 ring-inset ring-[var(--accent-color)]"
                  : isActive
                    ? "bg-[var(--accent-color)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              {ws.name}
            </button>
          );
        })}
      </div>
      {creating && (
        <PromptDialog
          title="Create Workspace"
          placeholder="Workspace name"
          confirmLabel="Create"
          onConfirm={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function WorkspaceTabBar({
  onToggleSplit,
  showWorkspaceTabs = true,
}: {
  onToggleSplit: () => void;
  showWorkspaceTabs?: boolean;
}) {
  const location = useLocation();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const rootWorkspaces = workspaces.filter((ws) => ws.parent_workspace_id === null);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeParentWorkspaceId = useWorkspaceStore((state) => state.activeParentWorkspaceId);
  const setActiveParentWorkspaceId = useWorkspaceStore((state) => state.setActiveParentWorkspaceId);
  const splitMode = useWorkspaceStore((state) => state.splitMode);
  const workspaceNavigation = useWorkspaceStore((state) => state.workspaceNavigation);
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);
  const addWorkspace = useWorkspaceStore((state) => state.addWorkspace);
  const setWorkspaces = useWorkspaceStore((state) => state.setWorkspaces);
  const isDemoMode = useWorkspaceStore((state) => state.isDemoMode);
  const switchWorkspaceSection = useSettingsStore((state) => state.switchWorkspaceSection);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [contextMenu, setContextMenu] = useState<{ workspace: Workspace; x: number; y: number } | null>(null);
  const [dialogState, setDialogState] = useState<WorkspaceDialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [promptDialog, setPromptDialog] = useState<{ kind: "create-sub" | "rename"; workspace?: Workspace } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const splitUnsupportedRoute = ["/preferences"].some((path) => location.pathname.startsWith(path));
  const showSplitTitlebarWorkspaceNavigation = splitMode && !splitUnsupportedRoute && workspaceNavigation !== "sidebar";
  const showSinglePaneWorkspaceDropdown = !showSplitTitlebarWorkspaceNavigation && showWorkspaceTabs && workspaceNavigation === "top-dropdown";
  const showSinglePaneWorkspaceSidebar = !showSplitTitlebarWorkspaceNavigation && showWorkspaceTabs && workspaceNavigation === "sidebar";
  const showSplitToggle = !splitUnsupportedRoute || splitMode;
  function resetCreateWorkspaceForm() {
    setNewName("");
    setNewDescription("");
    setCreating(false);
  }

  function activateWorkspace(workspaceId: string, { allowRoot = false }: { allowRoot?: boolean } = {}) {
    const { workspaceId: nextWorkspaceId, parentWorkspaceId } = resolveWorkspaceSelection(workspaces, workspaceId, { allowRoot });
    const isChanged = nextWorkspaceId !== activeWorkspaceId;
    setActiveParentWorkspaceId(parentWorkspaceId);
    setActiveWorkspaceId(nextWorkspaceId, { allowRoot });
    if (isChanged && switchWorkspaceSection) { navigate(switchWorkspaceSection); }
    setContextMenu(null);
  }

  function activateSubWorkspace(workspaceId: string) {
    activateWorkspace(workspaceId);
  }

  function activateOverviewWorkspace(workspaceId: string) {
    activateWorkspace(workspaceId, { allowRoot: true });
  }

  function createSubWorkspace() {
    if (!activeParentWorkspaceId) { return; }
    setPromptDialog({ kind: "create-sub" });
  }

  async function handleCreateSubWorkspace(name: string) {
    if (!activeParentWorkspaceId) { return; }
    setPromptDialog(null);
    const ws = await api.workspace.createChild(activeParentWorkspaceId, name);
    addWorkspace(ws);
    activateSubWorkspace(ws.id);
  }

  async function createWorkspace() {
    if (!newName.trim()) { return; }
    const trimmedDescription = newDescription.trim();
    const ws = await api.workspace.create(newName.trim(), trimmedDescription || undefined);
    addWorkspace(ws);
    activateWorkspace(ws.id);
    resetCreateWorkspaceForm();
  }

  function renameWorkspace(workspace: Workspace) {
    setContextMenu(null);
    setPromptDialog({ kind: "rename", workspace });
  }

  async function handleRenameWorkspace(workspace: Workspace, nextName: string) {
    if (nextName === workspace.name) {
      setPromptDialog(null);
      return;
    }
    setPromptDialog(null);
    await api.workspace.update(workspace.id, nextName, workspace.description, workspace.prompt_instructions);
    setWorkspaces(workspaces.map((item) => item.id === workspace.id ? { ...item, name: nextName } : item));
  }

  async function performDeleteWorkspace(workspace: Workspace) {
    if (isDemoMode) {
      await message("Workspace deletion is not available in Demo Mode.", { title: "Demo Mode" });
      return;
    }
    await api.workspace.delete(workspace.id);
    const remaining = await api.workspace.list();
    setWorkspaces(remaining);
    setContextMenu(null);
  }

  function deleteWorkspace(workspace: Workspace) {
    setContextMenu(null);
    if (workspaces.length === 1) {
      setDialogState({ kind: "last-workspace" });
      return;
    }
    setDialogState({ kind: "delete", workspace });
  }

  useEffect(() => {
    if (!contextMenu) {return;}

    function handlePointerDown(event: MouseEvent) {
      if (contextMenuRef.current?.contains(event.target as Node)) {return;}
      setContextMenu(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("contextmenu", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("blur", () => setContextMenu(null), { once: true });

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("contextmenu", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) {return;}
    const el = contextMenuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = contextMenu.x;
    let y = contextMenu.y;
    if (rect.right > window.innerWidth - pad) { x = window.innerWidth - rect.width - pad; }
    if (rect.bottom > window.innerHeight - pad) { y = window.innerHeight - rect.height - pad; }
    if (x < pad) { x = pad; }
    if (y < pad) { y = pad; }
    if (x !== contextMenu.x || y !== contextMenu.y) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }, [contextMenu]);

  return (
    <div className="relative z-20">
      <div
        data-tauri-drag-region
        onMouseDown={onDragRegionMouseDown}
        onDoubleClick={onDragRegionDoubleClick}
        className={`relative flex items-center h-10 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2 shrink-0 select-none ${isMac ? "pl-[72px]" : ""} ${!isMac ? "pr-[112px]" : ""}`}
      >
        {showSplitTitlebarWorkspaceNavigation && <SplitTitlebarWorkspaceNavigation />}
        {!isMac && <div className="relative z-10"><AppHeaderMenu /></div>}
        <div
          onWheel={handleHorizontalWheel}
          className={
            showSplitTitlebarWorkspaceNavigation
              ? "relative z-0 min-w-0 flex-1"
              : showSinglePaneWorkspaceDropdown
              ? "min-w-0 flex-1"
              : showSinglePaneWorkspaceSidebar
              ? "min-w-0 flex-1"
              : "min-w-0 flex-1 overflow-visible"
          }
          {...(showWorkspaceTabs && !showSplitTitlebarWorkspaceNavigation && !showSinglePaneWorkspaceDropdown && !showSinglePaneWorkspaceSidebar ? { "data-workspace-tab-strip": "", "data-no-drag": "" } : {})}
        >
          {showSinglePaneWorkspaceDropdown ? (
            <div className="flex h-10 items-center">
              <SingleTitlebarWorkspaceDropdown
                activeWorkspaceId={activeWorkspaceId}
                onChange={activateWorkspace}
              />
            </div>
          ) : showSinglePaneWorkspaceSidebar ? (
            // Workspace switching lives in the left sidebar; keep the titlebar slot empty for window dragging.
            <div className="h-10" />
          ) : (
            <div className={`${showSplitTitlebarWorkspaceNavigation ? "hidden" : "flex min-w-0 flex-1 items-center"}`}>
              {!showSplitTitlebarWorkspaceNavigation && showWorkspaceTabs ? (
                <WorkspaceNavigationTabs
                  workspaces={rootWorkspaces}
                  activeWorkspaceId={activeParentWorkspaceId ?? activeWorkspaceId}
                  onSelect={activateWorkspace}
                  onContextMenu={(ws, x, y) => setContextMenu({ workspace: ws, x, y })}
                />
              ) : null}
              {showWorkspaceTabs ? (
                <Tooltip content="New Workspace" position="bottom">
                  <button
                    onClick={() => setCreating(true)}
                    className="ml-1 w-9 h-10 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
                  >
                    <Plus size={20} />
                  </button>
                </Tooltip>
              ) : null}
            </div>
          )}
        </div>
        <Tooltip content="Drag window" position="bottom">
          <div
            data-window-drag-handle
            className={`mx-2 hidden h-5 shrink-0 rounded-full border border-transparent bg-[var(--bg-hover)] sm:block ${showWorkspaceTabs && !showSplitTitlebarWorkspaceNavigation && !showSinglePaneWorkspaceSidebar ? "flex-1 min-w-16" : "w-16"}`}
          />
        </Tooltip>
        <div className="relative z-10 ml-2 flex shrink-0 items-center gap-1" data-workspace-titlebar-actions>
          <BackForwardNavigation />
          <TitlebarSortMenu />
          <TitlebarHistoryMenu />
          {!showSplitTitlebarWorkspaceNavigation && !splitUnsupportedRoute && (
            <Tooltip content="Preferences" position="bottom">
              <button
                onClick={() => navigate("/preferences")}
                title="Preferences"
                aria-label="Preferences"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
              >
                <SettingsIcon size={15} />
              </button>
            </Tooltip>
          )}
          {showSplitToggle && (
            <Tooltip content="Toggle Split View" position="bottom">
              <button
                onClick={onToggleSplit}
                disabled={workspaces.length < 2}
                title="Toggle Split View"
                aria-label="Toggle Split View"
                className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
                  splitMode
                    ? "border-[var(--accent-color)] bg-[var(--accent-color)] text-white"
                    : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
                } disabled:opacity-40 disabled:hover:border-[var(--border-color)] disabled:hover:text-[var(--text-secondary)]`}
              >
                <Columns2 size={15} />
              </button>
            </Tooltip>
          )}
        </div>
        {!isMac && (
          <div className="absolute inset-y-0 right-2 z-10 flex items-center" data-workspace-window-controls>
            <WindowControls />
          </div>
        )}
      </div>
      {/* Row 2: Sub-workspace tabs for the active parent workspace */}
      {!showSplitTitlebarWorkspaceNavigation && showWorkspaceTabs && (
        <SubWorkspaceTabBar
          parentWorkspaceId={activeParentWorkspaceId}
          activeWorkspaceId={activeWorkspaceId}
          onSelect={activateSubWorkspace}
          onSelectOverview={activateOverviewWorkspace}
          onAdd={createSubWorkspace}
          onContextMenu={(ws, x, y) => setContextMenu({ workspace: ws, x, y })}
        />
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          data-workspace-context-menu
          className="fixed z-50 min-w-[190px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              activateWorkspace(contextMenu.workspace.id);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <ExternalLink size={11} /> Open {contextMenu.workspace.parent_workspace_id ? "sub-workspace" : "workspace"}
          </button>
          <button
            onClick={() => {
              void renameWorkspace(contextMenu.workspace);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <Pencil size={11} /> Rename {contextMenu.workspace.parent_workspace_id ? "sub-workspace" : "workspace"}
          </button>
          <button
            onClick={() => {
              navigate("/preferences", { state: { settingsTab: "workspaces" } });
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <SettingsIcon size={11} /> Manage workspaces
          </button>
          <div className="my-1 border-t border-[var(--border-color)]" />
          <button
            onClick={() => {
              void deleteWorkspace(contextMenu.workspace);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-[var(--bg-hover)]"
          >
            <Trash2 size={11} /> Delete {contextMenu.workspace.parent_workspace_id ? "sub-workspace" : "workspace"}
          </button>
        </div>
      )}
      {dialogState && (
        <ConfirmDialog
          title={dialogState.kind === "delete" ? (dialogState.workspace.parent_workspace_id ? "Confirm Sub-workspace Deletion" : "Confirm Deletion") : "Cannot Delete Workspace"}
          description={
            dialogState.kind === "delete"
              ? `Delete "${dialogState.workspace.name}" and all its projects, notes, and data? This cannot be undone.`
              : "You need at least one workspace in Aetherium."
          }
          confirmLabel={dialogState.kind === "delete" ? "Delete Workspace" : "OK"}
          cancelLabel={dialogState.kind === "delete" ? "Cancel" : null}
          tone={dialogState.kind === "delete" ? "danger" : "default"}
          busy={dialogBusy}
          onCancel={() => {
            if (!dialogBusy) {
              setDialogState(null);
            }
          }}
          onConfirm={async () => {
            if (dialogBusy) {return;}
            if (dialogState.kind !== "delete") {
              setDialogState(null);
              return;
            }

            setDialogBusy(true);
            try {
              await performDeleteWorkspace(dialogState.workspace);
              setDialogState(null);
            } finally {
              setDialogBusy(false);
            }
          }}
        />
      )}
      {promptDialog && (
        <PromptDialog
          title={promptDialog.kind === "create-sub" ? "New Sub-workspace" : (promptDialog.workspace?.parent_workspace_id ? "Rename Sub-workspace" : "Rename Workspace")}
          description={promptDialog.kind === "create-sub" ? "Enter a name for the new sub-workspace." : undefined}
          defaultValue={promptDialog.kind === "rename" && promptDialog.workspace ? promptDialog.workspace.name : ""}
          placeholder={promptDialog.kind === "create-sub" || promptDialog.workspace?.parent_workspace_id ? "Sub-workspace name" : "Workspace name"}
          confirmLabel={promptDialog.kind === "create-sub" ? "Create" : "Rename"}
          onCancel={() => setPromptDialog(null)}
          onConfirm={(value) => {
            if (promptDialog.kind === "create-sub") {
              handleCreateSubWorkspace(value);
            } else if (promptDialog.kind === "rename" && promptDialog.workspace) {
              handleRenameWorkspace(promptDialog.workspace, value);
            }
          }}
        />
      )}
      {creating && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => { resetCreateWorkspaceForm(); }}
        >
          <div
            className="mx-4 flex w-full max-w-sm flex-col gap-5 rounded-3xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">New Workspace</div>
              <h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">Name your workspace</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Add an optional description to capture what this workspace is for.</p>
            </div>
            <div className="flex flex-col gap-3">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { void createWorkspace(); }
                  if (e.key === "Escape") { resetCreateWorkspaceForm(); }
                }}
                placeholder="e.g. Python deep dive"
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
              />
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { resetCreateWorkspaceForm(); }
                }}
                placeholder="Optional description"
                rows={3}
                className="resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { resetCreateWorkspaceForm(); }}
                className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={() => { void createWorkspace(); }}
                disabled={!newName.trim()}
                className="rounded-xl bg-[var(--accent-color)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TopTabsNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeSegment = "/" + location.pathname.split("/")[1];
  const [contextMenu, setContextMenu] = useState<{ item: NavigationItem; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!contextMenu) {return;}

    function handlePointerDown(event: MouseEvent) {
      if (contextMenuRef.current?.contains(event.target as Node)) {return;}
      setContextMenu(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("contextmenu", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("contextmenu", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) {return;}
    const el = contextMenuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = contextMenu.x;
    let y = contextMenu.y;
    if (rect.right > window.innerWidth - pad) { x = window.innerWidth - rect.width - pad; }
    if (rect.bottom > window.innerHeight - pad) { y = window.innerHeight - rect.height - pad; }
    if (x < pad) { x = pad; }
    if (y < pad) { y = pad; }
    if (x !== contextMenu.x || y !== contextMenu.y) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }, [contextMenu]);

  const renderItem = (
    item: NavigationItem,
    Icon: LucideIcon,
  ) => (
    <button
      key={item.path}
      onClick={() => {
        navigate(item.path);
        setContextMenu(null);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ item, x: event.clientX, y: event.clientY });
      }}
      className={`relative mt-1 flex h-[34px] items-center gap-1.5 self-end rounded-t-xl border border-b-0 px-3.5 text-sm font-medium whitespace-nowrap transition-all select-none ${
        activeSegment === item.path
          ? "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_-10px_25px_-20px_rgba(15,23,42,0.55)]"
          : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      {activeSegment === item.path && (
        <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-[var(--accent-color)]" />
      )}
      <Icon size={18} />
      {item.label}
    </button>
  );

  return (
    <div className="relative">
      <div className="flex items-center h-10 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 shrink-0 overflow-x-auto select-none">
        <div className="flex items-center shrink-0">
          {PRIMARY_NAV_ITEMS.map((item) => renderItem(item, item.icon))}
        </div>
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          data-section-context-menu
          className="fixed z-50 min-w-[190px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              navigate(contextMenu.item.path);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <ExternalLink size={11} /> Open section
          </button>
          <button
            onClick={() => {
              navigate("/preferences", { state: { settingsTab: "appearance" } });
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <SettingsIcon size={11} /> Customize navigation
          </button>
        </div>
      )}
    </div>
  );
}

function CompactSectionNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeSegment = "/" + location.pathname.split("/")[1];
  const sectionOptions = PRIMARY_NAV_ITEMS.map((item) => ({
    label: item.label,
    value: item.path,
    icon: item.icon,
  }));

  const selectedPath = sectionOptions.some((item) => item.value === activeSegment)
    ? activeSegment
    : sectionOptions[0]?.value ?? "/folder";

  return (
    <div className="flex h-10 items-center gap-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 shrink-0">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
        Section
      </span>
      <CompactMenuSelect
        label="Section"
        value={selectedPath}
        options={sectionOptions}
        onChange={(value) => navigate(value)}
        widthClassName="min-w-0 w-full max-w-[260px] sm:w-[240px]"
      />
    </div>
  );
}

function pathToPaneView(pathname: string): import("../stores/workspaceStore").PaneView {
  const segment = pathname.split("/")[1];
  switch (segment) {
    case "chat": return "chat";
    case "notes": return "notes";
    case "documents": return "documents";
    case "graph": return "graph";
    case "flashcards": return "flashcards";
    case "learning": return "graph";
    default: return "folder";
  }
}

function paneViewToPath(view: import("../stores/workspaceStore").PaneView, chatSessionId?: string | null): string {
  switch (view) {
    case "chat":
      return chatSessionId ? `/chat/${chatSessionId}` : "/chat";
    case "notes": return "/notes";
    case "sources":
    case "documents":
    case "webcapture":
      return "/sources";
    case "graph": return "/graph";
    case "flashcards": return "/flashcards";
    case "settings": return "/preferences";
    case "memory": return "/memory";
    case "folder": return "/folder";
    default: return "/folder";
  }
}

export default function Layout() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeChatId = useChatStore((state) => state.activeChatId);
  const splitMode = useWorkspaceStore((state) => state.splitMode);
  const enterSplitMode = useWorkspaceStore((s) => s.enterSplitMode);
  const exitSplitMode = useWorkspaceStore((s) => s.exitSplitMode);
  const setPaneView = useWorkspaceStore((s) => s.setPaneView);
  const setPaneChatSession = useWorkspaceStore((s) => s.setPaneChatSession);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const sectionNavigation = useWorkspaceStore((state) => state.sectionNavigation);
  const workspaceNavigation = useWorkspaceStore((state) => state.workspaceNavigation);
  const isDemoMode = useWorkspaceStore((state) => state.isDemoMode);
  const setDemo = useWorkspaceStore((state) => state.setDemo);
  const loadArtifact = useArtifactStore((state) => state.loadArtifact);
  const setArtifactPanelOpen = useArtifactStore((state) => state.setPanelOpen);
  const showStatusBar = useSettingsStore((state) => state.showStatusBar);
  const splitUnsupportedRoute = ["/preferences"].some((path) => location.pathname.startsWith(path));
  const showSplitPaneLayout = splitMode && !splitUnsupportedRoute;
  const showSinglePaneNavigation = !showSplitPaneLayout;
  const showSectionSidebar = showSinglePaneNavigation && sectionNavigation === "sidebar";
  const showWorkspaceSidebar = showSinglePaneNavigation && workspaceNavigation === "sidebar";
  const _hasLeftRail = showSectionSidebar;

  const handleExitDemo = async () => {
    try {
      // Mark demo as dismissed to prevent re-auto-activation
      const settings = await api.settings.get();
      await api.settings.update({ ...settings, demo_dismissed: true });
      // Deactivate demo workspace
      await api.demo.deactivate();
      // Clear demo mode from store
      setDemo(false);
      // Reload to clear all in-memory state
      window.location.reload();
    } catch (e) {
      console.error("Failed to exit demo mode:", e);
      await message(`Failed to exit demo mode.\n${e}`, { title: "Error", kind: "error" });
    }
  };

  const toggleSplitModeFromShell = React.useCallback(() => {
    if (splitMode) {
      const primaryPane = useWorkspaceStore.getState().panes.primary;
      const nextPath = paneViewToPath(primaryPane.view, primaryPane.chatSessionId);
      exitSplitMode();
      navigate(nextPath);
      return;
    }
    if (workspaces.length < 2) {
      return;
    }
    setPaneView("primary", pathToPaneView(location.pathname));
    const routeSessionId = location.pathname.startsWith("/chat/") ? location.pathname.split("/")[2] ?? null : null;
    setPaneChatSession("primary", routeSessionId ?? activeChatId);
    enterSplitMode();
  }, [activeChatId, splitMode, location.pathname, workspaces.length, exitSplitMode, enterSplitMode, setPaneView, setPaneChatSession, navigate]);

  // Global Cmd+K shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    function handleOpenArtifact(event: Event) {
      const detail = (event as CustomEvent<{ artifactId?: string }>).detail;
      const artifactId = detail?.artifactId;
      if (!artifactId) {return;}
      void loadArtifact(artifactId).then(() => {
        setArtifactPanelOpen(true);
      });
    }

    window.addEventListener("aetherium:open-artifact", handleOpenArtifact as EventListener);
    return () => window.removeEventListener("aetherium:open-artifact", handleOpenArtifact as EventListener);
  }, [loadArtifact, setArtifactPanelOpen]);

  return (
    <div className="relative flex flex-col h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {commandPaletteOpen && (
        <CommandPalette
          workspaceId={activeWorkspaceId ?? ""}
          onClose={() => setCommandPaletteOpen(false)}
          onNavigate={(path: string) => { navigate(path); setCommandPaletteOpen(false); }}
        />
      )}

      <WorkspaceTabBar 
        onToggleSplit={toggleSplitModeFromShell} 
        showWorkspaceTabs={!splitMode} 
      />

      {isDemoMode && (
        <div className="shrink-0 h-8 bg-amber-500/10 border-b border-amber-500/25 flex items-center justify-center gap-3 text-xs text-amber-600 dark:text-amber-400">
          <span>You&apos;re exploring Demo Mode — no changes are saved</span>
          <button 
            onClick={handleExitDemo}
            className="underline hover:no-underline font-medium"
          >
            Exit Demo
          </button>
        </div>
      )}

      {showSinglePaneNavigation && sectionNavigation === "top-tabs" && <TopTabsNavigation />}
      {showSinglePaneNavigation && sectionNavigation === "top-dropdown" && <CompactSectionNavigation />}

      <div className="flex-1 min-h-0">
        {showSplitPaneLayout ? (
          <SplitPaneLayout />
        ) : (
          <div className="flex h-full overflow-hidden min-h-0">
            {showWorkspaceSidebar && <SinglePaneWorkspaceSidebar />}
            {showSectionSidebar && (
              <Sidebar
                onOpenCommandPalette={() => setCommandPaletteOpen(true)}
                showPreferencesButton
                presentation="sidebar"
              />
            )}
            <div className="flex-1 overflow-hidden flex flex-col min-w-0 min-h-0">
              <AppRoutes />
            </div>
          </div>
        )}
      </div>
      {showStatusBar && <StatusBar />}
      <ArtifactPanel />
    </div>
  );
}

const LazyFallback = () => (
  <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">Loading…</div>
);

function AppRoutes() {
  return (
    <Suspense fallback={<LazyFallback />}>
    <Routes>
      <Route path="/" element={<Navigate to="/folder" replace />} />
      <Route path="/folder" element={<FolderDashboardView />} />
      <Route path="/chat" element={<ChatView />} />
      <Route path="/chat/:sessionId" element={<ChatView />} />
      <Route path="/notes" element={<NoteEditorView />} />
      <Route path="/sources" element={<SourceBrowserView />} />
      <Route path="/graph" element={<KnowledgeGraphView />} />
      <Route path="/flashcards" element={<FlashcardReviewView />} />
      <Route path="/learning" element={<LearningPathView />} />
      <Route path="/history" element={<HistoryView />} />
      <Route path="/logs" element={<LogsView />} />
      <Route path="/preferences" element={<PreferencesView />} />
      
      {/* Legacy redirects */}
      <Route path="/documents" element={<Navigate to="/sources" replace />} />
      <Route path="/webcapture" element={<Navigate to="/sources" replace />} />
      <Route path="/grounded" element={<Navigate to="/chat" replace />} />
      <Route path="/chat-sessions" element={<Navigate to="/chat" replace />} />
      <Route path="/daily" element={<Navigate to="/notes" state={{ subView: "daily" }} replace />} />

      <Route path="/plugins" element={<Navigate to="/preferences" state={{ settingsTab: "app" }} replace />} />
      <Route path="/backlinks" element={<Navigate to="/graph" replace />} />
      <Route path="/dedup" element={<Navigate to="/graph" replace />} />
      <Route path="/settings" element={<Navigate to="/preferences" state={{ settingsTab: "app" }} replace />} />
      <Route path="/workspaces" element={<Navigate to="/preferences" state={{ settingsTab: "workspaces" }} replace />} />
      <Route path="/backup" element={<Navigate to="/preferences" state={{ settingsTab: "backup" }} replace />} />
      <Route path="/import" element={<Navigate to="/preferences" state={{ settingsTab: "import" }} replace />} />
      <Route path="/memory" element={<Navigate to="/preferences" state={{ settingsTab: "memory" }} replace />} />
    </Routes>
    </Suspense>
  );
}
