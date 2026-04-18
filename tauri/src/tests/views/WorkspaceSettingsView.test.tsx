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
  listWorkspaces: vi.fn(),
  getSummary: vi.fn(),
  listMemories: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    workspace: {
      create: apiMocks.createWorkspace,
      createChild: apiMocks.createChildWorkspace,
      update: apiMocks.updateWorkspace,
      delete: apiMocks.deleteWorkspace,
      list: apiMocks.listWorkspaces,
    },
    dashboard: {
      getSummary: apiMocks.getSummary,
    },
    memory: {
      list: apiMocks.listMemories,
    },
  },
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: <T,>(selector: (state: { switchWorkspaceToChat: boolean }) => T) =>
    selector({ switchWorkspaceToChat: false }),
}));

const INITIAL = {
  workspaces: [],
  activeWorkspaceId: null,
  activeParentWorkspaceId: null,
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
    created_at: "2026-04-18T10:00:00.000Z",
    updated_at: "2026-04-18T10:00:00.000Z",
    parent_workspace_id: null,
    icon: "",
    ...overrides,
  };
}

describe("WorkspaceSettingsView", () => {
  beforeEach(() => {
    useWorkspaceStore.setState(INITIAL);
    vi.clearAllMocks();

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
      review: { due_flashcards: 0, overdue_flashcards: 0, due_goals: 0 },
      goals: [],
      progression: [],
      knowledge_health: {
        stalled_goals: 0,
        unprocessed_sources: 0,
        isolated_concepts: 0,
        active_topic_tags: [],
      },
      recent_activity: [],
    });
    apiMocks.listMemories.mockResolvedValue([]);
    apiMocks.listWorkspaces.mockResolvedValue([]);
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
});
