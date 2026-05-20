import { describe, expect, it } from "vitest";
import {
  buildChatSuggestionRow,
  buildWorkspaceSuggestionRow,
  mergeComposerInput,
} from "@/lib/composerSuggestions";

describe("composerSuggestions", () => {
  it("builds workspace suggestions from folder and topic context", () => {
    const row = buildWorkspaceSuggestionRow({
      folderName: "Tauri App",
      topicSignature: {
        domain_tags: [
          { tag: "React", weight: 0.8, source: "auto" },
          { tag: "Ollama", weight: 0.7, source: "auto" },
        ],
        manual_tags: [],
        ignored_tags: [],
        intent_patterns: [],
        generated_at: null,
        message_count_at_gen: null,
        ollama_enriched: false,
      },
      processedDocCount: 2,
      activeMessages: [],
      followUps: [],
    });

    expect(row?.label).toBe("Workspace");
    // Workspace name ("Frontend Lab") is intentionally excluded from prompt
    // generation — workspace names are often sentimental labels with no topical
    // meaning, and including them produced suggestions like "What is Beach
    // stage?" that polluted the chip list.
    expect(row?.suggestions.map((suggestion) => suggestion.prompt)).toEqual([
      "What is Tauri App?",
      "How do I install React?",
      "Show me an example of Ollama.",
    ]);
  });

  it("builds chat suggestions from binary assistant questions and follow ups", () => {
    const row = buildChatSuggestionRow({
      folderName: null,
      topicSignature: null,
      processedDocCount: 0,
      activeMessages: [
        {
          id: "m1",
          session_id: "s1",
          role: "assistant",
          content: "Do you want me to apply that migration now?",
          created_at: new Date().toISOString(),
        },
      ],
      followUps: ["What changed?", "Can you explain the migration?"],
    });

    expect(row?.label).toBe("Chat");
    expect(row?.suggestions.map((suggestion) => suggestion.label)).toEqual([
      "Yes",
      "No",
      "What changed?",
      "Can you explain the migration?",
    ]);
    expect(row?.suggestions[0].action).toBe("send_immediately");
  });

  it("merges suggestions into existing composer text cleanly", () => {
    expect(mergeComposerInput("", "What is Tauri?")).toBe("What is Tauri?");
    expect(mergeComposerInput("Please help", "What is Tauri?")).toBe("Please help\nWhat is Tauri?");
    expect(mergeComposerInput("Please help.", "What is Tauri?")).toBe("Please help. What is Tauri?");
  });
});
