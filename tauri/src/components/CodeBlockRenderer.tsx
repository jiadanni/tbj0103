import React, { useState, useMemo } from "react";
import { Check, Copy, Download, Code2 } from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Tooltip } from "./Tooltip";
import {
  getCodeBlockColorPaletteColors,
  getCodeBlockKeywordColorValue,
  tokenizeCode,
  type CodeBlockColorPalette,
  type CodeBlockContainerStyle,
  type CodeBlockKeywordColor,
} from "../lib/codeBlockHighlight";

function codeSnippetFilename(lang: string) {
  const extensionByLanguage: Record<string, string> = {
    bash: "sh",
    c: "c",
    cpp: "cpp",
    css: "css",
    go: "go",
    html: "html",
    java: "java",
    javascript: "js",
    json: "json",
    python: "py",
    rust: "rs",
    sql: "sql",
    typescript: "ts",
  };
  const extension = extensionByLanguage[lang.toLowerCase()] ?? "txt";
  return `snippet.${extension}`;
}

export function CodeBlockRenderer({
  content,
  lang,
  containerStyle,
  colorPalette,
  keywordColor,
}: {
  content: string;
  lang: string;
  containerStyle: CodeBlockContainerStyle;
  colorPalette: CodeBlockColorPalette;
  keywordColor: CodeBlockKeywordColor;
}) {
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const highlightedTokens = useMemo(() => tokenizeCode(content, lang), [content, lang]);
  const paletteColors = getCodeBlockColorPaletteColors(colorPalette);
  const keywordColorValue = getCodeBlockKeywordColorValue(keywordColor, colorPalette);
  const languageLabel = lang || "text";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("Failed to copy snippet:", e);
    }
  };

  const handleDownload = async () => {
    try {
      const destination = await saveDialog({
        defaultPath: codeSnippetFilename(lang),
        filters: [{ name: "Code", extensions: [codeSnippetFilename(lang).split(".").pop() || "txt"] }],
      });
      if (!destination) { return; }
      await writeTextFile(destination, content);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 1500);
    } catch (e) {
      console.error("Failed to download snippet:", e);
    }
  };

  const codeContent = (
    <code style={{ color: paletteColors.plain }}>
      {highlightedTokens.map((token, index) => (
        token.kind === "keyword"
          ? <span key={index} style={{ color: keywordColorValue, fontWeight: 600 }}>{token.text}</span>
          : token.kind === "plain"
            ? <React.Fragment key={index}>{token.text}</React.Fragment>
            : <span key={index} style={{ color: paletteColors[token.kind] }}>{token.text}</span>
      ))}
    </code>
  );

  const copyIconButton = (
    <Tooltip content={copied ? "Copied" : "Copy"}>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10 hover:text-white"
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </Tooltip>
  );

  const downloadIconButton = (
    <Tooltip content={downloaded ? "Downloaded" : "Download"}>
      <button
        type="button"
        onClick={handleDownload}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10 hover:text-white"
        aria-label={downloaded ? "Downloaded" : "Download code"}
      >
        {downloaded ? <Check size={14} /> : <Download size={14} />}
      </button>
    </Tooltip>
  );

  if (containerStyle === "utilityHeader") {
    return (
      <div className="my-3 max-w-full overflow-hidden rounded-lg bg-[#1f1f1f] text-white shadow-sm">
        <div className="flex items-center justify-between bg-[#303134] px-4 py-2 text-xs text-white/80">
          <span className="font-medium lowercase">{languageLabel}</span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={handleCopy} className="inline-flex items-center gap-1 text-white/80 transition-colors hover:text-white">
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
            <button type="button" onClick={handleDownload} className="inline-flex items-center gap-1 text-white/80 transition-colors hover:text-white">
              {downloaded ? <Check size={13} /> : <Download size={13} />}
              <span>{downloaded ? "Downloaded" : "Download"}</span>
            </button>
          </div>
        </div>
        <pre className="m-0 !w-full !max-w-full !rounded-none !bg-transparent overflow-x-auto px-4 py-4 text-[0.92em] leading-6">
          {codeContent}
        </pre>
      </div>
    );
  }

  if (containerStyle === "compactHeader") {
    return (
      <div className="my-3 max-w-full overflow-hidden rounded-2xl bg-[#1f1f1f] text-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 text-xs font-medium text-white/90">
          <span className="inline-flex items-center gap-2">
            <Code2 size={13} />
            <span>{languageLabel}</span>
          </span>
          {copyIconButton}
        </div>
        <pre className="m-0 !w-full !max-w-full !rounded-none !bg-transparent overflow-x-auto px-4 pb-4 text-[0.85em] leading-6">
          {codeContent}
        </pre>
      </div>
    );
  }

  const roomy = containerStyle === "roundedExpanded";
  return (
    <div className={`my-3 overflow-hidden bg-[#1f1f1f] text-white shadow-sm ${
      roomy
        ? "w-full min-h-[340px] rounded-[30px]"
        : "w-fit max-w-full rounded-[22px]"
    }`}>
      <div className={`flex items-center justify-between ${roomy ? "px-7 py-6" : "px-5 py-2.5"} text-sm font-semibold text-white`}>
        <span>{languageLabel}</span>
        <div className="flex items-center gap-2">
          {downloadIconButton}
          {copyIconButton}
        </div>
      </div>
      <pre className={`m-0 !w-full !max-w-full !rounded-none !bg-transparent overflow-x-auto ${roomy ? "px-7 pb-9 text-[0.95em] leading-8" : "px-5 pb-5 text-[0.88em] leading-6"}`}>
        {codeContent}
      </pre>
    </div>
  );
}
