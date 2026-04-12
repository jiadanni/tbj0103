import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { Workspace, Project } from "@/stores/workspaceStore";
import { useChatStore } from "@/stores/chatStore";

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

beforeEach(() => {
  // Merge mode preserves action functions on the store.
  useWorkspaceStore.setState(INITIAL);
  useChatStore.setState({
    activeChatId: null,
    sessions: [],
    messages: {},
    streamingSessionId: null,
    streamingContent: "",
    refiningSessionId: null,
    refineContent: "",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws1",
    name: "Workspace 1",
    description: "",
    prompt_instructions: "",
    topic_signature: {
      domain_tags: [],
      manual_tags: [],
      ignored_tags: [],
      intent_patterns: [],
      generated_at: null,
      message_count_at_gen: null,
      ollama_enriched: false,
    },
    signature_updated_at: null,
    is_hidden: false,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    workspace_id: "ws1",
    name: "Project 1",
    project_description: "",
    custom_instructions: "",
    color: "#000",
    icon: "📁",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── navigation initialisation ────────────────────────────────────────────

describe("navigation settings", () => {
  it("defaults to top-tabs/top-tabs when localStorage is empty", async () => {
    localStorage.clear();
    vi.resetModules();
    const { useWorkspaceStore: freshStore } = await import("@/stores/workspaceStore");
    expect(freshStore.getState().workspaceNavigation).toBe("top-tabs");
    expect(freshStore.getState().sectionNavigation).toBe("top-tabs");
  });

  it("reads independent navigation settings from localStorage on module init", async () => {
    localStorage.setItem("workspaceNavigation", "top-dropdown");
    localStorage.setItem("sectionNavigation", "top-tabs");
    vi.resetModules();
    const { useWorkspaceStore: freshStore } = await import("@/stores/workspaceStore");
    expect(freshStore.getState().workspaceNavigation).toBe("top-dropdown");
    expect(freshStore.getState().sectionNavigation).toBe("top-tabs");
  });

  it("migrates legacy values from localStorage on module init", async () => {
    localStorage.setItem("navLayout", "top-dropdown");
    vi.resetModules();
    const { useWorkspaceStore: freshStore } = await import("@/stores/workspaceStore");
    expect(freshStore.getState().workspaceNavigation).toBe("top-dropdown");
    expect(freshStore.getState().sectionNavigation).toBe("top-dropdown");
  });

  it("falls back to the workspace navigation when no explicit section setting exists", async () => {
    localStorage.setItem("workspaceNavigation", "icon-bar");
    vi.resetModules();
    const { useWorkspaceStore: freshStore } = await import("@/stores/workspaceStore");
    expect(freshStore.getState().workspaceNavigation).toBe("sidebar");
    expect(freshStore.getState().sectionNavigation).toBe("sidebar");
  });
});

// ─── navigation setters ───────────────────────────────────────────────────

describe("navigation setters", () => {
  it("updates workspace navigation independently", () => {
    useWorkspaceStore.getState().setWorkspaceNavigation("top-tabs");
    const state = useWorkspaceStore.getState();
    expect(state.workspaceNavigation).toBe("top-tabs");
    expect(state.sectionNavigation).toBe("sidebar");
  });

  it("updates section navigation and writes to localStorage", () => {
    const spy = vi.spyOn(localStorage, "setItem");
    useWorkspaceStore.getState().setSectionNavigation("top-dropdown");
    expect(useWorkspaceStore.getState().sectionNavigation).toBe("top-dropdown");
    expect(spy).toHaveBeenCalledWith("sectionNavigation", "top-dropdown");
  });
});

// ─── addWorkspace ──────────────────────────────────────────────────────────

describe("addWorkspace", () => {
  it("inserts a new workspace in alphabetical order", () => {
    useWorkspaceStore.setState({
      workspaces: [
        makeWorkspace({ id: "ws-z", name: "Zulu" }),
        makeWorkspace({ id: "ws-c", name: "Charlie" }),
      ],
    });

    const ws = makeWorkspace({ id: "ws-a", name: "Alpha" });
    useWorkspaceStore.getState().addWorkspace(ws);

    expect(useWorkspaceStore.getState().workspaces.map((workspace) => workspace.name)).toEqual([
      "Alpha",
      "Charlie",
      "Zulu",
    ]);
  });
});

describe("setWorkspaces", () => {
  it("sorts workspaces alphabetically before storing them", () => {
    useWorkspaceStore.getState().setWorkspaces([
      makeWorkspace({ id: "ws-z", name: "Zulu" }),
      makeWorkspace({ id: "ws-a", name: "Alpha" }),
      makeWorkspace({ id: "ws-c", name: "charlie" }),
    ]);

    expect(useWorkspaceStore.getState().workspaces.map((workspace) => workspace.name)).toEqual([
      "Alpha",
      "charlie",
      "Zulu",
    ]);
  });

  it("falls back from a deleted active workspace and clears the global selection", () => {
    useWorkspaceStore.setState({
      activeWorkspaceId: "ws-deleted",
      activeProjectId: "project-1",
      panes: {
        primary: { workspaceId: "ws-deleted", projectId: "project-1", view: "chat", chatSessionId: "chat-1", noteSelection: null },
        secondary: { workspaceId: "ws-keep", projectId: "project-2", view: "project", chatSessionId: "chat-2", noteSelection: null },
      },
      projectsByWorkspace: {
        "ws-deleted": [makeProject({ id: "project-1", workspace_id: "ws-deleted" })],
        "ws-keep": [makeProject({ id: "project-2", workspace_id: "ws-keep" })],
      },
    });
    useChatStore.setState({ activeChatId: "chat-1" });

    useWorkspaceStore.getState().setWorkspaces([
      makeWorkspace({ id: "ws-keep", name: "Keep" }),
      makeWorkspace({ id: "ws-other", name: "Other" }),
    ]);

    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe("ws-keep");
    expect(state.activeProjectId).toBeNull();
    expect(state.panes.primary.workspaceId).toBe("ws-keep");
    expect(state.panes.primary.projectId).toBeNull();
    expect(state.panes.primary.chatSessionId).toBeNull();
    expect(state.panes.secondary.workspaceId).toBe("ws-keep");
    expect(state.panes.secondary.projectId).toBe("project-2");
    expect(state.projectsByWorkspace).toEqual({
      "ws-keep": [makeProject({ id: "project-2", workspace_id: "ws-keep" })],
    });
    expect(useChatStore.getState().activeChatId).toBeNull();
  });

  it("reassigns an invalid secondary pane to another available workspace", () => {
    useWorkspaceStore.setState({
      activeWorkspaceId: "ws-1",
      panes: {
        primary: { workspaceId: "ws-1", projectId: "project-1", view: "chat", chatSessionId: "chat-1", noteSelection: null },
        secondary: { workspaceId: "ws-deleted", projectId: "project-2", view: "project", chatSessionId: "chat-2", noteSelection: null },
      },
    });

    useWorkspaceStore.getState().setWorkspaces([
      makeWorkspace({ id: "ws-1", name: "One" }),
      makeWorkspace({ id: "ws-2", name: "Two" }),
    ]);

    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe("ws-1");
    expect(state.panes.primary.workspaceId).toBe("ws-1");
    expect(state.panes.primary.projectId).toBe("project-1");
    expect(state.panes.secondary.workspaceId).toBe("ws-2");
    expect(state.panes.secondary.projectId).toBeNull();
    expect(state.panes.secondary.chatSessionId).toBeNull();
  });
});

// ─── removeProject ─────────────────────────────────────────────────────────

describe("removeProject", () => {
  it("filters out the matching project", () => {
    useWorkspaceStore.setState({ projects: [makeProject({ id: "p1" }), makeProject({ id: "p2" })] });
    useWorkspaceStore.getState().removeProject("p1");
    expect(useWorkspaceStore.getState().projects).toHaveLength(1);
    expect(useWorkspaceStore.getState().projects[0].id).toBe("p2");
  });

  it("is a no-op on a missing id", () => {
    useWorkspaceStore.setState({ projects: [makeProject({ id: "p1" })] });
    useWorkspaceStore.getState().removeProject("nonexistent");
    expect(useWorkspaceStore.getState().projects).toHaveLength(1);
  });
});

// ─── setDemo ───────────────────────────────────────────────────────────────

describe("setDemo", () => {
  it("setDemo(true, 'ws-1') sets isDemoMode and activeWorkspaceId", () => {
    useWorkspaceStore.getState().setDemo(true, "ws-1");
    expect(useWorkspaceStore.getState().isDemoMode).toBe(true);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-1");
  });

  it("setDemo(false) sets isDemoMode false and activeWorkspaceId to null", () => {
    useWorkspaceStore.setState({ isDemoMode: true, activeWorkspaceId: "ws-1" });
    useWorkspaceStore.getState().setDemo(false);
    expect(useWorkspaceStore.getState().isDemoMode).toBe(false);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
  });
});

// ─── dismissMigrationSuggestion ────────────────────────────────────────────

describe("dismissMigrationSuggestion", () => {
  it("sets migrationSuggestion to null", () => {
    useWorkspaceStore.setState({
      migrationSuggestion: { current_score: 0.5, is_match: false, suggestion: null },
    });
    useWorkspaceStore.getState().dismissMigrationSuggestion();
    expect(useWorkspaceStore.getState().migrationSuggestion).toBeNull();
  });
});

// ─── independent setters ───────────────────────────────────────────────────

describe("workspace/project selection", () => {
  it("setActiveWorkspaceId clears activeProjectId and activeChatId when the workspace changes", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "ws-1", activeProjectId: "p1" });
    useChatStore.setState({ activeChatId: "chat-1" });

    useWorkspaceStore.getState().setActiveWorkspaceId("ws-2");

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
    expect(useWorkspaceStore.getState().activeProjectId).toBeNull();
    expect(useChatStore.getState().activeChatId).toBeNull();
  });

  it("setActiveWorkspaceId preserves activeProjectId and activeChatId when re-selecting the same workspace", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "ws-1", activeProjectId: "p1" });
    useChatStore.setState({ activeChatId: "chat-1" });

    useWorkspaceStore.getState().setActiveWorkspaceId("ws-1");

    expect(useWorkspaceStore.getState().activeProjectId).toBe("p1");
    expect(useChatStore.getState().activeChatId).toBe("chat-1");
  });

  it("setActiveWorkspaceId clears the primary pane selection when the workspace changes", () => {
    useWorkspaceStore.setState({
      activeWorkspaceId: "ws-1",
      activeProjectId: "p1",
      panes: {
        primary: { workspaceId: "ws-1", projectId: "p1", view: "chat", chatSessionId: "chat-1", noteSelection: null },
        secondary: { workspaceId: "ws-2", projectId: null, view: "project", chatSessionId: "chat-2", noteSelection: null },
      },
    });

    useWorkspaceStore.getState().setActiveWorkspaceId("ws-2");

    const state = useWorkspaceStore.getState();
    expect(state.panes.primary.workspaceId).toBe("ws-2");
    expect(state.panes.primary.projectId).toBeNull();
    expect(state.panes.primary.chatSessionId).toBeNull();
    expect(state.panes.secondary.chatSessionId).toBe("chat-2");
  });

  it("setActiveProjectId does not affect activeWorkspaceId", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "ws-1" });
    useWorkspaceStore.getState().setActiveProjectId("p-2");
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-1");
    expect(useWorkspaceStore.getState().activeProjectId).toBe("p-2");
  });

  it("setProjects clears a stale active project and matching pane selection", () => {
    useWorkspaceStore.setState({
      activeWorkspaceId: "ws-1",
      activeProjectId: "p-stale",
      panes: {
        primary: { workspaceId: "ws-1", projectId: "p-stale", view: "chat", chatSessionId: "chat-1", noteSelection: null },
        secondary: { workspaceId: "ws-2", projectId: "p-keep", view: "project", chatSessionId: null, noteSelection: null },
      },
    });

    useWorkspaceStore.getState().setProjects([
      makeProject({ id: "p-fresh", workspace_id: "ws-1" }),
    ]);

    const state = useWorkspaceStore.getState();
    expect(state.activeProjectId).toBeNull();
    expect(state.panes.primary.projectId).toBeNull();
    expect(state.panes.secondary.projectId).toBe("p-keep");
  });

  it("setProjectsForWorkspace clears stale pane project filters for that workspace", () => {
    useWorkspaceStore.setState({
      activeWorkspaceId: "ws-1",
      activeProjectId: "p-stale",
      panes: {
        primary: { workspaceId: "ws-1", projectId: "p-stale", view: "chat", chatSessionId: "chat-1", noteSelection: null },
        secondary: { workspaceId: "ws-1", projectId: "p-stale-2", view: "project", chatSessionId: null, noteSelection: null },
      },
    });

    useWorkspaceStore.getState().setProjectsForWorkspace("ws-1", [
      makeProject({ id: "p-valid", workspace_id: "ws-1" }),
    ]);

    const state = useWorkspaceStore.getState();
    expect(state.activeProjectId).toBeNull();
    expect(state.panes.primary.projectId).toBeNull();
    expect(state.panes.secondary.projectId).toBeNull();
  });
});

describe("split layout", () => {
  it("enterSplitMode seeds the primary pane from active state and picks a second workspace", () => {
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace({ id: "ws-1" }), makeWorkspace({ id: "ws-2" })],
      activeWorkspaceId: "ws-1",
      activeProjectId: "p-1",
    });

    useWorkspaceStore.getState().enterSplitMode();

    const state = useWorkspaceStore.getState();
    expect(state.splitMode).toBe(true);
    expect(state.panes.primary.workspaceId).toBe("ws-1");
    expect(state.panes.primary.projectId).toBe("p-1");
    expect(state.panes.secondary.workspaceId).toBe("ws-2");
  });

  it("pane state updates independently", () => {
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace({ id: "ws-1" }), makeWorkspace({ id: "ws-2" })],
      panes: {
        primary: { workspaceId: "ws-1", projectId: null, view: "project", chatSessionId: null, noteSelection: null },
        secondary: { workspaceId: "ws-2", projectId: null, view: "project", chatSessionId: null, noteSelection: null },
      },
    });

    useWorkspaceStore.getState().setPaneView("secondary", "chat");
    useWorkspaceStore.getState().setPaneChatSession("secondary", "chat-2");

    const state = useWorkspaceStore.getState();
    expect(state.panes.primary.view).toBe("project");
    expect(state.panes.secondary.view).toBe("chat");
    expect(state.panes.secondary.chatSessionId).toBe("chat-2");
  });

  it("persists split sizes and mode", () => {
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace({ id: "ws-1" }), makeWorkspace({ id: "ws-2" })],
      activeWorkspaceId: "ws-1",
    });
    useWorkspaceStore.getState().setSplitSizes([40, 60]);
    useWorkspaceStore.getState().enterSplitMode();

    const raw = localStorage.getItem("workspaceSplitLayout");
    expect(raw).not.toBeNull();
    expect(raw).toContain("\"splitMode\":true");
    expect(raw).toContain("\"splitSizes\":[40,60]");
  });

  it("exitSplitMode restores primary pane state to single-pane state", () => {
    useWorkspaceStore.setState({
      splitMode: true,
      activeWorkspaceId: "ws-old",
      activeProjectId: "p-old",
      panes: {
        primary: { workspaceId: "ws-new", projectId: "p-new", view: "notes", chatSessionId: null, noteSelection: null },
        secondary: { workspaceId: "ws-2", projectId: null, view: "project", chatSessionId: null, noteSelection: null },
      },
    });

    useWorkspaceStore.getState().exitSplitMode();

    const state = useWorkspaceStore.getState();
    expect(state.splitMode).toBe(false);
    expect(state.activeWorkspaceId).toBe("ws-new");
    expect(state.activeProjectId).toBe("p-new");
  });

  it("exitSplitMode restores the primary pane chat selection to single-pane chat state", () => {
    useWorkspaceStore.setState({
      splitMode: true,
      panes: {
        primary: { workspaceId: "ws-1", projectId: "p-1", view: "chat", chatSessionId: "chat-primary", noteSelection: null },
        secondary: { workspaceId: "ws-2", projectId: null, view: "project", chatSessionId: "chat-secondary", noteSelection: null },
      },
    });
    useChatStore.setState({ activeChatId: "chat-old" });

    useWorkspaceStore.getState().exitSplitMode();

    expect(useChatStore.getState().activeChatId).toBe("chat-primary");
  });
});
