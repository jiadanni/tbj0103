/**
 * QuizzesPane — the Learning hub's Quizzes tab. Holds three states:
 *   - "list": recent quizzes + a CTA to start a new one
 *   - "launch": QuizLauncher form (picks kind/topics/count, creates quiz)
 *   - "take": one-question-at-a-time runner that submits each answer for
 *     AI grading and shows the score/feedback inline before advancing
 *
 * Designed to be used both as a tab inside LearningHubView and as a
 * deep-link target from the dashboard topic chips, hence the optional
 * `initialTopicId` / `initialKind` props.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import {
  api,
  type QuizAnswer,
  type QuizDetail,
  type QuizKind,
  type QuizSummary,
} from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import QuizLauncher from "../components/QuizLauncher";

type Screen =
  | { kind: "list" }
  | { kind: "launch" }
  | { kind: "take"; detail: QuizDetail; index: number };

interface Props {
  initialTopicId?: string;
  initialKind?: QuizKind;
  /** Reserved for the LearningHubView signature parity; ignored for now. */
  hideSidebar?: boolean;
}

function scorePercent(score: number | null | undefined): string {
  if (score == null) { return "—"; }
  return `${Math.round(score * 100)}%`;
}

function scoreToneClass(score: number | null | undefined): string {
  if (score == null) { return "text-[var(--text-muted)]"; }
  if (score >= 0.8) { return "text-emerald-400"; }
  if (score >= 0.5) { return "text-amber-400"; }
  return "text-red-400";
}

export function QuizzesPane({ initialTopicId, initialKind }: Props = {}) {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [screen, setScreen] = useState<Screen>(() =>
    initialTopicId || initialKind ? { kind: "launch" } : { kind: "list" },
  );
  const [summaries, setSummaries] = useState<QuizSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const refreshList = useCallback(() => {
    if (!activeWorkspaceId) { return; }
    setLoadingList(true);
    setListError(null);
    api.quiz
      .list(activeWorkspaceId)
      .then(setSummaries)
      .catch((err) => setListError(String(err)))
      .finally(() => setLoadingList(false));
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (screen.kind !== "list" || !activeWorkspaceId) { return; }
    let cancelled = false;
    api.quiz
      .list(activeWorkspaceId)
      .then((rows) => { if (!cancelled) { setSummaries(rows); } })
      .catch((err) => { if (!cancelled) { setListError(String(err)); } })
      .finally(() => { if (!cancelled) { setLoadingList(false); } });
    return () => { cancelled = true; };
  }, [screen.kind, activeWorkspaceId]);

  if (!activeWorkspaceId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[var(--text-muted)]">
        Select a workspace to use quizzes.
      </div>
    );
  }

  if (screen.kind === "launch") {
    return (
      <div className="h-full overflow-y-auto p-6">
        <QuizLauncher
          workspaceId={activeWorkspaceId}
          initialKind={initialKind}
          initialTopicId={initialTopicId}
          onCancel={() => setScreen({ kind: "list" })}
          onCreated={(detail) => setScreen({ kind: "take", detail, index: 0 })}
        />
      </div>
    );
  }

  if (screen.kind === "take") {
    return (
      <QuizRunner
        detail={screen.detail}
        index={screen.index}
        onAdvance={(nextDetail, nextIndex) =>
          setScreen({ kind: "take", detail: nextDetail, index: nextIndex })
        }
        onFinish={() => setScreen({ kind: "list" })}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Quizzes</h2>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">
              Quick pop quizzes and full exams generated from your topics.
            </p>
          </div>
          <button
            onClick={() => setScreen({ kind: "launch" })}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-color)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            <Plus size={14} /> New quiz
          </button>
        </div>

        {listError && (
          <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {listError}
          </div>
        )}

        <div className="mt-5">
          {loadingList ? (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <Loader2 size={14} className="animate-spin" /> Loading quizzes…
            </div>
          ) : summaries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border-color)] p-8 text-center">
              <ClipboardCheck className="mx-auto text-[var(--text-muted)]" size={28} />
              <p className="mt-3 text-sm text-[var(--text-secondary)]">
                No quizzes yet. Start a pop quiz or a full exam to check what
                you have learned.
              </p>
              <button
                onClick={() => setScreen({ kind: "launch" })}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <Plus size={14} /> Start a quiz
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-color)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)]">
              {summaries.map((s) => (
                <li key={s.quiz.id}>
                  <QuizListRow
                    summary={s}
                    onOpen={async () => {
                      try {
                        const detail = await api.quiz.get(s.quiz.id);
                        // Resume at the first unanswered question.
                        const answered = new Set(detail.answers.map((a) => a.question_id));
                        const next = detail.questions.findIndex((q) => !answered.has(q.id));
                        setScreen({
                          kind: "take",
                          detail,
                          index: next === -1 ? detail.questions.length - 1 : next,
                        });
                      } catch (err) {
                        setListError(String(err));
                      }
                    }}
                    onDelete={async () => {
                      try {
                        await api.quiz.delete(s.quiz.id);
                        refreshList();
                      } catch (err) {
                        setListError(String(err));
                      }
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function QuizListRow({
  summary,
  onOpen,
  onDelete,
}: {
  summary: QuizSummary;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { quiz, answered_count, average_score } = summary;
  const done = quiz.status === "completed";
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button onClick={onOpen} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[rgba(var(--accent-color-rgb),0.12)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--accent-color)]">
            {quiz.kind === "exam" ? "Exam" : "Pop"}
          </span>
          <span className="truncate text-sm font-medium text-[var(--text-primary)]">
            {quiz.title}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-[var(--text-muted)]">
          {answered_count} / {quiz.question_count} answered
          {done ? " • Completed" : " • In progress"}
        </div>
      </button>
      <div className={`text-sm font-semibold tabular-nums ${scoreToneClass(average_score ?? quiz.score)}`}>
        {scorePercent(average_score ?? quiz.score)}
      </div>
      <button
        onClick={onDelete}
        className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-red-400"
        aria-label="Delete quiz"
      >
        <Trash2 size={14} />
      </button>
      <ChevronRight size={14} className="text-[var(--text-muted)]" />
    </div>
  );
}

function QuizRunner({
  detail,
  index,
  onAdvance,
  onFinish,
}: {
  detail: QuizDetail;
  index: number;
  onAdvance: (detail: QuizDetail, nextIndex: number) => void;
  onFinish: () => void;
}) {
  const question = detail.questions[index];
  const existingAnswer = useMemo(
    () => detail.answers.find((a) => a.question_id === question?.id) ?? null,
    [detail.answers, question?.id],
  );
  const [draft, setDraft] = useState<string>(existingAnswer?.user_answer ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [lastGraded, setLastGraded] = useState<QuizAnswer | null>(existingAnswer);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the question changes (new index), reset the editor + feedback.
  useEffect(() => {
    setDraft(existingAnswer?.user_answer ?? "");
    setLastGraded(existingAnswer);
    setError(null);
  }, [question?.id, existingAnswer]);

  if (!question) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[var(--text-muted)]">
        This quiz has no questions.
      </div>
    );
  }

  const isLast = index >= detail.questions.length - 1;

  async function submit() {
    if (!draft.trim() || submitting) { return; }
    setSubmitting(true);
    setError(null);
    try {
      const graded = await api.quiz.submitAnswer({
        quizId: detail.quiz.id,
        questionId: question.id,
        userAnswer: draft,
      });
      // Merge graded answer into the detail so resuming reflects the new state.
      const others = detail.answers.filter((a) => a.question_id !== question.id);
      const nextDetail: QuizDetail = {
        ...detail,
        answers: [...others, graded],
      };
      setLastGraded(graded);
      // Stay on the current question so the user can read the feedback;
      // they advance with the Next button below.
      onAdvance(nextDetail, index);
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function next() {
    if (isLast) {
      setFinalizing(true);
      try {
        await api.quiz.finalize(detail.quiz.id);
        onFinish();
      } catch (err) {
        setError(String(err));
      } finally {
        setFinalizing(false);
      }
      return;
    }
    onAdvance(detail, index + 1);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-[var(--border-color)] bg-[var(--bg-elevated)] px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[var(--text-primary)]">
              {detail.quiz.title}
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">
              Question {index + 1} of {detail.questions.length} • {question.topic}
            </div>
          </div>
          <button
            onClick={onFinish}
            className="rounded-md border border-[var(--border-color)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            Exit
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {/* Progress dots */}
          <div className="flex flex-wrap gap-1">
            {detail.questions.map((q, i) => {
              const ans = detail.answers.find((a) => a.question_id === q.id);
              const isHere = i === index;
              const base = "h-1.5 w-6 rounded-full";
              if (isHere) { return <span key={q.id} className={`${base} bg-[var(--accent-color)]`} />; }
              if (ans) {
                if (ans.score != null && ans.score >= 0.5) {
                  return <span key={q.id} className={`${base} bg-emerald-500/70`} />;
                }
                return <span key={q.id} className={`${base} bg-red-500/60`} />;
              }
              return <span key={q.id} className={`${base} bg-[var(--border-color)]`} />;
            })}
          </div>

          {/* Prompt */}
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Prompt
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">
              {question.prompt}
            </p>
          </div>

          {/* Answer */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Your answer
            </label>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={submitting || !!lastGraded}
              rows={5}
              placeholder="Type your answer…"
              className="mt-2 w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none disabled:opacity-70"
            />
          </div>

          {/* Feedback */}
          {lastGraded && (
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                  <CheckCircle2 size={14} className="text-emerald-400" />
                  Graded
                </div>
                <div className={`text-sm font-semibold tabular-nums ${scoreToneClass(lastGraded.score)}`}>
                  {scorePercent(lastGraded.score)}
                </div>
              </div>
              {lastGraded.feedback && (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">
                  {lastGraded.feedback}
                </p>
              )}
              <details className="mt-3 text-xs text-[var(--text-muted)]">
                <summary className="cursor-pointer hover:text-[var(--text-secondary)]">
                  Show model answer
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-[var(--text-secondary)]">
                  {question.expected_answer}
                </p>
              </details>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            {!lastGraded ? (
              <button
                onClick={submit}
                disabled={!draft.trim() || submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-color)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? "Grading…" : "Submit answer"}
              </button>
            ) : (
              <button
                onClick={next}
                disabled={finalizing}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-color)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                {finalizing && <Loader2 size={14} className="animate-spin" />}
                {isLast ? (finalizing ? "Finalizing…" : "Finish") : "Next question"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default QuizzesPane;
