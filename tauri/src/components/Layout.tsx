import { useEffect, useRef, useState } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import {
  Panel, PanelGroup, PanelResizeHandle,
} from "react-resizable-panels";
import { Plus, PanelLeft, LayoutList, Settings as SettingsIcon, Pencil, Trash2, ExternalLink } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message } from "@tauri-apps/plugin-dialog";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import { PRIMARY_NAV_ITEMS } from "./navigationItems";
import type { NavigationItem } from "./navigationItems";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { api } from "../lib/api";
import { isMac } from "../lib/platform";
import ChatView from "../views/ChatView";
import KnowledgeGraphView from "../views/KnowledgeGraphView";
import ProjectDashboardView from "../views/ProjectDashboardView";
import PreferencesView from "../views/PreferencesView";
import DocumentBrowserView from "../views/DocumentBrowserView";
import NoteEditorView from "../views/NoteEditorView";
import WebCaptureView from "../views/WebCaptureView";
import type { Workspace } from "../stores/workspaceStore";

function WorkspaceTabBar() {
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, addWorkspace, setWorkspaces, workspaceNavigation, setWorkspaceNavigation } = useWorkspaceStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [contextMenu, setContextMenu] = useState<{ workspace: Workspace; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  async function createWorkspace() {
    if (!newName.trim()) { return; }
    const ws = await api.workspace.create(newName.trim());
    addWorkspace(ws);
    setActiveWorkspaceId(ws.id);
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

  async function deleteWorkspace(workspace: Workspace) {
    if (workspaces.length === 1) {
      await message("Cannot delete the last workspace.", { title: "Aetherium", kind: "error" });
      setContextMenu(null);
      return;
    }

    const confirmed = await ask(`Delete "${workspace.name}" and all its projects, notes, and data? This cannot be undone.`, {
      title: "Confirm Deletion",
      kind: "warning",
    });
    if (!confirmed) {
      setContextMenu(null);
      return;
    }

    await api.workspace.delete(workspace.id);
    const remaining = workspaces.filter((item) => item.id !== workspace.id);
    setWorkspaces(remaining);
    if (activeWorkspaceId === workspace.id) {
      setActiveWorkspaceId(remaining[0]?.id ?? null);
    }
    setContextMenu(null);
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

  return (
    <div className="relative">
      <div
        data-tauri-drag-region
        onDoubleClick={() => getCurrentWindow().toggleMaximize()}
        className={`flex items-center h-9 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2 shrink-0 overflow-x-auto select-none ${isMac ? "pl-[72px]" : ""}`}
      >
        {workspaces.map((ws) => (
          <button
            key={ws.id}
            onClick={() => {
              setActiveWorkspaceId(ws.id);
              setContextMenu(null);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({ workspace: ws, x: event.clientX, y: event.clientY });
            }}
            className={`flex items-center gap-1.5 px-3 h-full text-xs whitespace-nowrap border-b-2 transition-colors select-none ${
              activeWorkspaceId === ws.id
                ? "border-[var(--accent-color)] text-[var(--accent-color)] font-medium"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
              className="text-xs px-2 py-0.5 rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none w-36"
            />
            <button onClick={createWorkspace} className="text-xs px-2 py-0.5 bg-[var(--accent-color)] text-white rounded">
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
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => navigate("/preferences")}
            title="Preferences"
            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <SettingsIcon size={14} />
          </button>
          <button
            onClick={() => setWorkspaceNavigation(workspaceNavigation === "sidebar" ? "top-tabs" : "sidebar")}
            title={workspaceNavigation === "sidebar" ? "Switch to tab navigation" : "Switch to sidebar navigation"}
            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            {workspaceNavigation === "sidebar" ? <LayoutList size={14} /> : <PanelLeft size={14} />}
          </button>
        </div>
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          data-workspace-context-menu
          className="fixed z-50 min-w-[190px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              setActiveWorkspaceId(contextMenu.workspace.id);
              setContextMenu(null);
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
    </div>
  );
}

function NavigationTabBar() {
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
      className={`flex items-center gap-1.5 px-3 h-full text-xs whitespace-nowrap border-b-2 transition-colors select-none ${
        activeSegment === item.path
          ? "border-[var(--accent-color)] text-[var(--accent-color)] font-medium"
          : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      <Icon size={13} />
      {item.label}
    </button>
  );

  return (
    <div className="relative">
      <div className="flex items-center h-9 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2 shrink-0 overflow-x-auto select-none">
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

export default function Layout() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const { workspaceNavigation } = useWorkspaceStore();

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

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {commandPaletteOpen && (
        <CommandPalette
          onClose={() => setCommandPaletteOpen(false)}
          onNavigate={(path: string) => { navigate(path); setCommandPaletteOpen(false); }}
        />
      )}

      <WorkspaceTabBar />

      {workspaceNavigation === "top-tabs" && <NavigationTabBar />}

      <div className="flex-1 overflow-hidden min-h-0">
        {workspaceNavigation === "sidebar" ? (
          <PanelGroup direction="horizontal" className="flex-1 flex overflow-hidden min-h-0">
            <Panel
              id="sidebar"
              order={0}
              defaultSize={18}
              minSize={12}
              maxSize={30}
              className="border-r border-[var(--border-color)] overflow-hidden"
            >
              <Sidebar onOpenCommandPalette={() => setCommandPaletteOpen(true)} />
            </Panel>

            <PanelResizeHandle className="w-[1px] bg-[var(--border-color)] hover:bg-[var(--accent-color)] transition-colors cursor-col-resize" />

            <Panel id="main" order={1} className="overflow-hidden flex flex-col min-w-0">
              <AppRoutes />
            </Panel>
          </PanelGroup>
        ) : (
          <AppRoutes />
        )}
      </div>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/project" replace />} />
      <Route path="/project" element={<ProjectDashboardView />} />
      <Route path="/chat" element={<ChatView />} />
      <Route path="/chat/:sessionId" element={<ChatView />} />
      <Route path="/notes" element={<NoteEditorView />} />
      <Route path="/documents" element={<DocumentBrowserView />} />
      <Route path="/webcapture" element={<WebCaptureView />} />
      <Route path="/graph" element={<KnowledgeGraphView />} />
      <Route path="/preferences" element={<PreferencesView />} />
      
      {/* Legacy redirects */}
      <Route path="/grounded" element={<Navigate to="/chat" state={{ subView: "grounded" }} replace />} />
      <Route path="/chat-sessions" element={<Navigate to="/chat" state={{ subView: "sessions" }} replace />} />
      <Route path="/daily" element={<Navigate to="/notes" state={{ subView: "daily" }} replace />} />
      <Route path="/flashcards" element={<Navigate to="/graph" state={{ subView: "flashcards" }} replace />} />
      <Route path="/learning" element={<Navigate to="/graph" state={{ subView: "learning" }} replace />} />
      <Route path="/plugins" element={<Navigate to="/preferences" state={{ settingsTab: "plugins" }} replace />} />
      <Route path="/backlinks" element={<Navigate to="/graph" state={{ subView: "backlinks" }} replace />} />
      <Route path="/dedup" element={<Navigate to="/graph" state={{ subView: "dedup" }} replace />} />
      <Route path="/settings" element={<Navigate to="/preferences" state={{ settingsTab: "general" }} replace />} />
      <Route path="/workspaces" element={<Navigate to="/preferences" state={{ settingsTab: "workspaces" }} replace />} />
      <Route path="/backup" element={<Navigate to="/preferences" state={{ settingsTab: "backup" }} replace />} />
    </Routes>
  );
}
