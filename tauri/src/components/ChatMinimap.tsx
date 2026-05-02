import React, { useCallback, useRef, useState, useEffect, useMemo } from "react";
import type { Message } from "../stores/chatStore";
import type { VirtuosoHandle } from "react-virtuoso";

interface ChatMinimapProps {
  messages: Message[];
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  streamingContent: string;
  isStreaming: boolean;
}

/** Maximum characters shown per line in the minimap preview. */
const PREVIEW_MAX_CHARS = 60;
/** Height of each minimap block in px. */
const BLOCK_H = 28;
/** Visible viewport indicator height — approximation refreshed on scroll. */
const MIN_THUMB_H = 20;

/**
 * A Sublime-Text–style minimap for the chat message list.
 *
 * Shows a condensed column of user / assistant blocks on the right edge.
 * Clicking or dragging jumps the Virtuoso list to the corresponding message.
 * Hovering a block shows a tooltip with the first line of the message.
 */
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
  const dragging = useRef(false);

  // Build block data from messages + optional streaming block
  const blocks = useMemo(() => {
    const result: { role: "user" | "assistant" | "system"; preview: string; id: string }[] = [];
    for (const m of messages) {
      const first = m.content.split("\n").find((l) => l.trim().length > 0) ?? "";
      result.push({
        role: m.role,
        preview: first.length > PREVIEW_MAX_CHARS ? first.slice(0, PREVIEW_MAX_CHARS) + "…" : first,
        id: m.id,
      });
    }
    if (isStreaming && streamingContent) {
      const first = streamingContent.split("\n").find((l) => l.trim().length > 0) ?? "";
      result.push({
        role: "assistant",
        preview: first.length > PREVIEW_MAX_CHARS ? first.slice(0, PREVIEW_MAX_CHARS) + "…" : first,
        id: "__streaming__",
      });
    }
    return result;
  }, [messages, isStreaming, streamingContent]);

  // Track Virtuoso scroll position via a polling interval (Virtuoso doesn't expose onScroll directly to parents easily)
  useEffect(() => {
    const scroller = trackRef.current?.closest("[data-testid='chat-messages-area']")?.querySelector("[data-virtuoso-scroller]") as HTMLElement | null;
    if (!scroller) return;

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = scroller;
      if (scrollHeight <= 0) return;
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

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const y = e.clientY - rect.top;
      const idx = Math.min(Math.max(Math.floor((y / rect.height) * blocks.length), 0), blocks.length - 1);
      jumpTo(idx);
    },
    [blocks.length, jumpTo],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const y = e.clientY - rect.top;
      const idx = Math.min(Math.max(Math.floor((y / rect.height) * blocks.length), 0), blocks.length - 1);
      setHoveredIdx(idx);
      setTooltipY(e.clientY - rect.top);
      if (dragging.current) {
        jumpTo(idx);
      }
    },
    [blocks.length, jumpTo],
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  if (blocks.length < 4) return null; // Don't show minimap for very short conversations

  const trackH = blocks.length * BLOCK_H;
  const thumbTop = viewportRatio.top * trackH;
  const thumbH = Math.max(viewportRatio.height * trackH, MIN_THUMB_H);

  return (
    <div
      className="absolute right-0 top-0 bottom-0 z-10 flex flex-col items-end pointer-events-none"
      style={{ width: 56 }}
    >
      {/* Track */}
      <div
        ref={trackRef}
        className="relative w-10 my-4 mr-1 pointer-events-auto cursor-pointer select-none"
        style={{ height: trackH, maxHeight: "100%" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          setHoveredIdx(null);
          dragging.current = false;
        }}
      >
        {/* Blocks */}
        {blocks.map((b, i) => (
          <div
            key={b.id}
            className={`w-full rounded-sm mb-px transition-opacity duration-100 ${
              b.role === "user"
                ? "bg-[var(--accent-color)]/50"
                : b.role === "system"
                  ? "bg-yellow-500/30"
                  : "bg-[var(--text-secondary)]/20"
            } ${hoveredIdx === i ? "!opacity-100 ring-1 ring-[var(--accent-color)]" : "opacity-70"}`}
            style={{ height: BLOCK_H - 1 }}
          />
        ))}

        {/* Viewport thumb */}
        <div
          className="absolute left-0 w-full rounded border border-[var(--accent-color)]/40 bg-[var(--accent-color)]/10 pointer-events-none transition-[top] duration-75"
          style={{ top: thumbTop, height: thumbH }}
        />

        {/* Tooltip */}
        {hoveredIdx !== null && blocks[hoveredIdx] && (
          <div
            className="absolute right-12 rounded-lg px-3 py-1.5 text-xs leading-tight max-w-[240px] truncate shadow-lg border border-white/10 bg-[var(--bg-elevated)] text-[var(--text-primary)] pointer-events-none whitespace-nowrap"
            style={{ top: Math.max(0, tooltipY - 14) }}
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
              blocks[hoveredIdx].role === "user" ? "bg-[var(--accent-color)]" : "bg-[var(--text-secondary)]/60"
            }`} />
            {blocks[hoveredIdx].preview || (blocks[hoveredIdx].role === "user" ? "User prompt" : "Assistant reply")}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatMinimap;
