import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import FeedCard from "./components/FeedCard";
import type { FeedMode } from "./components/FeedCard";
import {
  deckKey,
  exportDeckToRaw,
  mergeDecks,
  parseDeck,
  reshuffleAvoidingRepeat,
  shuffle,
} from "./lib/deck";
import type { Deck, DeckCard } from "./lib/deck";
import { loadQuarantine, saveQuarantine } from "./lib/quarantine";
import type { QuarantineMap } from "./lib/quarantine";
import { loadStarred, saveStarred } from "./lib/starred";
import type { StarredMap } from "./lib/starred";
import {
  DIFFICULTY_PRESETS,
  DEFAULT_PRESET_ID,
  getDifficultyColor,
  resolvePresetId,
} from "./lib/difficulty";
import type { DifficultyScore } from "./lib/difficulty";

const COMMIT_THRESHOLD_PX = 80;
const RUBBER_BAND_MAX_PX = 30;
const TAP_SLOP_PX = 10;

export default function App() {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [enabledDifficulties, setEnabledDifficulties] = useState<Set<DifficultyScore>>(
    new Set<DifficultyScore>([1, 2, 3, 4, 5]),
  );
  const [quarantined, setQuarantined] = useState<QuarantineMap>({});
  const [starred, setStarred] = useState<StarredMap>({});
  const [showBanished, setShowBanished] = useState(false);
  const [showStarred, setShowStarred] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [order, setOrder] = useState<DeckCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [mode, setMode] = useState<FeedMode>("study");
  const [showAnswerImmediately, setShowAnswerImmediately] = useState(
    () => localStorage.getItem("boomscroll_show_answer_immediately") === "1",
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingDeck, setPendingDeck] = useState<{ raw: string; deck: Deck } | null>(null);
  const [useTransition, setUseTransition] = useState(false);

  const nextOrderRef = useRef<DeckCard[] | null>(null);
  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const movedRef = useRef(false);
  const axisRef = useRef<"vertical" | "horizontal" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const current = order[index] ?? null;
  const isLastCard = order.length > 0 && index === order.length - 1;

  // Pre-shuffle the next round while the user is on the last card, so the
  // "next" preview during the drag is already the reshuffled first card.
  useEffect(() => {
    if (isLastCard && current && !nextOrderRef.current) {
      nextOrderRef.current = reshuffleAvoidingRepeat(order, current.id);
    }
  }, [isLastCard, current, order]);

  // Keep the difficulty filter in sync with which workspaces are enabled.
  // Switching to a workspace whose cards don't include a previously-picked
  // level left enabledDifficulties disjoint from availableLevels, so every
  // card in the new selection was filtered out and the feed silently showed
  // zero cards.
  useEffect(() => {
    if (!deck) {return;}
    const availableHere = new Set<DifficultyScore>();
    for (const card of deck.cards) {
      if (!enabledIds.has(card.workspaceId)) {continue;}
      if (card.difficulty === undefined) {continue;}
      availableHere.add(card.difficulty);
    }
    if (availableHere.size === 0) {return;}
    const hasOverlap = [...enabledDifficulties].some((level) => availableHere.has(level));
    if (!hasOverlap) {
      setEnabledDifficulties(availableHere);
    }
  }, [deck, enabledIds, enabledDifficulties]);

  // Restore deck from localStorage on mount if available
  useEffect(() => {
    const savedDeck = localStorage.getItem("boomscroll_active_deck");
    if (!savedDeck) {return;}
    try {
      const savedIdsRaw = localStorage.getItem("boomscroll_enabled_ids");
      const savedIds = savedIdsRaw ? new Set<string>(JSON.parse(savedIdsRaw)) : undefined;
      loadDeckFromText(savedDeck, savedIds, true);
    } catch {
      localStorage.removeItem("boomscroll_active_deck");
      localStorage.removeItem("boomscroll_enabled_ids");
    }
  }, []);

  const next: DeckCard | null = isLastCard
    ? (nextOrderRef.current?.[0] ?? null)
    : (order[index + 1] ?? null);

  /**
   * Study mode shows the long-form explanation cards; Test mode shows the
   * question/answer flashcards. If the deck has nothing of the requested kind,
   * fall back to all cards rather than showing an empty feed.
   */
  function filterCardsForMode(cards: DeckCard[], activeMode: FeedMode): DeckCard[] {
    const matching = cards.filter((c) =>
      activeMode === "study" ? c.kind === "info" : c.kind !== "info",
    );
    return matching.length > 0 ? matching : cards;
  }

  function startFeed(
    sourceDeck: Deck,
    ids: Set<string>,
    diffs: Set<DifficultyScore> = enabledDifficulties,
    activeMode: FeedMode = mode,
    // Passed explicitly on the load path, where the state update hasn't landed
    // yet — same hazard the `diffs` parameter exists for.
    banished: QuarantineMap = quarantined,
  ) {
    const wsCards = sourceDeck.cards.filter((card) => {
      if (!ids.has(card.workspaceId)) {return false;}
      if (banished[card.id]) {return false;}
      if (card.difficulty !== undefined && !diffs.has(card.difficulty)) {
        return false;
      }
      return true;
    });
    const modeCards = filterCardsForMode(wsCards, activeMode);
    setOrder(shuffle(modeCards));
    setIndex(0);
    setRevealed(showAnswerImmediately);
    setShowFilter(false);
    setShowBanished(false);
    nextOrderRef.current = null;
    localStorage.setItem("boomscroll_enabled_ids", JSON.stringify(Array.from(ids)));
  }

  function switchFeedMode(newMode: FeedMode) {
    setMode(newMode);
    if (deck) {
      startFeed(deck, enabledIds, enabledDifficulties, newMode);
    }
  }

  function toggleShowAnswerImmediately() {
    const nextValue = !showAnswerImmediately;
    setShowAnswerImmediately(nextValue);
    localStorage.setItem("boomscroll_show_answer_immediately", nextValue ? "1" : "0");
    // Apply to the card already on screen so the change is visible at once.
    setRevealed(nextValue);
  }

  function loadDeckFromText(raw: string, initialEnabledIds?: Set<string>, forceDirect = false) {
    try {
      const parsed = parseDeck(raw);
      // If a deck is already loaded and we're not forcing direct load, prompt for merge/replace
      if (deck !== null && !forceDirect) {
        setPendingDeck({ raw, deck: parsed });
        return;
      }

      const allIds = initialEnabledIds ?? new Set(parsed.workspaces.map((ws) => ws.id));
      const banished = loadQuarantine(deckKey(parsed));
      setDeck(parsed);
      setEnabledIds(allIds);
      setQuarantined(banished);
      setStarred(loadStarred(deckKey(parsed)));
      setError(null);
      localStorage.setItem("boomscroll_active_deck", raw);
      localStorage.setItem("boomscroll_enabled_ids", JSON.stringify(Array.from(allIds)));
      if (parsed.workspaces.length > 1 && !initialEnabledIds) {
        setShowFilter(true);
        setOrder([]);
      } else {
        startFeed(parsed, allIds, enabledDifficulties, mode, banished);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't read that deck.");
    }
  }

  function handleConfirmMerge() {
    if (!deck || !pendingDeck) {return;}
    const merged = mergeDecks(deck, pendingDeck.deck);
    const rawExport = exportDeckToRaw(merged);
    const newEnabledIds = new Set([
      ...Array.from(enabledIds),
      ...pendingDeck.deck.workspaces.map((ws) => ws.id),
    ]);

    // The merged deck spans a different set of workspaces, so it has a
    // different deckKey — carry the banished cards over to it, merging in
    // anything already banished in the incoming deck.
    const mergedBanished: QuarantineMap = {
      ...loadQuarantine(deckKey(pendingDeck.deck)),
      ...quarantined,
    };
    saveQuarantine(deckKey(merged), mergedBanished);

    const mergedStarred: StarredMap = {
      ...loadStarred(deckKey(pendingDeck.deck)),
      ...starred,
    };
    saveStarred(deckKey(merged), mergedStarred);

    setDeck(merged);
    setEnabledIds(newEnabledIds);
    setQuarantined(mergedBanished);
    setStarred(mergedStarred);
    localStorage.setItem("boomscroll_active_deck", rawExport);
    localStorage.setItem("boomscroll_enabled_ids", JSON.stringify(Array.from(newEnabledIds)));
    setPendingDeck(null);
    startFeed(merged, newEnabledIds, enabledDifficulties, mode, mergedBanished);
  }

  function handleConfirmReplace() {
    if (!pendingDeck) {return;}
    const incomingRaw = pendingDeck.raw;
    setPendingDeck(null);
    loadDeckFromText(incomingRaw, undefined, true);
  }

  async function openDeck() {
    setError(null);
    if (isTauri()) {
      const selected = await open({
        multiple: false,
        title: "Open a Boom Scroll deck",
        filters: [{ name: "Boom Scroll deck", extensions: ["json"] }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) {return;}
      try {
        loadDeckFromText(await readTextFile(path));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Couldn't read that file.");
      }
    } else {
      // Browser dev fallback — no Tauri APIs available.
      fileInputRef.current?.click();
    }
  }

  function onBrowserFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {return;}
    const reader = new FileReader();
    reader.onload = () => loadDeckFromText(String(reader.result));
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsText(file);
  }

  async function loadDemoDeck() {
    setError(null);
    try {
      const response = await fetch("/demo.json");
      if (!response.ok) {
        throw new Error("Could not fetch the demo deck.");
      }
      const raw = await response.text();
      loadDeckFromText(raw);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't load demo deck.");
    }
  }

  function closeDeck() {
    setDeck(null);
    setOrder([]);
    // In-memory only — the persisted per-deck record stays, so reopening this
    // deck restores what was banished in it.
    setQuarantined({});
    setStarred({});
    setShowBanished(false);
    setShowStarred(false);
    setShowFilter(false);
    nextOrderRef.current = null;
    localStorage.removeItem("boomscroll_active_deck");
    localStorage.removeItem("boomscroll_enabled_ids");
  }

  /**
   * Pull the current card out of the feed. The card stays in the deck and in
   * the banished list — this is reversible, not a delete.
   */
  function banishCurrent() {
    if (!current || !deck) {return;}
    const banishedId = current.id;
    const nextBanished: QuarantineMap = {
      ...quarantined,
      [banishedId]: { at: new Date().toISOString() },
    };
    setQuarantined(nextBanished);
    saveQuarantine(deckKey(deck), nextBanished);

    // Drop it from the running order and leave `index` where it is, so the
    // following card slides into this slot. Advancing the index here would
    // skip a card.
    const nextOrder = order.filter((c) => c.id !== banishedId);
    // The pre-shuffled next round may contain the banished card.
    nextOrderRef.current = null;
    setOrder(nextOrder);
    if (nextOrder.length === 0) {
      setIndex(0);
      setShowFilter(true);
    } else if (index >= nextOrder.length) {
      setIndex(0);
    }
    setRevealed(showAnswerImmediately);
    setDrag(0);
    setDragX(0);
    setUseTransition(false);
  }

  function restoreCards(ids: string[]) {
    if (!deck || ids.length === 0) {return;}
    const nextBanished = { ...quarantined };
    for (const id of ids) {
      delete nextBanished[id];
    }
    setQuarantined(nextBanished);
    saveQuarantine(deckKey(deck), nextBanished);
    startFeed(deck, enabledIds, enabledDifficulties, mode, nextBanished);
  }

  /**
   * Star the current card as a bookmark. Unlike banishing, this doesn't
   * remove it from the feed — it just advances to the next card.
   */
  function starCurrent() {
    if (!current || !deck) {return;}
    const nextStarred: StarredMap = {
      ...starred,
      [current.id]: { at: new Date().toISOString() },
    };
    setStarred(nextStarred);
    saveStarred(deckKey(deck), nextStarred);
    setUseTransition(true);
    setCommitting(true);
    setDragX(-window.innerWidth);
  }

  function unstarCards(ids: string[]) {
    if (!deck || ids.length === 0) {return;}
    const nextStarred = { ...starred };
    for (const id of ids) {
      delete nextStarred[id];
    }
    setStarred(nextStarred);
    saveStarred(deckKey(deck), nextStarred);
  }

  function advance() {
    if (isLastCard) {
      const nextOrder = nextOrderRef.current ?? shuffle(order);
      nextOrderRef.current = null;
      setOrder(nextOrder);
      setIndex(0);
    } else {
      setIndex((i) => i + 1);
    }
    setRevealed(showAnswerImmediately);
    setCommitting(false);
    setUseTransition(false);
    setDrag(0);
    setDragX(0);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (committing || !current) {return;}
    setUseTransition(false);
    startYRef.current = event.clientY;
    startXRef.current = event.clientX;
    movedRef.current = false;
    axisRef.current = null;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || committing) {return;}
    const dy = event.clientY - startYRef.current;
    const dx = event.clientX - startXRef.current;

    if (!axisRef.current) {
      if (Math.abs(dy) > TAP_SLOP_PX || Math.abs(dx) > TAP_SLOP_PX) {
        movedRef.current = true;
        axisRef.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      }
    }

    if (axisRef.current === "horizontal") {
      setDragX(dx);
      return;
    }
    if (axisRef.current === "vertical") {
      if (dy > 0) {
        const rubberBand = (dy * RUBBER_BAND_MAX_PX) / (dy + RUBBER_BAND_MAX_PX);
        setDrag(rubberBand);
      } else {
        setDrag(dy);
      }
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) {return;}
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Element might have unmounted during commit
    }

    setUseTransition(true);
    if (!movedRef.current) {
      // Study cards always show their explanation; only Test cards toggle.
      if (mode === "test") {setRevealed((r) => !r);}
      setDrag(0);
      return;
    }

    if (axisRef.current === "horizontal") {
      if (dragX > COMMIT_THRESHOLD_PX) {
        // Swipe right: banish. banishCurrent() resets drag/dragX itself.
        banishCurrent();
      } else if (dragX < -COMMIT_THRESHOLD_PX) {
        // Swipe left: star, then slide the card away like a normal advance.
        starCurrent();
        setDragX(0);
      } else {
        setDragX(0);
      }
      return;
    }

    if (drag < -COMMIT_THRESHOLD_PX) {
      setCommitting(true);
      setDrag(-window.innerHeight);
    } else {
      setDrag(0);
    }
  }

  // Loader screen
  if (!deck) {
    return (
      <main className="safe-screen flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Boom Scroll</h1>
        <p className="max-w-xs text-sm text-zinc-400">
          Export a deck from Aetherium (Preferences → Backup → Boom Scroll),
          move the file to this device, and open it here.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs justify-center">
          <button
            onClick={() => void openDeck()}
            className="flex min-h-[48px] items-center justify-center rounded-full bg-zinc-50 px-6 py-3 text-sm font-semibold text-zinc-900 active:opacity-80 transition-opacity"
          >
            Open deck
          </button>
          <button
            onClick={() => void loadDemoDeck()}
            className="flex min-h-[48px] items-center justify-center rounded-full border border-zinc-800 bg-transparent px-6 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-900/50 hover:text-zinc-100 active:opacity-80 transition-all"
          >
            Try demo deck
          </button>
        </div>
        {error && <p className="max-w-xs text-sm text-red-400">{error}</p>}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={onBrowserFile}
        />
      </main>
    );
  }

  const banishedCount = Object.keys(quarantined).length;
  const starredCount = Object.keys(starred).length;

  // Banished-cards review screen
  if (showBanished) {
    // Most recently banished first — the order you want when undoing a misfire.
    const banishedCards = deck.cards
      .filter((card) => quarantined[card.id])
      .sort((a, b) => quarantined[b.id].at.localeCompare(quarantined[a.id].at));

    return (
      <main className="safe-screen flex h-full flex-col items-center gap-4 px-6 py-4">
        <div className="w-full max-w-sm shrink-0 flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">Banished</h1>
          <button
            onClick={() => setShowBanished(false)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/60 px-3.5 text-xs font-medium text-zinc-300 hover:text-zinc-100 active:opacity-80 transition-colors"
          >
            Done
          </button>
        </div>

        <p className="w-full max-w-sm shrink-0 text-xs text-zinc-500">
          These cards are held out of the feed. Restoring one puts it back in
          rotation.
        </p>

        {banishedCards.length === 0 ? (
          <p className="my-auto text-sm text-zinc-500">Nothing banished.</p>
        ) : (
          <ul className="w-full max-w-sm min-h-0 flex-1 space-y-2 overflow-y-auto touch-pan-y pr-1">
            {banishedCards.map((card) => (
              <li
                key={card.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3"
              >
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-sm text-zinc-200 line-clamp-2">{card.front}</span>
                  <span className="mt-1 block text-[11px] uppercase tracking-wider text-zinc-500">
                    {card.workspaceName}
                  </span>
                </span>
                <button
                  onClick={() => restoreCards([card.id])}
                  className="shrink-0 flex min-h-[44px] items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/80 px-4 text-xs font-medium text-zinc-200 hover:bg-zinc-800 hover:text-zinc-100 active:opacity-80 transition-colors"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}

        {banishedCards.length > 0 && (
          <div className="flex shrink-0 w-full max-w-sm pt-2">
            <button
              onClick={() => restoreCards(banishedCards.map((c) => c.id))}
              className="flex min-h-[48px] w-full items-center justify-center rounded-full border border-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-900/50 hover:text-zinc-100 active:opacity-80 transition-colors"
            >
              Restore all
            </button>
          </div>
        )}
      </main>
    );
  }

  // Starred-cards review screen
  if (showStarred) {
    // Most recently starred first, same rationale as Banished.
    const starredCards = deck.cards
      .filter((card) => starred[card.id])
      .sort((a, b) => starred[b.id].at.localeCompare(starred[a.id].at));

    return (
      <main className="safe-screen flex h-full flex-col items-center gap-4 px-6 py-4">
        <div className="w-full max-w-sm shrink-0 flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">Starred</h1>
          <button
            onClick={() => setShowStarred(false)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/60 px-3.5 text-xs font-medium text-zinc-300 hover:text-zinc-100 active:opacity-80 transition-colors"
          >
            Done
          </button>
        </div>

        <p className="w-full max-w-sm shrink-0 text-xs text-zinc-500">
          Cards you've bookmarked. They stay in the feed — unstarring just
          removes the bookmark.
        </p>

        {starredCards.length === 0 ? (
          <p className="my-auto text-sm text-zinc-500">Nothing starred.</p>
        ) : (
          <ul className="w-full max-w-sm min-h-0 flex-1 space-y-2 overflow-y-auto touch-pan-y pr-1">
            {starredCards.map((card) => (
              <li
                key={card.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3"
              >
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-sm text-zinc-200 line-clamp-2">{card.front}</span>
                  <span className="mt-1 block text-[11px] uppercase tracking-wider text-zinc-500">
                    {card.workspaceName}
                  </span>
                </span>
                <button
                  onClick={() => unstarCards([card.id])}
                  className="shrink-0 flex min-h-[44px] items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/80 px-4 text-xs font-medium text-zinc-200 hover:bg-zinc-800 hover:text-zinc-100 active:opacity-80 transition-colors"
                >
                  Unstar
                </button>
              </li>
            ))}
          </ul>
        )}

        {starredCards.length > 0 && (
          <div className="flex shrink-0 w-full max-w-sm pt-2">
            <button
              onClick={() => unstarCards(starredCards.map((c) => c.id))}
              className="flex min-h-[48px] w-full items-center justify-center rounded-full border border-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-900/50 hover:text-zinc-100 active:opacity-80 transition-colors"
            >
              Unstar all
            </button>
          </div>
        )}
      </main>
    );
  }

  // Workspace filter screen
  if (showFilter || !current) {
    const enabledCards = deck.cards.filter((card) => {
      if (!enabledIds.has(card.workspaceId)) {return false;}
      if (quarantined[card.id]) {return false;}
      if (card.difficulty !== undefined && !enabledDifficulties.has(card.difficulty)) {
        return false;
      }
      return true;
    }).length;
    const allSelected = deck.workspaces.length > 0 && deck.workspaces.every((ws) => enabledIds.has(ws.id));

    // How many cards each level actually holds, for the workspaces currently
    // enabled. Only levels with content are offered as a choice — no deck ships
    // a full 1-5 spread, and a fixed grid made two buttons yield an empty feed.
    const countsByLevel = new Map<DifficultyScore, number>();
    for (const card of deck.cards) {
      if (!enabledIds.has(card.workspaceId)) {continue;}
      if (quarantined[card.id]) {continue;}
      if (card.difficulty === undefined) {continue;}
      countsByLevel.set(card.difficulty, (countsByLevel.get(card.difficulty) ?? 0) + 1);
    }
    const availableLevels = ([1, 2, 3, 4, 5] as DifficultyScore[]).filter(
      (level) => (countsByLevel.get(level) ?? 0) > 0,
    );

    // Each workspace's own declared preset always wins; workspaces that
    // declare none fall back to the default. When the enabled workspaces
    // agree on a preset, label the level buttons with it.
    const enabledPresets = new Set(
      deck.workspaces
        .filter((ws) => enabledIds.has(ws.id))
        .map((ws) => resolvePresetId({ difficultyPreset: ws.preset }, DEFAULT_PRESET_ID)),
    );
    const buttonPresetId =
      enabledPresets.size === 1 ? [...enabledPresets][0] : DEFAULT_PRESET_ID;
    const preset = DIFFICULTY_PRESETS[buttonPresetId] ?? DIFFICULTY_PRESETS[DEFAULT_PRESET_ID];
    const presetsDiverge = enabledPresets.size > 1;

    return (
      <main className="safe-screen flex h-full flex-col items-center justify-center gap-4 px-6 py-4">
        <div className="w-full max-w-sm shrink-0 flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">Filter Deck</h1>
          <button
            onClick={() => {
              if (current) {
                setShowFilter(false);
              } else {
                startFeed(deck, enabledIds, enabledDifficulties);
              }
            }}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/60 px-3.5 text-xs font-medium text-zinc-300 hover:text-zinc-100 active:opacity-80 transition-colors"
          >
            Done
          </button>
        </div>

        <div className="w-full max-w-sm shrink-0 space-y-2 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-3.5">
          {presetsDiverge && (
            <p className="text-[11px] leading-snug text-zinc-500">
              Workspaces use different level names — the buttons below show the
              default.
            </p>
          )}

          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Difficulty Range
              </span>
            </div>

            {availableLevels.length === 0 ? (
              <p className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
                The selected workspaces have no levelled cards, so every card is
                shown.
              </p>
            ) : (
              // Only levels this deck actually has content for. A fixed 1–5 grid
              // offered choices that silently yielded an empty feed.
              <div
                className="grid gap-1.5"
                style={{
                  gridTemplateColumns: `repeat(${availableLevels.length}, minmax(0, 1fr))`,
                }}
              >
                {availableLevels.map((level) => {
                  const count = countsByLevel.get(level) ?? 0;
                  const isSelected = enabledDifficulties.has(level);
                  const color = getDifficultyColor(level);
                  const label = preset.labels[level];
                  return (
                    <button
                      key={level}
                      onClick={() =>
                        setEnabledDifficulties((prev) => {
                          const nextSet = new Set(prev);
                          if (nextSet.has(level)) {
                            if (nextSet.size > 1) {nextSet.delete(level);}
                          } else {
                            nextSet.add(level);
                          }
                          return nextSet;
                        })
                      }
                      className={`flex min-h-[52px] flex-col items-center justify-center rounded-xl border px-1 py-2 transition-all ${
                        isSelected
                          ? `${color.bg} ${color.border} ${color.text} shadow-sm font-semibold`
                          : "border-zinc-800 bg-zinc-950/40 text-zinc-500 opacity-60"
                      }`}
                      title={`${label} — ${count} cards`}
                    >
                      <span className="text-xs font-bold">L{level}</span>
                      <span className="text-[9px] truncate max-w-full leading-tight mt-0.5">
                        {label.split(" ")[0]}
                      </span>
                      <span className="text-[9px] leading-tight tabular-nums opacity-70">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex w-full max-w-sm shrink-0 items-center justify-between pt-1">
          <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
            Workspaces ({enabledIds.size}/{deck.workspaces.length})
          </span>
          <button
            onClick={() =>
              setEnabledIds(allSelected ? new Set() : new Set(deck.workspaces.map((ws) => ws.id)))
            }
            className="flex min-h-[44px] items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/60 px-3.5 text-xs font-medium text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100 active:opacity-80 transition-colors"
          >
            {allSelected ? "Unselect all" : "Select all"}
          </button>
        </div>

        <ul className="w-full max-w-sm min-h-0 flex-1 space-y-2 overflow-y-auto touch-pan-y pr-1">
          {deck.workspaces.map((ws) => (
            <li key={ws.id}>
              <label className="flex min-h-[48px] items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 cursor-pointer hover:border-zinc-700 transition-colors">
                <span className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5 rounded border-zinc-700 accent-purple-500 cursor-pointer shrink-0"
                    checked={enabledIds.has(ws.id)}
                    onChange={() =>
                      setEnabledIds((prev) => {
                        const nextIds = new Set(prev);
                        if (nextIds.has(ws.id)) {
                          nextIds.delete(ws.id);
                        } else {
                          nextIds.add(ws.id);
                        }
                        return nextIds;
                      })
                    }
                  />
                  {ws.name}
                </span>
                <span className="text-xs text-zinc-500">{ws.cardCount} cards</span>
              </label>
            </li>
          ))}
        </ul>

        <div className="flex shrink-0 flex-col items-center gap-2.5 w-full max-w-sm pt-2">
          <button
            onClick={() => startFeed(deck, enabledIds, enabledDifficulties)}
            disabled={enabledCards === 0}
            className="flex min-h-[48px] w-full items-center justify-center rounded-full bg-zinc-50 px-6 py-3 text-sm font-semibold text-zinc-900 active:opacity-80 disabled:opacity-40"
          >
            Scroll {enabledCards} cards
          </button>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => void openDeck()}
              className="flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 active:bg-zinc-900/60 transition-colors"
            >
              + Add deck
            </button>
            {starredCount > 0 && (
              <button
                onClick={() => setShowStarred(true)}
                className="flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 active:bg-zinc-900/60 transition-colors"
              >
                Starred ({starredCount})
              </button>
            )}
            {banishedCount > 0 && (
              <button
                onClick={() => setShowBanished(true)}
                className="flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 active:bg-zinc-900/60 transition-colors"
              >
                Banished ({banishedCount})
              </button>
            )}
            <button
              onClick={closeDeck}
              className="flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-300 active:bg-zinc-900/60 transition-colors"
            >
              Close deck
            </button>
          </div>
        </div>
      </main>
    );
  }

  const transition = useTransition && !dragging ? "transform 250ms ease-out" : "none";

  return (
    <main
      className="relative h-full w-full overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Safe area top margin keeps controls clear of Android status bar / camera cutout */}
      <div className="pointer-events-none absolute left-0 right-0 top-[calc(var(--safe-top)+0.5rem)] z-10 flex items-center justify-between gap-2 px-3 sm:px-4">
        <div className="pointer-events-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          <div className="flex shrink-0 overflow-hidden rounded-full border border-zinc-800 text-xs bg-zinc-950/80 backdrop-blur-md">
            <button
              onClick={() => switchFeedMode("study")}
              className={`flex min-h-[44px] items-center justify-center whitespace-nowrap px-3.5 font-medium transition-colors ${mode === "study" ? "bg-purple-900/60 text-purple-200 font-semibold" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              Study
            </button>
            <button
              onClick={() => switchFeedMode("test")}
              className={`flex min-h-[44px] items-center justify-center whitespace-nowrap px-3.5 font-medium transition-colors ${mode === "test" ? "bg-zinc-800 text-zinc-100 font-semibold" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              Test
            </button>
          </div>
          {mode === "test" && (
            <button
              onClick={toggleShowAnswerImmediately}
              role="switch"
              aria-checked={showAnswerImmediately}
              aria-label="Show the answer as soon as each card appears"
              title="Show the answer as soon as each card appears"
              className="flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-800 bg-zinc-950/80 px-3 text-xs text-zinc-400 backdrop-blur-md transition-colors active:text-zinc-200"
            >
              <span
                aria-hidden="true"
                className={`flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px] font-bold leading-none transition-colors ${
                  showAnswerImmediately
                    ? "border-emerald-400 bg-emerald-400 text-zinc-900"
                    : "border-zinc-600 text-transparent"
                }`}
              >
                ✓
              </span>
              Show
            </button>
          )}
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => void openDeck()}
            className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-full border border-zinc-800 bg-zinc-950/80 px-3 text-xs font-medium text-zinc-400 backdrop-blur-md hover:text-zinc-200 active:text-zinc-200 transition-colors"
            title="Import another deck"
          >
            + Add
          </button>
          {deck.workspaces.length > 1 && (
            <button
              onClick={() => setShowFilter(true)}
              className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-full border border-zinc-800 bg-zinc-950/80 px-3 text-xs font-medium text-zinc-400 backdrop-blur-md hover:text-zinc-200 active:text-zinc-200 transition-colors"
              title="Choose workspaces"
            >
              Decks
            </button>
          )}
          <button
            onClick={closeDeck}
            className="flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/80 text-sm font-medium text-zinc-400 backdrop-blur-md hover:text-zinc-200 active:text-zinc-100 transition-colors"
            aria-label="Close deck"
            title="Close deck"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Background card (next in feed) */}
      {next && (
        <div className="absolute inset-0 z-0">
          <FeedCard card={next} mode={mode} revealed={false} activePresetId={DEFAULT_PRESET_ID} />
        </div>
      )}

      {/* Active card (top of stack) */}
      <div
        key={current.id}
        style={{
          transform: `translate3d(${dragX}px, ${drag}px, 0) rotate(${dragX / 24}deg)`,
          transition,
          opacity: dragX !== 0 ? Math.max(1 - Math.abs(dragX) / window.innerWidth, 0.2) : 1,
        }}
        onTransitionEnd={() => {
          if (committing) {advance();}
        }}
        className="absolute inset-0 z-0 select-none touch-none"
      >
        <FeedCard card={current} mode={mode} revealed={revealed} activePresetId={DEFAULT_PRESET_ID} />
      </div>

      {/* Hidden file input for browser dev mode fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={onBrowserFile}
      />

      {/* Modal overlay when loading a deck while one is active */}
      {pendingDeck && (
        <div className="safe-screen fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 px-6 backdrop-blur-sm">
          <div className="my-auto w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-center space-y-4 shadow-2xl">
            <h2 className="text-lg font-bold text-zinc-100">Import Deck</h2>
            <p className="text-xs text-zinc-400 leading-relaxed">
              You already have an active deck loaded. Would you like to merge the new cards into your existing deck or replace it completely?
            </p>

            <div className="rounded-xl bg-zinc-950 border border-zinc-800/80 p-3 text-left space-y-1.5 text-xs">
              <div className="flex justify-between text-zinc-400">
                <span>Active Deck:</span>
                <span className="text-zinc-200 font-medium">
                  {deck.cards.length} cards ({deck.workspaces.length} workspaces)
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Incoming Deck:</span>
                <span className="text-emerald-400 font-medium">
                  +{pendingDeck.deck.cards.length} cards ({pendingDeck.deck.workspaces.length} workspaces)
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 pt-2">
              <button
                onClick={handleConfirmMerge}
                className="flex min-h-[48px] w-full items-center justify-center rounded-full bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-900 active:opacity-80 transition-opacity"
              >
                Merge Decks
              </button>
              <button
                onClick={handleConfirmReplace}
                className="flex min-h-[48px] w-full items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 px-4 py-3 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 active:opacity-80 transition-colors"
              >
                Replace Active Deck
              </button>
              <button
                onClick={() => setPendingDeck(null)}
                className="flex min-h-[44px] w-full items-center justify-center rounded-lg py-2 text-xs font-medium text-zinc-500 hover:text-zinc-300 active:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
