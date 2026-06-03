import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Eye,
  EyeOff,
  MessageSquare,
  Network,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import {
  api,
  type DashboardLayout,
  type DashboardLayoutSection,
  type DashboardRoute,
  type DashboardSummary,
} from "../lib/api";
import { useScopedWorkspace, useBubbleUpFlag } from "../lib/workspacePane";
import { useWorkspaceStore } from "../stores/workspaceStore";

function useResponsiveLimit(narrow: number, wide: number, ultrawide: number) {
  const [limit, setLimit] = useState(() => {
    if (typeof window === "undefined") { return narrow; }
    const w = window.innerWidth;
    return w >= 1792 ? ultrawide : w >= 1280 ? wide : narrow;
  });
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      setLimit(w >= 1792 ? ultrawide : w >= 1280 ? wide : narrow);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [narrow, wide, ultrawide]);
  return limit;
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

type MetricDashVariant = "dot" | "bar" | "none";

const METRIC_DASH_VARIANT: MetricDashVariant = "bar";

function MetricCard({
  label,
  value,
  accent,
  dashVariant = METRIC_DASH_VARIANT,
}: {
  label: string;
  value: string | number;
  accent: string;
  dashVariant?: MetricDashVariant;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3">
      {dashVariant === "dot" && <div className={`mb-2 h-1.5 w-1.5 rounded-full ${accent}`} />}
      {dashVariant === "bar" && <div className={`mb-2 h-0.5 w-6 rounded-full ${accent}`} />}
      {dashVariant === "none" && <div className="mb-2 h-0.5 w-6" aria-hidden />}
      <div className="text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
      <div className="mt-0.5 text-xs text-[var(--text-muted)]">{label}</div>
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
    <section className="flex flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
      <div className="mb-3">
        {eyebrow && (
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {eyebrow}
          </div>
        )}
        <h2 className="mt-0.5 text-base font-semibold text-[var(--text-primary)]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function routeState(route: DashboardRoute) {
  return route.state ?? undefined;
}

function normalizeKnowledgeRoute(route: DashboardRoute): DashboardRoute {
  if (route.path === "/graph" || route.path === "/flashcards" || route.path === "/backlinks" || route.path === "/dedup") {
    return { path: "/graph", state: null };
  }

  return route;
}

const LEARNING_ACTIVITY_SECTION_ID = "learning_activity";
const LEGACY_ACTIVITY_SECTION_IDS = new Set(["continue_learning", "recent_activity"]);
// Sections retired when the AI-scored panels were removed. The renderer drops
// any layout entry with these ids so old persisted layouts don't carry phantom
// slots forward.
const RETIRED_SECTION_IDS = new Set([
  "quiz_topics",
  "goals",
  "suggestions",
  "weak_concepts",
  "knowledge_health",
]);

function normalizeDashboardLayout(layout: DashboardLayout): DashboardLayout {
  const legacySections = layout.sections.filter((section) => LEGACY_ACTIVITY_SECTION_IDS.has(section.id));
  const legacyHidden = legacySections.length > 1
    ? legacySections.every((section) => section.hidden)
    : legacySections[0]?.hidden ?? false;
  let insertedLearningActivity = false;
  const sections: DashboardLayoutSection[] = [];

  for (const section of layout.sections) {
    if (LEGACY_ACTIVITY_SECTION_IDS.has(section.id)) {
      if (!insertedLearningActivity) {
        sections.push({ id: LEARNING_ACTIVITY_SECTION_ID, hidden: legacyHidden });
        insertedLearningActivity = true;
      }
      continue;
    }

    if (section.id === LEARNING_ACTIVITY_SECTION_ID) {
      if (!insertedLearningActivity) {
        sections.push(section);
        insertedLearningActivity = true;
      }
      continue;
    }

    if (RETIRED_SECTION_IDS.has(section.id)) { continue; }

    sections.push(section);
  }

  return { ...layout, sections };
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
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [editMode, setEditMode] = useState(false);

  function handleSearchSubmit() {
    navigate("/chat", {
      state: {
        createNewChat: true,
        searchQuery: searchQuery.trim(),
      },
    });
  }

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );

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

  useEffect(() => {
    if (!activeWorkspaceId) { setLayout(null); return; }
    let cancelled = false;
    api.dashboard
      .getLayout(activeWorkspaceId)
      .then((next) => { if (!cancelled) { setLayout(normalizeDashboardLayout(next)); } })
      .catch(() => { /* non-fatal — falls back to default below */ });
    return () => { cancelled = true; };
  }, [activeWorkspaceId]);

  const persistLayout = (next: DashboardLayout) => {
    const normalized = normalizeDashboardLayout(next);
    setLayout(normalized);
    if (activeWorkspaceId) {
      void api.dashboard.setLayout(activeWorkspaceId, normalized).catch(() => { /* swallow */ });
    }
  };

  const moveSection = (id: string, dir: -1 | 1) => {
    if (!layout) { return; }
    const idx = layout.sections.findIndex((s) => s.id === id);
    if (idx < 0) { return; }
    const target = idx + dir;
    if (target < 0 || target >= layout.sections.length) { return; }
    const next = { ...layout, sections: layout.sections.slice() };
    [next.sections[idx], next.sections[target]] = [next.sections[target], next.sections[idx]];
    persistLayout(next);
  };

  const toggleSectionHidden = (id: string) => {
    if (!layout) { return; }
    const next = {
      ...layout,
      sections: layout.sections.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s)),
    };
    persistLayout(next);
  };

  const resetLayout = async () => {
    if (!activeWorkspaceId) { return; }
    try {
      const next = await api.dashboard.resetLayout(activeWorkspaceId);
      setLayout(normalizeDashboardLayout(next));
    } catch { /* swallow */ }
  };

  const activityLimit = useResponsiveLimit(5, 10, 15);

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
            Pick a workspace to see your learning overview and recent activity.
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

  const effectiveSummary = summary;
  if (!effectiveSummary) { return null; }

  const visibleContinueThreads = effectiveSummary.continue_learning.slice(0, activityLimit);

  return (
    <div className="h-full overflow-y-auto">
      <div className="app-container flex flex-col gap-4 py-4">
        <header className="rounded-2xl border border-[var(--border-color)] bg-[linear-gradient(135deg,rgba(var(--accent-color-rgb),0.12),rgba(255,255,255,0)_50%),var(--bg-elevated)] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Dashboard
              </div>
              <h1 className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
                {effectiveSummary.workspace_name || workspace?.name || "Learning workspace"}
              </h1>
              {workspace?.description && (
                <p className="mt-1.5 max-w-2xl text-sm leading-5 text-[var(--text-secondary)]">
                  {workspace.description}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 focus-within:border-[var(--accent-color)] transition-colors">
                <Search size={15} className="text-[var(--text-muted)]" />
                <input
                  id="dashboard-search-input"
                  type="text"
                  placeholder="Search or ask anything..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSearchSubmit();
                    }
                  }}
                  className="bg-transparent text-sm text-[var(--text-primary)] outline-none w-48 sm:w-64 placeholder-[var(--text-muted)]"
                />
              </div>
              <button
                id="dashboard-search-button"
                onClick={handleSearchSubmit}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-color)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Search
              </button>
              <button
                id="dashboard-review-button"
                onClick={() => navigate("/learning?tab=practice")}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)]"
              >
                <Clock3 size={15} />
                Review
              </button>
              <button
                type="button"
                onClick={() => navigate("/learning?tab=map")}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)]"
                title="View Topic Map"
              >
                <Network size={15} />
                View Topic Map
              </button>
              <button
                type="button"
                onClick={() => setEditMode((v) => !v)}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                  editMode
                    ? "border-[var(--accent-color)] bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)]"
                    : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:border-[var(--accent-color)]"
                }`}
                title="Customize dashboard layout"
              >
                {editMode ? <X size={15} /> : <Settings2 size={15} />}
                {editMode ? "Done" : "Customize"}
              </button>
              {editMode && (
                <button
                  type="button"
                  onClick={() => { void resetLayout(); }}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--accent-color)]"
                  title="Reset to default order"
                >
                  <RotateCcw size={14} />
                  Reset
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <MetricCard label="Due Review" value={effectiveSummary.review.topics_due_for_review} accent="bg-[var(--accent-color)]" />
          <MetricCard label="Active Goals" value={effectiveSummary.overview.active_goals} accent="bg-[var(--accent-color)]" />
          <MetricCard label="Topics" value={effectiveSummary.overview.concepts} accent="bg-[var(--accent-color)]" />
          <MetricCard label="Sources" value={effectiveSummary.overview.sources} accent="bg-[var(--accent-color)]" />
          <MetricCard label="Completed Goals" value={effectiveSummary.overview.completed_goals} accent="bg-emerald-400" />
        </div>

        {(() => {
          const renderers: Record<string, { title: string; available: boolean; render: () => ReactNode }> = {
            learning_activity: {
              title: "Continue Learning",
              available: true,
              render: () => (
            <Section title="Continue Learning">
              {visibleContinueThreads.length > 0 ? (
                <div className="space-y-1">
                  {visibleContinueThreads.map((item) => (
                    <button
                      key={item.session_id}
                      onClick={() => openRoute(item.route)}
                      className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--bg-primary)] focus-visible:bg-[var(--bg-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-color)]"
                    >
                      <MessageSquare size={13} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                              {item.title}
                            </div>
                            <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                              {item.folder_name ? `${item.folder_name} · ` : ""}{timeAgo(item.updated_at)}
                            </div>
                          </div>
                          <ArrowRight
                            size={15}
                            className="mt-0.5 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent-color)]"
                          />
                        </div>
                        {item.last_snippet ? (
                          <div className="max-h-0 overflow-hidden opacity-0 transition-all duration-150 group-hover:max-h-24 group-hover:opacity-100 group-focus-visible:max-h-24 group-focus-visible:opacity-100">
                            <div className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">
                              {item.last_snippet}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </button>
                  ))}
                  <button
                    onClick={() => navigate("/history")}
                    className="mt-2 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
                  >
                    View all
                    <ArrowRight size={11} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-[var(--text-secondary)]">
                    Nothing to resume yet.
                  </div>
                  <button
                    onClick={() => navigate("/chat")}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--accent-color)]"
                  >
                    <Search size={12} />
                    Open chat
                  </button>
                </div>
              )}
            </Section>
              ),
            },
          };

          const order = (layout?.sections ?? []).filter((s) => renderers[s.id]);
          const missing = Object.keys(renderers).filter((id) => !order.some((s) => s.id === id));
          const fullOrder: DashboardLayoutSection[] = [
            ...order,
            ...missing.map((id) => ({ id, hidden: false })),
          ];

          const visible = fullOrder.filter((s) => !s.hidden && renderers[s.id].available);
          const hidden = fullOrder.filter((s) => s.hidden || !renderers[s.id].available);

          const cols: DashboardLayoutSection[][] = [[], [], []];
          visible.forEach((s, i) => { cols[i % 3].push(s); });

          const renderSlot = (s: DashboardLayoutSection) => {
            const entry = renderers[s.id];
            const isHidden = s.hidden || !entry.available;
            return (
              <div key={s.id} className="relative">
                {editMode && (
                  <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] px-1 py-0.5 shadow-sm">
                    <button
                      type="button"
                      onClick={() => moveSection(s.id, -1)}
                      disabled={fullOrder.indexOf(s) === 0}
                      title="Move up"
                      className="rounded-full p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--accent-color)] disabled:opacity-30"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSection(s.id, 1)}
                      disabled={fullOrder.indexOf(s) === fullOrder.length - 1}
                      title="Move down"
                      className="rounded-full p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--accent-color)] disabled:opacity-30"
                    >
                      <ChevronDown size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleSectionHidden(s.id)}
                      title={isHidden ? "Show" : "Hide"}
                      className="rounded-full p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--accent-color)]"
                    >
                      {isHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                  </div>
                )}
                {entry.available ? entry.render() : (
                  <Section title={entry.title}>
                    <div className="text-xs text-[var(--text-muted)]">Nothing to show right now.</div>
                  </Section>
                )}
              </div>
            );
          };

          return (
            <>
              <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                {cols.map((colSections, ci) => (
                  <div key={ci} className="flex flex-col gap-4">
                    {colSections.map((s) => renderSlot(s))}
                  </div>
                ))}
              </div>
              {editMode && hidden.length > 0 && (
                <div className="mt-2 rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-elevated)]/60 p-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    Hidden sections
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {hidden.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/70 px-3 py-2">
                        <div className="text-xs text-[var(--text-secondary)]">{renderers[s.id].title}</div>
                        <button
                          type="button"
                          onClick={() => toggleSectionHidden(s.id)}
                          disabled={!renderers[s.id].available}
                          title={renderers[s.id].available ? "Show" : "No data yet"}
                          className="rounded-full p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--accent-color)] disabled:opacity-30"
                        >
                          <Eye size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}

        <footer className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <BarChart2 size={15} className="text-[var(--text-muted)]" />
          <span>{effectiveSummary.overview.chat_sessions} learning thread{effectiveSummary.overview.chat_sessions === 1 ? "" : "s"}</span>
          <span className="text-[var(--text-muted)]">•</span>
          <span>{effectiveSummary.overview.notes} note{effectiveSummary.overview.notes === 1 ? "" : "s"}</span>
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
