import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Card, CardButton, Eyebrow, Panel } from "@/components/ui/Surface";
import { Button, Input } from "@/components/ui/Button";

describe("ui primitives", () => {
  it("builds every surface from the shared token helpers, not hand-rolled colors", () => {
    const { container } = render(
      <Panel data-testid="panel">
        <Card data-testid="card">body</Card>
      </Panel>,
    );

    // The whole point of the primitives: no call site re-derives
    // border + background. If these ever gain a literal bg-[var(--bg-*)] the
    // abstraction has leaked.
    for (const el of [screen.getByTestId("panel"), screen.getByTestId("card")]) {
      expect(el.className).toContain("surface-card");
      expect(el.className).not.toContain("bg-[var(--bg-elevated)]");
      expect(el.className).not.toContain("border-[var(--border-color)]");
    }
    expect(container.querySelector("section")).toBeTruthy();
  });

  it("gives CardButton the interactive modifier rather than hand-written hovers", () => {
    const onClick = vi.fn();
    render(<CardButton onClick={onClick}>go</CardButton>);

    const button = screen.getByRole("button", { name: "go" });
    // The modifier supplies hover bg + accent border; duplicating them as
    // utilities is what the primitive exists to prevent.
    expect(button.className).toContain("surface-card");
    expect(button.className).toContain("surface-card-interactive");
    expect(button.className).not.toContain("hover:bg-");

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps Button and Input on one shared control radius", () => {
    render(
      <>
        <Button>save</Button>
        <Input placeholder="name" />
      </>,
    );

    // rounded-lg maps to --radius-control for both, so a button and the input
    // beside it agree by construction rather than by convention.
    expect(screen.getByRole("button", { name: "save" }).className).toContain("rounded-lg");
    expect(screen.getByPlaceholderText("name").className).toContain("rounded-lg");
  });

  it("applies the accent variant and forwards disabled", () => {
    render(<Button variant="accent" disabled>send</Button>);

    const button = screen.getByRole("button", { name: "send" });
    expect(button.className).toContain("bg-[var(--accent-color)]");
    expect(button).toBeDisabled();
  });

  it("renders Eyebrow at the single canonical tracking", () => {
    render(<Eyebrow>Workspace goals</Eyebrow>);

    // The app had four trackings for this one motif; this pins the winner.
    expect(screen.getByText("Workspace goals").className).toContain("tracking-[0.12em]");
  });
});
