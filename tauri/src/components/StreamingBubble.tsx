import { useState, useEffect, useRef } from "react";
import { useChatStore } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export function StreamingBubble({
  activeChatId,
  chatMessageStyle,
  expandChatToWindowWidth,
}: {
  activeChatId: string | null;
  chatMessageStyle: string;
  expandChatToWindowWidth: boolean;
}) {
  const streamingSessionId = useChatStore((s) => s.streamingSessionId);
  const isCurrentlyStreaming = activeChatId ? streamingSessionId === activeChatId : false;
  const assistantChatLabel = useSettingsStore((s) => s.assistantChatLabel);

  // Batched state updates via rAF — avoids thrashing React on every token.
  const [content, setContent] = useState("");
  const rafRef = useRef(0);

  useEffect(() => {
    if (!isCurrentlyStreaming) {
      // Defer the reset so it does not trigger a synchronous setState inside an effect.
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => { setContent(""); });
      return;
    }
    const unsub = useChatStore.subscribe(
      (state) => state.streamingContent,
      (streamingContent) => {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          setContent(streamingContent);
        });
      },
    );
    return () => {
      unsub();
      window.cancelAnimationFrame(rafRef.current);
    };
  }, [isCurrentlyStreaming]);

  if (!isCurrentlyStreaming) { return null; }

  const isMinimal = chatMessageStyle === "minimal";

  return (
    <div className={`flex flex-col gap-1 items-start pb-4 ${isMinimal ? "px-8" : "px-4"}`}>
      {isMinimal && (
        <div className="text-xs font-semibold text-[var(--text-muted)] tracking-wide">{assistantChatLabel}</div>
      )}
      <div className={`${
        isMinimal
          ? "w-full break-words py-1 text-sm text-[var(--text-primary)]"
          : `${expandChatToWindowWidth ? "max-w-[90%]" : "max-w-[75%]"} break-words rounded-2xl px-4 py-2.5 text-sm message-assistant ${chatMessageStyle === "flat" ? "border border-[var(--border-color)] bg-[var(--bg-elevated)]" : ""}`
      }`}>
        {!content ? (
          <span className="flex gap-1 items-center py-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent-color)] opacity-80" style={{ animation: "thinking-dot 1.2s ease-in-out infinite" }} />
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent-color)] opacity-80" style={{ animation: "thinking-dot 1.2s ease-in-out 0.2s infinite" }} />
          </span>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none">
            <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
