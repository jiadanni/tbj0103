import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SelectiveImportDialog from "@/components/SelectiveImportDialog";
import { api } from "@/lib/api";
import type { BackupPreview } from "@/lib/api";

vi.mock("lucide-react", () => ({
  AlertTriangle: () => <div data-testid="icon-alert" />,
  CheckSquare: () => <div data-testid="icon-check-square" />,
  RefreshCw: () => <div data-testid="icon-refresh" />,
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
});
