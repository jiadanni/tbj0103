import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import { useWorkspaceStore } from "@/stores/workspaceStore";

describe("Sidebar", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaceNavigation: "icon-bar" });
  });

  it("shows a tooltip for icon-only navigation items on hover", () => {
    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Sidebar onOpenCommandPalette={vi.fn()} iconOnly />
      </MemoryRouter>
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Dashboard" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent("Dashboard");
  });

  it("hides the tooltip when pointer leaves the icon-only item", () => {
    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Sidebar onOpenCommandPalette={vi.fn()} iconOnly />
      </MemoryRouter>
    );

    const button = screen.getByRole("button", { name: "Dashboard" });
    fireEvent.mouseEnter(button);
    fireEvent.mouseLeave(button);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
