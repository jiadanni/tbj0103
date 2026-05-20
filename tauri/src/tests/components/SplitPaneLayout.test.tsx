import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useWorkspaceStore } from "@/stores/workspaceStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging: vi.fn(), isMaximized: vi.fn().mockResolvedValue(false) }),
}));

vi.mock("react-resizable-panels", () => ({
  PanelGroup: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  Panel: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  PanelResizeHandle: ({ className }: { className?: string }) => <div data-testid="resize-handle" className={className} />,
}));

vi.mock("@/views/ChatView", () => ({ default: () => <div>Chat View</div> }));
vi.mock("@/views/KnowledgeGraphView", () => ({ default: () => <div>Graph View</div> }));
vi.mock("@/views/NoteEditorView", () => ({ default: () => <div>Notes View</div> }));
vi.mock("@/views/DocumentBrowserView", () => ({ default: () => <div>Docs View</div> }));
vi.mock("@/views/FolderDashboardView", () => ({ default: () => <div>Dashboard View</div> }));

import SplitPaneLayout from "@/components/SplitPaneLayout";

const PARENT_WS = {
  id: "ws-parent",
  name: "Parent Workspace",
  description: "",
  prompt_instructions: "",
  topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false },
  signature_updated_at: null,
  is_hidden: false,
  created_at: "",
  updated_at: "",
  parent_workspace_id: null,
  icon: "",
  order_index: 0,
  last_message_at: null,
  survey_data: null,
  exclude_from_ai_analysis: false,
};

const CHILD_WS = {
  ...PARENT_WS,
  id: "ws-child",
  name: "Child Workspace",
  parent_workspace_id: "ws-parent",
};

const CHILD_WS2 = {
  ...PARENT_WS,
  id: "ws-child2",
  name: "Child Workspace 2",
  parent_workspace_id: "ws-parent",
};

const INITIAL_STORE = {
  workspaces: [PARENT_WS, CHILD_WS, CHILD_WS2],
  activeWorkspaceId: "ws-parent",
  activeParentWorkspaceId: null,
  activeFolderId: null,
  folders: [],
  isDemoMode: false,
  workspaceNavigation: "sidebar" as const,
  sectionNavigation: "sidebar" as const,
  splitWorkspaceNavigation: "match-main" as const,
  splitSectionNavigation: "tabs" as const,
  activeTopicSignature: null,
  migrationSuggestion: null,
  foldersByWorkspace: {},
  splitMode: true,
  splitSizes: [50, 50] as [number, number],
  activePaneId: "primary" as const,
  panes: {
    primary: { workspaceId: "ws-parent", folderId: null, view: "chat" as const, chatSessionId: null, noteSelection: null },
    secondary: { workspaceId: "ws-child", folderId: null, view: "chat" as const, chatSessionId: null, noteSelection: null },
  },
};

describe("SplitPaneLayout — PaneSubWorkspaceTabs", () => {
  beforeEach(() => {
    useWorkspaceStore.setState(INITIAL_STORE);
  });

  it("renders a pinned parent dot in the primary pane", () => {
    render(<SplitPaneLayout />);
    const pinnedTab = screen.getByTestId("pane-pinned-tab-primary");
    expect(pinnedTab).toBeTruthy();
    // Should only contain the dot SVG, not the parent name text
    expect(pinnedTab.textContent).toBe("");
  });

  it("renders the pinned-dot SVG inside the pinned tab", () => {
    render(<SplitPaneLayout />);
    const dots = screen.getAllByTestId("pinned-dot");
    expect(dots.length).toBeGreaterThanOrEqual(1);
  });

  it("clicking the pinned dot switches to the parent (overview) workspace", () => {
    // Start with a child workspace active in the primary pane
    useWorkspaceStore.setState({
      ...INITIAL_STORE,
      panes: {
        ...INITIAL_STORE.panes,
        primary: { ...INITIAL_STORE.panes.primary, workspaceId: "ws-child" },
      },
    });
    render(<SplitPaneLayout />);
    const pinnedTab = screen.getByTestId("pane-pinned-tab-primary");
    fireEvent.click(pinnedTab);
    const state = useWorkspaceStore.getState();
    expect(state.panes.primary.workspaceId).toBe("ws-parent");
  });

  it("pinned dot appears before child workspace tabs in the DOM", () => {
    render(<SplitPaneLayout />);
    const pinnedTab = screen.getByTestId("pane-pinned-tab-primary");
    // The pinned dot's wrapper div should be the first child of the scroll container
    const scrollContainer = pinnedTab.closest("[class*='overflow-x-auto']");
    const firstChild = scrollContainer?.firstElementChild;
    expect(firstChild).toBeTruthy();
    expect(firstChild?.contains(pinnedTab)).toBe(true);
  });
});
