import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { WaterfallSuggestions } from "@/components/WaterfallSuggestions";
import type { ComposerSuggestion } from "@/lib/composerSuggestions";

import { useSettingsStore } from "@/stores/settingsStore";

const suggestions: ComposerSuggestion[] = [
  { id: "starter-1", label: "Map my Rust notes", prompt: "Map my Rust notes", action: "append" },
  { id: "starter-2", label: "Quiz me on ownership", prompt: "Quiz me on ownership", action: "append" },
];

describe("WaterfallSuggestions", () => {
  it("renders scrolling prompts as selectable buttons", () => {
    const onSelect = vi.fn();

    render(<WaterfallSuggestions suggestions={suggestions} onSelect={onSelect} action={null} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Map my Rust notes" })[0]);

    expect(onSelect).toHaveBeenCalledWith(suggestions[0]);
  });

  it("does not render without suggestions", () => {
    const { container } = render(<WaterfallSuggestions suggestions={[]} onSelect={() => undefined} action={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("dismisses a prompt via the hover X without selecting it", () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();

    render(
      <WaterfallSuggestions suggestions={suggestions} onSelect={onSelect} onDismiss={onDismiss} action={null} />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss this suggestion" })[0]);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders the action container with pointer-events-auto in set-type and bracket styles", () => {
    useSettingsStore.setState({ waterfallStyle: "set-type" });
    const { rerender } = render(
      <WaterfallSuggestions
        suggestions={suggestions}
        onSelect={() => undefined}
        action={<button data-testid="start-chat-btn">Start a new chat</button>}
      />,
    );

    const button = screen.getByTestId("start-chat-btn");
    expect(button.parentElement).toHaveClass("pointer-events-auto");

    act(() => {
      useSettingsStore.setState({ waterfallStyle: "bracket" });
    });
    rerender(
      <WaterfallSuggestions
        suggestions={suggestions}
        onSelect={() => undefined}
        action={<button data-testid="start-chat-btn">Start a new chat</button>}
      />,
    );

    expect(screen.getByTestId("start-chat-btn").parentElement).toHaveClass("pointer-events-auto");
  });
});

