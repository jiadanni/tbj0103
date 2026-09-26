import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import HistoryView from "../../views/HistoryView";
import { api } from "../../lib/api";
import { useWorkspaceStore } from "../../stores/workspaceStore";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("../../lib/api", () => ({
  api: {
    chat: {
      listHistorySessions: vi.fn(),
      deleteSession: vi.fn(),
    },
  },
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: unknown) => React.ReactNode }) => (
    <div data-testid="virtuoso-container">
      {data.map((item, index) => (
        <div key={index}>{itemContent(index, item)}</div>
      ))}
    </div>
  ),
}));

describe("HistoryView", () => {
  const mockWorkspaces = [
    {
      id: "ws-1",
      name: "Personal Workspace",
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
      created_at: "",
      updated_at: "",
      parent_workspace_id: null,
      icon: "folder",
      order_index: 0,
      last_message_at: null,
      survey_data: null,
    },
    {
      id: "ws-2",
      name: "Unassigned Imports",
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
      created_at: "",
      updated_at: "",
      parent_workspace_id: null,
      icon: "folder",
      order_index: 1,
      last_message_at: null,
      survey_data: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      workspaces: mockWorkspaces,
      activeWorkspaceId: "ws-1",
      activeFolderId: null,
      splitMode: false,
    });

    const localSession = {
      id: "session-local-1",
      workspace_id: "ws-1",
      folder_id: "",
      title: "Local Chat 1",
      model_name: "llama3",
      system_prompt: "",
      is_pinned: false,
      is_incognito: false,
      exclude_from_analytics: false,
      is_deleted: false,
      is_imported: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const importedSession = {
      id: "session-imported-1",
      workspace_id: "ws-2",
      folder_id: "folder-claude",
      title: "Imported Claude Conversation",
      model_name: "claude",
      system_prompt: "",
      is_pinned: true,
      is_incognito: false,
      exclude_from_analytics: false,
      is_deleted: false,
      is_imported: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    // Mirrors the backend: workspace + filter are applied by the query, not the view.
    vi.mocked(api.chat.listHistorySessions).mockImplementation(({ workspaceId, filter }) =>
      Promise.resolve(
        [localSession, importedSession].filter((session) =>
          (!workspaceId || session.workspace_id === workspaceId)
          && (filter !== "imported" || session.is_imported)
          && (filter !== "pinned" || session.is_pinned)),
      ),
    );
  });

  it("lists chats across all workspaces and displays workspace badges", async () => {
    render(<HistoryView />);

    await waitFor(() => {
      expect(screen.getByText("Local Chat 1")).toBeInTheDocument();
      expect(screen.getByText("Imported Claude Conversation")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Personal Workspace").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Unassigned Imports").length).toBeGreaterThanOrEqual(2);
  });

  it("filters to imported chats and shows imported badge", async () => {
    render(<HistoryView />);

    await waitFor(() => {
      expect(screen.getByText("Local Chat 1")).toBeInTheDocument();
    });

    const importedTab = screen.getByRole("button", { name: /Imported/i });
    fireEvent.click(importedTab);

    await waitFor(() => {
      expect(screen.queryByText("Local Chat 1")).not.toBeInTheDocument();
      expect(screen.getByText("Imported Claude Conversation")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Imported").length).toBeGreaterThanOrEqual(2);
    expect(api.chat.listHistorySessions).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: null, filter: "imported" }),
    );
  });

  it("switches workspace and navigates when clicking a chat from another workspace", async () => {
    render(<HistoryView />);

    await waitFor(() => {
      expect(screen.getByText("Imported Claude Conversation")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Imported Claude Conversation"));

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
    expect(useWorkspaceStore.getState().activeFolderId).toBe("folder-claude");
    expect(mockNavigate).toHaveBeenCalledWith("/chat/session-imported-1");
  });

  it("opens a chat from another workspace in the active pane in split mode", async () => {
    const { panes } = useWorkspaceStore.getState();
    useWorkspaceStore.setState({
      splitMode: true,
      activePaneId: "secondary",
      panes: {
        primary: { ...panes.primary, workspaceId: "ws-1" },
        secondary: { ...panes.secondary, workspaceId: "ws-1", view: "notes" },
      },
    });

    render(<HistoryView />);

    await waitFor(() => {
      expect(screen.getByText("Imported Claude Conversation")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Imported Claude Conversation"));

    const state = useWorkspaceStore.getState();
    expect(state.panes.secondary.workspaceId).toBe("ws-2");
    expect(state.panes.secondary.folderId).toBe("folder-claude");
    expect(state.panes.secondary.view).toBe("chat");
    expect(state.panes.secondary.chatSessionId).toBe("session-imported-1");
    // The primary pane and window-level selection are untouched.
    expect(state.panes.primary.workspaceId).toBe("ws-1");
    expect(state.activeWorkspaceId).toBe("ws-1");
  });
});
