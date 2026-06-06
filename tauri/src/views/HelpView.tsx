import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { ArrowUp } from "lucide-react";

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function flattenText(children: ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }
      if (React.isValidElement<{ children?: ReactNode }>(child)) {
        return flattenText(child.props.children);
      }
      return "";
    })
    .join("");
}

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

  const markdownComponents = useMemo(() => {
    const createHeading = (tag: keyof JSX.IntrinsicElements) => {
      const Heading = ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
        const id = slugifyHeading(flattenText(children));
        return React.createElement(tag, { ...props, id }, children);
      };
      return Heading;
    };

    return {
      h1: createHeading("h1"),
      h2: createHeading("h2"),
      h3: createHeading("h3"),
      h4: createHeading("h4"),
      h5: createHeading("h5"),
      h6: createHeading("h6"),
      a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a
          {...props}
          href={href}
          onClick={(event) => {
            if (!href) { return; }

            if (href.startsWith("#")) {
              event.preventDefault();
              const targetId = href.slice(1);
              if (!targetId) { return; }
              const container = scrollRef.current;
              const target = container?.querySelector<HTMLElement>(`#${CSS.escape(targetId)}`);
              if (!container || !target) { return; }
              const top = Math.max(target.offsetTop - 16, 0);
              if (typeof container.scrollTo === "function") {
                container.scrollTo({ top, behavior: "smooth" });
              } else {
                container.scrollTop = top;
              }
              return;
            }

            if (/^https?:\/\//i.test(href)) {
              event.preventDefault();
              void openShell(href);
            }
          }}
        >
          {children}
        </a>
      ),
    };
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
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={markdownComponents}
          >
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
