import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { DataControlsPreferences } from "@/components/preferences/DataControlsPreferences";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { DataDeletionPreview, DataDeletionResult, KnowledgeResetResult } from "@/lib/api";

const apiMocks = vi.hoisted(() => ({
  resetKnowledgeState: vi.fn(),
  listModels: vi.fn(),
  listenBackgroundTask: vi.fn(),
  previewDataDeletion: vi.fn(),
  executeDataDeletion: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      graph: { ...actual.api.graph, resetKnowledgeState: apiMocks.resetKnowledgeState },
      aiModel: { ...actual.api.aiModel, list: apiMocks.listModels },
      dataDeletion: {
        preview: apiMocks.previewDataDeletion,
        execute: apiMocks.executeDataDeletion,
      },
      listenBackgroundTask: apiMocks.listenBackgroundTask,
    },
  };
});

function emptyResult(overrides: Partial<KnowledgeResetResult> = {}): KnowledgeResetResult {
  return {
    dry_run: true,
    workspace_count: 1,
    concept_nodes: 0,
    concept_links: 0,
    concept_mentions: 0,
    graph_statistics: 0,
    roadmap_snapshots: 0,
    analyze_jobs: 0,
    analyze_job_chunks: 0,
    change_proposals: 0,
    flashcard_topics: 0,
    generated_cards_deleted: 0,
    generated_cards_detached: 0,
    learning_goals_detached: 0,
    topic_signatures_cleared: 0,
    prompt_bank_prompts: 0,
    prompt_bank_jobs: 0,
    ...overrides,
  };
}

describe("DataControlsPreferences — reset scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.resetKnowledgeState.mockResolvedValue(emptyResult());
    apiMocks.listModels.mockResolvedValue([]);
    apiMocks.listenBackgroundTask.mockResolvedValue(() => {});
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Alpha" },
        { id: "ws-2", name: "Beta" },
      ],
      activeWorkspaceId: "ws-1",
    } as never);
  });

  it("labels the reset button with the active workspace by default", () => {
    render(<DataControlsPreferences />);
    expect(
      screen.getByRole("button", { name: /Reset AI-Inferred Data — Alpha/ }),
    ).toBeTruthy();
  });

  it("resets only the active workspace under the default scope", async () => {
    render(<DataControlsPreferences />);
    fireEvent.click(screen.getByRole("button", { name: /Reset AI-Inferred Data — Alpha/ }));

    await waitFor(() => expect(apiMocks.resetKnowledgeState).toHaveBeenCalled());
    expect(apiMocks.resetKnowledgeState).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "workspace", workspaceId: "ws-1", dryRun: true }),
    );
  });

  // Regression: the reset used to read the Background Processing card's scope
  // radios, so changing that card retargeted this destructive action. The two
  // scopes must now be fully independent.
  it("ignores the background-processing scope radios", async () => {
    render(<DataControlsPreferences />);

    // Flip the background-processing scope to "All workspaces".
    const processingRadios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="background-processing-scope"]'),
    );
    expect(processingRadios).toHaveLength(3);
    fireEvent.click(processingRadios[2]);

    // The reset button must still be scoped to the active workspace.
    expect(
      screen.getByRole("button", { name: /Reset AI-Inferred Data — Alpha/ }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Reset AI-Inferred Data — Alpha/ }));
    await waitFor(() => expect(apiMocks.resetKnowledgeState).toHaveBeenCalled());
    expect(apiMocks.resetKnowledgeState).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "workspace", workspaceId: "ws-1" }),
    );
  });

  it("switches to all workspaces via its own picker", async () => {
    render(<DataControlsPreferences />);
    const resetRadios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="knowledge-reset-scope"]'),
    );
    expect(resetRadios).toHaveLength(3);
    fireEvent.click(resetRadios[2]);

    fireEvent.click(
      screen.getByRole("button", { name: /Reset AI-Inferred Data — All Workspaces/ }),
    );
    await waitFor(() => expect(apiMocks.resetKnowledgeState).toHaveBeenCalled());
    expect(apiMocks.resetKnowledgeState).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "all_workspaces" }),
    );
  });

  it("seeds the selection from the active workspace when picking selected scope", () => {
    render(<DataControlsPreferences />);
    const resetRadios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="knowledge-reset-scope"]'),
    );
    fireEvent.click(resetRadios[1]);

    // Seeded with the active workspace rather than landing on "0 Workspaces".
    expect(screen.getByRole("button", { name: /Reset AI-Inferred Data — Alpha/ })).toBeTruthy();
  });

  it("fans out one call per workspace when several are selected", async () => {
    render(<DataControlsPreferences />);
    const resetRadios = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="knowledge-reset-scope"]'),
    );
    fireEvent.click(resetRadios[1]);

    // Add the second workspace alongside the seeded active one.
    fireEvent.click(screen.getByRole("checkbox", { name: /Beta/ }));

    fireEvent.click(
      screen.getByRole("button", { name: /Reset AI-Inferred Data — 2 Workspaces/ }),
    );

    await waitFor(() => expect(apiMocks.resetKnowledgeState).toHaveBeenCalledTimes(2));
    const calledIds = apiMocks.resetKnowledgeState.mock.calls.map((c) => c[0].workspaceId).sort();
    expect(calledIds).toEqual(["ws-1", "ws-2"]);
  });
});

function mockDeletionPreview(overrides: Partial<DataDeletionPreview> = {}): DataDeletionPreview {
  return {
    workspace_count: 1,
    categories: [
      { id: "chats", label: "Chats & Messages", item_count: 5, total_rows: 25 },
      { id: "notes", label: "Notes & Templates", item_count: 3, total_rows: 8 },
    ],
    total_items: 8,
    total_rows: 33,
    ...overrides,
  };
}

function mockDeletionResult(overrides: Partial<DataDeletionResult> = {}): DataDeletionResult {
  return {
    workspace_count: 1,
    total_deleted_items: 8,
    total_deleted_rows: 33,
    categories: [
      { id: "chats", label: "Chats & messages", item_count: 5, total_rows: 25 },
      { id: "notes", label: "Notes & templates", item_count: 3, total_rows: 8 },
    ],
    ...overrides,
  };
}

describe("DataControlsPreferences — granular data deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.previewDataDeletion.mockResolvedValue(mockDeletionPreview());
    apiMocks.executeDataDeletion.mockResolvedValue(mockDeletionResult());
    apiMocks.listModels.mockResolvedValue([]);
    apiMocks.listenBackgroundTask.mockResolvedValue(() => {});
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Alpha" },
        { id: "ws-2", name: "Beta" },
      ],
      activeWorkspaceId: "ws-1",
    } as never);
  });

  it("renders granular data deletion section with all categories and action button", () => {
    render(<DataControlsPreferences />);
    const heading = screen.getByRole("heading", { name: /Granular Data Deletion/i });
    const card = heading.closest<HTMLElement>("div.rounded-xl");
    if (!card) {
      throw new Error("Granular Data Deletion card container not found");
    }
    expect(card).toBeTruthy();
    const cardScope = within(card);
    expect(cardScope.getByText(/Chats & messages/i)).toBeTruthy();
    expect(cardScope.getByText(/Notes & templates/i)).toBeTruthy();
    expect(cardScope.getByText(/Sources & documents/i)).toBeTruthy();
    expect(cardScope.getByText(/Flashcards & goals/i)).toBeTruthy();
    expect(cardScope.getByText(/Concepts & knowledge map/i)).toBeTruthy();
    expect(cardScope.getByText("Memories")).toBeTruthy();
    expect(cardScope.getByText(/Thought queue & alarms/i)).toBeTruthy();
    expect(cardScope.getByRole("button", { name: /Delete Selected Data — Alpha/i })).toBeTruthy();
  });

  it("allows deselecting all and selecting all categories", () => {
    render(<DataControlsPreferences />);
    const heading = screen.getByRole("heading", { name: /Granular Data Deletion/i });
    const card = heading.closest<HTMLElement>("div.rounded-xl");
    if (!card) {
      throw new Error("Granular Data Deletion card container not found");
    }
    const cardScope = within(card);

    const clearAllBtn = cardScope.getByRole("button", { name: /Clear all/i });
    fireEvent.click(clearAllBtn);

    const deleteBtn = cardScope.getByRole("button", { name: /Delete Selected Data/i });
    expect(deleteBtn).toBeDisabled();

    const selectAllBtn = cardScope.getByRole("button", { name: /Select all/i });
    fireEvent.click(selectAllBtn);
    expect(cardScope.getByRole("button", { name: /Delete Selected Data — Alpha/i })).not.toBeDisabled();
  });

  it("allows switching time filter cutoffs", () => {
    render(<DataControlsPreferences />);
    const olderThan30d = screen.getByLabelText(/Older than 30 days/i) as HTMLInputElement;
    expect(olderThan30d.checked).toBe(false);
    fireEvent.click(olderThan30d);
    expect(olderThan30d.checked).toBe(true);
  });

  it("opens deletion preview and executes deletion upon confirmation", async () => {
    render(<DataControlsPreferences />);

    const deleteBtn = screen.getByRole("button", { name: /Delete Selected Data — Alpha/i });
    fireEvent.click(deleteBtn);

    await waitFor(() => expect(apiMocks.previewDataDeletion).toHaveBeenCalledTimes(1));
    expect(apiMocks.previewDataDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "current_workspace",
        workspace_ids: ["ws-1"],
        time_filter: "all",
      }),
    );

    // Modal should be open showing preview counts
    expect(await screen.findByRole("heading", { name: /Permanently Delete Workspace Data/i })).toBeTruthy();
    expect(screen.getByText(/8 items · 33 total records/i)).toBeTruthy();

    // Confirm deletion
    const confirmBtn = screen.getByRole("button", { name: /Permanently Delete Data/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(apiMocks.executeDataDeletion).toHaveBeenCalledTimes(1));
    expect(apiMocks.executeDataDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "current_workspace",
        workspace_ids: ["ws-1"],
        time_filter: "all",
      }),
    );
  });
});
