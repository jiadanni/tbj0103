import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import GlobalBackupSection from "@/views/GlobalBackupSection";

vi.mock("@/lib/api", () => ({
  api: {
    backup: {
      createGlobal: vi.fn(() => Promise.resolve("{}")),
      restoreGlobal: vi.fn(() => Promise.resolve(null)),
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
});
