import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import KnowledgeGraphView from "@/views/KnowledgeGraphView";

const mocks = vi.hoisted(() => ({
  listModels: vi.fn(),
  listConcepts: vi.fn(),
  listLinks: vi.fn(),
  listByConcept: vi.fn(),
  getSummary: vi.fn(),
}));

vi.mock("react-force-graph-2d", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MockForceGraph = React.forwardRef<any>((_props, ref) => {
    React.useImperativeHandle(ref, () => ({
      d3Force: vi.fn(() => ({ strength: vi.fn() })),
      zoom: vi.fn(),
      centerAt: vi.fn(),
      zoomToFit: vi.fn(),
    }), []);
    return <div data-testid="force-graph" />;
  });
  MockForceGraph.displayName = "MockForceGraph";
  return {
    default: MockForceGraph,
  };
});

vi.mock("@/lib/api", () => ({
  api: {
    aiModel: {
      list: mocks.listModels,
    },
    dashboard: {
      getSummary: mocks.getSummary,
    },
    flashcard: {
      listByConcept: mocks.listByConcept,
      generateFromConcept: vi.fn(),
    },
    graph: {
      listConcepts: mocks.listConcepts,
      listLinks: mocks.listLinks,
      createConcept: vi.fn(),
      deleteConcept: vi.fn(),
      getLearningPath: vi.fn().mockResolvedValue([]),
    },
    knowledge: {
      analyzeWorkspace: vi.fn(),
    },
    ollama: {
      listModels: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/lib/workspacePane", () => ({
  useScopedWorkspace: () => ({
    activeWorkspaceId: "ws-1",
  }),
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({
    preferredModel: "gemma3:1b",
    ollamaUrl: "",
  }),
}));

describe("KnowledgeGraphView", () => {
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
        },
      ],
      activeWorkspaceId: "ws-1",
    });

    mocks.listModels.mockResolvedValue([
      { model_id: "gemma3:1b", enabled: true, priority: 1 },
    ]);
    mocks.listConcepts.mockResolvedValue([
      {
        id: "concept-1",
        workspace_id: "ws-1",
        name: "Namespaces",
        concept_type: "technology",
        concept_description: "Isolation primitive",
        aliases: [],
        source_count: 1,
        created_at: "2026-04-06T10:00:00Z",
        updated_at: "2026-04-06T10:00:00Z",
      },
    ]);
    mocks.listLinks.mockResolvedValue([
      {
        id: "link-1",
        source_id: "concept-1",
        target_id: "concept-1",
        link_type: "related",
        strength: 1,
        created_at: "2026-04-06T10:00:00Z",
      },
    ]);
    mocks.listByConcept.mockResolvedValue([]);
    mocks.getSummary.mockResolvedValue({
      workspace_id: "ws-1",
      workspace_name: "Linux",
      overview: {
        chat_sessions: 2,
        notes: 1,
        sources: 1,
        concepts: 1,
        flashcards: 0,
        active_goals: 1,
        completed_goals: 0,
      },
      continue_learning: null,
      review: {
        due_today: 2,
        total_cards: 4,
        learned: 1,
        avg_ease: 2.2,
        under_reviewed_concepts: 1,
        weak_concepts: [
          {
            concept_id: "concept-1",
            name: "Namespaces",
            review_count: 0,
            reason: "Not reinforced yet",
            route: { path: "/graph", state: { subView: "flashcards" } },
          },
        ],
        route: { path: "/graph", state: { subView: "flashcards" } },
      },
      goals: [],
      progression: [
        {
          id: "review",
          kind: "review",
          title: "Review what is due now",
          description: "2 flashcards are ready for reinforcement.",
          route: { path: "/graph", state: { subView: "flashcards" } },
        },
      ],
      knowledge_health: {
        stalled_goals: 1,
        unprocessed_sources: 1,
        isolated_concepts: 0,
        active_topic_tags: ["Linux"],
      },
      recent_activity: [
        {
          id: "note-1",
          kind: "note",
          title: "OCI note",
          subtitle: "manual",
          timestamp: "2026-04-06T08:00:00Z",
          route: { path: "/notes", state: null },
        },
      ],
    });
  });

  it("renders a unified knowledge overview and ignores legacy graph subview state", async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/graph", state: { subView: "flashcards" } }]}>
        <KnowledgeGraphView />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mocks.getSummary).toHaveBeenCalledWith("ws-1");
    });

    expect(await screen.findByText("Suggested Next Steps")).toBeInTheDocument();
    expect(screen.getByText("Knowledge Map")).toBeInTheDocument();
    expect(screen.getByText("Knowledge Health")).toBeInTheDocument();
    expect(screen.getByTestId("knowledge-map")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Backlinks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deduplication" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Flashcards" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Learning" })).not.toBeInTheDocument();
  });
});
