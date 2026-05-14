import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Sidebar from "@/components/Sidebar";

describe("Sidebar", () => {
  it("marks the active navigation item as the current page and uses the elevated pill treatment", () => {
    render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Sidebar onOpenCommandPalette={vi.fn()} />
      </MemoryRouter>
    );

    const button = screen.getByRole("button", { name: "Dashboard" });
    expect(button).toHaveAttribute("aria-current", "page");
    expect(button.className).toContain("bg-[var(--bg-elevated)]");
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
});
