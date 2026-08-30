import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportSectionHeader } from "../../components/ImportSectionHeader";

describe("ImportSectionHeader", () => {
  it("renders the label and detail", () => {
    render(<ImportSectionHeader label="Projects" detail="15 of 25 selected" />);
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("15 of 25 selected")).toBeInTheDocument();
  });

  it("is a static heading when no toggle handler is given", () => {
    render(<ImportSectionHeader label="Memories" detail="42 entries" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("becomes a disclosure button when collapsible, reporting its state", () => {
    const onToggleOpen = vi.fn();
    render(<ImportSectionHeader label="Projects" open onToggleOpen={onToggleOpen} />);
    const button = screen.getByRole("button", { name: /projects/i });
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(button);
    expect(onToggleOpen).toHaveBeenCalledTimes(1);
  });

  it("renders actions alongside the title", () => {
    render(
      <ImportSectionHeader label="Projects" actions={<button type="button">All</button>} />,
    );
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
  });

  it("owns the section's include checkbox when given one", () => {
    const onToggleIncluded = vi.fn();
    render(
      <ImportSectionHeader label="Projects" included onToggleIncluded={onToggleIncluded} />,
    );
    const box = screen.getByLabelText("Include Projects");
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(onToggleIncluded).toHaveBeenCalledWith(false);
  });

  it("disables the checkbox when the export lacks that data", () => {
    render(
      <ImportSectionHeader label="Memories" included onToggleIncluded={() => {}} unavailable />,
    );
    const box = screen.getByLabelText("Include Memories");
    expect(box).toBeDisabled();
    // Unavailable data must never read as included.
    expect(box).not.toBeChecked();
  });

  it("keeps the checkbox outside the disclosure button", () => {
    // Nesting them would make expanding the section also toggle it.
    const onToggleOpen = vi.fn();
    const onToggleIncluded = vi.fn();
    render(
      <ImportSectionHeader
        label="Projects"
        included
        onToggleIncluded={onToggleIncluded}
        open
        onToggleOpen={onToggleOpen}
      />,
    );
    fireEvent.click(screen.getByLabelText("Include Projects"));
    expect(onToggleIncluded).toHaveBeenCalledTimes(1);
    expect(onToggleOpen).not.toHaveBeenCalled();
  });

  it("is addressable by a stable test id derived from the label", () => {
    render(<ImportSectionHeader label="Conversations" />);
    expect(screen.getByTestId("import-header-conversations")).toBeInTheDocument();
  });
});
