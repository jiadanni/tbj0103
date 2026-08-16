import { describe, expect, it } from "vitest";
import { conversationGist } from "@/lib/conversationGist";

describe("conversationGist", () => {
  it("prefers Claude's own export summary when present", () => {
    expect(
      conversationGist({
        name: "Chat",
        summary: "Claude overview of the chat.",
        first_user_message: "an unrelated opener",
      }),
    ).toBe("Claude overview of the chat.");
  });

  it("synthesizes from the first user message when summary is empty", () => {
    expect(
      conversationGist({
        name: "",
        summary: "   ",
        first_user_message: "How do I beatmatch tracks on CDJs? Also tempo tips.",
      }),
    ).toBe("How do I beatmatch tracks on CDJs?");
  });

  it("falls back to the first non-empty message (design-chat style, no summary/opener)", () => {
    expect(
      conversationGist({
        name: "",
        messages: [
          { role: "user", content: "  " },
          { role: "assistant", content: "Here is a plan for your app." },
        ],
      }),
    ).toBe("Here is a plan for your app.");
  });

  it("truncates long single sentences with an ellipsis", () => {
    const long = "a".repeat(300);
    const gist = conversationGist({ name: "", first_user_message: long }, 120);
    expect(gist.length).toBe(121); // 120 chars + ellipsis
    expect(gist.endsWith("\u2026")).toBe(true);
  });

  it("returns empty string when there is nothing to summarize", () => {
    expect(conversationGist({ name: "" })).toBe("");
  });
});
