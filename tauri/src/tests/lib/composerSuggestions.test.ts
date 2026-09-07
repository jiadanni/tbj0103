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
        auto_detected_tags: [
          { tag: "React", weight: 0.8, source: "auto" },
          { tag: "Ollama", weight: 0.7, source: "auto" },
        ],
        custom_tags: [],
        excluded_tags: [],
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

  it("prefers prompt bank suggestions over legacy topic signature prompts", () => {
    const row = buildWorkspaceSuggestionRow({
      folderName: "Tauri App",
      topicSignature: {
        auto_detected_tags: [],
        custom_tags: [],
        excluded_tags: [],
        intent_patterns: [],
        generated_at: null,
        message_count_at_gen: null,
        ollama_enriched: false,
        suggested_prompts: ["Legacy prompt"],
      },
      promptBankPrompts: [
        "How should I structure a Tauri command?",
        "What should I review before adding IPC?",
      ],
      processedDocCount: 0,
      activeMessages: [],
      followUps: [],
    });

    expect(row?.suggestions.map((suggestion) => suggestion.prompt)).toEqual([
      "How should I structure a Tauri command?",
      "What should I review before adding IPC?",
    ]);
  });

  it("merges suggestions into existing composer text cleanly", () => {
    expect(mergeComposerInput("", "What is Tauri?")).toBe("What is Tauri?");
    expect(mergeComposerInput("Please help", "What is Tauri?")).toBe("Please help\nWhat is Tauri?");
    expect(mergeComposerInput("Please help.", "What is Tauri?")).toBe("Please help. What is Tauri?");
  });
});

describe("prompt-bank workspace attribution", () => {
  // A parent workspace's prompt bank includes its children's prompts, so a card
  // may show a prompt that belongs somewhere other than the active workspace.
  // Those must be labelled (the user sees where it goes before clicking) and
  // carry the id (the chat opens there). Prompts from the active workspace must
  // stay unlabelled — tagging a prompt with the workspace you are already in is
  // noise.
  const baseContext = {
    processedDocCount: 0,
    activeMessages: [],
    followUps: [],
  };

  it("attributes prompts that come from another workspace", () => {
    const row = buildWorkspaceSuggestionRow({
      ...baseContext,
      activeWorkspaceId: "ws-root",
      promptBankEntries: [
        { prompt: "Explain rw-r--r-- permissions.", workspaceId: "ws-linux", workspaceName: "Linux" },
      ],
    });

    const suggestion = row?.suggestions[0];
    expect(suggestion?.workspaceId).toBe("ws-linux");
    expect(suggestion?.workspaceName).toBe("Linux");
  });

  it("leaves prompts from the active workspace unattributed", () => {
    const row = buildWorkspaceSuggestionRow({
      ...baseContext,
      activeWorkspaceId: "ws-root",
      promptBankEntries: [
        { prompt: "What should I focus on?", workspaceId: "ws-root", workspaceName: "Root" },
      ],
    });

    const suggestion = row?.suggestions[0];
    expect(suggestion?.workspaceId).toBeUndefined();
    expect(suggestion?.workspaceName).toBeUndefined();
  });

  it("prefers entries over the plain string form when both are supplied", () => {
    const row = buildWorkspaceSuggestionRow({
      ...baseContext,
      activeWorkspaceId: "ws-root",
      promptBankPrompts: ["stale string prompt"],
      promptBankEntries: [
        { prompt: "entry prompt", workspaceId: "ws-linux", workspaceName: "Linux" },
      ],
    });

    expect(row?.suggestions.map((s) => s.prompt)).toEqual(["entry prompt"]);
  });
});
