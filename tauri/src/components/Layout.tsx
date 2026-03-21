import React, { useState, useMemo } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import {
  Panel, PanelGroup, PanelResizeHandle,
} from "react-resizable-panels";
import { Plus } from "lucide-react";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import ArtifactPanel from "./ArtifactPanel";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { api } from "../lib/api";
import { useHotkeys, type HotkeyBinding } from "../hooks/useHotkeys";
import { isMac, MOD_KEY, CTRL_KEY } from "../lib/platform";

import {
  MessageSquare, Network, CreditCard,
  FileText, Settings,
  BarChart2, LucideIcon,
  Globe, FileEdit, Trash2,
} from "lucide-react";

const NAV_ITEMS: { path: string; icon: LucideIcon; label: string; key?: string }[] = [
  { path: "/project",       icon: BarChart2,             label: "Dashboard",       key: "D" },
  { path: "/chat",          icon: MessageSquare,          label: "Chat",            key: "C" },
  { path: "/notes",         icon: FileEdit,               label: "Notes",           key: "N" },
  { path: "/documents",     icon: FileText,               label: "Documents",       key: "O" },
  { path: "/webcapture",    icon: Globe,                  label: "Web Captures",    key: "W" },
  { path: "/graph",         icon: Network,                label: "Knowledge Graph", key: "G" },
  { path: "/flashcards",    icon: CreditCard,             label: "Flashcards",      key: "F" },
  { path: "/recycle-bin",   icon: Trash2,                 label: "Recycle Bin",     key: "R" },
  { path: "/settings",      icon: Settings,               label: "Settings",        key: "," },
];
import ChatView from "../views/ChatView";
import KnowledgeGraphView from "../views/KnowledgeGraphView";
import FlashcardReviewView from "../views/FlashcardReviewView";
import ProjectDashboardView from "../views/ProjectDashboardView";
import SettingsView from "../views/SettingsView";
import DocumentBrowserView from "../views/DocumentBrowserView";
import NoteEditorView from "../views/NoteEditorView";
import WebCaptureView from "../views/WebCaptureView";
import ThoughtQueueView from "../views/ThoughtQueueView";
import RecycleBinView from "../views/RecycleBinView";

function WorkspaceTabBar() {
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, addWorkspace } = useWorkspaceStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [dragOverWsId, setDragOverWsId] = useState<string | null>(null);

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
    } catch (err) {
      console.error("Failed to move sessions:", err);
    }
  }

  return (
    <div data-tauri-drag-region className={`flex items-center h-9 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] pr-2 shrink-0 overflow-x-auto ${isMac ? "pl-[78px]" : "pl-2"}`}>
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
          className={`flex items-center gap-1.5 px-3 h-7 text-xs whitespace-nowrap transition-colors ${
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
    </div>
  );
}

function NavigationTabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeSegment = "/" + location.pathname.split("/")[1];

  return (
    <div className="flex items-center h-11 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 shrink-0 overflow-x-auto gap-1">
      {NAV_ITEMS.map(({ path, icon: Icon, label, key }) => (
        <button
          key={path}
          onClick={() => navigate(path)}
          title={key ? `${label} (${MOD_KEY}${key === "," ? "" : "⇧"}${key})` : label}
          className={`flex items-center gap-2 px-3.5 py-1.5 h-fit text-sm whitespace-nowrap rounded-md transition-colors ${
            activeSegment === path
              ? "bg-[var(--accent-color)] text-white font-medium"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Icon size={16} />
          {label}
        </button>
      ))}
    </div>
  );
}

export default function Layout() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { navLayout } = useWorkspaceStore();

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
        label: `Go to ${item.label}`,
        category: "Navigation"
      })),

      // Workspace Switching
      {
        key: "Tab",
        mod: "ctrl",
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
  }, [navigate, location.pathname]);

  useHotkeys(hotkeys);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {commandPaletteOpen && (
        <CommandPalette
          onClose={() => setCommandPaletteOpen(false)}
          onNavigate={(path: string) => { navigate(path); setCommandPaletteOpen(false); }}
        />
      )}

      <WorkspaceTabBar />

      {navLayout === "tabs" && <NavigationTabBar />}

      {navLayout === "tabs" ? (
        <div className="flex-1 overflow-hidden min-h-0">
          <Routes>
            <Route path="/" element={<Navigate to="/project" replace />} />
            <Route path="/project" element={<ProjectDashboardView />} />
            <Route path="/chat" element={<ChatView />} />
            <Route path="/chat/:sessionId" element={<ChatView />} />
            <Route path="/notes" element={<NoteEditorView />} />
            <Route path="/thoughts" element={<ThoughtQueueView />} />
            <Route path="/documents" element={<DocumentBrowserView />} />
            <Route path="/webcapture" element={<WebCaptureView />} />
            <Route path="/graph" element={<KnowledgeGraphView />} />
            <Route path="/flashcards" element={<FlashcardReviewView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="/recycle-bin" element={<RecycleBinView />} />
          </Routes>
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
          <Sidebar onOpenCommandPalette={() => setCommandPaletteOpen(true)} />
        </Panel>

        <PanelResizeHandle className="w-[1px] bg-[var(--border-color)] hover:bg-[var(--accent-color)] transition-colors cursor-col-resize" />

        {/* Main content area */}
        <Panel id="main" order={1} className="overflow-hidden flex flex-col min-w-0">
          <Routes>
            <Route path="/" element={<Navigate to="/project" replace />} />
            <Route path="/project" element={<ProjectDashboardView />} />
            <Route path="/chat" element={<ChatView />} />
            <Route path="/chat/:sessionId" element={<ChatView />} />
            <Route path="/notes" element={<NoteEditorView />} />
            <Route path="/thoughts" element={<ThoughtQueueView />} />
            <Route path="/documents" element={<DocumentBrowserView />} />
            <Route path="/webcapture" element={<WebCaptureView />} />
            <Route path="/graph" element={<KnowledgeGraphView />} />
            <Route path="/flashcards" element={<FlashcardReviewView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="/recycle-bin" element={<RecycleBinView />} />
          </Routes>
        </Panel>
      </PanelGroup>
      )}
      <ArtifactPanel />
    </div>
  );
}
