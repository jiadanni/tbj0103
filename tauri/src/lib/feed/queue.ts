/**
 * Feed queue mechanics for the Boom Scroll feed.
 *
 * Ported from the BoomScroll companion app. Kept free of React and of the
 * Tauri API so the ordering and filtering rules — the parts that actually
 * decide what a learner sees — can be tested directly.
 */

import type { FeedCard } from "../api";
import type { DifficultyScore } from "./difficulty";

export type FeedMode = "study" | "test";

/** Fisher-Yates shuffle; returns a new array. */
export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Reshuffle for the infinite loop: guarantees the first card of the new round
 * differs from the last card just shown (when the deck has more than one card),
 * so looping never shows the same card twice in a row.
 */
export function reshuffleAvoidingRepeat(cards: FeedCard[], lastShownId: string): FeedCard[] {
  const next = shuffle(cards);
  if (next.length > 1 && next[0].id === lastShownId) {
    const swapWith = 1 + Math.floor(Math.random() * (next.length - 1));
    [next[0], next[swapWith]] = [next[swapWith], next[0]];
  }
  return next;
}

/**
 * Study mode shows the long-form explanation cards; Test mode shows the
 * question/answer flashcards. If the deck has nothing of the requested kind,
 * fall back to all cards rather than showing an empty feed.
 */
export function filterCardsForMode(cards: FeedCard[], mode: FeedMode): FeedCard[] {
  const matching = cards.filter((c) =>
    mode === "study" ? c.kind === "info" : c.kind !== "info",
  );
  return matching.length > 0 ? matching : cards;
}

export interface EligibilityFilter {
  enabledWorkspaceIds: Set<string>;
  enabledDifficulties: Set<DifficultyScore>;
}

/**
 * Whether a card belongs in the running feed.
 *
 * A card with no difficulty is "unlevelled" and is never excluded by the level
 * selection — otherwise a library that predates levelling would show an empty
 * feed. Suspended cards are excluded here rather than at the query, so the
 * Banished screen can still list them from the same fetch.
 */
export function isCardEligible(card: FeedCard, filter: EligibilityFilter): boolean {
  if (!filter.enabledWorkspaceIds.has(card.workspace_id)) { return false; }
  if (card.suspended_at) { return false; }
  if (
    card.difficulty !== undefined &&
    card.difficulty !== null &&
    !filter.enabledDifficulties.has(card.difficulty as DifficultyScore)
  ) {
    return false;
  }
  return true;
}

/** The cards the feed should run, in shuffled order. */
export function buildQueue(
  cards: FeedCard[],
  filter: EligibilityFilter,
  mode: FeedMode,
): FeedCard[] {
  return shuffle(filterCardsForMode(cards.filter((c) => isCardEligible(c, filter)), mode));
}

/**
 * How many eligible cards each level holds, for the currently enabled
 * workspaces. Only levels with content should be offered as a choice — a fixed
 * 1-5 grid let the user pick levels that silently yielded an empty feed.
 */
export function countsByLevel(
  cards: FeedCard[],
  enabledWorkspaceIds: Set<string>,
): Map<DifficultyScore, number> {
  const counts = new Map<DifficultyScore, number>();
  for (const card of cards) {
    if (!enabledWorkspaceIds.has(card.workspace_id)) { continue; }
    if (card.suspended_at) { continue; }
    if (card.difficulty === undefined || card.difficulty === null) { continue; }
    const level = card.difficulty as DifficultyScore;
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  return counts;
}
