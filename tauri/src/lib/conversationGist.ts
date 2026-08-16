/** Minimal shape needed to derive a gist; a structural subset of the import preview. */
export interface GistConversation {
  name?: string;
  first_user_message?: string;
  summary?: string;
  messages?: { role: string; content: string }[];
}

/**
 * True when the export supplied no usable conversation name: empty,
 * whitespace-only, or the literal "Untitled" Claude writes for chats it never
 * auto-titled. Rows with a generic name get a gist snippet so they stay
 * identifiable.
 */
export function isGenericConversationName(name: string | undefined): boolean {
  const trimmed = (name ?? "").trim();
  return trimmed === "" || trimmed.toLowerCase() === "untitled";
}

/**
 * Quick, offline gist for the Claude import review UI. Prefers Claude's own
 * export summary; where that is missing (~16% of orphans, all design chats) it
 * synthesizes one from the conversation's own text — never touches the raw
 * `summary` field the matcher relies on.
 */
export function conversationGist(conv: GistConversation, maxChars = 200): string {
  const summary = conv.summary?.trim();
  if (summary) { return summary; }
  const opener =
    conv.first_user_message?.trim() ||
    conv.messages?.find((m) => m.content.trim())?.content.trim() ||
    "";
  if (!opener) { return ""; }
  const firstSentence = opener.split(/(?<=[.!?])\s+/)[0]?.trim() || opener;
  const gist = firstSentence.length <= maxChars ? firstSentence : opener;
  return gist.length > maxChars ? `${gist.slice(0, maxChars).trimEnd()}\u2026` : gist;
}
