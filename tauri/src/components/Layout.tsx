import { useEffect, useState } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import {
  Panel, PanelGroup, PanelResizeHandle,
} from "react-resizable-panels";
import { Plus, PanelLeft, LayoutList, Settings as SettingsIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import { PRIMARY_NAV_ITEMS } from "./navigationItems";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { api } from "../lib/api";
import { isMac } from "../lib/platform";
import ChatView from "../views/ChatView";
import KnowledgeGraphView from "../views/KnowledgeGraphView";
import DailyNotesView from "../views/DailyNotesView";
import FlashcardReviewView from "../views/FlashcardReviewView";
import ProjectDashboardView from "../views/ProjectDashboardView";
import PreferencesView from "../views/PreferencesView";
import DocumentBrowserView from "../views/DocumentBrowserView";
import LearningPathView from "../views/LearningPathView";
import PluginManagerView from "../views/PluginManagerView";
import NoteEditorView from "../views/NoteEditorView";
import WebCaptureView from "../views/WebCaptureView";

function WorkspaceTabBar() {
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, addWorkspace, workspaceNavigation, setWorkspaceNavigation } = useWorkspaceStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const navigate = useNavigate();

  async function createWorkspace() {
    if (!newName.trim()) { return; }
    const ws = await api.workspace.create(newName.trim());
    addWorkspace(ws);
    setActiveWorkspaceId(ws.id);
    setNewName("");
    setCreating(false);
  }

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={() => getCurrentWindow().toggleMaximize()}
      className={`flex items-center h-9 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2 shrink-0 overflow-x-auto ${isMac ? "pl-[72px]" : ""}`}
    >
      {workspaces.map((ws) => (
        <button
          key={ws.id}
          onClick={() => setActiveWorkspaceId(ws.id)}
          className={`flex items-center gap-1.5 px-3 h-full text-xs whitespace-nowrap border-b-2 transition-colors ${
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
  );
}

function NavigationTabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeSegment = "/" + location.pathname.split("/")[1];
  const renderItem = (
    path: string,
    label: string,
    Icon: LucideIcon,
  ) => (
    <button
      key={path}
      onClick={() => navigate(path)}
      className={`flex items-center gap-1.5 px-3 h-full text-xs whitespace-nowrap border-b-2 transition-colors ${
        activeSegment === path
          ? "border-[var(--accent-color)] text-[var(--accent-color)] font-medium"
          : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );

  return (
    <div className="flex items-center h-9 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2 shrink-0 overflow-x-auto">
      <div className="flex items-center shrink-0">
        {PRIMARY_NAV_ITEMS.map(({ path, icon: Icon, label }) => renderItem(path, label, Icon))}
      </div>
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
      <Route path="/daily" element={<DailyNotesView />} />
      <Route path="/documents" element={<DocumentBrowserView />} />
      <Route path="/webcapture" element={<WebCaptureView />} />
      <Route path="/graph" element={<KnowledgeGraphView />} />
      <Route path="/flashcards" element={<FlashcardReviewView />} />
      <Route path="/learning" element={<LearningPathView />} />
      <Route path="/plugins" element={<PluginManagerView />} />
      <Route path="/preferences" element={<PreferencesView />} />
      
      {/* Legacy redirects */}
      <Route path="/compare" element={<Navigate to="/chat" state={{ subView: "compare" }} replace />} />
      <Route path="/grounded" element={<Navigate to="/chat" state={{ subView: "grounded" }} replace />} />
      <Route path="/backlinks" element={<Navigate to="/graph" state={{ subView: "backlinks" }} replace />} />
      <Route path="/dedup" element={<Navigate to="/graph" state={{ subView: "dedup" }} replace />} />
      <Route path="/settings" element={<Navigate to="/preferences" state={{ settingsTab: "general" }} replace />} />
      <Route path="/workspaces" element={<Navigate to="/preferences" state={{ settingsTab: "workspaces" }} replace />} />
      <Route path="/backup" element={<Navigate to="/preferences" state={{ settingsTab: "backup" }} replace />} />
    </Routes>
  );
}
