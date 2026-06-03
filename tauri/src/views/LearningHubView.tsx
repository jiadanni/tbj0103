/**
 * LearningHubView — two surfaces under one route.
 *
 * Map: workspace goals across the top, knowledge map below.
 * Practice: user chooses Review (SM-2 flashcards) or Quiz (AI-generated
 * questions); recent sessions appear below.
 *
 * Legacy ?tab values (roadmap / review / goals / quizzes) are normalized into
 * the new two-tab vocabulary so old bookmarks keep working.
 */
import { useEffect, useState, useMemo, lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { Map, ClipboardCheck } from "lucide-react";

const RoadmapPane = lazy(() =>
  import("./KnowledgeGraphView").then((m) => ({ default: m.RoadmapPane })),
);
const ReviewPane = lazy(() =>
  import("./FlashcardReviewView").then((m) => ({ default: m.ReviewPane })),
);
const QuizzesPane = lazy(() =>
  import("./QuizzesPane").then((m) => ({ default: m.QuizzesPane })),
);
const GoalsPane = lazy(() =>
  import("./LearningPathView").then((m) => ({ default: m.GoalsPane })),
);

type HubTab = "map" | "practice";
type PracticeMode = "review" | "quiz";

const TABS: { id: HubTab; label: string; Icon: typeof Map }[] = [
  { id: "map", label: "Map", Icon: Map },
  { id: "practice", label: "Practice", Icon: ClipboardCheck },
];

function parseTab(value: string | null): HubTab {
  if (value === "map" || value === "practice") { return value; }
  // Legacy values from the four-tab hub.
  if (value === "roadmap" || value === "goals") { return "map"; }
  if (value === "review" || value === "quizzes") { return "practice"; }
  return "map";
}

function parseInitialPracticeMode(value: string | null): PracticeMode {
  if (value === "quizzes" || value === "quiz") { return "quiz"; }
  return "review";
}

export default function LearningHubView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);
  const [activeTab, setActiveTab] = useState<HubTab>(initialTab);
  const initialMode = useMemo(
    () => parseInitialPracticeMode(searchParams.get("tab")),
    [searchParams],
  );
  const [practiceMode, setPracticeMode] = useState<PracticeMode>(initialMode);

  // Deep-link payload for the Quizzes pane.
  const initialQuizTopic = useMemo(() => searchParams.get("topic") ?? undefined, [searchParams]);
  const initialQuizKindRaw = useMemo(() => searchParams.get("kind"), [searchParams]);
  const initialQuizKind = initialQuizKindRaw === "pop" || initialQuizKindRaw === "exam"
    ? initialQuizKindRaw
    : undefined;

  // Keep the URL in sync so tabs are bookmarkable.
  useEffect(() => {
    const current = parseTab(searchParams.get("tab"));
    if (current !== activeTab) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", activeTab);
      setSearchParams(next, { replace: true });
    }
  }, [activeTab, searchParams, setSearchParams]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex gap-1.5 overflow-x-auto border-b border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 pt-2">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 whitespace-nowrap px-3.5 py-2.5 text-sm rounded-t-lg border-b-2 transition-colors ${
              activeTab === id
                ? "border-[var(--accent-color)] text-[var(--accent-color)] font-medium"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <Suspense fallback={<div className="p-4 text-sm text-[var(--text-muted)]">Loading…</div>}>
          {activeTab === "map" && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="border-b border-[var(--border-color)] bg-[var(--bg-primary)]/40 px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)] mb-2">
                  Workspace goals
                </div>
                <div className="max-h-44 overflow-y-auto">
                  <GoalsPane />
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <RoadmapPane hideSidebar />
              </div>
            </div>
          )}
          {activeTab === "practice" && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex gap-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/40 px-4 py-3">
                <button
                  onClick={() => setPracticeMode("review")}
                  className={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                    practiceMode === "review"
                      ? "border-[var(--accent-color)] bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)]"
                      : "border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]"
                  }`}
                >
                  Review flashcards
                </button>
                <button
                  onClick={() => setPracticeMode("quiz")}
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
                {practiceMode === "review" && <ReviewPane hideSidebar />}
                {practiceMode === "quiz" && (
                  <QuizzesPane
                    hideSidebar
                    initialTopicId={initialQuizTopic}
                    initialKind={initialQuizKind}
                  />
                )}
              </div>
            </div>
          )}
        </Suspense>
      </div>
    </div>
  );
}
