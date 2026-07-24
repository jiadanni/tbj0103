import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import PracticeView from "@/views/PracticeView";

const mocks = vi.hoisted(() => ({
  listDue: vi.fn(() => Promise.resolve([])),
  getStats: vi.fn(() => Promise.resolve({ due_today: 0, total_cards: 0, learned: 0, avg_ease: 2.5 })),
  listTopics: vi.fn(() => Promise.resolve([
    { id: "t1", workspace_id: "ws-1", topic: "Rust Memory Safety", mastery_score: 0.5, card_count: 3 }
  ])),
  suggestNext: vi.fn(() => Promise.resolve(null)),
  generate: vi.fn(() => Promise.resolve([])),
  generateForTopic: vi.fn(() => Promise.resolve([])),
  createCard: vi.fn(() => Promise.resolve({ id: "c1", front: "Q", back: "A", source_type: "manual" })),
  listModels: vi.fn(() => Promise.resolve([{ model_id: "llama3", enabled: true, priority: 1 }])),
}));

vi.mock("@/lib/api", () => ({
  setIpcWorkspaceContextProvider: vi.fn(),
  api: {
    flashcard: {
      listDue: mocks.listDue,
      getStats: mocks.getStats,
      listTopics: mocks.listTopics,
      suggestNext: mocks.suggestNext,
      generate: mocks.generate,
      generateForTopic: mocks.generateForTopic,
      create: mocks.createCard,
    },
    aiModel: {
      list: mocks.listModels,
    },
    ollama: {
      listModels: vi.fn(() => Promise.resolve([])),
    },
    quiz: {
      list: vi.fn(() => Promise.resolve([])),
    },
  },
}));

vi.mock("@/lib/workspacePane", () => ({
  useScopedWorkspace: () => ({
    activeWorkspaceId: "ws-1",
  }),
  useBubbleUpFlag: () => false,
}));

describe("PracticeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ activeWorkspaceId: "ws-1" });
  });

  it("renders the practice header, tabs, and flashcards sidebar with generate options", async () => {
    render(
      <MemoryRouter initialEntries={["/practice"]}>
        <PracticeView />
      </MemoryRouter>
    );

    expect(screen.getByText("Review and quiz your workspace")).toBeInTheDocument();
    expect(screen.getByText("Review flashcards")).toBeInTheDocument();
    expect(screen.getByText("Take a quiz")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Rust Memory Safety")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Generate Flashcards" })).toBeInTheDocument();
  });

  it("opens the Generate Flashcards modal when clicking the generate button", async () => {
    render(
      <MemoryRouter initialEntries={["/practice"]}>
        <PracticeView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Rust Memory Safety")).toBeInTheDocument();
    });

    const generateBtn = screen.getByRole("button", { name: "Generate Flashcards" });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(screen.getByText("Generate Flashcards with AI")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Memory safety in Rust/i);
    fireEvent.change(input, { target: { value: "Concurrency in Rust" } });

    const submitBtn = screen.getByRole("button", { name: "Generate Cards" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mocks.generate).toHaveBeenCalledWith("ws-1", "Concurrency in Rust", "llama3", 5, "http://localhost:11434");
    });
  });
});
