import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { api } from "@/lib/api";
import KnowledgeGraphView from "@/views/KnowledgeGraphView";

const mocks = vi.hoisted(() => ({
  listModels: vi.fn(),
  listConcepts: vi.fn(),
  listLinks: vi.fn(),
  listByConcept: vi.fn(),
  getSummary: vi.fn(),
  analyzeWorkspace: vi.fn(),
  generateFromConcept: vi.fn(),
  ollamaListModels: vi.fn(),
  d3ForceStrength: vi.fn(),
  d3Force: vi.fn(),
  zoom: vi.fn(),
  centerAt: vi.fn(),
  zoomToFit: vi.fn(),
  checkWorkspaceAnalyzable: vi.fn().mockResolvedValue({ ready: true, item_count: 5, char_count: 500 }),
}));

vi.mock("@/components/RoadmapGraph", () => ({
  default: (props: { nodes: { id: string }[]; onSelectConcept: (node: { id: string }) => void }) => (
    <div data-testid="roadmap-graph">
      {props.nodes.map((n) => (
        <button
          key={n.id}
          type="button"
          aria-label="Select graph node"
          onClick={() => props.onSelectConcept(n)}
        />
      ))}
    </div>
  ),
}));

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
      generateFromConcept: mocks.generateFromConcept,
    },
    graph: {
      listConcepts: mocks.listConcepts,
      listLinks: mocks.listLinks,
      createConcept: vi.fn(),
      deleteConcept: vi.fn(),
      getLearningPath: vi.fn().mockResolvedValue([]),
      getKnowledgeSettings: vi.fn().mockResolvedValue({ upgrade_mode: "auto", supersede_mode: "auto", confidence_threshold: 0.05 }),
      listChangeProposals: vi.fn().mockResolvedValue([]),
    },
    knowledge: {
      analyzeWorkspace: mocks.analyzeWorkspace,
      checkWorkspaceAnalyzable: mocks.checkWorkspaceAnalyzable,
    },
    ollama: {
      listModels: mocks.ollamaListModels,
    },
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@/lib/workspacePane", () => ({
  useScopedWorkspace: () => ({
    activeWorkspaceId: "ws-1",
  }),
  useBubbleUpFlag: () => false,
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
      isDemoMode: false,
    });

    mocks.listModels.mockResolvedValue([
      { model_id: "gemma3:1b", enabled: true, priority: 1 },
    ]);
    mocks.ollamaListModels.mockResolvedValue([]);
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
      continue_learning: [],
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
        topics_due_for_review: 2,
        top_due_topic: "Namespaces",
      },
      goals: [],
      progression: [
        {
          id: "review-due",
          kind: "review",
          title: "Review what is due now",
          description: "2 topics need another review pass. Start with \"Namespaces\".",
          route: { path: "/review-topics", state: null },
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

    expect(await screen.findByText("Knowledge Map")).toBeInTheDocument();
    expect(screen.queryByText("Suggested Next Steps")).not.toBeInTheDocument();
    expect(screen.queryByText("Knowledge Health")).not.toBeInTheDocument();
    expect(screen.queryByText("Topic Focus")).not.toBeInTheDocument();
    expect(screen.getByTestId("knowledge-map")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Backlinks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deduplication" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Flashcards" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Learning" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("roadmap-graph")).toBeInTheDocument();
    });
  });

  it("explains missing models outside demo mode", async () => {
    mocks.listModels.mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={[{ pathname: "/graph", state: null }]}>
        <KnowledgeGraphView />
      </MemoryRouter>,
    );

    expect(await screen.findByText("No local AI models are available yet. Install or connect a model to analyze this workspace.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Analyze Workspace" })[0]).toBeDisabled();
  });

  it("simulates analysis and cards in demo mode without local models", async () => {
    mocks.listModels.mockResolvedValue([]);
    useWorkspaceStore.setState({ isDemoMode: true });

    render(
      <MemoryRouter initialEntries={[{ pathname: "/graph", state: null }]}>
        <KnowledgeGraphView />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Demo data is preloaded. No local models are installed on this machine, so AI actions use simulated demo output.")).toBeInTheDocument();

    const analyzeButton = screen.getAllByRole("button", { name: "Simulate Analysis" })[0];
    expect(analyzeButton).toBeEnabled();
    fireEvent.click(analyzeButton);

    await waitFor(() => {
      expect(screen.getAllByText("Demo analysis refreshed the seeded sample content.")).toHaveLength(2);
    }, { timeout: 4000 });
    expect(mocks.analyzeWorkspace).not.toHaveBeenCalled();

    const graphNodeButton = await screen.findByRole("button", { name: "Select graph node" });
    fireEvent.click(graphNodeButton);

    const cardsButton = await screen.findByRole("button", { name: "Simulate Cards" });
    fireEvent.click(cardsButton);

    await waitFor(() => {
      expect(screen.getByText("What is Namespaces?")).toBeInTheDocument();
    }, { timeout: 4000 });
    expect(mocks.generateFromConcept).not.toHaveBeenCalled();
  }, 15000);

  it("hides the topic-review card when no topics are due", async () => {
    mocks.getSummary.mockResolvedValueOnce({
      workspace_id: "ws-1",
      workspace_name: "Linux",
      overview: { chat_sessions: 1, notes: 1, sources: 1, concepts: 1, flashcards: 0, active_goals: 0, completed_goals: 0 },
      continue_learning: [],
      review: {
        due_today: 0,
        total_cards: 0,
        learned: 0,
        avg_ease: 2.5,
        under_reviewed_concepts: 0,
        weak_concepts: [],
        route: { path: "/graph", state: null },
        topics_due_for_review: 0,
        top_due_topic: null,
      },
      goals: [],
      progression: [],
      knowledge_health: { stalled_goals: 0, unprocessed_sources: 0, isolated_concepts: 0, active_topic_tags: [] },
      recent_activity: [],
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: "/graph", state: null }]}>
        <KnowledgeGraphView />
      </MemoryRouter>,
    );

    await screen.findByText("Knowledge Map");
    expect(screen.queryByText(/another review pass/)).not.toBeInTheDocument();
  });

  it("renders the proposals review panel and applies a proposal", async () => {
    // Mock getKnowledgeSettings
    api.graph.getKnowledgeSettings = vi.fn().mockResolvedValue({
      upgrade_mode: "suggest",
      supersede_mode: "suggest",
      confidence_threshold: 0.15,
    });

    // Mock listChangeProposals to return one proposal
    const mockProposal = {
      id: "proposal-1",
      workspace_id: "ws-1",
      job_id: "job-1",
      proposal_type: "upgrade",
      target_node_id: "concept-1",
      payload: JSON.stringify({ concept_description: "New primitive description" }),
      reason: "Improved extraction quality",
      created_at: "2026-04-06T10:30:00Z",
    };
    api.graph.listChangeProposals = vi.fn().mockResolvedValue([mockProposal]);
    api.graph.applyChangeProposal = vi.fn().mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <KnowledgeGraphView />
      </MemoryRouter>,
    );

    // Wait for the proposals panel to render
    expect(await screen.findByText("Change Proposals (1)")).toBeInTheDocument();
    expect(screen.getAllByText("Namespaces")[0]).toBeInTheDocument();
    expect(screen.getByText("Upgrade description")).toBeInTheDocument();
    expect(screen.getByText(/Improved extraction quality/)).toBeInTheDocument();

    // Click Accept button
    const acceptBtn = screen.getByRole("button", { name: "Accept" });
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(api.graph.applyChangeProposal).toHaveBeenCalledWith("proposal-1");
    });
  });
});
