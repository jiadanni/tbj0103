import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import FeedCard from "./components/FeedCard";
import type { FeedMode } from "./components/FeedCard";
import { parseDeck, reshuffleAvoidingRepeat, shuffle } from "./lib/deck";
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
  const [mode, setMode] = useState<FeedMode>("info");
  const [error, setError] = useState<string | null>(null);

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
      loadDeckFromText(savedDeck, savedIds);
    } catch {
      localStorage.removeItem("boomscroll_active_deck");
      localStorage.removeItem("boomscroll_enabled_ids");
    }
  }, []);

  const next: DeckCard | null = isLastCard
    ? (nextOrderRef.current?.[0] ?? null)
    : (order[index + 1] ?? null);

  function startFeed(sourceDeck: Deck, ids: Set<string>) {
    const cards = sourceDeck.cards.filter((card) => ids.has(card.workspaceId));
    setOrder(shuffle(cards));
    setIndex(0);
    setRevealed(false);
    setShowFilter(false);
    nextOrderRef.current = null;
    localStorage.setItem("boomscroll_enabled_ids", JSON.stringify(Array.from(ids)));
  }

  function loadDeckFromText(raw: string, initialEnabledIds?: Set<string>) {
    try {
      const parsed = parseDeck(raw);
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
    setRevealed(false);
    setCommitting(false);
    setDrag(0);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (committing || !current) {return;}
    startYRef.current = event.clientY;
    movedRef.current = false;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || committing) {return;}
    const dy = event.clientY - startYRef.current;
    if (Math.abs(dy) > TAP_SLOP_PX) {movedRef.current = true;}
    // Upward drags follow the finger; downward drags rubber-band. There is
    // deliberately no way to reach the previous card.
    setDrag(dy < 0 ? dy : Math.min(dy * 0.3, RUBBER_BAND_MAX_PX));
  }

  function onPointerUp() {
    if (!dragging || committing) {return;}
    setDragging(false);
    if (!movedRef.current) {
      // Info mode always shows the answer, so a tap has nothing to reveal.
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
      <main className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
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
    return (
      <main className="flex h-full flex-col items-center justify-center gap-6 px-8">
        <h1 className="text-xl font-bold tracking-tight">Choose workspaces</h1>
        <ul className="w-full max-w-sm space-y-2 overflow-y-auto">
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
        <button
          onClick={() => startFeed(deck, enabledIds)}
          disabled={enabledCards === 0}
          className="rounded-full bg-zinc-50 px-6 py-3 text-sm font-semibold text-zinc-900 active:opacity-80 disabled:opacity-40"
        >
          Scroll {enabledCards} cards
        </button>
        <button onClick={closeDeck} className="text-xs text-zinc-500">
          Close deck
        </button>
      </main>
    );
  }

  const transition = dragging ? "none" : "transform 250ms ease-out";

  return (
    <main
      className="relative h-full w-full overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* top-12 keeps the controls clear of the Android status bar (the app draws edge-to-edge). */}
      <div className="pointer-events-none absolute left-0 right-0 top-12 z-10 flex items-center justify-between px-4">
        <div className="pointer-events-auto flex overflow-hidden rounded-full border border-zinc-800 text-xs">
          <button
            onClick={() => setMode("info")}
            className={`px-3 py-1 ${mode === "info" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500"}`}
          >
            Info
          </button>
          <button
            onClick={() => {
              setMode("test");
              setRevealed(false);
            }}
            className={`px-3 py-1 ${mode === "test" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500"}`}
          >
            Test
          </button>
        </div>
        <div className="pointer-events-auto flex items-center gap-1">
          {deck.workspaces.length > 1 && (
            <button
              onClick={() => setShowFilter(true)}
              className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-500 active:text-zinc-300"
            >
              Workspaces
            </button>
          )}
          <button
            onClick={closeDeck}
            className="rounded-full px-2 py-1 text-xs text-zinc-600 active:text-zinc-300"
            aria-label="Close deck"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Current card — keyed so advancing remounts it at rest, no snap-back animation. */}
      <div
        key={`${index}-${current.id}`}
        className="absolute inset-0"
        style={{ transform: `translateY(${drag}px)`, transition }}
        onTransitionEnd={() => {
          if (committing) {advance();}
        }}
      >
        <FeedCard card={current} mode={mode} revealed={revealed} />
      </div>

      {/* Next card, pre-positioned one screen below. */}
      {next && (
        <div
          key={`next-${index}-${next.id}`}
          className="absolute inset-0"
          style={{ transform: `translateY(calc(100% + ${drag}px))`, transition }}
        >
          <FeedCard card={next} mode={mode} revealed={false} />
        </div>
      )}
    </main>
  );
}
