import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import BackupSettingsSection from "@/views/BackupSettingsSection";
import { api } from "@/lib/api";
import { open as openDialog, message as showMessage } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

vi.mock("@/lib/api", () => ({
  api: {
    backup: {
      create: vi.fn(() => Promise.resolve("{}")),
      restore: vi.fn(() => Promise.resolve("ws-a")),
      preview: vi.fn(),
      importSelective: vi.fn(),
    },
    workspace: { list: vi.fn(() => Promise.resolve([])) },
    folder: { list: vi.fn(() => Promise.resolve([])) },
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  open: vi.fn(),
  confirm: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
}));

const workspace = { id: "ws-a", name: "Research" };

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: (selector: (state: unknown) => unknown) =>
    selector({
      workspaces: [workspace],
      activeWorkspaceId: "ws-a",
      setActiveWorkspaceId: vi.fn(),
      setActiveFolderId: vi.fn(),
      setFoldersForWorkspace: vi.fn(),
      setWorkspaces: vi.fn(),
    }),
}));

function previewFixture() {
  return {
    is_global: false,
    created_at: "2026-01-15T10:00:00Z",
    app_version: "0.1.0",
    workspaces: [
      {
        id: "ws-a",
        name: "Research",
        exists_locally: true,
        categories: [
          { id: "chats", label: "Chats & messages", row_count: 42 },
          { id: "notes", label: "Notes & templates", row_count: 7 },
        ],
      },
    ],
  };
}

describe("BackupSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders both backup cards with their actions", () => {
    render(<BackupSettingsSection />);

    expect(screen.getByText("Create Backup File")).toBeInTheDocument();
    expect(screen.getByText("Restore Backup File")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Restore$/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Selective import/ })).toBeEnabled();
  });

  it("previews the chosen file and opens the selective import dialog", async () => {
    vi.mocked(openDialog).mockResolvedValue("/backups/research.json");
    vi.mocked(readTextFile).mockResolvedValue('{"workspace":{"id":"ws-a"}}');
    vi.mocked(api.backup.preview).mockResolvedValue(previewFixture());

    render(<BackupSettingsSection />);
    fireEvent.click(screen.getByRole("button", { name: /Selective import/ }));

    await waitFor(() => {
      expect(api.backup.preview).toHaveBeenCalledWith('{"workspace":{"id":"ws-a"}}');
    });
    expect(await screen.findByText("Import from backup")).toBeInTheDocument();
    // Previewing must not restore anything by itself.
    expect(api.backup.restore).not.toHaveBeenCalled();
    expect(api.backup.importSelective).not.toHaveBeenCalled();
  });

  it("surfaces a preview failure instead of opening the dialog", async () => {
    vi.mocked(openDialog).mockResolvedValue("/backups/broken.json");
    vi.mocked(readTextFile).mockResolvedValue("not json");
    vi.mocked(api.backup.preview).mockRejectedValue(new Error("Invalid backup JSON"));

    render(<BackupSettingsSection />);
    fireEvent.click(screen.getByRole("button", { name: /Selective import/ }));

    expect(await screen.findByText("Invalid backup JSON")).toBeInTheDocument();
    expect(screen.queryByText("Import from backup")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(showMessage).toHaveBeenCalledWith("Invalid backup JSON", {
        title: "Could not read backup",
        kind: "error",
      });
    });
  });

  it("does not preview when the file picker is cancelled", async () => {
    vi.mocked(openDialog).mockResolvedValue(null);

    render(<BackupSettingsSection />);
    fireEvent.click(screen.getByRole("button", { name: /Selective import/ }));

    await waitFor(() => {
      expect(openDialog).toHaveBeenCalled();
    });
    expect(api.backup.preview).not.toHaveBeenCalled();
  });
});
