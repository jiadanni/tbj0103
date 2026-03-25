import { useEffect, useState } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import {
  Panel, PanelGroup, PanelResizeHandle,
} from "react-resizable-panels";
import { Plus, PanelLeft, LayoutList } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { api } from "../lib/api";
import { isMac } from "../lib/platform";

import {
  MessageSquare, Network, BookOpen, Calendar, CreditCard,
  FileText, Map, Settings, Archive, Link2,
  BarChart2, PuzzleIcon, SplitSquareHorizontal, LucideIcon,
  Globe, GitMerge, LayoutGrid, FileEdit, MessagesSquare,
} from "lucide-react";

const NAV_ITEMS: { path: string; icon: LucideIcon; label: string }[] = [
  { path: "/project",       icon: BarChart2,             label: "Dashboard"        },
  { path: "/chat",          icon: MessageSquare,          label: "Chat"             },
  { path: "/chat-sessions", icon: MessagesSquare,         label: "Chat Sessions"    },
  { path: "/notes",         icon: FileEdit,               label: "Notes"            },
  { path: "/daily",         icon: Calendar,               label: "Daily Notes"      },
  { path: "/documents",     icon: FileText,               label: "Documents"        },
  { path: "/webcapture",    icon: Globe,                  label: "Web Captures"     },
  { path: "/graph",         icon: Network,                label: "Knowledge Graph"  },
  { path: "/flashcards",    icon: CreditCard,             label: "Flashcards"       },
  { path: "/learning",      icon: Map,                    label: "Learning Paths"   },
  { path: "/plugins",       icon: PuzzleIcon,             label: "Plugins"          },
  { path: "/compare",       icon: SplitSquareHorizontal,  label: "Compare Models"   },
  { path: "/backup",        icon: Archive,                label: "Backups"          },
  { path: "/grounded",      icon: BookOpen,               label: "Grounded Chat"    },
  { path: "/backlinks",     icon: Link2,                  label: "Backlinks"        },
  { path: "/dedup",         icon: GitMerge,               label: "Deduplication"    },
  { path: "/workspaces",    icon: LayoutGrid,             label: "Workspaces"       },
  { path: "/settings",      icon: Settings,               label: "Settings"         },
];
import ChatView from "../views/ChatView";
import KnowledgeGraphView from "../views/KnowledgeGraphView";
import DailyNotesView from "../views/DailyNotesView";
import FlashcardReviewView from "../views/FlashcardReviewView";
import ProjectDashboardView from "../views/ProjectDashboardView";
import SettingsView from "../views/SettingsView";
import DocumentBrowserView from "../views/DocumentBrowserView";
import LearningPathView from "../views/LearningPathView";
import BackupSettingsSection from "../views/BackupSettingsSection";
import BacklinksView from "../views/BacklinksView";
import GroundedChatView from "../views/GroundedChatView";
import PluginManagerView from "../views/PluginManagerView";
import ModelComparisonView from "../views/ModelComparisonView";
import NoteEditorView from "../views/NoteEditorView";
import DeduplicationView from "../views/DeduplicationView";
import WorkspaceSettingsView from "../views/WorkspaceSettingsView";
import WebCaptureView from "../views/WebCaptureView";

function WorkspaceTabBar() {
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, addWorkspace, workspaceNavigation, setWorkspaceNavigation } = useWorkspaceStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

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
      <div className="ml-auto flex items-center">
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

  return (
    <div className="flex items-center h-9 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2 shrink-0 overflow-x-auto">
      {NAV_ITEMS.map(({ path, icon: Icon, label }) => (
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
      ))}
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

      {workspaceNavigation === "top-tabs" ? (
        <div className="flex-1 overflow-hidden min-h-0">
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
            <Route path="/compare" element={<ModelComparisonView />} />
            <Route path="/backup" element={<BackupSettingsSection />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="/backlinks" element={<BacklinksView />} />
            <Route path="/grounded" element={<GroundedChatView />} />
            <Route path="/dedup" element={<DeduplicationView />} />
            <Route path="/workspaces" element={<WorkspaceSettingsView />} />
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
            <Route path="/daily" element={<DailyNotesView />} />
            <Route path="/documents" element={<DocumentBrowserView />} />
            <Route path="/webcapture" element={<WebCaptureView />} />
            <Route path="/graph" element={<KnowledgeGraphView />} />
            <Route path="/flashcards" element={<FlashcardReviewView />} />
            <Route path="/learning" element={<LearningPathView />} />
            <Route path="/plugins" element={<PluginManagerView />} />
            <Route path="/compare" element={<ModelComparisonView />} />
            <Route path="/backup" element={<BackupSettingsSection />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="/backlinks" element={<BacklinksView />} />
            <Route path="/grounded" element={<GroundedChatView />} />
            <Route path="/dedup" element={<DeduplicationView />} />
            <Route path="/workspaces" element={<WorkspaceSettingsView />} />
          </Routes>
        </Panel>
      </PanelGroup>
      )}
    </div>
  );
}
