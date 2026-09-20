import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ClaudeProjectMemoriesPanel } from "../../components/ClaudeProjectMemoriesPanel";

const previewClaudeProjectMemories = vi.fn();
const importClaudeProjectMemories = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    chatFile: {
      previewClaudeProjectMemories: (...args: unknown[]) => previewClaudeProjectMemories(...args),
      importClaudeProjectMemories: (...args: unknown[]) => importClaudeProjectMemories(...args),
    },
  },
}));

const mockState = {
  workspaces: [
    { id: "ws-1", name: "Software Engineering Prep" },
    { id: "ws-2", name: "General" },
  ],
};

vi.mock("../../stores/workspaceStore", () => {
  const hook = (selector: (s: typeof mockState) => unknown) => selector(mockState);
  hook.getState = () => mockState;
  return { useWorkspaceStore: hook };
});

describe("ClaudeProjectMemoriesPanel", () => {
  beforeEach(() => {
    previewClaudeProjectMemories.mockReset();
    importClaudeProjectMemories.mockReset();
  });

  it("renders nothing without a folder", () => {
    const { container } = render(<ClaudeProjectMemoriesPanel folderPath={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(previewClaudeProjectMemories).not.toHaveBeenCalled();
  });

  it("renders nothing when there are no project memories", async () => {
    previewClaudeProjectMemories.mockResolvedValue({ total: 0, memories: [] });
    const { container } = render(<ClaudeProjectMemoriesPanel folderPath="/export" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("lists project memories with project names and preselects actionable ones", async () => {
    previewClaudeProjectMemories.mockResolvedValue({
      total: 2,
      memories: [
        {
          project_uuid: "p-1",
          project_name: "Software Engineering Prep",
          memory: "- Daniel is a remote engineer\n- SWE prep covers algorithms",
          status: "new",
        },
        {
          project_uuid: "p-2",
          project_name: "Old Project",
          memory: "Old memory",
          status: "unchanged",
        },
      ],
    });

    render(<ClaudeProjectMemoriesPanel folderPath="/export" />);

    await screen.findByText("Software Engineering Prep");
    expect(screen.getByText("Old Project")).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    // Toggle expand preview
    const expandBtn = screen.getAllByTitle(/expand preview/i)[0];
    fireEvent.click(expandBtn);
    expect(screen.getByText(/- Daniel is a remote engineer/)).toBeInTheDocument();
  });

  it("imports selected project memories into target workspaces", async () => {
    previewClaudeProjectMemories.mockResolvedValue({
      total: 1,
      memories: [
        {
          project_uuid: "p-1",
          project_name: "Software Engineering Prep",
          memory: "- Daniel is a remote engineer",
          status: "new",
        },
      ],
    });
    importClaudeProjectMemories.mockResolvedValue({ imported: 1, updated: 0, skipped: 0 });

    render(<ClaudeProjectMemoriesPanel folderPath="/export" />);
    await screen.findByText("Software Engineering Prep");

    fireEvent.click(screen.getByRole("button", { name: /import project memories/i }));

    await waitFor(() =>
      expect(importClaudeProjectMemories).toHaveBeenCalledWith("/export", {
        "p-1": { workspace_id: "ws-1", folder_id: "" },
      }),
    );
    await screen.findByText(/1 imported, 0 updated, 0 unchanged/);
  });

  it("surfaces errors when preview fails", async () => {
    previewClaudeProjectMemories.mockRejectedValue(new Error("Disk error"));
    render(<ClaudeProjectMemoriesPanel folderPath="/export" />);
    await screen.findByText(/could not read project memories/i);
  });
});
