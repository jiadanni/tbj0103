/**
 * QuizLauncher — inline form for configuring a new quiz (kind, topics, count)
 * and creating it via api.quiz.create. Used inside QuizzesPane.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { api, type FlashcardTopic, type QuizDetail, type QuizKind } from "../lib/api";

interface Props {
  workspaceId: string;
  initialKind?: QuizKind;
  initialTopicId?: string;
  onCreated: (detail: QuizDetail) => void;
  onCancel?: () => void;
}

export default function QuizLauncher({
  workspaceId,
  initialKind,
  initialTopicId,
  onCreated,
  onCancel,
}: Props) {
  const [kind, setKind] = useState<QuizKind>(initialKind ?? "pop");
  const [topics, setTopics] = useState<FlashcardTopic[]>([]);
  const [selected, setSelected] = useState<Set<string>>(
    () => (initialTopicId ? new Set([initialTopicId]) : new Set()),
  );
  const [questionCount, setQuestionCount] = useState<number>(initialKind === "exam" ? 12 : 4);
  const [loadingTopics, setLoadingTopics] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.flashcard
      .listTopics(workspaceId, true)
      .then((rows) => {
        if (cancelled) { return; }
        setTopics(rows);
      })
      .catch((err) => {
        if (!cancelled) { setError(String(err)); }
      })
      .finally(() => {
        if (!cancelled) { setLoadingTopics(false); }
      });
    return () => { cancelled = true; };
  }, [workspaceId]);

  // When kind toggles, snap question count to its default and (for pop) trim
  // the topic selection to a single topic.
  function handleKindChange(next: QuizKind) {
    setKind(next);
    setQuestionCount(next === "exam" ? 12 : 4);
    if (next === "pop" && selected.size > 1) {
      const first = selected.values().next().value as string | undefined;
      setSelected(first ? new Set([first]) : new Set());
    }
  }

  function toggleTopic(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (kind === "pop") {
        return next.has(id) ? new Set() : new Set([id]);
      }
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  const selectedTopics = useMemo(
    () => topics.filter((t) => selected.has(t.id)),
    [topics, selected],
  );

  const canStart = selected.size > 0 && !generating;

  async function start() {
    if (!canStart) { return; }
    setGenerating(true);
    setError(null);
    try {
      const detail = await api.quiz.create({
        workspaceId,
        kind,
        topicIds: Array.from(selected),
        questionCount,
      });
      onCreated(detail);
    } catch (err) {
      setError(String(err));
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Start a quiz</h2>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="Cancel"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Kind picker */}
      <div className="mt-4">
        <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Kind</div>
        <div className="mt-2 inline-flex rounded-lg border border-[var(--border-color)] p-0.5">
          {(["pop", "exam"] as QuizKind[]).map((k) => (
            <button
              key={k}
              onClick={() => handleKindChange(k)}
              disabled={generating}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                kind === k
                  ? "bg-[var(--accent-color)] text-white"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {k === "pop" ? "Pop quiz" : "Full exam"}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
          {kind === "pop"
            ? "A short check on a single topic."
            : "A longer mixed-topic exam across the topics you select."}
        </p>
      </div>

      {/* Topics */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {kind === "pop" ? "Topic" : "Topics"}
          </div>
          {selectedTopics.length > 0 && (
            <div className="text-[11px] text-[var(--text-muted)]">
              {selectedTopics.length} selected
            </div>
          )}
        </div>
        <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
          {loadingTopics ? (
            <div className="flex items-center gap-2 p-3 text-sm text-[var(--text-muted)]">
              <Loader2 size={14} className="animate-spin" /> Loading topics…
            </div>
          ) : topics.length === 0 ? (
            <div className="p-3 text-sm text-[var(--text-muted)]">
              No topics yet. Generate flashcards or let the topic signature
              detect tags from your conversations first.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-color)]">
              {topics.map((t) => {
                const isSel = selected.has(t.id);
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => toggleTopic(t.id)}
                      disabled={generating}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                        isSel
                          ? "bg-[rgba(var(--accent-color-rgb),0.08)] text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <span className="truncate">{t.topic}</span>
                      <span className="ml-3 shrink-0 text-[11px] text-[var(--text-muted)]">
                        {t.card_count} cards
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Question count */}
      <div className="mt-4">
        <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Questions</div>
        <div className="mt-2 flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={kind === "exam" ? 25 : 10}
            value={questionCount}
            onChange={(e) => setQuestionCount(Number(e.target.value))}
            disabled={generating}
            className="flex-1"
          />
          <span className="w-10 text-right text-sm tabular-nums text-[var(--text-primary)]">
            {questionCount}
          </span>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={generating}
            className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
          >
            Cancel
          </button>
        )}
        <button
          onClick={start}
          disabled={!canStart}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-color)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {generating && <Loader2 size={14} className="animate-spin" />}
          {generating ? "Generating questions…" : "Start"}
        </button>
      </div>
    </div>
  );
}
