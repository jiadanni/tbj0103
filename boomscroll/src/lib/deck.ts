/**
 * Deck file parsing and shuffling for Boom Scroll.
 *
 * Deck files are produced by the Aetherium desktop app ("Boom Scroll" in
 * Preferences → Backup). Two format versions exist:
 *   v1: { format, version: 1, workspace: {id, name}, cards: [...] }
 *   v2: { format, version: 2, workspaces: [{id, name, card_count}], cards: [...] }
 * v2 cards carry a workspace_id; every parsed card resolves a workspaceName
 * so the feed can always show where a card came from.
 */

import type { DifficultyScore } from "./difficulty";

export interface DeckCard {
  id: string;
  kind: string;
  front: string;
  back: string;
  topic: string | null;
  workspaceId: string;
  workspaceName: string;
  difficulty?: DifficultyScore;
  difficultyPreset?: string;
  difficultyLabel?: string;
}

export interface DeckWorkspace {
  id: string;
  name: string;
  cardCount: number;
  preset?: string;
}

export interface Deck {
  title: string;
  workspaces: DeckWorkspace[];
  cards: DeckCard[];
}

const DECK_FORMAT = "aetherium.boomscroll.deck";
const SUPPORTED_VERSIONS = [1, 2, 3];

export function parseDeck(raw: string): Deck {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }

  if (typeof data !== "object" || data === null) {
    throw new Error("That file isn't a Boom Scroll deck.");
  }
  const obj = data as Record<string, unknown>;

  if (obj.format !== DECK_FORMAT) {
    throw new Error("That file isn't a Boom Scroll deck.");
  }
  if (typeof obj.version !== "number" || !SUPPORTED_VERSIONS.includes(obj.version)) {
    throw new Error(
      `This deck uses format version ${String(obj.version)}, but this app only supports versions ${SUPPORTED_VERSIONS.join(", ")}. Update the app.`,
    );
  }
  if (!Array.isArray(obj.cards)) {
    throw new Error("This deck has no cards array.");
  }

  // Workspace list: v2/v3 has `workspaces`; v1 has a single `workspace`.
  const nameById = new Map<string, string>();
  const presetById = new Map<string, string>();
  const declared: DeckWorkspace[] = [];
  const rawWorkspaces = Array.isArray(obj.workspaces)
    ? obj.workspaces
    : typeof obj.workspace === "object" && obj.workspace !== null
      ? [obj.workspace]
      : [];
  for (const entry of rawWorkspaces) {
    const ws = entry as Record<string, unknown>;
    if (typeof ws.id !== "string" || typeof ws.name !== "string") {continue;}
    nameById.set(ws.id, ws.name);
    if (typeof ws.preset === "string") {
      presetById.set(ws.id, ws.preset);
    }
    declared.push({
      id: ws.id,
      name: ws.name,
      cardCount: typeof ws.card_count === "number" ? ws.card_count : 0,
      preset: typeof ws.preset === "string" ? ws.preset : undefined,
    });
  }
  const fallbackName = declared.length === 1 ? declared[0].name : "Deck";
  const fallbackId = declared.length === 1 ? declared[0].id : "unknown";

  const cards: DeckCard[] = [];
  for (const entry of obj.cards) {
    if (typeof entry !== "object" || entry === null) {continue;}
    const card = entry as Record<string, unknown>;
    if (typeof card.front !== "string" || typeof card.back !== "string") {continue;}
    if (card.front.trim() === "" && card.back.trim() === "") {continue;}
    const workspaceId = typeof card.workspace_id === "string" ? card.workspace_id : fallbackId;

    let difficulty: DifficultyScore | undefined;
    if (typeof card.difficulty === "number" && card.difficulty >= 1 && card.difficulty <= 5) {
      difficulty = Math.round(card.difficulty) as DifficultyScore;
    }

    cards.push({
      id: typeof card.id === "string" ? card.id : `card-${cards.length}`,
      // Unknown kinds are tolerated and rendered as plain front/back.
      kind: typeof card.kind === "string" ? card.kind : "flashcard",
      front: card.front,
      back: card.back,
      topic: typeof card.topic === "string" ? card.topic : null,
      workspaceId,
      workspaceName: nameById.get(workspaceId) ?? fallbackName,
      difficulty,
      difficultyPreset:
        typeof card.difficulty_preset === "string"
          ? card.difficulty_preset
          : presetById.get(workspaceId),
      difficultyLabel:
        typeof card.difficulty_label === "string" ? card.difficulty_label : undefined,
    });
  }

  if (cards.length === 0) {
    throw new Error("This deck has no readable cards.");
  }

  // Recompute counts from actual cards so the filter screen never lies.
  const counts = new Map<string, number>();
  for (const card of cards) {
    counts.set(card.workspaceId, (counts.get(card.workspaceId) ?? 0) + 1);
  }
  const workspaces: DeckWorkspace[] =
    declared.length > 0
      ? declared.map((ws) => ({ ...ws, cardCount: counts.get(ws.id) ?? 0 }))
      : [...counts.entries()].map(([id, cardCount]) => ({
          id,
          name: cards.find((c) => c.workspaceId === id)?.workspaceName ?? "Deck",
          cardCount,
        }));

  const title =
    workspaces.length === 1 ? workspaces[0].name : `${workspaces.length} workspaces`;

  return { title, workspaces, cards };
}

/** Fisher–Yates shuffle; returns a new array. */
export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Reshuffle for the infinite loop: guarantees the first card of the new
 * round differs from the last card just shown (when the deck has > 1 card).
 */
export function reshuffleAvoidingRepeat(cards: DeckCard[], lastShownId: string): DeckCard[] {
  const next = shuffle(cards);
  if (next.length > 1 && next[0].id === lastShownId) {
    const swapWith = 1 + Math.floor(Math.random() * (next.length - 1));
    [next[0], next[swapWith]] = [next[swapWith], next[0]];
  }
  return next;
}

/**
 * Merges an existing deck with an incoming deck.
 * De-duplicates workspaces by workspaceId and de-duplicates cards by ID or matching content.
 */
export function mergeDecks(existing: Deck, incoming: Deck): Deck {
  const workspaceMap = new Map<string, DeckWorkspace>();
  for (const ws of existing.workspaces) {
    workspaceMap.set(ws.id, { ...ws });
  }
  for (const ws of incoming.workspaces) {
    if (!workspaceMap.has(ws.id)) {
      workspaceMap.set(ws.id, { ...ws });
    } else {
      const prev = workspaceMap.get(ws.id)!;
      workspaceMap.set(ws.id, { ...prev, name: ws.name || prev.name });
    }
  }

  const cardMap = new Map<string, DeckCard>();
  const cardContentSet = new Set<string>();

  for (const card of existing.cards) {
    cardMap.set(card.id, card);
    cardContentSet.add(`${card.workspaceId}:${card.front.trim()}:${card.back.trim()}`);
  }

  for (const card of incoming.cards) {
    const contentKey = `${card.workspaceId}:${card.front.trim()}:${card.back.trim()}`;
    if (!cardMap.has(card.id) && !cardContentSet.has(contentKey)) {
      cardMap.set(card.id, card);
      cardContentSet.add(contentKey);
    }
  }

  const mergedCards = Array.from(cardMap.values());

  const counts = new Map<string, number>();
  for (const card of mergedCards) {
    counts.set(card.workspaceId, (counts.get(card.workspaceId) ?? 0) + 1);
  }

  const mergedWorkspaces = Array.from(workspaceMap.values()).map((ws) => ({
    ...ws,
    cardCount: counts.get(ws.id) ?? 0,
  }));

  const title =
    mergedWorkspaces.length === 1
      ? mergedWorkspaces[0].name
      : `${mergedWorkspaces.length} workspaces`;

  return {
    title,
    workspaces: mergedWorkspaces,
    cards: mergedCards,
  };
}

/**
 * Serializes a Deck object back to standard deck JSON (format v2).
 */
export function exportDeckToRaw(deck: Deck): string {
  return JSON.stringify(
    {
      format: DECK_FORMAT,
      version: 2,
      exported_at: new Date().toISOString(),
      card_count: deck.cards.length,
      workspaces: deck.workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        card_count: ws.cardCount,
      })),
      cards: deck.cards.map((c) => ({
        id: c.id,
        kind: c.kind,
        front: c.front,
        back: c.back,
        topic: c.topic,
        workspace_id: c.workspaceId,
      })),
    },
    null,
    2,
  );
}

