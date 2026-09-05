import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DashboardOmnibox from "@/components/DashboardOmnibox";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getContext: vi.fn(() => Promise.resolve({ preferred_workspace_id: null })),
  getAdvanced: vi.fn(() => Promise.resolve({
    quick_search_workspace_scope: null,
    quick_search_type_filters: null,
  })),
  updateOne: vi.fn(() => Promise.resolve()),
  listWorkspaces: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/lib/api", () => ({
  api: {
    quickSearch: { query: mocks.query, getContext: mocks.getContext },
    settings: { getAdvanced: mocks.getAdvanced, updateOne: mocks.updateOne },
    workspace: { list: mocks.listWorkspaces },
  },
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderOmnibox() {
  return render(<MemoryRouter><DashboardOmnibox /></MemoryRouter>);
}

describe("DashboardOmnibox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue([
      {
        kind: "conversation",
        target_id: "session-9",
        session_id: "session-9",
        title: "rsync Size Comparison Quick",
        subtitle: "Chat",
        workspace_id: "ws-1",
        workspace_name: "Bash",
        folder_name: null,
        recent: false,
      },
    ]);
  });

  it("searches existing content as you type instead of only starting a chat", async () => {
    renderOmnibox();

    fireEvent.change(screen.getByPlaceholderText("Search or ask anything..."), {
      target: { value: "rsync" },
    });

    await waitFor(() => {
      expect(mocks.query).toHaveBeenCalledWith("rsync", expect.objectContaining({ limit: 8 }));
    });

    const hit = await screen.findByText("rsync Size Comparison Quick");
    fireEvent.click(hit);

    // Opening a result routes to the existing chat -- it must not spawn a new one.
    expect(mockNavigate).toHaveBeenCalledWith("/chat/session-9");
    expect(mockNavigate).not.toHaveBeenCalledWith("/chat", expect.anything());
  });

  it("still starts a new chat via the ask row, preserving the previous behaviour", async () => {
    renderOmnibox();

    fireEvent.change(screen.getByPlaceholderText("Search or ask anything..."), {
      target: { value: "how does rsync delta encoding work" },
    });

    const askRow = await screen.findByText(/Ask a new chat:/);
    fireEvent.click(askRow);

    expect(mockNavigate).toHaveBeenCalledWith("/chat", {
      state: { createNewChat: true, searchQuery: "how does rsync delta encoding work" },
    });
  });

  it("opens the highlighted result on Enter, and falls back to asking when none is highlighted", async () => {
    renderOmnibox();

    const input = screen.getByPlaceholderText("Search or ask anything...");
    fireEvent.change(input, { target: { value: "rsync" } });
    await screen.findByText("rsync Size Comparison Quick");

    // First result is highlighted by default.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockNavigate).toHaveBeenCalledWith("/chat/session-9");

    mockNavigate.mockClear();

    // Arrow past the last result to land on the ask row.
    fireEvent.change(input, { target: { value: "rsync" } });
    await screen.findByText("rsync Size Comparison Quick");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockNavigate).toHaveBeenCalledWith("/chat", {
      state: { createNewChat: true, searchQuery: "rsync" },
    });
  });
});
