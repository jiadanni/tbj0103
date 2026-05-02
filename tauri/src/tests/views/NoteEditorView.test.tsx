import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NoteEditorView from "../../views/NoteEditorView";
import { api } from "../../lib/api";

// Mock lucide-react
vi.mock("lucide-react", () => ({
  Plus: () => <div data-testid="icon-plus" />,
  Trash2: () => <div data-testid="icon-trash" />,
  Tag: () => <div data-testid="icon-tag" />,
  Search: () => <div data-testid="icon-search" />,
  FileText: () => <div data-testid="icon-file-text" />,
  Save: () => <div data-testid="icon-save" />,
  Calendar: () => <div data-testid="icon-calendar" />,
  Sparkles: () => <div data-testid="icon-sparkles" />,
  Loader: () => <div data-testid="icon-loader" />,
  X: () => <div data-testid="icon-x" />,
}));

// Mock tauri plugins
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(() => Promise.resolve(true)),
  message: vi.fn(),
}));

// Mock workspace hook
vi.mock("../../lib/workspacePane", () => ({
  useScopedWorkspace: () => ({ activeWorkspaceId: "ws-1" }),
}));

// Mock SmartTextEditor
vi.mock("../../components/SmartTextEditor", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea 
      data-testid="smart-editor" 
      value={value} 
      onChange={(e) => onChange(e.target.value)} 
    />
  ),
}));

// Mock API
vi.mock("../../lib/api", () => ({
  api: {
    note: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    dailyNote: {
      get: vi.fn(() => Promise.resolve(null)),
    }
  },
}));

describe("NoteEditorView", () => {
  const mockNotes = [
    {
      id: "note-1",
      workspace_id: "ws-1",
      title: "First Note",
      content: "Content 1",
      note_type: "general",
      tags: ["tag1"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.note.list).mockResolvedValue(mockNotes as unknown as never[]);
  });

  it("lists notes and allows selection", async () => {
    render(
      <MemoryRouter>
        <NoteEditorView />
      </MemoryRouter>
    );
    
    await waitFor(() => {
      expect(screen.getByText("First Note")).toBeDefined();
    });

    fireEvent.click(screen.getByText("First Note"));
    
    await waitFor(() => {
      expect((screen.getByTestId("smart-editor") as HTMLTextAreaElement).value).toBe("Content 1");
    });
  });

  it("creates a new note", async () => {
    const newNote = {
      id: "note-2",
      workspace_id: "ws-1",
      title: "Untitled Note",
      content: "",
      note_type: "general",
      tags: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    vi.mocked(api.note.create).mockResolvedValue(newNote as unknown as never);

    render(
      <MemoryRouter>
        <NoteEditorView />
      </MemoryRouter>
    );

    const createBtn = screen.getByTestId("icon-plus");
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(api.note.create).toHaveBeenCalledWith("ws-1", "Untitled Note");
      expect(screen.getByText("Untitled Note")).toBeDefined();
    });
  });
});
