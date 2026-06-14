import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WaterfallSuggestions } from "@/components/WaterfallSuggestions";
import type { ComposerSuggestion } from "@/lib/composerSuggestions";

const suggestions: ComposerSuggestion[] = [
  { id: "starter-1", label: "Map my Rust notes", prompt: "Map my Rust notes", action: "append" },
  { id: "starter-2", label: "Quiz me on ownership", prompt: "Quiz me on ownership", action: "append" },
];

describe("WaterfallSuggestions", () => {
  it("renders scrolling prompts as selectable buttons", () => {
    const onSelect = vi.fn();

    render(<WaterfallSuggestions suggestions={suggestions} onSelect={onSelect} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Map my Rust notes" })[0]);

    expect(onSelect).toHaveBeenCalledWith(suggestions[0]);
  });

  it("does not render without suggestions", () => {
    const { container } = render(<WaterfallSuggestions suggestions={[]} onSelect={() => undefined} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("dismisses a prompt via the hover X without selecting it", () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();

    render(
      <WaterfallSuggestions suggestions={suggestions} onSelect={onSelect} onDismiss={onDismiss} />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss this suggestion" })[0]);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
