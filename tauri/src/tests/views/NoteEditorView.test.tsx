import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const scope = vi.hoisted(() => ({ activeWorkspaceId: "ws-1" }));

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
  useScopedWorkspace: () => scope,
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
import { discardNoteDraft, flushNoteDraft, useNoteDraftStore } from "../../hooks/useNoteDraft";
import { useNoteComposerDraftStore } from "../../hooks/useNoteComposerDraft";

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

  beforeEach(async () => {
    cleanup();
    useNoteComposerDraftStore.setState({ drafts: {} });
    for (const id of Object.keys(useNoteDraftStore.getState().drafts)) {
      await flushNoteDraft(id);
      discardNoteDraft(id);
    }
    vi.clearAllMocks();
    scope.activeWorkspaceId = "ws-1";
    vi.mocked(api.note.update).mockResolvedValue(undefined);
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

  it("flushes a fast close and reopens the latest text with its tags and pin", async () => {
    render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    fireEvent.click(await screen.findByText("First Note"));
    fireEvent.change(screen.getByTestId("smart-editor"), { target: { value: "Edited immediately" } });
    fireEvent.click(screen.getByLabelText("Pin note"));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close note"));
    await waitFor(() => expect(screen.queryByTestId("smart-editor")).not.toBeInTheDocument());
    expect(api.note.update).toHaveBeenLastCalledWith("note-1", expect.objectContaining({
      content: "Edited immediately", tags: ["tag1"], is_pinned: true,
    }));
    fireEvent.click(screen.getByText("First Note"));
    expect(screen.getByTestId("smart-editor")).toHaveValue("Edited immediately");
  });

  it("keeps the modal open and exposes retry when close cannot save", async () => {
    vi.mocked(api.note.update).mockRejectedValueOnce(new Error("Disk full"));
    render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    fireEvent.click(await screen.findByText("First Note"));
    fireEvent.change(screen.getByTestId("smart-editor"), { target: { value: "Do not lose" } });
    fireEvent.click(screen.getByLabelText("Close note"));
    await screen.findByText("Not saved");
    expect(screen.getByTestId("smart-editor")).toHaveValue("Do not lose");
    expect(screen.getAllByRole("alert").some((node) => node.textContent?.includes("Disk full"))).toBe(true);
    fireEvent.click(screen.getByLabelText("Close note"));
    await waitFor(() => expect(screen.queryByTestId("smart-editor")).not.toBeInTheDocument());
  });

  it("flushes edited text when the library unmounts", async () => {
    const view = render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    fireEvent.click(await screen.findByText("First Note"));
    fireEvent.change(screen.getByTestId("smart-editor"), { target: { value: "Navigation draft" } });
    await act(async () => { view.unmount(); });
    expect(api.note.update).toHaveBeenCalledWith("note-1", expect.objectContaining({ content: "Navigation draft" }));
  });

  it("does not seed a second note with the first note's edit buffer", async () => {
    vi.mocked(api.note.list).mockResolvedValue([...mockNotes, { ...mockNotes[0], id: "note-2", title: "Second Note", content: "Second content" }]);
    render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    fireEvent.click(await screen.findByText("First Note"));
    fireEvent.change(screen.getByTestId("smart-editor"), { target: { value: "First draft" } });
    fireEvent.click(screen.getByText("Second Note"));
    expect(screen.getByTestId("smart-editor")).toHaveValue("Second content");
    fireEvent.change(screen.getByTestId("smart-editor"), { target: { value: "Second draft" } });
    fireEvent.click(screen.getByLabelText("Close note"));
    await waitFor(() => expect(screen.queryByTestId("smart-editor")).not.toBeInTheDocument());
    expect(api.note.update).toHaveBeenCalledWith("note-1", expect.objectContaining({ content: "First draft" }));
    expect(api.note.update).toHaveBeenCalledWith("note-2", expect.objectContaining({ content: "Second draft" }));
  });

  it("submits a composer only once when closed again while creation is pending", async () => {
    let resolve!: (note: typeof mockNotes[number]) => void;
    vi.mocked(api.note.create).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    fireEvent.click(screen.getByText("Take a note…"));
    fireEvent.change(screen.getByPlaceholderText("Title"), { target: { value: "New draft" } });
    fireEvent.click(screen.getByText("Close"));
    fireEvent.mouseDown(document.body);
    expect(api.note.create).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ ...mockNotes[0], id: "created", title: "New draft" }); });
    expect(screen.getByText("Take a note…")).toBeInTheDocument();
  });

  it("retains composer fields and shows errors after a failed creation", async () => {
    vi.mocked(api.note.create).mockRejectedValueOnce(new Error("Write failed"));
    render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    fireEvent.click(screen.getByText("Take a note…"));
    fireEvent.change(screen.getByPlaceholderText("Title"), { target: { value: "Retry me" } });
    fireEvent.click(screen.getByText("Close"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Write failed");
    expect(screen.getByPlaceholderText("Title")).toHaveValue("Retry me");
  });

  it("flushes into the original note on workspace navigation without leaking its modal", async () => {
    const view = render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    fireEvent.click(await screen.findByText("First Note"));
    fireEvent.change(screen.getByTestId("smart-editor"), { target: { value: "Workspace one draft" } });
    vi.mocked(api.note.list).mockResolvedValue([]);
    scope.activeWorkspaceId = "ws-2";
    view.rerender(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    expect(screen.queryByTestId("smart-editor")).not.toBeInTheDocument();
    await waitFor(() => expect(api.note.update).toHaveBeenCalledWith("note-1", {
      title: "First Note", content: "Workspace one draft", tags: ["tag1"], is_pinned: false,
    }));
    expect(screen.queryByText("First Note")).not.toBeInTheDocument();
  });

  it("retries composer metadata against the created note rather than duplicating it", async () => {
    vi.mocked(api.note.create).mockResolvedValue({ ...mockNotes[0], id: "created", title: "Tagged" });
    vi.mocked(api.note.update).mockRejectedValueOnce(new Error("Metadata write failed"));
    render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    fireEvent.click(screen.getByText("Take a note…"));
    fireEvent.change(screen.getByPlaceholderText("Title"), { target: { value: "Tagged" } });
    fireEvent.change(screen.getByPlaceholderText("Add tag…"), { target: { value: "New tag" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Add tag…"), { key: "Enter" });
    fireEvent.click(screen.getByText("Close"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Metadata write failed");
    fireEvent.click(screen.getByText("Retry save"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(api.note.create).toHaveBeenCalledTimes(1);
    expect(api.note.update).toHaveBeenLastCalledWith("created", expect.objectContaining({ tags: ["New tag"] }));
  });

  it("retains composer text and failure in the originating workspace after navigation", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(api.note.create).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const view = render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    fireEvent.click(screen.getByText("Take a note…"));
    fireEvent.change(screen.getByPlaceholderText("Title"), { target: { value: "Uncreated note" } });
    fireEvent.change(screen.getByPlaceholderText("Take a note…"), { target: { value: "Keep this body" } });
    fireEvent.click(screen.getByLabelText("Pin draft note"));
    fireEvent.mouseDown(document.body);
    expect(api.note.create).toHaveBeenCalledWith("ws-1", "Uncreated note", "Keep this body", null, true);
    scope.activeWorkspaceId = "ws-2";
    view.rerender(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    await act(async () => { reject(new Error("Creation rejected")); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Take a note…")).toBeInTheDocument();
    scope.activeWorkspaceId = "ws-1";
    view.rerender(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    expect(screen.getByPlaceholderText("Title")).toHaveValue("Uncreated note");
    expect(screen.getByPlaceholderText("Take a note…")).toHaveValue("Keep this body");
    expect(screen.getByLabelText("Unpin draft note")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Creation rejected");
    vi.mocked(api.note.create).mockResolvedValueOnce({ ...mockNotes[0], id: "retry", is_pinned: true });
    fireEvent.click(screen.getByText("Close"));
    await screen.findByText("Take a note…");
    expect(useNoteComposerDraftStore.getState().drafts["ws-1"]).toBeUndefined();
  });

  it("retains an unsubmitted composer draft when navigation does not click outside", async () => {
    const view = render(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    fireEvent.click(screen.getByText("Take a note…"));
    fireEvent.change(screen.getByPlaceholderText("Title"), { target: { value: "Keyboard navigation" } });
    scope.activeWorkspaceId = "ws-2";
    view.rerender(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    scope.activeWorkspaceId = "ws-1";
    view.rerender(<MemoryRouter><NoteEditorView /></MemoryRouter>);
    expect(screen.getByPlaceholderText("Title")).toHaveValue("Keyboard navigation");
    expect(api.note.create).not.toHaveBeenCalled();
    await act(async () => { view.unmount(); });
  });
});
