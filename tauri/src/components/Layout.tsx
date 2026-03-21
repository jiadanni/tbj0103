import { useEffect, useState } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import {
  Panel, PanelGroup, PanelResizeHandle,
} from "react-resizable-panels";
import { Plus } from "lucide-react";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { api } from "../lib/api";

import {
  MessageSquare, Network, CreditCard,
  FileText, Settings,
  BarChart2, LucideIcon,
  Globe, FileEdit, Inbox,
} from "lucide-react";

const NAV_ITEMS: { path: string; icon: LucideIcon; label: string }[] = [
  { path: "/project",       icon: BarChart2,             label: "Dashboard"        },
  { path: "/chat",          icon: MessageSquare,          label: "Chat"             },
  { path: "/notes",         icon: FileEdit,               label: "Notes"            },
  { path: "/documents",     icon: FileText,               label: "Documents"        },
  { path: "/webcapture",    icon: Globe,                  label: "Web Captures"     },
  { path: "/graph",         icon: Network,                label: "Knowledge Graph"  },
  { path: "/flashcards",    icon: CreditCard,             label: "Flashcards"       },
  { path: "/settings",      icon: Settings,               label: "Settings"         },
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

function WorkspaceTabBar() {
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, addWorkspace } = useWorkspaceStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [dragOverWsId, setDragOverWsId] = useState<string | null>(null);

  async function createWorkspace() {
    if (!newName.trim()) return;
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
    if (!data) return;
    try {
      const sessionIds: string[] = JSON.parse(data);
      if (sessionIds.length === 0) return;
      await api.chat.moveSessions(sessionIds, targetWsId);
      // Remove moved sessions from current store
      const { useChatStore } = await import("../stores/chatStore");
      sessionIds.forEach((id) => useChatStore.getState().removeSession(id));
    } catch (err) {
      console.error("Failed to move sessions:", err);
    }
  }

  return (
    <div className="flex items-center h-9 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2 shrink-0 overflow-x-auto">
      {workspaces.map((ws) => (
        <button
          key={ws.id}
          onClick={() => setActiveWorkspaceId(ws.id)}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("application/x-chat-session-ids")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOverWsId(ws.id);
            }
          }}
          onDragLeave={() => setDragOverWsId(null)}
          onDrop={(e) => handleDrop(e, ws.id)}
          className={`flex items-center gap-1.5 px-3 h-full text-xs whitespace-nowrap border-b-2 transition-colors ${
            dragOverWsId === ws.id
              ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)] font-medium"
              : activeWorkspaceId === ws.id
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
              if (e.key === "Enter") createWorkspace();
              if (e.key === "Escape") setCreating(false);
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
      {NAV_ITEMS.map(({ path, icon: Icon, label }) => (
        <button
          key={path}
          onClick={() => navigate(path)}
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
          </Routes>
        </Panel>
      </PanelGroup>
      )}
    </div>
  );
}
