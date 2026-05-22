import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart2,
  CheckCircle2,
  Clock3,
  MessageSquare,
  RefreshCw,
  Search,
  Target,
} from "lucide-react";
import {
  api,
  type DashboardRoute,
  type DashboardSummary,
} from "../lib/api";
import { useScopedWorkspace, useBubbleUpFlag } from "../lib/workspacePane";
import { useWorkspaceStore } from "../stores/workspaceStore";

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) { return "just now"; }
  if (minutes < 60) { return `${minutes}m ago`; }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) { return `${hours}h ago`; }
  return `${Math.floor(hours / 24)}d ago`;
}

function progressLabel(progress: number) {
  return `${Math.round(progress * 100)}%`;
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
      <div className={`mb-3 h-2 w-2 rounded-full ${accent}`} />
      <div className="text-3xl font-semibold text-[var(--text-primary)]">{value}</div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">{label}</div>
    </div>
  );
}

function Section({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-5">
      <div className="mb-4">
        {eyebrow && (
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {eyebrow}
          </div>
        )}
        <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function routeState(route: DashboardRoute) {
  return route.state ?? undefined;
}

function normalizeKnowledgeRoute(route: DashboardRoute): DashboardRoute {
  if (route.path === "/graph" || route.path === "/flashcards" || route.path === "/learning" || route.path === "/backlinks" || route.path === "/dedup") {
    return { path: "/graph", state: null };
  }

  return route;
}


export default function FolderDashboardView() {
  const navigate = useNavigate();
  const { activeWorkspaceId } = useScopedWorkspace();
  const includeDescendants = useBubbleUpFlag();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );
  const continueLearning = summary?.continue_learning ?? null;

  useEffect(() => {
    let cancelled = false;

    if (!activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;

    async function loadSummary() {
      setIsLoading(true);
      setError(null);

      try {
        const nextSummary = await api.dashboard.getSummary(workspaceId, { includeDescendants });
        if (!cancelled) {
          setSummary(nextSummary);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setSummary(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, includeDescendants]);

  function openRoute(route: DashboardRoute) {
    const normalized = normalizeKnowledgeRoute(route);
    navigate(normalized.path, normalized.state ? { state: routeState(normalized) } : undefined);
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
            Pick a workspace to see your learning overview, progression suggestions, and review queue.
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
          Loading your learning overview...
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
            onClick={refreshSummary}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)]"
          >
            <RefreshCw size={14} />
            Try again
          </button>
        </div>
      </div>
    );
  }

  const effectiveSummary = summary;
  if (!effectiveSummary) { return null; }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
        <header className="rounded-[28px] border border-[var(--border-color)] bg-[linear-gradient(135deg,rgba(var(--accent-color-rgb),0.12),rgba(255,255,255,0)_50%),var(--bg-elevated)] p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Dashboard
              </div>
              <h1 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">
                {effectiveSummary.workspace_name || workspace?.name || "Learning workspace"}
              </h1>
              {workspace?.description && (
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
                  {workspace.description}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => navigate("/chat")}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-color)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                <Search size={15} />
                Search
              </button>
              <button
                onClick={() => openRoute(effectiveSummary.review.route)}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)]"
              >
                <Clock3 size={15} />
                Review
              </button>
              {continueLearning && (
                <button
                  onClick={() => openRoute(continueLearning.route)}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)]"
                >
                  <ArrowRight size={15} />
                  Continue
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Due Review" value={effectiveSummary.review.due_today} accent="bg-[var(--accent-color)]" />
          <MetricCard label="Active Goals" value={effectiveSummary.overview.active_goals} accent="bg-[var(--accent-color)]" />
          <MetricCard label="Concepts Tracked" value={effectiveSummary.overview.concepts} accent="bg-[var(--accent-color)]" />
          <MetricCard label="Sources Captured" value={effectiveSummary.overview.sources} accent="bg-[var(--accent-color)]" />
        </div>

        <Section title="Continue Learning" eyebrow="Low Friction">
            {continueLearning ? (
              <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/70 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)]">
                    <MessageSquare size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      {continueLearning.title}
                    </div>
                    <div className="mt-1 text-sm text-[var(--text-secondary)]">
                      {continueLearning.folder_name || "Workspace thread"}
                    </div>
                    <div className="mt-3 text-xs text-[var(--text-muted)]">
                      Last touched {timeAgo(continueLearning.updated_at)}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => openRoute(continueLearning.route)}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)]"
                >
                  Open thread
                  <ArrowRight size={14} />
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-4">
                <div className="text-sm font-medium text-[var(--text-primary)]">Nothing to resume yet</div>
                <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                  Start with search or chat. The dashboard will begin surfacing continuation and review opportunities automatically.
                </div>
                <button
                  onClick={() => navigate("/chat")}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[var(--accent-color)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                >
                  <Search size={14} />
                  Open search
                </button>
              </div>
            )}
          </Section>

        <Section title="Goals In Motion" eyebrow="Progress">
            {effectiveSummary.goals.length > 0 ? (
              <div className="space-y-3">
                {effectiveSummary.goals.map((goal) => (
                  <button
                    key={goal.id}
                    onClick={() => openRoute(goal.route)}
                    className="block w-full rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/70 p-4 text-left transition-colors hover:border-[var(--accent-color)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--text-primary)]">{goal.title}</div>
                        <div className="mt-1 text-xs text-[var(--text-secondary)]">
                          {goal.is_completed ? "Completed" : `Updated ${timeAgo(goal.updated_at)}`}
                          {goal.due_date ? ` • Due ${goal.due_date}` : ""}
                        </div>
                      </div>
                      {goal.is_completed ? (
                        <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
                      ) : (
                        <Target size={16} className="shrink-0 text-[var(--accent-color)]" />
                      )}
                    </div>
                    <div className="mt-3 h-2 rounded-full bg-[var(--bg-sidebar)]">
                      <div
                        className={`h-2 rounded-full ${goal.is_completed ? "bg-emerald-400" : "bg-[var(--accent-color)]"}`}
                        style={{ width: `${Math.max(goal.is_completed ? 100 : goal.progress * 100, 6)}%` }}
                      />
                    </div>
                    <div className="mt-2 text-xs text-[var(--text-muted)]">
                      {goal.is_completed ? "Done" : progressLabel(goal.progress)}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-4">
                <div className="text-sm font-medium text-[var(--text-primary)]">No goals yet</div>
                <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                  Use search naturally first. When you are ready, capture a goal so the dashboard can show momentum and gaps.
                </div>
                <button
                  onClick={() => navigate("/graph")}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)]"
                >
                  <Target size={14} />
                  Open knowledge
                </button>
              </div>
            )}
          </Section>

        <footer className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          <BarChart2 size={15} className="text-[var(--text-muted)]" />
          <span>{effectiveSummary.overview.chat_sessions} learning thread{effectiveSummary.overview.chat_sessions === 1 ? "" : "s"}</span>
          <span className="text-[var(--text-muted)]">•</span>
          <span>{effectiveSummary.overview.notes} note{effectiveSummary.overview.notes === 1 ? "" : "s"}</span>
          <span className="text-[var(--text-muted)]">•</span>
          <span>{effectiveSummary.overview.flashcards} flashcard{effectiveSummary.overview.flashcards === 1 ? "" : "s"}</span>
          {isLoading && (
            <>
              <span className="text-[var(--text-muted)]">•</span>
              <span className="inline-flex items-center gap-2">
                <RefreshCw size={14} className="animate-spin text-[var(--accent-color)]" />
                Refreshing
              </span>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
