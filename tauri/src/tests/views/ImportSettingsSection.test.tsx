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
  FolderInput: () => <div data-testid="icon-folder-input" />,
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
            domain_tags: [],
            manual_tags: [],
            ignored_tags: [],
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
        projects: [
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
        workspace_id: "workspace-1",
        workspace_name: "LM Imports",
        folders_created: 1,
        errors: 0,
        error_messages: [],
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

    expect(screen.getByText("Import LM Studio Conversations Folder")).toBeInTheDocument();
    expect(screen.getByText(/Choose a folder that contains LM Studio/i)).toBeInTheDocument();
    expect(screen.getByText("Import Claude Conversation Export File")).toBeInTheDocument();
    expect(screen.getByText((content, element) => (
      element?.tagName.toLowerCase() === "p"
      && content.includes("Choose a Claude Desktop")
      && content.includes("export file. We will scan the file")
    ))).toBeInTheDocument();

    fireEvent.click(screen.getByText("Scan LM Studio Folder"));

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
});
