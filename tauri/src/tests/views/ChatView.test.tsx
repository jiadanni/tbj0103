import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { api } from "@/lib/api";
import ChatView from "@/views/ChatView";

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
  confirm: vi.fn(() => Promise.resolve(false)),
  ask: vi.fn(() => Promise.resolve(false)),
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
      get: vi.fn(() => Promise.resolve(null)),
    },
    chat: {
      listSessions: vi.fn((workspaceId: string, projectId: string | null) => Promise.resolve(
        workspaceId === "ws-1" && projectId === null
          ? [{
              id: "session-1",
              title: "Test Session",
              project_id: null,
              workspace_id: "ws-1",
              created_at: "",
              updated_at: "",
              is_pinned: false,
              message_count_at_title_gen: 0,
            }]
          : [],
      )),
      searchSessions: vi.fn(() => Promise.resolve([])),
      getMessages: vi.fn(() => Promise.resolve([])),
      moveSessions: vi.fn(() => Promise.resolve(undefined)),
      createSession: vi.fn(),
      addMessage: vi.fn(),
      updateSession: vi.fn(() => Promise.resolve(undefined)),
      deleteSession: vi.fn(() => Promise.resolve(undefined)),
    },
    project: {
      list: vi.fn(() => Promise.resolve([])),
      create: vi.fn(),
      update: vi.fn(() => Promise.resolve(undefined)),
      delete: vi.fn(() => Promise.resolve(undefined)),
    },
    chatFile: {
      exportAsJson: vi.fn(),
      reveal: vi.fn(() => Promise.resolve(undefined)),
    },
    settings: {
      get: vi.fn(() => Promise.resolve({
        preferred_model: "test-model",
        web_session_preserve: false,
        chat_title_auto_refresh: "disabled",
      })),
      update: vi.fn(() => Promise.resolve(undefined)),
    },
    document: {
      list: vi.fn(() => Promise.resolve([])),
    },
    topicSignature: {
      get: vi.fn(() => Promise.resolve(null)),
      checkMatch: vi.fn(() => Promise.resolve({ is_match: true, suggestion: null })),
    },
    thoughtQueue: {
      list: vi.fn(() => Promise.resolve([])),
      getDue: vi.fn(() => Promise.resolve([])),
      create: vi.fn(),
      updateStatus: vi.fn(() => Promise.resolve(undefined)),
      updateResult: vi.fn(() => Promise.resolve(undefined)),
      delete: vi.fn(() => Promise.resolve(undefined)),
    },
    context: {
      listenContextSources: vi.fn(() => Promise.resolve(() => {})),
    },
    aiModel: {
      list: vi.fn(() => Promise.resolve([
        { model_id: "test-model", name: "Test Model", provider: "ollama", enabled: true, priority: 1 },
      ])),
      recordTokenUsage: vi.fn(() => Promise.resolve(undefined)),
    },
    ollama: {
      listModelsFresh: vi.fn(() => Promise.resolve([{ name: "test-model" }])),
      listModels: vi.fn(() => Promise.resolve([{ name: "test-model" }])),
      generateTitle: vi.fn(),
      generateTitleFromConversation: vi.fn(),
      generateFollowUps: vi.fn(() => Promise.resolve([])),
      sendMessage: vi.fn(),
      sendDualModelMessage: vi.fn(),
      stopStream: vi.fn(() => Promise.resolve(undefined)),
    },
    flashcard: {
      extractFromContent: vi.fn(() => Promise.resolve([])),
    },
    search: {
      keyword: vi.fn(() => Promise.resolve([])),
    },
    webAI: {
      sendMessage: vi.fn(),
      stopStream: vi.fn(() => Promise.resolve(undefined)),
    },
    llamacpp: {
      sendMessage: vi.fn(),
      stopStream: vi.fn(() => Promise.resolve(undefined)),
    },
    mlx: {
      sendMessage: vi.fn(),
    },
    listenStream: vi.fn(() => Promise.resolve(() => {})),
  },
}));

const setActiveChatId = vi.fn();
const setActiveProjectId = vi.fn();

vi.mock("@/lib/workspacePane", () => ({
  useScopedChat: () => ({ activeChat: null, activeChatId: null, setActiveChatId }),
  useScopedProjects: () => [],
  useScopedWorkspace: () => ({
    activeWorkspaceId: "ws-1",
    activeProjectId: null,
    setActiveProjectId,
    workspace: null,
  }),
  useWorkspacePane: () => null,
}));

function renderChatView() {
  return render(
    <MemoryRouter>
      <ChatView />
    </MemoryRouter>,
  );
}

async function openCreateWorkspaceInput() {
  fireEvent.contextMenu(await screen.findByText("Test Session"));
  fireEvent.click(await screen.findByText("Move to"));
  fireEvent.click(await screen.findByText(/Create workspace\.\.\./i));

  return screen.findByPlaceholderText("Workspace name");
}

describe("ChatView", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useWorkspaceStore.setState({
      workspaces: [
        {
          id: "ws-1",
          name: "Default Workspace",
          created_at: "",
          updated_at: "",
          is_hidden: false,
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
        },
      ],
      activeWorkspaceId: "ws-1",
      projects: [],
      projectsByWorkspace: {},
      activeProjectId: null,
      activeTopicSignature: null,
      migrationSuggestion: null,
    });

    useChatStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Test Session",
          model_name: "test-model",
          system_prompt: "",
          project_id: "",
          workspace_id: "ws-1",
          created_at: "",
          updated_at: "",
          is_incognito: false,
          exclude_from_analytics: false,
          is_pinned: false,
          is_deleted: false,
          message_count_at_title_gen: 0,
        },
      ],
      messages: {},
      activeChatId: null,
      streamingContent: "",
      streamingSessionId: null,
    });

    useSettingsStore.setState({
      sidebarWidth: 260,
      preferredModel: "test-model",
      ollamaUrl: "",
      autoGenerateFlashcards: false,
      dualModelExecutionMode: "serial",
      scrollToTopOnSend: false,
    });

    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.spyOn(window, "setTimeout").mockImplementation(((callback: TimerHandler) => {
      if (typeof callback === "function") {
        callback();
      }
      return 0 as ReturnType<typeof setTimeout>;
    }) as typeof window.setTimeout);
    vi.spyOn(window, "clearTimeout").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  it("does not create a workspace when the inline name is empty", async () => {
    renderChatView();

    const input = await openCreateWorkspaceInput();
    const form = input.closest("form");
    expect(form).not.toBeNull();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(form as HTMLFormElement);

    expect(api.workspace.create).not.toHaveBeenCalled();
  });

  it("trims the inline workspace name before creating it", async () => {
    (api.workspace.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-new",
      name: "New Workspace",
    });

    renderChatView();

    const input = await openCreateWorkspaceInput();
    const form = input.closest("form");
    expect(form).not.toBeNull();
    fireEvent.change(input, { target: { value: "  New Workspace  " } });
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(api.workspace.create).toHaveBeenCalledWith("New Workspace");
    });
  });

  it("keeps the new workspace input open when creation fails", async () => {
    (api.workspace.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));

    renderChatView();

    const input = await openCreateWorkspaceInput();
    const form = input.closest("form");
    expect(form).not.toBeNull();
    fireEvent.change(input, { target: { value: "New Workspace" } });
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(api.workspace.create).toHaveBeenCalledWith("New Workspace");
    });

    expect(await screen.findByPlaceholderText("Workspace name")).toBeInTheDocument();
  });

  it("keeps a fixed trailing slot on session rows so hover actions do not collapse the title", async () => {
    renderChatView();

    const title = await screen.findByText("Test Session");
    const row = title.closest("div.group");

    expect(row).not.toBeNull();
    expect(
      Array.from(row?.querySelectorAll("div") ?? []).some((element) => element.className.includes("w-[92px]"))
    ).toBe(true);
  });
});
