import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DataControlsPreferences } from "@/components/preferences/DataControlsPreferences";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { KnowledgeResetResult } from "@/lib/api";

const apiMocks = vi.hoisted(() => ({
  resetKnowledgeState: vi.fn(),
  listModels: vi.fn(),
  listenBackgroundTask: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      graph: { ...actual.api.graph, resetKnowledgeState: apiMocks.resetKnowledgeState },
      aiModel: { ...actual.api.aiModel, list: apiMocks.listModels },
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
