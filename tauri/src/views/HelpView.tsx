import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export default function HelpView() {
  const [content, setContent] = useState<string>("");

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

  return (
    <div className="p-6 overflow-auto min-h-0">
      <div className="prose max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
