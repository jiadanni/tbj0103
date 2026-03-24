import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_TITLE,
  deriveChatTitleFromMessage,
  resolveChatTitle,
  sanitizeGeneratedChatTitle,
} from "../../lib/chatTitles";

describe("chatTitles", () => {
  it("sanitizes quoted AI titles", () => {
    expect(sanitizeGeneratedChatTitle("\"Vector Databases 101.\"")).toBe("Vector Databases 101");
  });

  it("derives a readable fallback title from the first message", () => {
    expect(deriveChatTitleFromMessage("Can you help me debug a Rust borrow checker error in Tauri?"))
      .toBe("debug a Rust borrow checker error Tauri");
  });

  it("falls back when the AI title is missing or unusable", () => {
    expect(resolveChatTitle({
      aiTitle: "New Chat",
      firstMessage: "Explain how retrieval augmented generation works",
    })).toBe("retrieval augmented generation works");
  });

  it("uses the AI title when it is valid", () => {
    expect(resolveChatTitle({
      aiTitle: "RAG Pipeline Design",
      firstMessage: "Explain how retrieval augmented generation works",
    })).toBe("RAG Pipeline Design");
  });

  it("keeps the default title when the first message is empty", () => {
    expect(resolveChatTitle({ aiTitle: "", firstMessage: "   " })).toBe(DEFAULT_CHAT_TITLE);
  });
});
