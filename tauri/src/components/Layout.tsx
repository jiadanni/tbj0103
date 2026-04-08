import React, { useEffect, useLayoutEffect, useRef, useState, Suspense } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import {
  
} from "react-resizable-panels";
import { Plus, PanelLeftClose, PanelLeftOpen, Settings as SettingsIcon, Pencil, Trash2, ExternalLink, Columns2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import WindowControls, { onDragRegionMouseDown, onDragRegionDoubleClick } from "./WindowControls";
import { PRIMARY_NAV_ITEMS } from "./navigationItems";
import type { NavigationItem } from "./navigationItems";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import AppHeaderMenu from "./AppHeaderMenu";
import ArtifactPanel from "./ArtifactPanel";
import ConfirmDialog from "./ConfirmDialog";
import { api } from "../lib/api";
import { isMac, isLinux } from "../lib/platform";
import SplitPaneLayout from "./SplitPaneLayout";
import ChatView from "../views/ChatView";
import MemoryView from "../views/MemoryView";
import { useArtifactStore } from "../stores/artifactStore";
import CompactMenuSelect from "./CompactMenuSelect";

// Lazy-load heavy views that import large dependencies (d3, CodeMirror, etc.)
const KnowledgeGraphView = React.lazy(() => import("../views/KnowledgeGraphView"));
const HistoryView = React.lazy(() => import("../views/HistoryView"));
const ProjectDashboardView = React.lazy(() => import("../views/ProjectDashboardView"));
const PreferencesView = React.lazy(() => import("../views/PreferencesView"));
const DocumentBrowserView = React.lazy(() => import("../views/DocumentBrowserView"));
const NoteEditorView = React.lazy(() => import("../views/NoteEditorView"));
const WebCaptureView = React.lazy(() => import("../views/WebCaptureView"));
import type { Workspace } from "../stores/workspaceStore";

type WorkspaceDialogState =
  | { kind: "last-workspace" }
  | { kind: "delete"; workspace: Workspace };

function handleHorizontalWheel(event: React.WheelEvent<HTMLDivElement>) {
  const element = event.currentTarget;
  if (element.scrollWidth <= element.clientWidth) {return;}
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {return;}
  element.scrollLeft += event.deltaY;
  event.preventDefault();
}

function PreferencesDockButton() {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate("/preferences")}
      title="Preferences"
      className="absolute bottom-3 left-3 z-30 inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)]/95 px-3 py-2 text-sm font-medium text-[var(--text-secondary)] shadow-lg backdrop-blur-xl transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
    >
      <SettingsIcon size={16} />
      <span>Preferences</span>
    </button>
  );
}

function WorkspaceTabBar({
  onToggleSplit,
  showWorkspaceTabs = true,
}: {
  onToggleSplit: () => void;
  showWorkspaceTabs?: boolean;
}) {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const splitMode = useWorkspaceStore((state) => state.splitMode);
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);
  const addWorkspace = useWorkspaceStore((state) => state.addWorkspace);
  const setWorkspaces = useWorkspaceStore((state) => state.setWorkspaces);
  const sectionNavigation = useWorkspaceStore((state) => state.sectionNavigation);
  const setSectionNavigation = useWorkspaceStore((state) => state.setSectionNavigation);
  const switchWorkspaceToChat = useSettingsStore((state) => state.switchWorkspaceToChat);
  const hideNativeMenu = useSettingsStore((state) => state.hideNativeMenu);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [contextMenu, setContextMenu] = useState<{ workspace: Workspace; x: number; y: number } | null>(null);
  const [dialogState, setDialogState] = useState<WorkspaceDialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [dragOverWorkspaceId, setDragOverWorkspaceId] = useState<string | null>(null);
  const dragHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const activeWorkspaceName = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.name ?? "Split View";

  function activateWorkspace(workspaceId: string) {
    const isChanged = workspaceId !== activeWorkspaceId;
    setActiveWorkspaceId(workspaceId);
    if (isChanged && switchWorkspaceToChat) {
      navigate("/chat");
    }
    setContextMenu(null);
  }

  async function createWorkspace() {
    if (!newName.trim()) { return; }
    const ws = await api.workspace.create(newName.trim());
    addWorkspace(ws);
    activateWorkspace(ws.id);
    setNewName("");
    setCreating(false);
  }

  async function renameWorkspace(workspace: Workspace) {
    const nextName = window.prompt("Rename workspace", workspace.name)?.trim();
    if (!nextName || nextName === workspace.name) {
      setContextMenu(null);
      return;
    }

    await api.workspace.update(workspace.id, nextName, workspace.description, workspace.prompt_instructions);
    setWorkspaces(workspaces.map((item) => item.id === workspace.id ? { ...item, name: nextName } : item));
    setContextMenu(null);
  }

  async function performDeleteWorkspace(workspace: Workspace) {
    await api.workspace.delete(workspace.id);
    const remaining = workspaces.filter((item) => item.id !== workspace.id);
    setWorkspaces(remaining);
    if (activeWorkspaceId === workspace.id) {
      setActiveWorkspaceId(remaining[0]?.id ?? null);
    }
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
    <div className="relative">
      <div
        data-tauri-drag-region
        onMouseDown={onDragRegionMouseDown}
        onDoubleClick={onDragRegionDoubleClick}
        className={`flex items-center h-10 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2 shrink-0 select-none ${isMac ? "pl-[72px]" : ""}`}
      >
        {(hideNativeMenu || isLinux) && <AppHeaderMenu />}
        <div
          data-no-drag
          onWheel={handleHorizontalWheel}
          className="min-w-0 flex-1 overflow-x-auto scrollbar-none"
          {...(showWorkspaceTabs ? { "data-workspace-tab-strip": "" } : {})}
        >
          <div className="flex min-w-max items-center">
            {showWorkspaceTabs ? (
              workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => activateWorkspace(ws.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setContextMenu({ workspace: ws, x: event.clientX, y: event.clientY });
                  }}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes("application/x-chat-session-ids")) {
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDragEnter={(event) => {
                    if (!event.dataTransfer.types.includes("application/x-chat-session-ids")) {
                      return;
                    }
                    event.preventDefault();
                    setDragOverWorkspaceId(ws.id);
                    if (dragHoverTimerRef.current) {
                      clearTimeout(dragHoverTimerRef.current);
                    }
                    dragHoverTimerRef.current = setTimeout(() => {
                      setActiveWorkspaceId(ws.id);
                    }, 600);
                  }}
                  onDragLeave={(event) => {
                    const related = event.relatedTarget as Node | null;
                    if (related && event.currentTarget.contains(related)) {
                      return;
                    }
                    if (dragOverWorkspaceId === ws.id) {
                      setDragOverWorkspaceId(null);
                    }
                    if (dragHoverTimerRef.current) { clearTimeout(dragHoverTimerRef.current); dragHoverTimerRef.current = null; }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOverWorkspaceId(null);
                    if (dragHoverTimerRef.current) { clearTimeout(dragHoverTimerRef.current); dragHoverTimerRef.current = null; }
                    const raw = event.dataTransfer.getData("application/x-chat-session-ids");
                    if (!raw) {
                      return;
                    }
                    try {
                      const sessionIds = JSON.parse(raw) as string[];
                      if (sessionIds.length > 0) {
                        void api.chat.moveSessions(sessionIds, ws.id).then(() => {
                          activateWorkspace(ws.id);
                        });
                      }
                    } catch { /* ignore malformed data */ }
                  }}
                  className={`relative mt-1 flex h-[34px] items-center gap-1.5 self-end rounded-t-xl border border-b-0 px-3.5 text-sm font-medium whitespace-nowrap transition-all select-none ${
                    dragOverWorkspaceId === ws.id
                      ? "border-[rgba(var(--accent-color-rgb),0.45)] bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)] shadow-sm"
                      : activeWorkspaceId === ws.id
                      ? "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_-10px_25px_-20px_rgba(15,23,42,0.55)]"
                      : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/80 hover:text-[var(--text-primary)]"
                  }`}
                >
                  {(dragOverWorkspaceId === ws.id || activeWorkspaceId === ws.id) && (
                    <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-[var(--accent-color)]" />
                  )}
                  {ws.name}
                </button>
              ))
            ) : (
              <div className="flex h-10 items-center px-3 text-sm font-medium text-[var(--text-secondary)]">
                <span className="truncate text-[var(--text-primary)]">{activeWorkspaceName}</span>
                <span className="ml-2 text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">Split View</span>
              </div>
            )}
            <button
              onClick={() => setCreating(true)}
              title="New Workspace"
              className="ml-1 w-9 h-10 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
            >
              <Plus size={20} />
            </button>
          </div>
        </div>
        <div
          data-window-drag-handle
          className="mx-2 hidden h-5 min-w-16 flex-1 rounded-full border border-transparent bg-[var(--bg-hover)]/20 sm:block"
          title="Drag window"
        />
        <div className="ml-2 flex shrink-0 items-center gap-1.5" data-workspace-titlebar-actions>
          <button
            onClick={() => {
              if (sectionNavigation === "sidebar") {
                setSectionNavigation("icon-bar");
              } else if (sectionNavigation === "icon-bar") {
                setSectionNavigation("top-tabs");
              } else {
                setSectionNavigation("sidebar");
              }
            }}
            title={
              sectionNavigation === "sidebar"
                ? "Switch to icon-only sidebar"
                : sectionNavigation === "icon-bar"
                ? "Switch to tab navigation"
                : "Switch to sidebar navigation"
            }
            className="relative w-9 h-10 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
          >
            {sectionNavigation === "sidebar" ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
            {sectionNavigation !== "sidebar" && sectionNavigation !== "icon-bar" && (
              <span className="absolute top-1.5 right-1 w-1.5 h-1.5 bg-[var(--accent-color)] rounded-full ring-2 ring-[var(--bg-sidebar)]"></span>
            )}
          </button>
          <button
            onClick={onToggleSplit}
            disabled={workspaces.length < 2}
            title={`Toggle Split View`}
            className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors ${
              splitMode
                ? "border-[var(--accent-color)] bg-[var(--accent-color)] text-white"
                : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
            } disabled:opacity-40 disabled:hover:border-[var(--border-color)] disabled:hover:text-[var(--text-secondary)]`}
          >
            <Columns2 size={15} /> Split
          </button>
          <WindowControls />
        </div>
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          data-workspace-context-menu
          className="fixed z-50 min-w-[190px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] backdrop-blur-xl py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              activateWorkspace(contextMenu.workspace.id);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <ExternalLink size={11} /> Open workspace
          </button>
          <button
            onClick={() => {
              void renameWorkspace(contextMenu.workspace);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <Pencil size={11} /> Rename workspace
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
            <Trash2 size={11} /> Delete workspace
          </button>
        </div>
      )}
      {dialogState && (
        <ConfirmDialog
          title={dialogState.kind === "delete" ? "Confirm Deletion" : "Cannot Delete Workspace"}
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
      {creating && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => { setCreating(false); setNewName(""); }}
        >
          <div
            className="mx-4 flex w-full max-w-sm flex-col gap-5 rounded-3xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">New Workspace</div>
              <h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">Name your workspace</h3>
            </div>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { void createWorkspace(); }
                if (e.key === "Escape") { setCreating(false); setNewName(""); }
              }}
              placeholder="e.g. Python deep dive"
              className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setCreating(false); setNewName(""); }}
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
          : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/80 hover:text-[var(--text-primary)]"
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
          className="fixed z-50 min-w-[190px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] backdrop-blur-xl py-1 shadow-xl"
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
    : sectionOptions[0]?.value ?? "/project";

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
    default: return "project";
  }
}

export default function Layout() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const splitMode = useWorkspaceStore((state) => state.splitMode);
  const { enterSplitMode, exitSplitMode, setPaneView, setPaneChatSession, workspaces } = useWorkspaceStore();
  const sectionNavigation = useWorkspaceStore((state) => state.sectionNavigation);
  const loadArtifact = useArtifactStore((state) => state.loadArtifact);
  const setArtifactPanelOpen = useArtifactStore((state) => state.setPanelOpen);
  const hasLeftRail = !splitMode && sectionNavigation === "sidebar";
  const showSplitPaneLayout = splitMode && !["/preferences", "/memory", "/webcapture"].some((path) => location.pathname.startsWith(path));

  const toggleSplitModeFromShell = React.useCallback(() => {
    if (splitMode) {
      exitSplitMode();
      return;
    }
    if (workspaces.length < 2) {
      return;
    }
    setPaneView("primary", pathToPaneView(location.pathname));
    const routeSessionId = location.pathname.startsWith("/chat/") ? location.pathname.split("/")[2] ?? null : null;
    setPaneChatSession("primary", routeSessionId);
    enterSplitMode();
  }, [splitMode, location.pathname, workspaces.length, exitSplitMode, enterSplitMode, setPaneView, setPaneChatSession]);

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

      <WorkspaceTabBar onToggleSplit={toggleSplitModeFromShell} showWorkspaceTabs={!splitMode} />

      {!splitMode && sectionNavigation === "top-tabs" && <TopTabsNavigation />}
      {!splitMode && sectionNavigation === "top-dropdown" && <CompactSectionNavigation />}

      <div className="flex-1 overflow-hidden min-h-0">
        {showSplitPaneLayout ? (
          <SplitPaneLayout />
        ) : (
          <div className="flex h-full overflow-hidden min-h-0">
            <Sidebar onOpenCommandPalette={() => setCommandPaletteOpen(true)} showPreferencesButton />
            <div className="flex-1 overflow-hidden flex flex-col min-w-0 min-h-0">
              <AppRoutes />
            </div>
          </div>
        )}
      </div>
      {showSplitPaneLayout && !hasLeftRail && <PreferencesDockButton />}
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
      <Route path="/" element={<Navigate to="/project" replace />} />
      <Route path="/project" element={<ProjectDashboardView />} />
      <Route path="/chat" element={<ChatView />} />
      <Route path="/chat/:sessionId" element={<ChatView />} />
      <Route path="/notes" element={<NoteEditorView />} />
      <Route path="/documents" element={<DocumentBrowserView />} />
      <Route path="/webcapture" element={<WebCaptureView />} />
      <Route path="/graph" element={<KnowledgeGraphView />} />
      <Route path="/history" element={<HistoryView />} />
      <Route path="/memory" element={<MemoryView />} />
      <Route path="/preferences" element={<PreferencesView />} />
      
      {/* Legacy redirects */}
      <Route path="/grounded" element={<Navigate to="/chat" state={{ subView: "grounded" }} replace />} />
      <Route path="/chat-sessions" element={<Navigate to="/chat" state={{ subView: "sessions" }} replace />} />
      <Route path="/daily" element={<Navigate to="/notes" state={{ subView: "daily" }} replace />} />
      <Route path="/flashcards" element={<Navigate to="/graph" replace />} />
      <Route path="/learning" element={<Navigate to="/graph" replace />} />
      <Route path="/plugins" element={<Navigate to="/preferences" state={{ settingsTab: "app" }} replace />} />
      <Route path="/backlinks" element={<Navigate to="/graph" replace />} />
      <Route path="/dedup" element={<Navigate to="/graph" replace />} />
      <Route path="/settings" element={<Navigate to="/preferences" state={{ settingsTab: "app" }} replace />} />
      <Route path="/workspaces" element={<Navigate to="/preferences" state={{ settingsTab: "workspaces" }} replace />} />
      <Route path="/backup" element={<Navigate to="/preferences" state={{ settingsTab: "backup" }} replace />} />
      <Route path="/import" element={<Navigate to="/preferences" state={{ settingsTab: "import" }} replace />} />
    </Routes>
    </Suspense>
  );
}
