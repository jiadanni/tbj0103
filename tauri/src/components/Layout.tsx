import React, { useEffect, useRef, useState, Suspense } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import { message } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useChatStore } from "../stores/chatStore";
import { api } from "../lib/api";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import SplitPaneLayout from "./SplitPaneLayout";
import RouteSkeleton from "./RouteSkeleton";
import StatusBar from "./StatusBar";
import { WorkspaceTabBar } from "./workspaceNav/WorkspaceTabBar";
import { TopTabsNavigation, CompactSectionNavigation } from "./workspaceNav/SectionNavigation";
import {
  SinglePaneWorkspaceSidebar,
  SinglePaneSubWorkspaceSidebar,
} from "./workspaceNav/SinglePaneWorkspaceSidebar";

// Lazy-load heavy views that import large dependencies (d3, CodeMirror, etc.)
// FolderDashboardView is the home surface, while PracticeView owns review/quiz.
const ChatView = React.lazy(() => import("../views/ChatView"));
const HistoryView = React.lazy(() => import("../views/HistoryView"));
const FolderDashboardView = React.lazy(() => import("../views/FolderDashboardView"));
const PracticeView = React.lazy(() => import("../views/PracticeView"));
const PreferencesView = React.lazy(() => import("../views/PreferencesView"));
const NoteEditorView = React.lazy(() => import("../views/NoteEditorView"));
const LogsView = React.lazy(() => import("../views/LogsView"));
const ReviewTopicsView = React.lazy(() => import("../views/ReviewTopicsView"));
const TopicsListView = React.lazy(() => import("../views/TopicsListView"));
const HelpView = React.lazy(() => import("../views/HelpView"));

function pathToPaneView(pathname: string): import("../stores/workspaceStore").PaneView {
  const segment = pathname.split("/")[1];
  switch (segment) {
    case "chat": return "chat";
    case "notes": return "notes";
    case "documents": return "notes";
    case "sources": return "notes";
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
      return "/notes";
    case "graph": return "/folder";
    case "flashcards": return "/practice";
    case "settings": return "/preferences";
    case "memory": return "/memory";
    case "folder": return "/folder";
    default: return "/folder";
  }
}

export default function Layout() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const [, startNavTransition] = React.useTransition();
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
  const subWorkspaceNavigation = useWorkspaceStore((state) => state.subWorkspaceNavigation);
  const combineSectionDropdown = useWorkspaceStore((state) => state.combineSectionDropdown);
  const isDemoMode = useWorkspaceStore((state) => state.isDemoMode);
  const setDemo = useWorkspaceStore((state) => state.setDemo);
  const showStatusBar = useSettingsStore((state) => state.showStatusBar);
  const splitUnsupportedRoute = ["/preferences"].some((path) => location.pathname.startsWith(path));
  const showSplitPaneLayout = splitMode && !splitUnsupportedRoute;
  const showSinglePaneNavigation = !showSplitPaneLayout;
  const showSectionSidebar = showSinglePaneNavigation && sectionNavigation === "sidebar";
  const showWorkspaceSidebar = showSinglePaneNavigation && workspaceNavigation === "sidebar";
  const showSubWorkspaceSidebar = showSinglePaneNavigation && subWorkspaceNavigation === "sidebar";
  const _hasLeftRail = showSectionSidebar;

  const hydratedIconsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const ws of workspaces) {
      if (!ws.icon && !hydratedIconsRef.current.has(ws.id)) {
        hydratedIconsRef.current.add(ws.id);
        void api.workspace.generateIcon(ws.id).catch(() => {});
      }
    }
  }, [workspaces]);

  const handleExitDemo = async () => {
    try {
      // Mark demo as dismissed to prevent re-auto-activation
      await api.settings.updateOne("demo_dismissed", true);
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

  return (
    <div className="relative flex flex-col h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {commandPaletteOpen && (
        <CommandPalette
          workspaceId={activeWorkspaceId ?? ""}
          onClose={() => setCommandPaletteOpen(false)}
          onNavigate={(path: string) => { startNavTransition(() => { navigate(path); }); setCommandPaletteOpen(false); }}
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
      {showSinglePaneNavigation && sectionNavigation === "top-dropdown" && !combineSectionDropdown && <CompactSectionNavigation />}

      <div className="flex-1 min-h-0">
        {showSplitPaneLayout ? (
          <SplitPaneLayout />
        ) : (
          <div className="flex h-full overflow-hidden min-h-0">
            {showWorkspaceSidebar && <SinglePaneWorkspaceSidebar />}
            {showSubWorkspaceSidebar && <SinglePaneSubWorkspaceSidebar />}
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
    </div>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<RouteSkeleton />}>
    <Routes>
      <Route path="/" element={<Navigate to="/folder" replace />} />
      <Route path="/folder" element={<FolderDashboardView />} />
      <Route path="/chat" element={<ChatView />} />
      <Route path="/chat/:sessionId" element={<ChatView />} />
      <Route path="/notes" element={<NoteEditorView />} />
      <Route path="/practice" element={<PracticeView />} />
      <Route path="/sources" element={<Navigate to="/notes" replace />} />
      <Route path="/learning" element={<Navigate to="/folder" replace />} />
      <Route path="/review-topics" element={<ReviewTopicsView />} />
      <Route path="/topics" element={<TopicsListView />} />
      <Route path="/history" element={<HistoryView />} />
      <Route path="/logs" element={<LogsView />} />
      <Route path="/preferences" element={<PreferencesView />} />
      <Route path="/help" element={<HelpView />} />
      
      {/* Legacy redirects */}
      <Route path="/graph" element={<Navigate to="/folder" replace />} />
      <Route path="/flashcards" element={<Navigate to="/practice" replace />} />
      <Route path="/documents" element={<Navigate to="/sources" replace />} />
      <Route path="/webcapture" element={<Navigate to="/sources" replace />} />
      <Route path="/grounded" element={<Navigate to="/chat" replace />} />
      <Route path="/chat-sessions" element={<Navigate to="/chat" replace />} />
      <Route path="/daily" element={<Navigate to="/notes" replace />} />

      <Route path="/plugins" element={<Navigate to="/preferences" state={{ settingsTab: "app" }} replace />} />
      <Route path="/backlinks" element={<Navigate to="/folder" replace />} />
      <Route path="/dedup" element={<Navigate to="/folder" replace />} />
      <Route path="/settings" element={<Navigate to="/preferences" state={{ settingsTab: "app" }} replace />} />
      <Route path="/workspaces" element={<Navigate to="/preferences" state={{ settingsTab: "workspaces" }} replace />} />
      <Route path="/backup" element={<Navigate to="/preferences" state={{ settingsTab: "backup" }} replace />} />
      <Route path="/import" element={<Navigate to="/preferences" state={{ settingsTab: "import" }} replace />} />
      <Route path="/memory" element={<Navigate to="/preferences" state={{ settingsTab: "memory" }} replace />} />
    </Routes>
    </Suspense>
  );
}
