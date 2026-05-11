import React, { Suspense, useMemo } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { type PaneId, type PaneView, type Workspace, useWorkspaceStore } from "../stores/workspaceStore";
import { WorkspacePaneProvider, useScopedWorkspace } from "../lib/workspacePane";
import { MessageSquare, FileText, BarChart2, LucideIcon, FileEdit, Network } from "lucide-react";
import CompactMenuSelect from "./CompactMenuSelect";
import { Tooltip } from "./Tooltip";

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
  { view: "graph", icon: Network, label: "Knowledge" },
];

function resolveSplitSectionNavigation(
  sectionNavigation: ReturnType<typeof useWorkspaceStore.getState>["sectionNavigation"]
) {
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

function SplitSectionDropdown({ paneId }: { paneId: PaneId }) {
  const setPaneView = useWorkspaceStore((s) => s.setPaneView);
  const { activeView } = useScopedWorkspace();
  const sectionOptions = PANE_NAV_ITEMS.map(({ view, label }) => ({ value: view, label }));
  const selectedView = sectionOptions.some((item) => item.value === activeView)
    ? activeView
    : "project";

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-elevated)]">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
        Section
      </span>
      <CompactMenuSelect
        label={`Section ${paneId}`}
        value={selectedView}
        options={sectionOptions}
        onChange={(value) => setPaneView(paneId, value as PaneView)}
        widthClassName="min-w-0 w-full max-w-[220px] sm:w-[200px]"
      />
    </div>
  );
}

function usePaneSubWorkspaces(paneId: PaneId) {
  const allWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const paneWorkspaceId = useWorkspaceStore((s) => s.panes[paneId].workspaceId);

  return useMemo(() => {
    if (!paneWorkspaceId) { return { parent: null as Workspace | null, children: [] as Workspace[] }; }
    const current = allWorkspaces.find((ws) => ws.id === paneWorkspaceId);
    if (!current) { return { parent: null as Workspace | null, children: [] as Workspace[] }; }

    const parentId = current.parent_workspace_id ?? current.id;
    const parent = allWorkspaces.find((ws) => ws.id === parentId) ?? null;
    const children = allWorkspaces.filter((ws) => ws.parent_workspace_id === parentId);
    return { parent, children };
  }, [allWorkspaces, paneWorkspaceId]);
}

function PaneSubWorkspaceTabs({ paneId }: { paneId: PaneId }) {
  const { parent, children } = usePaneSubWorkspaces(paneId);
  const paneWorkspaceId = useWorkspaceStore((s) => s.panes[paneId].workspaceId);
  const setPaneWorkspace = useWorkspaceStore((s) => s.setPaneWorkspace);
  if (!parent) {
    return <div className="h-8 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/80 shrink-0" />;
  }

  return (
    <div className="flex items-center h-8 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/80 px-2 shrink-0 select-none">
      <div className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
        {/* Pinned overview dot — navigates to the parent (overview) workspace */}
        <Tooltip content={parent.name} position="top">
          <button
            data-testid={`pane-pinned-tab-${paneId}`}
            onClick={() => setPaneWorkspace(paneId, parent.id)}
            className={`relative mt-0.5 flex h-[26px] w-[26px] items-center justify-center self-end rounded-t-lg border border-b-0 transition-all select-none border-r-2 border-r-[var(--accent-color)]/60 ${
              paneWorkspaceId === parent.id
                ? "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--accent-color)]"
                : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/80 hover:text-[var(--text-primary)]"
            }`}
          >
            <svg data-testid="pinned-dot" width="6" height="6" viewBox="0 0 6 6" className="fill-current opacity-80 shrink-0"><circle cx="3" cy="3" r="3" /></svg>
          </button>
        </Tooltip>
        {children.map((workspace) => (
          <button
            key={workspace.id}
            onClick={() => setPaneWorkspace(paneId, workspace.id)}
            className={`relative mt-0.5 flex h-[26px] items-center gap-1.5 self-end rounded-t-lg border border-b-0 px-3 text-xs font-medium whitespace-nowrap transition-all select-none ${
              paneWorkspaceId === workspace.id
                ? "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/80 hover:text-[var(--text-primary)]"
            }`}
          >
            {paneWorkspaceId === workspace.id && (
              <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-[var(--accent-color)]" />
            )}
            {workspace.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkspacePaneChrome({ paneId }: { paneId: PaneId }) {
  const sectionNavigation = useWorkspaceStore((s) => s.sectionNavigation);
  const setPaneView = useWorkspaceStore((s) => s.setPaneView);
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId);
  const { activeView } = useScopedWorkspace();
  const resolvedSplitSectionNavigation = resolveSplitSectionNavigation(sectionNavigation);

  return (
    <div
      className="flex h-full flex-col min-w-0 min-h-0 bg-[var(--bg-primary)]"
      onClick={() => setActivePaneId(paneId)}
      onFocusCapture={() => setActivePaneId(paneId)}
    >
      <div className="flex flex-col shrink-0 bg-[var(--bg-sidebar)]">
        <PaneSubWorkspaceTabs paneId={paneId} />
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
  const splitSizes = useWorkspaceStore((s) => s.splitSizes);
  const setSplitSizes = useWorkspaceStore((s) => s.setSplitSizes);

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
      <Panel id="split-secondary" order={1} defaultSize={splitSizes[1]} minSize={30} className="overflow-hidden min-w-0">
        <WorkspacePaneProvider paneId="secondary">
          <WorkspacePaneChrome paneId="secondary" />
        </WorkspacePaneProvider>
      </Panel>
    </PanelGroup>
  );
}
