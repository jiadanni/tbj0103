import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
  ask: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ toggleMaximize: vi.fn() }),
}));

vi.mock("react-resizable-panels", () => ({
  PanelGroup: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  Panel: ({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) => <div className={className} data-testid={id ? `panel-${id}` : undefined}>{children}</div>,
  PanelResizeHandle: ({ className }: { className?: string }) => <div data-testid="resize-handle" className={className} />,
}));

vi.mock("@/components/Sidebar", () => ({
  default: () => <div>Sidebar</div>,
}));

vi.mock("@/components/CommandPalette", () => ({
  default: () => null,
}));

vi.mock("@/components/ArtifactPanel", () => ({
  default: () => null,
}));

vi.mock("@/components/WindowControls", () => ({
  __esModule: true,
  default: () => null,
  onDragRegionDoubleClick: vi.fn(),
  onDragRegionMouseDown: vi.fn(),
}));

vi.mock("@/hooks/useHotkeys", () => ({
  useHotkeys: () => undefined,
}));

vi.mock("@/lib/workspacePane", () => ({
  WorkspacePaneProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useScopedWorkspace: () => ({
    activeWorkspaceId: "ws-1",
    activeProjectId: null,
    activeView: "project",
    activeChatSessionId: null,
    noteSelection: null,
    isSplitPane: true,
  }),
}));

vi.mock("@/views/ChatView", () => ({ default: () => <div>Chat View</div> }));
vi.mock("@/views/KnowledgeGraphView", () => ({ default: () => <div>Graph View</div> }));
vi.mock("@/views/DailyNotesView", () => ({ default: () => <div>Daily Notes View</div> }));
vi.mock("@/views/FlashcardReviewView", () => ({ default: () => <div>Flashcards View</div> }));
vi.mock("@/views/ProjectDashboardView", () => ({ default: () => <div>Project Dashboard</div> }));
vi.mock("@/views/PreferencesView", () => ({ default: () => <div>Preferences View</div> }));
vi.mock("@/views/DocumentBrowserView", () => ({ default: () => <div>Documents View</div> }));
vi.mock("@/views/LearningPathView", () => ({ default: () => <div>Learning Path View</div> }));
vi.mock("@/views/MemoryView", () => ({ default: () => <div>Memory View</div> }));
vi.mock("@/views/NoteEditorView", () => ({ default: () => <div>Notes View</div> }));
vi.mock("@/views/WebCaptureView", () => ({ default: () => <div>Web Capture View</div> }));

import Layout from "@/components/Layout";

const INITIAL = {
  workspaces: [],
  activeWorkspaceId: null,
  activeProjectId: null,
  projects: [],
  isDemoMode: false,
  workspaceNavigation: "sidebar" as const,
  sectionNavigation: "sidebar" as const,
  splitWorkspaceNavigation: "match-main" as const,
  splitSectionNavigation: "match-main" as const,
  activeTopicSignature: null,
  migrationSuggestion: null,
  projectsByWorkspace: {},
  splitMode: false,
  splitSizes: [50, 50] as [number, number],
  activePaneId: "primary" as const,
  panes: {
    primary: { workspaceId: null, projectId: null, view: "project" as const, chatSessionId: null, noteSelection: null },
    secondary: { workspaceId: null, projectId: null, view: "project" as const, chatSessionId: null, noteSelection: null },
  },
};

describe("Layout", () => {
  beforeEach(() => {
    useWorkspaceStore.setState(INITIAL);
    useSettingsStore.setState({ switchWorkspaceToChat: false });
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });
    vi.restoreAllMocks();
  });

  it("marks the workspace tab bar as a drag region", () => {
    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    const dragRegions = document.querySelectorAll("[data-tauri-drag-region]");
    expect(dragRegions.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the workspace tab strip separate from the fixed titlebar actions", () => {
    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    const dragRegion = document.querySelector("[data-tauri-drag-region]");
    const tabStrip = document.querySelector("[data-workspace-tab-strip]");
    const fixedActions = document.querySelector("[data-workspace-titlebar-actions]");

    expect(dragRegion).not.toBeNull();
    expect(tabStrip).not.toBeNull();
    expect(fixedActions).not.toBeNull();
    expect(tabStrip?.parentElement).toBe(dragRegion);
    expect(fixedActions?.parentElement).toBe(dragRegion);
    expect(tabStrip).toHaveAttribute("data-no-drag");
  });

  it("renders a dedicated draggable handle in the title bar", () => {
    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    const dragHandle = document.querySelector("[data-window-drag-handle]");

    expect(dragHandle).not.toBeNull();
    expect(dragHandle).not.toHaveAttribute("data-no-drag");
    expect(dragHandle?.parentElement).toHaveAttribute("data-tauri-drag-region");
  });

  it("renders the sidebar in sidebar navigation mode", () => {
    useWorkspaceStore.setState({ sectionNavigation: "sidebar" });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByText("Sidebar")).toBeInTheDocument();
  });

  it("does not render the floating Preferences dock button when the standard sidebar shell is shown", () => {
    render(
      <MemoryRouter initialEntries={["/preferences"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.queryByTitle("Preferences")).not.toBeInTheDocument();
  });

  it("renders the floating Preferences dock button in split mode", () => {
    useWorkspaceStore.setState({ splitMode: true });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByTitle("Preferences")).toBeInTheDocument();
  });

  it("renders workspace tabs and allows switching", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
        { id: "ws-2", name: "Rust", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
      ],
      activeWorkspaceId: "ws-1",
    });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByText("Agentic")).toBeInTheDocument();
    expect(screen.getByText("Rust")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Rust"));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
  });

  it("hides the global workspace tab strip in split view while keeping titlebar actions", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
        { id: "ws-2", name: "Rust", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
      ],
      activeWorkspaceId: "ws-1",
      splitMode: true,
      panes: {
        primary: { workspaceId: "ws-1", projectId: null, view: "project", chatSessionId: null, noteSelection: null },
        secondary: { workspaceId: "ws-2", projectId: null, view: "chat", chatSessionId: null, noteSelection: null },
      },
    });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(document.querySelector("[data-workspace-tab-strip]")).toBeNull();
    expect(document.querySelector("[data-workspace-titlebar-actions]")).not.toBeNull();
    expect(screen.getByText("Split View")).toBeInTheDocument();
  });

  it("opens chats when switching workspaces if the preference is enabled", async () => {
    useSettingsStore.setState({ switchWorkspaceToChat: true });
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
        { id: "ws-2", name: "Rust", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
      ],
      activeWorkspaceId: "ws-1",
    });

    render(
      <MemoryRouter initialEntries={["/documents"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(await screen.findByText("Documents View")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Rust"));

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
    expect(await screen.findByText("Chat View")).toBeInTheDocument();
  });

  it("opens a custom context menu for workspace tabs", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
      ],
      activeWorkspaceId: "ws-1",
    });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    fireEvent.contextMenu(screen.getByText("Agentic"));

    expect(screen.getByText("Open workspace")).toBeInTheDocument();
    expect(screen.getByText("Rename workspace")).toBeInTheDocument();
    expect(screen.getByText("Manage workspaces")).toBeInTheDocument();
  });

  it("opens a custom context menu for top section tabs", () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-tabs" });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    fireEvent.contextMenu(screen.getByText("Dashboard"));

    expect(screen.getByText("Open section")).toBeInTheDocument();
    expect(screen.getByText("Customize navigation")).toBeInTheDocument();
  });

  it("keeps the main route containers shrinkable for scrollable views", () => {
    useWorkspaceStore.setState({ sectionNavigation: "icon-bar" });

    const { container, rerender } = render(
      <MemoryRouter initialEntries={["/chat"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(container.querySelector("div.flex-1.overflow-hidden.flex.flex-col.min-w-0.min-h-0")).not.toBeNull();

    useWorkspaceStore.setState({ sectionNavigation: "sidebar" });
    rerender(
      <MemoryRouter initialEntries={["/chat"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByTestId("panel-main")).toHaveClass("min-h-0");
  });

  it("renders a styled top dropdown for section navigation and navigates from it", async () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-dropdown" });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    const trigger = screen.getByRole("button", { name: "Section: Dashboard" });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Documents" }));

    expect(await screen.findByText("Documents View")).toBeInTheDocument();
  });

});
