import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { api } from "@/lib/api";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
  ask: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
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
    activeFolderId: null,
    activeView: "folder",
    activeChatSessionId: null,
    noteSelection: null,
    isSplitPane: true,
  }),
}));

vi.mock("@/views/ChatView", () => ({ default: () => <div>Chat View</div> }));
vi.mock("@/views/KnowledgeGraphView", () => ({ default: () => <div>Graph View</div> }));
vi.mock("@/views/DailyNotesView", () => ({ default: () => <div>Daily Notes View</div> }));
vi.mock("@/views/FlashcardReviewView", () => ({ default: () => <div>Flashcards View</div> }));
vi.mock("@/views/FolderDashboardView", () => ({ default: () => <div>Project Dashboard</div> }));
vi.mock("@/views/PracticeView", () => ({ default: () => <div>Practice View</div> }));
vi.mock("@/views/PreferencesView", () => ({ default: () => <div>Preferences View</div> }));
vi.mock("@/views/DocumentBrowserView", () => ({ default: () => <div>Documents View</div> }));
vi.mock("@/views/SourceBrowserView", () => ({ default: () => <div>Sources View</div> }));
vi.mock("@/views/HistoryView", () => ({ default: () => <div>History View</div> }));
vi.mock("@/views/LearningPathView", () => ({ default: () => <div>Learning Path View</div> }));
vi.mock("@/views/GlobalMemoryView", () => ({ default: () => <div>Memory View</div> }));
vi.mock("@/views/NoteEditorView", () => ({ default: () => <div>Notes View</div> }));
vi.mock("@/views/WebCaptureView", () => ({ default: () => <div>Web Capture View</div> }));

import Layout from "@/components/Layout";

const INITIAL = {
  workspaces: [],
  activeWorkspaceId: null,
  activeParentWorkspaceId: null,
  activeFolderId: null,
  folders: [],
  isDemoMode: false,
  workspaceNavigation: "sidebar" as const,
  sectionNavigation: "sidebar" as const,
  subWorkspaceNavigation: "top-tabs" as const,
  combineWorkspaceDropdown: false,
  combineSubWorkspaceDropdown: false,
  combineSectionDropdown: false,
  splitWorkspaceNavigation: "match-main" as const,
  splitSectionNavigation: "match-main" as const,
  activeTopicSignature: null,
  migrationSuggestion: null,
  foldersByWorkspace: {},
  splitMode: false,
  splitSizes: [50, 50] as [number, number],
  activePaneId: "primary" as const,
  panes: {
    primary: { workspaceId: null, folderId: null, view: "folder" as const, chatSessionId: null, noteSelection: null },
    secondary: { workspaceId: null, folderId: null, view: "folder" as const, chatSessionId: null, noteSelection: null },
  },
};

describe("Layout", () => {
  beforeEach(() => {
    useWorkspaceStore.setState(INITIAL);
    useSettingsStore.setState({ switchWorkspaceSection: "" });
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });
    vi.restoreAllMocks();
    vi.spyOn(api.chat, "getRecentSessions").mockResolvedValue([]);
  });

  it("marks the workspace tab bar as a drag region", () => {
    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    const dragRegions = document.querySelectorAll("[data-tauri-drag-region]");
    expect(dragRegions.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the workspace tab strip separate from the fixed titlebar actions", () => {
    useWorkspaceStore.setState({ workspaceNavigation: "top-tabs" });
    render(
      <MemoryRouter initialEntries={["/folder"]}>
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
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    const dragHandle = document.querySelector("[data-window-drag-handle]");

    expect(dragHandle).not.toBeNull();
    expect(dragHandle).not.toHaveAttribute("data-no-drag");
    expect(dragHandle?.parentElement).toHaveAttribute("data-tauri-drag-region");
  });

  it("keeps the drag handle compact when single-pane workspace tabs are visible", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Security", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-2", name: "Linux", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1",
      splitMode: false,
      workspaceNavigation: "top-tabs",
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    const dragHandle = document.querySelector("[data-window-drag-handle]");

    expect(dragHandle).not.toBeNull();
    expect(dragHandle).toHaveClass("flex-1");
    expect(dragHandle).toHaveClass("min-w-16");
  });

  it("renders the sidebar in sidebar navigation mode", () => {
    useWorkspaceStore.setState({ sectionNavigation: "sidebar" });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByText("Sidebar")).toBeInTheDocument();
  });

  it("does not render the left sidebar when top-tab section navigation is active", () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-tabs" });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.queryByText("Sidebar")).not.toBeInTheDocument();
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
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByTitle("Preferences")).toBeInTheDocument();
  });

  it("renders a bottom-left Preferences button in top-tab section navigation", () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-tabs" });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByTitle("Preferences")).toBeInTheDocument();
  });

  it("renders a bottom-left Preferences button in top-dropdown section navigation", () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-dropdown" });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByTitle("Preferences")).toBeInTheDocument();
  });

  it("renders workspace tabs and allows switching", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-2", name: "Rust", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1",
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByText("Agentic")).toBeInTheDocument();
    expect(screen.getByText("Rust")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Rust"));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
  });

  it("selecting a root workspace activates its first child workspace", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "root-1", name: "Parent One", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "child-1", name: "Child One", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: "root-1", icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "root-2", name: "Parent Two", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "root-2",
      activeParentWorkspaceId: "root-2",
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText("Parent One"));

    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe("child-1");
    expect(state.activeParentWorkspaceId).toBe("root-1");
  });

  it("renders child workspace tabs for the active parent and allows switching between them", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "root-1", name: "Parent", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "child-1", name: "Alpha", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: "root-1", icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "child-2", name: "Beta", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: "root-1", icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "child-1",
      activeParentWorkspaceId: "root-1",
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Beta"));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("child-2");
  });

  it("creates a child workspace from the sub-workspace tab bar", async () => {
    const createChildSpy = vi.spyOn(api.workspace, "createChild").mockResolvedValue({
      id: "child-3",
      name: "Gamma",
      description: "",
      prompt_instructions: "",
      topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false },
      signature_updated_at: null,
      is_hidden: false,
      created_at: "",
      updated_at: "",
      parent_workspace_id: "root-1",
      icon: "", order_index: 0, last_message_at: null, survey_data: null,
    });

    useWorkspaceStore.setState({
      workspaces: [
        { id: "root-1", name: "Parent", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "child-1", name: "Alpha", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: "root-1", icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "child-1",
      activeParentWorkspaceId: "root-1",
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTitle("New Sub-workspace"));

    const input = await screen.findByPlaceholderText("Sub-workspace name");
    fireEvent.change(input, { target: { value: "Gamma" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createChildSpy).toHaveBeenCalledWith("root-1", "Gamma");
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("child-3");
    });
  });

  it("renders the global History button in the titlebar on standard routes", () => {
    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "Open History" })).toBeInTheDocument();
    expect(screen.getByTitle("History")).toBeInTheDocument();
  });

  it("keeps the global History button visible on preferences", () => {
    render(
      <MemoryRouter initialEntries={["/preferences"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "Open History" })).toBeInTheDocument();
    expect(screen.getByText("Preferences View")).toBeInTheDocument();
  });

  it("opens a history menu with recent sessions across all workspaces", async () => {
    vi.spyOn(api.chat, "getRecentSessions").mockImplementation(async (workspaceId) => {
      if (workspaceId === "ws-1") {
        return [
          {
            id: "chat-1",
            workspace_id: "ws-1",
            folder_id: "project-1",
            title: "Rust debugging notes",
            model_name: "llama3.2",
            system_prompt: "",
            is_pinned: false,
            is_incognito: false,
            exclude_from_analytics: false,
            is_deleted: false,
            created_at: "2026-04-11T10:00:00.000Z",
            updated_at: "2026-04-11T12:30:00.000Z",
          },
        ];
      }

      return [
        {
          id: "chat-2",
          workspace_id: "ws-2",
          folder_id: "project-2",
          title: "Security checklist",
          model_name: "qwen3",
          system_prompt: "",
          is_pinned: false,
          is_incognito: false,
          exclude_from_analytics: false,
          is_deleted: false,
          created_at: "2026-04-11T08:00:00.000Z",
          updated_at: "2026-04-11T13:30:00.000Z",
        },
      ];
    });
    useWorkspaceStore.setState({
      activeWorkspaceId: "ws-1",
      workspaces: [
        { id: "ws-1", name: "Rust", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-2", name: "Security", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    const historyButton = screen.getByRole("button", { name: "Open History" });
    fireEvent.click(historyButton);

    expect(await screen.findByRole("menu", { name: "History menu" })).toBeInTheDocument();
    expect(await screen.findByText("Rust debugging notes")).toBeInTheDocument();
    expect(await screen.findByText("Security checklist")).toBeInTheDocument();
    expect(screen.getByText("Recent chats across all workspaces")).toBeInTheDocument();
    expect(historyButton.className).toContain("border-[var(--accent-color)]");
  });

  it("shows the global History button as active on the history route", () => {
    render(
      <MemoryRouter initialEntries={["/history"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "Open History" }).className).toContain("border-[var(--accent-color)]");
  });

  it("navigates to the full history page from the history menu", async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "ws-1" });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Open History" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /show full history/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open History" }).className).toContain("border-[var(--accent-color)]");
    });
  });

  it("renders a workspace selector in single-pane top-dropdown mode", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-1-child", name: "Rust", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: "ws-1", icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1-child",
      activeParentWorkspaceId: "ws-1",
      workspaceNavigation: "top-dropdown",
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "Workspace: Agentic / Rust" })).toBeInTheDocument();
    expect(document.querySelector("[data-workspace-tab-strip]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Workspace: Agentic / Rust" }));
    // "Agentic" is now a group-header option — clicking it selects ws-1 which resolves to first child
    fireEvent.click(screen.getByRole("option", { name: "Agentic" }));

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-1-child");
  });

  it("renders a left workspace sidebar in single-pane sidebar mode", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-2", name: "Rust", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1",
      workspaceNavigation: "sidebar",
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByTestId("single-pane-workspace-sidebar")).toBeInTheDocument();
    expect(document.querySelector("[data-workspace-tab-strip]")).toBeNull();
  });

  it("renders a sub-workspace sidebar rail when subWorkspaceNavigation is sidebar", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-1-child", name: "Rust", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: "ws-1", icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1-child",
      activeParentWorkspaceId: "ws-1",
      subWorkspaceNavigation: "sidebar",
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByTestId("single-pane-subworkspace-sidebar")).toBeInTheDocument();
  });

  it("renders a sub-workspace dropdown when subWorkspaceNavigation is top-dropdown", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-1-child", name: "Rust", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: "ws-1", icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1-child",
      activeParentWorkspaceId: "ws-1",
      subWorkspaceNavigation: "top-dropdown",
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "Sub-workspace: Rust" })).toBeInTheDocument();
    expect(screen.queryByTestId("single-pane-subworkspace-sidebar")).toBeNull();
  });

  it("combines workspace and sub-workspace dropdowns onto the titlebar line and drops the standalone sub bar", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-1-child", name: "Rust", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: "ws-1", icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1-child",
      activeParentWorkspaceId: "ws-1",
      workspaceNavigation: "top-dropdown",
      subWorkspaceNavigation: "top-dropdown",
      combineWorkspaceDropdown: true,
      combineSubWorkspaceDropdown: true,
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    // Both selects live in the titlebar; the standalone sub-workspace bar is gone.
    const titlebar = document.querySelector("[data-workspace-titlebar-actions]")?.closest("div");
    expect(screen.getByRole("button", { name: "Workspace: Agentic / Rust" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sub-workspace: Rust" })).toBeInTheDocument();
    expect(titlebar).not.toBeNull();
  });

  it("keeps the section dropdown on its own bar when section combine is off while another axis is combined", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-1-child", name: "Rust", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: "ws-1", icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1-child",
      activeParentWorkspaceId: "ws-1",
      workspaceNavigation: "top-dropdown",
      subWorkspaceNavigation: "top-dropdown",
      sectionNavigation: "top-dropdown",
      combineSubWorkspaceDropdown: true,
      combineSectionDropdown: false,
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    // Section combine is off, so it stays on its own bar (one Section select).
    expect(screen.getByRole("button", { name: "Sub-workspace: Rust" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Section:/ })).toHaveLength(1);
  });

  it("renders split workspace navigation in the shared titlebar while keeping titlebar actions", () => {
    useWorkspaceStore.setState({
      workspaceNavigation: "top-tabs",
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-2", name: "Rust", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1",
      splitMode: true,
      panes: {
        primary: { workspaceId: "ws-1", folderId: null, view: "folder", chatSessionId: null, noteSelection: null },
        secondary: { workspaceId: "ws-2", folderId: null, view: "chat", chatSessionId: null, noteSelection: null },
      },
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(document.querySelector("[data-split-titlebar-workspace-nav]")).not.toBeNull();
    expect(document.querySelector("[data-workspace-titlebar-actions]")).not.toBeNull();
    expect(screen.getByRole("button", { name: /More workspaces for primary/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /More workspaces for secondary/i })).toBeInTheDocument();
    expect(screen.queryByText("Split View")).not.toBeInTheDocument();
  });

  it("uses the same workspace tab styling in split view as single-pane mode", () => {
    useWorkspaceStore.setState({
      workspaceNavigation: "top-tabs",
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-2", name: "Rust", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1",
      splitMode: true,
      panes: {
        primary: { workspaceId: "ws-1", folderId: null, view: "folder", chatSessionId: null, noteSelection: null },
        secondary: { workspaceId: "ws-2", folderId: null, view: "chat", chatSessionId: null, noteSelection: null },
      },
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    const splitAgenticTabs = screen.getAllByRole("button", { name: "Agentic" });
    const splitRustTabs = screen.getAllByRole("button", { name: "Rust" });

    expect(splitAgenticTabs.some((button) => button.className.includes("rounded-t-xl"))).toBe(true);
    expect(splitAgenticTabs.some((button) => button.className.includes("h-[34px]"))).toBe(true);
    expect(splitAgenticTabs.some((button) => button.className.includes("bg-[var(--bg-primary)]"))).toBe(true);
    expect(splitRustTabs.some((button) => button.className.includes("rounded-t-xl"))).toBe(true);
    expect(splitRustTabs.some((button) => button.className.includes("text-[var(--text-secondary)]"))).toBe(true);
  });

  it("keeps duplicated split workspace tab strips in the shared titlebar", () => {
    useWorkspaceStore.setState({
      workspaceNavigation: "top-tabs",
      workspaces: Array.from({ length: 8 }, (_, index) => ({
        id: `ws-${index + 1}`,
        name: `Workspace ${index + 1}`,
        description: "",
        prompt_instructions: "",
        topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false },
        signature_updated_at: null,
        is_hidden: false,
        created_at: "",
        updated_at: "",
        parent_workspace_id: null,
    icon: "", order_index: 0, last_message_at: null, survey_data: null
      })),
      activeWorkspaceId: "ws-1",
      splitMode: true,
      panes: {
        primary: { workspaceId: "ws-1", folderId: null, view: "folder", chatSessionId: null, noteSelection: null },
        secondary: { workspaceId: "ws-2", folderId: null, view: "chat", chatSessionId: null, noteSelection: null },
      },
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(document.querySelector("[data-split-titlebar-workspace-nav]")).not.toBeNull();
    expect(screen.getAllByText("Workspace 1").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /More workspaces for primary/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /More workspaces for secondary/i })).toBeInTheDocument();
  });

  it("can still render dropdown workspace navigation for both split panes", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Security", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-2", name: "Linux", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1",
      workspaceNavigation: "top-dropdown",
      splitMode: true,
      splitWorkspaceNavigation: "dropdown",
      panes: {
        primary: { workspaceId: "ws-1", folderId: null, view: "folder", chatSessionId: null, noteSelection: null },
        secondary: { workspaceId: "ws-2", folderId: null, view: "chat", chatSessionId: null, noteSelection: null },
      },
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "Workspace primary: Security" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspace secondary: Linux" })).toBeInTheDocument();
  });

  it("reserves trailing titlebar space in split mode and renders an icon-only split toggle", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Security", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-2", name: "Linux", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1",
      workspaceNavigation: "top-dropdown",
      splitMode: true,
      splitWorkspaceNavigation: "dropdown",
      panes: {
        primary: { workspaceId: "ws-1", folderId: null, view: "folder", chatSessionId: null, noteSelection: null },
        secondary: { workspaceId: "ws-2", folderId: null, view: "chat", chatSessionId: null, noteSelection: null },
      },
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    const splitNav = document.querySelector("[data-split-titlebar-workspace-nav]");
    const splitToggle = screen.getByRole("button", { name: "Toggle Split View" });
    const splitSecondaryPane = splitNav?.lastElementChild?.firstElementChild as HTMLElement | null;

    expect(splitNav).not.toBeNull();
    expect(splitSecondaryPane).not.toBeNull();
    expect(splitSecondaryPane?.className).toContain("pr-24");
    expect(screen.getByRole("button", { name: "Open History" })).toBeInTheDocument();
    expect(splitToggle).toHaveTextContent(/^$/);
  });

  it("hides the split toggle on single-pane routes like preferences", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-2", name: "Rust", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1",
    });

    render(
      <MemoryRouter initialEntries={["/preferences"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.queryByTitle("Toggle Split View")).not.toBeInTheDocument();
  });

  it("shows the split toggle on split-capable routes", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-2", name: "Rust", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1",
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByTitle("Toggle Split View")).toBeInTheDocument();
  });

  it("opens chats when switching workspaces if the preference is enabled", async () => {
    useSettingsStore.setState({ switchWorkspaceSection: "/chat" });
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
        { id: "ws-2", name: "Rust", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1",
    });

    render(
      <MemoryRouter initialEntries={["/sources"]}>
        <Layout />
      </MemoryRouter>
    );

    // /sources is now a compatibility redirect to the unified /notes browser.
    expect(await screen.findByText("Notes View")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Rust"));

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
    expect(await screen.findByText("Chat View")).toBeInTheDocument();
  });

  it("opens a custom context menu for workspace tabs", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { auto_detected_tags: [], custom_tags: [], excluded_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "", parent_workspace_id: null, icon: "", order_index: 0, last_message_at: null, survey_data: null },
      ],
      activeWorkspaceId: "ws-1",
      workspaceNavigation: "top-tabs",
    });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
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
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    fireEvent.contextMenu(screen.getByText("Dashboard"));

    expect(screen.getByText("Open section")).toBeInTheDocument();
    expect(screen.getByText("Customize navigation")).toBeInTheDocument();
  });

  it("does not show Preferences as a top-tab section item", () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-tabs" });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getAllByRole("button", { name: "Preferences" })).toHaveLength(1);
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

    expect(container.querySelector("div.flex.h-full.overflow-hidden.min-h-0")).not.toBeNull();
  });

  it("renders a styled top dropdown for section navigation and navigates from it", async () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-dropdown" });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    const trigger = screen.getByRole("button", { name: "Section: Dashboard" });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Notes & Sources" }));

    expect(await screen.findByText("Notes View")).toBeInTheDocument();
  });

  it("does not show Preferences in the top-dropdown section options", () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-dropdown" });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Section: Dashboard" }));

    expect(screen.queryByRole("option", { name: "Preferences" })).not.toBeInTheDocument();
  });

  it("opens Preferences from the bottom-left button in top-tab section navigation", async () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-tabs" });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTitle("Preferences"));

    expect(await screen.findByText("Preferences View")).toBeInTheDocument();
  });

  it("opens Preferences from the bottom-left button in top-dropdown section navigation", async () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-dropdown" });

    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTitle("Preferences"));

    expect(await screen.findByText("Preferences View")).toBeInTheDocument();
  });

});
