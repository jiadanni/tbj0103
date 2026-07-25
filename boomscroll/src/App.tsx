import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import FeedCard from "./components/FeedCard";
import type { FeedMode } from "./components/FeedCard";
import {
  exportDeckToRaw,
  mergeDecks,
  parseDeck,
  reshuffleAvoidingRepeat,
  shuffle,
} from "./lib/deck";
import type { Deck, DeckCard } from "./lib/deck";

const COMMIT_THRESHOLD_PX = 80;
const RUBBER_BAND_MAX_PX = 30;
const TAP_SLOP_PX = 10;

export default function App() {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
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

  function startFeed(sourceDeck: Deck, ids: Set<string>, activeMode: FeedMode = mode) {
    const wsCards = sourceDeck.cards.filter((card) => ids.has(card.workspaceId));
    const modeCards = filterCardsForMode(wsCards, activeMode);
    setOrder(shuffle(modeCards));
    setIndex(0);
    setRevealed(showAnswerImmediately);
    setShowFilter(false);
    nextOrderRef.current = null;
    localStorage.setItem("boomscroll_enabled_ids", JSON.stringify(Array.from(ids)));
  }

  function switchFeedMode(newMode: FeedMode) {
    setMode(newMode);
    if (deck) {
      startFeed(deck, enabledIds, newMode);
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
      setDeck(parsed);
      setEnabledIds(allIds);
      setError(null);
      localStorage.setItem("boomscroll_active_deck", raw);
      localStorage.setItem("boomscroll_enabled_ids", JSON.stringify(Array.from(allIds)));
      if (parsed.workspaces.length > 1 && !initialEnabledIds) {
        setShowFilter(true);
        setOrder([]);
      } else {
        startFeed(parsed, allIds);
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

    setDeck(merged);
    setEnabledIds(newEnabledIds);
    localStorage.setItem("boomscroll_active_deck", rawExport);
    localStorage.setItem("boomscroll_enabled_ids", JSON.stringify(Array.from(newEnabledIds)));
    setPendingDeck(null);
    startFeed(merged, newEnabledIds);
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
    setShowFilter(false);
    nextOrderRef.current = null;
    localStorage.removeItem("boomscroll_active_deck");
    localStorage.removeItem("boomscroll_enabled_ids");
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

  // Workspace filter screen
  if (showFilter || !current) {
    const enabledCards = deck.cards.filter((card) => enabledIds.has(card.workspaceId)).length;
    const allSelected = deck.workspaces.length > 0 && deck.workspaces.every((ws) => enabledIds.has(ws.id));

    return (
      <main className="safe-screen flex h-full flex-col items-center justify-center gap-4 px-8">
        <h1 className="shrink-0 text-xl font-bold tracking-tight">Choose workspaces</h1>
        <div className="flex w-full max-w-sm shrink-0 items-center justify-between">
          <span className="text-xs text-zinc-500">
            {enabledIds.size} of {deck.workspaces.length} selected
          </span>
          <button
            onClick={() =>
              setEnabledIds(allSelected ? new Set() : new Set(deck.workspaces.map((ws) => ws.id)))
            }
            className="rounded-full border border-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-900/50 hover:text-zinc-100 active:opacity-80 transition-colors"
          >
            {allSelected ? "Unselect all" : "Select all"}
          </button>
        </div>
        <ul className="w-full max-w-sm min-h-0 flex-1 space-y-2 overflow-y-auto touch-pan-y">
          {deck.workspaces.map((ws) => (
            <li key={ws.id}>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 px-4 py-3">
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
        <div className="flex shrink-0 flex-col items-center gap-3 w-full max-w-sm">
          <button
            onClick={() => startFeed(deck, enabledIds)}
            disabled={enabledCards === 0}
            className="w-full rounded-full bg-zinc-50 px-6 py-3 text-sm font-semibold text-zinc-900 active:opacity-80 disabled:opacity-40"
          >
            Scroll {enabledCards} cards
          </button>
          <div className="flex gap-4">
            <button onClick={() => void openDeck()} className="text-xs text-zinc-400 hover:text-zinc-200">
              + Add deck
            </button>
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
          <FeedCard card={next} mode={mode} revealed={false} />
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
        <FeedCard card={current} mode={mode} revealed={revealed} />
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
