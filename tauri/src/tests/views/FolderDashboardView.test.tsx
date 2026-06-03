import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import FolderDashboardView from "@/views/FolderDashboardView";

const mocks = vi.hoisted(() => ({
  getSummary: vi.fn(),
  getLayout: vi.fn(),
  setLayout: vi.fn(),
  resetLayout: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  setIpcWorkspaceContextProvider: vi.fn(),
  api: {
    dashboard: {
      getSummary: mocks.getSummary,
      getLayout: mocks.getLayout,
      setLayout: mocks.setLayout,
      resetLayout: mocks.resetLayout,
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

    mocks.getLayout.mockResolvedValue({
      version: 1,
      sections: [
        { id: "learning_activity", hidden: false },
      ],
    });
    mocks.setLayout.mockResolvedValue(undefined);
    mocks.resetLayout.mockResolvedValue({ version: 1, sections: [] });
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
          message_count: 4,
          last_snippet: "Let me know once you've checked the unshare flags.",
          last_role: "assistant",
          route: { path: "/chat/session-1", state: null },
        },
        {
          session_id: "session-2",
          title: "Rootless container setup",
          folder_id: "proj-1",
          folder_name: "Containers",
          updated_at: "2026-04-06T08:30:00Z",
          message_count: 7,
          last_snippet: "Rootless containers still need subordinate UID and GID ranges configured.",
          last_role: "assistant",
          route: { path: "/chat/session-2", state: null },
        },
      ],
      review: {
        due_today: 5,
        total_cards: 9,
        learned: 6,
        avg_ease: 2.4,
        route: { path: "/review-topics", state: null },
        topics_due_for_review: 3,
        top_due_topic: "PID namespaces",
      },
    });
  });

  it("renders the slim dashboard without the old map/practice tabs", async () => {
    render(
      <MemoryRouter>
        <FolderDashboardView />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mocks.getSummary).toHaveBeenCalledWith("ws-1", { includeDescendants: false });
    });

    expect(await screen.findByText("Continue Learning")).toBeInTheDocument();
    expect(screen.getByText("cgroups vs namespaces")).toBeInTheDocument();
    expect(screen.getByText("Rootless container setup")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Map/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Practice/ })).not.toBeInTheDocument();

    // The retired AI-scored sections must not render.
    expect(screen.queryByText("Knowledge Health")).not.toBeInTheDocument();
    expect(screen.queryByText("Quick Quizzes")).not.toBeInTheDocument();
    expect(screen.queryByText("Suggested Next Steps")).not.toBeInTheDocument();
    expect(screen.queryByText("Weak Topics")).not.toBeInTheDocument();
    expect(screen.queryByText("Goals In Motion")).not.toBeInTheDocument();
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
