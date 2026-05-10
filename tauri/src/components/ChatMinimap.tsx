import React, { useCallback, useRef, useState, useEffect, useMemo } from "react";
import type { Message } from "../stores/chatStore";
import type { VirtuosoHandle } from "react-virtuoso";

interface ChatMinimapProps {
  messages: Message[];
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  scrollContainer: HTMLDivElement | null;
  streamingContent: string;
  isStreaming: boolean;
}

/** px height of each message bar in the minimap */
const LINE_H = 3;
/** minimum px gap after a message (very short messages still get separation) */
const MIN_GAP = 4;
/** px of gap per character of message length */
const PX_PER_CHAR = 0.05;
/** maximum px gap after any single message */
const MAX_GAP = 80;
const FALLBACK_RIGHT_OFFSET = 8;
const MIN_SCROLLBAR_RIGHT_OFFSET = 2;

interface MinimapBlock {
  msgIdx: number;
  role: "user" | "assistant" | "system";
  preview: string;
  gap: number;
  id: string;
}

function gapForLength(len: number): number {
  return Math.min(MAX_GAP, MIN_GAP + len * PX_PER_CHAR);
}

function getMinimapRightOffset(scrollContainer: HTMLDivElement | null): number {
  if (!scrollContainer) {return FALLBACK_RIGHT_OFFSET;}

  const scrollbarGutter = Math.max(0, scrollContainer.offsetWidth - scrollContainer.clientWidth);
  if (scrollbarGutter <= 0) {return FALLBACK_RIGHT_OFFSET;}

  return Math.max(MIN_SCROLLBAR_RIGHT_OFFSET, Math.round(scrollbarGutter / 3));
}

const ChatMinimap: React.FC<ChatMinimapProps> = ({
  messages,
  virtuosoRef,
  scrollContainer,
  streamingContent,
  isStreaming,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipY, setTooltipY] = useState(0);
  const [trackClientH, setTrackClientH] = useState(0);
  const dragging = useRef(false);

  const blocks = useMemo<MinimapBlock[]>(() => {
    const result: MinimapBlock[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const firstLine = m.content.split("\n").find((l) => l.trim().length > 0) ?? "";
      result.push({
        msgIdx: i,
        role: m.role,
        preview: firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine,
        gap: gapForLength(m.content.length),
        id: m.id,
      });
    }
    if (isStreaming && streamingContent) {
      const firstLine = streamingContent.split("\n").find((l) => l.trim().length > 0) ?? "";
      result.push({
        msgIdx: messages.length,
        role: "assistant",
        preview: firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine,
        gap: gapForLength(streamingContent.length),
        id: "__streaming__",
      });
    }
    return result;
  }, [messages, isStreaming, streamingContent]);

  const naturalH = useMemo(
    () => blocks.reduce((sum, b) => sum + LINE_H + b.gap, 0),
    [blocks],
  );
  const rightOffset = useMemo(() => getMinimapRightOffset(scrollContainer), [scrollContainer]);

  const scale = trackClientH > 0 && naturalH > 0 ? trackClientH / naturalH : 1;

  useEffect(() => {
    const el = trackRef.current;
    if (!el) {return;}
    const ro = new ResizeObserver(() => setTrackClientH(el.clientHeight));
    ro.observe(el);
    setTrackClientH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const jumpTo = useCallback(
    (idx: number) => {
      virtuosoRef.current?.scrollToIndex({ index: idx, behavior: "smooth", align: "start" });
    },
    [virtuosoRef],
  );

  const blockIdxAtY = useCallback(
    (relY: number): number => {
      const naturalY = (relY / (trackClientH || 1)) * naturalH;
      let y = 0;
      for (let i = 0; i < blocks.length; i++) {
        y += LINE_H + blocks[i].gap;
        if (naturalY < y) {return i;}
      }
      return blocks.length - 1;
    },
    [blocks, naturalH, trackClientH],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) {return;}
      jumpTo(blockIdxAtY(e.clientY - rect.top));
    },
    [blockIdxAtY, jumpTo],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) {return;}
      const relY = e.clientY - rect.top;
      const idx = blockIdxAtY(relY);
      setHoveredIdx(idx);
      setTooltipY(relY);
      if (dragging.current) {jumpTo(idx);}
    },
    [blockIdxAtY, jumpTo],
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  if (blocks.length < 2) {return null;}

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
        {/* Scaled content wrapper */}
        <div
          className="flex flex-col items-center pt-1"
          style={{ transform: `scaleY(${scale})`, transformOrigin: "top" }}
        >
          {blocks.map((b, i) => (
            <div
              key={b.id}
              className={`transition-opacity duration-75 ${hoveredIdx === i ? "opacity-100" : "opacity-70"}`}
              style={{
                width: "60%",
                height: LINE_H,
                marginBottom: b.gap,
                borderRadius: 1,
                backgroundColor:
                  b.role === "user"
                    ? "var(--accent-color, #6366f1)"
                    : b.role === "system"
                      ? "color-mix(in srgb, #eab308 70%, transparent)"
                      : "var(--text-secondary, #94a3b8)",
              }}
            />
          ))}
        </div>

      </div>

      {/* Tooltip — rendered outside the overflow:hidden track so it isn't clipped */}
      {hoveredIdx !== null && blocks[hoveredIdx] && (
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
              backgroundColor: blocks[hoveredIdx].role === "user"
                ? "var(--accent-color, #6366f1)"
                : "var(--text-secondary, #94a3b8)",
            }}
          />
          {blocks[hoveredIdx].preview || (blocks[hoveredIdx].role === "user" ? "User prompt" : "Assistant reply")}
        </div>
      )}
    </div>
  );
};

export default ChatMinimap;
