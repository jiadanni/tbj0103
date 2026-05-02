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

  it("clicking the pinned dot opens a dropdown listing all children", () => {
    render(<SplitPaneLayout />);
    const pinnedTab = screen.getByTestId("pane-pinned-tab-primary");
    fireEvent.click(pinnedTab);
    // The dropdown should list Parent Workspace, Child Workspace, and Child Workspace 2
    // Use getAllByText since names also appear in the tab bar
    expect(screen.getAllByText("Parent Workspace").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Child Workspace").length).toBeGreaterThanOrEqual(2); // tab + dropdown
    expect(screen.getAllByText("Child Workspace 2").length).toBeGreaterThanOrEqual(2);
  });

  it("selecting a child in the dropdown switches the pane workspace", () => {
    render(<SplitPaneLayout />);
    const pinnedTab = screen.getByTestId("pane-pinned-tab-primary");
    fireEvent.click(pinnedTab);
    // Click "Child Workspace 2" in the dropdown
    const child2Button = screen.getAllByText("Child Workspace 2").find(
      (el) => el.tagName === "BUTTON" && el.closest("[class*='absolute']")
    );
    expect(child2Button).toBeTruthy();
    if (child2Button) { fireEvent.click(child2Button); }
    const state = useWorkspaceStore.getState();
    expect(state.panes.primary.workspaceId).toBe("ws-child2");
  });

  it("selecting the parent in the dropdown switches pane to the parent workspace", () => {
    render(<SplitPaneLayout />);
    const pinnedTab = screen.getByTestId("pane-pinned-tab-primary");
    fireEvent.click(pinnedTab);
    // Click "Parent Workspace" in the dropdown
    const parentButton = screen.getAllByText("Parent Workspace").find(
      (el) => el.tagName === "BUTTON" && el.closest("[class*='absolute']")
    );
    expect(parentButton).toBeTruthy();
    if (parentButton) { fireEvent.click(parentButton); }
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
