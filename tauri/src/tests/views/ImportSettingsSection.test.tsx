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
  Download: () => <div data-testid="icon-download" />,
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
  save: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(() => Promise.resolve(undefined)),
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
      create: vi.fn(() => Promise.resolve({ id: "workspace-new", name: "Created", description: "" })),
      createChild: vi.fn(() => Promise.resolve({ id: "workspace-child", name: "Created Child", description: "" })),
      update: vi.fn(() => Promise.resolve(undefined)),
    },
    folder: {
      list: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({ id: "folder-new", workspace_id: "workspace-1", name: "Created" })),
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
        has_split_parts: false,
      })),
      // A v2 export carries no account memories, so the panel renders nothing.
      previewClaudeAccountMemories: vi.fn(() => Promise.resolve({ total: 0, memories: [] })),
      importClaudeAccountMemories: vi.fn(() =>
        Promise.resolve({ imported: 0, updated: 0, skipped: 0 }),
      ),
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
        skipped_empty: 0,
        memories: null,
        memories_by_project: {},
        suggestions: [],
        linked_conversations: {},
        linked_unassigned: {},
        known_destinations: {},
        match_strictness: "balanced",
        files_found: { conversations: true, projects: true, memories: false },
      })),
      matchClaudeWithTopics: vi.fn(() => Promise.resolve({
        suggestions: [],
        topics_by_project: {},
        projects_with_topics: 0,
        projects_total: 0,
        topic_batches_total: 0,
        topic_batches_failed: 0,
        llm_error: null,
      })),
      generateClaudeProjectDescriptions: vi.fn(() => Promise.resolve({
        descriptions: {},
        batches_total: 0,
        batches_failed: 0,
        llm_error: null,
      })),
      matchClaudeWithLlm: vi.fn(() => Promise.resolve({
        suggestions: [],
        batches_total: 0,
        batches_completed: 0,
        llm_error: null,
      })),
      clusterUnmatchedClaudeChats: vi.fn(() => Promise.resolve({
        clusters: [],
        strategy: "lexical",
        embedded: 0,
        failed: 0,
        names_generated: 0,
      })),
      importClaudeFiles: vi.fn(() => Promise.resolve({
        imported: 0,
        skipped: 0,
        appended_sessions: 0,
        appended_messages: 0,
        cloned: 0,
        linked: 1,
        moved_back: 0,
        reassigned: 0,
        memories_imported: 0,
        memories_updated: 0,
        memories_skipped: 0,
        errors: 0,
        error_messages: [],
      })),
    },
    settings: {
      updateOne: vi.fn(() => Promise.resolve(undefined)),
    },
    ollama: {
      listModels: vi.fn(() => Promise.resolve([])),
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

    // Once a source is active, the descriptive cards collapse into chips —
    // the description paragraphs move into hover tooltips.
    expect(screen.queryByText(/Select one folder to preview/i)).not.toBeInTheDocument();

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

  function claudePreviewWithLinks() {
    return {
      format: "v2" as const,
      folders: [
        {
          uuid: "proj-1",
          name: "Rust Learning",
          description: "",
          has_prompt: false,
          doc_count: 0,
          conversation_count: 1,
          has_memory: false,
          prompt_template: "",
        },
      ],
      conversations_by_project: {},
      orphan_conversations: [
        {
          uuid: "orphan-new",
          name: "Fresh chat",
          message_count: 2,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          project_uuid: null,
          first_user_message: "New question",
          summary: "",
          messages: [],
        },
        {
          uuid: "orphan-linked",
          name: "Already imported chat",
          message_count: 4,
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
          project_uuid: null,
          first_user_message: "Old question",
          summary: "",
          messages: [],
        },
      ],
      orphan_count: 2,
      skipped_empty: 0,
      memories: null,
      memories_by_project: {},
      suggestions: [] as import("@/lib/api").ChatSuggestion[],
      linked_unassigned: {} as Record<string, import("@/lib/api").LinkedImportInfo>,
      match_strictness: "balanced" as const,
      linked_conversations: {
        "orphan-linked": {
          session_id: "session-linked",
          source_conversation_uuid: "orphan-linked",
          title: "Already imported chat",
          workspace_id: "workspace-1",
          workspace_name: "LM Imports",
          folder_id: "",
          folder_name: "",
        },
      } as Record<string, import("@/lib/api").LinkedImportInfo>,
      known_destinations: {
        "proj-1": {
          source_project_uuid: "proj-1",
          source_project_name: "Rust Learning",
          workspace_id: "ws-remembered",
          workspace_name: "Rust Learning",
          folder_id: "",
          folder_name: "",
        },
        "__orphans__": {
          source_project_uuid: "__orphans__",
          source_project_name: "",
          workspace_id: "ws-unassigned",
          workspace_name: "Unassigned Imports",
          folder_id: "folder-unassigned",
          folder_name: "Claude Import 2024-01-01",
        },
      },
      files_found: { conversations: true, projects: true, memories: false },
    };
  }

  it("excludes previously imported chats from review and merges them automatically on import", async () => {
    vi.mocked(openDialog).mockResolvedValue("/imports/claude");
    vi.mocked(api.chatFile.previewClaudeFiles).mockResolvedValueOnce(claudePreviewWithLinks());

    renderImportSettings();
    fireEvent.click(screen.getAllByText("Select")[2]);

    // Linked summary row renders; the linked chat is not in the review list.
    expect(await screen.findByText(/1 chat was imported before and will merge automatically/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/1 conversation$/)); // expand unassigned panel
    expect(screen.getByText(/Fresh chat/)).toBeInTheDocument();
    // The linked chat only appears inside the collapsed linked list, not the review table.
    expect(screen.queryByText(/Old question/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => {
      expect(api.chatFile.importClaudeFiles).toHaveBeenCalledTimes(1);
    });
    const args = vi.mocked(api.chatFile.importClaudeFiles).mock.calls[0][0];
    // Linked chats ride along so the backend can merge them in place.
    expect(args.selectedConversationIds).toContain("orphan-linked");
    expect(args.restoreDestinations).toBe(false);

    await waitFor(() => {
      expect(showMessage).toHaveBeenCalledWith(
        expect.stringContaining("1 previously imported chat updated in place."),
        expect.objectContaining({ title: "Claude import complete" }),
      );
    });
  });

  it("does not rescan or lose review state when an include toggle changes", async () => {
    // Regression: the auto-scan effect was keyed on the include toggles, and
    // scanClaudeFiles calls resetClaudePreview — which clears project
    // destinations, chat assignments, the match threshold and slider history.
    // Unticking a box mid-review silently destroyed all of it.
    vi.mocked(openDialog).mockResolvedValue("/imports/claude");
    vi.mocked(api.chatFile.previewClaudeFiles).mockResolvedValueOnce(claudePreviewWithLinks());

    renderImportSettings();
    fireEvent.click(screen.getAllByText("Select")[2]);
    await screen.findByText(/1 chat was imported before and will merge automatically/);

    expect(api.chatFile.previewClaudeFiles).toHaveBeenCalledTimes(1);

    // Untick "Conversations" — must not trigger another scan.
    fireEvent.click(screen.getByLabelText("Conversations"));
    await waitFor(() => {
      expect(api.chatFile.previewClaudeFiles).toHaveBeenCalledTimes(1);
    });

    // Review state survives: the linked summary is still on screen.
    expect(
      screen.getByText(/1 chat was imported before and will merge automatically/),
    ).toBeInTheDocument();

    // And the toggle still gates what is imported.
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => {
      expect(api.chatFile.importClaudeFiles).toHaveBeenCalledTimes(1);
    });
    const args = vi.mocked(api.chatFile.importClaudeFiles).mock.calls[0][0];
    expect(args.selectedConversationIds).toBeUndefined();
  });

  it("sends restoreDestinations when the move-back option is checked", async () => {
    vi.mocked(openDialog).mockResolvedValue("/imports/claude");
    vi.mocked(api.chatFile.previewClaudeFiles).mockResolvedValueOnce(claudePreviewWithLinks());

    renderImportSettings();
    fireEvent.click(screen.getAllByText("Select")[2]);
    await screen.findByText(/1 chat was imported before and will merge automatically/);

    fireEvent.click(screen.getByLabelText(/Move previously imported chats back/));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => {
      expect(api.chatFile.importClaudeFiles).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(api.chatFile.importClaudeFiles).mock.calls[0][0].restoreDestinations).toBe(true);
  });

  it("reuses remembered destinations instead of creating workspaces or folders", async () => {
    vi.mocked(openDialog).mockResolvedValue("/imports/claude");
    vi.mocked(api.chatFile.previewClaudeFiles).mockResolvedValueOnce(claudePreviewWithLinks());

    renderImportSettings();
    fireEvent.click(screen.getAllByText("Select")[2]);
    await screen.findByText(/1 chat was imported before and will merge automatically/);

    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => {
      expect(api.chatFile.importClaudeFiles).toHaveBeenCalledTimes(1);
    });
    const args = vi.mocked(api.chatFile.importClaudeFiles).mock.calls[0][0];
    // proj-1 routes to its remembered workspace; the unassigned orphan reuses
    // the remembered orphans destination instead of a fresh dated folder.
    expect(args.folderMappings["proj-1"]).toEqual({ workspaceId: "ws-remembered", folderId: "" });
    expect(args.orphansDestination).toEqual({ workspaceId: "ws-unassigned", folderId: "folder-unassigned" });
    expect(api.workspace.create).not.toHaveBeenCalled();
    expect(api.workspace.createChild).not.toHaveBeenCalled();
    expect(api.folder.create).not.toHaveBeenCalled();
  });

  function claudePreviewWithSuggestion() {
    const base = claudePreviewWithLinks();
    return {
      ...base,
      linked_conversations: {},
      known_destinations: {},
      // proj-2 has no description/prompt/memory but owns a conversation —
      // AI matching should recap it from that chat.
      conversations_by_project: {
        "proj-2": [
          {
            uuid: "cooking-1",
            name: "Pasta carbonara",
            message_count: 2,
            created_at: "2024-01-05T00:00:00Z",
            updated_at: "2024-01-05T00:00:00Z",
            project_uuid: "proj-2",
            first_user_message: "How do I make carbonara without cream?",
            messages: [],
          },
        ],
      },
      suggestions: [
        {
          conversation_uuid: "orphan-new",
          project_uuid: "proj-1",
          score: 0.6,
          reason: "keywords" as const,
          alternates: [
            { project_uuid: "proj-2", score: 0.31 },
          ],
        },
        // Below-threshold guess: unassigned, but with a best candidate the
        // threshold slider can act on.
        {
          conversation_uuid: "orphan-linked",
          project_uuid: null,
          score: 0,
          reason: "none" as const,
          alternates: [
            { project_uuid: "proj-2", score: 0.24 },
          ],
        },
      ],
      folders: [
        ...base.folders,
        {
          uuid: "proj-2",
          name: "Cooking",
          description: "",
          has_prompt: false,
          doc_count: 0,
          conversation_count: 0,
          has_memory: false,
          prompt_template: "",
        },
      ],
    };
  }

  it("pre-selects the suggested project in the dropdown, keeps the row visible, and shows alternates", async () => {
    vi.mocked(openDialog).mockResolvedValue("/imports/claude");
    vi.mocked(api.chatFile.previewClaudeFiles).mockResolvedValueOnce(claudePreviewWithSuggestion());

    renderImportSettings();
    fireEvent.click(screen.getAllByText("Select")[2]);

    // The filter defaults to unassigned-only, so only the unassigned orphan counts…
    await screen.findByText(/1 conversation$/);
    // …and switching to "all" keeps the suggested one visible (assigned, not hidden).
    fireEvent.click(screen.getByText(/showing: unassigned only/));
    fireEvent.click(await screen.findByText(/2 conversations$/));
    // The chat may also render in the project detail pane; the review row's
    // title is a <button> with a sibling destination dropdown.
    const rowTitle = screen.getAllByText(/Fresh chat/).find((el) => el.closest("button"));
    expect(rowTitle).toBeTruthy();
    const rowContainer = rowTitle?.closest("div.border-b") as HTMLElement;
    const select = within(rowContainer).getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("proj-1");

    // Classification and runner-up are visible.
    expect(screen.getByText(/suggested: Rust Learning \(keywords\)/)).toBeInTheDocument();
    expect(screen.getByText(/also: Cooking 31%/)).toBeInTheDocument();

    // The old bulk-accept flow is gone.
    expect(screen.queryByText(/Accept .* suggestion/)).not.toBeInTheDocument();
  });

  it("re-categorizes live from the match-threshold slider and undoes per drag session", async () => {
    vi.mocked(openDialog).mockResolvedValue("/imports/claude");
    vi.mocked(api.chatFile.previewClaudeFiles).mockResolvedValueOnce(claudePreviewWithSuggestion());

    renderImportSettings();
    fireEvent.click(screen.getAllByText("Select")[2]);
    // orphan-new is suggested at 0.6 → assigned; orphan-linked has no match.
    await screen.findByText(/1 conversation$/);

    const slider = screen.getByLabelText("Match threshold");
    fireEvent.click(screen.getByText(/1 conversation$/)); // expand the row list

    // Lower below 0.24 → the unassigned chat gets assigned to its best guess
    // and the filter auto-switches to the changed-by-threshold view.
    fireEvent.change(slider, { target: { value: "0.2" } });
    fireEvent.pointerUp(slider);
    expect(screen.getByText("showing: changed by threshold")).toBeInTheDocument();
    expect(screen.getByText(/1 conversation$/)).toBeInTheDocument();
    expect(screen.getByText("assigned by threshold")).toBeInTheDocument();
    // The project it joined shows a +1 delta chip.
    expect(screen.getByText("+1")).toBeInTheDocument();

    // Raise above both scores → only the slider-owned chat is demoted; the
    // matcher-assigned chat (0.6 < 0.75) is never touched by the slider.
    fireEvent.change(slider, { target: { value: "0.75" } });
    fireEvent.pointerUp(slider);
    expect(screen.getByText("showing: changed by threshold")).toBeInTheDocument();
    expect(screen.getByText(/1 conversation$/)).toBeInTheDocument();
    expect(screen.getByText("unassigned by threshold")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();

    // Undo restores per drag session and falls back to the unassigned view:
    // first the assigned-at-0.2 state (nothing unassigned), then the original.
    const undo = screen.getByRole("button", { name: "Undo" });
    fireEvent.click(undo);
    expect(screen.getByText("showing: unassigned only")).toBeInTheDocument();
    expect(screen.getByText(/0 conversations$/)).toBeInTheDocument();
    expect(screen.queryByText("unassigned by threshold")).not.toBeInTheDocument();
    fireEvent.click(undo);
    expect(screen.getByText(/1 conversation$/)).toBeInTheDocument();
    expect(undo).toBeDisabled();
  });

  it("generates descriptions for blank projects and re-runs matching with them", async () => {
    vi.mocked(openDialog).mockResolvedValue("/imports/claude");
    vi.mocked(api.chatFile.previewClaudeFiles).mockResolvedValueOnce(claudePreviewWithSuggestion());
    vi.mocked(api.chatFile.generateClaudeProjectDescriptions).mockResolvedValueOnce({
      descriptions: { "proj-2": "Cooking techniques and recipes, mostly Italian pasta dishes." },
      batches_total: 1,
      batches_failed: 0,
      llm_error: null,
    });

    renderImportSettings();
    fireEvent.click(screen.getAllByText("Select")[2]);
    await screen.findByText(/1 conversation$/);

    fireEvent.click(screen.getByLabelText("AI matching options"));
    fireEvent.click(await screen.findByText("Generate descriptions for blank projects"));

    await waitFor(() => {
      expect(api.chatFile.generateClaudeProjectDescriptions).toHaveBeenCalledTimes(1);
    });
    // Both fixture projects have blank descriptions → both are sent, with the
    // Cooking project's native chat title as context.
    const genArgs = vi.mocked(api.chatFile.generateClaudeProjectDescriptions).mock.calls[0][0];
    expect(genArgs.projects.map((p: { uuid: string }) => p.uuid).sort()).toEqual(["proj-1", "proj-2"]);
    expect(genArgs.chatTitlesByProject["proj-2"]).toContain("Pasta carbonara");

    // Matching re-runs immediately, carrying the generated description.
    await waitFor(() => {
      expect(api.chatFile.matchClaudeWithTopics).toHaveBeenCalled();
    });
    const matchArgs = vi.mocked(api.chatFile.matchClaudeWithTopics).mock.calls[0][0];
    const cooking = matchArgs.projects.find((p: { uuid: string }) => p.uuid === "proj-2") as { description: string };
    expect(cooking.description).toContain("Italian pasta");
  });

  it("writes the strictness setting and re-runs matching from the menu", async () => {
    vi.mocked(openDialog).mockResolvedValue("/imports/claude");
    vi.mocked(api.chatFile.previewClaudeFiles).mockResolvedValueOnce(claudePreviewWithSuggestion());
    vi.mocked(api.chatFile.matchClaudeWithTopics).mockResolvedValue({
      suggestions: [],
      topics_by_project: {},
      projects_with_topics: 0,
      projects_total: 2,
      topic_batches_total: 0,
      topic_batches_failed: 0,
      llm_error: null,
    });

    renderImportSettings();
    fireEvent.click(screen.getAllByText("Select")[2]);
    // Default filter is unassigned-only; the suggested orphan is already assigned.
    await screen.findByText(/1 conversation$/);

    fireEvent.click(screen.getByLabelText("AI matching options"));
    fireEvent.click(await screen.findByText(/Strict — only clear winners/));

    await waitFor(() => {
      expect(api.settings.updateOne).toHaveBeenCalledWith("import.match_strictness", "strict");
    });
    await waitFor(() => {
      expect(api.chatFile.matchClaudeWithTopics).toHaveBeenCalled();
    });

    // Projects without any export text are recapped from their own chats
    // before matching; projects with no chats are left untouched.
    const matchArgs = vi.mocked(api.chatFile.matchClaudeWithTopics).mock.calls[0][0];
    const cooking = matchArgs.projects.find((p: { uuid: string }) => p.uuid === "proj-2") as { description: string };
    expect(cooking.description).toContain("Pasta carbonara");
    expect(cooking.description).toContain("carbonara without cream");
    const rust = matchArgs.projects.find((p: { uuid: string }) => p.uuid === "proj-1") as { description: string };
    expect(rust.description).toBe("");
  });

  it("proposes new workspaces for leftovers and imports them under synthetic keys", async () => {
    vi.mocked(openDialog).mockResolvedValue("/imports/claude");
    const preview = claudePreviewWithSuggestion();
    preview.suggestions = []; // both orphans unassigned
    vi.mocked(api.chatFile.previewClaudeFiles).mockResolvedValueOnce(preview);
    vi.mocked(api.chatFile.clusterUnmatchedClaudeChats).mockResolvedValueOnce({
      clusters: [
        {
          id: "cluster-0",
          label: "Docker & Containers",
          terms: ["docker", "containers"],
          conversation_uuids: ["orphan-new", "orphan-linked"],
        },
      ],
      strategy: "embedding",
      embedded: 2,
      failed: 0,
      names_generated: 1,
    });

    renderImportSettings();
    fireEvent.click(screen.getAllByText("Select")[2]);
    await screen.findByText(/2 conversations$/);

    fireEvent.click(screen.getByLabelText("AI matching options"));
    fireEvent.click(await screen.findByText(/Propose new workspaces for leftovers/));

    await waitFor(() => {
      expect(api.chatFile.clusterUnmatchedClaudeChats).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/Proposed 1 new workspace/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => {
      expect(api.chatFile.importClaudeFiles).toHaveBeenCalledTimes(1);
    });
    const args = vi.mocked(api.chatFile.importClaudeFiles).mock.calls[0][0];
    const syntheticKeys = Object.keys(args.folderMappings).filter((k) => k.startsWith("proposed:"));
    expect(syntheticKeys).toHaveLength(1);
    const key = syntheticKeys[0];
    expect(args.chatProjectOverrides?.["orphan-new"]).toBe(key);
    expect(args.chatProjectOverrides?.["orphan-linked"]).toBe(key);
    expect(args.projectNameOverrides?.[key]).toBe("Docker & Containers");
  });

  it("keeps linked-but-unassigned chats in the review table with a flag", async () => {
    vi.mocked(openDialog).mockResolvedValue("/imports/claude");
    const preview = claudePreviewWithLinks();
    // The linked chat sits in Unassigned Imports → reviewable, not auto-merge.
    preview.linked_unassigned = preview.linked_conversations;
    preview.linked_conversations = {};
    vi.mocked(api.chatFile.previewClaudeFiles).mockResolvedValueOnce(preview);

    renderImportSettings();
    fireEvent.click(screen.getAllByText("Select")[2]);

    // No auto-merge summary (nothing is silently linked).
    expect(await screen.findByText(/2 conversations$/)).toBeInTheDocument();
    expect(screen.queryByText(/will merge automatically/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/2 conversations$/));
    expect(screen.getByText(/imported, still unassigned/)).toBeInTheDocument();
    expect(screen.getByText(/Already imported chat/)).toBeInTheDocument();
  });
});
