const DEFAULT_CHAT_TITLE = "New Chat";
const MAX_FALLBACK_TITLE_LENGTH = 60;
const FALLBACK_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "me",
  "my",
  "of",
  "on",
  "please",
  "the",
  "this",
  "to",
  "with",
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function sanitizeGeneratedChatTitle(title: string): string {
  return normalizeWhitespace(
    title
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.!?,:;]+$/g, "")
  );
}

function isUsableGeneratedTitle(title: string): boolean {
  if (!title) {return false;}
  const normalized = title.toLowerCase();
  return normalized !== DEFAULT_CHAT_TITLE.toLowerCase() && normalized !== "chat";
}

function truncateTitle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {return value;}
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

export function deriveChatTitleFromMessage(message: string): string {
  const normalized = normalizeWhitespace(message);
  if (!normalized) {return DEFAULT_CHAT_TITLE;}

  const stripped = normalized
    .replace(/^(hey|hi|hello)\b[,\s]*/i, "")
    .replace(/^(please\s+)?(can you help me|could you help me|would you help me|can you|could you|would you|help me|tell me|show me|explain)\b\s*/i, "")
    .replace(/^(what is|what are|how do i|how can i|how|why is|why are|why)\b\s*/i, "");

  const words = normalizeWhitespace(stripped)
    .split(" ")
    .filter(Boolean)
    .filter((word, index) => index < 2 || !FALLBACK_STOPWORDS.has(word.toLowerCase()));

  const candidate = sanitizeGeneratedChatTitle(normalizeWhitespace(words.join(" ")));
  return truncateTitle(candidate || sanitizeGeneratedChatTitle(normalized), MAX_FALLBACK_TITLE_LENGTH);
}

export function resolveChatTitle(options: {
  aiTitle?: string | null;
  firstMessage: string;
}): string {
  const sanitizedAiTitle = sanitizeGeneratedChatTitle(options.aiTitle ?? "");
  if (isUsableGeneratedTitle(sanitizedAiTitle)) {
    return sanitizedAiTitle;
  }
  return deriveChatTitleFromMessage(options.firstMessage);
}

export { DEFAULT_CHAT_TITLE };
