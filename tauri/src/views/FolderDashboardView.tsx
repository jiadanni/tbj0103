import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ClipboardCheck,
  Map as MapIcon,
  MessageSquare,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  api,
  type DashboardSummary,
} from "../lib/api";
import { useScopedWorkspace, useBubbleUpFlag } from "../lib/workspacePane";
import { useWorkspaceStore } from "../stores/workspaceStore";

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

function parseTab(value: string | null): HubTab {
  if (value === "map" || value === "practice") { return value; }
  if (value === "roadmap" || value === "goals") { return "map"; }
  if (value === "review" || value === "quizzes") { return "practice"; }
  return "map";
}

function parseInitialPracticeMode(value: string | null): PracticeMode {
  if (value === "quizzes" || value === "quiz") { return "quiz"; }
  return "review";
}

function timeAgo(iso: string | undefined | null) {
  if (!iso) { return "recently"; }
  const parsed = new Date(iso).getTime();
  if (isNaN(parsed)) { return "recently"; }
  const diffMs = Date.now() - parsed;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) { return "just now"; }
  if (minutes < 60) { return `${minutes}m ago`; }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) { return `${hours}h ago`; }
  return `${Math.floor(hours / 24)}d ago`;
}

function MetricCard({
  label,
  value,
  accent = "bg-[var(--accent-color)]",
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3">
      <div className={`mb-2 h-0.5 w-6 rounded-full ${accent}`} />
      <div className="text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
      <div className="mt-0.5 text-xs text-[var(--text-muted)]">{label}</div>
    </div>
  );
}

export default function FolderDashboardView() {
  const navigate = useNavigate();
  const { activeWorkspaceId } = useScopedWorkspace();
  const includeDescendants = useBubbleUpFlag();
  const workspaces = useWorkspaceStore((state) => state.workspaces);

  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);
  const [activeTab, setActiveTab] = useState<HubTab>(initialTab);
  const initialMode = useMemo(() => parseInitialPracticeMode(searchParams.get("tab")), [searchParams]);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>(initialMode);

  const initialQuizTopic = useMemo(() => searchParams.get("topic") ?? undefined, [searchParams]);
  const initialQuizKindRaw = useMemo(() => searchParams.get("kind"), [searchParams]);
  const initialQuizKind = initialQuizKindRaw === "pop" || initialQuizKindRaw === "exam"
    ? initialQuizKindRaw
    : undefined;

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );

  useEffect(() => {
    if (!activeWorkspaceId) { return; }
    let cancelled = false;
    const workspaceId = activeWorkspaceId;
    // Defer the loading flips out of the effect body to satisfy the
    // react-hooks/set-state-in-effect rule. The microtask race (no spinner
    // for one tick) is acceptable.
    void Promise.resolve().then(() => {
      if (cancelled) { return; }
      setIsLoading(true);
      setError(null);
    });
    api.dashboard.getSummary(workspaceId, { includeDescendants })
      .then((next) => { if (!cancelled) { setSummary(next); } })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSummary(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => { if (!cancelled) { setIsLoading(false); } });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, includeDescendants]);

  // Keep the URL in sync so tab state is bookmarkable.
  useEffect(() => {
    const current = parseTab(searchParams.get("tab"));
    if (current !== activeTab) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", activeTab);
      setSearchParams(next, { replace: true });
    }
  }, [activeTab, searchParams, setSearchParams]);

  function handleSearchSubmit() {
    navigate("/chat", {
      state: { createNewChat: true, searchQuery: searchQuery.trim() },
    });
  }

  function refreshSummary() {
    if (!activeWorkspaceId) { return; }
    setIsLoading(true);
    setError(null);
    api.dashboard.getSummary(activeWorkspaceId)
      .then(setSummary)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsLoading(false));
  }

  if (!activeWorkspaceId) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-lg rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 text-center">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">No workspace selected</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Pick a workspace to see your learning overview.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading && !summary) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-5 py-4 text-sm text-[var(--text-secondary)]">
          <RefreshCw size={16} className="animate-spin text-[var(--accent-color)]" />
          Loading…
        </div>
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-lg rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Dashboard unavailable</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{error}</p>
          <button
            onClick={() => refreshSummary()}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)]"
          >
            <RefreshCw size={14} />
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!summary) { return null; }

  const continueThreads = summary.continue_learning.slice(0, 4);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header: workspace name + search */}
      <header className="border-b border-[var(--border-color)] bg-[linear-gradient(135deg,rgba(var(--accent-color-rgb),0.10),rgba(255,255,255,0)_50%),var(--bg-elevated)] px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Dashboard
            </div>
            <h1 className="mt-0.5 text-xl font-semibold text-[var(--text-primary)]">
              {summary.workspace_name || workspace?.name || "Learning workspace"}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 focus-within:border-[var(--accent-color)] transition-colors">
              <Search size={14} className="text-[var(--text-muted)]" />
              <input
                id="dashboard-search-input"
                type="text"
                placeholder="Search or ask anything..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { handleSearchSubmit(); } }}
                className="bg-transparent text-sm text-[var(--text-primary)] outline-none w-48 sm:w-64 placeholder-[var(--text-muted)]"
              />
            </div>
            <button
              id="dashboard-search-button"
              onClick={handleSearchSubmit}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-color)] px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Search
            </button>
          </div>
        </div>
      </header>

      {/* Top strip: metric tiles + Continue Learning side-by-side on wide screens */}
      <div className="border-b border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <MetricCard label="Due Review" value={summary.review.topics_due_for_review} />
            <MetricCard label="Active Goals" value={summary.overview.active_goals} />
            <MetricCard label="Topics" value={summary.overview.concepts} />
            <MetricCard label="Sources" value={summary.overview.sources} />
            <MetricCard label="Completed Goals" value={summary.overview.completed_goals} accent="bg-emerald-400" />
          </div>

          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Continue Learning
              </h2>
              <button
                onClick={() => navigate("/history")}
                className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
              >
                All
                <ArrowRight size={11} />
              </button>
            </div>
            {continueThreads.length > 0 ? (
              <div className="space-y-0.5">
                {continueThreads.map((item) => (
                  <button
                    key={item.session_id}
                    onClick={() => navigate(item.route.path, item.route.state ? { state: item.route.state } : undefined)}
                    className="group flex w-full items-start gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--bg-primary)]"
                  >
                    <MessageSquare size={12} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {item.folder_name ? `${item.folder_name} · ` : ""}{timeAgo(item.updated_at)}
                      </div>
                    </div>
                    <ArrowRight size={12} className="mt-0.5 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent-color)]" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xs text-[var(--text-muted)]">Nothing to resume yet.</div>
            )}
          </section>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 pt-2">
        {([
          { id: "map" as const, label: "Map", Icon: MapIcon },
          { id: "practice" as const, label: "Practice", Icon: ClipboardCheck },
        ]).map(({ id, label, Icon }) => (
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

      {/* Tab content fills remaining height */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Suspense fallback={<div className="p-4 text-sm text-[var(--text-muted)]">Loading…</div>}>
          {activeTab === "map" && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="border-b border-[var(--border-color)] bg-[var(--bg-primary)]/40 px-4 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)] mb-1.5">
                  Workspace goals
                </div>
                <div className="max-h-40 overflow-y-auto">
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
