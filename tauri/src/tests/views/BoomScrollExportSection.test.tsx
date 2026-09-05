import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import BoomScrollExportSection from "@/views/BoomScrollExportSection";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { message as showMessage, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

vi.mock("lucide-react", () => ({
  RefreshCw: () => <div data-testid="icon-refresh-cw" />,
  Smartphone: () => <div data-testid="icon-smartphone" />,
  CheckSquare: () => <div data-testid="icon-check-square" />,
  Square: () => <div data-testid="icon-square" />,
  X: () => <div data-testid="icon-x" />,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(() => Promise.resolve(undefined)),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("@/components/SuccessDialog", () => ({
  default: ({ title }: { title: string }) => <div data-testid="success-dialog">{title}</div>,
}));

vi.mock("@/lib/api", () => ({
  api: {
    export: {
      feedDeck: vi.fn(),
    },
    flashcard: {
      getStats: vi.fn(() => Promise.resolve({ total_cards: 5, due_cards: 0, reviewed_cards: 0, avg_ease_factor: 2.5 })),
    },
  },
}));

function makeWorkspace(id: string, name: string, parentId: string | null = null) {
  return {
    id,
    name,
    description: "",
    prompt_instructions: "",
    topic_signature: {
      auto_detected_tags: [],
      custom_tags: [],
      excluded_tags: [],
      intent_patterns: [],
      generated_at: null,
      message_count_at_gen: null,
      ollama_enriched: false,
    },
    signature_updated_at: null,
    is_hidden: false,
    created_at: "",
    updated_at: "",
    parent_workspace_id: parentId,
    icon: "folder",
    order_index: 0,
    last_message_at: null,
    survey_data: null,
  };
}

const rustStudy = makeWorkspace("workspace-1", "Rust Study");
const biology = makeWorkspace("workspace-2", "Biology");
const subWorkspace = makeWorkspace("workspace-3", "Genetics", "workspace-2");

/** The section's Export button now opens a picker dialog first. */
function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
}

function confirmExport() {
  fireEvent.click(screen.getByRole("button", { name: /export deck/i }));
}

describe("BoomScrollExportSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      workspaces: [rustStudy, biology, subWorkspace],
      activeWorkspaceId: "workspace-1",
    });
  });

  it("exports all workspaces (including sub-workspaces) by default", async () => {
    const deckJson = JSON.stringify({ format: "aetherium.boomscroll.deck", version: 2 });
    vi.mocked(saveDialog).mockResolvedValue("/exports/aetherium-boomscroll.json");
    vi.mocked(api.export.feedDeck).mockResolvedValue(deckJson);

    render(<BoomScrollExportSection />);
    openPicker();
    confirmExport();

    await waitFor(() => {
      expect(api.export.feedDeck).toHaveBeenCalledWith([
        "workspace-1",
        "workspace-2",
        "workspace-3",
      ]);
    });
    await waitFor(() => {
      expect(writeTextFile).toHaveBeenCalledWith("/exports/aetherium-boomscroll.json", deckJson);
    });
    expect(await screen.findByTestId("success-dialog")).toHaveTextContent("Deck exported");
  });

  it("exports only the selected workspaces", async () => {
    const deckJson = JSON.stringify({ format: "aetherium.boomscroll.deck", version: 2 });
    vi.mocked(saveDialog).mockResolvedValue("/exports/rust-study-boomscroll.json");
    vi.mocked(api.export.feedDeck).mockResolvedValue(deckJson);

    render(<BoomScrollExportSection />);
    openPicker();
    fireEvent.click(screen.getByRole("checkbox", { name: "Biology" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Genetics" }));
    confirmExport();

    await waitFor(() => {
      expect(api.export.feedDeck).toHaveBeenCalledWith(["workspace-1"]);
    });
  });

  it("All / None clears and restores the selection", () => {
    render(<BoomScrollExportSection />);
    openPicker();

    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(screen.getByRole("button", { name: /export deck/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByRole("button", { name: /export deck/i })).toBeEnabled();
  });

  it("cancelling the picker exports nothing", () => {
    render(<BoomScrollExportSection />);
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("button", { name: /export deck/i })).not.toBeInTheDocument();
    expect(api.export.feedDeck).not.toHaveBeenCalled();
  });

  it("does nothing when the save dialog is cancelled", async () => {
    const deckJson = JSON.stringify({ format: "aetherium.boomscroll.deck", version: 2 });
    vi.mocked(api.export.feedDeck).mockResolvedValue(deckJson);
    vi.mocked(saveDialog).mockResolvedValue(null);

    render(<BoomScrollExportSection />);
    openPicker();
    confirmExport();

    await waitFor(() => {
      expect(api.export.feedDeck).toHaveBeenCalled();
      expect(saveDialog).toHaveBeenCalled();
    });
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("shows the backend error when export fails", async () => {
    vi.mocked(api.export.feedDeck).mockRejectedValue("No flashcards in the selected workspaces");

    render(<BoomScrollExportSection />);
    openPicker();
    confirmExport();

    await waitFor(() => {
      expect(showMessage).toHaveBeenCalledWith(
        "No flashcards in the selected workspaces",
        { title: "Export failed", kind: "error" },
      );
    });
    expect(saveDialog).not.toHaveBeenCalled();
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(screen.getByText("No flashcards in the selected workspaces")).toBeInTheDocument();
  });

  it("disables the export button when there are no workspaces", () => {
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });

    render(<BoomScrollExportSection />);
    expect(screen.getByRole("button", { name: /^export$/i })).toBeDisabled();
  });
});
