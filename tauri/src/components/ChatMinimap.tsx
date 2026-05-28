import React, { useCallback, useRef, useState, useEffect, useMemo } from "react";
import type { Message } from "../stores/chatStore";
import type { VirtuosoHandle } from "react-virtuoso";

interface ChatMinimapProps {
  messages: Message[];
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  scrollContainer: HTMLDivElement | null;
  // Retained for prop-contract compatibility with ChatView; intentionally
  // unused — the minimap renders one pill per user prompt only.
  streamingContent?: string;
  isStreaming?: boolean;
}

const FALLBACK_RIGHT_OFFSET = 8;
const MIN_SCROLLBAR_RIGHT_OFFSET = 2;
const BAR_HEIGHT_PX = 4;
/** Vertical distance (px above OR below the pill centre) within which a hover
 *  shows the preview tooltip. Outside this band the tooltip is hidden so the
 *  preview can only be attributed to one specific pill. */
const PREVIEW_HOVER_RADIUS_PX = 30;

interface MinimapBlock {
  msgIdx: number;
  preview: string;
  id: string;
}

interface PositionedBlock extends MinimapBlock {
  topFrac: number;
}

function getMinimapRightOffset(scrollContainer: HTMLDivElement | null): number {
  if (!scrollContainer) { return FALLBACK_RIGHT_OFFSET; }
  const scrollbarGutter = Math.max(0, scrollContainer.offsetWidth - scrollContainer.clientWidth);
  if (scrollbarGutter <= 0) { return FALLBACK_RIGHT_OFFSET; }
  return Math.max(MIN_SCROLLBAR_RIGHT_OFFSET, Math.round(scrollbarGutter / 3));
}

const ChatMinimap: React.FC<ChatMinimapProps> = ({
  messages,
  virtuosoRef,
  scrollContainer,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipY, setTooltipY] = useState(0);
  const [trackClientH, setTrackClientH] = useState(0);
  // Persistent per-message offset cache, keyed by message id. Populated lazily
  // as items scroll into view; entries are not invalidated on subsequent
  // scrolls so the pill layout stays static once an item has been seen.
  const offsetCacheRef = useRef<Map<string, { top: number }>>(new Map());
  const layoutHeightRef = useRef<number>(0);
  const schedulerRef = useRef<(() => void) | null>(null);
  // Bumped only when bar layout should change (new prompts, scroller resize,
  // fresh DOM measurements). NOT bumped on plain scroll.
  const [layoutTick, setLayoutTick] = useState(0);
  const dragging = useRef(false);

  // One block per user prompt. Assistant, system, and streaming entries are
  // intentionally skipped — the assistant reply for each turn is always
  // immediately below its prompt in the scroller.
  const blocks = useMemo<MinimapBlock[]>(() => {
    const result: MinimapBlock[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== "user") { continue; }
      const firstLine = m.content.split("\n").find((l) => l.trim().length > 0) ?? "";
      result.push({
        msgIdx: i,
        preview: firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine,
        id: m.id,
      });
    }
    return result;
  }, [messages]);

  const rightOffset = useMemo(() => getMinimapRightOffset(scrollContainer), [scrollContainer]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) { return; }
    const ro = new ResizeObserver(() => setTrackClientH(el.clientHeight));
    ro.observe(el);
    setTrackClientH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Refs hold the latest values so the scroll-independent observer effect
  // doesn't need to tear down on every messages change.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const userMsgIdsRef = useRef<Set<string>>(new Set());
  userMsgIdsRef.current = useMemo(() => {
    const s = new Set<string>();
    for (const m of messages) { if (m.role === "user") { s.add(m.id); } }
    return s;
  }, [messages]);

  // ResizeObserver-only: fires when the scroller's content size actually
  // changes (new item mounts, image loads). Does no work during pure scroll —
  // Virtuoso's DOM recycling does not change content size.
  useEffect(() => {
    if (!scrollContainer) { return; }
    let rafId = 0;
    let disposed = false;

    const harvest = () => {
      rafId = 0;
      if (disposed) { return; }
      const cache = offsetCacheRef.current;
      const wantedIds = userMsgIdsRef.current;
      const msgs = messagesRef.current;
      const sh = scrollContainer.scrollHeight;
      const heightDelta = Math.abs(sh - layoutHeightRef.current);

      let missing = 0;
      wantedIds.forEach((id) => { if (!cache.has(id)) { missing++; } });

      if (missing === 0 && heightDelta <= 8) { return; }

      let added = 0;
      if (missing > 0) {
        const nodes = scrollContainer.querySelectorAll<HTMLElement>("[data-item-index]");
        nodes.forEach((n) => {
          const idxAttr = n.getAttribute("data-item-index");
          if (idxAttr == null) { return; }
          const idx = Number(idxAttr);
          if (!Number.isFinite(idx) || idx < 0 || idx >= msgs.length) { return; }
          const m = msgs[idx];
          if (!m || m.role !== "user") { return; }
          if (!cache.has(m.id)) {
            cache.set(m.id, { top: n.offsetTop });
            added++;
          }
        });
      }

      if (added > 0 || heightDelta > 8) {
        layoutHeightRef.current = sh;
        setLayoutTick((t) => t + 1);
      }
    };

    const scheduleHarvest = () => {
      if (rafId !== 0) { return; }
      rafId = requestAnimationFrame(harvest);
    };

    const innerList =
      scrollContainer.querySelector<HTMLElement>('[data-test-id="virtuoso-item-list"]') ??
      (scrollContainer.firstElementChild as HTMLElement | null) ??
      scrollContainer;
    const ro = new ResizeObserver(scheduleHarvest);
    ro.observe(innerList);
    if (innerList !== scrollContainer) { ro.observe(scrollContainer); }

    scheduleHarvest();

    // Expose scheduler for the message-count effect below via a sibling ref.
    schedulerRef.current = scheduleHarvest;

    return () => {
      disposed = true;
      if (rafId !== 0) { window.cancelAnimationFrame(rafId); }
      ro.disconnect();
      schedulerRef.current = null;
    };
  }, [scrollContainer]);

  // When the number of user messages changes (new prompt sent / session loaded),
  // schedule a single harvest. Does not depend on `messages` identity, so
  // streaming token updates do not retrigger it.
  const userMsgCount = userMsgIdsRef.current.size;
  useEffect(() => {
    schedulerRef.current?.();
  }, [userMsgCount]);

  // Evict cache entries for messages that have been removed (e.g. session switch).
  useEffect(() => {
    const cache = offsetCacheRef.current;
    const liveIds = new Set(messages.map((m) => m.id));
    let removed = 0;
    cache.forEach((_, id) => {
      if (!liveIds.has(id)) {
        cache.delete(id);
        removed++;
      }
    });
    if (removed > 0) { setLayoutTick((t) => t + 1); }
  }, [messages]);

  const positioned = useMemo<PositionedBlock[]>(() => {
    if (blocks.length === 0) { return []; }
    const cache = offsetCacheRef.current;
    const scrollH = Math.max(layoutHeightRef.current, scrollContainer?.scrollHeight ?? 0);

    if (scrollH <= 0) {
      return blocks.map((b, i) => ({
        ...b,
        topFrac: blocks.length > 1 ? i / blocks.length : 0,
      }));
    }

    const tops = new Array<number>(blocks.length).fill(NaN);
    for (let i = 0; i < blocks.length; i++) {
      const entry = cache.get(blocks[i].id);
      if (entry) { tops[i] = entry.top; }
    }

    if (Number.isNaN(tops[0])) { tops[0] = 0; }
    const lastIdx = blocks.length - 1;
    if (Number.isNaN(tops[lastIdx])) {
      tops[lastIdx] = scrollH * (lastIdx / blocks.length);
    }

    for (let i = 1; i < blocks.length; i++) {
      if (Number.isNaN(tops[i])) {
        let nextKnown = -1;
        for (let j = i + 1; j < blocks.length; j++) {
          if (!Number.isNaN(tops[j])) { nextKnown = j; break; }
        }
        if (nextKnown === -1) {
          tops[i] = tops[i - 1];
        } else {
          const span = nextKnown - (i - 1);
          const inc = (tops[nextKnown] - tops[i - 1]) / span;
          tops[i] = tops[i - 1] + inc;
        }
      }
    }

    return blocks.map((b, i) => ({
      ...b,
      topFrac: Math.min(1, Math.max(0, tops[i] / scrollH)),
    }));
    // layoutTick is intentional: forces a re-read of offsetCacheRef (a ref,
    // invisible to the dep-array linter) whenever the harvest effect adds new
    // measurements or scrollHeight shifts materially.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, scrollContainer, layoutTick]);

  const jumpTo = useCallback(
    (idx: number) => {
      virtuosoRef.current?.scrollToIndex({ index: idx, behavior: "smooth", align: "start" });
    },
    [virtuosoRef],
  );

  const blockIdxAtY = useCallback(
    (relY: number): number => {
      if (positioned.length === 0 || trackClientH <= 0) { return 0; }
      const frac = Math.min(1, Math.max(0, relY / trackClientH));
      let lo = 0;
      let hi = positioned.length - 1;
      let result = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (positioned[mid].topFrac <= frac) {
          result = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return result;
    },
    [positioned, trackClientH],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) { return; }
      const idx = blockIdxAtY(e.clientY - rect.top);
      jumpTo(positioned[idx]?.msgIdx ?? 0);
    },
    [blockIdxAtY, jumpTo, positioned],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) { return; }
      const relY = e.clientY - rect.top;
      const idx = blockIdxAtY(relY);
      // Only show the tooltip when the cursor is within ±PREVIEW_HOVER_RADIUS_PX
      // of the nearest pill's centre — keeps the preview unambiguously tied to
      // a single pill instead of always tracking the cursor.
      const pillCentre = (positioned[idx]?.topFrac ?? 0) * trackClientH;
      const withinBand = Math.abs(relY - pillCentre) <= PREVIEW_HOVER_RADIUS_PX;
      setHoveredIdx((prev) => {
        const next = withinBand ? idx : null;
        return prev === next ? prev : next;
      });
      setTooltipY(relY);
      if (dragging.current) { jumpTo(positioned[idx]?.msgIdx ?? 0); }
    },
    [blockIdxAtY, jumpTo, positioned, trackClientH],
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  if (positioned.length < 2) { return null; }

  return (
    <div
      data-testid="chat-minimap"
      className="absolute right-2 top-2 bottom-2 z-10 flex flex-col items-end pointer-events-none"
      style={{ width: "40px", right: `${rightOffset}px` }}
    >
      <div
        ref={trackRef}
        className="relative w-7 overflow-hidden rounded pointer-events-auto cursor-pointer select-none"
        style={{
          height: "100%",
          backgroundColor: "color-mix(in srgb, var(--bg-primary, #1e1e2e) 80%, transparent)",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          setHoveredIdx(null);
          dragging.current = false;
        }}
      >
        {positioned.map((b, i) => {
          const topPx = b.topFrac * trackClientH - BAR_HEIGHT_PX / 2;
          return (
            <div
              key={b.id}
              className={`absolute left-1/2 -translate-x-1/2 transition-opacity duration-75 ${hoveredIdx === i ? "opacity-100" : "opacity-70"}`}
              style={{
                width: "60%",
                top: topPx,
                height: BAR_HEIGHT_PX,
                borderRadius: 1,
                backgroundColor: "var(--accent-color, #6366f1)",
              }}
            />
          );
        })}
      </div>

      {hoveredIdx !== null && positioned[hoveredIdx] && (
        <div
          className="absolute right-full mr-2 rounded-lg px-3 py-1.5 text-xs leading-tight max-w-[240px] truncate shadow-lg border border-white/10 bg-[var(--bg-elevated)] text-[var(--text-primary)] pointer-events-none whitespace-nowrap"
          style={{ top: Math.max(8, tooltipY) }}
        >
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              marginRight: 6,
              backgroundColor: "var(--accent-color, #6366f1)",
            }}
          />
          {positioned[hoveredIdx].preview || "User prompt"}
        </div>
      )}
    </div>
  );
};

export default ChatMinimap;
