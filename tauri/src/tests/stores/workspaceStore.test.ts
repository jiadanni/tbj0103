import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { Workspace, Project } from "@/stores/workspaceStore";

const INITIAL = {
  workspaces: [],
  activeWorkspaceId: null,
  activeProjectId: null,
  projects: [],
  isDemoMode: false,
  navLayout: "sidebar" as const,
  activeTopicSignature: null,
  migrationSuggestion: null,
};

beforeEach(() => {
  // Merge mode preserves action functions on the store.
  useWorkspaceStore.setState(INITIAL);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws1",
    name: "Workspace 1",
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

// ─── navLayout initialisation ─────────────────────────────────────────────

describe("navLayout", () => {
  it("defaults to 'sidebar' when localStorage is empty", () => {
    expect(useWorkspaceStore.getState().navLayout).toBe("sidebar");
  });

  it("reads navLayout from localStorage on module init", async () => {
    localStorage.setItem("navLayout", "tabs");
    vi.resetModules();
    const { useWorkspaceStore: freshStore } = await import("@/stores/workspaceStore");
    expect(freshStore.getState().navLayout).toBe("tabs");
  });
});

// ─── setNavLayout ─────────────────────────────────────────────────────────

describe("setNavLayout", () => {
  it("updates state to 'tabs'", () => {
    useWorkspaceStore.getState().setNavLayout("tabs");
    expect(useWorkspaceStore.getState().navLayout).toBe("tabs");
  });

  it("writes to localStorage", () => {
    const spy = vi.spyOn(localStorage, "setItem");
    useWorkspaceStore.getState().setNavLayout("tabs");
    expect(spy).toHaveBeenCalledWith("navLayout", "tabs");
  });
});

// ─── addWorkspace ──────────────────────────────────────────────────────────

describe("addWorkspace", () => {
  it("prepends a new workspace to the list", () => {
    const ws = makeWorkspace({ id: "ws-new" });
    useWorkspaceStore.getState().addWorkspace(ws);
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    expect(useWorkspaceStore.getState().workspaces[0].id).toBe("ws-new");
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

describe("setActiveWorkspaceId and setActiveProjectId are independent", () => {
  it("setActiveWorkspaceId does not affect activeProjectId", () => {
    useWorkspaceStore.setState({ activeProjectId: "p1" });
    useWorkspaceStore.getState().setActiveWorkspaceId("ws-2");
    expect(useWorkspaceStore.getState().activeProjectId).toBe("p1");
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
  });

  it("setActiveProjectId does not affect activeWorkspaceId", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "ws-1" });
    useWorkspaceStore.getState().setActiveProjectId("p-2");
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-1");
    expect(useWorkspaceStore.getState().activeProjectId).toBe("p-2");
  });
});
