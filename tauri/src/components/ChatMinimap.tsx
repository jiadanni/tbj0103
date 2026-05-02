import React, { useCallback, useRef, useState, useEffect, useMemo } from "react";
import type { Message } from "../stores/chatStore";
import type { VirtuosoHandle } from "react-virtuoso";

interface ChatMinimapProps {
  messages: Message[];
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  streamingContent: string;
  isStreaming: boolean;
}

/** px height of each simulated line in the minimap */
const LINE_H = 2;
/** px gap between lines within a block */
const LINE_GAP = 1;
/** px gap between message blocks */
const BLOCK_GAP = 6;
/** approximate chars per minimap "line" */
const CHARS_PER_LINE = 30;
/** max lines rendered per message */
const MAX_LINES = 60;

interface MinimapBlock {
  msgIdx: number;
  role: "user" | "assistant" | "system";
  lineCount: number;
  preview: string;
  id: string;
}

function estimateLineCount(text: string): number {
  const lines = text.split("\n");
  let total = 0;
  for (const line of lines) {
    total += Math.max(1, Math.ceil(line.length / CHARS_PER_LINE));
  }
  return Math.min(Math.max(total, 1), MAX_LINES);
}

function blockH(lineCount: number): number {
  return lineCount * (LINE_H + LINE_GAP) - LINE_GAP;
}

const ChatMinimap: React.FC<ChatMinimapProps> = ({
  messages,
  virtuosoRef,
  streamingContent,
  isStreaming,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipY, setTooltipY] = useState(0);
  const [viewportRatio, setViewportRatio] = useState({ top: 0, height: 1 });
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
        lineCount: estimateLineCount(m.content),
        preview: firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine,
        id: m.id,
      });
    }
    if (isStreaming && streamingContent) {
      const firstLine = streamingContent.split("\n").find((l) => l.trim().length > 0) ?? "";
      result.push({
        msgIdx: messages.length,
        role: "assistant",
        lineCount: estimateLineCount(streamingContent),
        preview: firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine,
        id: "__streaming__",
      });
    }
    return result;
  }, [messages, isStreaming, streamingContent]);

  const naturalH = useMemo(
    () => blocks.reduce((sum, b) => sum + blockH(b.lineCount) + BLOCK_GAP, 0),
    [blocks],
  );

  const scale = trackClientH > 0 && naturalH > 0 ? Math.min(trackClientH / naturalH, 1) : 1;

  useEffect(() => {
    const el = trackRef.current;
    if (!el) {return;}
    const ro = new ResizeObserver(() => setTrackClientH(el.clientHeight));
    ro.observe(el);
    setTrackClientH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const scroller = trackRef.current
      ?.closest("[data-testid='chat-messages-area']")
      ?.querySelector("[data-virtuoso-scroller]") as HTMLElement | null;
    if (!scroller) {return;}

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = scroller;
      if (scrollHeight <= 0) {return;}
      setViewportRatio({
        top: scrollTop / scrollHeight,
        height: Math.max(clientHeight / scrollHeight, 0.05),
      });
    };

    scroller.addEventListener("scroll", update, { passive: true });
    update();
    return () => scroller.removeEventListener("scroll", update);
  }, [blocks.length]);

  const jumpTo = useCallback(
    (idx: number) => {
      virtuosoRef.current?.scrollToIndex({ index: idx, behavior: "smooth", align: "center" });
    },
    [virtuosoRef],
  );

  const blockIdxAtY = useCallback(
    (relY: number): number => {
      const naturalY = (relY / (trackClientH || 1)) * naturalH;
      let y = 0;
      for (let i = 0; i < blocks.length; i++) {
        y += blockH(blocks[i].lineCount) + BLOCK_GAP;
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

  if (blocks.length < 4) {return null;}

  return (
    <div
      className="absolute right-2 top-2 bottom-2 z-10 flex flex-col items-end pointer-events-none"
      style={{ width: 40 }}
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
          className="px-[3px] pt-1"
          style={{ transform: `scaleY(${scale})`, transformOrigin: "top" }}
        >
          {blocks.map((b, i) => (
            <div
              key={b.id}
              className={`w-full transition-opacity duration-75 ${hoveredIdx === i ? "opacity-100" : "opacity-70"}`}
              style={{ height: blockH(b.lineCount), marginBottom: BLOCK_GAP }}
            >
              {Array.from({ length: b.lineCount }, (_, li) => (
                <div
                  key={li}
                  style={{
                    height: LINE_H,
                    marginBottom: li < b.lineCount - 1 ? LINE_GAP : 0,
                    width: "100%",
                    borderRadius: 1,
                    backgroundColor:
                      b.role === "user"
                        ? `color-mix(in srgb, var(--accent-color, #6366f1) ${li === 0 ? "90%" : "55%"}, transparent)`
                        : b.role === "system"
                          ? "color-mix(in srgb, #eab308 45%, transparent)"
                          : `color-mix(in srgb, var(--text-secondary, #94a3b8) ${li === 0 ? "60%" : "30%"}, transparent)`,
                  }}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Viewport thumb */}
        <div
          className="absolute left-0 w-full pointer-events-none rounded transition-[top,height] duration-75"
          style={{
            top: `${viewportRatio.top * 100}%`,
            height: `${Math.max(viewportRatio.height * 100, 8)}%`,
            border: "1px solid color-mix(in srgb, var(--accent-color, #6366f1) 60%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--accent-color, #6366f1) 15%, transparent)",
          }}
        />
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
