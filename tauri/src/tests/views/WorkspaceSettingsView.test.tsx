import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import WorkspaceSettingsView from "@/views/WorkspaceSettingsView";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const apiMocks = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  createChildWorkspace: vi.fn(),
  updateWorkspace: vi.fn(() => Promise.resolve()),
  deleteWorkspace: vi.fn(() => Promise.resolve()),
  setWorkspaceParent: vi.fn(() => Promise.resolve()),
  listWorkspaces: vi.fn(),
  getSummary: vi.fn(),
  listMemories: vi.fn(),
  deleteWorkspaceFacts: vi.fn(() => Promise.resolve(0)),
  getMemorySummary: vi.fn(),
  upsertMemorySummary: vi.fn(),
  regenerateMemorySummary: vi.fn(),
  listSummarySnapshots: vi.fn(() => Promise.resolve([])),
  restoreMemorySummarySnapshot: vi.fn(),
  createMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  getTopicSignature: vi.fn(),
  listGlossaryTerms: vi.fn(),
  resolveGlossaryTerm: vi.fn(),
  upsertGlossaryTerm: vi.fn(),
  deleteGlossaryTerm: vi.fn(),
  refreshGlossary: vi.fn(),
  listRoadmapSnapshots: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
  restoreRoadmapSnapshot: vi.fn(() => Promise.resolve()),
  captureRoadmapSnapshot: vi.fn(
    (): Promise<{ created: boolean; reason_skipped: string | null; snapshot_id: string | null }> =>
      Promise.resolve({ created: true, reason_skipped: null, snapshot_id: "snap-1" })
  ),
  getPromptBankStatus: vi.fn(() => Promise.resolve(null)),
  previewDataDeletion: vi.fn(),
  executeDataDeletion: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    dataDeletion: {
      preview: apiMocks.previewDataDeletion,
      execute: apiMocks.executeDataDeletion,
    },
    workspace: {
      create: apiMocks.createWorkspace,
      createChild: apiMocks.createChildWorkspace,
      update: apiMocks.updateWorkspace,
      delete: apiMocks.deleteWorkspace,
      setParent: apiMocks.setWorkspaceParent,
      list: apiMocks.listWorkspaces,
      getPromptBankStatus: apiMocks.getPromptBankStatus,
    },
    dashboard: {
      getSummary: apiMocks.getSummary,
    },
    memory: {
      list: apiMocks.listMemories,
      deleteWorkspaceFacts: apiMocks.deleteWorkspaceFacts,
      getSummary: apiMocks.getMemorySummary,
      upsertSummary: apiMocks.upsertMemorySummary,
      regenerateSummary: apiMocks.regenerateMemorySummary,
      listSummarySnapshots: apiMocks.listSummarySnapshots,
      restoreSummarySnapshot: apiMocks.restoreMemorySummarySnapshot,
      create: apiMocks.createMemory,
      update: apiMocks.updateMemory,
      delete: apiMocks.deleteMemory,
    },
    topicSignature: {
      get: apiMocks.getTopicSignature,
    },
    graph: {
      listRoadmapSnapshots: apiMocks.listRoadmapSnapshots,
      restoreRoadmapSnapshot: apiMocks.restoreRoadmapSnapshot,
      captureRoadmapSnapshot: apiMocks.captureRoadmapSnapshot,
    },
    workspaceGlossary: {
      list: apiMocks.listGlossaryTerms,
      resolve: apiMocks.resolveGlossaryTerm,
      upsert: apiMocks.upsertGlossaryTerm,
      delete: apiMocks.deleteGlossaryTerm,
      refresh: apiMocks.refreshGlossary,
    },
  },
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: <T,>(selector: (state: { switchWorkspaceSection: string }) => T) =>
    selector({ switchWorkspaceSection: "" }),
}));

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

function makeWorkspace(overrides: Partial<ReturnType<typeof buildWorkspace>> = {}) {
  return buildWorkspace(overrides);
}

function buildWorkspace(overrides: Partial<{
  id: string;
  name: string;
  description: string;
  prompt_instructions: string;
  parent_workspace_id: string | null;
}> = {}) {
  return {
    id: "ws-1",
    name: "Workspace 1",
    description: "",
    prompt_instructions: "",
    topic_signature: {
      auto_detected_tags: [],
      custom_tags: [],
      excluded_tags: [],
      intent_patterns: [],
      generated_at: null,
      message_count_at_gen: null,
      ollama_enriched: false,
    },
    signature_updated_at: null,
    is_hidden: false,
    created_at: "2026-04-18T10:00:00.000Z",
    updated_at: "2026-04-18T10:00:00.000Z",
    parent_workspace_id: null,
    icon: "",
    order_index: 0, last_message_at: null, survey_data: null,
    ...overrides,
  };
}

describe("WorkspaceSettingsView", () => {
  beforeEach(() => {
    useWorkspaceStore.setState(INITIAL);
    vi.clearAllMocks();
    localStorage.removeItem("ws-sections-collapsed");

    apiMocks.getSummary.mockResolvedValue({
      workspace_id: "ws-1",
      workspace_name: "Workspace 1",
      overview: {
        chat_sessions: 1,
        notes: 2,
        sources: 3,
        concepts: 4,
        flashcards: 5,
      },
      review: { due_today: 0, total_cards: 0, learned: 0, avg_ease: 2.5, route: { path: "/review-topics", state: null }, topics_due_for_review: 0, top_due_topic: null },
      continue_learning: [],
    });
    apiMocks.listMemories.mockResolvedValue([]);
    apiMocks.deleteWorkspaceFacts.mockResolvedValue(0);
    apiMocks.listWorkspaces.mockResolvedValue([]);
    apiMocks.getMemorySummary.mockResolvedValue(null);
    apiMocks.getTopicSignature.mockResolvedValue(null);
    apiMocks.listGlossaryTerms.mockResolvedValue([]);
    apiMocks.listRoadmapSnapshots.mockResolvedValue([]);
    apiMocks.captureRoadmapSnapshot.mockResolvedValue({
      created: true,
      reason_skipped: null,
      snapshot_id: "snap-1",
    });
    apiMocks.previewDataDeletion.mockResolvedValue({
      workspace_count: 1,
      categories: [
        { id: "chats", label: "Chats & messages", item_count: 5, total_rows: 25 },
      ],
      total_items: 5,
      total_rows: 25,
    });
    apiMocks.executeDataDeletion.mockResolvedValue({
      workspace_count: 1,
      total_deleted_items: 5,
      total_deleted_rows: 25,
      categories: [
        { id: "chats", label: "Chats & messages", item_count: 5, total_rows: 25 },
      ],
    });
  });

  it("renders parent and child workspaces and shows parent context for a selected child", async () => {
    useWorkspaceStore.setState({
      workspaces: [
        makeWorkspace({ id: "root-1", name: "Parent Workspace" }),
        makeWorkspace({ id: "child-1", name: "Child Workspace", parent_workspace_id: "root-1" }),
      ],
      activeWorkspaceId: "child-1",
      activeParentWorkspaceId: "root-1",
    });

    render(
      <MemoryRouter>
        <WorkspaceSettingsView />
      </MemoryRouter>
    );

    expect(screen.getByText("Parent Workspace")).toBeInTheDocument();
    expect(screen.getAllByText("Child Workspace").length).toBeGreaterThan(0);
    expect(await screen.findByText("Parent: Parent Workspace")).toBeInTheDocument();
  });

  it("keeps descriptions out of workspace pills and shows the workspace name as the main heading", async () => {
    useWorkspaceStore.setState({
      workspaces: [
        makeWorkspace({ id: "root-1", name: "Parent Workspace", description: "Parent workspace description" }),
        makeWorkspace({
          id: "child-1",
          name: "Child Workspace",
          description: "Focused language practice",
          parent_workspace_id: "root-1",
        }),
      ],
      activeWorkspaceId: "child-1",
      activeParentWorkspaceId: "root-1",
    });

    render(
      <MemoryRouter>
        <WorkspaceSettingsView />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "Child Workspace" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Focused language practice")).toBeInTheDocument();
    expect(screen.queryByText("Parent workspace description")).not.toBeInTheDocument();
    expect(screen.queryByText("Child of Parent Workspace")).not.toBeInTheDocument();
  });

  it("edits the workspace description from the right-side details panel instead of the left pill", async () => {
    useWorkspaceStore.setState({
      workspaces: [
        makeWorkspace({ id: "root-1", name: "Parent Workspace", description: "Original description" }),
      ],
      activeWorkspaceId: "root-1",
      activeParentWorkspaceId: "root-1",
    });

    render(
      <MemoryRouter>
        <WorkspaceSettingsView />
      </MemoryRouter>
    );

    const descriptionEditor = await screen.findByPlaceholderText("Describe what this workspace is for...");
    fireEvent.change(descriptionEditor, { target: { value: "Updated description" } });
    fireEvent.click(screen.getByRole("button", { name: /save description/i }));

    await waitFor(() => {
      expect(apiMocks.updateWorkspace).toHaveBeenCalledWith(
        "root-1",
        "Parent Workspace",
        "Updated description",
        ""
      );
    });

    fireEvent.click(screen.getByTitle("Rename"));

    expect(screen.queryByPlaceholderText("Optional description…")).not.toBeInTheDocument();
  });

  it("deletes all workspace facts without removing preferences from the memory panel", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    apiMocks.listMemories.mockResolvedValue([
      {
        id: "fact-1",
        workspace_id: "root-1",
        content: "User is learning Rust ownership.",
        memory_type: "fact",
        scope: "workspace",
        source_session_id: null,
        is_pinned: false,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "pref-1",
        workspace_id: "root-1",
        content: "User prefers concise answers.",
        memory_type: "preference",
        scope: "workspace",
        source_session_id: null,
        is_pinned: false,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);

    useWorkspaceStore.setState({
      workspaces: [
        makeWorkspace({ id: "root-1", name: "Parent Workspace" }),
      ],
      activeWorkspaceId: "root-1",
      activeParentWorkspaceId: "root-1",
    });

    render(
      <MemoryRouter>
        <WorkspaceSettingsView />
      </MemoryRouter>
    );

    expect(await screen.findByText("User is learning Rust ownership.")).toBeInTheDocument();
    expect(screen.getByText("User prefers concise answers.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete all facts/i }));

    await waitFor(() => {
      expect(apiMocks.deleteWorkspaceFacts).toHaveBeenCalledWith("root-1");
    });
    expect(screen.queryByText("User is learning Rust ownership.")).not.toBeInTheDocument();
    expect(screen.getByText("User prefers concise answers.")).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("shows workspace memory summary length guidance in settings", async () => {
    apiMocks.getMemorySummary.mockResolvedValue({
      id: "summary-1",
      scope: "workspace",
      workspace_id: "root-1",
      content: "Daniel is learning Python and wants compact, accurate project memory.",
      is_auto_generated: true,
      generated_at: "2026-01-01T00:00:00Z",
      edited_at: null,
    });

    useWorkspaceStore.setState({
      workspaces: [
        makeWorkspace({ id: "root-1", name: "Parent Workspace" }),
      ],
      activeWorkspaceId: "root-1",
      activeParentWorkspaceId: "root-1",
    });

    render(
      <MemoryRouter>
        <WorkspaceSettingsView />
      </MemoryRouter>
    );

    expect(await screen.findByText(/~18 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/Target under 1,500 chars/)).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
  });

  it("shows the created date only in the right-side details area", async () => {
    useWorkspaceStore.setState({
      workspaces: [
        makeWorkspace({ id: "root-1", name: "Parent Workspace" }),
      ],
      activeWorkspaceId: "root-1",
      activeParentWorkspaceId: "root-1",
    });

    render(
      <MemoryRouter>
        <WorkspaceSettingsView />
      </MemoryRouter>
    );

    expect(await screen.findAllByText(/^Created /)).toHaveLength(1);
  });

  it("collapses child workspaces by default and expands them on demand", async () => {
    useWorkspaceStore.setState({
      workspaces: [
        makeWorkspace({ id: "root-1", name: "Parent Workspace" }),
        makeWorkspace({ id: "child-1", name: "Child Workspace", parent_workspace_id: "root-1" }),
      ],
      activeWorkspaceId: null,
      activeParentWorkspaceId: null,
    });

    render(
      <MemoryRouter>
        <WorkspaceSettingsView />
      </MemoryRouter>
    );

    expect(screen.queryByText("Child Workspace")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand child workspaces for Parent Workspace" }));

    expect(await screen.findByText("Child Workspace")).toBeInTheDocument();
  });

  it("creates a root workspace from the root creation flow", async () => {
    apiMocks.createWorkspace.mockResolvedValue(makeWorkspace({ id: "root-2", name: "New Root" }));

    render(
      <MemoryRouter>
        <WorkspaceSettingsView />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /new workspace/i }));
    fireEvent.change(screen.getByPlaceholderText("Workspace name…"), { target: { value: "New Root" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(apiMocks.createWorkspace).toHaveBeenCalledWith("New Root", undefined);
      expect(apiMocks.createChildWorkspace).not.toHaveBeenCalled();
    });
  });

  it("creates a child workspace using the selected parent when a child workspace is selected", async () => {
    useWorkspaceStore.setState({
      workspaces: [
        makeWorkspace({ id: "root-1", name: "Parent Workspace" }),
        makeWorkspace({ id: "child-1", name: "Child Workspace", parent_workspace_id: "root-1" }),
      ],
      activeWorkspaceId: "child-1",
      activeParentWorkspaceId: "root-1",
    });
    apiMocks.createChildWorkspace.mockResolvedValue(
      makeWorkspace({ id: "child-2", name: "New Child", parent_workspace_id: "root-1" })
    );

    render(
      <MemoryRouter>
        <WorkspaceSettingsView />
      </MemoryRouter>
    );

    const childCreateButtons = await screen.findAllByRole("button", { name: /new child workspace/i });
    fireEvent.click(childCreateButtons.find((button) => button.textContent?.includes("New Child Workspace")) ?? childCreateButtons[0]);
    fireEvent.change(screen.getByPlaceholderText("Child workspace name…"), { target: { value: "New Child" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(apiMocks.createChildWorkspace).toHaveBeenCalledWith("root-1", "New Child", undefined);
    });
  });

  function makeSnapshot(overrides: Record<string, unknown> = {}) {
    return {
      id: "snap-1",
      workspace_id: "root-1",
      source_job_id: null,
      source_model: null,
      concept_count: 4,
      link_count: 2,
      created_at: "2026-08-01T10:00:00Z",
      reason: "scheduled",
      ...overrides,
    };
  }

  it("renders a human label for the snapshot reason", async () => {
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace({ id: "root-1", name: "Parent Workspace" })],
      activeWorkspaceId: "root-1",
    });
    apiMocks.listRoadmapSnapshots.mockResolvedValue([makeSnapshot({ reason: "scheduled" })]);

    render(
      <MemoryRouter>
        <WorkspaceSettingsView />
      </MemoryRouter>
    );

    expect(await screen.findByText("Scheduled")).toBeInTheDocument();
  });

  it("falls back to the raw reason for an unknown value", async () => {
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace({ id: "root-1", name: "Parent Workspace" })],
      activeWorkspaceId: "root-1",
    });
    apiMocks.listRoadmapSnapshots.mockResolvedValue([makeSnapshot({ reason: "future_thing" })]);

    render(
      <MemoryRouter>
        <WorkspaceSettingsView />
      </MemoryRouter>
    );

    expect(await screen.findByText("future_thing")).toBeInTheDocument();
  });

  it("captures a snapshot on demand and refreshes the list", async () => {
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace({ id: "root-1", name: "Parent Workspace" })],
      activeWorkspaceId: "root-1",
    });

    render(
      <MemoryRouter>
        <WorkspaceSettingsView />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: /snapshot now/i }));

    await waitFor(() => {
      expect(apiMocks.captureRoadmapSnapshot).toHaveBeenCalledWith("root-1");
    });
    // The list reloads so the new snapshot appears without a manual refresh.
    await waitFor(() => {
      expect(apiMocks.listRoadmapSnapshots.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("reports an unchanged graph as a normal outcome, not a failure", async () => {
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace({ id: "root-1", name: "Parent Workspace" })],
      activeWorkspaceId: "root-1",
    });
    apiMocks.captureRoadmapSnapshot.mockResolvedValue({
      created: false,
      reason_skipped: "unchanged",
      snapshot_id: null,
    });

    render(
      <MemoryRouter>
        <WorkspaceSettingsView />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: /snapshot now/i }));

    expect(await screen.findByText("No changes")).toBeInTheDocument();
  });

  it("opens granular data deletion modal and triggers deletion for selected workspace", async () => {
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace({ id: "root-1", name: "Parent Workspace" })],
      activeWorkspaceId: "root-1",
    });

    render(
      <MemoryRouter>
        <WorkspaceSettingsView />
      </MemoryRouter>
    );

    const deleteBtn = await screen.findByRole("button", { name: /Delete Selected Workspace Data/i });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(apiMocks.previewDataDeletion).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "workspace",
          workspace_ids: ["root-1"],
        })
      );
    });

    expect(await screen.findByRole("heading", { name: /Permanently Delete Workspace Data/i })).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: /Permanently Delete Data/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiMocks.executeDataDeletion).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "workspace",
          workspace_ids: ["root-1"],
        })
      );
    });
  });
});
