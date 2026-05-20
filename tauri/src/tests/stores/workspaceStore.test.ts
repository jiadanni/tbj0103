import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { Workspace, Folder } from "@/stores/workspaceStore";
import { useChatStore } from "@/stores/chatStore";

const INITIAL = {
  workspaces: [],
  activeWorkspaceId: null,
  activeParentWorkspaceId: null,
  activeFolderId: null,
  folders: [],
  isDemoMode: false,
  workspaceNavigation: "sidebar" as const,
  sectionNavigation: "sidebar" as const,
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
    parent_workspace_id: null,
    icon: "",
    order_index: 0, last_message_at: null, survey_data: null,
    ...overrides,
  };
}

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: "p1",
    workspace_id: "ws1",
    name: "Folder 1",
    folder_description: "",
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
      activeFolderId: "project-1",
      panes: {
        primary: { workspaceId: "ws-deleted", folderId: "project-1", view: "chat", chatSessionId: "chat-1", noteSelection: null },
        secondary: { workspaceId: "ws-keep", folderId: "project-2", view: "folder", chatSessionId: "chat-2", noteSelection: null },
      },
      foldersByWorkspace: {
        "ws-deleted": [makeFolder({ id: "project-1", workspace_id: "ws-deleted" })],
        "ws-keep": [makeFolder({ id: "project-2", workspace_id: "ws-keep" })],
      },
    });
    useChatStore.setState({ activeChatId: "chat-1" });

    useWorkspaceStore.getState().setWorkspaces([
      makeWorkspace({ id: "ws-keep", name: "Keep" }),
      makeWorkspace({ id: "ws-other", name: "Other" }),
    ]);

    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe("ws-keep");
    expect(state.activeFolderId).toBeNull();
    expect(state.panes.primary.workspaceId).toBe("ws-keep");
    expect(state.panes.primary.folderId).toBeNull();
    expect(state.panes.primary.chatSessionId).toBeNull();
    expect(state.panes.secondary.workspaceId).toBe("ws-keep");
    expect(state.panes.secondary.folderId).toBe("project-2");
    expect(state.foldersByWorkspace).toEqual({
      "ws-keep": [makeFolder({ id: "project-2", workspace_id: "ws-keep" })],
    });
    expect(useChatStore.getState().activeChatId).toBeNull();
  });

  it("reassigns an invalid secondary pane to another available workspace", () => {
    useWorkspaceStore.setState({
      activeWorkspaceId: "ws-1",
      panes: {
        primary: { workspaceId: "ws-1", folderId: "project-1", view: "chat", chatSessionId: "chat-1", noteSelection: null },
        secondary: { workspaceId: "ws-deleted", folderId: "project-2", view: "folder", chatSessionId: "chat-2", noteSelection: null },
      },
    });

    useWorkspaceStore.getState().setWorkspaces([
      makeWorkspace({ id: "ws-1", name: "One" }),
      makeWorkspace({ id: "ws-2", name: "Two" }),
    ]);

    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe("ws-1");
    expect(state.panes.primary.workspaceId).toBe("ws-1");
    expect(state.panes.primary.folderId).toBe("project-1");
    expect(state.panes.secondary.workspaceId).toBe("ws-2");
    expect(state.panes.secondary.folderId).toBeNull();
    expect(state.panes.secondary.chatSessionId).toBeNull();
  });
});

// ─── removeFolder ─────────────────────────────────────────────────────────

describe("removeFolder", () => {
  it("filters out the matching folder", () => {
    useWorkspaceStore.setState({ folders: [makeFolder({ id: "p1" }), makeFolder({ id: "p2" })] });
    useWorkspaceStore.getState().removeFolder("p1");
    expect(useWorkspaceStore.getState().folders).toHaveLength(1);
    expect(useWorkspaceStore.getState().folders[0].id).toBe("p2");
  });

  it("is a no-op on a missing id", () => {
    useWorkspaceStore.setState({ folders: [makeFolder({ id: "p1" })] });
    useWorkspaceStore.getState().removeFolder("nonexistent");
    expect(useWorkspaceStore.getState().folders).toHaveLength(1);
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

describe("workspace/folder selection", () => {
  it("setActiveWorkspaceId resolves a root workspace to its first child and tracks the active parent", () => {
    useWorkspaceStore.setState({
      workspaces: [
        makeWorkspace({ id: "root-1", name: "Root" }),
        makeWorkspace({ id: "child-1", name: "Child", parent_workspace_id: "root-1" }),
      ],
      panes: {
        primary: { workspaceId: null, folderId: null, view: "folder", chatSessionId: null, noteSelection: null },
        secondary: { workspaceId: null, folderId: null, view: "folder", chatSessionId: null, noteSelection: null },
      },
    });

    useWorkspaceStore.getState().setActiveWorkspaceId("root-1");

    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe("child-1");
    expect(state.activeParentWorkspaceId).toBe("root-1");
    expect(state.panes.primary.workspaceId).toBe("child-1");
  });

  it("setActiveWorkspaceId clears activeFolderId and activeChatId when the workspace changes", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "ws-1", activeFolderId: "p1" });
    useChatStore.setState({ activeChatId: "chat-1" });

    useWorkspaceStore.getState().setActiveWorkspaceId("ws-2");

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
    expect(useWorkspaceStore.getState().activeFolderId).toBeNull();
    expect(useChatStore.getState().activeChatId).toBeNull();
  });

  it("setActiveWorkspaceId preserves activeFolderId and activeChatId when re-selecting the same workspace", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "ws-1", activeFolderId: "p1" });
    useChatStore.setState({ activeChatId: "chat-1" });

    useWorkspaceStore.getState().setActiveWorkspaceId("ws-1");

    expect(useWorkspaceStore.getState().activeFolderId).toBe("p1");
    expect(useChatStore.getState().activeChatId).toBe("chat-1");
  });

  it("setActiveWorkspaceId clears the primary pane selection when the workspace changes", () => {
    useWorkspaceStore.setState({
      activeWorkspaceId: "ws-1",
      activeFolderId: "p1",
      panes: {
        primary: { workspaceId: "ws-1", folderId: "p1", view: "chat", chatSessionId: "chat-1", noteSelection: null },
        secondary: { workspaceId: "ws-2", folderId: null, view: "folder", chatSessionId: "chat-2", noteSelection: null },
      },
    });

    useWorkspaceStore.getState().setActiveWorkspaceId("ws-2");

    const state = useWorkspaceStore.getState();
    expect(state.panes.primary.workspaceId).toBe("ws-2");
    expect(state.panes.primary.folderId).toBeNull();
    expect(state.panes.primary.chatSessionId).toBeNull();
    expect(state.panes.secondary.chatSessionId).toBe("chat-2");
  });

  it("setActiveFolderId does not affect activeWorkspaceId", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "ws-1" });
    useWorkspaceStore.getState().setActiveFolderId("p-2");
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-1");
    expect(useWorkspaceStore.getState().activeFolderId).toBe("p-2");
  });

  it("setFolders clears a stale active folder and matching pane selection", () => {
    useWorkspaceStore.setState({
      activeWorkspaceId: "ws-1",
      activeFolderId: "p-stale",
      panes: {
        primary: { workspaceId: "ws-1", folderId: "p-stale", view: "chat", chatSessionId: "chat-1", noteSelection: null },
        secondary: { workspaceId: "ws-2", folderId: "p-keep", view: "folder", chatSessionId: null, noteSelection: null },
      },
    });

    useWorkspaceStore.getState().setFolders([
      makeFolder({ id: "p-fresh", workspace_id: "ws-1" }),
    ]);

    const state = useWorkspaceStore.getState();
    expect(state.activeFolderId).toBeNull();
    expect(state.panes.primary.folderId).toBeNull();
    expect(state.panes.secondary.folderId).toBe("p-keep");
  });

  it("setFoldersForWorkspace clears stale pane folder filters for that workspace", () => {
    useWorkspaceStore.setState({
      activeWorkspaceId: "ws-1",
      activeFolderId: "p-stale",
      panes: {
        primary: { workspaceId: "ws-1", folderId: "p-stale", view: "chat", chatSessionId: "chat-1", noteSelection: null },
        secondary: { workspaceId: "ws-1", folderId: "p-stale-2", view: "folder", chatSessionId: null, noteSelection: null },
      },
    });

    useWorkspaceStore.getState().setFoldersForWorkspace("ws-1", [
      makeFolder({ id: "p-valid", workspace_id: "ws-1" }),
    ]);

    const state = useWorkspaceStore.getState();
    expect(state.activeFolderId).toBeNull();
    expect(state.panes.primary.folderId).toBeNull();
    expect(state.panes.secondary.folderId).toBeNull();
  });

  it("setWorkspaces preserves the active parent and falls back to a sibling child when the active child disappears", () => {
    useWorkspaceStore.setState({
      activeWorkspaceId: "child-a",
      activeParentWorkspaceId: "root-1",
      panes: {
        primary: { workspaceId: "child-a", folderId: null, view: "chat", chatSessionId: "chat-1", noteSelection: null },
        secondary: { workspaceId: "ws-2", folderId: null, view: "folder", chatSessionId: null, noteSelection: null },
      },
    });

    useWorkspaceStore.getState().setWorkspaces([
      makeWorkspace({ id: "root-1", name: "Root" }),
      makeWorkspace({ id: "child-b", name: "Child B", parent_workspace_id: "root-1" }),
      makeWorkspace({ id: "ws-2", name: "Other" }),
    ]);

    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe("child-b");
    expect(state.activeParentWorkspaceId).toBe("root-1");
    expect(state.panes.primary.workspaceId).toBe("child-b");
    expect(state.panes.primary.chatSessionId).toBeNull();
  });
});

describe("split layout", () => {
  it("enterSplitMode seeds the primary pane from active state and picks a second workspace", () => {
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace({ id: "ws-1" }), makeWorkspace({ id: "ws-2" })],
      activeWorkspaceId: "ws-1",
      activeFolderId: "p-1",
    });

    useWorkspaceStore.getState().enterSplitMode();

    const state = useWorkspaceStore.getState();
    expect(state.splitMode).toBe(true);
    expect(state.panes.primary.workspaceId).toBe("ws-1");
    expect(state.panes.primary.folderId).toBe("p-1");
    expect(state.panes.secondary.workspaceId).toBe("ws-2");
  });

  it("pane state updates independently", () => {
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace({ id: "ws-1" }), makeWorkspace({ id: "ws-2" })],
      panes: {
        primary: { workspaceId: "ws-1", folderId: null, view: "folder", chatSessionId: null, noteSelection: null },
        secondary: { workspaceId: "ws-2", folderId: null, view: "folder", chatSessionId: null, noteSelection: null },
      },
    });

    useWorkspaceStore.getState().setPaneView("secondary", "chat");
    useWorkspaceStore.getState().setPaneChatSession("secondary", "chat-2");

    const state = useWorkspaceStore.getState();
    expect(state.panes.primary.view).toBe("folder");
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
      activeFolderId: "p-old",
      panes: {
        primary: { workspaceId: "ws-new", folderId: "p-new", view: "notes", chatSessionId: null, noteSelection: null },
        secondary: { workspaceId: "ws-2", folderId: null, view: "folder", chatSessionId: null, noteSelection: null },
      },
    });

    useWorkspaceStore.getState().exitSplitMode();

    const state = useWorkspaceStore.getState();
    expect(state.splitMode).toBe(false);
    expect(state.activeWorkspaceId).toBe("ws-new");
    expect(state.activeFolderId).toBe("p-new");
  });

  it("exitSplitMode restores the primary pane chat selection to single-pane chat state", () => {
    useWorkspaceStore.setState({
      splitMode: true,
      panes: {
        primary: { workspaceId: "ws-1", folderId: "p-1", view: "chat", chatSessionId: "chat-primary", noteSelection: null },
        secondary: { workspaceId: "ws-2", folderId: null, view: "folder", chatSessionId: "chat-secondary", noteSelection: null },
      },
    });
    useChatStore.setState({ activeChatId: "chat-old" });

    useWorkspaceStore.getState().exitSplitMode();

    expect(useChatStore.getState().activeChatId).toBe("chat-primary");
  });
});
