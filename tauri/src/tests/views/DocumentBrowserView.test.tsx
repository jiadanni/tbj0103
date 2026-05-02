import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import DocumentBrowserView from "../../views/DocumentBrowserView";
import { api } from "../../lib/api";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

// Mock lucide-react
vi.mock("lucide-react", () => ({
  Upload: () => <div data-testid="icon-upload" />,
  File: () => <div data-testid="icon-file" />,
  Trash2: () => <div data-testid="icon-trash" />,
  Cpu: () => <div data-testid="icon-cpu" />,
  X: () => <div data-testid="icon-x" />,
}));

// Mock tauri plugins
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
}));

// Mock workspace hook
vi.mock("../../lib/workspacePane", () => ({
  useScopedWorkspace: () => ({ activeWorkspaceId: "ws-1" }),
}));

// Mock API
vi.mock("../../lib/api", () => ({
  api: {
    document: {
      list: vi.fn(),
      upload: vi.fn(),
      delete: vi.fn(),
      process: vi.fn(),
    },
  },
}));

describe("DocumentBrowserView", () => {
  const mockDocs = [
    {
      id: "doc-1",
      workspace_id: "ws-1",
      filename: "test.md",
      file_type: "md",
      file_size: 100,
      content: "Hello",
      is_processed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.document.list).mockResolvedValue(mockDocs as unknown as never[]);
  });

  it("lists documents on load", async () => {
    render(<DocumentBrowserView />);
    await waitFor(() => {
      expect(screen.getByText("test.md")).toBeDefined();
    });
  });

  it("handles file upload", async () => {
    vi.mocked(openDialog).mockResolvedValue(["/path/to/new.txt"] as unknown as never);
    vi.mocked(readTextFile).mockResolvedValue("new content" as unknown as never);
    vi.mocked(api.document.upload).mockResolvedValue({
      id: "doc-2",
      workspace_id: "ws-1",
      filename: "new.txt",
      file_type: "txt",
      file_size: 11,
      content: "new content",
      is_processed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    render(<DocumentBrowserView />);
    
    const uploadBtn = await screen.findByText("Upload");
    fireEvent.click(uploadBtn);

    await waitFor(() => {
      expect(api.document.upload).toHaveBeenCalledWith(
        "ws-1", "new.txt", "txt", 11, "new content"
      );
      expect(screen.getByText("new.txt")).toBeDefined();
    });
  });

  it("deletes a document", async () => {
    render(<DocumentBrowserView />);
    
    await waitFor(() => screen.getByText("test.md"));
    
    const deleteBtn = screen.getByTestId("icon-trash");
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(api.document.delete).toHaveBeenCalledWith("doc-1");
      expect(screen.queryByText("test.md")).toBeNull();
    });
  });
});
