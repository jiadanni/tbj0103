import { Command } from "cmdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Check, Clock, FileText, MessageSquare, ScrollText, Search, Settings2 } from "lucide-react";
import { api, type AppSettings, type QuickSearchResult } from "../lib/api";
import { useSettingsStore } from "../stores/settingsStore";
import type { Workspace } from "../stores/workspaceStore";
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

type KindFilter = "conversation" | "message" | "artifact" | "memory" | "summary";

const ALL_WORKSPACES_SCOPE = "__all__";
const SUPPORTED_KIND_FILTERS: KindFilter[] = ["conversation", "message", "artifact", "memory", "summary"];
const KIND_FILTER_LABELS: Record<KindFilter, string> = {
  conversation: "Chats",
  message: "Messages",
  artifact: "Artifacts",
  memory: "Memory",
  summary: "Summaries",
};

export default function QuickSearchWindow() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const [displaySettings, setDisplaySettings] = useState<Pick<AppSettings, "theme" | "accent_color" | "font_size">>({
    theme: "system",
    accent_color: "#007AFF",
    font_size: 16,
  });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QuickSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceScope, setWorkspaceScope] = useState<string>(ALL_WORKSPACES_SCOPE);
  const [selectedKinds, setSelectedKinds] = useState<string[]>(SUPPORTED_KIND_FILTERS);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function syncWindowState() {
      try {
        const [latestSettings, availableWorkspaces] = await Promise.all([
          api.settings.get(),
          api.workspace.list().catch(() => [] as Workspace[]),
        ]);
        if (cancelled) {return;}

        setDisplaySettings({
          theme: normalizeTheme(latestSettings.theme),
          accent_color: latestSettings.accent_color,
          font_size: latestSettings.font_size,
        });
        setSettings(latestSettings);
        setWorkspaces(availableWorkspaces);
        setWorkspaceScope(resolveWorkspaceScope(latestSettings.quick_search_workspace_scope, availableWorkspaces));
        setSelectedKinds(normalizeSelectedKinds(latestSettings.quick_search_type_filters));
      } catch {
        // Keep local defaults if settings are not available yet.
      }
    }

    function handleFocus() {
      setQuery("");
      setResults([]);
      setIsFilterMenuOpen(false);
      void syncWindowState();
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }

    void syncWindowState();
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
    root.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "transparent";
  }, [displaySettings]);

  useEffect(() => {
    const runQuery = window.setTimeout(() => {
      setIsLoading(true);
      api.quickSearch.query(query, {
        limit: query.trim() ? 24 : 10,
        workspaceId: workspaceScope === ALL_WORKSPACES_SCOPE ? null : workspaceScope,
        kindFilters: effectiveKindFilters(selectedKinds),
      })
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setIsLoading(false));
    }, query.trim() ? 80 : 0);

    return () => window.clearTimeout(runQuery);
  }, [query, selectedKinds, workspaceScope]);

  useEffect(() => {
    function handleBlur() {
      void api.quickSearch.hide();
    }

    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, []);

  useEffect(() => {
    if (!isFilterMenuOpen) {return;}

    function handlePointerDown(event: MouseEvent) {
      if (filterMenuRef.current?.contains(event.target as Node)) {return;}
      setIsFilterMenuOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsFilterMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isFilterMenuOpen]);

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

  const workspaceOptions = useMemo(() => [
    { value: ALL_WORKSPACES_SCOPE, label: "All workspaces" },
    ...workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })),
  ], [workspaces]);

  const activeWorkspaceLabel = useMemo(
    () => workspaceOptions.find((option) => option.value === workspaceScope)?.label ?? "All workspaces",
    [workspaceOptions, workspaceScope],
  );

  const hasActiveFilters = workspaceScope !== ALL_WORKSPACES_SCOPE || effectiveKindFilters(selectedKinds) !== null;

  async function persistQuickSearchSettings(nextWorkspaceScope: string, nextSelectedKinds: string[]) {
    if (!settings) {return;}

    const normalizedKinds = normalizeSelectedKinds(nextSelectedKinds);
    const nextSettings: AppSettings = {
      ...settings,
      quick_search_workspace_scope: nextWorkspaceScope,
      quick_search_type_filters: normalizedKinds,
    };

    setSettings(nextSettings);
    useSettingsStore.getState().setQuickSearchWorkspaceScope(nextWorkspaceScope);
    useSettingsStore.getState().setQuickSearchTypeFilters(normalizedKinds);
    void api.settings.update(nextSettings).catch(() => {
      // Keep local state if persistence fails. The user can retry by toggling again.
    });
  }

  function updateWorkspaceScope(nextWorkspaceScope: string) {
    setWorkspaceScope(nextWorkspaceScope);
    void persistQuickSearchSettings(nextWorkspaceScope, selectedKinds);
  }

  function toggleKind(kind: KindFilter) {
    setSelectedKinds((currentKinds) => {
      const nextKinds = currentKinds.includes(kind)
        ? currentKinds.filter((value) => value !== kind)
        : [...currentKinds, kind];
      void persistQuickSearchSettings(workspaceScope, nextKinds);
      return nextKinds;
    });
  }

  async function openResult(result: QuickSearchResult) {
    await api.quickSearch.openResult(result);
  }

  return (
    <div className="h-screen w-screen bg-transparent text-[var(--text-primary)]">
      <Command
        className="flex h-full w-full flex-col overflow-hidden rounded-[22px] border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-[0_24px_80px_-32px_rgba(15,23,42,0.8)]"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (isFilterMenuOpen) {
              setIsFilterMenuOpen(false);
            } else {
              void api.quickSearch.hide();
            }
          }
        }}
      >
        <div className="border-b border-[var(--border-color)] px-4 py-3">
          <div className="relative flex items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/80 px-3 py-2.5">
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

            <div ref={filterMenuRef} className="relative">
              <button
                type="button"
                aria-label="Search filters"
                aria-expanded={isFilterMenuOpen}
                onClick={() => setIsFilterMenuOpen((current) => !current)}
                className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
                  hasActiveFilters
                    ? "border-[var(--accent-color)] bg-[var(--accent-color)]/12 text-[var(--accent-color)]"
                    : "border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Settings2 size={16} />
              </button>

              {isFilterMenuOpen && (
                <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[320px] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 shadow-[0_24px_50px_-24px_rgba(15,23,42,0.75)] backdrop-blur-xl">
                  <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                      Workspace
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {activeWorkspaceLabel}
                    </p>
                    <div className="mt-3 space-y-1">
                      {workspaceOptions.map((workspace) => {
                        const isSelected = workspace.value === workspaceScope;
                        return (
                          <button
                            key={workspace.value}
                            type="button"
                            onClick={() => updateWorkspaceScope(workspace.value)}
                            className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                              isSelected
                                ? "bg-[var(--accent-color)]/14 text-[var(--text-primary)]"
                                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                            }`}
                          >
                            <span className="truncate">{workspace.label}</span>
                            {isSelected && <Check size={14} className="shrink-0 text-[var(--accent-color)]" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                          Types
                        </p>
                        <p className="mt-1 text-xs text-[var(--text-secondary)]">
                          Select one or more result types.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedKinds(SUPPORTED_KIND_FILTERS);
                          void persistQuickSearchSettings(workspaceScope, SUPPORTED_KIND_FILTERS);
                        }}
                        className="rounded-lg border border-[var(--border-color)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--accent-color)]"
                      >
                        Reset
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {SUPPORTED_KIND_FILTERS.map((kind) => {
                        const isSelected = selectedKinds.includes(kind);
                        return (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => toggleKind(kind)}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                              isSelected
                                ? "border-[var(--accent-color)] bg-[var(--accent-color)]/12 text-[var(--text-primary)]"
                                : "border-[var(--border-color)] bg-transparent text-[var(--text-secondary)] hover:border-[var(--accent-color)]/45 hover:text-[var(--text-primary)]"
                            }`}
                          >
                            <span className={`flex h-4 w-4 items-center justify-center rounded border ${
                              isSelected
                                ? "border-[var(--accent-color)] bg-[var(--accent-color)] text-white"
                                : "border-[var(--border-color)] bg-transparent text-transparent"
                            }`}>
                              <Check size={11} />
                            </span>
                            <span className="truncate">{KIND_FILTER_LABELS[kind]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
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

function resolveWorkspaceScope(workspaceScope: string | null | undefined, workspaces: Workspace[]) {
  if (!workspaceScope || workspaceScope === ALL_WORKSPACES_SCOPE) {
    return ALL_WORKSPACES_SCOPE;
  }
  return workspaces.some((workspace) => workspace.id === workspaceScope)
    ? workspaceScope
    : ALL_WORKSPACES_SCOPE;
}

function normalizeSelectedKinds(kinds: string[] | null | undefined) {
  const normalized = (kinds ?? []).filter((kind): kind is KindFilter =>
    SUPPORTED_KIND_FILTERS.includes(kind as KindFilter)
  );
  return Array.from(new Set(normalized));
}

function effectiveKindFilters(kinds: string[]) {
  const normalized = normalizeSelectedKinds(kinds);
  if (normalized.length === 0 || normalized.length === SUPPORTED_KIND_FILTERS.length) {
    return null;
  }
  return normalized;
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
