import type { TopicSignature } from "./api";
import type { Message } from "../stores/chatStore";

export type ComposerSuggestionAction = "append" | "send_immediately";

export interface ComposerSuggestion {
  id: string;
  label: string;
  prompt: string;
  action: ComposerSuggestionAction;
}

export interface ComposerSuggestionRow {
  id: string;
  label: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  suggestions: ComposerSuggestion[];
}

export interface ComposerSuggestionContext {
  folderName?: string | null;
  topicSignature?: TopicSignature | null;
  promptBankPrompts?: string[];
  processedDocCount: number;
  activeMessages: Message[];
  followUps: string[];
}

const INSTALLABLE_KEYWORDS = [
  "api", "app", "bun", "cargo", "claude", "cli", "docker", "fastapi", "gemini",
  "git", "github", "go", "homebrew", "kubernetes", "llama", "node", "npm",
  "ollama", "package", "pip", "pnpm", "python", "react", "rust", "sdk", "swift",
  "tauri", "tool", "typescript", "uv", "vite", "web", "yarn",
];

function normalizeTerm(term: string) {
  return term.replace(/\s+/g, " ").trim();
}

function uniqueTerms(terms: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const results: string[] = [];

  terms.forEach((term) => {
    if (!term) {return;}
    const normalized = normalizeTerm(term);
    if (!normalized) {return;}
    const key = normalized.toLowerCase();
    if (seen.has(key)) {return;}
    seen.add(key);
    results.push(normalized);
  });

  return results;
}

function termLooksInstallable(term: string) {
  const lower = term.toLowerCase();
  return INSTALLABLE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function buildWorkspacePrompt(term: string, slot: number, hasDocs: boolean) {
  if (slot === 0) {
    return `What is ${term}?`;
  }
  if (slot === 1) {
    return termLooksInstallable(term)
      ? `How do I install ${term}?`
      : `How do I get started with ${term}?`;
  }
  if (slot === 2) {
    return `Show me an example of ${term}.`;
  }

  return hasDocs
    ? `What do my documents say about ${term}?`
    : `What are the key ideas in ${term}?`;
}

function latestAssistantMessage(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant") {
      return message.content.trim();
    }
  }

  return "";
}

function asksBinaryQuestion(content: string) {
  return /\?$/.test(content) && /^(do|does|did|can|could|should|would|will|is|are|was|were|have|has|had)\b/i.test(content);
}

export function mergeComposerInput(currentInput: string, prompt: string) {
  const nextPrompt = prompt.trim();
  if (!nextPrompt) {return currentInput;}

  const existing = currentInput.trim();
  if (!existing) {return nextPrompt;}

  if (/[.!?]$/.test(existing)) {
    return `${existing} ${nextPrompt}`;
  }

  return `${existing}\n${nextPrompt}`;
}

export function buildWorkspaceSuggestionRow(context: ComposerSuggestionContext): ComposerSuggestionRow | null {
  // Workspace starters are only meaningful as cold-start prompts; once a real
  // exchange exists, follow-ups derived from the actual reply take over.
  if (context.activeMessages.length > 0) {
    return null;
  }

  if (context.promptBankPrompts && context.promptBankPrompts.length > 0) {
    return {
      id: "workspace",
      label: "Workspace suggestions",
      collapsible: true,
      defaultExpanded: true,
      suggestions: context.promptBankPrompts.map((prompt, index) => ({
        id: `workspace-bank-${index}`,
        label: prompt,
        prompt: prompt,
        action: "append",
      })),
    };
  }

  // If we have AI-generated starter prompts, use them directly
  if (context.topicSignature?.suggested_prompts && context.topicSignature.suggested_prompts.length > 0) {
    return {
      id: "workspace",
      label: "Workspace suggestions",
      collapsible: true,
      defaultExpanded: true,
      suggestions: context.topicSignature.suggested_prompts.map((prompt, index) => ({
        id: `workspace-ai-${index}`,
        label: prompt,
        prompt: prompt,
        action: "append",
      })),
    };
  }

  // Fallback to legacy string-interpolation if no AI prompts are available yet
  const topicTerms = context.topicSignature?.auto_detected_tags
    .slice(0, 4)
    .map((tag) => tag.tag) ?? [];

  // Only generate suggestions when there is real content — folder name alone is
  // not enough context for meaningful suggestions.
  if (topicTerms.length === 0) {
    return null;
  }

  const terms = uniqueTerms([
    context.folderName,
    ...topicTerms,
  ]).slice(0, 4);

  const hasDocs = context.processedDocCount > 0;
  return {
    id: "workspace",
    label: "Workspace",
    collapsible: true,
    defaultExpanded: true,
    suggestions: terms.map((term, index) => ({
      id: `workspace-${index}`,
      label: buildWorkspacePrompt(term, index, hasDocs),
      prompt: buildWorkspacePrompt(term, index, hasDocs),
      action: "append",
    })),
  };
}

export function buildChatSuggestionRow(context: ComposerSuggestionContext): ComposerSuggestionRow | null {
  const binarySuggestions = asksBinaryQuestion(latestAssistantMessage(context.activeMessages))
    ? [
        {
          id: "chat-binary-yes",
          label: "Yes",
          prompt: "Yes",
          action: "send_immediately" as const,
        },
        {
          id: "chat-binary-no",
          label: "No",
          prompt: "No",
          action: "send_immediately" as const,
        },
      ]
    : [];

  const followUpSuggestions = context.followUps.slice(0, 3).map((suggestion, index) => ({
    id: `chat-follow-up-${index}`,
    label: suggestion,
    prompt: suggestion,
    action: "append" as const,
  }));

  const suggestions = [
    ...binarySuggestions,
    ...followUpSuggestions,
  ];

  if (suggestions.length === 0) {
    return null;
  }

  return {
    id: "chat",
    label: "Chat",
    suggestions,
  };
}
