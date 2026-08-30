import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { api } from "@/lib/api";
import ChatView from "@/views/ChatView";
import { __resetWorkspacePromptsDedup } from "@/views/chatViewDedup";
import { resolveModelDisplayName } from "@/lib/modelDisplayName";
import type { ChatSession, Message } from "@/stores/chatStore";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

vi.mock("react-virtuoso", async () => {
  const React = await import("react");

  type VirtuosoProps<T> = {
    className?: string;
    data?: T[];
    itemContent?: (index: number, item: T) => React.ReactNode;
    scrollerRef?: (element: HTMLDivElement | null) => void;
  };

  const Virtuoso = React.forwardRef<{ scrollToIndex: () => void }, VirtuosoProps<unknown>>(
    ({ className, data = [], itemContent, scrollerRef }, ref) => {
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: () => undefined,
      }));

      return (
        <div
          className={className}
          ref={(element) => {
            scrollerRef?.(element);
          }}
        >
          {data.map((item, index) => (
            <React.Fragment key={index}>
              {itemContent?.(index, item)}
            </React.Fragment>
          ))}
        </div>
      );
    },
  );
  Virtuoso.displayName = "Virtuoso";

  return {
    Virtuoso,
  };
});

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
  RotateCcw: () => <div data-testid="icon-rotate-ccw" />,
  ExternalLink: () => <div data-testid="icon-external-link" />,
  Copy: () => <div data-testid="icon-copy" />,
  Download: () => <div data-testid="icon-download" />,
  Code2: () => <div data-testid="icon-code-2" />,
  BarChart2: () => <div data-testid="icon-bar-chart-2" />,
  Info: () => <div data-testid="icon-info" />,
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
  writeTextFile: vi.fn(),
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
      generateWorkspacePrompts: vi.fn(() => Promise.resolve([])),
      listPromptSuggestions: vi.fn(() => Promise.resolve([])),
    },
    chat: {
      listSessions: vi.fn((workspaceId: string, folderId: string | null) => Promise.resolve(
        workspaceId === "ws-1" && folderId === null
          ? [{
              id: "session-1",
              title: "Test Session",
              folder_id: null,
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
      batchMoveSessions: vi.fn(() => Promise.resolve({ moved: 0, missing_session_ids: [], folder_mapping: {} })),
      createSession: vi.fn(),
      branchSession: vi.fn(),
      addMessage: vi.fn(),
      touchSessionAccessed: vi.fn(() => Promise.resolve(undefined)),
      updateSession: vi.fn(() => Promise.resolve(undefined)),
      deleteSession: vi.fn(() => Promise.resolve(undefined)),
    },
    folder: {
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
    summary: {
      generate: vi.fn(() => Promise.resolve(undefined)),
      list: vi.fn(() => Promise.resolve([])),
    },
    memory: {
      listActive: vi.fn(() => Promise.resolve([])),
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
    listenBackgroundTask: vi.fn(() => Promise.resolve(() => {})),
    listenThoughtDue: vi.fn(() => Promise.resolve(() => {})),
  },
}));

const setActiveChatId = vi.fn();
const setActiveFolderId = vi.fn();
const setActiveWorkspaceId = vi.fn();
let mockWorkspacePane: Record<string, unknown> | null = null;
let mockActiveChatId: string | null = null;

vi.mock("@/lib/workspacePane", () => ({
  useScopedChat: () => ({ activeChat: mockActiveChatId, activeChatId: mockActiveChatId, setActiveChatId }),
  useScopedFolders: () => [],
  useScopedWorkspace: () => ({
    activeWorkspaceId: "ws-1",
    activeFolderId: null,
    setActiveWorkspaceId,
    setActiveFolderId,
    workspace: null,
  }),
  useBubbleUpFlag: () => true,
  useWorkspacePane: () => mockWorkspacePane,
}));

async function renderChatView(initialEntries?: Array<string | { pathname: string; state?: unknown }>) {
  let rendered: ReturnType<typeof render> | undefined;

  await act(async () => {
    rendered = render(
      <MemoryRouter
        initialEntries={initialEntries}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ChatView />
      </MemoryRouter>,
    );
    await flushMicrotasks();
  });

  return rendered as ReturnType<typeof render>;
}

async function flushMicrotasks(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

async function openCreateWorkspaceInput() {
  fireEvent.contextMenu(await screen.findByText("Test Session"));
  fireEvent.click(await screen.findByText("Move to workspace"));
  fireEvent.click(await screen.findByText(/Create workspace\.\.\./i));

  return screen.findByPlaceholderText("Workspace name");
}

describe("ChatView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetWorkspacePromptsDedup();
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
            auto_detected_tags: [],
            custom_tags: [],
            excluded_tags: [],
            intent_patterns: [],
            generated_at: null,
            message_count_at_gen: null,
            ollama_enriched: false,
          },
          signature_updated_at: null,
          parent_workspace_id: null,
          icon: "", order_index: 0, last_message_at: null, survey_data: null,
        },
      ],
      activeWorkspaceId: "ws-1",
      folders: [],
      foldersByWorkspace: {},
      activeFolderId: null,
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
          folder_id: "",
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

  it("does not create a workspace when the inline name is empty", async () => {
    await renderChatView();

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

    await renderChatView();

    const input = await openCreateWorkspaceInput();
    const form = input.closest("form");
    expect(form).not.toBeNull();
    fireEvent.change(input, { target: { value: "  New Workspace  " } });
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(api.workspace.create).toHaveBeenCalledWith("New Workspace");
    });
  });

  it("surfaces an error dialog when inline workspace creation fails", async () => {
    (api.workspace.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));

    await renderChatView();

    const input = await openCreateWorkspaceInput();
    const form = input.closest("form");
    expect(form).not.toBeNull();
    fireEvent.change(input, { target: { value: "New Workspace" } });
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(api.workspace.create).toHaveBeenCalledWith("New Workspace");
    });

    expect(await screen.findByText("Create workspace failed")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("keeps a fixed trailing slot on session rows so hover actions do not collapse the title", async () => {
    await renderChatView();

    const title = await screen.findByText("Test Session");
    const row = title.closest("div.group");

    expect(row).not.toBeNull();
    expect(
      Array.from(row?.querySelectorAll("div") ?? []).some((element) => element.className.includes("w-[44px]"))
    ).toBe(true);
  });

  it("prevents selecting chat titles in the sidebar session list", async () => {
    await renderChatView();

    const title = await screen.findByText("Test Session");
    const row = title.closest("div.group");

    expect(row).not.toBeNull();
    expect(row?.className).toContain("select-none");
  });

  it("copies the chat name from the sidebar session menu", async () => {
    await renderChatView();

    fireEvent.contextMenu(await screen.findByText("Test Session"));
    fireEvent.click(await screen.findByText("Copy chat name"));

    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith("Test Session");
  });

  it("uses a narrower sidebar and tighter trailing slot in split panes", async () => {
    mockWorkspacePane = { paneId: "primary" };

    await renderChatView();

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
      folder_id: "",
      workspace_id: "ws-1",
      created_at: "",
      updated_at: "",
      is_incognito: false,
      exclude_from_analytics: false,
      is_pinned: false,
      is_deleted: false,
      message_count_at_title_gen: 0,
    } satisfies ChatSession);

    await renderChatView();

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
      folder_id: "",
      workspace_id: "ws-1",
      created_at: "",
      updated_at: "",
      is_incognito: true,
      exclude_from_analytics: false,
      is_pinned: false,
      is_deleted: false,
      message_count_at_title_gen: 0,
    } satisfies ChatSession);

    await renderChatView();

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
        folder_id: "",
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
      folder_id: "",
      workspace_id: "ws-1",
      created_at: "",
      updated_at: "",
      is_incognito: true,
      exclude_from_analytics: false,
      is_pinned: false,
      is_deleted: false,
      message_count_at_title_gen: 0,
    } satisfies ChatSession);

    await renderChatView();

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

  it("shows the active model label in the composer", async () => {
    mockActiveChatId = "session-1";
    useSettingsStore.setState({
      modelLabels: {
        "test-model": "Test Model",
      },
    });
    await renderChatView();

    expect(screen.getByRole("button", { name: "Active model: Test Model" })).toBeInTheDocument();
  });

  it("renders the composer inside the elevated floating shell", async () => {
    mockActiveChatId = "session-1";

    await renderChatView();

    const composerShell = screen.getByTestId("composer-shell");
    expect(composerShell.className).toContain("ring-[var(--border-color)]");
    expect(composerShell.className).toContain("bg-[var(--bg-elevated)]");
  });

  it("opens the active chat summary from the header icon", async () => {
    mockActiveChatId = "session-1";
    (api.summary.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "summary-1",
        session_id: "session-1",
        workspace_id: "ws-1",
        summary_type: "info",
        content: "The thread covers Rust ownership and compiler errors.",
        key_topics: [],
        message_range_start: 0,
        message_range_end: 4,
        token_count: 32,
        created_at: "",
        updated_at: "",
      },
    ]);

    await renderChatView();

    const summaryButton = await screen.findByRole("button", { name: "Chat summary" });
    await waitFor(() => {
      expect(summaryButton).toHaveAttribute("aria-disabled", "false");
    });

    fireEvent.click(summaryButton);

    expect(screen.getByRole("dialog", { name: "Chat summary details" })).toBeInTheDocument();
    expect(screen.getByText("Chat Info")).toBeInTheDocument();
    expect(screen.getByText("The thread covers Rust ownership and compiler errors.")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Chat summary details" })).not.toBeInTheDocument();
    });
  });

  it("surfaces a disabled chat summary icon when no summary exists", async () => {
    mockActiveChatId = "session-1";
    (api.summary.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await renderChatView();

    const summaryButton = await screen.findByRole("button", { name: "Chat summary" });
    await waitFor(() => {
      expect(summaryButton).toHaveAttribute("aria-disabled", "true");
    });

    fireEvent.click(summaryButton);

    expect(screen.queryByRole("dialog", { name: "Chat summary details" })).not.toBeInTheDocument();
  });

  it("prefers the info summary for the header surface when multiple summaries exist", async () => {
    mockActiveChatId = "session-1";
    (api.summary.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "summary-extensive",
        session_id: "session-1",
        workspace_id: "ws-1",
        summary_type: "extensive",
        content: "A longer synopsis that should not be shown in the header info popover.",
        key_topics: [],
        message_range_start: 0,
        message_range_end: 4,
        token_count: 64,
        created_at: "",
        updated_at: "",
      },
      {
        id: "summary-info",
        session_id: "session-1",
        workspace_id: "ws-1",
        summary_type: "info",
        content: "Short info summary for quick recall.",
        key_topics: [],
        message_range_start: 0,
        message_range_end: 4,
        token_count: 20,
        created_at: "",
        updated_at: "",
      },
    ]);

    await renderChatView();

    const summaryButton = await screen.findByRole("button", { name: "Chat summary" });
    fireEvent.click(summaryButton);

    expect(screen.getByText("Short info summary for quick recall.")).toBeInTheDocument();
    expect(screen.queryByText("A longer synopsis that should not be shown in the header info popover.")).not.toBeInTheDocument();
  });

  it("refreshes the info summary after the assistant response is persisted", async () => {
    mockActiveChatId = "session-1";
    (api.chat.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "session-1",
        title: "Test Session",
        model_name: "test-model",
        system_prompt: "",
        folder_id: "",
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
    (api.chat.addMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_workspaceId: string, sessionId: string, role: "user" | "assistant", content: string, modelName?: string) => ({
        id: `${role}-persisted`,
        session_id: sessionId,
        role,
        content,
        model_name: modelName,
        created_at: "",
      }),
    );
    (api.listenStream as ReturnType<typeof vi.fn>).mockImplementation(async (_sessionId: string, onChunk: (...args: unknown[]) => void) => {
      onChunk("Assistant answer", false);
      onChunk("", true, 24, 1200, 100);
      return () => {};
    });
    (api.ollama.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (api.ollama.generateTitle as ReturnType<typeof vi.fn>).mockResolvedValue("Rust ownership");
    (api.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      preferred_model: "test-model",
      web_session_preserve: false,
      chat_title_auto_refresh: "initial_only",
    });

    await renderChatView();

    const composer = await screen.findByPlaceholderText("Start a new thread…");
    await screen.findByRole("button", { name: "Active model: Test Model" });
    useSettingsStore.setState({ chatTitleAutoRefresh: "initial_only" });
    fireEvent.change(composer, { target: { value: "Explain Rust ownership" } });
    const sendButton = screen.getByRole("button", { name: "Send message" });
    await waitFor(() => {
      expect(sendButton).not.toBeDisabled();
    });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(api.chat.addMessage).toHaveBeenCalledWith(
        "ws-1",
        "session-1",
        "assistant",
        "Assistant answer",
        "test-model",
        24,
        1200,
      );
    });
    await waitFor(() => {
      expect(api.ollama.generateTitle).toHaveBeenCalledWith(
        "test-model",
        "Explain Rust ownership",
        expect.any(String),
      );
    });

    await waitFor(() => {
      expect(api.summary.generate).toHaveBeenCalledWith("session-1", "ws-1", "info", true);
    });
  });

  it("regenerates follow-ups after editing a user message", async () => {
    mockActiveChatId = "session-1";
    const existingMessages: Message[] = [
      {
        id: "user-original",
        session_id: "session-1",
        role: "user",
        content: "Original prompt",
        created_at: "",
      },
      {
        id: "assistant-original",
        session_id: "session-1",
        role: "assistant",
        content: "Original answer",
        model_name: "test-model",
        created_at: "",
      },
    ];
    useChatStore.setState({
      activeChatId: "session-1",
      messages: { "session-1": existingMessages },
    });
    (api.chat.addMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_workspaceId: string, sessionId: string, role: "user" | "assistant", content: string, modelName?: string) => ({
        id: `${role}-edited`,
        session_id: sessionId,
        role,
        content,
        model_name: modelName,
        created_at: "",
      }),
    );
    (api.listenStream as ReturnType<typeof vi.fn>).mockImplementation(async (_sessionId: string, onChunk: (...args: unknown[]) => void) => {
      onChunk("Edited answer", false);
      onChunk("", true, 18, 900, 75);
      return () => {};
    });
    (api.ollama.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (api.ollama.generateFollowUps as ReturnType<typeof vi.fn>).mockResolvedValue(["Fresh follow-up"]);

    await renderChatView();

    await waitFor(() => {
      expect(screen.getAllByTestId("icon-pencil").length).toBeGreaterThan(0);
    });
    const editButton = screen
      .getAllByTestId("icon-pencil")
      .find((icon) => icon.closest("[data-msg-id='user-original']"))
      ?.closest("button");
    expect(editButton).toBeTruthy();
    fireEvent.click(editButton as HTMLButtonElement);
    const editor = screen.getByDisplayValue("Original prompt");
    fireEvent.change(editor, { target: { value: "Updated prompt" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => {
      expect(api.chat.addMessage).toHaveBeenCalledWith(
        "ws-1",
        "session-1",
        "assistant",
        "Edited answer",
        "test-model",
        18,
        900,
      );
    });

    await waitFor(() => {
      expect(api.ollama.generateFollowUps).toHaveBeenCalledWith(
        "test-model",
        [
          { role: "user", content: "Updated prompt" },
          { role: "assistant", content: "Edited answer" },
        ],
        "",
        undefined,
      );
    });
  });

  describe("regenerating a mid-conversation message", () => {
    const branchableMessages: Message[] = [
      { id: "user-1", session_id: "session-1", role: "user", content: "First prompt", created_at: "2024-01-01T00:00:00Z" },
      { id: "assistant-1", session_id: "session-1", role: "assistant", content: "First answer", model_name: "test-model", created_at: "2024-01-01T00:00:01Z" },
      { id: "user-2", session_id: "session-1", role: "user", content: "Second prompt", created_at: "2024-01-01T00:00:02Z" },
      { id: "assistant-2", session_id: "session-1", role: "assistant", content: "Second answer", model_name: "test-model", created_at: "2024-01-01T00:00:03Z" },
    ];

    async function clickRedoOn(messageId: string) {
      await waitFor(() => {
        expect(screen.getAllByTestId("icon-rotate-ccw").length).toBeGreaterThan(0);
      });
      const redoButton = screen
        .getAllByTestId("icon-rotate-ccw")
        .find((icon) => icon.closest(`[data-msg-id='${messageId}']`))
        ?.closest("button");
      expect(redoButton).toBeTruthy();
      fireEvent.click(redoButton as HTMLButtonElement);
    }

    beforeEach(() => {
      mockActiveChatId = "session-1";
      useChatStore.setState({
        activeChatId: "session-1",
        messages: { "session-1": branchableMessages },
      });
      (api.chat.addMessage as ReturnType<typeof vi.fn>).mockImplementation(
        async (_workspaceId: string, sessionId: string, role: "user" | "assistant", content: string, modelName?: string) => ({
          id: `${role}-regenerated`,
          session_id: sessionId,
          role,
          content,
          model_name: modelName,
          created_at: "",
        }),
      );
      (api.listenStream as ReturnType<typeof vi.fn>).mockImplementation(async (_sessionId: string, onChunk: (...args: unknown[]) => void) => {
        onChunk("Regenerated answer", false);
        onChunk("", true, 12, 500, 50);
        return () => {};
      });
      (api.ollama.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    });

    it("branches into a new session and leaves the original history intact", async () => {
      useSettingsStore.setState({ regenerateCreatesBranch: true });
      (api.chat.branchSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "session-branch",
        title: "Test Session (branch)",
        folder_id: "",
        workspace_id: "ws-1",
        model_name: "test-model",
        system_prompt: "",
        created_at: "",
        updated_at: "",
        is_pinned: false,
        parent_session_id: "session-1",
        branch_message_id: "assistant-1",
      });

      await renderChatView();
      await clickRedoOn("assistant-1");

      await waitFor(() => {
        expect(api.chat.branchSession).toHaveBeenCalledWith("ws-1", "session-1", "assistant-1");
      });

      // The regenerated reply is persisted onto the branch, not the original.
      await waitFor(() => {
        expect(api.chat.addMessage).toHaveBeenCalledWith(
          "ws-1",
          "session-branch",
          "assistant",
          "Regenerated answer",
          "test-model",
          12,
          500,
        );
      });

      // Original session keeps every message it started with.
      expect(useChatStore.getState().messages["session-1"]).toHaveLength(4);
      // The branch only carries the prefix before the regenerated message.
      const branchMessages = useChatStore.getState().messages["session-branch"] ?? [];
      expect(branchMessages.map((m) => m.id)).toContain("user-1");
      expect(branchMessages.map((m) => m.content)).not.toContain("Second prompt");
    });

    it("truncates in place when branching is disabled", async () => {
      useSettingsStore.setState({ regenerateCreatesBranch: false });

      await renderChatView();
      // assistant-2 is the last message, so no confirm dialog is involved and
      // the destructive path regenerates within the original session.
      await clickRedoOn("assistant-2");

      await waitFor(() => {
        expect(api.chat.addMessage).toHaveBeenCalledWith(
          "ws-1",
          "session-1",
          "assistant",
          "Regenerated answer",
          "test-model",
          12,
          500,
        );
      });
      expect(api.chat.branchSession).not.toHaveBeenCalled();
    });
  });

  it("prefers the background model for bundled initial title generation", async () => {
    mockActiveChatId = "session-1";
    (api.chat.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "session-1",
        title: "Test Session",
        model_name: "test-model",
        system_prompt: "",
        folder_id: "",
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
    (api.chat.addMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_workspaceId: string, sessionId: string, role: "user" | "assistant", content: string, modelName?: string) => ({
        id: `${role}-persisted`,
        session_id: sessionId,
        role,
        content,
        model_name: modelName,
        created_at: "",
      }),
    );
    (api.listenStream as ReturnType<typeof vi.fn>).mockImplementation(async (_sessionId: string, onChunk: (...args: unknown[]) => void) => {
      onChunk("Assistant answer", false);
      onChunk("", true, 24, 1200, 100);
      return () => {};
    });
    (api.ollama.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (api.ollama.generateTitle as ReturnType<typeof vi.fn>).mockResolvedValue("Rust ownership");
    (api.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      preferred_model: "test-model",
      web_session_preserve: false,
      chat_title_auto_refresh: "initial_only",
    });

    await renderChatView();

    const composer = await screen.findByPlaceholderText("Start a new thread…");
    await screen.findByRole("button", { name: "Active model: Test Model" });
    useSettingsStore.setState({ chatTitleAutoRefresh: "initial_only", backgroundModel: "tiny-title-model" });
    fireEvent.change(composer, { target: { value: "Explain Rust ownership" } });
    const sendButton = screen.getByRole("button", { name: "Send message" });
    await waitFor(() => {
      expect(sendButton).not.toBeDisabled();
    });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(api.ollama.generateTitle).toHaveBeenCalledWith(
        "tiny-title-model",
        "Explain Rust ownership",
        expect.any(String),
      );
    });
  });

  it("falls back to the active chat model for bundled initial title generation when no background model is configured", async () => {
    mockActiveChatId = "session-1";
    (api.chat.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "session-1",
        title: "Test Session",
        model_name: "test-model",
        system_prompt: "",
        folder_id: "",
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
    (api.chat.addMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_workspaceId: string, sessionId: string, role: "user" | "assistant", content: string, modelName?: string) => ({
        id: `${role}-persisted`,
        session_id: sessionId,
        role,
        content,
        model_name: modelName,
        created_at: "",
      }),
    );
    (api.listenStream as ReturnType<typeof vi.fn>).mockImplementation(async (_sessionId: string, onChunk: (...args: unknown[]) => void) => {
      onChunk("Assistant answer", false);
      onChunk("", true, 24, 1200, 100);
      return () => {};
    });
    (api.ollama.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (api.ollama.generateTitle as ReturnType<typeof vi.fn>).mockResolvedValue("Rust ownership");
    (api.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      preferred_model: "test-model",
      web_session_preserve: false,
      chat_title_auto_refresh: "initial_only",
    });

    await renderChatView();

    const composer = await screen.findByPlaceholderText("Start a new thread…");
    await screen.findByRole("button", { name: "Active model: Test Model" });
    useSettingsStore.setState({ chatTitleAutoRefresh: "initial_only", backgroundModel: "" });
    fireEvent.change(composer, { target: { value: "Explain Rust ownership" } });
    const sendButton = screen.getByRole("button", { name: "Send message" });
    await waitFor(() => {
      expect(sendButton).not.toBeDisabled();
    });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(api.ollama.generateTitle).toHaveBeenCalledWith(
        "test-model",
        "Explain Rust ownership",
        expect.any(String),
      );
    });
  });

  it("shows the full Ollama model id when the stored label is only the base model name", async () => {
    await flushMicrotasks(1);
    expect(resolveModelDisplayName(
      "gemma4:latest",
      { "gemma4:latest": "gemma4" },
      [{ model_id: "gemma4:latest", name: "gemma4", provider: "ollama", enabled: true, priority: 1 } as never],
    )).toBe("gemma4:latest");
  });

  it("uses provider-neutral labels for default browser-backed models", async () => {
    await flushMicrotasks(1);
    expect(resolveModelDisplayName(
      "chatgpt-web",
      { "chatgpt-web": "ChatGPT (Web)" },
      [{ model_id: "chatgpt-web", name: "ChatGPT (Web)", provider: "web_chatgpt", enabled: true, priority: 1 } as never],
    )).toBe("Browser Assistant A");
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

    await renderChatView();

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

    await renderChatView();

    fireEvent.click(screen.getByRole("button", { name: /open attachment menu/i }));

    expect(await screen.findByRole("menuitem", { name: /attach image/i })).toBeInTheDocument();
  });

  it("polishes the composer prompt in place and allows undo", async () => {
    (api.ollama.polishPrompt as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Write a concise summary of this Rust error and explain the root cause."
    );
    mockActiveChatId = "session-1";

    await renderChatView();

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
        folder_id: "",
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

    await renderChatView();

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
      folder_id: "",
      workspace_id: "ws-1",
      created_at: "",
      updated_at: "",
      is_incognito: false,
      exclude_from_analytics: false,
      is_pinned: false,
      is_deleted: false,
      message_count_at_title_gen: 0,
    } satisfies ChatSession);

    await renderChatView([{ pathname: "/chat", state: { createNewChat: true } }]);

    await waitFor(() => {
      expect(api.chat.createSession).toHaveBeenCalledTimes(1);
      expect(setActiveChatId).toHaveBeenCalledWith("session-from-route");
    });
  });

  it("does not re-fire generateWorkspacePrompts on remount for the same workspace", async () => {
    const signature = {
      auto_detected_tags: [{ tag: "rust", weight: 1, source: "auto" }],
      custom_tags: [],
      excluded_tags: [],
      intent_patterns: [],
      suggested_prompts: [],
      generated_at: null,
      message_count_at_gen: null,
      ollama_enriched: false,
    };
    // The mount effect resets activeTopicSignature from the workspace's
    // cached topic_signature, so set both to the same non-empty value.
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "ws-1" ? { ...w, topic_signature: signature } : w
      ),
      activeTopicSignature: signature,
    }));
    (api.topicSignature.get as ReturnType<typeof vi.fn>).mockResolvedValue(signature);

    const { unmount } = await renderChatView();
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await waitFor(() => {
      expect(api.workspace.generateWorkspacePrompts).toHaveBeenCalledTimes(1);
    });
    unmount();

    await renderChatView();
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(api.workspace.generateWorkspacePrompts).toHaveBeenCalledTimes(1);
  });
});
