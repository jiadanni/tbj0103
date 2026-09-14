/**
 * Starred cards for Boom Scroll.
 *
 * A card the user stars with a left swipe stays in the feed — starring is
 * just a bookmark, unlike banishing which pulls a card out of rotation. The
 * record is scoped per deck (see `deckKey`), same as quarantine, so a card id
 * from one deck can't star a card in another.
 *
 * Every read and write is failure-tolerant: a corrupt blob or a full storage
 * quota must degrade to "nothing starred", never break the feed.
 */

const STORAGE_KEY = "boomscroll_starred";

export interface StarredEntry {
  /** ISO timestamp of when the card was starred; drives review-screen order. */
  at: string;
}

/** cardId -> entry, for a single deck. */
export type StarredMap = Record<string, StarredEntry>;

type StarredStore = Record<string, StarredMap>;

function readStore(): StarredStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {return {};}
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as StarredStore;
  } catch {
    return {};
  }
}

export function loadStarred(deckKey: string): StarredMap {
  const entry = readStore()[deckKey];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return {};
  }
  const clean: StarredMap = {};
  for (const [cardId, value] of Object.entries(entry)) {
    if (typeof value === "object" && value !== null && typeof (value as StarredEntry).at === "string") {
      clean[cardId] = { at: (value as StarredEntry).at };
    }
  }
  return clean;
}

export function saveStarred(deckKey: string, map: StarredMap): void {
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
