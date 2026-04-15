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
vi.mock("@/views/HistoryView", () => ({ default: () => <div>History View</div> }));
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
    vi.spyOn(api.chat, "getRecentSessions").mockResolvedValue([]);
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

  it("keeps the drag handle compact when single-pane workspace tabs are visible", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Security", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
        { id: "ws-2", name: "Linux", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
      ],
      activeWorkspaceId: "ws-1",
      splitMode: false,
      workspaceNavigation: "top-tabs",
    });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    const dragHandle = document.querySelector("[data-window-drag-handle]");

    expect(dragHandle).not.toBeNull();
    expect(dragHandle).toHaveClass("w-16");
    expect(dragHandle).not.toHaveClass("flex-1");
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

  it("does not render the left sidebar when top-tab section navigation is active", () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-tabs" });

    render(
      <MemoryRouter initialEntries={["/project"]}>
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
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByTitle("Preferences")).toBeInTheDocument();
  });

  it("renders a bottom-left Preferences button in top-tab section navigation", () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-tabs" });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByTitle("Preferences")).toBeInTheDocument();
  });

  it("renders a bottom-left Preferences button in top-dropdown section navigation", () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-dropdown" });

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

  it("renders the global History button in the titlebar on standard routes", () => {
    render(
      <MemoryRouter initialEntries={["/project"]}>
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
            project_id: "project-1",
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
          project_id: "project-2",
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
        { id: "ws-1", name: "Rust", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
        { id: "ws-2", name: "Security", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/project"]}>
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
      <MemoryRouter initialEntries={["/project"]}>
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
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
        { id: "ws-2", name: "Rust", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
      ],
      activeWorkspaceId: "ws-1",
      workspaceNavigation: "top-dropdown",
    });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "Workspace: Agentic" })).toBeInTheDocument();
    expect(document.querySelector("[data-workspace-tab-strip]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Workspace: Agentic" }));
    fireEvent.click(screen.getByRole("option", { name: "Rust" }));

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
  });

  it("renders split workspace navigation in the shared titlebar while keeping titlebar actions", () => {
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

    expect(document.querySelector("[data-split-titlebar-workspace-nav]")).not.toBeNull();
    expect(document.querySelector("[data-workspace-titlebar-actions]")).not.toBeNull();
    expect(screen.getByRole("button", { name: /More workspaces for primary/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /More workspaces for secondary/i })).toBeInTheDocument();
    expect(screen.queryByText("Split View")).not.toBeInTheDocument();
  });

  it("uses the same workspace tab styling in split view as single-pane mode", () => {
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
      workspaces: Array.from({ length: 8 }, (_, index) => ({
        id: `ws-${index + 1}`,
        name: `Workspace ${index + 1}`,
        description: "",
        prompt_instructions: "",
        topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false },
        signature_updated_at: null,
        is_hidden: false,
        created_at: "",
        updated_at: "",
      })),
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

    expect(document.querySelector("[data-split-titlebar-workspace-nav]")).not.toBeNull();
    expect(screen.getAllByText("Workspace 1").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /More workspaces for primary/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /More workspaces for secondary/i })).toBeInTheDocument();
  });

  it("can still render dropdown workspace navigation for both split panes", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Security", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
        { id: "ws-2", name: "Linux", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
      ],
      activeWorkspaceId: "ws-1",
      workspaceNavigation: "top-dropdown",
      splitMode: true,
      splitWorkspaceNavigation: "dropdown",
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

    expect(screen.getByRole("button", { name: "Workspace primary: Security" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspace secondary: Linux" })).toBeInTheDocument();
  });

  it("reserves trailing titlebar space in split mode and renders an icon-only split toggle", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Security", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
        { id: "ws-2", name: "Linux", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
      ],
      activeWorkspaceId: "ws-1",
      workspaceNavigation: "top-dropdown",
      splitMode: true,
      splitWorkspaceNavigation: "dropdown",
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
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
        { id: "ws-2", name: "Rust", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, is_hidden: false, created_at: "", updated_at: "" },
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

    expect(screen.getByTitle("Toggle Split View")).toBeInTheDocument();
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

  it("does not show Preferences as a top-tab section item", () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-tabs" });

    render(
      <MemoryRouter initialEntries={["/project"]}>
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

  it("does not show Preferences in the top-dropdown section options", () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-dropdown" });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Section: Dashboard" }));

    expect(screen.queryByRole("option", { name: "Preferences" })).not.toBeInTheDocument();
  });

  it("opens Preferences from the bottom-left button in top-tab section navigation", async () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-tabs" });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTitle("Preferences"));

    expect(await screen.findByText("Preferences View")).toBeInTheDocument();
  });

  it("opens Preferences from the bottom-left button in top-dropdown section navigation", async () => {
    useWorkspaceStore.setState({ sectionNavigation: "top-dropdown" });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTitle("Preferences"));

    expect(await screen.findByText("Preferences View")).toBeInTheDocument();
  });

});
