import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ChatMinimap from "@/components/ChatMinimap";
import type { Message } from "@/stores/chatStore";
import type { VirtuosoHandle } from "react-virtuoso";

const messages: Message[] = [
  {
    id: "user-1",
    session_id: "session-1",
    role: "user",
    content: "First message",
    created_at: "2026-05-10T10:00:00.000Z",
  },
  {
    id: "assistant-1",
    session_id: "session-1",
    role: "assistant",
    content: "Second message",
    created_at: "2026-05-10T10:01:00.000Z",
  },
  {
    id: "user-2",
    session_id: "session-1",
    role: "user",
    content: "Third message",
    created_at: "2026-05-10T10:02:00.000Z",
  },
];

function createScrollContainer(offsetWidth: number, clientWidth: number) {
  const element = document.createElement("div");
  Object.defineProperty(element, "offsetWidth", {
    configurable: true,
    value: offsetWidth,
  });
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: clientWidth,
  });
  return element;
}

describe("ChatMinimap", () => {
  it("renders for a single prompt and assistant reply", () => {
    const scrollContainer = createScrollContainer(320, 320);

    render(
      <ChatMinimap
        messages={messages.slice(0, 2)}
        virtuosoRef={{ current: { scrollToIndex: vi.fn() } as unknown as VirtuosoHandle }}
        scrollContainer={scrollContainer}
        isStreaming={false}
      />
    );

    expect(screen.getByTestId("chat-minimap")).toBeInTheDocument();
  });

  it("uses a scrollbar-aware right offset when the scroller has a gutter", () => {
    const scrollContainer = createScrollContainer(320, 314);

    render(
      <ChatMinimap
        messages={messages}
        virtuosoRef={{ current: { scrollToIndex: vi.fn() } as unknown as VirtuosoHandle }}
        scrollContainer={scrollContainer}
        isStreaming={false}
      />
    );

    expect(screen.getByTestId("chat-minimap")).toHaveStyle({ right: "2px" });
  });

  it("positions every marker before ResizeObserver reports track height", () => {
    const scrollContainer = createScrollContainer(320, 320);

    render(
      <ChatMinimap
        messages={messages}
        virtuosoRef={{ current: { scrollToIndex: vi.fn() } as unknown as VirtuosoHandle }}
        scrollContainer={scrollContainer}
        isStreaming={false}
      />
    );

    const markerTops = screen.getAllByTestId("chat-minimap-marker").map((marker) => marker.style.top);
    expect(markerTops).toHaveLength(3);
    expect(new Set(markerTops).size).toBe(3);
  });

  it("falls back to the default inset when no scrollbar gutter is available", () => {
    const scrollContainer = createScrollContainer(320, 320);

    render(
      <ChatMinimap
        messages={messages}
        virtuosoRef={{ current: { scrollToIndex: vi.fn() } as unknown as VirtuosoHandle }}
        scrollContainer={scrollContainer}
        isStreaming={false}
      />
    );

    expect(screen.getByTestId("chat-minimap")).toHaveStyle({ right: "8px" });
  });

  it("schedules requestAnimationFrame to batch pointermove during drag", () => {
    const scrollContainer = createScrollContainer(320, 320);
    const scrollToIndex = vi.fn();
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");

    render(
      <ChatMinimap
        messages={messages}
        virtuosoRef={{ current: { scrollToIndex } as unknown as VirtuosoHandle }}
        scrollContainer={scrollContainer}
        isStreaming={false}
      />
    );

    const track = screen.getByTestId("chat-minimap").firstElementChild as HTMLElement;
    track.getBoundingClientRect = vi.fn(() => ({
      top: 0,
      bottom: 300,
      left: 0,
      right: 28,
      width: 28,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => {},
    }));
    track.setPointerCapture = vi.fn();

    fireEvent.pointerDown(track, { clientY: 10, pointerId: 1 });
    expect(scrollToIndex).toHaveBeenCalledTimes(1);

    const rafCountBefore = rafSpy.mock.calls.length;
    fireEvent.pointerMove(track, { clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(track, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(track, { clientY: 150, pointerId: 1 });

    // Only one rAF should be scheduled while the previous one is pending
    expect(rafSpy.mock.calls.length).toBe(rafCountBefore + 1);
    rafSpy.mockRestore();
  });
});
