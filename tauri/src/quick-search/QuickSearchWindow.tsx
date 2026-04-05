import { Command } from "cmdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, MessageSquare, FileText, Brain, ScrollText, Clock } from "lucide-react";
import { api, type AppSettings, type QuickSearchResult } from "../lib/api";
import { normalizeTheme } from "../lib/theme";

const ICON_BY_KIND = {
  conversation: MessageSquare,
  message: MessageSquare,
  artifact: FileText,
  memory: Brain,
  summary: ScrollText,
} as const;

type ResultGroup = {
  id: string;
  label: string;
  Icon: typeof Search;
  items: QuickSearchResult[];
};

export default function QuickSearchWindow() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [displaySettings, setDisplaySettings] = useState<Pick<AppSettings, "theme" | "accent_color" | "font_size">>({
    theme: "system",
    accent_color: "#007AFF",
    font_size: 16,
  });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QuickSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function syncSettings() {
      try {
        const settings = await api.settings.get();
        if (!cancelled) {
          setDisplaySettings({
            theme: normalizeTheme(settings.theme),
            accent_color: settings.accent_color,
            font_size: settings.font_size,
          });
        }
      } catch {
        // Keep local defaults if settings are not available yet.
      }
    }

    function handleFocus() {
      setQuery("");
      void syncSettings();
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }

    void syncSettings();
    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const normalizedTheme = normalizeTheme(displaySettings.theme);
    root.classList.forEach((cls) => {
      if (cls.startsWith("theme-")) {root.classList.remove(cls);}
    });
    root.classList.add(`theme-${normalizedTheme}`);
    if (displaySettings.accent_color) {
      root.style.setProperty("--accent-color", displaySettings.accent_color);
    }
    root.style.setProperty("--font-size-base", `${displaySettings.font_size}px`);
    root.style.fontSize = `${displaySettings.font_size}px`;
  }, [displaySettings]);

  useEffect(() => {
    const runQuery = window.setTimeout(() => {
      setIsLoading(true);
      api.quickSearch.query(query, query.trim() ? 24 : 10)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setIsLoading(false));
    }, query.trim() ? 80 : 0);

    return () => window.clearTimeout(runQuery);
  }, [query]);

  useEffect(() => {
    function handleBlur() {
      void api.quickSearch.hide();
    }

    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, []);

  const groupedResults = useMemo<ResultGroup[]>(() => {
    const groups = new Map<string, ResultGroup>();

    for (const item of results) {
      const groupId = item.recent ? "recent" : item.kind;
      if (!groups.has(groupId)) {
        groups.set(groupId, {
          id: groupId,
          label: groupLabelFor(item),
          Icon: groupIconFor(item),
          items: [],
        });
      }
      groups.get(groupId)?.items.push(item);
    }

    return Array.from(groups.values());
  }, [results]);

  async function openResult(result: QuickSearchResult) {
    await api.quickSearch.openResult(result);
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-2xl">
      <Command
        className="flex h-full w-full flex-col bg-transparent"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            void api.quickSearch.hide();
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-4 py-3">
          <Search size={15} className="text-[var(--text-muted)]" />
          <Command.Input
            autoFocus
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder="Search conversations, artifacts, and memory…"
            className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          {isLoading && (
            <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Searching
            </span>
          )}
        </div>

        <Command.List className="flex-1 overflow-y-auto p-2">
          <Command.Empty className="px-4 py-10 text-center">
            <p className="text-sm text-[var(--text-secondary)]">
              {query.trim() ? "No results found." : "No recent chats yet."}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {query.trim()
                ? "Try a shorter query or a key phrase from the conversation."
                : "Recent chats will appear here when you start using Aetherium."}
            </p>
          </Command.Empty>

          {groupedResults.map((group) => (
            <Command.Group
              key={group.id}
              heading={group.label}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em] [&_[cmdk-group-heading]]:text-[var(--text-muted)]"
            >
              {group.items.map((result) => {
                const ItemIcon = result.recent ? Clock : iconForResult(result);
                return (
                  <Command.Item
                    key={result.doc_id}
                    value={`${result.title} ${result.subtitle} ${result.excerpt}`}
                    onSelect={() => { void openResult(result); }}
                    className="group rounded-xl px-2 py-2.5 text-sm text-[var(--text-primary)] aria-selected:bg-[var(--accent-color)]/14 aria-selected:text-[var(--text-primary)]"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--accent-color)]">
                        <ItemIcon size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate font-medium">{result.title || fallbackTitle(result)}</p>
                          <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                            {result.recent ? "Recent" : shortKind(result.kind)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                          {buildMetaLine(result)}
                        </p>
                        {result.excerpt && (
                          <p className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">
                            {result.excerpt}
                          </p>
                        )}
                      </div>
                    </div>
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}

function groupLabelFor(result: QuickSearchResult) {
  if (result.recent) {return "Recent Chats";}
  switch (result.kind) {
    case "artifact": return "Artifacts";
    case "memory": return "Memory";
    case "summary": return "Summaries";
    default: return "Conversations";
  }
}

function groupIconFor(result: QuickSearchResult) {
  if (result.recent) {return Clock;}
  return iconForResult(result);
}

function iconForResult(result: QuickSearchResult) {
  return ICON_BY_KIND[result.kind as keyof typeof ICON_BY_KIND] ?? Search;
}

function shortKind(kind: QuickSearchResult["kind"]) {
  switch (kind) {
    case "message": return "Message";
    case "artifact": return "Artifact";
    case "memory": return "Memory";
    case "summary": return "Summary";
    default: return "Chat";
  }
}

function fallbackTitle(result: QuickSearchResult) {
  switch (result.kind) {
    case "memory": return "Memory";
    case "artifact": return "Artifact";
    case "summary": return "Summary";
    default: return "Untitled chat";
  }
}

function buildMetaLine(result: QuickSearchResult) {
  const parts = [
    result.subtitle,
    result.workspace_name || null,
    result.project_name || null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" • ") : "Search result";
}
