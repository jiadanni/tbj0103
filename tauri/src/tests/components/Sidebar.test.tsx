import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import { useChatStore } from "@/stores/chatStore";

describe("Sidebar", () => {
  beforeEach(() => {
    useChatStore.setState({ activeChatId: null });
  });

  it("marks the active navigation item as the current page and uses the elevated pill treatment", () => {
    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Sidebar onOpenCommandPalette={vi.fn()} />
      </MemoryRouter>
    );

    const button = screen.getByRole("button", { name: "Dashboard" });
    expect(button).toHaveAttribute("aria-current", "page");
    expect(button.className).toContain("bg-[rgba(var(--accent-color-rgb),0.12)]");
  });

  it("shows a tooltip for collapsed navigation items on hover", () => {
    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Sidebar onOpenCommandPalette={vi.fn()} />
      </MemoryRouter>
    );

    // Collapse the sidebar first
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Dashboard" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent("Dashboard");
  });

  it("hides the tooltip when pointer leaves a collapsed item", () => {
    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Sidebar onOpenCommandPalette={vi.fn()} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    const button = screen.getByRole("button", { name: "Dashboard" });
    fireEvent.mouseEnter(button);
    fireEvent.mouseLeave(button);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("clears the selected chat when the Chat section is clicked", () => {
    useChatStore.setState({ activeChatId: "session-1" });

    render(
      <MemoryRouter initialEntries={["/chat/session-1"]}>
        <Sidebar onOpenCommandPalette={vi.fn()} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Chat" }));

    expect(useChatStore.getState().activeChatId).toBeNull();
  });
});
