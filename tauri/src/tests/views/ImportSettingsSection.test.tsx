import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ImportSettingsSection from "@/views/ImportSettingsSection";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { open as openDialog, message as showMessage } from "@tauri-apps/plugin-dialog";

const mockNavigate = vi.fn();

vi.mock("lucide-react", () => ({
  Check: () => <div data-testid="icon-check" />,
  CheckSquare: () => <div data-testid="icon-check-square" />,
  ChevronDown: () => <div data-testid="icon-chevron-down" />,
  ChevronRight: () => <div data-testid="icon-chevron-right" />,
  Eye: () => <div data-testid="icon-eye" />,
  FolderInput: () => <div data-testid="icon-folder-input" />,
  Info: () => <div data-testid="icon-info" />,
  RefreshCw: () => <div data-testid="icon-refresh-cw" />,
  Square: () => <div data-testid="icon-square" />,
  X: () => <div data-testid="icon-x" />,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(() => Promise.resolve(true)),
  message: vi.fn(() => Promise.resolve(undefined)),
  open: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/lib/api", () => ({
  api: {
    workspace: {
      list: vi.fn(() => Promise.resolve([
        {
          id: "workspace-1",
          name: "LM Imports",
          description: "",
          prompt_instructions: "",
          topic_signature: {
            auto_detected_tags: [],
            custom_tags: [],
            excluded_tags: [],
            intent_patterns: [],
            generated_at: null,
            message_count_at_gen: null,
          },
          signature_updated_at: null,
          is_hidden: false,
          created_at: "",
          updated_at: "",
          parent_workspace_id: null,
          icon: "folder",
        },
      ])),
    },
    folder: {
      list: vi.fn(() => Promise.resolve([])),
    },
    chat: {
      listSessions: vi.fn(() => Promise.resolve([
        {
          id: "session-1",
          workspace_id: "workspace-1",
          folder_id: "",
          title: "Imported Chat",
          model_name: "",
          system_prompt: "",
          is_pinned: false,
          is_incognito: false,
          exclude_from_analytics: false,
          is_deleted: false,
          created_at: "",
          updated_at: "",
        },
      ])),
    },
    chatFile: {
      previewLmStudioFolder: vi.fn(() => Promise.resolve({
        conversations: [
          {
            uuid: "root-chat",
            name: "Root Chat",
            message_count: 3,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
            folder_id: null,
            folder_name: null,
            source_path: "root-chat.conversation.json",
          },
          {
            uuid: "project-a-chat",
            name: "Project A Chat",
            message_count: 5,
            created_at: "2024-01-02T00:00:00Z",
            updated_at: "2024-01-02T00:00:00Z",
            folder_id: "Project A",
            folder_name: "Project A",
            source_path: "Project A/chat.conversation.json",
          },
          {
            uuid: "project-b-chat",
            name: "Project B Chat",
            message_count: 7,
            created_at: "2024-01-03T00:00:00Z",
            updated_at: "2024-01-03T00:00:00Z",
            folder_id: "Project B",
            folder_name: "Project B",
            source_path: "Project B/chat.conversation.json",
          },
        ],
        total: 3,
        folders: [
          {
            uuid: "Project A",
            name: "Project A",
            conversation_count: 1,
            message_count: 5,
          },
          {
            uuid: "Project B",
            name: "Project B",
            conversation_count: 1,
            message_count: 7,
          },
        ],
        errors: 1,
        error_messages: ["broken.conversation.json: Invalid LM Studio JSON"],
      })),
      importLmStudioFolder: vi.fn(() => Promise.resolve({
        imported: 1,
        skipped: 0,
        appended_sessions: 0,
        appended_messages: 0,
        cloned: 0,
        workspace_id: "workspace-1",
        workspace_name: "LM Imports",
        folders_created: 1,
        errors: 0,
        error_messages: [],
      })),
      previewChatGptFolder: vi.fn(() => Promise.resolve({
        conversations: [
          {
            uuid: "chatgpt-chat-1",
            name: "ChatGPT Chat 1",
            message_count: 2,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
            first_user_message: "Hello assistant",
            messages: [
              { role: "user", content: "Hello assistant" },
              { role: "assistant", content: "Hello user" },
            ],
          },
          {
            uuid: "chatgpt-chat-2",
            name: "ChatGPT Chat 2",
            message_count: 2,
            created_at: "2024-01-02T00:00:00Z",
            updated_at: "2024-01-02T00:00:00Z",
            first_user_message: "Tell me a joke",
            messages: [
              { role: "user", content: "Tell me a joke" },
              { role: "assistant", content: "Why did the chicken cross the road?" },
            ],
          },
        ],
        total: 2,
      })),
      importChatGptFolder: vi.fn(() => Promise.resolve({
        imported_sessions: 1,
        skipped: 0,
        workspace_id: "workspace-1",
        errors: 0,
        error_messages: [],
      })),
      detectClaudeFormat: vi.fn(() => Promise.resolve({
        format: "v2",
        files_found: { conversations: true, projects: true, memories: false },
      })),
      previewClaudeFiles: vi.fn(() => Promise.resolve({
        format: "v2",
        folders: [
          {
            uuid: "proj-1",
            name: "Rust Learning",
            description: "",
            has_prompt: false,
            doc_count: 0,
            conversation_count: 0,
            has_memory: false,
            prompt_template: "",
          },
        ],
        conversations_by_project: {},
        orphan_conversations: [
          {
            uuid: "orphan-1",
            name: "",
            message_count: 2,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
            project_uuid: null,
            first_user_message: "How do lifetimes work in Rust?",
            summary: "A walkthrough of Rust lifetime annotations.",
            messages: [
              { role: "user", content: "How do lifetimes work in Rust?" },
              { role: "assistant", content: "Lifetimes describe how long references are valid." },
            ],
          },
        ],
        orphan_count: 1,
        memories: null,
        memories_by_project: {},
        suggestions: [],
        files_found: { conversations: true, projects: true, memories: false },
      })),
    },
  },
}));

function renderImportSettings() {
  return render(
    <MemoryRouter>
      <ImportSettingsSection />
    </MemoryRouter>,
  );
}

describe("ImportSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      activeParentWorkspaceId: null,
      activeFolderId: null,
      folders: [],
      foldersByWorkspace: {},
    });
  });

  it("scans LM Studio folders before import and only submits the reviewed selection", async () => {
    vi.mocked(openDialog).mockResolvedValue("/imports/lm-studio");

    renderImportSettings();

    expect(screen.getByText("LM Studio")).toBeInTheDocument();
    expect(screen.getByText(/Select one folder to preview/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("Select")[0]);

    expect(await screen.findByText("Root Chat")).toBeInTheDocument();
    expect(screen.getByText("Project A Chat")).toBeInTheDocument();
    expect(screen.getByText("Project B Chat")).toBeInTheDocument();
    expect(screen.getByText(/1 file could not be previewed/i)).toBeInTheDocument();

    const rootConversationRow = screen.getByText("Root Chat").closest("label");
    const projectARow = screen.getByText("Project A").closest("label");

    expect(rootConversationRow).not.toBeNull();
    expect(projectARow).not.toBeNull();

    fireEvent.click(within(rootConversationRow as HTMLElement).getByRole("checkbox"));
    fireEvent.click(within(projectARow as HTMLElement).getByRole("checkbox"));

    expect(screen.getByText("Import 1 conversation")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Import 1 conversation"));

    await waitFor(() => {
      expect(api.chatFile.importLmStudioFolder).toHaveBeenCalledWith(
        "/imports/lm-studio",
        undefined,
        ["project-b-chat"],
        ["Project B"],
        false,
        false,
      );
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/chat/session-1");
    });
    expect(showMessage).toHaveBeenCalledWith(
      expect.stringContaining("1 conversation imported."),
      expect.objectContaining({ title: "LM Studio import complete" }),
    );
  });

  it("scans ChatGPT folders before import and allows selecting a subset to import", async () => {
    vi.mocked(openDialog).mockResolvedValue("/imports/chatgpt");

    renderImportSettings();

    expect(screen.getByText("ChatGPT")).toBeInTheDocument();
    
    // The select buttons are rendered inside the grids: LM Studio is 0, Gemini is 1, Claude is 2, ChatGPT is 3.
    fireEvent.click(screen.getAllByText("Select")[3]);

    expect(await screen.findByText("ChatGPT Chat 1")).toBeInTheDocument();
    expect(screen.getByText("ChatGPT Chat 2")).toBeInTheDocument();

    const row2 = screen.getByText("ChatGPT Chat 2").closest(".cursor-pointer");
    expect(row2).not.toBeNull();
    fireEvent.click(within(row2 as HTMLElement).getByRole("checkbox"));

    expect(screen.getByText("Import 1 conversation")).toBeInTheDocument();

    // Click Import
    fireEvent.click(screen.getByText("Import 1 conversation"));

    await waitFor(() => {
      expect(api.chatFile.importChatGptFolder).toHaveBeenCalledWith(
        "/imports/chatgpt",
        null,
        "chatgpt",
        ["chatgpt-chat-1"],
      );
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/chat/session-1");
    });
    expect(showMessage).toHaveBeenCalledWith(
      expect.stringContaining("1 conversation imported."),
      expect.objectContaining({ title: "ChatGPT import complete" }),
    );
  });

  it("shows a snippet for untitled Claude chats and an inline preview on demand", async () => {
    vi.mocked(openDialog).mockResolvedValue("/imports/claude");

    renderImportSettings();

    // The select buttons are rendered inside the grids: LM Studio is 0, Gemini is 1, Claude is 2, ChatGPT is 3.
    fireEvent.click(screen.getAllByText("Select")[2]);

    // Expand the unassigned-conversations panel.
    fireEvent.click(await screen.findByText(/1 conversation$/));

    // The empty-named chat shows "Untitled" plus a summary snippet.
    const titleButton = await screen.findByText(/Untitled/);
    expect(titleButton.textContent).toContain("A walkthrough of Rust lifetime annotations.");

    // No message content until the preview is toggled open.
    expect(screen.queryByText("Lifetimes describe how long references are valid.")).not.toBeInTheDocument();

    fireEvent.click(titleButton);

    expect(await screen.findByText("How do lifetimes work in Rust?")).toBeInTheDocument();
    expect(screen.getByText("Lifetimes describe how long references are valid.")).toBeInTheDocument();

    // Toggling again hides the preview.
    fireEvent.click(screen.getByText(/Untitled/));
    await waitFor(() => {
      expect(screen.queryByText("Lifetimes describe how long references are valid.")).not.toBeInTheDocument();
    });
  });
});
