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

    expect(onSuggestionClick).toHaveBeenCalledWith(rows[0].suggestions[0], false);
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

  it("pages suggestions with the next control", () => {
    const scrollTo = vi.fn();
    const offsetMap = new Map<string, number>([
      ["Yes", 0],
      ["·", 64],
      ["What is Rust?", 144],
    ]);
    const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    const originalScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    const originalOffsetLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetLeft");

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return this.getAttribute("aria-label") === "Previous suggestions"
          || this.getAttribute("aria-label") === "Next suggestions"
          ? 28
          : 180;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return this.className.includes("overflow-x-auto") ? 420 : 180;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
      configurable: true,
      get() {
        return offsetMap.get((this.textContent ?? "").trim()) ?? 0;
      },
    });

    render(
      <ComposerSuggestionRows rows={rows} onSuggestionClick={() => undefined} />
    );

    const scroller = screen.getByTestId("composer-suggestion-scroller");
    Object.defineProperty(scroller, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });
    scroller.scrollTo = scrollTo;

    fireEvent.click(screen.getByRole("button", { name: "Next suggestions" }));

    expect(scrollTo).toHaveBeenCalledWith({ left: 64, behavior: "smooth" });

    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
    }
    if (originalScrollWidth) {
      Object.defineProperty(HTMLElement.prototype, "scrollWidth", originalScrollWidth);
    }
    if (originalOffsetLeft) {
      Object.defineProperty(HTMLElement.prototype, "offsetLeft", originalOffsetLeft);
    }
  });
});
