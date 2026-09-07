import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import FeedPane from "@/views/FeedPane";
import { api } from "@/lib/api";
import type { FeedCard, FeedDeck } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    feed: {
      load: vi.fn(),
      setSuspended: vi.fn(() => Promise.resolve(undefined)),
      restoreAll: vi.fn(() => Promise.resolve(0)),
      setDifficulty: vi.fn(() => Promise.resolve(undefined)),
      setWorkspacePreset: vi.fn(() => Promise.resolve(undefined)),
    },
  },
}));

function card(overrides: Partial<FeedCard> & { id: string }): FeedCard {
  return {
    workspace_id: "ws-1",
    workspace_name: "Workspace One",
    front: `front-${overrides.id}`,
    back: `back-${overrides.id}`,
    source_type: "manual",
    ease_factor: 2.5,
    interval: 1,
    repetitions: 0,
    next_review_date: "2026-01-01",
    created_at: "2026-01-01T00:00:00Z",
    kind: "flashcard",
    ...overrides,
  } as FeedCard;
}

function deck(cards: FeedCard[]): FeedDeck {
  return {
    workspaces: [
      { id: "ws-1", name: "Workspace One", card_count: cards.length, difficulty_preset: null },
    ],
    cards,
  };
}

const loadMock = vi.mocked(api.feed.load);
const setSuspendedMock = vi.mocked(api.feed.setSuspended);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setSuspendedMock.mockResolvedValue(undefined);
});

describe("FeedPane", () => {
  it("shows an empty state rather than a broken feed when there are no cards", async () => {
    loadMock.mockResolvedValue(deck([]));
    render(<FeedPane workspaceIds={["ws-1"]} />);
    expect(await screen.findByText("No cards yet")).toBeInTheDocument();
  });

  it("renders a card once the deck loads", async () => {
    loadMock.mockResolvedValue(deck([card({ id: "a" })]));
    render(<FeedPane workspaceIds={["ws-1"]} />);
    expect(await screen.findByText("front-a")).toBeInTheDocument();
    expect(screen.getByText("Workspace One")).toBeInTheDocument();
  });

  it("hides a Test answer until it is revealed", async () => {
    loadMock.mockResolvedValue(deck([card({ id: "a" })]));
    render(<FeedPane workspaceIds={["ws-1"]} />);
    await screen.findByText("front-a");
    expect(screen.queryByText("back-a")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: " " });
    expect(await screen.findByText("back-a")).toBeInTheDocument();
  });

  it("shows the explanation immediately in Study mode", async () => {
    loadMock.mockResolvedValue(deck([card({ id: "a", kind: "info" })]));
    render(<FeedPane workspaceIds={["ws-1"]} />);
    await screen.findByText("front-a");

    fireEvent.click(screen.getByRole("button", { name: "Study" }));
    expect(await screen.findByText("back-a")).toBeInTheDocument();
    expect(screen.getByText("Detailed explanation")).toBeInTheDocument();
  });

  it("persists a banish through IPC and drops the card from the feed", async () => {
    loadMock.mockResolvedValue(deck([card({ id: "a" }), card({ id: "b" })]));
    render(<FeedPane workspaceIds={["ws-1"]} />);
    // The feed renders the active card and the next one behind it, so both
    // fronts are in the DOM.
    await screen.findAllByText(/^front-[ab]$/);

    fireEvent.click(screen.getByRole("button", { name: "Banish this card" }));

    await waitFor(() => expect(setSuspendedMock).toHaveBeenCalledTimes(1));
    expect(setSuspendedMock.mock.calls[0][1]).toBe(true);
  });

  it("restores the card locally when the banish write fails", async () => {
    // The feed must not claim a banish the database never recorded.
    loadMock.mockResolvedValue(deck([card({ id: "a" }), card({ id: "b" })]));
    setSuspendedMock.mockRejectedValue(new Error("db is locked"));
    render(<FeedPane workspaceIds={["ws-1"]} />);
    // The feed renders the active card and the next one behind it, so both
    // fronts are in the DOM.
    await screen.findAllByText(/^front-[ab]$/);

    fireEvent.click(screen.getByRole("button", { name: "Banish this card" }));
    expect(await screen.findByText("db is locked")).toBeInTheDocument();
  });

  it("surfaces a load failure instead of spinning forever", async () => {
    loadMock.mockRejectedValue(new Error("no such table"));
    render(<FeedPane workspaceIds={["ws-1"]} />);
    expect(await screen.findByText("no such table")).toBeInTheDocument();
  });

  it("offers only levels the deck actually has cards for", async () => {
    // A fixed 1-5 grid let the user pick levels that yielded an empty feed.
    loadMock.mockResolvedValue(
      deck([card({ id: "a", difficulty: 1 }), card({ id: "b", difficulty: 4 })]),
    );
    render(<FeedPane workspaceIds={["ws-1"]} />);
    // The feed renders the active card and the next one behind it, so both
    // fronts are in the DOM.
    await screen.findAllByText(/^front-[ab]$/);

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    await screen.findByText("Filter feed");

    expect(screen.getByText("L1")).toBeInTheDocument();
    expect(screen.getByText("L4")).toBeInTheDocument();
    expect(screen.queryByText("L2")).not.toBeInTheDocument();
    expect(screen.queryByText("L5")).not.toBeInTheDocument();
  });

  it("does not refetch when the workspace id array is recreated with equal contents", async () => {
    loadMock.mockResolvedValue(deck([card({ id: "a" })]));
    const { rerender } = render(<FeedPane workspaceIds={["ws-1"]} />);
    await screen.findByText("front-a");
    expect(loadMock).toHaveBeenCalledTimes(1);

    rerender(<FeedPane workspaceIds={["ws-1"]} />);
    await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(1));
  });
});
