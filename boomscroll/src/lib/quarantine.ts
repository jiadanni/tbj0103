/**
 * Quarantined ("banished") cards for Boom Scroll.
 *
 * A card the user banishes with the X button is pulled out of the feed but
 * never deleted — it stays reviewable and restorable. The record is scoped per
 * deck (see `deckKey`) so a card id from one deck can't banish a card in
 * another, and so reopening a deck preserves what was banished in it.
 *
 * Every read and write is failure-tolerant: a corrupt blob or a full storage
 * quota must degrade to "nothing banished", never break the feed.
 */

const STORAGE_KEY = "boomscroll_quarantine";

export interface QuarantineEntry {
  /** ISO timestamp of when the card was banished; drives review-screen order. */
  at: string;
}

/** cardId -> entry, for a single deck. */
export type QuarantineMap = Record<string, QuarantineEntry>;

type QuarantineStore = Record<string, QuarantineMap>;

function readStore(): QuarantineStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {return {};}
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as QuarantineStore;
  } catch {
    return {};
  }
}

export function loadQuarantine(deckKey: string): QuarantineMap {
  const entry = readStore()[deckKey];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return {};
  }
  // Tolerate a legacy/hand-edited array-of-ids shape and anything malformed by
  // keeping only well-formed entries.
  const clean: QuarantineMap = {};
  for (const [cardId, value] of Object.entries(entry)) {
    if (typeof value === "object" && value !== null && typeof (value as QuarantineEntry).at === "string") {
      clean[cardId] = { at: (value as QuarantineEntry).at };
    }
  }
  return clean;
}

export function saveQuarantine(deckKey: string, map: QuarantineMap): void {
  try {
    const store = readStore();
    if (Object.keys(map).length === 0) {
      delete store[deckKey];
    } else {
      store[deckKey] = map;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota exceeded or storage unavailable — the in-memory state still holds
    // for this session; losing the persisted copy beats breaking the feed.
  }
}
