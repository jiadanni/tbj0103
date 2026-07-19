import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Ban, RotateCcw, Search } from "lucide-react";
import { api, type TopicListItem } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

export default function TopicsListView() {
  const navigate = useNavigate();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [topics, setTopics] = useState<TopicListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showBlocked, setShowBlocked] = useState(false);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      setTopics([]);
      return;
    }
    try {
      const result = await api.topics.listAll(activeWorkspaceId);
      setTopics(result);
      setError(null);
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error).message);
      setTopics([]);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const filtered = useMemo(() => {
    if (!topics) {
      return null;
    }
    let list = topics;
    if (!showBlocked) {
      list = list.filter((t) => !t.is_blocked);
    }
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q));
    }
    return list;
  }, [topics, filter, showBlocked]);

  const blockedCount = useMemo(
    () => topics?.filter((t) => t.is_blocked).length ?? 0,
    [topics],
  );

  const handleBlock = async (topic: TopicListItem) => {
    if (!activeWorkspaceId) {
      return;
    }
    try {
      await api.topics.block(activeWorkspaceId, topic.name);
      await load();
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error).message);
    }
  };

  const handleUnblock = async (topic: TopicListItem) => {
    if (!activeWorkspaceId) {
      return;
    }
    try {
      await api.topics.unblock(activeWorkspaceId, topic.normalized_name);
      await load();
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[var(--bg-secondary)]">
      <header className="flex items-center gap-3 border-b border-[var(--border-color)] px-6 py-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">All Topics</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Manage extracted topics. Block junk topics to hide them from the Knowledge Map and prevent re-extraction.
          </p>
        </div>
      </header>

      <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-6 py-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter topics…"
            className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] py-1.5 pl-8 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-color)] focus:outline-none"
          />
        </div>
        {blockedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowBlocked(!showBlocked)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              showBlocked
                ? "border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]"
                : "border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {showBlocked ? "Hide" : "Show"} blocked ({blockedCount})
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {filtered === null ? (
          <div className="text-sm text-[var(--text-muted)]">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-6 text-center">
            <div className="text-sm font-medium text-[var(--text-primary)]">
              {filter.trim() ? "No topics match your filter." : "No topics extracted yet."}
            </div>
            <div className="mt-1 text-sm text-[var(--text-secondary)]">
              Topics are extracted from your conversations automatically.
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((topic) => (
              <li
                key={topic.concept_id ?? topic.normalized_name}
                className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 ${
                  topic.is_blocked
                    ? "border-red-500/20 bg-red-500/5"
                    : "border-[var(--border-color)] bg-[var(--bg-primary)]/60"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${topic.is_blocked ? "text-[var(--text-muted)] line-through" : "text-[var(--text-primary)]"}`}>
                      {topic.name}
                    </span>
                    <span className="rounded-full border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                      {topic.source}
                    </span>
                  </div>
                  {(topic.card_count > 0 || topic.review_count > 0) && (
                    <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                      {topic.card_count} card{topic.card_count !== 1 ? "s" : ""}
                      {topic.review_count > 0 && ` · ${topic.review_count} reviewed`}
                    </div>
                  )}
                </div>
                {topic.is_blocked ? (
                  <button
                    type="button"
                    onClick={() => handleUnblock(topic)}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--accent-color)]"
                  >
                    <RotateCcw size={12} />
                    Unblock
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleBlock(topic)}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-red-500/60 hover:text-red-400"
                  >
                    <Ban size={12} />
                    Block
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
