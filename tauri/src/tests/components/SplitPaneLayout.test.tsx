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
vi.mock("@/views/ProjectDashboardView", () => ({ default: () => <div>Dashboard View</div> }));

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
};

const CHILD_WS = {
  ...PARENT_WS,
  id: "ws-child",
  name: "Child Workspace",
  parent_workspace_id: "ws-parent",
};

const INITIAL_STORE = {
  workspaces: [PARENT_WS, CHILD_WS],
  activeWorkspaceId: "ws-parent",
  activeParentWorkspaceId: null,
  activeProjectId: null,
  projects: [],
  isDemoMode: false,
  workspaceNavigation: "sidebar" as const,
  sectionNavigation: "sidebar" as const,
  splitWorkspaceNavigation: "match-main" as const,
  splitSectionNavigation: "tabs" as const,
  activeTopicSignature: null,
  migrationSuggestion: null,
  projectsByWorkspace: {},
  splitMode: true,
  splitSizes: [50, 50] as [number, number],
  activePaneId: "primary" as const,
  panes: {
    primary: { workspaceId: "ws-parent", projectId: null, view: "chat" as const, chatSessionId: null, noteSelection: null },
    secondary: { workspaceId: "ws-child", projectId: null, view: "chat" as const, chatSessionId: null, noteSelection: null },
  },
};

describe("SplitPaneLayout — PaneSubWorkspaceTabs", () => {
  beforeEach(() => {
    useWorkspaceStore.setState(INITIAL_STORE);
  });

  it("renders a pinned parent tab in the primary pane", () => {
    render(<SplitPaneLayout />);
    const pinnedTab = screen.getByTestId("pane-pinned-tab-primary");
    expect(pinnedTab).toBeTruthy();
  });

  it("renders the pinned-dot SVG inside the pinned tab", () => {
    render(<SplitPaneLayout />);
    const dots = screen.getAllByTestId("pinned-dot");
    expect(dots.length).toBeGreaterThanOrEqual(1);
  });

  it("clicking the pinned tab sets the pane workspace to the parent id", () => {
    render(<SplitPaneLayout />);
    // First click into child to move away from parent
    useWorkspaceStore.setState({
      panes: {
        ...INITIAL_STORE.panes,
        primary: { ...INITIAL_STORE.panes.primary, workspaceId: "ws-child" },
      },
    });
    const pinnedTab = screen.getByTestId("pane-pinned-tab-primary");
    fireEvent.click(pinnedTab);
    const state = useWorkspaceStore.getState();
    expect(state.panes.primary.workspaceId).toBe("ws-parent");
  });

  it("pinned parent tab appears before child workspace tabs in the DOM", () => {
    render(<SplitPaneLayout />);
    const pinnedTab = screen.getByTestId("pane-pinned-tab-primary");
    // Get the parent container and verify pinned tab is the first button child
    const container = pinnedTab.parentElement;
    const buttons = container ? Array.from(container.querySelectorAll("button")) : [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons[0]).toBe(pinnedTab);
  });
});
