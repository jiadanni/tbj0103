import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportSectionSkeleton } from "../../components/ImportSectionSkeleton";

describe("ImportSectionSkeleton", () => {
  it("names the section and what is being withheld", () => {
    render(
      <ImportSectionSkeleton label="Projects" summary="25 projects" onEnable={() => {}} />,
    );
    // The label must match the toggle exactly, so the mapping is unambiguous.
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText(/25 projects not being imported/)).toBeInTheDocument();
  });

  it("re-enables the section from its own button", () => {
    const onEnable = vi.fn();
    render(
      <ImportSectionSkeleton label="Conversations" summary="983 conversations" onEnable={onEnable} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /include/i }));
    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it("draws the requested number of placeholder rows", () => {
    const { container } = render(
      <ImportSectionSkeleton label="Memories" summary="x" onEnable={() => {}} rows={5} />,
    );
    // Placeholder bars are decorative, so they are hidden from assistive tech.
    const bars = container.querySelector('[aria-hidden="true"]');
    expect(bars?.children).toHaveLength(5);
  });

  it("is addressable by a stable test id derived from the label", () => {
    render(<ImportSectionSkeleton label="Projects" summary="x" onEnable={() => {}} />);
    expect(screen.getByTestId("import-skeleton-projects")).toBeInTheDocument();
  });
});
