/**
 * FeedPane — the Boom Scroll study feed, brought into the desktop app.
 *
 * The mobile companion reads an exported deck file and keeps its state in
 * localStorage. This pane reads the same cards straight from SQLite and writes
 * levelling and banishing back through IPC, so what you do here is durable and
 * carries into the next export rather than living in browser storage.
 *
 * Desktop input replaces the phone's swipe: the wheel, the arrow keys and a
 * vertical drag all advance; click or Space reveals a Test answer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { FeedCard, FeedWorkspace } from "../lib/api";
import FeedCardView from "../components/feed/FeedCardView";
import {
  DEFAULT_PRESET_ID,
  DIFFICULTY_PRESETS,
  getDifficultyColor,
  resolvePresetId,
} from "../lib/feed/difficulty";
import type { DifficultyScore } from "../lib/feed/difficulty";
import {
  buildQueue,
  countsByLevel,
  isCardEligible,
  reshuffleAvoidingRepeat,
  shuffle,
} from "../lib/feed/queue";
import type { FeedMode } from "../lib/feed/queue";

const COMMIT_THRESHOLD_PX = 80;
const RUBBER_BAND_MAX_PX = 30;
const TAP_SLOP_PX = 10;
/** Ignore the tail of a trackpad's momentum so one flick advances one card. */
const WHEEL_COOLDOWN_MS = 400;

const ALL_LEVELS: DifficultyScore[] = [1, 2, 3, 4, 5];
const PRESET_STORAGE_KEY = "feed_active_preset";
const SHOW_ANSWER_STORAGE_KEY = "feed_show_answer_immediately";

/** localStorage is a per-viewer convenience here; never let it break the feed. */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Quota or a privacy mode — the in-memory state still holds this session.
  }
}

interface FeedPaneProps {
  /** Workspaces the feed may draw from. */
  workspaceIds: string[];
  includeDescendants?: boolean;
}

export default function FeedPane({ workspaceIds, includeDescendants }: FeedPaneProps) {
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [workspaces, setWorkspaces] = useState<FeedWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [enabledDifficulties, setEnabledDifficulties] = useState<Set<DifficultyScore>>(
    new Set(ALL_LEVELS),
  );
  const [activePresetId, setActivePresetId] = useState<string>(
    () => readStored(PRESET_STORAGE_KEY) ?? DEFAULT_PRESET_ID,
  );
  const [mode, setMode] = useState<FeedMode>("test");
  const [showAnswerImmediately, setShowAnswerImmediately] = useState(
    () => readStored(SHOW_ANSWER_STORAGE_KEY) === "1",
  );

  const [showFilter, setShowFilter] = useState(false);
  const [showBanished, setShowBanished] = useState(false);
  const [order, setOrder] = useState<FeedCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [useTransition, setUseTransition] = useState(false);

  const nextOrderRef = useRef<FeedCard[] | null>(null);
  const startYRef = useRef(0);
  const movedRef = useRef(false);
  const wheelLockRef = useRef(0);

  const current = order[index] ?? null;
  const isLastCard = order.length > 0 && index === order.length - 1;

  const workspaceKey = useMemo(() => [...workspaceIds].sort().join("|"), [workspaceIds]);

  // Load the deck. Keyed on the joined id list rather than the array itself so
  // a re-render with an equal-but-new array doesn't refetch.
  useEffect(() => {
    let cancelled = false;
    if (workspaceIds.length === 0) {
      setCards([]);
      setWorkspaces([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api.feed
      .load(workspaceIds, includeDescendants)
      .then((deck) => {
        if (cancelled) { return; }
        setCards(deck.cards);
        setWorkspaces(deck.workspaces);
        setEnabledIds(new Set(deck.workspaces.map((ws) => ws.id)));
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) { return; }
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceKey, includeDescendants]);

  const startFeed = useCallback(
    (
      sourceCards: FeedCard[],
      ids: Set<string>,
      diffs: Set<DifficultyScore>,
      activeMode: FeedMode,
    ) => {
      setOrder(
        buildQueue(
          sourceCards,
          { enabledWorkspaceIds: ids, enabledDifficulties: diffs },
          activeMode,
        ),
      );
      setIndex(0);
      setRevealed(showAnswerImmediately);
      setShowFilter(false);
      setShowBanished(false);
      nextOrderRef.current = null;
    },
    [showAnswerImmediately],
  );

  // Start (or restart) the running order once cards are in hand.
  useEffect(() => {
    if (loading || cards.length === 0) { return; }
    setOrder((prev) => (prev.length > 0 ? prev : buildQueue(
      cards,
      { enabledWorkspaceIds: enabledIds, enabledDifficulties: enabledDifficulties },
      mode,
    )));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, cards, enabledIds]);

  // Pre-shuffle the next round while the user is on the last card, so the
  // "next" preview during the drag is already the reshuffled first card.
  useEffect(() => {
    if (isLastCard && current && !nextOrderRef.current) {
      nextOrderRef.current = reshuffleAvoidingRepeat(order, current.id);
    }
  }, [isLastCard, current, order]);

  const next: FeedCard | null = isLastCard
    ? (nextOrderRef.current?.[0] ?? null)
    : (order[index + 1] ?? null);

  const advance = useCallback(() => {
    // Deliberately not nesting one state updater inside another: React may run
    // an updater twice (StrictMode), which would advance the index by two.
    if (order.length === 0) { return; }
    if (index >= order.length - 1) {
      // End of the round — swap in the pre-shuffled next one and start over.
      const nextOrder = nextOrderRef.current ?? shuffle(order);
      nextOrderRef.current = null;
      setOrder(nextOrder);
      setIndex(0);
    } else {
      setIndex(index + 1);
    }
    setRevealed(showAnswerImmediately);
    setCommitting(false);
    setUseTransition(false);
    setDrag(0);
  }, [order, index, showAnswerImmediately]);

  const toggleReveal = useCallback(() => {
    // Study cards always show their explanation; only Test cards toggle.
    if (mode === "test") { setRevealed((r) => !r); }
  }, [mode]);

  /**
   * Banish the current card: held out of the feed, never deleted. Written
   * through immediately so it survives a restart, with the local state updated
   * first so the feed doesn't stall on the round trip.
   */
  const banishCurrent = useCallback(() => {
    if (!current) { return; }
    const banishedId = current.id;
    const at = new Date().toISOString();
    setCards((prev) =>
      prev.map((c) => (c.id === banishedId ? { ...c, suspended_at: at } : c)),
    );

    // Drop it from the running order and leave `index` where it is, so the
    // following card slides into this slot. Advancing here would skip a card.
    const nextOrder = order.filter((c) => c.id !== banishedId);
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

    api.feed.setSuspended(banishedId, true).catch((e: unknown) => {
      // Put it back rather than leaving the UI claiming a banish that the
      // database never recorded.
      setCards((prev) =>
        prev.map((c) => (c.id === banishedId ? { ...c, suspended_at: null } : c)),
      );
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [current, order, index, showAnswerImmediately]);

  const restoreCards = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) { return; }
      try {
        if (ids.length === 1) {
          await api.feed.setSuspended(ids[0], false);
        } else {
          await api.feed.restoreAll([...enabledIds]);
        }
        const restored = new Set(ids);
        const nextCards = cards.map((c) =>
          restored.has(c.id) ? { ...c, suspended_at: null } : c,
        );
        setCards(nextCards);
        startFeed(nextCards, enabledIds, enabledDifficulties, mode);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [cards, enabledIds, enabledDifficulties, mode, startFeed],
  );

  function switchFeedMode(newMode: FeedMode) {
    setMode(newMode);
    startFeed(cards, enabledIds, enabledDifficulties, newMode);
  }

  function toggleShowAnswerImmediately() {
    const nextValue = !showAnswerImmediately;
    setShowAnswerImmediately(nextValue);
    writeStored(SHOW_ANSWER_STORAGE_KEY, nextValue ? "1" : "0");
    // Apply to the card already on screen so the change is visible at once.
    setRevealed(nextValue);
  }

  // Keyboard: arrows/space drive the feed without touching the mouse.
  useEffect(() => {
    if (showFilter || showBanished || !current) { return; }
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) { return; }
      if (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        advance();
      } else if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        toggleReveal();
      } else if (event.key === "x" || event.key === "Backspace") {
        event.preventDefault();
        banishCurrent();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showFilter, showBanished, current, advance, toggleReveal, banishCurrent]);

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    // Let a scrollable answer box consume its own wheel events first.
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-feed-scrollable]")) { return; }
    if (Math.abs(event.deltaY) < 8) { return; }
    const now = Date.now();
    if (now < wheelLockRef.current) { return; }
    wheelLockRef.current = now + WHEEL_COOLDOWN_MS;
    if (event.deltaY > 0) { advance(); }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (committing || !current) { return; }
    setUseTransition(false);
    startYRef.current = event.clientY;
    movedRef.current = false;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || committing) { return; }
    const dy = event.clientY - startYRef.current;
    if (Math.abs(dy) > TAP_SLOP_PX) { movedRef.current = true; }
    if (dy > 0) {
      // Rubber-band downward: there is nothing above the first card.
      setDrag((dy * RUBBER_BAND_MAX_PX) / (dy + RUBBER_BAND_MAX_PX));
    } else {
      setDrag(dy);
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) { return; }
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The element may have unmounted mid-commit.
    }
    setUseTransition(true);
    if (!movedRef.current) {
      toggleReveal();
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

  const banishedCards = useMemo(
    () =>
      cards
        .filter((c) => c.suspended_at)
        .sort((a, b) => (b.suspended_at ?? "").localeCompare(a.suspended_at ?? "")),
    [cards],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
        Loading feed…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-red-500">{error}</p>
        <button
          onClick={() => setError(null)}
          className="rounded-full border border-[var(--border-color)] px-4 py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--accent-color)]"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-[var(--text-primary)]">No cards yet</p>
        <p className="max-w-sm text-xs text-[var(--text-muted)]">
          The feed draws on your flashcards. Generate or add some in this
          workspace and they&apos;ll show up here.
        </p>
      </div>
    );
  }

  // Banished review screen
  if (showBanished) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center gap-4 px-6 py-4">
        <div className="flex w-full max-w-lg shrink-0 items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Banished</h2>
          <button
            onClick={() => setShowBanished(false)}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Done
          </button>
        </div>
        <p className="w-full max-w-lg shrink-0 text-xs text-[var(--text-muted)]">
          These cards are held out of the feed. Restoring one puts it back in
          rotation — nothing here has been deleted.
        </p>

        {banishedCards.length === 0 ? (
          <p className="my-auto text-sm text-[var(--text-muted)]">Nothing banished.</p>
        ) : (
          <ul className="w-full max-w-lg min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {banishedCards.map((card) => (
              <li
                key={card.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 py-3"
              >
                <span className="min-w-0 flex-1 text-left">
                  <span className="block line-clamp-2 text-sm text-[var(--text-primary)]">
                    {card.front}
                  </span>
                  <span className="mt-1 block text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                    {card.workspace_name}
                  </span>
                </span>
                <button
                  onClick={() => void restoreCards([card.id])}
                  className="shrink-0 rounded-full border border-[var(--border-color)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}

        {banishedCards.length > 0 && (
          <div className="flex w-full max-w-lg shrink-0 pt-2">
            <button
              onClick={() => void restoreCards(banishedCards.map((c) => c.id))}
              className="w-full rounded-full border border-[var(--border-color)] px-6 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
            >
              Restore all
            </button>
          </div>
        )}
      </div>
    );
  }

  // Filter screen
  if (showFilter || !current) {
    const eligibleCount = cards.filter((c) =>
      isCardEligible(c, {
        enabledWorkspaceIds: enabledIds,
        enabledDifficulties,
      }),
    ).length;
    const allSelected =
      workspaces.length > 0 && workspaces.every((ws) => enabledIds.has(ws.id));

    const counts = countsByLevel(cards, enabledIds);
    const availableLevels = ALL_LEVELS.filter((level) => (counts.get(level) ?? 0) > 0);
    const allDiffsSelected =
      availableLevels.length > 0 && availableLevels.every((l) => enabledDifficulties.has(l));

    // A workspace that states its own preset describes its material's domain,
    // so it wins; the picker is a fallback for workspaces that declare none.
    const enabledPresets = new Set(
      workspaces
        .filter((ws) => enabledIds.has(ws.id))
        .map((ws) =>
          resolvePresetId({ difficultyPreset: ws.difficulty_preset ?? undefined }, activePresetId),
        ),
    );
    const buttonPresetId = enabledPresets.size === 1 ? [...enabledPresets][0] : activePresetId;
    const preset = DIFFICULTY_PRESETS[buttonPresetId] ?? DIFFICULTY_PRESETS[DEFAULT_PRESET_ID];
    const presetsDiverge = enabledPresets.size > 1;
    const selectorIsFallback = !workspaces
      .filter((ws) => enabledIds.has(ws.id))
      .every((ws) => ws.difficulty_preset && DIFFICULTY_PRESETS[ws.difficulty_preset]);

    return (
      <div className="flex h-full min-h-0 flex-col items-center gap-3 px-6 py-4">
        <div className="flex w-full max-w-lg shrink-0 items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Filter feed</h2>
          {current && (
            <button
              onClick={() => setShowFilter(false)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Done
            </button>
          )}
        </div>

        <div className="w-full max-w-lg shrink-0 space-y-2 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              {selectorIsFallback ? "Default preset" : "Domain preset"}
            </span>
            <select
              value={activePresetId}
              onChange={(e) => {
                setActivePresetId(e.target.value);
                writeStored(PRESET_STORAGE_KEY, e.target.value);
              }}
              className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none"
            >
              {Object.values(DIFFICULTY_PRESETS).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.shortName}
                </option>
              ))}
            </select>
          </div>

          {!selectorIsFallback && (
            <p className="text-[11px] leading-snug text-[var(--text-muted)]">
              These workspaces set their own level names, so those are used
              instead of this.
            </p>
          )}
          {selectorIsFallback && presetsDiverge && (
            <p className="text-[11px] leading-snug text-[var(--text-muted)]">
              Workspaces use different level names — the buttons below show this
              default.
            </p>
          )}

          <div className="pt-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Difficulty range
              </span>
              {availableLevels.length > 1 && (
                <button
                  onClick={() =>
                    setEnabledDifficulties(
                      allDiffsSelected
                        ? new Set([availableLevels[0]])
                        : new Set(availableLevels),
                    )
                  }
                  className="text-[11px] text-[var(--accent-color)] hover:underline"
                >
                  {allDiffsSelected ? `Solo level ${availableLevels[0]}` : "All levels"}
                </button>
              )}
            </div>

            {availableLevels.length === 0 ? (
              <p className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                These cards aren&apos;t levelled yet, so every card is shown.
              </p>
            ) : (
              // Only levels that actually have content. A fixed 1-5 grid let
              // the user pick levels that silently yielded an empty feed.
              <div
                className="grid gap-1.5"
                style={{
                  gridTemplateColumns: `repeat(${availableLevels.length}, minmax(0, 1fr))`,
                }}
              >
                {availableLevels.map((level) => {
                  const count = counts.get(level) ?? 0;
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
                            // Never let the last level be deselected — that
                            // would leave the feed empty with no way back.
                            if (nextSet.size > 1) { nextSet.delete(level); }
                          } else {
                            nextSet.add(level);
                          }
                          return nextSet;
                        })
                      }
                      style={isSelected ? color.style : undefined}
                      className={`flex flex-col items-center justify-center rounded-xl border p-1.5 transition-all ${
                        isSelected
                          ? "font-semibold"
                          : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-muted)] opacity-60"
                      }`}
                      title={`${label} — ${count} cards`}
                    >
                      <span className="text-xs font-bold">L{level}</span>
                      <span className="mt-0.5 max-w-full truncate text-[9px] leading-tight">
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

        {workspaces.length > 1 && (
          <>
            <div className="flex w-full max-w-lg shrink-0 items-center justify-between pt-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Workspaces ({enabledIds.size}/{workspaces.length})
              </span>
              <button
                onClick={() =>
                  setEnabledIds(
                    allSelected ? new Set() : new Set(workspaces.map((ws) => ws.id)),
                  )
                }
                className="rounded-full border border-[var(--border-color)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
              >
                {allSelected ? "Unselect all" : "Select all"}
              </button>
            </div>

            <ul className="w-full max-w-lg min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {workspaces.map((ws) => (
                <li key={ws.id}>
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 py-3 transition-colors hover:border-[var(--accent-color)]">
                    <span className="flex items-center gap-3 text-sm text-[var(--text-primary)]">
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
                    <span className="text-xs text-[var(--text-muted)]">
                      {ws.card_count} cards
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="flex w-full max-w-lg shrink-0 flex-col items-center gap-2.5 pt-2">
          <button
            onClick={() => startFeed(cards, enabledIds, enabledDifficulties, mode)}
            disabled={eligibleCount === 0}
            className="w-full rounded-full bg-[var(--accent-color)] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Scroll {eligibleCount} cards
          </button>
          {banishedCards.length > 0 && (
            <button
              onClick={() => setShowBanished(true)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Banished ({banishedCards.length})
            </button>
          )}
        </div>
      </div>
    );
  }

  const transition = useTransition && !dragging ? "transform 250ms ease-out" : "none";

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="pointer-events-none absolute left-0 right-0 top-2 z-10 flex items-center justify-between px-4">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2">
          <div className="flex shrink-0 overflow-hidden rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] text-xs">
            <button
              onClick={() => switchFeedMode("study")}
              className={`whitespace-nowrap px-3 py-1.5 font-medium transition-colors ${
                mode === "study"
                  ? "bg-[rgba(var(--accent-color-rgb),0.15)] font-semibold text-[var(--accent-color)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              Study
            </button>
            <button
              onClick={() => switchFeedMode("test")}
              className={`whitespace-nowrap px-3 py-1.5 font-medium transition-colors ${
                mode === "test"
                  ? "bg-[rgba(var(--accent-color-rgb),0.15)] font-semibold text-[var(--accent-color)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
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
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            >
              <span
                aria-hidden="true"
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border text-[9px] font-bold leading-none transition-colors ${
                  showAnswerImmediately
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-[var(--border-color)] text-transparent"
                }`}
              >
                ✓
              </span>
              Show
            </button>
          )}
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
          <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
            {index + 1} / {order.length}
          </span>
          <button
            onClick={() => setShowFilter(true)}
            className="whitespace-nowrap rounded-full border border-[var(--border-color)] px-3 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="Filter the feed"
          >
            Filter
          </button>
        </div>
      </div>

      {/* Background card (next in feed) */}
      {next && (
        <div className="absolute inset-0 z-0">
          <FeedCardView
            card={next}
            mode={mode}
            revealed={false}
            activePresetId={activePresetId}
          />
        </div>
      )}

      {/* Active card */}
      <div
        key={current.id}
        style={{ transform: `translate3d(0, ${drag}px, 0)`, transition }}
        onTransitionEnd={() => {
          if (committing) { advance(); }
        }}
        className="absolute inset-0 z-0 select-none"
      >
        <FeedCardView
          card={current}
          mode={mode}
          revealed={revealed}
          activePresetId={activePresetId}
          onBanish={banishCurrent}
        />
      </div>
    </div>
  );
}
