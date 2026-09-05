import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Sparkles } from "lucide-react";
import type { QuickSearchResult } from "../lib/api";
import { navigateToQuickSearchResult } from "../lib/quickSearchNavigation";
import {
  buildMetaLine,
  fallbackTitle,
  iconForResult,
  shortKind,
  useQuickSearch,
} from "../hooks/useQuickSearch";
import { useWorkspaceStore } from "../stores/workspaceStore";

/**
 * The dashboard's "search or ask" box.
 *
 * Shares its engine with the systray quick-search window via `useQuickSearch`,
 * so both surfaces honour the same persisted workspace/type filters. Results
 * appear as you type; asking a new chat is the last row rather than a mode the
 * user has to pick up front, which keeps the previous behaviour (type, press
 * Enter, get a new chat seeded with the text) reachable without a second
 * control.
 */
export default function DashboardOmnibox() {
  const navigate = useNavigate();
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  // -1 is the "ask a new chat" row; 0..n-1 index into results.
  const [activeIndex, setActiveIndex] = useState(-1);

  const { query, setQuery, clearQuery, results, isLoading, syncFilterState } =
    useQuickSearch({ limit: 8, emptyQueryLimit: 5, enabled: isOpen });

  useEffect(() => {
    void syncFilterState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the highlight on the first result as the list changes underneath.
  useEffect(() => {
    setActiveIndex(results.length > 0 ? 0 : -1);
  }, [results]);

  useEffect(() => {
    if (!isOpen) { return; }
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current?.contains(event.target as Node)) { return; }
      setIsOpen(false);
    }
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const trimmed = query.trim();

  function askNewChat() {
    if (!trimmed) { return; }
    setIsOpen(false);
    navigate("/chat", { state: { createNewChat: true, searchQuery: trimmed } });
  }

  function openResult(result: QuickSearchResult) {
    setIsOpen(false);
    clearQuery();
    if (result.workspace_id) {
      setActiveWorkspaceId(result.workspace_id);
    }
    navigateToQuickSearchResult(navigate, result);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setIsOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (current + 1 >= results.length ? -1 : current + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= -1 ? results.length - 1 : current - 1));
      return;
    }
    if (event.key === "Enter") {
      const highlighted = activeIndex >= 0 ? results[activeIndex] : null;
      if (highlighted) {
        openResult(highlighted);
      } else {
        askNewChat();
      }
    }
  }

  const showDropdown = isOpen && (results.length > 0 || trimmed.length > 0);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 focus-within:border-[var(--accent-color)] transition-colors">
          <Search size={14} className="text-[var(--text-muted)]" />
          <input
            id="dashboard-search-input"
            type="text"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls="dashboard-search-results"
            placeholder="Search or ask anything..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            className="bg-transparent text-sm text-[var(--text-primary)] outline-none w-48 sm:w-64 placeholder-[var(--text-muted)]"
          />
          {isLoading && (
            <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Searching
            </span>
          )}
        </div>
        <button
          id="dashboard-search-button"
          onClick={askNewChat}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-color)] px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          disabled={!trimmed}
        >
          Ask
        </button>
      </div>

      {showDropdown && (
        <div
          id="dashboard-search-results"
          role="listbox"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(28rem,80vw)] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_24px_50px_-24px_rgba(15,23,42,0.75)]"
        >
          {results.map((result, index) => {
            const ItemIcon = iconForResult(result);
            const isActive = index === activeIndex;
            return (
              <button
                key={`${result.kind}-${result.target_id}`}
                type="button"
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => openResult(result)}
                className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                  isActive ? "bg-[var(--bg-hover)]" : ""
                }`}
              >
                <ItemIcon size={14} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-[var(--text-primary)]">
                    {result.title || fallbackTitle(result)}
                  </div>
                  <div className="truncate text-[11px] text-[var(--text-muted)]">
                    {buildMetaLine(result)}
                  </div>
                </div>
                <span className="mt-0.5 shrink-0 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  {result.recent ? "Recent" : shortKind(result.kind)}
                </span>
              </button>
            );
          })}

          {trimmed.length > 0 && (
            <button
              type="button"
              role="option"
              aria-selected={activeIndex === -1}
              onMouseEnter={() => setActiveIndex(-1)}
              onClick={askNewChat}
              className={`mt-0.5 flex w-full items-center gap-2.5 rounded-xl border-t border-[var(--border-color)] px-2.5 py-2 text-left transition-colors ${
                activeIndex === -1 ? "bg-[var(--bg-hover)]" : ""
              }`}
            >
              <Sparkles size={14} className="shrink-0 text-[var(--accent-color)]" />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">
                Ask a new chat: <span className="text-[var(--text-secondary)]">“{trimmed}”</span>
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Enter
              </span>
            </button>
          )}

          {results.length === 0 && !isLoading && trimmed.length > 0 && (
            <p className="px-2.5 py-2 text-[11px] text-[var(--text-muted)]">
              No matches in your workspaces yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
