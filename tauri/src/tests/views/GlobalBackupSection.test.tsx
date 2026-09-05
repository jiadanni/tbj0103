import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import GlobalBackupSection from "@/views/GlobalBackupSection";
import { api } from "@/lib/api";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

vi.mock("@/lib/api", () => ({
  api: {
    backup: {
      createGlobal: vi.fn(() => Promise.resolve("{}")),
      restoreGlobal: vi.fn(() => Promise.resolve(null)),
      preview: vi.fn(),
      importSelective: vi.fn(),
    },
    workspace: {
      list: vi.fn(() => Promise.resolve([])),
    },
    folder: {
      list: vi.fn(() => Promise.resolve([])),
    },
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

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: () => ({
    setWorkspaces: vi.fn(),
    setActiveWorkspaceId: vi.fn(),
    setFoldersForWorkspace: vi.fn(),
  }),
}));

describe("GlobalBackupSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the create and restore backup sections", () => {
    render(<GlobalBackupSection />);
    expect(screen.getByText("Create Global Backup")).toBeInTheDocument();
    expect(screen.getByText("Restore Global Backup")).toBeInTheDocument();
  });

  it("renders the export and restore action buttons in their idle state", () => {
    render(<GlobalBackupSection />);
    expect(screen.getByRole("button", { name: /Export/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Restore/ })).toBeEnabled();
  });

  it("describes what each backup action does", () => {
    render(<GlobalBackupSection />);
    expect(screen.getByText(/Save all workspaces/)).toBeInTheDocument();
    expect(
      screen.getByText(/Open an Aetherium global backup file/),
    ).toBeInTheDocument();
  });

  it("previews the chosen file and opens the selective import dialog", async () => {
    vi.mocked(openDialog).mockResolvedValue("/backups/global.json");
    vi.mocked(readTextFile).mockResolvedValue('{"is_global":true}');
    vi.mocked(api.backup.preview).mockResolvedValue({
      is_global: true,
      created_at: "2026-01-15T10:00:00Z",
      app_version: "0.1.0",
      workspaces: [
        {
          id: "ws-a",
          name: "Research",
          exists_locally: false,
          categories: [{ id: "chats", label: "Chats & messages", row_count: 12 }],
        },
      ],
    });

    render(<GlobalBackupSection />);
    fireEvent.click(screen.getByRole("button", { name: /Selective import/ }));

    await waitFor(() => {
      expect(api.backup.preview).toHaveBeenCalledWith('{"is_global":true}');
    });
    expect(await screen.findByText("Import from backup")).toBeInTheDocument();
    // A preview must never mutate anything on its own.
    expect(api.backup.importSelective).not.toHaveBeenCalled();
    expect(api.backup.restoreGlobal).not.toHaveBeenCalled();
  });

  it("does not preview when the file picker is cancelled", async () => {
    vi.mocked(openDialog).mockResolvedValue(null);

    render(<GlobalBackupSection />);
    fireEvent.click(screen.getByRole("button", { name: /Selective import/ }));

    await waitFor(() => {
      expect(openDialog).toHaveBeenCalled();
    });
    expect(api.backup.preview).not.toHaveBeenCalled();
  });
});
