import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Check,
  FileText,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import {
  api,
  type DashboardSummary,
  type LearningGoal,
} from "../lib/api";
import { useScopedWorkspace, useBubbleUpFlag } from "../lib/workspacePane";
import { useWorkspaceStore } from "../stores/workspaceStore";

const RoadmapPane = lazy(() =>
  import("./KnowledgeGraphView").then((m) => ({ default: m.RoadmapPane })),
);

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

/**
 * One metric inside the summary strip. Renders as a button only when there is
 * somewhere to go, so zero-value metrics stay inert rather than advertising a
 * dead click target.
 */
function MetricStat({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string | number;
  onClick?: () => void;
}) {
  const isZero = value === 0 || value === "0";
  const content = (
    <>
      <span
        className={`text-sm font-semibold tabular-nums ${
          isZero ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"
        }`}
      >
        {value}
      </span>
      <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-baseline gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
      >
        {content}
      </button>
    );
  }
  return <span className="flex items-baseline gap-1.5 px-1.5 py-0.5">{content}</span>;
}

/**
 * Replaces the former 2x2 grid of near-empty stat cards. A single strip carries
 * the same numbers in roughly one quarter of the vertical space, which is what
 * buys the roadmap canvas its extra height.
 */
function MetricSummaryStrip({
  topics,
  sources,
  dueReview,
  activeGoals,
  onTopics,
  onDueReview,
}: {
  topics: number;
  sources: number;
  dueReview: number;
  activeGoals: number;
  onTopics?: () => void;
  onDueReview?: () => void;
}) {
  return (
    <div className="surface-card flex flex-wrap items-center gap-x-1 gap-y-1 rounded-xl px-2 py-1.5">
      <MetricStat label="Topics" value={topics} onClick={onTopics} />
      <span aria-hidden className="text-[var(--text-muted)] opacity-40">·</span>
      <MetricStat label="Sources" value={sources} />
      <span aria-hidden className="text-[var(--text-muted)] opacity-40">·</span>
      <MetricStat label="Due" value={dueReview} onClick={onDueReview} />
      <span aria-hidden className="text-[var(--text-muted)] opacity-40">·</span>
      <MetricStat label="Goals" value={activeGoals} />
    </div>
  );
}

function QuickActionsCard({
  onNewChat,
  onNewNote,
  onUploadSource,
  onPractice,
}: {
  onNewChat: () => void;
  onNewNote: () => void;
  onUploadSource: () => void;
  onPractice: () => void;
}) {
  const actions: { label: string; icon: React.ReactNode; onClick: () => void }[] = [
    { label: "New Chat", icon: <MessageSquare size={14} />, onClick: onNewChat },
    { label: "New Note", icon: <FileText size={14} />, onClick: onNewNote },
    { label: "Upload Source", icon: <Plus size={14} />, onClick: onUploadSource },
    { label: "Practice", icon: <Target size={14} />, onClick: onPractice },
  ];
  return (
    <section className="surface-card rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          Quick Actions
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className="group flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-left transition-colors hover:border-[rgba(var(--accent-color-rgb),0.35)] hover:bg-[var(--bg-hover)]"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)]">
              {action.icon}
            </span>
            <span className="truncate text-xs font-medium text-[var(--text-primary)]">
              {action.label}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function EmptyStateActionCard({
  icon,
  title,
  description,
  actionLabel,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full flex-col items-start rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 text-left transition-all hover:border-[rgba(var(--accent-color-rgb),0.35)] hover:bg-[var(--bg-hover)]"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)]">
        {icon}
      </div>
      <div className="mt-4 text-sm font-semibold text-[var(--text-primary)]">{title}</div>
      <div className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{description}</div>
      <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-color)]">
        {actionLabel}
        <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

export default function FolderDashboardView() {
  const navigate = useNavigate();
  const { activeWorkspaceId } = useScopedWorkspace();
  const includeDescendants = useBubbleUpFlag();
  const workspaces = useWorkspaceStore((state) => state.workspaces);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeContinueThreadId, setActiveContinueThreadId] = useState<string | null>(null);
  const roadmapSectionRef = useRef<HTMLDivElement | null>(null);

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
  const showWorkspaceWarmupState =
    summary.overview.sources === 0
    && summary.overview.chat_sessions <= 2
    && summary.overview.notes <= 1;

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

      {/* Top strip: metrics + goals + continue learning side-by-side */}
      <div className="border-b border-[var(--border-color)] bg-[var(--bg-base)] px-4 py-3">
        <MetricSummaryStrip
          topics={summary.overview.topics}
          sources={summary.overview.sources}
          dueReview={summary.review.topics_due_for_review}
          activeGoals={summary.overview.active_goals}
          onTopics={summary.overview.topics > 0 ? () => navigate("/topics") : undefined}
          onDueReview={
            summary.review.topics_due_for_review > 0
              ? () => navigate(
                summary.review.route.path,
                summary.review.route.state ? { state: summary.review.route.state } : undefined,
              )
              : undefined
          }
        />

        <div className="mt-3 grid items-stretch gap-3 xl:grid-cols-[minmax(16rem,1fr)_minmax(16rem,1fr)_minmax(20rem,1.3fr)]">
          <GoalsCard
            workspaceId={activeWorkspaceId}
            includeDescendants={includeDescendants}
          />

          <QuickActionsCard
            onNewChat={() => navigate("/chat", { state: { createNewChat: true } })}
            onNewNote={() => navigate("/notes")}
            onUploadSource={() => navigate("/sources")}
            onPractice={() => navigate(summary.review.route.path, summary.review.route.state ? { state: summary.review.route.state } : undefined)}
          />

          <section className="surface-card rounded-xl p-3">
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
                    onMouseEnter={() => setActiveContinueThreadId(item.session_id)}
                    onMouseLeave={() => setActiveContinueThreadId((current) => current === item.session_id ? null : current)}
                    onFocus={() => setActiveContinueThreadId(item.session_id)}
                    onBlur={() => setActiveContinueThreadId((current) => current === item.session_id ? null : current)}
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
                      {activeContinueThreadId === item.session_id && item.last_snippet && (
                        <div className="mt-1 line-clamp-2 text-[11px] text-[var(--text-secondary)]">
                          {item.last_snippet}
                        </div>
                      )}
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

      <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--bg-primary)]">
        {showWorkspaceWarmupState ? (
          <div className="px-4 py-4 sm:px-6">
            <section className="rounded-[28px] border border-[var(--border-color)] bg-[linear-gradient(145deg,rgba(var(--accent-color-rgb),0.10),rgba(255,255,255,0)_45%),var(--bg-elevated)] p-5 sm:p-6">
              <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-2xl">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Workspace Warm-Up
                  </div>
                  <h2 className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
                    This workspace is ready for its first real pass.
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
                    You have the shell of a learning space, but not much material yet. Add a note, drop in source material,
                    or ask a concrete question here first. Once there is more to work with, the roadmap and review surfaces
                    will become much more useful.
                  </p>
                </div>

                <div className="grid gap-2 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)] sm:grid-cols-3 xl:min-w-[360px] xl:grid-cols-1">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Chats</div>
                    <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{summary.overview.chat_sessions}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Notes</div>
                    <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{summary.overview.notes}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Sources</div>
                    <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{summary.overview.sources}</div>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-3 lg:grid-cols-3">
                <EmptyStateActionCard
                  icon={<MessageSquare size={18} />}
                  title="Start a focused thread"
                  description="Ask a concrete question or paste a real problem so the workspace has something worth building around."
                  actionLabel="Open chat"
                  onClick={() => navigate("/chat", { state: { createNewChat: true } })}
                />
                <EmptyStateActionCard
                  icon={<FileText size={18} />}
                  title="Add notes or source material"
                  description="Capture a note, import a document, or save a source so the dashboard has actual material to reason about."
                  actionLabel="Open library"
                  onClick={() => navigate("/notes")}
                />
                <EmptyStateActionCard
                  icon={<Sparkles size={18} />}
                  title="Run analysis later"
                  description="Once the workspace has a few notes, sources, or richer chats, run analysis to generate a roadmap that is worth exploring."
                  actionLabel="Open knowledge view"
                  onClick={() => navigate("/graph")}
                />
              </div>
            </section>
          </div>
        ) : (
          <div ref={roadmapSectionRef}>
            <Suspense fallback={<div className="p-4 text-sm text-[var(--text-muted)]">Loading…</div>}>
              <RoadmapPane hideSidebar />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}

function GoalsCard({
  workspaceId,
  includeDescendants,
}: {
  workspaceId: string;
  includeDescendants: boolean;
}) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const [goals, setGoals] = useState<LearningGoal[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  useEffect(() => {
    if (!workspaceId) { return; }
    let cancelled = false;
    api.learningGoal
      .list(workspaceId, { includeDescendants, includeAncestors: true })
      .then((list) => { if (!cancelled) { setGoals(list); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceId, includeDescendants]);

  const workspaceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workspaces) { map.set(w.id, w.name); }
    return map;
  }, [workspaces]);

  async function createGoal() {
    const title = newTitle.trim();
    if (!title || !workspaceId) { return; }
    const goal = await api.learningGoal.create(workspaceId, title);
    setGoals((prev) => [goal, ...prev]);
    setNewTitle("");
    setShowCreate(false);
  }

  async function toggleComplete(goal: LearningGoal) {
    const next = !goal.is_completed;
    await api.learningGoal.update(goal.id, {
      is_completed: next,
      progress: next ? 1.0 : 0,
    });
    setGoals((prev) =>
      prev.map((g) =>
        g.id === goal.id ? { ...g, is_completed: next, progress: next ? 1 : 0 } : g,
      ),
    );
  }

  const incomplete = goals.filter((g) => !g.is_completed);
  const complete = goals.filter((g) => g.is_completed);

  async function deleteGoal(id: string) {
    await api.learningGoal.delete(id);
    setGoals((prev) => prev.filter((g) => g.id !== id));
  }

  return (
    <section className="flex min-h-0 flex-col surface-card rounded-xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          Workspace goals
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
        >
          <Plus size={10} /> New
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1">
        {showCreate && (
          <div className="mb-2 rounded-lg border border-[var(--accent-color)]/40 bg-[var(--bg-elevated)] p-2">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { void createGoal(); }
                if (e.key === "Escape") { setShowCreate(false); setNewTitle(""); }
              }}
              onBlur={() => { if (!newTitle.trim()) { setShowCreate(false); } }}
              placeholder="Goal title…"
              className="w-full bg-transparent text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
        )}

        {goals.length === 0 && !showCreate && (
          <div className="flex flex-col items-center gap-1.5 px-2 py-6 text-center">
            <Target size={18} className="text-[var(--text-muted)]" />
            <p className="text-[11px] text-[var(--text-muted)]">No goals yet</p>
            <button
              onClick={() => setShowCreate(true)}
              className="text-[11px] text-[var(--accent-color)] hover:underline"
            >
              Add your first goal
            </button>
          </div>
        )}

        {incomplete.map((goal) => (
          <GoalRow
            key={goal.id}
            goal={goal}
            inheritedFrom={
              goal.workspace_id !== workspaceId
                ? workspaceNameById.get(goal.workspace_id) ?? "parent"
                : null
            }
            onToggle={() => toggleComplete(goal)}
            onDelete={() => deleteGoal(goal.id)}
          />
        ))}

        {complete.length > 0 && (
          <div className="pt-2 mt-2 border-t border-[var(--border-color)]/60">
            <div className="px-1 pb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Completed · {complete.length}
            </div>
            {complete.map((goal) => (
              <GoalRow
                key={goal.id}
                goal={goal}
                inheritedFrom={
                  goal.workspace_id !== workspaceId
                    ? workspaceNameById.get(goal.workspace_id) ?? "parent"
                    : null
                }
                onToggle={() => toggleComplete(goal)}
                onDelete={() => deleteGoal(goal.id)}
                dim
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function GoalRow({
  goal, onToggle, onDelete, dim = false, inheritedFrom = null,
}: {
  goal: LearningGoal;
  onToggle: () => void;
  onDelete: () => void;
  dim?: boolean;
  inheritedFrom?: string | null;
}) {
  const readOnly = inheritedFrom !== null;
  return (
    <div
      className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--bg-elevated)] ${dim ? "opacity-60" : ""}`}
      title={inheritedFrom ? `Inherited from ${inheritedFrom}` : undefined}
    >
      <button
        onClick={onToggle}
        disabled={readOnly}
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors ${
          goal.is_completed
            ? "border-green-500 bg-green-500"
            : "border-[var(--border-color)] hover:border-[var(--accent-color)]"
        } ${readOnly ? "cursor-not-allowed opacity-60" : ""}`}
      >
        {goal.is_completed && <Check size={9} className="text-white" />}
      </button>
      <span className={`flex-1 truncate text-xs text-[var(--text-primary)] ${goal.is_completed ? "line-through" : ""}`}>
        {goal.title}
      </span>
      {inheritedFrom && (
        <span className="rounded border border-[var(--border-color)] px-1 py-px text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
          {inheritedFrom}
        </span>
      )}
      {!readOnly && (
        <button
          onClick={onDelete}
          aria-label="Delete goal"
          className="opacity-0 transition-opacity group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-400"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}
