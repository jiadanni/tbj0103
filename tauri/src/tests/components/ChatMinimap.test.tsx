import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  it("uses a scrollbar-aware right offset when the scroller has a gutter", () => {
    const scrollContainer = createScrollContainer(320, 314);

    render(
      <ChatMinimap
        messages={messages}
        virtuosoRef={{ current: { scrollToIndex: vi.fn() } as unknown as VirtuosoHandle }}
        scrollContainer={scrollContainer}
        streamingContent=""
        isStreaming={false}
      />
    );

    expect(screen.getByTestId("chat-minimap")).toHaveStyle({ right: "2px" });
  });

  it("falls back to the default inset when no scrollbar gutter is available", () => {
    const scrollContainer = createScrollContainer(320, 320);

    render(
      <ChatMinimap
        messages={messages}
        virtuosoRef={{ current: { scrollToIndex: vi.fn() } as unknown as VirtuosoHandle }}
        scrollContainer={scrollContainer}
        streamingContent=""
        isStreaming={false}
      />
    );

    expect(screen.getByTestId("chat-minimap")).toHaveStyle({ right: "8px" });
  });
});
