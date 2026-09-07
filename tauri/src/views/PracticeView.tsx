import { lazy, Suspense, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspaceStore";

const ReviewPane = lazy(() =>
  import("./FlashcardReviewView").then((m) => ({ default: m.ReviewPane })),
);
const QuizzesPane = lazy(() =>
  import("./QuizzesPane").then((m) => ({ default: m.QuizzesPane })),
);
const FeedPane = lazy(() => import("./FeedPane"));

type PracticeMode = "review" | "quiz" | "feed";

function parseInitialPracticeMode(value: string | null): PracticeMode {
  if (value === "quizzes" || value === "quiz") { return "quiz"; }
  if (value === "feed") { return "feed"; }
  return "review";
}

export default function PracticeView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  // The feed spans a workspace and its children, so a parent workspace scrolls
  // everything beneath it rather than only its own directly-attached cards.
  const feedWorkspaceIds = useMemo(
    () => (activeWorkspaceId ? [activeWorkspaceId] : []),
    [activeWorkspaceId],
  );
  const practiceMode = useMemo(() => parseInitialPracticeMode(searchParams.get("tab")), [searchParams]);

  // A `concept` param narrows review to one concept's cards — this is how the
  // dashboard's "what to learn next" panel starts a focused session.
  const reviewConceptId = useMemo(() => searchParams.get("concept") ?? undefined, [searchParams]);

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
        <button
          onClick={() => setMode("feed")}
          className={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
            practiceMode === "feed"
              ? "border-[var(--accent-color)] bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)]"
              : "border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]"
          }`}
        >
          Boom Scroll
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <Suspense fallback={<div className="p-4 text-sm text-[var(--text-muted)]">Loading…</div>}>
          {practiceMode === "review" && <ReviewPane conceptId={reviewConceptId} />}
          {practiceMode === "quiz" && (
            <QuizzesPane
              hideSidebar
              initialTopicId={initialQuizTopic}
              initialKind={initialQuizKind}
            />
          )}
          {practiceMode === "feed" && (
            <FeedPane workspaceIds={feedWorkspaceIds} includeDescendants />
          )}
        </Suspense>
      </div>
    </div>
  );
}
