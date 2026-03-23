import React, { useState, useMemo } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import {
  Panel, PanelGroup, PanelResizeHandle,
} from "react-resizable-panels";
import { Check, Columns2, Plus } from "lucide-react";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import ArtifactPanel from "./ArtifactPanel";
import WindowControls, { onDragRegionDoubleClick, onDragRegionMouseDown } from "./WindowControls";
import { type NavigationPresentation, type PaneId, type PaneView, type SplitNavigationPresentation, useWorkspaceStore } from "../stores/workspaceStore";
import { api } from "../lib/api";
import { useHotkeys, type HotkeyBinding } from "../hooks/useHotkeys";
import { isMac, MOD_KEY, CTRL_KEY } from "../lib/platform";
import { WorkspacePaneProvider, useScopedWorkspace } from "../lib/workspacePane";

import {
  MessageSquare, Network, CreditCard,
  ChevronDown, FileText, Settings,
  BarChart2, LucideIcon,
  Globe, FileEdit, Trash2, Brain, Inbox,
} from "lucide-react";

const NAV_ITEMS: { path: string; icon: LucideIcon; label: string; key?: string }[] = [
  { path: "/project",       icon: BarChart2,             label: "Dashboard",       key: "D" },
  { path: "/chat",          icon: MessageSquare,          label: "Chat",            key: "C" },
  { path: "/memory",        icon: Brain,                  label: "Memory",          key: "M" },
  { path: "/notes",         icon: FileEdit,               label: "Notes",           key: "N" },
  { path: "/thoughts",      icon: Inbox,                  label: "Thought Queue",   key: "T" },
  { path: "/documents",     icon: FileText,               label: "Documents",       key: "O" },
  { path: "/webcapture",    icon: Globe,                  label: "Web Captures",    key: "W" },
  { path: "/graph",         icon: Network,                label: "Knowledge Graph", key: "G" },
  { path: "/flashcards",    icon: CreditCard,             label: "Flashcards",      key: "F" },
  { path: "/recycle-bin",   icon: Trash2,                 label: "Recycle Bin",     key: "R" },
  { path: "/settings",      icon: Settings,               label: "Settings",        key: "," },
];
const PANE_NAV_ITEMS: { view: PaneView; icon: LucideIcon; label: string }[] = NAV_ITEMS
  .map((item) => ({
    view: item.path.slice(1) as PaneView,
    icon: item.icon,
    label: item.label,
  }));
import ChatView from "../views/ChatView";
import MemoryView from "../views/MemoryView";
import KnowledgeGraphView from "../views/KnowledgeGraphView";
import FlashcardReviewView from "../views/FlashcardReviewView";
import ProjectDashboardView from "../views/ProjectDashboardView";
import SettingsView from "../views/SettingsView";
import DocumentBrowserView from "../views/DocumentBrowserView";
import NoteEditorView from "../views/NoteEditorView";
import WebCaptureView from "../views/WebCaptureView";
import ThoughtQueueView from "../views/ThoughtQueueView";
import RecycleBinView from "../views/RecycleBinView";

function pathToPaneView(pathname: string): PaneView {
  const segment = pathname.split("/")[1];
  switch (segment) {
    case "chat":
      return "chat";
    case "notes":
      return "notes";
    case "memory":
      return "memory";
    case "thoughts":
      return "thoughts";
    case "documents":
      return "documents";
    case "webcapture":
      return "webcapture";
    case "graph":
      return "graph";
    case "flashcards":
      return "flashcards";
    case "settings":
      return "settings";
    case "recycle-bin":
      return "recycle-bin";
    default:
      return "project";
  }
}

function paneViewToPath(view: PaneView, chatSessionId: string | null) {
  if (view === "chat" && chatSessionId) {
    return `/chat/${chatSessionId}`;
  }
  if (view === "settings") {
    return "/settings";
  }
  return view === "project" ? "/project" : `/${view}`;
}

function MainRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/project" replace />} />
      <Route path="/project" element={<ProjectDashboardView />} />
      <Route path="/chat" element={<ChatView />} />
      <Route path="/chat/:sessionId" element={<ChatView />} />
      <Route path="/memory" element={<MemoryView />} />
      <Route path="/notes" element={<NoteEditorView />} />
      <Route path="/thoughts" element={<ThoughtQueueView />} />
      <Route path="/documents" element={<DocumentBrowserView />} />
      <Route path="/webcapture" element={<WebCaptureView />} />
      <Route path="/graph" element={<KnowledgeGraphView />} />
      <Route path="/flashcards" element={<FlashcardReviewView />} />
      <Route path="/settings" element={<SettingsView />} />
      <Route path="/recycle-bin" element={<RecycleBinView />} />
    </Routes>
  );
}

function PaneViewRenderer({ view }: { view: PaneView }) {
  switch (view) {
    case "project":
      return <ProjectDashboardView />;
    case "chat":
      return <ChatView />;
    case "memory":
      return <MemoryView />;
    case "notes":
      return <NoteEditorView />;
    case "thoughts":
      return <ThoughtQueueView />;
    case "documents":
      return <DocumentBrowserView />;
    case "webcapture":
      return <WebCaptureView />;
    case "graph":
      return <KnowledgeGraphView />;
    case "flashcards":
      return <FlashcardReviewView />;
    case "settings":
      return <SettingsView />;
    case "recycle-bin":
      return <RecycleBinView />;
    default:
      return <ProjectDashboardView />;
  }
}

function SplitToolbarButton({ onToggle }: { onToggle: () => void }) {
  const { splitMode, workspaces } = useWorkspaceStore();
  const canSplit = workspaces.length >= 2;

  return (
    <button
      onClick={onToggle}
      disabled={!canSplit}
      title={`Toggle Split View (${MOD_KEY}\\)`}
      className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
        splitMode
          ? "border-[var(--accent-color)] bg-[var(--accent-color)] text-white"
          : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
      } disabled:opacity-40 disabled:hover:border-[var(--border-color)] disabled:hover:text-[var(--text-secondary)]`}
    >
      <Columns2 size={14} />
      Split
    </button>
  );
}

type SelectMenuOption = {
  value: string;
  label: string;
};

function SelectMenu({
  value,
  options,
  onChange,
  className = "",
  menuClassName = "",
}: {
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  React.useEffect(() => {
    if (!open) {return;}

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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

  if (!selectedOption) {
    return null;
  }

  return (
    <div ref={containerRef} className={`relative ${className}`} data-no-drag>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 text-left text-[15px] text-[var(--text-primary)] shadow-sm transition-colors hover:border-[var(--accent-color)] hover:bg-[var(--bg-hover)] focus:outline-none focus:border-[var(--accent-color)]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{selectedOption.label}</span>
        <ChevronDown size={14} className={`shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className={`absolute left-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated,var(--bg-sidebar))] shadow-2xl ${menuClassName}`}>
          <div role="listbox" aria-activedescendant={value} className="max-h-72 overflow-y-auto p-1">
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  id={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "bg-[var(--accent-color)] text-white"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                  {active ? <Check size={14} className="shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function GlobalSettingsButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const splitMode = useWorkspaceStore((state) => state.splitMode);
  const isActive = location.pathname === "/settings";

  return (
    <button
      onClick={() => {
        const store = useWorkspaceStore.getState();
        if (splitMode) {
          store.exitSplitMode();
        }
        navigate(isActive ? "/project" : "/settings");
      }}
      title={isActive ? "Back to Workspace" : `Settings (${MOD_KEY},)`}
      className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
        isActive
          ? "border-[var(--accent-color)] bg-[var(--accent-color)] text-white"
          : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
      }`}
    >
      <Settings size={14} />
      {isActive ? "Back" : "Settings"}
    </button>
  );
}

function SplitWorkspaceSelector({
  paneId,
  mode,
}: {
  paneId: PaneId;
  mode: "tabs" | "dropdown";
}) {
  const { workspaces, panes, setPaneWorkspace } = useWorkspaceStore();
  const activeWorkspaceId = panes[paneId].workspaceId ?? "";

  if (mode === "dropdown") {
    return (
      <SelectMenu
        value={activeWorkspaceId}
        onChange={(workspaceId) => setPaneWorkspace(paneId, workspaceId || null)}
        options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
        className="min-w-[180px] max-w-[260px]"
        menuClassName="min-w-[220px]"
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {workspaces.map((workspace) => (
        <button
          key={`${paneId}-${workspace.id}`}
          onClick={() => setPaneWorkspace(paneId, workspace.id)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
            activeWorkspaceId === workspace.id
              ? "bg-[var(--accent-color)] text-white"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          }`}
        >
          {workspace.name}
        </button>
      ))}
    </div>
  );
}

function TopToolbar({
  onToggleSplit,
  workspaceNavigation,
}: {
  onToggleSplit: () => void;
  workspaceNavigation: NavigationPresentation;
}) {
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, addWorkspace, setWorkspaces, setProjects, setWorkspaceTopicSignature, splitMode } = useWorkspaceStore();
  const { splitWorkspaceNavigation, splitSizes, panes, workspaceNavigation: mainWorkspaceNavigation } = useWorkspaceStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [dragOverWsId, setDragOverWsId] = useState<string | null>(null);
  const resolvedSplitWorkspaceNavigation = resolveSplitNavigation(splitWorkspaceNavigation, mainWorkspaceNavigation, "dropdown");

  async function createWorkspace() {
    if (!newName.trim()) {return;}
    const ws = await api.workspace.create(newName.trim());
    addWorkspace(ws);
    setActiveWorkspaceId(ws.id);
    setNewName("");
    setCreating(false);
  }

  async function handleDrop(e: React.DragEvent, targetWsId: string) {
    e.preventDefault();
    setDragOverWsId(null);
    const data = e.dataTransfer.getData("application/x-chat-session-ids");
    if (!data) {return;}
    try {
      const sessionIds: string[] = JSON.parse(data);
      if (sessionIds.length === 0) {return;}
      await api.chat.moveSessions(sessionIds, targetWsId);
      // Remove moved sessions from current store
      const { useChatStore } = await import("../stores/chatStore");
      sessionIds.forEach((id) => useChatStore.getState().removeSession(id));
      const refreshedWorkspaces = await api.workspace.list();
      setWorkspaces(refreshedWorkspaces);
      if (activeWorkspaceId) {
        const [refreshedProjects, refreshedSignature] = await Promise.all([
          api.project.list(activeWorkspaceId),
          api.topicSignature.get(activeWorkspaceId),
        ]);
        setProjects(refreshedProjects);
        setWorkspaceTopicSignature(activeWorkspaceId, refreshedSignature);
      }
    } catch (err) {
      console.error("Failed to move sessions:", err);
    }
  }

  return (
    <div data-tauri-drag-region onMouseDown={onDragRegionMouseDown} onDoubleClick={onDragRegionDoubleClick} className={`flex items-center h-11 pt-1 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] pr-2 shrink-0 ${isMac ? "pl-[78px]" : ""}`}>
      <div className="flex items-center overflow-x-auto min-w-0 flex-1 px-3 gap-0.5">
        {splitMode ? (
          <div className="flex min-w-0 flex-1 items-center">
            <div className="min-w-0 px-3" style={{ flexBasis: `${splitSizes[0]}%`, maxWidth: `${splitSizes[0]}%` }}>
              <SplitWorkspaceSelector paneId="primary" mode={resolvedSplitWorkspaceNavigation} />
            </div>
            <div className="h-8 w-px bg-[var(--border-color)] shrink-0" />
            <div className="min-w-0 px-3" style={{ flexBasis: `${splitSizes[1]}%`, maxWidth: `${splitSizes[1]}%` }}>
              <SplitWorkspaceSelector paneId="secondary" mode={resolvedSplitWorkspaceNavigation} />
            </div>
          </div>
        ) : workspaceNavigation === "sidebar" ? null : workspaceNavigation === "top-dropdown" ? (
          <div className="flex items-center gap-2 px-2">
            <SelectMenu
              value={activeWorkspaceId ?? ""}
              onChange={(workspaceId) => setActiveWorkspaceId(workspaceId || null)}
              options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
              className="min-w-[220px] max-w-[300px]"
              menuClassName="min-w-[240px] max-w-[320px] w-full"
            />
            <button
              onClick={() => setCreating(true)}
              title="New Workspace"
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              <Plus size={14} />
            </button>
            {creating ? (
              <div className="flex items-center gap-1 ml-1">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {createWorkspace();}
                    if (e.key === "Escape") {setCreating(false);}
                  }}
                  placeholder="Workspace name"
                  className="text-sm px-2.5 py-1 rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none w-40"
                />
                <button onClick={createWorkspace} className="text-sm px-2.5 py-1 bg-[var(--accent-color)] text-white rounded">
                  Add
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {workspaces.map((ws, idx) => (
              <button
                key={ws.id}
                onClick={() => setActiveWorkspaceId(ws.id)}
                title={idx < 9 ? `${ws.name} (${CTRL_KEY}+${idx + 1})` : ws.name}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("application/x-chat-session-ids")) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverWsId(ws.id);
                  }
                }}
                onDragLeave={() => setDragOverWsId(null)}
                onDrop={(e) => handleDrop(e, ws.id)}
                className={`flex items-center gap-1.5 px-4 h-8 text-[13px] font-medium whitespace-nowrap transition-colors ${
                  dragOverWsId === ws.id
                    ? "rounded-md bg-[var(--accent-color)]/15 text-[var(--accent-color)] font-medium ring-1 ring-[var(--accent-color)]"
                    : activeWorkspaceId === ws.id
                    ? "rounded-md bg-[var(--accent-color)] text-white font-medium"
                    : "rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {ws.name}
              </button>
            ))}
            {creating ? (
              <div className="flex items-center gap-1 ml-1">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {createWorkspace();}
                    if (e.key === "Escape") {setCreating(false);}
                  }}
                  placeholder="Workspace name"
                  className="text-sm px-2.5 py-1 rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none w-40"
                />
                <button onClick={createWorkspace} className="text-sm px-2.5 py-1 bg-[var(--accent-color)] text-white rounded">
                  Add
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                title="New Workspace"
                className="ml-1 p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                <Plus size={14} />
              </button>
            )}
          </>
        )}
      </div>
      <div className="ml-3 flex items-center gap-2">
        <GlobalSettingsButton />
        <SplitToolbarButton onToggle={onToggleSplit} />
      </div>
      <WindowControls />
    </div>
  );
}

function NavigationTabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeSegment = "/" + location.pathname.split("/")[1];

  return (
      <div className="flex items-center h-11 pt-1 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 shrink-0 overflow-x-auto gap-0.5">
        {NAV_ITEMS.map(({ path, icon: Icon, label, key }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            title={key ? `${label} (${MOD_KEY}${key === "," ? "" : "⇧"}${key})` : label}
            className={`flex items-center gap-1.5 px-3 py-1.5 h-fit text-[12px] whitespace-nowrap rounded-md transition-colors ${
              activeSegment === path
                ? "bg-[var(--accent-color)] text-white font-medium"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
  );
}

function NavigationDropdown() {
  const navigate = useNavigate();
  const location = useLocation();
  const activePath = "/" + location.pathname.split("/")[1];

  return (
      <div className="flex items-center h-11 pt-1 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 shrink-0">
        <SelectMenu
          value={activePath}
          onChange={(path) => navigate(path)}
          options={NAV_ITEMS.map(({ path, label }) => ({ value: path, label }))}
          className="min-w-[200px] max-w-[260px]"
          menuClassName="min-w-[220px] max-w-[280px] w-full"
        />
      </div>
  );
}

function resolveSplitNavigation(
  splitSetting: SplitNavigationPresentation,
  mainSetting: NavigationPresentation,
  fallback: "tabs" | "dropdown"
) {
  if (splitSetting === "tabs" || splitSetting === "dropdown") {
    return splitSetting;
  }

  if (mainSetting === "top-tabs") {
    return "tabs";
  }
  if (mainSetting === "top-dropdown") {
    return "dropdown";
  }
  return fallback;
}

function WorkspacePaneChrome({ paneId }: { paneId: PaneId }) {
  const {
    setPaneView,
    setProjects,
    setActivePaneId,
    workspaceNavigation,
    sectionNavigation,
    splitSectionNavigation,
  } = useWorkspaceStore();
  const { activeWorkspaceId, activeView } = useScopedWorkspace();
  const resolvedSectionNavigation = resolveSplitNavigation(splitSectionNavigation, sectionNavigation, "tabs");

  React.useEffect(() => {
    if (!activeWorkspaceId) {return;}
    api.project.list(activeWorkspaceId).then(setProjects).catch(() => {});
  }, [activeWorkspaceId, setProjects]);

  return (
    <div
      className="flex h-full flex-col min-w-0 min-h-0 bg-[var(--bg-primary)]"
      onMouseDown={() => setActivePaneId(paneId)}
    >
      <div className="flex flex-col shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]">
        <div className="flex items-center min-w-0 px-3 py-2">
          {resolvedSectionNavigation === "dropdown" ? (
            <SelectMenu
              value={paneViewToPath(activeView, null)}
              onChange={(path) => setPaneView(paneId, pathToPaneView(path))}
              options={PANE_NAV_ITEMS.map(({ view, label }) => ({ value: paneViewToPath(view, null), label }))}
              className="min-w-[180px] max-w-[240px]"
              menuClassName="min-w-[220px]"
            />
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {PANE_NAV_ITEMS.map(({ view, icon: Icon, label }) => (
                <button
                  key={`${paneId}-${view}`}
                  onClick={() => setPaneView(paneId, view)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
                    activeView === view
                      ? "bg-[var(--accent-color)] text-white"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <PaneViewRenderer view={activeView} />
      </div>
    </div>
  );
}

function SplitPaneLayout() {
  const { splitSizes, setSplitSizes } = useWorkspaceStore();

  return (
    <PanelGroup
      direction="horizontal"
      className="flex-1 flex overflow-hidden min-h-0"
      onLayout={(sizes) => {
        if (sizes.length === 2) {
          setSplitSizes([sizes[0], sizes[1]]);
        }
      }}
    >
      <Panel id="split-primary" order={0} defaultSize={splitSizes[0]} minSize={30} className="overflow-hidden min-w-0">
        <WorkspacePaneProvider paneId="primary">
          <WorkspacePaneChrome paneId="primary" />
        </WorkspacePaneProvider>
      </Panel>
      <PanelResizeHandle className="w-[1px] bg-[var(--border-color)] hover:bg-[var(--accent-color)] transition-colors cursor-col-resize" />
      <Panel id="split-secondary" order={1} defaultSize={splitSizes[1]} minSize={30} className="overflow-hidden min-w-0 border-l border-[var(--border-color)]">
        <WorkspacePaneProvider paneId="secondary">
          <WorkspacePaneChrome paneId="secondary" />
        </WorkspacePaneProvider>
      </Panel>
    </PanelGroup>
  );
}

export default function Layout() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceNavigation, sectionNavigation, splitMode, setPaneView, setPaneChatSession, panes, workspaces } = useWorkspaceStore();
  const sidebarEnabled = workspaceNavigation === "sidebar" || sectionNavigation === "sidebar";

  const toggleSplitModeFromShell = React.useCallback(() => {
    const store = useWorkspaceStore.getState();

    if (store.splitMode) {
      navigate(paneViewToPath(store.panes.primary.view, store.panes.primary.chatSessionId));
      store.exitSplitMode();
      return;
    }

    if (store.workspaces.length < 2) {
      return;
    }

    store.setPaneView("primary", pathToPaneView(location.pathname));
    const routeSessionId = location.pathname.startsWith("/chat/") ? location.pathname.split("/")[2] ?? null : null;
    store.setPaneChatSession("primary", routeSessionId);
    store.enterSplitMode();
  }, [location.pathname, navigate]);

  const hotkeys = useMemo<HotkeyBinding[]>(() => {
    const bindings: HotkeyBinding[] = [
      // Command Palette
      { key: "k", mod: "mod", action: () => setCommandPaletteOpen(v => !v), label: "Command Palette", category: "General", allowInInput: true },

      // View Navigation
      ...NAV_ITEMS.map(item => ({
        key: item.key || "",
        mod: item.key === "," ? "mod" as const : "mod" as const,
        shift: item.key !== ",",
        action: () => navigate(item.path),
        when: () => !useWorkspaceStore.getState().splitMode,
        label: `Go to ${item.label}`,
        category: "Navigation"
      })).filter((binding) => binding.key),

      {
        key: "\\",
        mod: "mod",
        action: () => {
          toggleSplitModeFromShell();
        },
        label: "Toggle Split View",
        category: "Layout",
      },

      // Workspace Switching
      {
        key: "Tab",
        mod: "ctrl",
        when: () => !useWorkspaceStore.getState().splitMode,
        action: () => {
          const { workspaces, activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore.getState();
          const idx = workspaces.findIndex(w => w.id === activeWorkspaceId);
          const next = (idx + 1) % workspaces.length;
          setActiveWorkspaceId(workspaces[next].id);
        },
        label: "Next Workspace",
        category: "Workspaces"
      },
      {
        key: "Tab",
        mod: "ctrl",
        shift: true,
        when: () => !useWorkspaceStore.getState().splitMode,
        action: () => {
          const { workspaces, activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore.getState();
          const idx = workspaces.findIndex(w => w.id === activeWorkspaceId);
          const prev = (idx - 1 + workspaces.length) % workspaces.length;
          setActiveWorkspaceId(workspaces[prev].id);
        },
        label: "Previous Workspace",
        category: "Workspaces"
      },

      // Workspace by number
      ...Array.from({ length: 9 }).map((_, i) => ({
        key: (i + 1).toString(),
        mod: "ctrl" as const,
        when: () => !useWorkspaceStore.getState().splitMode,
        action: () => {
          const { workspaces, setActiveWorkspaceId } = useWorkspaceStore.getState();
          if (workspaces[i]) {
            setActiveWorkspaceId(workspaces[i].id);
          }
        },
        label: `Jump to Workspace ${i + 1}`,
        category: "Workspaces"
      })),

      // Settings Tabs (only when on /settings)
      ...Array.from({ length: 8 }).map((_, i) => ({
        key: (i + 1).toString(),
        mod: "mod" as const,
        shift: true,
        when: () => location.pathname === "/settings",
        action: () => {
          const tabs = ["appearance", "ai", "webai", "security", "workspaces", "backup", "plugins", "mcp"];
          navigate("/settings", { state: { settingsTab: tabs[i] } });
        },
        label: `Settings: Tab ${i + 1}`,
        category: "Settings"
      })),
    ];
    return bindings;
  }, [navigate, location.pathname, toggleSplitModeFromShell]);

  useHotkeys(hotkeys);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {commandPaletteOpen && (
        <CommandPalette
          onClose={() => setCommandPaletteOpen(false)}
          onNavigate={(path: string) => { navigate(path); setCommandPaletteOpen(false); }}
        />
      )}

      <TopToolbar onToggleSplit={toggleSplitModeFromShell} workspaceNavigation={workspaceNavigation} />

      {!splitMode && sectionNavigation === "top-tabs" && <NavigationTabBar />}
      {!splitMode && sectionNavigation === "top-dropdown" && <NavigationDropdown />}

      {splitMode ? (
        <SplitPaneLayout />
      ) : !sidebarEnabled ? (
        <div className="flex-1 overflow-hidden min-h-0">
          <MainRoutes />
        </div>
      ) : (
        <PanelGroup direction="horizontal" className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar: workspace/project nav */}
        <Panel
          id="sidebar"
          order={0}
          defaultSize={18}
          minSize={12}
          maxSize={30}
          className="border-r border-[var(--border-color)] overflow-hidden"
        >
          <Sidebar
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            showWorkspaceNavigation={workspaceNavigation === "sidebar"}
            showSectionNavigation={sectionNavigation === "sidebar"}
          />
        </Panel>

        <PanelResizeHandle className="w-[1px] bg-[var(--border-color)] hover:bg-[var(--accent-color)] transition-colors cursor-col-resize" />

        {/* Main content area */}
        <Panel id="main" order={1} className="overflow-hidden flex flex-col min-w-0 min-h-0">
          <MainRoutes />
        </Panel>
      </PanelGroup>
      )}
      <ArtifactPanel />
    </div>
  );
}
