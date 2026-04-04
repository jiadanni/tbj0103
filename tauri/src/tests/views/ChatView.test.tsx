import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { api } from "@/lib/api";
import ChatView from "@/views/ChatView";

// Mock Lucide icons
vi.mock("lucide-react", () => ({
  Send: () => <div data-testid="icon-send" />,
  Plus: () => <div data-testid="icon-plus" />,
  Trash2: () => <div data-testid="icon-trash" />,
  ChevronDown: () => <div data-testid="icon-chevron-down" />,
  ChevronRight: () => <div data-testid="icon-chevron-right" />,
  ArrowLeft: () => <div data-testid="icon-arrow-left" />,
  ArrowUpCircle: () => <div data-testid="icon-arrow-up-circle" />,
  Pencil: () => <div data-testid="icon-pencil" />,
  Check: () => <div data-testid="icon-check" />,
  Search: () => <div data-testid="icon-search" />,
  Pin: () => <div data-testid="icon-pin" />,
  PinOff: () => <div data-testid="icon-pin-off" />,
  MessageSquare: () => <div data-testid="icon-message-square" />,
  SplitSquareHorizontal: () => <div data-testid="icon-split-square-horizontal" />,
  RefreshCw: () => <div data-testid="icon-refresh-cw" />,
  BookOpen: () => <div data-testid="icon-book-open" />,
  FileText: () => <div data-testid="icon-file-text" />,
  ChevronUp: () => <div data-testid="icon-chevron-up" />,
  Zap: () => <div data-testid="icon-zap" />,
  Inbox: () => <div data-testid="icon-inbox" />,
  Clock: () => <div data-testid="icon-clock" />,
  CheckCircle2: () => <div data-testid="icon-check-circle" />,
  Loader2: () => <div data-testid="icon-loader" />,
  X: () => <div data-testid="icon-x" />,
  Globe: () => <div data-testid="icon-globe" />,
  Folder: () => <div data-testid="icon-folder" />,
  FolderPlus: () => <div data-testid="icon-folder-plus" />,
  Ghost: () => <div data-testid="icon-ghost" />,
  Shield: () => <div data-testid="icon-shield" />,
  Save: () => <div data-testid="icon-save" />,
  MoreHorizontal: () => <div data-testid="icon-more-horizontal" />,
  MoveRight: () => <div data-testid="icon-move-right" />,
  ExternalLink: () => <div data-testid="icon-external-link" />,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  confirm: vi.fn(),
  ask: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    workspace: {
      create: vi.fn(),
      list: vi.fn(() => Promise.resolve([])),
      get: vi.fn(),
    },
    chat: {
      listSessions: vi.fn(() => Promise.resolve([])),
      getMessages: vi.fn(() => Promise.resolve([])),
      moveSessions: vi.fn(),
    },
    project: {
      list: vi.fn(() => Promise.resolve([])),
      delete: vi.fn(),
    },
    chatFile: {
      exportAsJson: vi.fn(),
    }
  },
}));

vi.mock("@/lib/workspacePane", () => ({
  useScopedChat: () => ({ activeChat: null, activeChatId: null, setActiveChatId: vi.fn() }),
  useScopedProjects: () => ({ projects: [], refreshProjectTree: vi.fn() }),
  useScopedWorkspace: () => ({ activeWorkspaceId: "ws-1", workspace: null }),
  useWorkspacePane: () => null,
}));

describe("ChatView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Default Workspace", created_at: "", updated_at: "", is_hidden: false, description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null }
      ],
      activeWorkspaceId: "ws-1",
      projects: [],
      projectsByWorkspace: {},
    });
    useChatStore.setState({
      sessions: [
        { id: "session-1", title: "Test Session", project_id: null, workspace_id: "ws-1", created_at: "", updated_at: "", is_pinned: false, message_count_at_title_gen: 0 }
      ],
      messages: {},
      activeChatId: null,
    });
    useSettingsStore.setState({
      sidebarWidth: 260,
    });
  });

  it("validates empty workspace name when creating from move submenu", async () => {
    render(
      <MemoryRouter>
        <ChatView />
      </MemoryRouter>
    );

    // Open context menu for the session
    const sessionItem = screen.getByText("Test Session");
    fireEvent.contextMenu(sessionItem);

    // Click "Move to"
    const moveToButton = screen.getByText("Move to");
    fireEvent.mouseEnter(moveToButton);

    // Click "Create workspace..."
    const createWorkspaceButton = screen.getByText(/Create workspace\.\.\./i);

    // Mock window.prompt to return an empty string
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue("");

    fireEvent.click(createWorkspaceButton);

    expect(promptSpy).toHaveBeenCalledWith("New workspace name");

    // Verify api.workspace.create was NOT called
    expect(api.workspace.create).not.toHaveBeenCalled();

    promptSpy.mockRestore();
  });

  it("validates whitespace-only workspace name when creating from move submenu", async () => {
    render(
      <MemoryRouter>
        <ChatView />
      </MemoryRouter>
    );

    // Open context menu for the session
    const sessionItem = screen.getByText("Test Session");
    fireEvent.contextMenu(sessionItem);

    // Click "Move to"
    const moveToButton = screen.getByText("Move to");
    fireEvent.mouseEnter(moveToButton);

    // Click "Create workspace..."
    const createWorkspaceButton = screen.getByText(/Create workspace\.\.\./i);

    // Mock window.prompt to return whitespace
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue("   ");

    fireEvent.click(createWorkspaceButton);

    expect(promptSpy).toHaveBeenCalledWith("New workspace name");

    // Verify api.workspace.create was NOT called
    expect(api.workspace.create).not.toHaveBeenCalled();

    promptSpy.mockRestore();
  });

  it("calls api.workspace.create when a valid name is provided", async () => {
     render(
      <MemoryRouter>
        <ChatView />
      </MemoryRouter>
    );

    // Open context menu for the session
    const sessionItem = screen.getByText("Test Session");
    fireEvent.contextMenu(sessionItem);

    // Click "Move to"
    const moveToButton = screen.getByText("Move to");
    fireEvent.mouseEnter(moveToButton);

    // Click "Create workspace..."
    const createWorkspaceButton = screen.getByText(/Create workspace\.\.\./i);

    // Mock window.prompt to return a valid name
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue("New Workspace");
    const mockWorkspace = { id: "ws-new", name: "New Workspace" };
    (api.workspace.create as any).mockResolvedValue(mockWorkspace);

    fireEvent.click(createWorkspaceButton);

    expect(promptSpy).toHaveBeenCalledWith("New workspace name");

    await waitFor(() => {
      expect(api.workspace.create).toHaveBeenCalledWith("New Workspace");
    });

    promptSpy.mockRestore();
  });
});
