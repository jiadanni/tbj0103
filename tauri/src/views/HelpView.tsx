import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { ArrowUp } from "lucide-react";

export default function HelpView() {
  const [content, setContent] = useState<string>("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/help.md")
      .then((r) => r.text())
      .then((text) => {
        if (!cancelled) { setContent(text); }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) { return; }
    const onScroll = () => setShowScrollTop(el.scrollTop > 300);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="flex flex-col min-h-0 h-full relative">
      {/* Header */}
      <div className="flex items-center px-6 py-3 border-b border-[var(--border-color)] shrink-0">
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">Help</h1>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5">
        <div className="prose prose-sm max-w-3xl mx-auto
          dark:prose-invert
          prose-headings:text-[var(--text-primary)]
          prose-p:text-[var(--text-secondary)]
          prose-li:text-[var(--text-secondary)]
          prose-strong:text-[var(--text-primary)]
          prose-code:text-[var(--accent-color)]
          prose-th:text-[var(--text-primary)]
          prose-td:text-[var(--text-secondary)]
          prose-a:text-[var(--accent-color)]
          prose-hr:border-[var(--border-color)]">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>

      {/* Scroll-to-top */}
      {showScrollTop && (
        <button
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          className="absolute bottom-6 right-6 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-secondary)] shadow-md hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          aria-label="Scroll to top"
        >
          <ArrowUp size={16} />
        </button>
      )}
    </div>
  );
}
