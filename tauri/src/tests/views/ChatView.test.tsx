import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { api } from "@/lib/api";
import ChatView from "@/views/ChatView";
import { resolveModelDisplayName } from "@/lib/modelDisplayName";
import type { ChatSession } from "@/stores/chatStore";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

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
  Paperclip: () => <div data-testid="icon-paperclip" />,
  Image: () => <div data-testid="icon-image" />,
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
  Copy: () => <div data-testid="icon-copy" />,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(false)),
  ask: vi.fn(() => Promise.resolve(false)),
  message: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
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
      touchSessionAccessed: vi.fn(() => Promise.resolve(undefined)),
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
    source: {
      create: vi.fn(),
      process: vi.fn(() => Promise.resolve(1)),
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
        { model_id: "test-model", name: "Test Model", provider: "ollama", enabled: true, priority: 1, role_tags: ["chat"] },
      ])),
      recordTokenUsage: vi.fn(() => Promise.resolve(undefined)),
    },
    ollama: {
      listModelsFresh: vi.fn(() => Promise.resolve([{ name: "test-model" }])),
      listModels: vi.fn(() => Promise.resolve([{ name: "test-model" }])),
      generateTitle: vi.fn(),
      generateTitleFromConversation: vi.fn(),
      polishPrompt: vi.fn(),
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
let mockWorkspacePane: Record<string, unknown> | null = null;
let mockActiveChatId: string | null = null;

vi.mock("@/lib/workspacePane", () => ({
  useScopedChat: () => ({ activeChat: mockActiveChatId, activeChatId: mockActiveChatId, setActiveChatId }),
  useScopedProjects: () => [],
  useScopedWorkspace: () => ({
    activeWorkspaceId: "ws-1",
    activeProjectId: null,
    setActiveProjectId,
    workspace: null,
  }),
  useWorkspacePane: () => mockWorkspacePane,
}));

function renderChatView(initialEntries?: Array<string | { pathname: string; state?: unknown }>) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ChatView />
    </MemoryRouter>,
  );
}

async function flushMicrotasks(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
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
    mockWorkspacePane = null;
    mockActiveChatId = null;

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
          parent_workspace_id: null,
          icon: "",
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
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    Object.assign(window.navigator, {
      clipboard: {
        writeText: vi.fn(() => Promise.resolve()),
      },
    });
  });

  it.skip("does not create a workspace when the inline name is empty", async () => {
    renderChatView();

    const input = await openCreateWorkspaceInput();
    const form = input.closest("form");
    expect(form).not.toBeNull();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(form as HTMLFormElement);

    expect(api.workspace.create).not.toHaveBeenCalled();
  });

  it.skip("trims the inline workspace name before creating it", async () => {
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

  it.skip("keeps the new workspace input open when creation fails", async () => {
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

  it("prevents selecting chat titles in the sidebar session list", async () => {
    renderChatView();

    const title = await screen.findByText("Test Session");
    const row = title.closest("div.group");

    expect(row).not.toBeNull();
    expect(row?.className).toContain("select-none");
  });

  it("copies the chat name from the sidebar session menu", async () => {
    renderChatView();

    fireEvent.contextMenu(await screen.findByText("Test Session"));
    fireEvent.click(await screen.findByText("Copy chat name"));

    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith("Test Session");
  });

  it("uses a narrower sidebar and tighter trailing slot in split panes", async () => {
    mockWorkspacePane = { paneId: "primary" };

    renderChatView();

    const sidebar = await screen.findByText("Chats");
    const sidebarRoot = sidebar.closest("div[style]");
    expect(sidebarRoot?.getAttribute("style")).toContain("248px");

    const title = await screen.findByText("Test Session");
    const row = title.closest("div.group");

    expect(row).not.toBeNull();
    expect(
      Array.from(row?.querySelectorAll("div") ?? []).some((element) => element.className.includes("w-[42px]"))
    ).toBe(true);

    const searchInput = screen.getByPlaceholderText("Search…");
    expect(searchInput.className).toContain("min-w-0");
  });

  it("reuses the same pending empty chat when new chat is clicked repeatedly", async () => {
    (api.chat.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.chat.createSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "session-new",
      title: "New Chat",
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
    } satisfies ChatSession);

    renderChatView();

    const newChatButton = await screen.findByRole("button", { name: /start a new chat/i });
    fireEvent.click(newChatButton);
    fireEvent.click(newChatButton);
    fireEvent.click(newChatButton);

    await waitFor(() => {
      expect(api.chat.createSession).toHaveBeenCalledTimes(1);
      expect(setActiveChatId).toHaveBeenCalledWith("session-new");
    });
  });

  it("starts an incognito chat from the empty-state dropdown", async () => {
    (api.chat.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.chat.createSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "session-incognito",
      title: "New Chat",
      model_name: "test-model",
      system_prompt: "",
      project_id: "",
      workspace_id: "ws-1",
      created_at: "",
      updated_at: "",
      is_incognito: true,
      exclude_from_analytics: false,
      is_pinned: false,
      is_deleted: false,
      message_count_at_title_gen: 0,
    } satisfies ChatSession);

    renderChatView();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /choose new chat privacy mode/i }));
      await flushMicrotasks(1);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /incognito/i }));
      await flushMicrotasks();
    });

    expect(api.chat.createSession).toHaveBeenCalledWith("ws-1", null, {
      modelName: "test-model",
      is_incognito: true,
      exclude_from_analytics: false,
    });
    expect(setActiveChatId).toHaveBeenCalledWith("session-incognito");
  });

  it("does not reuse a standard empty chat when incognito is requested", async () => {
    (api.chat.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "session-empty-standard",
        title: "New Chat",
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
    ]);
    (api.chat.createSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "session-empty-incognito",
      title: "New Chat",
      model_name: "test-model",
      system_prompt: "",
      project_id: "",
      workspace_id: "ws-1",
      created_at: "",
      updated_at: "",
      is_incognito: true,
      exclude_from_analytics: false,
      is_pinned: false,
      is_deleted: false,
      message_count_at_title_gen: 0,
    } satisfies ChatSession);

    renderChatView();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /choose new chat privacy mode/i }));
      await flushMicrotasks(1);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /incognito/i }));
      await flushMicrotasks();
    });

    expect(api.chat.createSession).toHaveBeenCalledTimes(1);
    expect(setActiveChatId).toHaveBeenCalledWith("session-empty-incognito");
    expect(setActiveChatId).not.toHaveBeenCalledWith("session-empty-standard");
  });

  it("shows the active model label in the composer", () => {
    mockActiveChatId = "session-1";
    useSettingsStore.setState({
      modelLabels: {
        "test-model": "Test Model",
      },
    });
    renderChatView();

    expect(screen.getByRole("button", { name: "Active model: Test Model" })).toBeInTheDocument();
  });

  it("shows the full Ollama model id when the stored label is only the base model name", () => {
    expect(resolveModelDisplayName(
      "gemma4:latest",
      { "gemma4:latest": "gemma4" },
      [{ model_id: "gemma4:latest", name: "gemma4", provider: "ollama", enabled: true, priority: 1 } as never],
    )).toBe("gemma4:latest");
  });

  it("attaches files into the composer as draft sources", async () => {
    mockActiveChatId = "session-1";
    (openDialog as ReturnType<typeof vi.fn>).mockResolvedValue(["/tmp/notes.md"]);
    (readTextFile as ReturnType<typeof vi.fn>).mockResolvedValue("# Notes\n\nAttachment content");
    (api.source.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "source-1",
      workspace_id: "ws-1",
      source_type: "document",
      title: "notes.md",
      filename: "notes.md",
      file_type: "md",
      file_size: 27,
      content: "# Notes\n\nAttachment content",
      is_processed: false,
      created_at: "",
      updated_at: "",
    });

    renderChatView();

    fireEvent.click(screen.getByRole("button", { name: /open attachment menu/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /attach file/i }));

    await waitFor(() => {
      expect(api.source.create).toHaveBeenCalledWith({
        workspace_id: "ws-1",
        source_type: "document",
        title: "notes.md",
        filename: "notes.md",
        file_type: "md",
        file_size: 27,
        content: "# Notes\n\nAttachment content",
      });
      expect(screen.getByText("notes.md")).toBeInTheDocument();
    });

    expect(api.source.process).toHaveBeenCalledWith("source-1");
  });

  it("shows attach image only for vision-tagged models", async () => {
    mockActiveChatId = "session-1";
    (api.aiModel.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { model_id: "test-model", name: "Test Model", provider: "ollama", enabled: true, priority: 1, role_tags: ["chat", "vision"] },
    ]);

    renderChatView();

    fireEvent.click(screen.getByRole("button", { name: /open attachment menu/i }));

    expect(await screen.findByRole("menuitem", { name: /attach image/i })).toBeInTheDocument();
  });

  it("polishes the composer prompt in place and allows undo", async () => {
    (api.ollama.polishPrompt as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Write a concise summary of this Rust error and explain the root cause."
    );
    mockActiveChatId = "session-1";

    renderChatView();

    const composer = await screen.findByPlaceholderText("Start a new thread…");
    fireEvent.change(composer, {
      target: { value: "summarize this rust error and why it happens" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Polish prompt" }));

    await waitFor(() => {
      expect(api.ollama.polishPrompt).toHaveBeenCalledWith(
        "test-model",
        "summarize this rust error and why it happens",
        ""
      );
      expect(composer).toHaveValue(
        "Write a concise summary of this Rust error and explain the root cause."
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Undo prompt polish" }));

    expect(composer).toHaveValue("summarize this rust error and why it happens");
  });

  it("focuses an existing empty chat instead of creating another one", async () => {
    (api.chat.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "session-empty",
        title: "New Chat",
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
    ]);

    renderChatView();

    const newChatButton = await screen.findByRole("button", { name: /start a new chat/i });
    fireEvent.click(newChatButton);

    await waitFor(() => {
      expect(setActiveChatId).toHaveBeenCalledWith("session-empty");
    });
    expect(api.chat.createSession).not.toHaveBeenCalled();
  });

  it("creates a new chat when routed in with a pending new-chat action", async () => {
    (api.chat.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.chat.createSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "session-from-route",
      title: "New Chat",
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
    } satisfies ChatSession);

    renderChatView([{ pathname: "/chat", state: { createNewChat: true } }]);

    await waitFor(() => {
      expect(api.chat.createSession).toHaveBeenCalledTimes(1);
      expect(setActiveChatId).toHaveBeenCalledWith("session-from-route");
    });
  });
});
