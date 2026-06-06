import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import HelpView from "../../views/HelpView";

const { mockOpenShell } = vi.hoisted(() => ({
  mockOpenShell: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: mockOpenShell,
}));

vi.mock("lucide-react", () => ({
  ArrowUp: () => <div data-testid="icon-arrow-up" />,
}));

describe("HelpView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({
        text: () => Promise.resolve(`# Help\n\n## Navigation Overview\n\n[Jump](#navigation-overview)\n\n[Ollama](https://ollama.com)\n`),
      }),
    ));
  });

  it("opens external help links with the Tauri shell", async () => {
    render(<HelpView />);

    const externalLink = await screen.findByRole("link", { name: "Ollama" });
    fireEvent.click(externalLink);

    expect(mockOpenShell).toHaveBeenCalledWith("https://ollama.com");
  });

  it("renders heading ids so in-page help links can target them", async () => {
    render(<HelpView />);

    const jumpLink = await screen.findByRole("link", { name: "Jump" });
    const heading = await screen.findByRole("heading", { name: "Navigation Overview" });

    expect(jumpLink).toHaveAttribute("href", "#navigation-overview");
    expect(heading).toHaveAttribute("id", "navigation-overview");

    fireEvent.click(jumpLink);

    await waitFor(() => {
      expect(mockOpenShell).not.toHaveBeenCalled();
    });
  });
});
