import { useEffect, useRef, useState } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import {
  Panel, PanelGroup, PanelResizeHandle,
} from "react-resizable-panels";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
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

export default function Layout() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

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
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {commandPaletteOpen && (
        <CommandPalette
          onClose={() => setCommandPaletteOpen(false)}
          onNavigate={(path) => { navigate(path); setCommandPaletteOpen(false); }}
        />
      )}

      <PanelGroup direction="horizontal" className="flex-1 flex overflow-hidden">
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
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="/chat" element={<ChatView />} />
            <Route path="/chat/:sessionId" element={<ChatView />} />
            <Route path="/graph" element={<KnowledgeGraphView />} />
            <Route path="/daily" element={<DailyNotesView />} />
            <Route path="/flashcards" element={<FlashcardReviewView />} />
            <Route path="/project" element={<ProjectDashboardView />} />
            <Route path="/documents" element={<DocumentBrowserView />} />
            <Route path="/learning" element={<LearningPathView />} />
            <Route path="/backup" element={<BackupSettingsSection />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="/backlinks" element={<BacklinksView />} />
            <Route path="/grounded" element={<GroundedChatView />} />
          </Routes>
        </Panel>
      </PanelGroup>
    </div>
  );
}
