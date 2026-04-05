import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatMessageBubble from "@/components/ChatMessageBubble";
import type { Message } from "@/stores/chatStore";

vi.mock("lucide-react", () => ({
  Check: () => <div data-testid="icon-check" />,
  Copy: () => <div data-testid="icon-copy" />,
  Pencil: () => <div data-testid="icon-pencil" />,
  RotateCcw: () => <div data-testid="icon-rotate-ccw" />,
  ChevronDown: () => <div data-testid="icon-chevron-down" />,
  ChevronRight: () => <div data-testid="icon-chevron-right" />,
  ChevronUp: () => <div data-testid="icon-chevron-up" />,
  BookOpen: () => <div data-testid="icon-book-open" />,
}));

vi.mock("@/components/ContextIndicator", () => ({
  default: () => <div data-testid="context-indicator" />,
}));

vi.mock("@/hooks/useWordHover", () => ({
  useWordHover: () => null,
}));

vi.mock("@/components/WordDefinitionTooltip", () => ({
  WordDefinitionTooltip: () => null,
}));

const message: Message = {
  id: "assistant-1",
  session_id: "session-1",
  role: "assistant",
  content: "A long response that should stay clipped within the chat bubble.",
  created_at: "2026-04-05T17:49:00.000Z",
};

describe("ChatMessageBubble", () => {
  it("clips assistant bubble content within the bubble width", () => {
    render(
      <ChatMessageBubble
        msg={message}
        isLastMessage
        isStreaming={false}
        chatMessageStyle="bubble"
        expandChatToWindowWidth={false}
        showGenInfo={false}
        editingMessageId={null}
        editContent=""
        copiedMessageId={null}
        expandedThoughtIds={new Set()}
        messageSources={{}}
        expandedSources={null}
        contextSources={null}
        markdownComponents={{}}
        onCopy={vi.fn()}
        onStartEdit={vi.fn()}
        onSubmitEdit={vi.fn()}
        onSetEditContent={vi.fn()}
        onCancelEdit={vi.fn()}
        onRedo={vi.fn()}
        onToggleThought={vi.fn()}
        onToggleSources={vi.fn()}
      />,
    );

    const bubble = screen.getByText(message.content).closest("div.rounded-2xl");
    expect(bubble).toHaveClass("overflow-hidden");
  });
});
