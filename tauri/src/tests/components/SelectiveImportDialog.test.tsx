import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SelectiveImportDialog from "@/components/SelectiveImportDialog";
import { api } from "@/lib/api";
import type { BackupPreview } from "@/lib/api";

vi.mock("lucide-react", () => ({
  AlertTriangle: () => <div data-testid="icon-alert" />,
  CheckSquare: () => <div data-testid="icon-check-square" />,
  ChevronDown: () => <div data-testid="icon-chevron-down" />,
  ChevronRight: () => <div data-testid="icon-chevron-right" />,
  Folder: () => <div data-testid="icon-folder" />,
  RefreshCw: () => <div data-testid="icon-refresh" />,
  Search: () => <div data-testid="icon-search" />,
  Square: () => <div data-testid="icon-square" />,
  Upload: () => <div data-testid="icon-upload" />,
  X: () => <div data-testid="icon-x" />,
}));

vi.mock("@/lib/api", () => ({
  api: {
    backup: {
      importSelective: vi.fn(),
    },
  },
}));

function categories(chats: number, notes: number, sources = 0) {
  return [
    { id: "chats", label: "Chats & messages", row_count: chats },
    { id: "notes", label: "Notes & templates", row_count: notes },
    { id: "sources", label: "Sources & documents", row_count: sources },
  ];
}

const globalPreview: BackupPreview = {
  is_global: true,
  created_at: "2026-01-15T10:00:00Z",
  app_version: "0.1.0",
  workspaces: [
    { id: "ws-a", name: "Research", exists_locally: true, categories: categories(412, 88) },
    { id: "ws-b", name: "Personal", exists_locally: false, categories: categories(31, 12) },
  ],
};

const singlePreview: BackupPreview = {
  is_global: false,
  created_at: "2026-01-15T10:00:00Z",
  app_version: null,
  workspaces: [
    { id: "ws-a", name: "Research", exists_locally: false, categories: categories(5, 0) },
  ],
};

function renderDialog(preview: BackupPreview, onImported = vi.fn()) {
  const onCancel = vi.fn();
  render(
    <SelectiveImportDialog
      preview={preview}
      backupJson="{}"
      onCancel={onCancel}
      onImported={onImported}
    />,
  );
  return { onCancel, onImported };
}

describe("SelectiveImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.backup.importSelective).mockResolvedValue({
      workspace_ids: ["ws-a"],
      rows_imported: 500,
      per_category: [{ id: "chats", label: "Chats & messages", row_count: 500 }],
    });
  });

  it("lists every workspace in a global backup with its counts", () => {
    renderDialog(globalPreview);

    expect(screen.getByText("Research")).toBeInTheDocument();
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(screen.getByText("Workspaces (2/2)")).toBeInTheDocument();
    expect(screen.getByText("Global backup")).toBeInTheDocument();
  });

  it("hides the workspace picker for a single-workspace backup", () => {
    renderDialog(singlePreview);

    expect(screen.queryByText(/^Workspaces \(/)).not.toBeInTheDocument();
    expect(screen.getByText("Workspace backup")).toBeInTheDocument();
  });

  it("imports every workspace and non-empty category by default", async () => {
    renderDialog(globalPreview);
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => {
      expect(api.backup.importSelective).toHaveBeenCalledWith(
        "{}",
        ["ws-a", "ws-b"],
        ["chats", "notes"], // "sources" has zero rows, so it is left out
        "merge",
      );
    });
  });

  it("sends only the ticked workspaces and categories", async () => {
    renderDialog(globalPreview);

    fireEvent.click(screen.getByRole("checkbox", { name: "Personal" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Chats & messages/ }));
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => {
      expect(api.backup.importSelective).toHaveBeenCalledWith("{}", ["ws-a"], ["notes"], "merge");
    });
  });

  it("passes replace mode when the user opts into it", async () => {
    renderDialog(globalPreview);

    fireEvent.click(screen.getByRole("radio", { name: /Replace workspace/ }));
    fireEvent.click(screen.getByRole("button", { name: /replace & import/i }));

    await waitFor(() => {
      expect(api.backup.importSelective).toHaveBeenCalledWith(
        "{}",
        ["ws-a", "ws-b"],
        ["chats", "notes"],
        "replace",
      );
    });
  });

  it("hides the conflict radios when nothing collides", () => {
    renderDialog(singlePreview);
    expect(screen.queryByRole("radio", { name: /Replace workspace/ })).not.toBeInTheDocument();
  });

  it("disables Import when no workspace is selected", () => {
    renderDialog(globalPreview);

    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(screen.getByRole("button", { name: /^import$/i })).toBeDisabled();
  });

  it("disables Import when every category is unticked", () => {
    renderDialog(globalPreview);

    fireEvent.click(screen.getByRole("checkbox", { name: /Chats & messages/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Notes & templates/ }));
    expect(screen.getByRole("button", { name: /^import$/i })).toBeDisabled();
  });

  it("reports the imported result to the caller", async () => {
    const { onImported } = renderDialog(globalPreview);
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith(
        expect.objectContaining({ rows_imported: 500, workspace_ids: ["ws-a"] }),
      );
    });
  });

  it("surfaces a backend error without closing the dialog", async () => {
    vi.mocked(api.backup.importSelective).mockRejectedValue(new Error("FOREIGN KEY constraint failed"));
    const { onImported } = renderDialog(globalPreview);

    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));

    expect(await screen.findByText("FOREIGN KEY constraint failed")).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("displays individual chats picker when chats are present and expands on click", () => {
    const previewWithChats: BackupPreview = {
      is_global: false,
      created_at: "2026-01-15T10:00:00Z",
      app_version: "0.1.0",
      workspaces: [
        {
          id: "ws-a",
          name: "Research",
          exists_locally: false,
          categories: categories(2, 0),
          chats: [
            {
              id: "chat-1",
              title: "Quantum Computing Discussion",
              workspace_id: "ws-a",
              folder_id: "f-1",
              folder_name: "Physics",
              message_count: 5,
              updated_at: "2026-01-15T10:00:00Z",
            },
            {
              id: "chat-2",
              title: "Neural Networks Overview",
              workspace_id: "ws-a",
              folder_id: null,
              folder_name: null,
              message_count: 10,
              updated_at: "2026-01-16T12:00:00Z",
            },
          ],
        },
      ],
    };

    renderDialog(previewWithChats);

    expect(screen.getByText("Individual chats (2/2 selected)")).toBeInTheDocument();
    expect(screen.queryByText("Quantum Computing Discussion")).not.toBeInTheDocument();

    // Expand individual chats
    fireEvent.click(screen.getByText("Individual chats (2/2 selected)"));
    expect(screen.getByText("Quantum Computing Discussion")).toBeInTheDocument();
    expect(screen.getByText("Neural Networks Overview")).toBeInTheDocument();
    expect(screen.getByText("Physics")).toBeInTheDocument();
    expect(screen.getByText("5 messages")).toBeInTheDocument();
    expect(screen.getByText("10 messages")).toBeInTheDocument();
  });

  it("filters individual chats using the search input", () => {
    const previewWithChats: BackupPreview = {
      is_global: false,
      created_at: "2026-01-15T10:00:00Z",
      app_version: "0.1.0",
      workspaces: [
        {
          id: "ws-a",
          name: "Research",
          exists_locally: false,
          categories: categories(2, 0),
          chats: [
            {
              id: "chat-1",
              title: "Quantum Computing Discussion",
              workspace_id: "ws-a",
              folder_id: "f-1",
              folder_name: "Physics",
              message_count: 5,
              updated_at: "2026-01-15T10:00:00Z",
            },
            {
              id: "chat-2",
              title: "Neural Networks Overview",
              workspace_id: "ws-a",
              folder_id: null,
              folder_name: null,
              message_count: 10,
              updated_at: "2026-01-16T12:00:00Z",
            },
          ],
        },
      ],
    };

    renderDialog(previewWithChats);
    fireEvent.click(screen.getByText("Individual chats (2/2 selected)"));

    const searchInput = screen.getByPlaceholderText(/Filter chats by title/);
    fireEvent.change(searchInput, { target: { value: "Quantum" } });

    expect(screen.getByText("Quantum Computing Discussion")).toBeInTheDocument();
    expect(screen.queryByText("Neural Networks Overview")).not.toBeInTheDocument();
  });

  it("sends only selected chat IDs when individual chats are unchecked", async () => {
    const previewWithChats: BackupPreview = {
      is_global: false,
      created_at: "2026-01-15T10:00:00Z",
      app_version: "0.1.0",
      workspaces: [
        {
          id: "ws-a",
          name: "Research",
          exists_locally: false,
          categories: categories(2, 1),
          chats: [
            {
              id: "chat-1",
              title: "Quantum Computing Discussion",
              workspace_id: "ws-a",
              folder_id: null,
              folder_name: null,
              message_count: 5,
              updated_at: "2026-01-15T10:00:00Z",
            },
            {
              id: "chat-2",
              title: "Neural Networks Overview",
              workspace_id: "ws-a",
              folder_id: null,
              folder_name: null,
              message_count: 10,
              updated_at: "2026-01-16T12:00:00Z",
            },
          ],
        },
      ],
    };

    renderDialog(previewWithChats);
    fireEvent.click(screen.getByText("Individual chats (2/2 selected)"));

    // Uncheck chat-2
    fireEvent.click(screen.getByRole("checkbox", { name: "Neural Networks Overview" }));
    expect(screen.getByText("Individual chats (1/2 selected)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => {
      expect(api.backup.importSelective).toHaveBeenCalledWith(
        "{}",
        ["ws-a"],
        ["chats", "notes"],
        "merge",
        ["chat-1"],
      );
    });
  });

  it("supports None and All buttons for individual chats", async () => {
    const previewWithChats: BackupPreview = {
      is_global: false,
      created_at: "2026-01-15T10:00:00Z",
      app_version: "0.1.0",
      workspaces: [
        {
          id: "ws-a",
          name: "Research",
          exists_locally: false,
          categories: categories(2, 0),
          chats: [
            {
              id: "chat-1",
              title: "Chat 1",
              workspace_id: "ws-a",
              folder_id: null,
              folder_name: null,
              message_count: 1,
              updated_at: null,
            },
            {
              id: "chat-2",
              title: "Chat 2",
              workspace_id: "ws-a",
              folder_id: null,
              folder_name: null,
              message_count: 2,
              updated_at: null,
            },
          ],
        },
      ],
    };

    renderDialog(previewWithChats);

    // Deselect all chats
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(screen.getByText("Individual chats (0/2 selected)")).toBeInTheDocument();
    // Since only chats was active and 0 are selected, Import should be disabled
    expect(screen.getByRole("button", { name: /^import$/i })).toBeDisabled();

    // Re-select all chats
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Individual chats (2/2 selected)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^import$/i })).toBeEnabled();
  });
});
