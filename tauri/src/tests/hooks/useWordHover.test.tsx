import React from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWordHover } from "@/hooks/useWordHover";

vi.mock("@/lib/techDictionary", () => ({
  lookupTechTerm: vi.fn((word: string) => (
    word === "rust"
      ? { word: "rust", definition: "A systems programming language.", aliases: [] }
      : null
  )),
}));

describe("useWordHover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  it("suppresses dictionary lookups while text is actively selected", () => {
    const container = document.createElement("div");
    container.textContent = "rust";
    document.body.appendChild(container);

    const containerRef = { current: container } as React.RefObject<HTMLDivElement | null>;
    const caretRangeFromPoint = vi.fn();
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: caretRangeFromPoint,
    });

    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => "rust",
    } as Selection);

    const { result, unmount } = renderHook(() => useWordHover(containerRef));

    act(() => {
      container.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 40, clientY: 20 }));
      vi.advanceTimersByTime(900);
    });

    expect(result.current).toBeNull();
    expect(caretRangeFromPoint).not.toHaveBeenCalled();

    unmount();
    container.remove();
  });

  it("returns a definition when hovering a word without an active selection", () => {
    const container = document.createElement("div");
    const textNode = document.createTextNode("rust");
    container.appendChild(textNode);
    document.body.appendChild(container);

    const range = {
      startContainer: textNode,
      startOffset: 2,
    } as unknown as Range;

    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: vi.fn(() => range),
    });

    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: true,
      toString: () => "",
    } as Selection);

    const containerRef = { current: container } as React.RefObject<HTMLDivElement | null>;
    const { result, unmount } = renderHook(() => useWordHover(containerRef));

    act(() => {
      container.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 48, clientY: 32 }));
      vi.advanceTimersByTime(900);
    });

    expect(result.current).toMatchObject({
      word: "rust",
      definition: "A systems programming language.",
      isTechTerm: true,
      x: 48,
      y: 32,
    });

    unmount();
    container.remove();
  });
});
