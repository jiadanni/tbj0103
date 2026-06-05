import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

function makeIcon(testid: string) {
  const C: React.FC = () => <div data-testid={testid} />;
  C.displayName = testid;
  return C;
}
vi.mock("lucide-react", () => ({
  Plus: makeIcon("icon-plus"),
  Trash2: makeIcon("icon-trash"),
  Tag: makeIcon("icon-tag"),
  Pin: makeIcon("icon-pin"),
  FileText: makeIcon("icon-file-text"),
  Save: makeIcon("icon-save"),
  Sparkles: makeIcon("icon-sparkles"),
  Loader: makeIcon("icon-loader"),
  Upload: makeIcon("icon-upload"),
  Globe: makeIcon("icon-globe"),
  Cpu: makeIcon("icon-cpu"),
  X: makeIcon("icon-x"),
  ExternalLink: makeIcon("icon-external-link"),
  File: makeIcon("icon-file"),
  Image: makeIcon("icon-image"),
  Type: makeIcon("icon-type"),
  Palette: makeIcon("icon-palette"),
  Bell: makeIcon("icon-bell"),
  UserPlus: makeIcon("icon-user-plus"),
  MoreVertical: makeIcon("icon-more"),
  Undo2: makeIcon("icon-undo"),
  Redo2: makeIcon("icon-redo"),
  Search: makeIcon("icon-search"),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(() => Promise.resolve(true)),
  message: vi.fn(),
  open: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: vi.fn(() => Promise.resolve("")) }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

vi.mock("../../lib/workspacePane", () => ({
  useScopedWorkspace: () => ({ activeWorkspaceId: "ws-1" }),
  useBubbleUpFlag: () => false,
}));

vi.mock("../../components/SmartTextEditor", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="smart-editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

vi.mock("../../components/Tooltip", () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

vi.mock("../../stores/workspaceStore", () => ({
  useWorkspaceStore: (sel: (s: { isDemoMode: boolean }) => unknown) => sel({ isDemoMode: false }),
}));
vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: (sel: (s: { preferredModel: string; ollamaUrl: string }) => unknown) =>
    sel({ preferredModel: "", ollamaUrl: "" }),
}));

vi.mock("../../lib/api", () => ({
  api: {
    note: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    source: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), process: vi.fn() },
    flashcard: { extractFromContent: vi.fn() },
  },
}));

import NoteEditorView from "../../views/NoteEditorView";
import { api } from "../../lib/api";

describe("NoteEditorView", () => {
  const mockNotes = [
    {
      id: "note-1",
      workspace_id: "ws-1",
      title: "First Note",
      content: "Content 1",
      note_type: "general",
      tags: ["tag1"],
      is_pinned: false,
      folder: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.note.list).mockResolvedValue(mockNotes as unknown as never[]);
    vi.mocked(api.source.list).mockResolvedValue([] as unknown as never[]);
  });

  it("renders notes as cards in the Keep-style grid", async () => {
    render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    await waitFor(() => { expect(screen.getByText("First Note")).toBeInTheDocument(); });
    expect(screen.getByText("Content 1")).toBeInTheDocument();
    expect(screen.getByText("tag1")).toBeInTheDocument();
  });

  it("opens a note in the modal when its card is clicked", async () => {
    render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    await waitFor(() => { expect(screen.getByText("First Note")).toBeInTheDocument(); });
    fireEvent.click(screen.getByText("First Note"));
    await waitFor(() => {
      expect((screen.getByTestId("smart-editor") as HTMLTextAreaElement).value).toBe("Content 1");
    });
  });

  it("creates a blank note from the header + button", async () => {
    const newNote = {
      id: "note-2",
      workspace_id: "ws-1",
      title: "Untitled Note",
      content: "",
      note_type: "general",
      tags: [],
      is_pinned: false,
      folder: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    vi.mocked(api.note.create).mockResolvedValue(newNote as unknown as never);

    render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    await waitFor(() => expect(api.note.list).toHaveBeenCalled());

    // The Plus icon belongs to the header "New note" button.
    fireEvent.click(screen.getAllByTestId("icon-plus")[0]);

    await waitFor(() => {
      expect(api.note.create).toHaveBeenCalledWith("ws-1", "Untitled Note");
    });
  });

  it("renders sources alongside notes in the unified grid", async () => {
    vi.mocked(api.source.list).mockResolvedValue([
      {
        id: "src-1",
        workspace_id: "ws-1",
        source_type: "document",
        title: "My Source",
        content: "",
        is_processed: false,
        folder: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ] as unknown as never[]);

    render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText("First Note")).toBeInTheDocument();
      expect(screen.getByText("My Source")).toBeInTheDocument();
    });
  });

  it("deletes a note from the card action without opening the editor", async () => {
    vi.mocked(api.note.delete).mockResolvedValue(undefined as never);

    render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    await waitFor(() => { expect(screen.getByText("First Note")).toBeInTheDocument(); });

    fireEvent.click(screen.getByLabelText("Delete note"));

    await waitFor(() => {
      expect(api.note.delete).toHaveBeenCalledWith("note-1");
    });
    expect(screen.queryByTestId("smart-editor")).not.toBeInTheDocument();
  });

  it("creates a pinned note from the composer pin button", async () => {
    const pinnedNote = {
      id: "note-3",
      workspace_id: "ws-1",
      title: "Pinned note",
      content: "Pinned content",
      note_type: "general",
      tags: [],
      is_pinned: true,
      folder: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    vi.mocked(api.note.create).mockResolvedValue(pinnedNote as unknown as never);
    vi.mocked(api.note.update).mockResolvedValue(undefined as never);

    render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    fireEvent.click(screen.getByText("Take a note…"));
    fireEvent.click(screen.getByLabelText("Pin draft note"));
    fireEvent.change(screen.getByPlaceholderText("Title"), { target: { value: "Pinned note" } });
    fireEvent.change(screen.getByPlaceholderText("Take a note…"), { target: { value: "Pinned content" } });
    fireEvent.click(screen.getByText("Close"));

    await waitFor(() => {
      expect(api.note.create).toHaveBeenCalledWith("ws-1", "Pinned note", "Pinned content", null, true);
    });
  });
});
