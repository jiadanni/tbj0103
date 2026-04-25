import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ComposerSuggestionRows from "@/components/ComposerSuggestionRows";
import type { ComposerSuggestionRow } from "@/lib/composerSuggestions";

const rows: ComposerSuggestionRow[] = [
  {
    id: "workspace",
    label: "Workspace",
    suggestions: [
      { id: "w1", label: "What is Rust?", prompt: "What is Rust?", action: "append" },
    ],
  },
  {
    id: "chat",
    label: "Chat",
    suggestions: [
      { id: "c1", label: "Yes", prompt: "Yes", action: "send_immediately" },
    ],
  },
];

describe("ComposerSuggestionRows", () => {
  it("renders suggestions", () => {
    render(
      <ComposerSuggestionRows rows={rows} onSuggestionClick={() => undefined} />
    );

    expect(screen.getByRole("button", { name: "What is Rust?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
  });

  it("calls back when a suggestion is clicked", () => {
    const onSuggestionClick = vi.fn();
    render(
      <ComposerSuggestionRows rows={rows} onSuggestionClick={onSuggestionClick} />
    );

    fireEvent.click(screen.getByRole("button", { name: "What is Rust?" }));

    expect(onSuggestionClick).toHaveBeenCalledWith(rows[0].suggestions[0]);
  });

  it("disables immediate-send suggestions when requested", () => {
    render(
      <ComposerSuggestionRows
        rows={rows}
        disableImmediateSend
        onSuggestionClick={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: "Yes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "What is Rust?" })).not.toBeDisabled();
  });
});
