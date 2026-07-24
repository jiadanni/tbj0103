import { lazy, Suspense, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

const ReviewPane = lazy(() =>
  import("./FlashcardReviewView").then((m) => ({ default: m.ReviewPane })),
);
const QuizzesPane = lazy(() =>
  import("./QuizzesPane").then((m) => ({ default: m.QuizzesPane })),
);

type PracticeMode = "review" | "quiz";

function parseInitialPracticeMode(value: string | null): PracticeMode {
  if (value === "quizzes" || value === "quiz") { return "quiz"; }
  return "review";
}

export default function PracticeView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const practiceMode = useMemo(() => parseInitialPracticeMode(searchParams.get("tab")), [searchParams]);

  const initialQuizTopic = useMemo(() => searchParams.get("topic") ?? undefined, [searchParams]);
  const initialQuizKindRaw = useMemo(() => searchParams.get("kind"), [searchParams]);
  const initialQuizKind = initialQuizKindRaw === "pop" || initialQuizKindRaw === "exam"
    ? initialQuizKindRaw
    : undefined;

  function setMode(nextMode: PracticeMode) {
    if (searchParams.get("tab") === nextMode) { return; }
    const next = new URLSearchParams(searchParams);
    next.set("tab", nextMode);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-[var(--border-color)] bg-[linear-gradient(135deg,rgba(var(--accent-color-rgb),0.08),rgba(255,255,255,0)_50%),var(--bg-elevated)] px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          Practice
        </div>
        <h1 className="mt-0.5 text-xl font-semibold text-[var(--text-primary)]">
          Review and quiz your workspace
        </h1>
      </header>

      <div className="flex gap-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/40 px-4 py-3">
        <button
          onClick={() => setMode("review")}
          className={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
            practiceMode === "review"
              ? "border-[var(--accent-color)] bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)]"
              : "border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]"
          }`}
        >
          Review flashcards
        </button>
        <button
          onClick={() => setMode("quiz")}
          className={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
            practiceMode === "quiz"
              ? "border-[var(--accent-color)] bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)]"
              : "border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]"
          }`}
        >
          Take a quiz
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <Suspense fallback={<div className="p-4 text-sm text-[var(--text-muted)]">Loading…</div>}>
          {practiceMode === "review" && <ReviewPane />}
          {practiceMode === "quiz" && (
            <QuizzesPane
              hideSidebar
              initialTopicId={initialQuizTopic}
              initialKind={initialQuizKind}
            />
          )}
        </Suspense>
      </div>
    </div>
  );
}
