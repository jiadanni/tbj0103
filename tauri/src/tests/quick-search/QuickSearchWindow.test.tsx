import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import QuickSearchWindow from "@/quick-search/QuickSearchWindow";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  listWorkspaces: vi.fn(),
  query: vi.fn(),
  hide: vi.fn(),
  openResult: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    settings: {
      get: mocks.getSettings,
      update: mocks.updateSettings,
    },
    workspace: {
      list: mocks.listWorkspaces,
    },
    quickSearch: {
      query: mocks.query,
      hide: mocks.hide,
      openResult: mocks.openResult,
      getContext: vi.fn().mockResolvedValue({ preferred_workspace_id: null }),
    },
  },
}));

describe("QuickSearchWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const settings = {
      theme: "system",
      accent_color: "#007AFF",
      font_size: 16,
      quick_search_workspace_scope: "__all__",
      quick_search_type_filters: ["conversation", "message", "artifact", "memory", "summary"],
    };
    mocks.getSettings.mockImplementation(async () => settings);
    mocks.updateSettings.mockImplementation(async (nextSettings) => {
      Object.assign(settings, nextSettings);
    });
    mocks.listWorkspaces.mockResolvedValue([
      {
        id: "ws-1",
        name: "Design",
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
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
        parent_workspace_id: null,
        icon: "",
      },
      {
        id: "ws-2",
        name: "Engineering",
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
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
        parent_workspace_id: null,
        icon: "",
      },
    ]);
    mocks.query.mockResolvedValue([]);
    mocks.hide.mockResolvedValue(undefined);
    mocks.openResult.mockResolvedValue(undefined);
  });

  it("defaults to all workspaces and persists workspace/type filters from the cog", async () => {
    render(<QuickSearchWindow />);

    const searchInput = await screen.findByPlaceholderText("Search conversations, artifacts, and memory…");

    await waitFor(() => {
      expect(mocks.query).toHaveBeenCalledWith("", {
        limit: 10,
        workspaceId: null,
        kindFilters: null,
        includeDescendants: false,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Search filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Engineering" }));

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
        quick_search_workspace_scope: "ws-2",
      }));
      expect(mocks.query).toHaveBeenLastCalledWith("", {
        limit: 10,
        workspaceId: "ws-2",
        kindFilters: null,
        includeDescendants: true,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Summaries" }));
    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
        quick_search_type_filters: ["conversation", "message", "artifact", "memory"],
      }));
      expect(mocks.query).toHaveBeenLastCalledWith("", {
        limit: 10,
        workspaceId: "ws-2",
        kindFilters: ["conversation", "message", "artifact", "memory"],
        includeDescendants: true,
      });
    });

    fireEvent.change(searchInput, { target: { value: "rust" } });
    await waitFor(() => {
      expect(mocks.query).toHaveBeenLastCalledWith("rust", {
        limit: 24,
        workspaceId: "ws-2",
        kindFilters: ["conversation", "message", "artifact", "memory"],
        includeDescendants: true,
      });
    });

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(searchInput).toHaveValue("");
      expect(mocks.query).toHaveBeenLastCalledWith("", {
        limit: 10,
        workspaceId: "ws-2",
        kindFilters: ["conversation", "message", "artifact", "memory"],
        includeDescendants: true,
      });
    });
  });
});
