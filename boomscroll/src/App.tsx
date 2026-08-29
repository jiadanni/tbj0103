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
  const [activePresetId, setActivePresetId] = useState<string>(DEFAULT_PRESET_ID);
  const [quarantined, setQuarantined] = useState<QuarantineMap>({});
  const [showBanished, setShowBanished] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [order, setOrder] = useState<DeckCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [drag, setDrag] = useState(0);
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
  const movedRef = useRef(false);
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

  // Restore deck from localStorage on mount if available
  useEffect(() => {
    const savedDeck = localStorage.getItem("boomscroll_active_deck");
    if (!savedDeck) {return;}
    try {
      const savedIdsRaw = localStorage.getItem("boomscroll_enabled_ids");
      const savedIds = savedIdsRaw ? new Set<string>(JSON.parse(savedIdsRaw)) : undefined;
      const savedPreset = localStorage.getItem("boomscroll_active_preset");
      if (savedPreset && DIFFICULTY_PRESETS[savedPreset]) {
        setActivePresetId(savedPreset);
      }
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

    setDeck(merged);
    setEnabledIds(newEnabledIds);
    setQuarantined(mergedBanished);
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
    setShowBanished(false);
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
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (committing || !current) {return;}
    setUseTransition(false);
    startYRef.current = event.clientY;
    movedRef.current = false;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || committing) {return;}
    const dy = event.clientY - startYRef.current;
    if (Math.abs(dy) > TAP_SLOP_PX) {
      movedRef.current = true;
    }
    if (dy > 0) {
      const rubberBand = (dy * RUBBER_BAND_MAX_PX) / (dy + RUBBER_BAND_MAX_PX);
      setDrag(rubberBand);
    } else {
      setDrag(dy);
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
            className="rounded-full bg-zinc-50 px-6 py-3 text-sm font-semibold text-zinc-900 active:opacity-80 transition-opacity"
          >
            Open deck
          </button>
          <button
            onClick={() => void loadDemoDeck()}
            className="rounded-full border border-zinc-800 bg-transparent px-6 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-900/50 hover:text-zinc-100 active:opacity-80 transition-all"
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
            className="text-xs text-zinc-400 hover:text-zinc-200"
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
                className="flex items-start justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3"
              >
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-sm text-zinc-200 line-clamp-2">{card.front}</span>
                  <span className="mt-1 block text-[11px] uppercase tracking-wider text-zinc-500">
                    {card.workspaceName}
                  </span>
                </span>
                <button
                  onClick={() => restoreCards([card.id])}
                  className="shrink-0 rounded-full border border-zinc-800 px-3 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-900/50 hover:text-zinc-100 active:opacity-80 transition-colors"
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
              className="w-full rounded-full border border-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-900/50 hover:text-zinc-100 active:opacity-80 transition-colors"
            >
              Restore all
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
    const allDiffsSelected =
      availableLevels.length > 0 && availableLevels.every((l) => enabledDifficulties.has(l));

    // The user's pick is a fallback for decks that declare no preset; a deck
    // that states one per workspace wins. When the enabled workspaces agree on
    // a preset, label the level buttons with it.
    const enabledPresets = new Set(
      deck.workspaces
        .filter((ws) => enabledIds.has(ws.id))
        .map((ws) => resolvePresetId({ difficultyPreset: ws.preset }, activePresetId)),
    );
    const buttonPresetId =
      enabledPresets.size === 1 ? [...enabledPresets][0] : activePresetId;
    const preset = DIFFICULTY_PRESETS[buttonPresetId] ?? DIFFICULTY_PRESETS[DEFAULT_PRESET_ID];
    const presetsDiverge = enabledPresets.size > 1;
    // A deck that states its own preset everywhere makes the selector inert.
    const selectorIsFallback = !deck.workspaces
      .filter((ws) => enabledIds.has(ws.id))
      .every((ws) => ws.preset && DIFFICULTY_PRESETS[ws.preset]);

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
            className="text-xs text-zinc-400 hover:text-zinc-200"
          >
            Done
          </button>
        </div>

        <div className="w-full max-w-sm shrink-0 space-y-2 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
              {selectorIsFallback ? "Default Preset" : "Domain Preset"}
            </span>
            <select
              value={activePresetId}
              onChange={(e) => {
                const nextPreset = e.target.value;
                setActivePresetId(nextPreset);
                localStorage.setItem("boomscroll_active_preset", nextPreset);
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:outline-none"
            >
              {Object.values(DIFFICULTY_PRESETS).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.shortName}
                </option>
              ))}
            </select>
          </div>

          {!selectorIsFallback && (
            <p className="text-[11px] leading-snug text-zinc-500">
              This deck sets its own level names per workspace, so they're used
              instead of this.
            </p>
          )}
          {selectorIsFallback && presetsDiverge && (
            <p className="text-[11px] leading-snug text-zinc-500">
              Workspaces use different level names — the buttons below show this
              default.
            </p>
          )}

          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Difficulty Range
              </span>
              {availableLevels.length > 1 && (
                <button
                  onClick={() =>
                    setEnabledDifficulties(
                      allDiffsSelected
                        ? new Set<DifficultyScore>(availableLevels.slice(0, 1))
                        : new Set<DifficultyScore>(availableLevels),
                    )
                  }
                  className="text-[11px] text-purple-400 hover:text-purple-300"
                >
                  {allDiffsSelected
                    ? `Solo Level ${availableLevels[0]}`
                    : "All Levels"}
                </button>
              )}
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
                      className={`flex flex-col items-center justify-center rounded-xl border p-1.5 transition-all ${
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
            className="rounded-full border border-zinc-800 px-3 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-900/50 hover:text-zinc-100 active:opacity-80 transition-colors"
          >
            {allSelected ? "Unselect all" : "Select all"}
          </button>
        </div>

        <ul className="w-full max-w-sm min-h-0 flex-1 space-y-2 overflow-y-auto touch-pan-y pr-1">
          {deck.workspaces.map((ws) => (
            <li key={ws.id}>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 cursor-pointer hover:border-zinc-700 transition-colors">
                <span className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
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
            className="w-full rounded-full bg-zinc-50 px-6 py-3 text-sm font-semibold text-zinc-900 active:opacity-80 disabled:opacity-40"
          >
            Scroll {enabledCards} cards
          </button>
          <div className="flex gap-4">
            <button onClick={() => void openDeck()} className="text-xs text-zinc-400 hover:text-zinc-200">
              + Add deck
            </button>
            {banishedCount > 0 && (
              <button
                onClick={() => setShowBanished(true)}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                Banished ({banishedCount})
              </button>
            )}
            <button onClick={closeDeck} className="text-xs text-zinc-500 hover:text-zinc-300">
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
      <div className="pointer-events-none absolute left-0 right-0 top-[calc(var(--safe-top)+0.5rem)] z-10 flex items-center justify-between px-4">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2">
          <div className="flex shrink-0 overflow-hidden rounded-full border border-zinc-800 text-xs bg-zinc-950/80 backdrop-blur-md">
            <button
              onClick={() => switchFeedMode("study")}
              className={`whitespace-nowrap px-3 py-1.5 font-medium transition-colors ${mode === "study" ? "bg-purple-900/60 text-purple-200 font-semibold" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              Study
            </button>
            <button
              onClick={() => switchFeedMode("test")}
              className={`whitespace-nowrap px-3 py-1.5 font-medium transition-colors ${mode === "test" ? "bg-zinc-800 text-zinc-100 font-semibold" : "text-zinc-400 hover:text-zinc-200"}`}
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
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-800 bg-zinc-950/80 px-2.5 py-1.5 text-xs text-zinc-400 backdrop-blur-md transition-colors active:text-zinc-200"
            >
              <span
                aria-hidden="true"
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border text-[9px] font-bold leading-none transition-colors ${
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
            className="whitespace-nowrap rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-400 active:text-zinc-200"
            title="Import another deck"
          >
            + Add
          </button>
          {deck.workspaces.length > 1 && (
            <button
              onClick={() => setShowFilter(true)}
              className="whitespace-nowrap rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-500 active:text-zinc-300"
              title="Choose workspaces"
            >
              Decks
            </button>
          )}
          <button
            onClick={closeDeck}
            className="shrink-0 rounded-full px-2 py-1 text-xs text-zinc-600 active:text-zinc-300"
            aria-label="Close deck"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Background card (next in feed) */}
      {next && (
        <div className="absolute inset-0 z-0">
          <FeedCard card={next} mode={mode} revealed={false} activePresetId={activePresetId} />
        </div>
      )}

      {/* Active card (top of stack) */}
      <div
        key={current.id}
        style={{
          transform: `translate3d(0, ${drag}px, 0)`,
          transition,
        }}
        onTransitionEnd={() => {
          if (committing) {advance();}
        }}
        className="absolute inset-0 z-0 select-none touch-none"
      >
        <FeedCard
          card={current}
          mode={mode}
          revealed={revealed}
          activePresetId={activePresetId}
          onBanish={banishCurrent}
        />
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

            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={handleConfirmMerge}
                className="w-full rounded-full bg-zinc-50 py-3 text-xs font-semibold text-zinc-900 active:opacity-80 transition-opacity"
              >
                Merge Decks
              </button>
              <button
                onClick={handleConfirmReplace}
                className="w-full rounded-full border border-zinc-800 bg-zinc-900 py-3 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 active:opacity-80 transition-colors"
              >
                Replace Active Deck
              </button>
              <button
                onClick={() => setPendingDeck(null)}
                className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
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
