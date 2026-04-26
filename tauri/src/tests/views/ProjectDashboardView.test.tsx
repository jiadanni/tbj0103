import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import ProjectDashboardView from "@/views/ProjectDashboardView";

const mocks = vi.hoisted(() => ({
  getSummary: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    dashboard: {
      getSummary: mocks.getSummary,
    },
  },
}));

vi.mock("@/lib/workspacePane", () => ({
  useScopedWorkspace: () => ({
    activeWorkspaceId: "ws-1",
  }),
}));

describe("ProjectDashboardView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: "ws-1",
          name: "Linux",
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
          created_at: "2026-04-01T10:00:00Z",
          updated_at: "2026-04-06T10:00:00Z",
          parent_workspace_id: null,
    icon: "", order_index: 0, last_message_at: null
        },
      ],
      activeWorkspaceId: "ws-1",
    });

    mocks.getSummary.mockResolvedValue({
      workspace_id: "ws-1",
      workspace_name: "Linux",
      overview: {
        chat_sessions: 8,
        notes: 4,
        sources: 3,
        concepts: 12,
        flashcards: 9,
        active_goals: 2,
        completed_goals: 1,
      },
      continue_learning: {
        session_id: "session-1",
        title: "cgroups vs namespaces",
        project_id: "proj-1",
        project_name: "Containers",
        updated_at: "2026-04-06T09:00:00Z",
        route: { path: "/chat/session-1", state: null },
      },
      review: {
        due_today: 5,
        total_cards: 9,
        learned: 6,
        avg_ease: 2.4,
        under_reviewed_concepts: 3,
        weak_concepts: [
          {
            concept_id: "concept-1",
            name: "PID namespaces",
            review_count: 0,
            reason: "Not reinforced yet",
            route: { path: "/graph", state: null },
          },
        ],
        route: { path: "/graph", state: null },
      },
      goals: [
        {
          id: "goal-1",
          title: "Explain Linux container isolation",
          progress: 0.65,
          is_completed: false,
          due_date: null,
          updated_at: "2026-04-05T10:00:00Z",
          route: { path: "/graph", state: null },
        },
      ],
      progression: [
        {
          id: "review-due",
          kind: "review",
          title: "Review what is due now",
          description: "5 flashcards are ready for reinforcement.",
          route: { path: "/graph", state: null },
        },
      ],
      knowledge_health: {
        stalled_goals: 1,
        unprocessed_sources: 2,
        isolated_concepts: 4,
        active_topic_tags: ["Linux", "Containers"],
      },
      recent_activity: [
        {
          id: "note-1",
          kind: "note",
          title: "OCI notes",
          subtitle: "manual",
          timestamp: "2026-04-06T08:00:00Z",
          route: { path: "/notes", state: null },
        },
      ],
    });
  });

  it("renders progression, review, and goal sections from the dashboard summary", async () => {
    render(
      <MemoryRouter>
        <ProjectDashboardView />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mocks.getSummary).toHaveBeenCalledWith("ws-1");
    });

    expect(await screen.findByText("Continue Learning")).toBeInTheDocument();
    expect(screen.getByText("Goals In Motion")).toBeInTheDocument();
    expect(screen.getByText("Explain Linux container isolation")).toBeInTheDocument();
    expect(screen.getAllByText("Linux").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review" })).toBeInTheDocument();
  });
});
