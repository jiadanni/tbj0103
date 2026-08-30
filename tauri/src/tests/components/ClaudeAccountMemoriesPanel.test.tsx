import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ClaudeAccountMemoriesPanel } from "../../components/ClaudeAccountMemoriesPanel";

const previewClaudeAccountMemories = vi.fn();
const importClaudeAccountMemories = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    chatFile: {
      previewClaudeAccountMemories: (...args: unknown[]) => previewClaudeAccountMemories(...args),
      importClaudeAccountMemories: (...args: unknown[]) => importClaudeAccountMemories(...args),
    },
  },
}));

const memory = (key: string, content: string, status: "new" | "updated" | "unchanged", category = "Topics") => ({
  key,
  category,
  label: "Fitness",
  content,
  kind: "fact" as const,
  updated_at: null,
  status,
});

describe("ClaudeAccountMemoriesPanel", () => {
  beforeEach(() => {
    previewClaudeAccountMemories.mockReset();
    importClaudeAccountMemories.mockReset();
  });

  it("renders nothing without a folder", () => {
    const { container } = render(<ClaudeAccountMemoriesPanel folderPath={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(previewClaudeAccountMemories).not.toHaveBeenCalled();
  });

  it("renders nothing when the export has no account memories (v2)", async () => {
    previewClaudeAccountMemories.mockResolvedValue({ total: 0, memories: [] });
    const { container } = render(<ClaudeAccountMemoriesPanel folderPath="/export" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("lists memories grouped by category and preselects only actionable ones", async () => {
    previewClaudeAccountMemories.mockResolvedValue({
      total: 3,
      memories: [
        memory("topics/fitness.md#0", "Strong interest in fitness", "new"),
        memory("profile.md#0", "Based in a coastal city", "unchanged", "Profile"),
        memory("profile.md#1", "Works at an example company", "updated", "Profile"),
      ],
    });

    render(<ClaudeAccountMemoriesPanel folderPath="/export" />);

    await screen.findByText("Strong interest in fitness");
    expect(screen.getByText("Topics")).toBeInTheDocument();
    expect(screen.getByText("Profile")).toBeInTheDocument();

    // The already-imported entry must not be selected by default, so a repeat
    // import is a no-op rather than rewriting unchanged rows.
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("imports only the selected keys and reports the result", async () => {
    previewClaudeAccountMemories.mockResolvedValue({
      total: 2,
      memories: [
        memory("topics/fitness.md#0", "Strong interest in fitness", "new"),
        memory("profile.md#0", "Based in a coastal city", "new", "Profile"),
      ],
    });
    importClaudeAccountMemories.mockResolvedValue({ imported: 1, updated: 0, skipped: 0 });

    render(<ClaudeAccountMemoriesPanel folderPath="/export" />);
    await screen.findByText("Strong interest in fitness");

    // Deselect one, leaving a single key to import.
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    previewClaudeAccountMemories.mockResolvedValue({
      total: 2,
      memories: [
        memory("topics/fitness.md#0", "Strong interest in fitness", "new"),
        memory("profile.md#0", "Based in a coastal city", "unchanged", "Profile"),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /import memories/i }));

    await waitFor(() => expect(importClaudeAccountMemories).toHaveBeenCalledWith("/export", ["profile.md#0"]));
    await screen.findByText(/1 imported, 0 updated, 0 unchanged/);
  });

  it("shows the live count again after the selection changes post-import", async () => {
    // Regression: the import summary replaced the "N selected" count and never
    // cleared, so unchecking an entry after importing gave no feedback at all.
    previewClaudeAccountMemories.mockResolvedValue({
      total: 2,
      memories: [
        memory("topics/fitness.md#0", "Strong interest in fitness", "new"),
        memory("profile.md#0", "Based in a coastal city", "new", "Profile"),
      ],
    });
    importClaudeAccountMemories.mockResolvedValue({ imported: 2, updated: 0, skipped: 0 });

    render(<ClaudeAccountMemoriesPanel folderPath="/export" />);
    await screen.findByText("Strong interest in fitness");

    previewClaudeAccountMemories.mockResolvedValue({
      total: 2,
      memories: [
        memory("topics/fitness.md#0", "Strong interest in fitness", "unchanged"),
        memory("profile.md#0", "Based in a coastal city", "unchanged", "Profile"),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /import memories/i }));
    await screen.findByText(/2 imported, 0 updated, 0 unchanged/);

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.queryByText(/2 imported/)).not.toBeInTheDocument();
  });

  it("surfaces a preview failure instead of rendering an empty list", async () => {
    previewClaudeAccountMemories.mockRejectedValue(new Error("bad folder"));
    render(<ClaudeAccountMemoriesPanel folderPath="/export" />);
    await screen.findByText(/could not read account memories/i);
  });
});
