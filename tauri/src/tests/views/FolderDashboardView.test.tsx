import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import FolderDashboardView from "@/views/FolderDashboardView";

const mocks = vi.hoisted(() => ({
  getSummary: vi.fn(),
  listTopics: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    dashboard: {
      getSummary: mocks.getSummary,
    },
    flashcard: {
      listTopics: mocks.listTopics,
    },
  },
}));

vi.mock("@/lib/workspacePane", () => ({
  useScopedWorkspace: () => ({
    activeWorkspaceId: "ws-1",
  }),
  useBubbleUpFlag: () => false,
}));

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("FolderDashboardView", () => {
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
          created_at: "2026-04-01T10:00:00Z",
          updated_at: "2026-04-06T10:00:00Z",
          parent_workspace_id: null,
    icon: "", order_index: 0, last_message_at: null, survey_data: null
        },
      ],
      activeWorkspaceId: "ws-1",
    });

    mocks.listTopics.mockResolvedValue([]);
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
      continue_learning: [
        {
          session_id: "session-1",
          title: "cgroups vs namespaces",
          folder_id: "proj-1",
          folder_name: "Containers",
          updated_at: "2026-04-06T09:00:00Z",
          route: { path: "/chat/session-1", state: null },
        },
      ],
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
        topics_due_for_review: 3,
        top_due_topic: "PID namespaces",
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
          description: "3 topics need another review pass. Start with \"PID namespaces\".",
          route: { path: "/review-topics", state: null },
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
        <FolderDashboardView />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mocks.getSummary).toHaveBeenCalledWith("ws-1", { includeDescendants: false });
    });

    expect(await screen.findByText("Continue Learning")).toBeInTheDocument();
    expect(screen.getByText("Goals In Motion")).toBeInTheDocument();
    expect(screen.getByText("Explain Linux container isolation")).toBeInTheDocument();
    expect(screen.getAllByText("Linux").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review" })).toBeInTheDocument();
  });

  it("navigates to /chat with createNewChat and searchQuery when search is executed", async () => {
    render(
      <MemoryRouter>
        <FolderDashboardView />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mocks.getSummary).toHaveBeenCalledWith("ws-1", { includeDescendants: false });
    });

    const searchInput = screen.getByPlaceholderText("Search or ask anything...");
    fireEvent.change(searchInput, { target: { value: "hello local AI" } });

    const searchButton = screen.getByRole("button", { name: "Search" });
    fireEvent.click(searchButton);

    expect(mockNavigate).toHaveBeenCalledWith("/chat", {
      state: {
        createNewChat: true,
        searchQuery: "hello local AI",
      },
    });
  });
});
