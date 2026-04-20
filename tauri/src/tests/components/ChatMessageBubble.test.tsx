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
  ChevronLeft: () => <div data-testid="icon-chevron-left" />,
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
        redoPickerOpen={false}
        availableModels={[]}
        aiModelList={[]}
        selectedModel=""
        showGenInfoModel={false}
        showGenInfoTokenCount={false}
        showGenInfoDuration={false}
        showGenInfoSpeed={false}
        onCopy={vi.fn()}
        onStartEdit={vi.fn()}
        onSubmitEdit={vi.fn()}
        onSetEditContent={vi.fn()}
        onCancelEdit={vi.fn()}
        onRedoWithModel={vi.fn()}
        onToggleRedoPicker={vi.fn()}
        onVariationChange={vi.fn()}
        onToggleThought={vi.fn()}
        onToggleSources={vi.fn()}
      />,
    );

    const bubble = screen.getByTestId("assistant-bubble");
    expect(bubble).toHaveClass("overflow-hidden");
    expect(bubble.className).toContain("message-assistant");
  });

  it("renders grounded source chips alongside the expandable sources control", () => {
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
        messageSources={{
          [message.id]: [
            { id: "source-1", result_type: "document", title: "Rust Book", excerpt: "Ownership basics", score: 0.9 },
            { id: "source-2", result_type: "document", title: "Cargo Guide", excerpt: "Workspace layout", score: 0.84 },
          ],
        }}
        expandedSources={null}
        contextSources={null}
        markdownComponents={{}}
        redoPickerOpen={false}
        availableModels={[]}
        aiModelList={[]}
        selectedModel=""
        showGenInfoModel={false}
        showGenInfoTokenCount={false}
        showGenInfoDuration={false}
        showGenInfoSpeed={false}
        onCopy={vi.fn()}
        onStartEdit={vi.fn()}
        onSubmitEdit={vi.fn()}
        onSetEditContent={vi.fn()}
        onCancelEdit={vi.fn()}
        onRedoWithModel={vi.fn()}
        onToggleRedoPicker={vi.fn()}
        onVariationChange={vi.fn()}
        onToggleThought={vi.fn()}
        onToggleSources={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /sources/i })).toBeInTheDocument();
    expect(screen.getAllByTestId("grounded-source-chip")).toHaveLength(2);
    expect(screen.getByText("Rust Book")).toBeInTheDocument();
  });
});
