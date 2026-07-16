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
  },
}));

const workspace = {
  id: "workspace-1",
  name: "Rust Study",
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
  parent_workspace_id: null,
  icon: "folder",
  order_index: 0,
  last_message_at: null,
  survey_data: null,
};

describe("BoomScrollExportSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      workspaces: [workspace],
      activeWorkspaceId: "workspace-1",
    });
  });

  it("exports the deck to the chosen path", async () => {
    const deckJson = JSON.stringify({ format: "aetherium.boomscroll.deck", version: 1 });
    vi.mocked(saveDialog).mockResolvedValue("/exports/rust-study-boomscroll.json");
    vi.mocked(api.export.feedDeck).mockResolvedValue(deckJson);

    render(<BoomScrollExportSection />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => {
      expect(api.export.feedDeck).toHaveBeenCalledWith("workspace-1");
    });
    await waitFor(() => {
      expect(writeTextFile).toHaveBeenCalledWith("/exports/rust-study-boomscroll.json", deckJson);
    });
    expect(await screen.findByTestId("success-dialog")).toHaveTextContent("Deck exported");
  });

  it("does nothing when the save dialog is cancelled", async () => {
    vi.mocked(saveDialog).mockResolvedValue(null);

    render(<BoomScrollExportSection />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => {
      expect(saveDialog).toHaveBeenCalled();
    });
    expect(api.export.feedDeck).not.toHaveBeenCalled();
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("shows the backend error when export fails", async () => {
    vi.mocked(saveDialog).mockResolvedValue("/exports/deck.json");
    vi.mocked(api.export.feedDeck).mockRejectedValue("No flashcards in this workspace");

    render(<BoomScrollExportSection />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => {
      expect(showMessage).toHaveBeenCalledWith(
        "No flashcards in this workspace",
        { title: "Export failed", kind: "error" },
      );
    });
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(screen.getByText("No flashcards in this workspace")).toBeInTheDocument();
  });

  it("disables the export button when no workspace is active", () => {
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });

    render(<BoomScrollExportSection />);
    expect(screen.getByRole("button", { name: /export/i })).toBeDisabled();
  });
});
