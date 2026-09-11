import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import FlashcardReviewView from "@/views/FlashcardReviewView";
import type { LearningCard, ReviewStats, ConceptNode } from "@/lib/api";

const mockCards: LearningCard[] = [
  {
    id: "card-1",
    workspace_id: "ws-1",
    front: "What is Rust ownership?",
    back: "Rules governing memory management without a garbage collector.",
    next_review_date: "2026-09-11",
    interval: 1,
    ease_factor: 2.5,
    repetitions: 0,
    source_type: "concept",
    created_at: "2026-09-01T00:00:00Z",
  },
  {
    id: "card-2",
    workspace_id: "ws-1",
    front: "What is borrowing?",
    back: "Creating references to data without taking ownership.",
    next_review_date: "2026-09-11",
    interval: 1,
    ease_factor: 2.5,
    repetitions: 0,
    source_type: "concept",
    created_at: "2026-09-01T00:00:00Z",
  },
];

const mockStats: ReviewStats = {
  due_today: 124,
  total_cards: 124,
  learned: 0,
  avg_ease: 2.5,
};

const mockConcept: ConceptNode = {
  id: "concept-123",
  workspace_id: "ws-1",
  name: "Rust Memory Management",
  concept_description: "Core memory safety rules in Rust",
  concept_type: "core",
  tags: [],
  aliases: [],
  x_position: 0,
  y_position: 0,
  review_count: 0,
  hierarchy_level: "root",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  self_rank: null,
  self_ranked_at: null,
};

const mocks = vi.hoisted(() => ({
  listDue: vi.fn(),
  getStats: vi.fn(),
  listTopics: vi.fn(() => Promise.resolve([])),
  suggestNext: vi.fn(() => Promise.resolve(null)),
  review: vi.fn(),
  getConcept: vi.fn(),
  listModels: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/lib/api", () => ({
  api: {
    flashcard: {
      listDue: mocks.listDue,
      getStats: mocks.getStats,
      listTopics: mocks.listTopics,
      suggestNext: mocks.suggestNext,
      review: mocks.review,
      generate: vi.fn(() => Promise.resolve([])),
      generateForTopic: vi.fn(() => Promise.resolve([])),
      create: vi.fn(),
    },
    graph: {
      getConcept: mocks.getConcept,
    },
    aiModel: {
      list: mocks.listModels,
    },
    ollama: {
      listModels: vi.fn(() => Promise.resolve([])),
    },
  },
}));

vi.mock("@/lib/workspacePane", () => ({
  useScopedWorkspace: () => ({
    activeWorkspaceId: "ws-1",
  }),
  useBubbleUpFlag: () => false,
}));

describe("FlashcardReviewView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listDue.mockResolvedValue([...mockCards]);
    mocks.getStats.mockResolvedValue(mockStats);
    mocks.getConcept.mockResolvedValue(mockConcept);
    mocks.review.mockImplementation((id: string) => {
      const card = mockCards.find((c) => c.id === id) ?? mockCards[0];
      return Promise.resolve({ ...card, repetitions: card.repetitions + 1 });
    });
  });

  it("renders card front with question, progress indicator, and Space key hint", async () => {
    render(<FlashcardReviewView />);

    await waitFor(() => {
      expect(screen.getByText("What is Rust ownership?")).toBeInTheDocument();
    });

    expect(screen.getByText("Card 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Space")).toBeInTheDocument();
    expect(screen.queryByText("Rules governing memory management without a garbage collector.")).not.toBeInTheDocument();
  });

  it("flips card upon Space press and reveals both question and answer with rating buttons", async () => {
    render(<FlashcardReviewView />);

    await waitFor(() => {
      expect(screen.getByText("What is Rust ownership?")).toBeInTheDocument();
    });

    // Press Space to flip
    fireEvent.keyDown(window, { code: "Space" });

    await waitFor(() => {
      // Both question and answer are visible
      expect(screen.getByText("What is Rust ownership?")).toBeInTheDocument();
      expect(screen.getByText("Rules governing memory management without a garbage collector.")).toBeInTheDocument();
    });

    // Rating buttons with keycap numbers 1 through 6
    expect(screen.getByText("Blackout")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.getByText("Perfect")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("rates card and advances to next card when pressing number key 4 (Good)", async () => {
    render(<FlashcardReviewView />);

    await waitFor(() => {
      expect(screen.getByText("What is Rust ownership?")).toBeInTheDocument();
    });

    // Flip card first
    fireEvent.keyDown(window, { code: "Space" });

    await waitFor(() => {
      expect(screen.getByText("Good")).toBeInTheDocument();
    });

    // Press key 4 for "Good" (quality 3)
    fireEvent.keyDown(window, { key: "4" });

    await waitFor(() => {
      expect(mocks.review).toHaveBeenCalledWith("card-1", 3);
    });

    // Advances to card 2
    await waitFor(() => {
      expect(screen.getByText("What is borrowing?")).toBeInTheDocument();
      expect(screen.getByText("Card 2 of 2")).toBeInTheDocument();
    });
  });

  it("displays concept banner and sidebar filter info when conceptId is passed", async () => {
    const onClear = vi.fn();
    render(<FlashcardReviewView conceptId="concept-123" onClearConcept={onClear} />);

    await waitFor(() => {
      expect(mocks.getConcept).toHaveBeenCalledWith("concept-123");
    });

    await waitFor(() => {
      // Concept banner at top
      expect(screen.getByText("Rust Memory Management")).toBeInTheDocument();
      expect(screen.getByText(/2 cards · 124 across workspace/i)).toBeInTheDocument();
    });

    // Clear filter button inside banner
    const clearBtn = screen.getByRole("button", { name: /Review all/i });
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);
    expect(onClear).toHaveBeenCalledTimes(1);

    // Sidebar reconciliation text
    expect(screen.getByText("Ready to review")).toBeInTheDocument();
    expect(screen.queryByText(/due today/i)).not.toBeInTheDocument();
    expect(screen.getByText("Concept: Rust Memory Management")).toBeInTheDocument();
    expect(screen.getByText("Show all 124 workspace cards")).toBeInTheDocument();
  });
});
