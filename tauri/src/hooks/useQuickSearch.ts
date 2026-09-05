import { useEffect, useMemo, useState } from "react";
import { Brain, Clock, FileText, MessageSquare, ScrollText, Search } from "lucide-react";
import { api, type QuickSearchResult } from "../lib/api";
import { useSettingsStore } from "../stores/settingsStore";
import type { Workspace } from "../stores/workspaceStore";

export const ALL_WORKSPACES_SCOPE = "__all__";

export type KindFilter = "conversation" | "message" | "artifact" | "memory" | "summary";

export const SUPPORTED_KIND_FILTERS: KindFilter[] = [
  "conversation",
  "message",
  "artifact",
  "memory",
  "summary",
];

export const KIND_FILTER_LABELS: Record<KindFilter, string> = {
  conversation: "Chats",
  message: "Messages",
  artifact: "Artifacts",
  memory: "Memory",
  summary: "Summaries",
};

const ICON_BY_KIND = {
  conversation: MessageSquare,
  message: MessageSquare,
  artifact: FileText,
  memory: Brain,
  summary: ScrollText,
} as const;

export type ResultGroup = {
  id: string;
  label: string;
  Icon: typeof Search;
  items: QuickSearchResult[];
};

export function normalizeSelectedKinds(kinds: string[] | null | undefined) {
  const normalized = (kinds ?? []).filter((kind): kind is KindFilter =>
    SUPPORTED_KIND_FILTERS.includes(kind as KindFilter)
  );
  return Array.from(new Set(normalized));
}

/**
 * `null` means "no kind filter" — the backend then searches every kind. An
 * empty selection means the same thing rather than "match nothing", so
 * deselecting every type still returns results.
 */
export function effectiveKindFilters(kinds: string[]) {
  const normalized = normalizeSelectedKinds(kinds);
  if (normalized.length === 0 || normalized.length === SUPPORTED_KIND_FILTERS.length) {
    return null;
  }
  return normalized;
}

export function resolveWorkspaceScope(
  workspaceScope: string | null | undefined,
  workspaces: Workspace[],
) {
  if (!workspaceScope || workspaceScope === ALL_WORKSPACES_SCOPE) {
    return ALL_WORKSPACES_SCOPE;
  }
  return workspaces.some((workspace) => workspace.id === workspaceScope)
    ? workspaceScope
    : ALL_WORKSPACES_SCOPE;
}

export function groupLabelFor(result: QuickSearchResult) {
  if (result.recent) {return "Recent Chats";}
  switch (result.kind) {
    case "artifact": return "Artifacts";
    case "memory": return "Memory";
    case "summary": return "Summaries";
    default: return "Conversations";
  }
}

export function iconForResult(result: QuickSearchResult) {
  return ICON_BY_KIND[result.kind as keyof typeof ICON_BY_KIND] ?? Search;
}

export function groupIconFor(result: QuickSearchResult) {
  if (result.recent) {return Clock;}
  return iconForResult(result);
}

export function shortKind(kind: QuickSearchResult["kind"]) {
  switch (kind) {
    case "message": return "Message";
    case "artifact": return "Artifact";
    case "memory": return "Memory";
    case "summary": return "Summary";
    default: return "Chat";
  }
}

export type UseQuickSearchOptions = {
  /**
   * Results requested once the user has typed. The systray window is a tall
   * dedicated surface; embedded callers (the dashboard) show far fewer.
   */
  limit?: number;
  /** Results requested for the empty query, which returns recents. */
  emptyQueryLimit?: number;
  /** Skip querying entirely — used to keep an embedded dropdown idle while closed. */
  enabled?: boolean;
};

/**
 * Shared engine behind both quick-search surfaces: the systray window and the
 * dashboard's omnibox.
 *
 * Owns filter/scope state (persisted to settings so both surfaces agree), the
 * debounced `query_quick_search` call, and result grouping. Deliberately owns
 * no presentation and no window behaviour — the systray's transparent
 * theming, blur-to-hide and focus-reset stay in the window component, and the
 * dashboard's dropdown/ask-fallback stay in the view.
 */
export function useQuickSearch(options: UseQuickSearchOptions = {}) {
  const { limit = 24, emptyQueryLimit = 10, enabled = true } = options;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QuickSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceScope, setWorkspaceScope] = useState<string>(ALL_WORKSPACES_SCOPE);
  const [selectedKinds, setSelectedKinds] = useState<string[]>(SUPPORTED_KIND_FILTERS);

  // Descendant roll-up only applies to a top-level workspace: scoping to a
  // child means that child alone.
  const includeDescendants = workspaceScope !== ALL_WORKSPACES_SCOPE
    && workspaces.find((ws) => ws.id === workspaceScope)?.parent_workspace_id == null;

  async function syncFilterState() {
    try {
      const [advanced, availableWorkspaces, context] = await Promise.all([
        api.settings.getAdvanced(),
        api.workspace.list().catch(() => [] as Workspace[]),
        api.quickSearch.getContext().catch(() => ({ preferred_workspace_id: null })),
      ]);

      setWorkspaces(availableWorkspaces);

      // If no explicit workspace scope was persisted, auto-scope to the active workspace
      const persistedScope = advanced.quick_search_workspace_scope;
      const preferredScope = context.preferred_workspace_id
        && availableWorkspaces.some((ws) => ws.id === context.preferred_workspace_id)
        ? context.preferred_workspace_id
        : null;
      const effectiveScope = persistedScope || preferredScope || ALL_WORKSPACES_SCOPE;
      setWorkspaceScope(resolveWorkspaceScope(effectiveScope, availableWorkspaces));
      const persistedKinds = normalizeSelectedKinds(advanced.quick_search_type_filters);
      setSelectedKinds(persistedKinds.length > 0 ? persistedKinds : SUPPORTED_KIND_FILTERS);
    } catch {
      // Keep local defaults if settings are not available yet.
    }
  }

  useEffect(() => {
    if (!enabled) { return; }
    const runQuery = window.setTimeout(() => {
      setIsLoading(true);
      api.quickSearch.query(query, {
        limit: query.trim() ? limit : emptyQueryLimit,
        workspaceId: workspaceScope === ALL_WORKSPACES_SCOPE ? null : workspaceScope,
        kindFilters: effectiveKindFilters(selectedKinds),
        includeDescendants,
      })
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setIsLoading(false));
    }, query.trim() ? 80 : 0);

    return () => window.clearTimeout(runQuery);
  }, [query, selectedKinds, workspaceScope, includeDescendants, enabled, limit, emptyQueryLimit]);

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

  const hasActiveFilters = workspaceScope !== ALL_WORKSPACES_SCOPE
    || effectiveKindFilters(selectedKinds) !== null;

  function persistFilterSettings(nextWorkspaceScope: string, nextSelectedKinds: string[]) {
    const normalizedKinds = normalizeSelectedKinds(nextSelectedKinds);

    useSettingsStore.getState().setQuickSearchWorkspaceScope(nextWorkspaceScope);
    useSettingsStore.getState().setQuickSearchTypeFilters(normalizedKinds);
    // Per-key writes so we don't have to round-trip the full Settings blob
    // through `update_settings`. Each call is a single SQLite upsert.
    void api.settings
      .updateOne("quick_search_workspace_scope", nextWorkspaceScope)
      .catch(() => {
        // Keep local state if persistence fails. The user can retry by toggling again.
      });
    void api.settings
      .updateOne("quick_search_type_filters", normalizedKinds)
      .catch(() => {
        // Keep local state if persistence fails. The user can retry by toggling again.
      });
  }

  function updateWorkspaceScope(nextWorkspaceScope: string) {
    setWorkspaceScope(nextWorkspaceScope);
    persistFilterSettings(nextWorkspaceScope, selectedKinds);
  }

  function toggleKind(kind: KindFilter) {
    setSelectedKinds((currentKinds) => {
      const nextKinds = currentKinds.includes(kind)
        ? currentKinds.filter((value) => value !== kind)
        : [...currentKinds, kind];
      persistFilterSettings(workspaceScope, nextKinds);
      return nextKinds;
    });
  }

  function resetKinds() {
    setSelectedKinds(SUPPORTED_KIND_FILTERS);
    persistFilterSettings(workspaceScope, SUPPORTED_KIND_FILTERS);
  }

  function clearQuery() {
    setQuery("");
    setResults([]);
  }

  return {
    query,
    setQuery,
    clearQuery,
    results,
    groupedResults,
    isLoading,
    workspaces,
    workspaceScope,
    workspaceOptions,
    activeWorkspaceLabel,
    updateWorkspaceScope,
    selectedKinds,
    toggleKind,
    resetKinds,
    hasActiveFilters,
    includeDescendants,
    syncFilterState,
  };
}

export function fallbackTitle(result: QuickSearchResult) {
  switch (result.kind) {
    case "memory": return "Memory";
    case "artifact": return "Artifact";
    case "summary": return "Summary";
    default: return "Untitled chat";
  }
}

export function buildMetaLine(result: QuickSearchResult) {
  const parts = [
    result.subtitle,
    result.workspace_name || null,
    result.folder_name || null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" • ") : "Search result";
}
