import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, AlertTriangle, Target, Clock } from "lucide-react";
import { api, type ReviewTopic } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useBubbleUpFlag } from "../lib/workspacePane";

function reasonIcon(kind: string) {
  switch (kind) {
    case "grade":
      return <AlertTriangle size={14} className="text-[var(--accent-color)]" />;
    case "goal":
      return <Target size={14} className="text-[var(--text-secondary)]" />;
    default:
      return <Clock size={14} className="text-[var(--text-muted)]" />;
  }
}

function reasonLabel(kind: string): string {
  switch (kind) {
    case "grade":
      return "Failing grade";
    case "goal":
      return "At-risk goal";
    default:
      return "Stale";
  }
}

export default function ReviewTopicsView() {
  const navigate = useNavigate();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const includeDescendants = useBubbleUpFlag();
  const [topics, setTopics] = useState<ReviewTopic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      setTopics([]);
      return;
    }
    try {
      const result = await api.dashboard.getReviewTopics(activeWorkspaceId, { includeDescendants });
      setTopics(result);
      setError(null);
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error).message);
      setTopics([]);
    }
  }, [activeWorkspaceId, includeDescendants]);

  useEffect(() => {
    // setTimeout defers setState out of the effect synchronous body; mirrors
    // the async-fetch pattern used elsewhere (e.g. HistoryView).
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

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
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Topics due for review</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Concepts flagged by quiz grades, learning goals, or staleness.
          </p>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {topics === null ? (
          <div className="text-sm text-[var(--text-muted)]">Loading…</div>
        ) : topics.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-6 text-center">
            <div className="text-sm font-medium text-[var(--text-primary)]">Nothing to review right now.</div>
            <div className="mt-1 text-sm text-[var(--text-secondary)]">
              When quiz grades dip, goals stall, or topics get stale, they will appear here.
            </div>
            <button
              type="button"
              onClick={() => navigate("/learning")}
              className="mt-3 text-sm font-medium text-[var(--accent-color)] hover:underline"
            >
              Browse the knowledge graph
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {topics.map((topic) => (
              <li key={topic.concept_id}>
                <button
                  type="button"
                  onClick={() => navigate("/learning", { state: { focusConceptId: topic.concept_id } })}
                  className="flex w-full items-start justify-between gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-4 text-left transition-colors hover:border-[var(--accent-color)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[var(--text-primary)]">{topic.name}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] px-2 py-0.5">
                        {reasonIcon(topic.reason_kind)}
                        {reasonLabel(topic.reason_kind)}
                      </span>
                      <span className="truncate">{topic.detail}</span>
                    </div>
                  </div>
                  <ArrowRight size={16} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
