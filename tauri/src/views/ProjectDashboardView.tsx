/**
 * ProjectDashboardView — full analytics dashboard.
 * Mirrors ProjectDashboardView.swift: header, time range, metrics,
 * activity heatmap, topic cloud, concept-growth + accuracy charts,
 * recent activity, deduplication, AI insights.
 */
import { useEffect, useMemo, useState } from "react";
import {
  FileText, MessageSquare, CreditCard, Network, Lightbulb,
  Sparkles, Clock, Copy, Brain, RefreshCw, BarChart2, Cpu,
} from "lucide-react";
import {
  api,
  type ProjectNote, type ReviewStats, type GraphStatistics, type ConceptNode, type AiModel,
} from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useChatStore } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useNavigate } from "react-router-dom";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProjectStats {
  note_count: number; document_count: number;
  chat_session_count: number; flashcard_count: number; web_capture_count: number;
}

type TimeRange = "Week" | "Month" | "Quarter";
const TIME_RANGES: TimeRange[] = ["Week", "Month", "Quarter"];
const RANGE_DAYS: Record<TimeRange, number> = { Week: 7, Month: 30, Quarter: 90 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Seeded pseudo-random for mock data (deterministic per date string) */
function mockRng(seed: string, scale = 10): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % (scale + 1);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  label, value, icon: _Icon, color: _color, sub,
}: {
  label: string; value: string | number; icon: React.ElementType; color: string; sub?: string;
}) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1.5 bg-[var(--bg-elevated)] border border-[var(--border-color)]">
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-color)' }} />
      <div className="text-3xl font-bold text-[var(--text-primary)] leading-none">{value}</div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      {sub && <div className="text-[10px] text-[var(--text-muted)] opacity-70">{sub}</div>}
    </div>
  );
}

function ActivityHeatmap({ days, activityMap }: { days: number; activityMap: Record<string, number> }) {
  const cells = useMemo(() => {
    const result: { key: string; count: number }[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = dateKey(d);
      result.push({ key, count: activityMap[key] ?? 0 });
    }
    return result;
  }, [days, activityMap]);

  const max = Math.max(1, ...cells.map((c) => c.count));

  function cellStyle(count: number): { className: string; style?: React.CSSProperties } {
    if (count === 0) return { className: "bg-[var(--bg-primary)] border border-[var(--border-color)]" };
    const pct = count / max;
    const opacity = pct > 0.75 ? 1 : pct > 0.5 ? 0.75 : pct > 0.25 ? 0.5 : 0.3;
    return { className: "", style: { backgroundColor: 'var(--accent-color)', opacity } };
  }

  const cols = Math.min(days, 7);
  return (
    <div className="rounded-xl p-4 bg-[var(--bg-elevated)] border border-[var(--border-color)]">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Activity Heatmap</h3>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {cells.map(({ key, count }) => (
          <div
            key={key}
            title={`${key}: ${count} activities`}
            className={`aspect-square rounded-sm ${cellStyle(count).className}`}
            style={cellStyle(count).style}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        <span className="text-[10px] text-[var(--text-muted)]">Less</span>
        {[0, 0.3, 0.5, 0.75, 1].map((p) => (
          <div
            key={p}
            className="w-3 h-3 rounded-sm"
            style={{ background: p === 0 ? "var(--bg-primary)" : 'var(--accent-color)', opacity: p === 0 ? 1 : p }}
          />
        ))}
        <span className="text-[10px] text-[var(--text-muted)]">More</span>
      </div>
    </div>
  );
}

const CLOUD_COLORS = [
  "text-blue-400", "text-purple-400", "text-orange-400", "text-green-400",
  "text-pink-400", "text-cyan-400", "text-indigo-400", "text-teal-400",
];
const CLOUD_BG = [
  "bg-blue-400/10", "bg-purple-400/10", "bg-orange-400/10", "bg-green-400/10",
  "bg-pink-400/10", "bg-cyan-400/10", "bg-indigo-400/10", "bg-teal-400/10",
];

function TopicCloud({
  topics, loading, error, onRefresh,
}: {
  topics: { topic: string; count: number }[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const max = topics[0]?.count ?? 1;

  function fontSize(count: number) {
    const scale = count / max;
    return 11 + scale * 12; // 11–23px
  }

  return (
    <div className="rounded-xl p-4 bg-[var(--bg-elevated)] border border-[var(--border-color)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Topic Cloud</h3>
          <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-color)]/10 text-[var(--accent-color)]">
            <Sparkles size={9} /> AI
          </span>
        </div>
        <div className="flex items-center gap-2">
          {topics.length > 0 && !loading && (
            <span className="text-[10px] text-[var(--text-muted)]">{topics.length} topics</span>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            title="Refresh topics with AI"
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      {loading ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <RefreshCw size={18} className="animate-spin text-[var(--accent-color)]" />
          <p className="text-xs text-[var(--text-muted)]">AI is analysing your topics…</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <p className="text-xs text-red-400">Could not load topics: {error}</p>
          <button onClick={onRefresh} className="text-[10px] text-[var(--accent-color)] hover:underline">Retry</button>
        </div>
      ) : topics.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <span className="text-2xl opacity-30">☁️</span>
          <p className="text-xs text-[var(--text-muted)]">No topics yet</p>
          <p className="text-[10px] text-[var(--text-muted)] opacity-70">Topics will appear as you chat and take notes</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {topics.slice(0, 40).map(({ topic, count }, i) => (
            <span
              key={topic}
              title={`Relevance weight: ${count}`}
              className={`px-2 py-0.5 rounded-md font-medium ${CLOUD_COLORS[i % CLOUD_COLORS.length]} ${CLOUD_BG[i % CLOUD_BG.length]}`}
              style={{ fontSize: fontSize(count) }}
            >
              {topic}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ConceptGrowthChart({ growthData }: { growthData: { day: number; count: number }[] }) {
  const W = 280, H = 100, PAD = 8;
  const maxY = Math.max(1, ...growthData.map((d) => d.count));
  const pts = growthData.map((d, i) => {
    const x = PAD + (i / Math.max(growthData.length - 1, 1)) * (W - 2 * PAD);
    const y = H - PAD - (d.count / maxY) * (H - 2 * PAD);
    return `${x},${y}`;
  });
  const linePts = pts.join(" ");
  const areaD = `M ${pts[0]} L ${pts.join(" L ")} L ${PAD + (W - 2 * PAD)},${H - PAD} L ${PAD},${H - PAD} Z`;

  return (
    <div className="flex-1 rounded-xl p-4 bg-[var(--bg-elevated)] border border-[var(--border-color)]">
      <h3 className="text-xs font-semibold text-[var(--text-primary)] mb-2">Concept Growth</h3>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        <defs>
          <linearGradient id="cgGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(96,165,250)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="rgb(96,165,250)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#cgGrad)" />
        <polyline points={linePts} fill="none" stroke="rgb(96,165,250)" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function AccuracyChart({ accuracyData }: { accuracyData: { day: number; accuracy: number }[] }) {
  const W = 280, H = 100, PAD = 8;
  const barW = (W - 2 * PAD) / Math.max(accuracyData.length, 1) - 2;

  return (
    <div className="flex-1 rounded-xl p-4 bg-[var(--bg-elevated)] border border-[var(--border-color)]">
      <h3 className="text-xs font-semibold text-[var(--text-primary)] mb-2">Review Accuracy</h3>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
        {accuracyData.map((d, i) => {
          const barH = (d.accuracy / 100) * (H - 2 * PAD);
          const x = PAD + i * ((W - 2 * PAD) / accuracyData.length);
          const y = H - PAD - barH;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx="2"
              fill="rgb(167,139,250)"
              opacity="0.8"
            />
          );
        })}
      </svg>
    </div>
  );
}

function InsightCard({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-400/5 border border-amber-400/20">
      <Lightbulb size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{text}</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProjectDashboardView() {
  const { activeWorkspaceId, activeProjectId, projects, workspaces } = useWorkspaceStore();
  const { sessions } = useChatStore();
  const { preferredModel, ollamaUrl } = useSettingsStore();
  const navigate = useNavigate();

  const project = projects.find((p) => p.id === activeProjectId);
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const [timeRange, setTimeRange] = useState<TimeRange>("Week");
  const [projectStats, setProjectStats] = useState<ProjectStats | null>(null);
  const [reviewStats, setReviewStats] = useState<ReviewStats | null>(null);
  const [graphStats, setGraphStats] = useState<GraphStatistics | null>(null);
  const [recentNotes, setRecentNotes] = useState<ProjectNote[]>([]);
  const [concepts, setConcepts] = useState<ConceptNode[]>([]);

  // AI-powered topic cloud
  const [aiTopics, setAiTopics] = useState<{ topic: string; count: number }[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);

  // AI Usage Dashboard
  const [tokenByDate, setTokenByDate] = useState<{ day: string; total_tokens: number }[]>([]);
  const [aiModels, setAiModels] = useState<AiModel[]>([]);

  useEffect(() => {
    if (!activeProjectId) return;
    api.project.getStats(activeProjectId).then(setProjectStats).catch(() => {});
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    api.flashcard.getStats(activeWorkspaceId).then(setReviewStats).catch(() => {});
    api.graph.getStats(activeWorkspaceId).then(setGraphStats).catch(() => {});
    api.graph.listConcepts(activeWorkspaceId).then(setConcepts).catch(() => {});
    api.note.list(activeWorkspaceId).then((notes) => {
      setRecentNotes(
        [...notes].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      );
    }).catch(() => {});
    // AI usage data
    api.chat.getTokenUsageByDate(activeWorkspaceId, 90).then(setTokenByDate).catch(() => {});
    api.aiModel.list().then(setAiModels).catch(() => {});
  }, [activeWorkspaceId]);

  // Fetch AI topics whenever sessions or notes change (debounced by dependency)
  const fetchAiTopics = async () => {
    const model = preferredModel;
    if (!model) { setTopicsError("No model selected"); return; }
    const texts = [
      ...sessions.map((s) => s.title).filter(Boolean),
      ...recentNotes.map((n) => n.title).filter(Boolean),
      ...concepts.map((c) => c.name).filter(Boolean),
    ];
    if (texts.length === 0) return;
    setTopicsLoading(true);
    setTopicsError(null);
    try {
      const result = await api.ollama.extractTopics(texts, model, ollamaUrl || undefined);
      setAiTopics(result.map((t) => ({ topic: t.topic, count: t.weight })));
    } catch (e: unknown) {
      setTopicsError(e instanceof Error ? e.message : String(e));
    } finally {
      setTopicsLoading(false);
    }
  };

  // Auto-fetch topics once sessions + notes are loaded
  useEffect(() => {
    if (sessions.length === 0 && recentNotes.length === 0) return;
    if (aiTopics.length > 0) return; // already loaded, refresh is manual
    fetchAiTopics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length, recentNotes.length]);

  const days = RANGE_DAYS[timeRange];

  // ── Activity map: count notes, concepts, chats by created_at date ─────────
  const activityMap = useMemo(() => {
    const map: Record<string, number> = {};
    const bump = (iso: string) => {
      const k = iso.slice(0, 10);
      map[k] = (map[k] ?? 0) + 1;
    };
    recentNotes.forEach((n) => bump(n.created_at));
    concepts.forEach((c) => bump(c.created_at));
    sessions.forEach((s) => bump(s.created_at));
    return map;
  }, [recentNotes, concepts, sessions]);

  // ── Topic cloud fed by AI (aiTopics state replaces the useMemo word-split) ─
  const topics = aiTopics;

  // ── Mock growth data (same approach as Swift: cumulative random) ──────────
  const growthData = useMemo(() => {
    let cum = Math.max(0, (graphStats?.total_concepts ?? 0) - 30 * 2);
    return Array.from({ length: 30 }, (_, i) => {
      const key = `growth-${activeWorkspaceId}-${i}`;
      cum += mockRng(key, 2);
      return { day: i, count: cum };
    });
  }, [graphStats, activeWorkspaceId]);

  // ── Mock accuracy data (7 bars) ───────────────────────────────────────────
  const accuracyData = useMemo(() => {
    const base = reviewStats
      ? Math.round((reviewStats.learned / Math.max(reviewStats.total_cards, 1)) * 100)
      : 75;
    return Array.from({ length: 7 }, (_, i) => {
      const key = `acc-${activeWorkspaceId}-${i}`;
      const jitter = mockRng(key, 20) - 10;
      return { day: i, accuracy: Math.min(100, Math.max(0, base + jitter)) };
    });
  }, [reviewStats, activeWorkspaceId]);

  // ── Recent Activity: notes + concepts + chats merged ─────────────────────
  const recentActivity = useMemo(() => {
    type Entry = { id: string; label: string; kind: "Note" | "Concept" | "Chat"; time: string };
    const items: Entry[] = [
      ...recentNotes.slice(0, 3).map((n) => ({
        id: n.id, label: n.title || "Untitled", kind: "Note" as const, time: n.updated_at,
      })),
      ...concepts
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 3)
        .map((c) => ({ id: c.id, label: c.name, kind: "Concept" as const, time: c.created_at })),
      ...[...sessions]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 3)
        .map((s) => ({ id: s.id, label: s.title || "Untitled chat", kind: "Chat" as const, time: s.updated_at })),
    ];
    return items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 5);
  }, [recentNotes, concepts, sessions]);

  // ── AI Insights ───────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    const out: string[] = [];
    const totalConcepts = graphStats?.total_concepts ?? 0;
    const totalCards = reviewStats?.total_cards ?? 0;
    const accuracy = totalCards > 0
      ? reviewStats!.learned / totalCards
      : 0;
    const dueCards = reviewStats?.due_today ?? 0;
    const density = graphStats?.density ?? 0;

    if (totalConcepts > 20) {
      out.push(`You're building a rich knowledge base with ${totalConcepts} concepts. Consider creating learning paths to organize your learning journey.`);
    }
    if (totalCards > 0 && accuracy < 0.7) {
      out.push(`Your review accuracy is ${Math.round(accuracy * 100)}%. Try spacing out your review sessions for better retention.`);
    } else if (totalCards > 0 && accuracy >= 0.9) {
      out.push(`Excellent retention rate! You're mastering the material with ${Math.round(accuracy * 100)}% accuracy.`);
    }
    // Activity consistency from heatmap (last 7 days)
    const recentCount = Object.entries(activityMap)
      .filter(([k]) => {
        const diff = (Date.now() - new Date(k).getTime()) / 86400000;
        return diff <= 7;
      })
      .reduce((s, [, v]) => s + v, 0);
    if (recentCount > 0) {
      out.push(`You've been active ${recentCount} time${recentCount !== 1 ? "s" : ""} this week. Consistency is key to effective learning!`);
    }
    if (dueCards > 0) {
      out.push(`You have ${dueCards} flashcard${dueCards !== 1 ? "s" : ""} due for review today.`);
    }
    if (totalConcepts > 0 && density < 0.3) {
      out.push(`Only ${Math.round(density * 100)}% of your concepts are linked. Try connecting related concepts to strengthen understanding.`);
    }
    if (out.length === 0) {
      out.push("Keep it up! Your workspace is growing nicely.");
    }
    return out;
  }, [graphStats, reviewStats, activityMap]);

  const kindIcon = (kind: "Note" | "Concept" | "Chat") => {
    if (kind === "Note") return <FileText size={13} className="text-green-400 flex-shrink-0" />;
    if (kind === "Concept") return <Brain size={13} className="text-blue-400 flex-shrink-0" />;
    return <MessageSquare size={13} className="text-purple-400 flex-shrink-0" />;
  };

  const kindRoute = (kind: "Note" | "Concept" | "Chat", id: string) => {
    if (kind === "Chat") return `/chat/${id}`;
    if (kind === "Concept") return "/graph";
    return "/documents";
  };

  // Token usage map for the heatmap (day => tokens)
  const tokenMap = useMemo(() => {
    const map: Record<string, number> = {};
    tokenByDate.forEach(({ day, total_tokens }) => { map[day] = total_tokens; });
    return map;
  }, [tokenByDate]);

  // Total tokens in the selected time range
  const totalTokensInRange = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[timeRange]);
    return tokenByDate
      .filter(({ day }) => new Date(day) >= cutoff)
      .reduce((sum, { total_tokens }) => sum + total_tokens, 0);
  }, [tokenByDate, timeRange]);

  // Messages in the selected time range
  const messagesInRange = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[timeRange]);
    let count = 0;
    sessions.forEach((s) => {
      if (new Date(s.updated_at) >= cutoff) count++;
    });
    return count;
  }, [sessions, timeRange]);

  // Models with token usage > 0
  const modelsWithUsage = useMemo(() => {
    return aiModels
      .filter((m) => m.tokens_used_total > 0)
      .sort((a, b) => b.tokens_used_total - a.tokens_used_total)
      .slice(0, 8);
  }, [aiModels]);

  const maxModelTokens = modelsWithUsage[0]?.tokens_used_total ?? 1;

  const title = project?.name ?? workspace?.name ?? "Dashboard";
  const subtitle = project?.project_description ?? workspace?.name ?? "";

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[var(--text-primary)]">{title}</h1>
              {subtitle && (
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              {workspace?.created_at && (
                <p className="text-[10px] text-[var(--text-muted)]">
                  Created {timeAgo(workspace.created_at)}
                </p>
              )}
              {workspace?.updated_at && (
                <p className="text-[10px] text-[var(--text-muted)]">
                  Updated {timeAgo(workspace.updated_at)}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Time Range ─────────────────────────────────────────────── */}
        <div className="flex gap-1 p-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] w-fit">
          {TIME_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-4 py-1 rounded-md text-xs font-medium transition-colors ${
                timeRange === r
                  ? "bg-[var(--accent-color)] text-white"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        {/* ── Metrics Grid ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            label="Notes"
            value={projectStats?.note_count ?? recentNotes.length}
            icon={FileText}
            color="text-green-400"
          />
          <MetricCard
            label="Concepts"
            value={graphStats?.total_concepts ?? concepts.length}
            icon={Network}
            color="text-blue-400"
            sub={graphStats ? `${graphStats.total_links} links` : undefined}
          />
          <MetricCard
            label="Flashcards"
            value={reviewStats?.total_cards ?? "—"}
            icon={CreditCard}
            color="text-orange-400"
            sub={reviewStats?.due_today ? `${reviewStats.due_today} due today` : undefined}
          />
          <MetricCard
            label="Chats"
            value={projectStats?.chat_session_count ?? sessions.length}
            icon={MessageSquare}
            color="text-purple-400"
          />
        </div>

        {/* ── Activity Heatmap ───────────────────────────────────────── */}
        <ActivityHeatmap days={days} activityMap={activityMap} />

        {/* ── Topic Cloud ────────────────────────────────────────────── */}
        <TopicCloud
          topics={topics}
          loading={topicsLoading}
          error={topicsError}
          onRefresh={fetchAiTopics}
        />

        {/* ── Charts ─────────────────────────────────────────────────── */}
        <div className="flex gap-3">
          <ConceptGrowthChart growthData={growthData} />
          <AccuracyChart accuracyData={accuracyData} />
        </div>

        {/* ── Recent Activity ────────────────────────────────────────── */}
        {recentActivity.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock size={13} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Recent Activity</h2>
            </div>
            <div className="space-y-2">
              {recentActivity.map((item) => (
                <button
                  key={`${item.kind}-${item.id}`}
                  onClick={() => navigate(kindRoute(item.kind, item.id))}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] hover:border-[var(--accent-color)]/40 transition-colors text-left"
                >
                  {kindIcon(item.kind)}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--text-primary)] truncate">{item.label}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{item.kind}</p>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">{timeAgo(item.time)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Deduplication ──────────────────────────────────────────── */}
        <button
          onClick={() => navigate("/dedup")}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] hover:border-[var(--accent-color)]/40 transition-colors text-left"
        >
          <Copy size={14} className="text-[var(--text-muted)]" />
          <span className="flex-1 text-sm text-[var(--text-secondary)]">Find Duplicate Notes</span>
          <span className="text-[var(--text-muted)]">›</span>
        </button>

        {/* ── AI Usage ───────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 size={13} className="text-[var(--accent-color)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">AI Usage</h2>
          </div>

          {/* Summary row */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <MetricCard
              label="Total Sessions"
              value={sessions.length}
              icon={MessageSquare}
              color="text-purple-400"
            />
            <MetricCard
              label={`Sent (${timeRange})`}
              value={messagesInRange}
              icon={MessageSquare}
              color="text-blue-400"
            />
            <MetricCard
              label={`Tokens (${timeRange})`}
              value={totalTokensInRange > 0 ? (totalTokensInRange >= 1000 ? `${(totalTokensInRange / 1000).toFixed(1)}k` : totalTokensInRange) : "—"}
              icon={Cpu}
              color="text-green-400"
            />
          </div>

          {/* Token activity heatmap */}
          {tokenByDate.length > 0 ? (
            <div className="rounded-xl p-4 bg-[var(--bg-elevated)] border border-[var(--border-color)] mb-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Token Activity</h3>
              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${Math.min(days, 7)}, minmax(0, 1fr))` }}
              >
                {(() => {
                  const cells: { key: string; count: number }[] = [];
                  const today = new Date();
                  for (let i = days - 1; i >= 0; i--) {
                    const d = new Date(today);
                    d.setDate(today.getDate() - i);
                    const key = d.toISOString().slice(0, 10);
                    cells.push({ key, count: tokenMap[key] ?? 0 });
                  }
                  const maxTok = Math.max(1, ...cells.map((c) => c.count));
                  return cells.map(({ key, count }) => {
                    const pct = count / maxTok;
                    if (count === 0) {
                      return (
                        <div
                          key={key}
                          title={`${key}: 0 tokens`}
                          className="aspect-square rounded-sm bg-[var(--bg-primary)] border border-[var(--border-color)]"
                        />
                      );
                    }
                    const opacity = pct > 0.75 ? 1 : pct > 0.5 ? 0.75 : pct > 0.25 ? 0.5 : 0.3;
                    return (
                      <div
                        key={key}
                        title={`${key}: ${count.toLocaleString()} tokens`}
                        className="aspect-square rounded-sm"
                        style={{ backgroundColor: 'var(--accent-color)', opacity }}
                      />
                    );
                  });
                })()}
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <span className="text-[10px] text-[var(--text-muted)]">Less</span>
                {[0, 0.3, 0.5, 0.75, 1].map((p) => (
                  <div
                    key={p}
                    className="w-3 h-3 rounded-sm"
                    style={{ background: p === 0 ? "var(--bg-primary)" : 'var(--accent-color)', opacity: p === 0 ? 1 : p }}
                  />
                ))}
                <span className="text-[10px] text-[var(--text-muted)]">More</span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl p-4 bg-[var(--bg-elevated)] border border-[var(--border-color)] mb-4 flex items-center justify-center py-8">
              <p className="text-xs text-[var(--text-muted)]">No token data yet — start chatting to see activity</p>
            </div>
          )}

          {/* Per-model bar chart */}
          {modelsWithUsage.length > 0 && (
            <div className="rounded-xl p-4 bg-[var(--bg-elevated)] border border-[var(--border-color)]">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Token Usage by Model</h3>
              <div className="space-y-2">
                {modelsWithUsage.map((m) => (
                  <div key={m.id}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] text-[var(--text-secondary)] truncate max-w-[160px]">{m.name}</span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {m.tokens_used_total >= 1000
                          ? `${(m.tokens_used_total / 1000).toFixed(1)}k`
                          : m.tokens_used_total}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--bg-primary)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--accent-color)] transition-all"
                        style={{ width: `${(m.tokens_used_total / maxModelTokens) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── AI Insights ────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={13} className="text-amber-400" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">AI Insights</h2>
            </div>
          </div>
          <div className="space-y-2">
            {insights.map((ins, i) => <InsightCard key={i} text={ins} />)}
          </div>
        </div>

      </div>
    </div>
  );
}
