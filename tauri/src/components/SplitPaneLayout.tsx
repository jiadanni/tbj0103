import React, { Suspense } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { type PaneId, type PaneView, useWorkspaceStore } from "../stores/workspaceStore";
import { WorkspacePaneProvider, useScopedWorkspace } from "../lib/workspacePane";
import { MessageSquare, FileText, BarChart2, LucideIcon, FileEdit, Network } from "lucide-react";

const KnowledgeGraphView = React.lazy(() => import("../views/KnowledgeGraphView"));
const ProjectDashboardView = React.lazy(() => import("../views/ProjectDashboardView"));
const DocumentBrowserView = React.lazy(() => import("../views/DocumentBrowserView"));
const NoteEditorView = React.lazy(() => import("../views/NoteEditorView"));
const ChatView = React.lazy(() => import("../views/ChatView"));

const PANE_NAV_ITEMS: { view: PaneView; icon: LucideIcon; label: string }[] = [
  { view: "project", icon: BarChart2, label: "Dashboard" },
  { view: "chat", icon: MessageSquare, label: "Chat" },
  { view: "notes", icon: FileEdit, label: "Notes" },
  { view: "documents", icon: FileText, label: "Documents" },
  { view: "graph", icon: Network, label: "Graph" },
];

function resolveSplitSectionNavigation(
  splitSectionNavigation: ReturnType<typeof useWorkspaceStore.getState>["splitSectionNavigation"],
  sectionNavigation: ReturnType<typeof useWorkspaceStore.getState>["sectionNavigation"]
) {
  if (splitSectionNavigation === "tabs" || splitSectionNavigation === "dropdown") {
    return splitSectionNavigation;
  }

  return sectionNavigation === "top-dropdown" ? "dropdown" : "tabs";
}

function PaneViewRenderer({ view }: { view: PaneView }) {
  let Content;
  switch (view) {
    case "project":
      Content = <ProjectDashboardView />;
      break;
    case "chat":
      Content = <ChatView />;
      break;
    case "notes":
      Content = <NoteEditorView />;
      break;
    case "documents":
      Content = <DocumentBrowserView />;
      break;
    case "graph":
      Content = <KnowledgeGraphView />;
      break;
    default:
      Content = <ProjectDashboardView />;
  }
  return <Suspense fallback={<div className="flex h-full items-center justify-center text-[var(--text-muted)] text-sm">Loading…</div>}>{Content}</Suspense>;
}

function SplitWorkspaceSelector({ paneId }: { paneId: PaneId }) {
  const { workspaces, panes, setPaneWorkspace } = useWorkspaceStore();
  const activeWorkspaceId = panes[paneId].workspaceId ?? "";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
      {workspaces.map((workspace) => (
        <button
          key={`${paneId}-${workspace.id}`}
          onClick={() => setPaneWorkspace(paneId, workspace.id)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-medium whitespace-nowrap transition-colors ${
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

function SplitSectionDropdown({ paneId }: { paneId: PaneId }) {
  const { setPaneView } = useWorkspaceStore();
  const { activeView } = useScopedWorkspace();
  const selectedView = PANE_NAV_ITEMS.some((item) => item.view === activeView)
    ? activeView
    : "project";

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-elevated)]">
      <label
        htmlFor={`split-section-navigation-${paneId}`}
        className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]"
      >
        Section
      </label>
      <select
        id={`split-section-navigation-${paneId}`}
        value={selectedView}
        onChange={(event) => setPaneView(paneId, event.target.value as PaneView)}
        className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
      >
        {PANE_NAV_ITEMS.map(({ view, label }) => (
          <option key={`${paneId}-${view}`} value={view}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function WorkspacePaneChrome({ paneId }: { paneId: PaneId }) {
  const { sectionNavigation, splitSectionNavigation, setPaneView, setActivePaneId } = useWorkspaceStore();
  const { activeView } = useScopedWorkspace();
  const resolvedSplitSectionNavigation = resolveSplitSectionNavigation(splitSectionNavigation, sectionNavigation);

  return (
    <div
      className="flex h-full flex-col min-w-0 min-h-0 bg-[var(--bg-primary)]"
      onClick={() => setActivePaneId(paneId)}
      onFocusCapture={() => setActivePaneId(paneId)}
    >
      <div className="flex flex-col shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]">
        <div className="flex items-center min-w-0 px-2 h-10 gap-2 border-b border-[var(--border-color)]">
          <SplitWorkspaceSelector paneId={paneId} />
        </div>
        {resolvedSplitSectionNavigation === "dropdown" ? (
          <SplitSectionDropdown paneId={paneId} />
        ) : (
          <div className="flex items-center min-w-0 px-2 py-1.5 bg-[var(--bg-elevated)] border-b border-[var(--border-color)]">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {PANE_NAV_ITEMS.map(({ view, icon: Icon, label }) => (
                <button
                  key={`${paneId}-${view}`}
                  onClick={() => setPaneView(paneId, view)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
                    activeView === view
                      ? "bg-[var(--accent-color)] text-white"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <PaneViewRenderer view={activeView} />
      </div>
    </div>
  );
}

export default function SplitPaneLayout() {
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
