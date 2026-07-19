/**
 * KnowledgeGraphView — workspace knowledge overview.
 * Left rail: AI analysis + concept tools.
 * Main area: overview, suggested actions, graph map, and recent activity.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import SuccessDialog from "../components/SuccessDialog";
import ConfirmDialog from "../components/ConfirmDialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  Clock3,
  Download,
  Info,
  Loader2,
  Maximize2,
  Minimize2,
  Network,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Trash2,
  X,
} from "lucide-react";
import RoadmapGraph, { type RoadmapGraphHandle } from "../components/RoadmapGraph";
import {
  api,
  REFRESH_WORKSPACE_TASK_TYPES,
  type AiModel,
  type AnalysisResult,
  type BackgroundTaskEvent,
  type ChangeProposal,
  type ConceptLink,
  type ConceptNode,
  type DashboardSummary,
  type DescendantAnalysisProgress,
  type LearningCard,
  type RefreshWorkspaceTaskType,
  type WorkspaceAnalysisProgress,
} from "../lib/api";
import { useSettingsStore } from "../stores/settingsStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useScopedWorkspace, useBubbleUpFlag } from "../lib/workspacePane";
import { CompactMenuSelect } from "../components/CompactMenuSelect";
import { groupModelsByFamily } from "../lib/modelFamilyGrouping";
import { resolveModelDisplayName } from "../lib/modelDisplayName";


const TYPE_COLORS: Record<string, string> = {
  person: "#60a5fa",
  place: "#34d399",
  event: "#f472b6",
  topic: "#a78bfa",
  object: "#fb923c",
  theory: "#facc15",
  technology: "#38bdf8",
  definition: "#f87171",
  question: "#fb923c",
  insight: "#4ade80",
  resource: "#94a3b8",
  custom: "#e879f9",
  other: "#94a3b8",
};

type WorkspaceAnalyzableStatus = {
  ready: boolean;
  item_count: number;
  char_count: number;
};

function colorFor(type: string) {
  return TYPE_COLORS[type.toLowerCase()] ?? TYPE_COLORS.other;
}


function Section({
  title,
  eyebrow,
  children,
  collapsed,
  onToggle,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-5 py-4">
      <div className={`flex items-start justify-between ${collapsed ? "" : "mb-3"}`}>
        <div>
          {eyebrow && (
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              {eyebrow}
            </div>
          )}
          <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
        </div>
        {onToggle && (
          <button
            onClick={onToggle}
            className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          >
            <ChevronDown
              size={18}
              className={`transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
            />
          </button>
        )}
      </div>
      {!collapsed && children}
    </section>
  );
}

function SidebarCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] ${className}`}>
      {children}
    </section>
  );
}

function makeDemoAnalysisResult(nodeCount: number, linkCount: number): AnalysisResult {
  return {
    chapters_created: Math.min(1, nodeCount > 0 ? 1 : 0),
    sections_created: Math.min(2, Math.max(1, Math.ceil(nodeCount / 4))),
    concepts_created: Math.max(2, nodeCount),
    links_created: Math.max(2, linkCount),
    concepts_skipped: 0,
  };
}

function makeDemoCards(concept: ConceptNode, workspaceId: string): LearningCard[] {
  const now = new Date().toISOString();
  const description = concept.concept_description.trim() || `${concept.name} matters inside this demo workspace.`;
  const summaryBack = description.length > 140 ? `${description.slice(0, 137)}...` : description;

  return [
    {
      id: `${concept.id}-demo-card-1`,
      workspace_id: workspaceId,
      front: `What is ${concept.name}?`,
      back: summaryBack,
      source_type: "demo",
      source_id: concept.id,
      ease_factor: 2.5,
      interval: 0,
      repetitions: 0,
      next_review_date: now,
      created_at: now,
    },
    {
      id: `${concept.id}-demo-card-2`,
      workspace_id: workspaceId,
      front: `How does ${concept.name} connect to this topic?`,
      back: `Use the map to trace the nearby nodes and explain how ${concept.name} supports the broader topic cluster.`,
      source_type: "demo",
      source_id: concept.id,
      ease_factor: 2.5,
      interval: 0,
      repetitions: 0,
      next_review_date: now,
      created_at: now,
    },
    {
      id: `${concept.id}-demo-card-3`,
      workspace_id: workspaceId,
      front: `Why should you remember ${concept.name}?`,
      back: `It is one of the sample concepts in this demo workspace, so recalling it helps you see how Aetherium turns structured ideas into reviewable study prompts.`,
      source_type: "demo",
      source_id: concept.id,
      ease_factor: 2.5,
      interval: 0,
      repetitions: 0,
      next_review_date: now,
      created_at: now,
    },
  ];
}

export default function KnowledgeGraphView({
  hideSidebar = false,
  selectedConceptId: externalSelectedConceptId = null,
}: { hideSidebar?: boolean; selectedConceptId?: string | null } = {}) {
  const navigate = useNavigate();
  const { activeWorkspaceId } = useScopedWorkspace();
  const includeDescendants = useBubbleUpFlag();
  const { workspaceAnalysisModel, ollamaUrl } = useSettingsStore();
  const isDemoMode = useWorkspaceStore((state) => state.isDemoMode);

  const [nodes, setNodes] = useState<ConceptNode[]>([]);
  const [links, setLinks] = useState<ConceptLink[]>([]);
  const composerMode = useSettingsStore((s) => s.composerMode);
  const modelFamilyLabels = useSettingsStore((s) => s.modelFamilyLabels);
  const customModelFamilies = useSettingsStore((s) => s.customModelFamilies);
  const modelLabels = useSettingsStore((s) => s.modelLabels);

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("knowledge-sections-collapsed") ?? "{}");
    } catch { return {}; }
  });
  const toggleSection = (key: string) => {
    setCollapsedSections(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem("knowledge-sections-collapsed", JSON.stringify(next));
      return next;
    });
  };

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [focusTopic, setFocusTopic] = useState("");
  const defaultAnalysisModel = workspaceAnalysisModel || "";
  const [selectedModel, setSelectedModel] = useState(defaultAnalysisModel);
  const [workspaceModelOverrides, setWorkspaceModelOverrides] = useState<Record<string, string>>({});
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [analyzeResult, setAnalyzeResult] = useState<AnalysisResult | null>(null);
  const [workspaceAnalyzable, setWorkspaceAnalyzable] = useState<WorkspaceAnalyzableStatus | null>(null);
  const [descendantProgress, setDescendantProgress] = useState<DescendantAnalysisProgress | null>(null);
  const [chunkProgress, setChunkProgress] = useState<WorkspaceAnalysisProgress | null>(null);

  // --- Background-job refresh coordinator state ---
  // Per-task status snapshot driven by `background-task` events. Used by the
  // sync-mode progress modal and the async-mode passive refetch.
  type RefreshJobState = "idle" | "queued" | "running" | "completed" | "failed" | "cancelled";
  // The map button runs only the graph-feeding job. The full seven-job
  // workspace refresh lives in Preferences > Data Controls > Run Background
  // Processing Now. The hierarchy tick seeds concept nodes from topic
  // signatures itself, so this single job both creates nodes and links them.
  const GRAPH_REFRESH_TASK_TYPES: RefreshWorkspaceTaskType[] = ["concept_hierarchy"];
  const [refreshJobStatus, setRefreshJobStatus] = useState<Record<RefreshWorkspaceTaskType, RefreshJobState>>(
    () => Object.fromEntries(
      REFRESH_WORKSPACE_TASK_TYPES.map((t) => [t, "idle" as RefreshJobState]),
    ) as Record<RefreshWorkspaceTaskType, RefreshJobState>,
  );
  const [refreshMode, setRefreshMode] = useState<"async" | "sync">("async");
  const [refreshModeMenuOpen, setRefreshModeMenuOpen] = useState(false);
  const [refreshProgressOpen, setRefreshProgressOpen] = useState(false);
  // Tracks task types currently being watched as a result of the user
  // clicking refresh. Events for jobs NOT in this set still update the
  // status map, but they don't drive the post-completion refetch.
  const activeRefreshSetRef = useRef<Set<RefreshWorkspaceTaskType>>(new Set());

  const [conceptSearch, setConceptSearch] = useState("");
  const [selectedConcept, setSelectedConcept] = useState<ConceptNode | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newConceptName, setNewConceptName] = useState("");
  const [newConceptType, setNewConceptType] = useState("topic");

  const [isFullscreen, setIsFullscreen] = useState(false);

  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [proposals, setProposals] = useState<ChangeProposal[]>([]);
  const [upgradeMode, setUpgradeMode] = useState<string>("auto");
  const [supersedeMode, setSupersedeMode] = useState<string>("auto");
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.05);

  // Exit fullscreen on Escape key press
  useEffect(() => {
    if (!isFullscreen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  const roadmapRef = useRef<RoadmapGraphHandle | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const [successDialog, setSuccessDialog] = useState<{ title: string; description: string } | null>(null);
  const [errorDialog, setErrorDialog] = useState<{ title: string; description: string } | null>(null);

  const [conceptCards, setConceptCards] = useState<LearningCard[]>([]);
  const [isGeneratingCards, setIsGeneratingCards] = useState(false);
  const [genCardError, setGenCardError] = useState("");

  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const [graphSearch, setGraphSearch] = useState("");

  const [aiModels, setAiModels] = useState<AiModel[]>([]);
  useEffect(() => {
    api.aiModel.list()
      .then((models) => {
        setAiModels(models);
        const enabled = models.filter((model) => model.enabled).sort((a, b) => a.priority - b.priority);
        if (enabled.length > 0) {
          const ids = enabled.map((model) => model.model_id);
          setAvailableModels(ids);
          return;
        }
        return api.ollama.listModels(ollamaUrl);
      })
      .then((models) => {
        if (!models) { return; }
        if (Array.isArray(models)) {
          const names = (models as { name: string }[]).map((model) => model.name);
          setAvailableModels(names);
        }
      })
      .catch(() => {});
  }, [ollamaUrl]);

  useEffect(() => {
    const workspaceOverride = activeWorkspaceId ? workspaceModelOverrides[activeWorkspaceId] : "";
    const preferredForWorkspace = workspaceOverride || defaultAnalysisModel;
    const nextModel = preferredForWorkspace && availableModels.includes(preferredForWorkspace)
      ? preferredForWorkspace
      : availableModels[0] || "";
    setSelectedModel((current) => current === nextModel ? current : nextModel);
  }, [activeWorkspaceId, availableModels, defaultAnalysisModel, workspaceModelOverrides]);

  const selectAnalysisModel = useCallback((model: string) => {
    setSelectedModel(model);
    if (!activeWorkspaceId) { return; }
    setWorkspaceModelOverrides((prev) => ({
      ...prev,
      [activeWorkspaceId]: model,
    }));
  }, [activeWorkspaceId]);

  const groupedModelOptions = useMemo(() => {
    const rawOptions = availableModels.map((m) => ({
      value: m,
      label: resolveModelDisplayName(m, modelLabels, aiModels),
    }));

    if (composerMode !== "family") {
      return { options: rawOptions, groups: [] };
    }

    return groupModelsByFamily(
      availableModels,
      modelFamilyLabels,
      customModelFamilies,
      modelLabels,
      (id) => resolveModelDisplayName(id, modelLabels, aiModels)
    );
  }, [availableModels, modelLabels, aiModels, composerMode, modelFamilyLabels, customModelFamilies]);

  const loadGraph = useCallback(async () => {
    if (!activeWorkspaceId) {
      setNodes([]);
      setLinks([]);
      return;
    }

    const [nextNodes, nextLinks] = await Promise.all([
      api.graph.listConcepts(activeWorkspaceId, undefined, undefined, { includeDescendants, includeSuperseded }),
      api.graph.listLinks(activeWorkspaceId, undefined, undefined, { includeDescendants }),
    ]);
    setNodes(nextNodes);
    setLinks(nextLinks);
  }, [activeWorkspaceId, includeDescendants, includeSuperseded]);

  const loadSummary = useCallback(async () => {
    if (!activeWorkspaceId) {
      setSummary(null);
      setSummaryError(null);
      return;
    }

    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const nextSummary = await api.dashboard.getSummary(activeWorkspaceId);
      setSummary(nextSummary);
    } catch (error: unknown) {
      setSummaryError(error instanceof Error ? error.message : String(error));
    } finally {
      setSummaryLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setWorkspaceAnalyzable(null);
      return;
    }
    api.knowledge.checkWorkspaceAnalyzable(activeWorkspaceId)
      .then((result) => setWorkspaceAnalyzable(result))
      .catch(() => setWorkspaceAnalyzable(null));
  }, [activeWorkspaceId]);

  const loadProposals = useCallback(async () => {
    if (!activeWorkspaceId) {
      setProposals([]);
      return;
    }
    try {
      const list = await api.graph.listChangeProposals(activeWorkspaceId);
      setProposals(list);
    } catch (err) {
      console.error(err);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadProposals();
  }, [loadProposals]);

  const autoDedupRanFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activeWorkspaceId || !selectedModel || isDemoMode || isAnalyzing) { return; }
    if (nodes.length < 2) { return; }
    const key = `${activeWorkspaceId}::${selectedModel}`;
    if (autoDedupRanFor.current === key) { return; }
    autoDedupRanFor.current = key;
    (async () => {
      try {
        const report = await api.knowledge.dedupWorkspaceConcepts(activeWorkspaceId, selectedModel, { ollamaUrl });
        if (report.merged_chapters + report.merged_sections > 0) {
          await Promise.all([loadGraph(), loadSummary(), loadProposals()]);
        }
      } catch {
        // silent — dedup is best-effort
      }
    })();
  }, [activeWorkspaceId, selectedModel, isDemoMode, isAnalyzing, nodes.length, ollamaUrl, loadGraph, loadSummary, loadProposals]);

  useEffect(() => {
    const unlisten = listen("knowledge-state-reset", () => {
      void loadGraph();
      void loadSummary();
      void loadProposals();
      setSelectedConcept(null);
      setConceptCards([]);
    });
    return () => { unlisten.then(fn => fn()); };
  }, [loadGraph, loadSummary, loadProposals]);

  useEffect(() => {
    if (!activeWorkspaceId) { return; }
    api.graph.getKnowledgeSettings()
      .then((settings) => {
        setUpgradeMode(settings.upgrade_mode);
        setSupersedeMode(settings.supersede_mode);
        setConfidenceThreshold(settings.confidence_threshold);
      })
      .catch((err) => console.error("Failed to load knowledge settings", err));
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!selectedConcept) {
      setConceptCards([]);
      return;
    }

    api.flashcard.listByConcept(selectedConcept.id).then(setConceptCards).catch(() => setConceptCards([]));
  }, [selectedConcept]);

  // Honour an externally-provided concept selection (from the shared
  // LearningHubSidebar). Looks up the node in `nodes` and mirrors it into local
  // state so existing rendering logic (right panel, related cards, etc.) works.
  useEffect(() => {
    if (externalSelectedConceptId === null) {
      // Don't aggressively clear here — user may have an internal selection.
      return;
    }
    const match = nodes.find((n) => n.id === externalSelectedConceptId);
    if (match && match.id !== selectedConcept?.id) {
      setSelectedConcept(match);
    }
  }, [externalSelectedConceptId, nodes, selectedConcept?.id]);

  const hierarchyTree = useMemo(() => {
    const parentOf = new Map(
      links.filter((l) => l.link_type === 'part_of').map((l) => [l.source_id, l.target_id])
    );
    const chapters = nodes.filter((n) => n.hierarchy_level === 'chapter');
    const sections = nodes.filter((n) => n.hierarchy_level === 'section');
    const concepts = nodes.filter((n) => n.hierarchy_level === 'concept');
    return {
      chapters: chapters.map((ch) => ({
        ...ch,
        sections: sections
          .filter((s) => parentOf.get(s.id) === ch.id)
          .map((s) => ({
            ...s,
            concepts: concepts.filter((c) => parentOf.get(c.id) === s.id),
          })),
      })),
      orphans: concepts.filter((c) => !parentOf.has(c.id)),
    };
  }, [nodes, links]);
  // True once at least one real topic group exists (i.e. something other
  // than the flat "Uncategorized" sweep bucket the hierarchy job falls
  // back to for topics it couldn't cluster).
  const hasRealTopicGroups = hierarchyTree.chapters.some(
    (ch) => ch.name.trim().toLowerCase() !== "uncategorized",
  );

  // Listen to background-task events for the seven refresh jobs and trigger
  // a graph/summary/proposals refetch every time a watched job completes.
  // This is what makes the view fill in incrementally after an async refresh.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const handle = await api.listenBackgroundTask((event: BackgroundTaskEvent) => {
        const taskType = event.task_type as RefreshWorkspaceTaskType;
        if (!REFRESH_WORKSPACE_TASK_TYPES.includes(taskType)) { return; }
        // Drop cross-workspace noise (e.g., when the active workspace
        // changes mid-refresh, or a scheduler tick fires for another ws).
        if (event.workspace_id && activeWorkspaceId && event.workspace_id !== activeWorkspaceId) {
          return;
        }
        const next: RefreshJobState = (() => {
          switch (event.status) {
            case "queued": return "queued";
            case "started":
            case "processing": return "running";
            case "completed": return "completed";
            case "failed": return "failed";
            case "cancelled": return "cancelled";
            default: return "idle";
          }
        })();
        setRefreshJobStatus((prev) => prev[taskType] === next ? prev : { ...prev, [taskType]: next });
        // Only async-mode refetch fires on individual completion. Sync mode
        // refetches once at the end inside handleRefresh.
        if (event.status === "completed" && activeRefreshSetRef.current.has(taskType)) {
          void loadGraph();
          void loadSummary();
          void loadProposals();
        }
      });
      if (cancelled) { handle(); return; }
      unlisten = handle;
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (unlisten) { unlisten(); }
    };
  }, [activeWorkspaceId, loadGraph, loadSummary, loadProposals]);

  // Drive the sync-mode progress modal: open it when at least one watched
  // job is non-terminal, close it once all watched jobs settle.
  useEffect(() => {
    if (refreshMode !== "sync") { return; }
    const watched = Array.from(activeRefreshSetRef.current);
    if (watched.length === 0) { return; }
    const anyRunning = watched.some((t) => {
      const state = refreshJobStatus[t];
      return state === "queued" || state === "running";
    });
    if (!anyRunning) {
      // All settled — clear the active set so subsequent unrelated events
      // (scheduler ticks) don't keep the modal open.
      activeRefreshSetRef.current = new Set();
    }
  }, [refreshJobStatus, refreshMode]);

  async function handleRefresh(mode: "async" | "sync" = refreshMode) {
    if (!activeWorkspaceId || isAnalyzing) { return; }
    setIsAnalyzing(true);
    setAnalyzeError("");
    setAnalyzeResult(null);
    setRefreshMode(mode);

    // Reset per-task state for the graph-scoped jobs and mark them active
    // so async-mode event callbacks know to refetch.
    activeRefreshSetRef.current = new Set(GRAPH_REFRESH_TASK_TYPES);
    setRefreshJobStatus(
      Object.fromEntries(
        REFRESH_WORKSPACE_TASK_TYPES.map((t) => [
          t,
          (GRAPH_REFRESH_TASK_TYPES.includes(t) ? "queued" : "idle") as RefreshJobState,
        ]),
      ) as Record<RefreshWorkspaceTaskType, RefreshJobState>,
    );
    if (mode === "sync") {
      setRefreshProgressOpen(true);
    }

    try {
      const result = await api.knowledge.refreshWorkspace(activeWorkspaceId, mode, GRAPH_REFRESH_TASK_TYPES);
      if (result.failed_to_enqueue.length > 0) {
        const failed = result.failed_to_enqueue.map((f) => `${f.task_type}: ${f.error}`).join("; ");
        setAnalyzeError(`Some jobs could not be queued — ${failed}`);
      }
      // In sync mode the backend returned only after all jobs reached a
      // terminal status; do one final refetch to pull everything they wrote.
      // In async mode the per-event listener handles incremental refetches,
      // but we still kick one immediately so already-completed jobs show.
      await Promise.all([loadGraph(), loadSummary(), loadProposals()]);
    } catch (error: unknown) {
      setAnalyzeError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleAnalyze() {
    const demoWithoutModels = isDemoMode && availableModels.length === 0;
    if (!activeWorkspaceId || isAnalyzing || (!selectedModel && !demoWithoutModels)) { return; }

    setIsAnalyzing(true);
    setAnalyzeError("");
    setDescendantProgress(null);
    setChunkProgress(null);
    try {
      if (demoWithoutModels) {
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        setAnalyzeResult(makeDemoAnalysisResult(nodes.length, links.length));
        await Promise.all([loadGraph(), loadSummary()]);
        return;
      }

      if (includeDescendants) {
        // Fan-out: analyze each child workspace sequentially
        const unlisten = await api.knowledge.listenDescendantProgress((event) => {
          setDescendantProgress(event);
        });
        try {
          const results = await api.knowledge.analyzeDescendants(activeWorkspaceId, selectedModel, {
            ollamaUrl,
            focusTopic: focusTopic.trim() || undefined,
          });
          const completed = results.filter((r) => r.status === "completed");
          const totalConcepts = completed.reduce((sum, r) => sum + (r.result?.concepts_created ?? 0), 0);
          const totalLinks = completed.reduce((sum, r) => sum + (r.result?.links_created ?? 0), 0);
          setAnalyzeResult({
            concepts_created: totalConcepts,
            links_created: totalLinks,
            concepts_skipped: completed.reduce((sum, r) => sum + (r.result?.concepts_skipped ?? 0), 0),
            chapters_created: completed.reduce((sum, r) => sum + (r.result?.chapters_created ?? 0), 0),
            sections_created: completed.reduce((sum, r) => sum + (r.result?.sections_created ?? 0), 0),
          });
        } finally {
          unlisten();
          setDescendantProgress(null);
        }
        await Promise.all([loadGraph(), loadSummary(), loadProposals()]);
        return;
      }

      const unlistenChunk = await api.knowledge.listenWorkspaceProgress((event) => {
        setChunkProgress(event);
      });
      try {
        const result = await api.knowledge.analyzeWorkspaceChunked(activeWorkspaceId, selectedModel, {
          ollamaUrl,
          focusTopic: focusTopic.trim() || undefined,
        });
        setAnalyzeResult(result);
      } finally {
        unlistenChunk();
        setChunkProgress(null);
      }
      await Promise.all([loadGraph(), loadSummary(), loadProposals()]);
    } catch (error: unknown) {
      setAnalyzeError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleApplyProposal(id: string) {
    try {
      await api.graph.applyChangeProposal(id);
      void loadProposals();
      void loadGraph();
      void loadSummary();
      setSuccessDialog({
        title: "Proposal applied",
        description: "Successfully applied the recommended concept change.",
      });
    } catch (err) {
      setErrorDialog({
        title: "Failed to apply proposal",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleDismissProposal(id: string) {
    try {
      await api.graph.dismissChangeProposal(id);
      void loadProposals();
    } catch (err) {
      setErrorDialog({
        title: "Failed to dismiss proposal",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleSettingChange(key: string, value: unknown) {
    try {
      await api.settings.updateOne(key, value);
      if (key === "knowledge.upgrade_mode") {
        setUpgradeMode(value as string);
      } else if (key === "knowledge.supersede_mode") {
        setSupersedeMode(value as string);
      } else if (key === "knowledge.confidence_threshold") {
        setConfidenceThreshold(Number(value));
      }
    } catch (err) {
      setErrorDialog({
        title: "Failed to update setting",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function createConcept() {
    if (!activeWorkspaceId || !newConceptName.trim()) { return; }

    const concept = await api.graph.createConcept(activeWorkspaceId, newConceptName.trim(), {
      concept_type: newConceptType,
    } as Partial<ConceptNode>);

    setNodes((previous) => [...previous, concept]);
    setNewConceptName("");
    setShowCreateForm(false);
    void loadSummary();
  }

  async function deleteConcept(id: string) {
    await api.graph.deleteConcept(id);
    setNodes((previous) => previous.filter((node) => node.id !== id));
    setLinks((previous) => previous.filter((link) => link.source_id !== id && link.target_id !== id));
    setSelectedConcept(null);
    void loadSummary();
  }

  async function exportRoadmap(format: "markdown" | "json" | "mermaid" | "csv" | "png" | "pdf") {
    if (!activeWorkspaceId) { return; }
    setExportMenuOpen(false);
    setExportingFormat(format);
    try {
      const ext = format === "markdown" ? "md" : format;
      const filterName =
        format === "markdown" ? "Markdown"
          : format === "json" ? "JSON"
          : format === "mermaid" ? "Mermaid"
          : format === "csv" ? "CSV"
          : format === "png" ? "PNG"
          : "PDF";
      const dest = await save({
        title: `Export roadmap as ${filterName}`,
        defaultPath: `roadmap.${ext}`,
        filters: [{ name: filterName, extensions: [ext] }],
      });
      if (!dest) { return; }

      if (format === "png" || format === "pdf") {
        const snapshot = roadmapRef.current?.getExportableSvg();
        if (!snapshot) {
          setErrorDialog({
            title: "Export failed",
            description: "Roadmap is not ready to export yet.",
          });
          return;
        }
        const bytes = format === "png"
          ? await api.export.roadmap.png(activeWorkspaceId, snapshot.svg, snapshot.width, snapshot.height)
          : await api.export.roadmap.pdf(activeWorkspaceId, snapshot.svg, snapshot.width, snapshot.height);
        await writeFile(dest, new Uint8Array(bytes));
      } else {
        const text = format === "markdown"
          ? await api.export.roadmap.markdown(activeWorkspaceId)
          : format === "json"
            ? await api.export.roadmap.json(activeWorkspaceId)
            : format === "mermaid"
              ? await api.export.roadmap.mermaid(activeWorkspaceId)
              : await api.export.roadmap.csv(activeWorkspaceId);
        await writeTextFile(dest, text);
      }
      setSuccessDialog({
        title: "Export complete",
        description: `Successfully exported roadmap as ${filterName} to ${dest}.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorDialog({
        title: "Export failed",
        description: msg,
      });
    } finally {
      setExportingFormat(null);
    }
  }

  async function generateConceptCards() {
    const demoWithoutModels = isDemoMode && availableModels.length === 0;
    if (!selectedConcept || !activeWorkspaceId || isGeneratingCards || (!selectedModel && !demoWithoutModels)) { return; }

    setIsGeneratingCards(true);
    setGenCardError("");
    try {
      if (demoWithoutModels) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        setConceptCards(makeDemoCards(selectedConcept, activeWorkspaceId));
        return;
      }
      const cards = await api.flashcard.generateFromConcept(activeWorkspaceId, selectedConcept.id, selectedModel, 5, ollamaUrl);
      setConceptCards((previous) => [...cards, ...previous]);
    } catch (error: unknown) {
      setGenCardError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsGeneratingCards(false);
    }
  }

  if (!activeWorkspaceId) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-lg rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 text-center">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">No workspace selected</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Pick a workspace to see its knowledge overview and map.
          </p>
        </div>
      </div>
    );
  }

  const overview = summary?.overview;
  const review = summary?.review;
  const hasModels = availableModels.length > 0;
  const isDemoWithoutModels = isDemoMode && !hasModels;
  const canRunAiActions = hasModels || isDemoWithoutModels;
  const insufficientData = workspaceAnalyzable?.ready === false && !includeDescendants;
  const hasAiInferredGraph = nodes.length > 0 || links.length > 0 || (overview?.topics ?? 0) > 0;
  const estimatedAnalyzeTokens = workspaceAnalyzable
    ? Math.floor(workspaceAnalyzable.char_count / 4)
    : 0;
  const sourceMaterialSummary = workspaceAnalyzable
    ? `${workspaceAnalyzable.item_count} source item${workspaceAnalyzable.item_count === 1 ? "" : "s"}, ${workspaceAnalyzable.char_count.toLocaleString()} characters`
    : "";
  const analyzeTokenTooltip = workspaceAnalyzable && !insufficientData && !isDemoWithoutModels
    ? `~${estimatedAnalyzeTokens.toLocaleString()} tokens (${workspaceAnalyzable.char_count.toLocaleString()} characters)`
    : undefined;
  const analyzeButtonLabel = isAnalyzing
    ? (descendantProgress
      ? `Analyzing ${descendantProgress.workspace_name} (${descendantProgress.index + 1}/${descendantProgress.total})…`
      : chunkProgress
        ? `Analyzing chunk ${chunkProgress.chunk_index + 1}/${chunkProgress.total_chunks} — ${chunkProgress.label}…`
        : "Analyzing...")
    : isDemoWithoutModels ? "Simulate Analysis"
    : includeDescendants ? "Analyze All Sub-Workspaces"
    : "Analyze Workspace";

  // --- Refresh-coordinator button labels (used by the toolbar split button
  // that drives the graph-feeding job, distinct from the sidebar's legacy
  // single-shot Analyze button). The other six workspace jobs run from
  // Preferences > Data Controls > Run Background Processing Now. ---
  const REFRESH_JOB_LABELS: Record<RefreshWorkspaceTaskType, string> = {
    memory_extraction: "Memory extraction",
    workspace_glossary: "Workspace glossary",
    hover_definition_scan: "Hover definitions",
    summarization: "Conversation summaries",
    flashcard_generation: "Flashcards",
    concept_hierarchy: "Topic hierarchy",
    workspace_prompt_bank: "Starter prompts",
  };
  const refreshWatchedTasks = GRAPH_REFRESH_TASK_TYPES;
  const refreshCompletedCount = refreshWatchedTasks.filter(
    (t) => refreshJobStatus[t] === "completed",
  ).length;
  const refreshFailedCount = refreshWatchedTasks.filter(
    (t) => refreshJobStatus[t] === "failed" || refreshJobStatus[t] === "cancelled",
  ).length;
  const refreshRunningCount = refreshWatchedTasks.filter(
    (t) => refreshJobStatus[t] === "queued" || refreshJobStatus[t] === "running",
  ).length;
  const refreshButtonLabel = isAnalyzing
    ? `Refreshing (${refreshCompletedCount + refreshFailedCount}/${refreshWatchedTasks.length})…`
    : "Refresh Knowledge Map";
  const refreshButtonTooltip = `Runs these background jobs for this workspace: ${refreshWatchedTasks
    .map((t) => REFRESH_JOB_LABELS[t])
    .join(", ")}. The map updates as each job completes. For memory, glossary, flashcards, and other workspace jobs, use Preferences > Data Controls > Run Background Processing Now.`;
  // Distinguish "never analyzed" / "not enough material" (info) from "the
  // hierarchy job actually failed" (warning) so an empty map after a refresh
  // doesn't read as silently broken.
  const emptyMapNotice: { kind: "info" | "warning"; message: string } | null = isAnalyzing
    ? null
    : refreshFailedCount > 0
      ? {
          kind: "warning",
          message: "The last refresh didn't finish successfully, so the roadmap couldn't be rebuilt. Open the inference jobs panel for details, then try again.",
        }
      : insufficientData
        ? {
            kind: "info",
            message: `Not enough source material for AI analysis yet${sourceMaterialSummary ? ` (${sourceMaterialSummary})` : ""}. Add more chat, notes, or documents, then analyze.`,
          }
        : refreshCompletedCount > 0
          ? {
              kind: "info",
              message: "The last refresh completed but found no topics to map. Add more source material and try again.",
            }
          : null;
  // "Refresh Knowledge Map" tries to cluster ungrouped topics into new
  // groups from chat/notes/document content, falling back to the flat
  // "Uncategorized" bucket for whatever it couldn't place. If every topic
  // is still uncategorized after a refresh, either there wasn't enough
  // content to work with, or the topics genuinely didn't cluster — refresh
  // again to retry.
  const uncategorizedOnlyNotice = !isAnalyzing && nodes.length > 0 && !hasRealTopicGroups
    ? {
        kind: "info" as const,
        message: insufficientData
          ? `Your topics haven't been grouped yet. There isn't enough chat, notes, or document content in this workspace yet to build groups${sourceMaterialSummary ? ` (${sourceMaterialSummary})` : ""} — add more content, then refresh again.`
          : "Your topics haven't been grouped yet. Refresh again to retry — grouping needs at least two related topics to work with.",
      }
    : null;
  const analyzeHelpText = isDemoWithoutModels
    ? "Demo data is preloaded. No local models are installed on this machine, so AI actions use simulated demo output."
    : insufficientData
      ? hasAiInferredGraph
        ? `This workspace has existing AI-inferred topics, but not enough source material for a fresh analysis${sourceMaterialSummary ? ` (${sourceMaterialSummary})` : ""}. Add source material or reset stale AI-inferred data from Preferences > Data Controls.`
        : `Not enough source material for AI analysis${sourceMaterialSummary ? ` (${sourceMaterialSummary})` : ""}. Add more chat, notes, or documents first.`
      : includeDescendants
        ? "Runs analysis on each sub-workspace sequentially. The merged graph updates as each workspace completes. Yields to active chat."
        : hasModels
          ? "Extract AI-inferred topics and links from the source material you have already read, asked, and captured."
          : "No local AI models are available yet. Install or connect a model to analyze this workspace.";
  const cardHelpText = isDemoWithoutModels
    ? "Demo mode can generate sample flashcards locally for this topic."
    : hasModels
      ? ""
      : "Install a local model to generate flashcards for this topic.";
  const analyzeResultSummary = isDemoWithoutModels
    ? "Demo analysis refreshed the seeded sample content."
    : analyzeResult
      ? `+${analyzeResult.chapters_created} groups, +${analyzeResult.sections_created} subgroups, +${analyzeResult.concepts_created} concepts, +${analyzeResult.links_created} links added`
      : "";
  const modelSelectOptions = availableModels.length === 0
    ? [{ value: "", label: isDemoWithoutModels ? "Demo simulation only" : "No models found" }]
    : groupedModelOptions.options;

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[var(--bg-primary)]">
      {!hideSidebar && (
      <div className="w-72 flex-shrink-0 overflow-y-auto border-r border-[var(--border-color)] bg-[var(--bg-sidebar)]">
        <div className="flex flex-col gap-3 p-3">
          <SidebarCard className="p-3">
            <div className="mb-3 flex items-center gap-1.5">
              <Sparkles size={14} className="text-[var(--accent-color)]" />
              <span className="text-xs font-semibold text-[var(--text-primary)]">AI Analysis</span>
            </div>

            <CompactMenuSelect
              label="AI Model"
              value={selectedModel}
              options={modelSelectOptions}
              groups={groupedModelOptions.groups}
              onChange={selectAnalysisModel}
              widthClassName="mb-2 w-full"
            />

            <input
              value={focusTopic}
              onChange={(event) => setFocusTopic(event.target.value)}
              placeholder="Focus topic (optional)"
              className="mb-2 w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />

            <div className="mb-3 flex flex-col gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Upgrade & Merge Settings
              </div>
              <CompactMenuSelect
                label="Upgrade Mode"
                value={upgradeMode}
                options={[
                  { value: "auto", label: "Auto Apply" },
                  { value: "suggest", label: "Suggest Changes" },
                  { value: "off", label: "Off" },
                ]}
                onChange={(val) => handleSettingChange("knowledge.upgrade_mode", val)}
                widthClassName="w-full text-xs"
              />
              <CompactMenuSelect
                label="Supersede Mode"
                value={supersedeMode}
                options={[
                  { value: "auto", label: "Auto Apply" },
                  { value: "suggest", label: "Suggest Changes" },
                  { value: "off", label: "Off" },
                ]}
                onChange={(val) => handleSettingChange("knowledge.supersede_mode", val)}
                widthClassName="w-full text-xs"
              />
              <div className="flex flex-col gap-1 mt-1">
                <div className="flex justify-between items-center text-[10px] text-[var(--text-secondary)]">
                  <span>Confidence Threshold</span>
                  <span className="font-mono text-[var(--accent-color)]">{confidenceThreshold.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.00"
                  max="0.50"
                  step="0.01"
                  value={confidenceThreshold}
                  onChange={(e) => handleSettingChange("knowledge.confidence_threshold", Number(e.target.value))}
                  className="w-full accent-[var(--accent-color)] h-1 rounded bg-[var(--bg-input)] cursor-pointer"
                />
              </div>
            </div>

            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !canRunAiActions || insufficientData}
              title={analyzeTokenTooltip}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--accent-color)] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAnalyzing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {analyzeButtonLabel}
            </button>

            <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
              {analyzeHelpText}
            </p>

            {analyzeResult && (
              <p className="mt-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 px-2.5 py-2 text-[10px] leading-relaxed text-[var(--text-secondary)]">
                {analyzeResultSummary}
              </p>
            )}
            {analyzeError && (
              <p className="mt-2 break-words text-[10px] text-red-400">{analyzeError}</p>
            )}
          </SidebarCard>

          <SidebarCard className="p-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-2 text-center">
                <div className="text-sm font-semibold text-[var(--text-primary)]">{overview?.topics ?? nodes.length}</div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">Topics</div>
              </div>
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-2 text-center">
                <div className="text-sm font-semibold text-[var(--text-primary)]">{links.length}</div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">Links</div>
              </div>
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-2 text-center">
                <div className="text-sm font-semibold text-[var(--text-primary)]">{review?.topics_due_for_review ?? 0}</div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">Due</div>
              </div>
            </div>
          </SidebarCard>

          <SidebarCard className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Topics</div>
              <button
                onClick={() => setShowCreateForm(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-color)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
              >
                <Plus size={10} />
                Add
              </button>
            </div>
            <div className="relative mb-2">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={conceptSearch}
                onChange={(event) => setConceptSearch(event.target.value)}
                placeholder="Filter topics..."
                className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] py-2 pl-7 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
              />
            </div>
            <div className="mb-3 px-1 flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)] select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSuperseded}
                  onChange={(e) => setIncludeSuperseded(e.target.checked)}
                  className="rounded border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--accent-color)] outline-none cursor-pointer"
                />
                Show Superseded
              </label>
            </div>
            <div className="max-h-[26rem] space-y-0.5 overflow-y-auto pr-1">
            {hierarchyTree.chapters.map((chapter) => {
              const chVisible = !conceptSearch || chapter.name.toLowerCase().includes(conceptSearch.toLowerCase()) ||
                chapter.sections.some((s) => s.name.toLowerCase().includes(conceptSearch.toLowerCase()) ||
                  s.concepts.some((c) => c.name.toLowerCase().includes(conceptSearch.toLowerCase())));
              if (!chVisible) { return null; }
              const chExpanded = expandedChapters.has(chapter.id);
              return (
                <div key={chapter.id}>
                  <button
                    onClick={() => setExpandedChapters((prev) => { const next = new Set(prev); if (chExpanded) { next.delete(chapter.id); } else { next.add(chapter.id); } return next; })}
                    className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  >
                    <ChevronDown size={10} className={`flex-shrink-0 transition-transform ${chExpanded ? '' : '-rotate-90'}`} />
                    <span className="truncate">{chapter.name}</span>
                  </button>
                  {chExpanded && chapter.sections.map((section) => {
                    const secVisible = !conceptSearch || section.name.toLowerCase().includes(conceptSearch.toLowerCase()) ||
                      section.concepts.some((c) => c.name.toLowerCase().includes(conceptSearch.toLowerCase()));
                    if (!secVisible) { return null; }
                    const secExpanded = expandedSections.has(section.id);
                    return (
                      <div key={section.id} className="ml-3">
                        <button
                          onClick={() => setExpandedSections((prev) => { const next = new Set(prev); if (secExpanded) { next.delete(section.id); } else { next.add(section.id); } return next; })}
                          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        >
                          <ChevronDown size={9} className={`flex-shrink-0 transition-transform ${secExpanded ? '' : '-rotate-90'}`} />
                          <span className="truncate">{section.name}</span>
                        </button>
                        {secExpanded && section.concepts
                          .filter((c) => !conceptSearch || c.name.toLowerCase().includes(conceptSearch.toLowerCase()))
                          .map((node) => (
                            <button
                              key={node.id}
                              onClick={() => setSelectedConcept(selectedConcept?.id === node.id ? null : node)}
                              className={`ml-3 flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-xs transition-colors ${
                                selectedConcept?.id === node.id
                                  ? "bg-[var(--accent-color)]/20 text-[var(--accent-color)]"
                                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                              }`}
                            >
                              <span className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: colorFor(node.concept_type) }} />
                              <span className="truncate">{node.name}</span>
                            </button>
                          ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {hierarchyTree.orphans
              .filter((node) => !conceptSearch || node.name.toLowerCase().includes(conceptSearch.toLowerCase()))
              .length > 0 && (
              <div>
                <div className="px-1 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">Uncategorized</div>
                {hierarchyTree.orphans
                  .filter((node) => !conceptSearch || node.name.toLowerCase().includes(conceptSearch.toLowerCase()))
                  .map((node) => (
                    <button
                      key={node.id}
                      onClick={() => setSelectedConcept(selectedConcept?.id === node.id ? null : node)}
                      className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors ${
                        selectedConcept?.id === node.id
                          ? "bg-[var(--accent-color)]/20 text-[var(--accent-color)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <span className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: colorFor(node.concept_type) }} />
                      <span className="truncate">{node.name}</span>
                    </button>
                  ))}
              </div>
            )}
            {hierarchyTree.chapters.length === 0 && hierarchyTree.orphans.length === 0 && (
              <p className="px-2 py-3 text-[10px] text-[var(--text-muted)]">No topics match this filter yet.</p>
            )}
            </div>
          </SidebarCard>

          {selectedConcept && (
            <SidebarCard className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{selectedConcept.name}</span>
                <button onClick={() => setSelectedConcept(null)}>
                  <X size={12} className="text-[var(--text-muted)]" />
                </button>
              </div>
              <span
                className="mb-2 inline-block rounded-full px-2 py-1 text-[10px]"
                style={{ backgroundColor: `${colorFor(selectedConcept.concept_type)}33`, color: colorFor(selectedConcept.concept_type) }}
              >
                {selectedConcept.concept_type}
              </span>
              {selectedConcept.concept_description && (
                <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">{selectedConcept.concept_description}</p>
              )}

              <div className="mb-2 flex items-center gap-2">
                <button
                  onClick={generateConceptCards}
                  disabled={isGeneratingCards || (!selectedModel && !isDemoWithoutModels)}
                  className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] px-2 py-1 text-[10px] text-[var(--accent-color)] transition-colors hover:bg-[var(--accent-color)]/10 disabled:opacity-40"
                >
                  {isGeneratingCards ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                  {isGeneratingCards ? "Generating..." : isDemoWithoutModels ? "Simulate Cards" : "Generate Cards"}
                </button>
                {conceptCards.length > 0 && (
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {conceptCards.length} card{conceptCards.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              {cardHelpText && (
                <p className="mb-2 text-[10px] leading-relaxed text-[var(--text-muted)]">{cardHelpText}</p>
              )}

              {genCardError && (
                <p className="mb-2 text-[10px] leading-tight text-red-400">{genCardError}</p>
              )}

              {conceptCards.length > 0 && (
                <div className="mb-3 max-h-32 space-y-1 overflow-y-auto">
                  {conceptCards.slice(0, 5).map((card) => (
                    <div key={card.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 px-2 py-1.5 text-[10px] text-[var(--text-secondary)]">
                      {card.front}
                    </div>
                  ))}
                  {conceptCards.length > 5 && (
                    <div className="px-1.5 text-[10px] text-[var(--text-muted)]">
                      +{conceptCards.length - 5} more
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => deleteConcept(selectedConcept.id)}
                className="flex items-center gap-1 text-[10px] text-red-400 transition-colors hover:text-red-300"
              >
                <Trash2 size={10} />
                Delete
              </button>
            </SidebarCard>
          )}

          {!selectedConcept && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:bg-[var(--bg-hover)]"
            >
              <Plus size={11} />
              Add Concept
            </button>
          )}
          </div>
      </div>
      )}

      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto">
        <div className={`flex w-full flex-col gap-4 px-4 py-4 sm:px-6 ${hideSidebar ? "" : "mx-auto max-w-[1600px]"}`}>
          <header className="rounded-2xl border border-[var(--border-color)] bg-[linear-gradient(135deg,rgba(var(--accent-color-rgb),0.12),rgba(255,255,255,0)_55%),var(--bg-elevated)] px-5 py-3">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="max-w-2xl">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  Knowledge
                </div>
                <h1 className="text-xl font-semibold text-[var(--text-primary)] sm:text-2xl">
                  Your knowledge at a glance.
                </h1>
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                  Explore your concept map, spot weak areas, and decide what to review or build on next.
                </p>
                {summaryError && (
                  <p className="mt-2 text-sm text-red-400">
                    Overview is temporarily unavailable: {summaryError}
                  </p>
                )}
              </div>

              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-wrap items-end gap-2 xl:justify-end">
                  <div className="relative inline-flex overflow-visible rounded-xl shadow-sm">
                    <button
                      type="button"
                      onClick={() => { void handleRefresh("async"); }}
                      disabled={isAnalyzing || !activeWorkspaceId}
                      title={refreshButtonTooltip}
                      className="inline-flex items-center gap-2 rounded-l-xl border border-r-0 border-[rgba(var(--accent-color-rgb),0.35)] bg-[var(--accent-color)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-color)]/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      {refreshButtonLabel}
                    </button>
                    <button
                      type="button"
                      aria-label="Refresh mode"
                      onClick={() => setRefreshModeMenuOpen((open) => !open)}
                      disabled={isAnalyzing}
                      className="inline-flex self-stretch w-9 items-center justify-center rounded-l-none rounded-r-xl border border-l border-[rgba(var(--accent-color-rgb),0.35)] bg-[var(--accent-color)] text-white hover:bg-[var(--accent-color)]/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ChevronDown size={14} />
                    </button>
                    {refreshModeMenuOpen && (
                      <>
                        {/* Click-outside backdrop */}
                        <button
                          type="button"
                          aria-hidden
                          tabIndex={-1}
                          className="fixed inset-0 z-40 cursor-default bg-transparent"
                          onClick={() => setRefreshModeMenuOpen(false)}
                        />
                        <div
                          role="menu"
                          className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-lg"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setRefreshModeMenuOpen(false);
                              void handleRefresh("async");
                            }}
                            className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-primary)]"
                          >
                            <span className="font-medium">Refresh in background</span>
                            <span className="text-xs text-[var(--text-muted)]">Jobs run asynchronously. The map fills in as each finishes.</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setRefreshModeMenuOpen(false);
                              void handleRefresh("sync");
                            }}
                            className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-primary)]"
                          >
                            <span className="font-medium">Refresh and wait</span>
                            <span className="text-xs text-[var(--text-muted)]">Shows a progress modal and dismisses when every job finishes.</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {analyzeError && (
                  <p className="max-w-xs text-right text-xs text-red-400">{analyzeError}</p>
                )}
                {!analyzeError && refreshFailedCount > 0 && !isAnalyzing && (
                  <p className="max-w-xs text-right text-xs text-amber-400">
                    {refreshFailedCount} job{refreshFailedCount === 1 ? "" : "s"} did not finish — open the inference jobs panel for details.
                  </p>
                )}
                {!analyzeError && refreshCompletedCount > 0 && !isAnalyzing && refreshFailedCount === 0 && (
                  <p className="max-w-xs text-right text-xs text-[var(--text-muted)]">
                    Refreshed {refreshCompletedCount}/{refreshWatchedTasks.length} jobs.
                  </p>
                )}
              </div>
            </div>
          </header>

          {!hideSidebar && (
            <div className="flex flex-wrap gap-2">
              {[
                { icon: <Brain size={12} />, label: "Topics", value: overview?.topics ?? nodes.length, onClick: () => navigate("/graph") },
                { icon: <Network size={12} />, label: "Links", value: links.length, onClick: () => navigate("/graph") },
                { icon: <Clock3 size={12} />, label: "Due Review", value: review?.topics_due_for_review ?? 0, onClick: () => navigate("/review-topics") },
                { icon: <Target size={12} />, label: "Active Goals", value: overview?.active_goals ?? 0, onClick: () => navigate("/learning") },
              ].map(({ icon, label, value, onClick }) => (
                <button
                  key={label}
                  onClick={onClick}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-xs text-[var(--text-secondary)] hover:border-[var(--border-color-hover)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)] transition-all"
                >
                  <span className="text-[var(--accent-color)] flex items-center">{icon}</span>
                  {summaryLoading ? <Loader2 size={10} className="animate-spin text-[var(--text-muted)]" /> : <span className="font-semibold text-[var(--text-primary)]">{value}</span>}
                  <span className="text-[var(--text-muted)]">{label}</span>
                </button>
              ))}
            </div>
          )}

          <div className={`grid gap-4 ${hideSidebar ? "" : "xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.95fr)]"}`}>
            <Section
              title="Knowledge Map"
            >
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
                  <p className="max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
                    A top-down roadmap of your concepts. Topics anchor the spine; subtopics branch beneath them. Click a subtopic&apos;s +N badge to reveal its concepts. Scroll to zoom, drag to pan.
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="relative w-48 sm:w-64">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input
                        value={graphSearch}
                        onChange={(event) => setGraphSearch(event.target.value)}
                        placeholder="Filter roadmap..."
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 pl-8 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                      />
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setExportMenuOpen((open) => !open)}
                        disabled={nodes.length === 0 || exportingFormat !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)] disabled:opacity-50"
                      >
                        {exportingFormat ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Download size={13} />
                        )}
                        Export
                        <ChevronDown size={13} />
                      </button>
                      {exportMenuOpen && (
                        <div
                          role="menu"
                          className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-lg"
                        >
                          {[
                            { id: "markdown", label: "Markdown outline (.md)", desc: "AI-friendly hierarchy" },
                            { id: "json", label: "Hierarchical JSON (.json)", desc: "Nested tree + links" },
                            { id: "mermaid", label: "Mermaid (.mermaid)", desc: "graph TD source" },
                            { id: "csv", label: "CSV (.csv)", desc: "Flat with parent_id + depth" },
                            { id: "png", label: "PNG image (.png)", desc: "Visual snapshot" },
                            { id: "pdf", label: "PDF document (.pdf)", desc: "Print / archive" },
                          ].map((item) => {
                            const isImage = item.id === "png" || item.id === "pdf";
                            const disabled = isImage && !roadmapRef.current;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                role="menuitem"
                                onClick={() => exportRoadmap(item.id as "markdown" | "json" | "mermaid" | "csv" | "png" | "pdf")}
                                disabled={disabled || exportingFormat !== null}
                                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <span className="font-medium">{item.label}</span>
                                <span className="text-xs text-[var(--text-muted)]">{item.desc}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {uncategorizedOnlyNotice && (
                  <div
                    role="status"
                    className="mb-3 flex items-start gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-left text-xs leading-5 text-[var(--text-secondary)]"
                  >
                    <Info size={14} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                    <span>{uncategorizedOnlyNotice.message}</span>
                  </div>
                )}

                <div
                  className={
                    isFullscreen
                      ? "fixed inset-0 z-50 flex flex-col bg-[var(--bg-primary)] p-6 overflow-hidden"
                      : "relative h-[320px] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[linear-gradient(180deg,rgba(var(--accent-color-rgb),0.04),rgba(255,255,255,0)),var(--bg-primary)] 2xl:h-[380px]"
                  }
                  data-testid="knowledge-map"
                >
                  {nodes.length === 0 ? (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[var(--bg-primary)]/90 px-6 text-center">
                      <div className="rounded-full bg-[var(--accent-color)]/10 p-4 text-[var(--accent-color)]">
                        <Network size={26} />
                      </div>
                      <div className="max-w-md">
                        <div className="text-lg font-semibold text-[var(--text-primary)]">Your roadmap will appear here</div>
                        <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                          Analyze this workspace after you have a little material in it, and Aetherium will turn that activity into a structured roadmap.
                        </div>
                      </div>
                      {emptyMapNotice && (
                        <div
                          role={emptyMapNotice.kind === "warning" ? "alert" : "status"}
                          className={`flex max-w-md items-start gap-2 rounded-xl border px-3 py-2 text-left text-xs leading-5 ${
                            emptyMapNotice.kind === "warning"
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                              : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)]"
                          }`}
                        >
                          {emptyMapNotice.kind === "warning" ? (
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                          ) : (
                            <Info size={14} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                          )}
                          <span>{emptyMapNotice.message}</span>
                        </div>
                      )}
                      <button
                        onClick={() => { void handleRefresh("async"); }}
                        disabled={isAnalyzing || !activeWorkspaceId}
                        title={refreshButtonTooltip}
                        className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-color)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        {refreshButtonLabel}
                      </button>
                    </div>
                  ) : (
                    <>
                      {isFullscreen && (
                        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[var(--border-color)] pb-4">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                              Roadmap
                            </div>
                            <h2 className="text-xl font-semibold text-[var(--text-primary)]">Knowledge Map</h2>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="relative min-w-0 w-64">
                              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                              <input
                                value={graphSearch}
                                onChange={(event) => setGraphSearch(event.target.value)}
                                placeholder="Filter roadmap..."
                                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-1.5 pl-8 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                              />
                            </div>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setExportMenuOpen((open) => !open)}
                                disabled={nodes.length === 0 || exportingFormat !== null}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)] disabled:opacity-50"
                              >
                                {exportingFormat ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Download size={13} />
                                )}
                                Export
                                <ChevronDown size={13} />
                              </button>
                              {exportMenuOpen && (
                                <div
                                  role="menu"
                                  className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-lg"
                                >
                                  {[
                                    { id: "markdown", label: "Markdown outline (.md)", desc: "AI-friendly hierarchy" },
                                    { id: "json", label: "Hierarchical JSON (.json)", desc: "Nested tree + links" },
                                    { id: "mermaid", label: "Mermaid (.mermaid)", desc: "graph TD source" },
                                    { id: "csv", label: "CSV (.csv)", desc: "Flat with parent_id + depth" },
                                    { id: "png", label: "PNG image (.png)", desc: "Visual snapshot" },
                                    { id: "pdf", label: "PDF document (.pdf)", desc: "Print / archive" },
                                  ].map((item) => {
                                    const isImage = item.id === "png" || item.id === "pdf";
                                    const disabled = isImage && !roadmapRef.current;
                                    return (
                                      <button
                                        key={item.id}
                                        type="button"
                                        role="menuitem"
                                        onClick={() => exportRoadmap(item.id as "markdown" | "json" | "mermaid" | "csv" | "png" | "pdf")}
                                        disabled={disabled || exportingFormat !== null}
                                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        <span className="font-medium">{item.label}</span>
                                        <span className="text-xs text-[var(--text-muted)]">{item.desc}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => setIsFullscreen(false)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)]"
                              title="Exit Full Screen"
                            >
                              <Minimize2 size={13} />
                              Exit Full Screen
                            </button>
                          </div>
                        </div>
                      )}
                      <div className={isFullscreen ? "flex-1 min-h-0 w-full relative" : "h-full w-full relative"}>
                        <RoadmapGraph
                          ref={roadmapRef}
                          nodes={nodes}
                          links={links}
                          selectedConceptId={selectedConcept?.id ?? null}
                          onSelectConcept={setSelectedConcept}
                          searchFilter={graphSearch}
                        />
                        <button
                          type="button"
                          onClick={() => setIsFullscreen(!isFullscreen)}
                          className="absolute top-3 right-3 z-10 flex items-center justify-center p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] shadow-md transition-all"
                          title={isFullscreen ? "Exit Full Screen" : "Full Screen"}
                        >
                          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </Section>

            <div className="grid gap-4">
              {proposals.length > 0 && (
                <Section
                  title={`Change Proposals (${proposals.length})`}
                  eyebrow="Review"
                >
                  <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                    {proposals.map((proposal) => {
                      let details = "";
                      try {
                        const payloadVal = JSON.parse(proposal.payload);
                        if (proposal.proposal_type === "upgrade") {
                          const changes = [];
                          if (payloadVal.concept_description) { changes.push("description"); }
                          if (payloadVal.concept_type) { changes.push(`type to ${payloadVal.concept_type}`); }
                          if (payloadVal.hierarchy_level) { changes.push(`level to ${payloadVal.hierarchy_level}`); }
                          details = `Upgrade ${changes.join(", ")}`;
                        } else if (proposal.proposal_type === "supersede") {
                          details = `Supersede by "${payloadVal.successor_name || payloadVal.successor_id}"`;
                        } else if (proposal.proposal_type === "merge") {
                          details = `Merge into "${payloadVal.successor_name || payloadVal.successor_id}"`;
                        }
                      } catch {
                        details = proposal.proposal_type;
                      }

                      const targetNode = nodes.find(n => n.id === proposal.target_node_id);
                      const targetName = targetNode ? targetNode.name : "Unknown Topic";

                      return (
                        <div key={proposal.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-4 flex flex-col gap-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-[var(--text-primary)]">
                                {targetName}
                              </div>
                              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                                {details}
                              </div>
                            </div>
                            <span className="rounded-full bg-[var(--accent-color)]/10 px-2 py-0.5 text-[10px] text-[var(--accent-color)] capitalize">
                              {proposal.proposal_type}
                            </span>
                          </div>
                          {proposal.reason && (
                            <p className="text-xs text-[var(--text-muted)] italic leading-relaxed">
                              &ldquo;{proposal.reason}&rdquo;
                            </p>
                          )}
                          <div className="flex gap-2 mt-1">
                            <button
                              onClick={() => handleApplyProposal(proposal.id)}
                              className="flex-1 rounded-lg bg-[var(--accent-color)] py-1.5 text-xs text-white hover:opacity-90 font-medium"
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => handleDismissProposal(proposal.id)}
                              className="flex-1 rounded-lg border border-[var(--border-color)] py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}

            </div>
          </div>

          {selectedConcept && (
            <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
              <Section
                title="Selected Topic"
                eyebrow="Detail"
                collapsed={collapsedSections["conceptFocus"]}
                onToggle={() => toggleSection("conceptFocus")}
              >
                <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-[var(--text-primary)]">{selectedConcept.name}</div>
                      <div className="mt-1 text-xs text-[var(--text-secondary)]">{selectedConcept.concept_type}</div>
                    </div>
                    <button
                      onClick={() => setSelectedConcept(null)}
                      className="rounded-lg p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)]"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {selectedConcept.concept_description && (
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                      {selectedConcept.concept_description}
                    </p>
                  )}
                  <div className="mt-3 text-xs text-[var(--text-muted)]">
                    {conceptCards.length > 0
                      ? `${conceptCards.length} related card${conceptCards.length === 1 ? "" : "s"} available in the sidebar.`
                      : "Select generate cards in the sidebar if you want reinforcement for this topic."}
                  </div>
                </div>
              </Section>
            </div>
          )}
        </div>
      </div>

      {showCreateForm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="flex w-72 flex-col gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">New Topic</h3>
              <button onClick={() => setShowCreateForm(false)}>
                <X size={14} className="text-[var(--text-muted)]" />
              </button>
            </div>

            <input
              autoFocus
              value={newConceptName}
              onChange={(event) => setNewConceptName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { void createConcept(); }
                if (event.key === "Escape") { setShowCreateForm(false); }
              }}
              placeholder="Topic name"
              className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />

            <CompactMenuSelect
              label="Topic Type"
              value={newConceptType}
              options={["topic", "person", "technology", "definition", "question", "insight", "resource", "custom"].map((type) => ({
                value: type,
                label: type.charAt(0).toUpperCase() + type.slice(1),
              }))}
              onChange={(val) => setNewConceptType(val)}
              widthClassName="w-full"
            />

            <div className="flex gap-2">
              <button
                onClick={() => setShowCreateForm(false)}
                className="flex-1 rounded-lg border border-[var(--border-color)] py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={() => void createConcept()}
                className="flex-1 rounded-lg bg-[var(--accent-color)] py-2 text-xs text-white hover:opacity-90"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {refreshProgressOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="refresh-progress-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isAnalyzing ? (
                  <Loader2 size={16} className="animate-spin text-[var(--accent-color)]" />
                ) : (
                  <Check size={16} className="text-[var(--accent-color)]" />
                )}
                <h2 id="refresh-progress-title" className="text-base font-semibold text-[var(--text-primary)]">
                  Refreshing knowledge map
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setRefreshProgressOpen(false)}
                className="rounded-lg p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <X size={14} />
              </button>
            </div>
            <p className="mb-3 text-xs text-[var(--text-secondary)]">
              {isAnalyzing
                ? `Running ${refreshRunningCount} of ${refreshWatchedTasks.length} jobs. Completed ${refreshCompletedCount}.`
                : refreshFailedCount > 0
                  ? `${refreshCompletedCount} of ${refreshWatchedTasks.length} jobs finished. ${refreshFailedCount} did not complete.`
                  : `All ${refreshWatchedTasks.length} jobs finished.`}
            </p>
            <ul className="space-y-1.5">
              {refreshWatchedTasks.map((taskType) => {
                const state = refreshJobStatus[taskType];
                const pillStyles: Record<RefreshJobState, string> = {
                  idle: "bg-[var(--bg-primary)] text-[var(--text-muted)]",
                  queued: "bg-[var(--bg-primary)] text-[var(--text-secondary)]",
                  running: "bg-[var(--accent-color)]/15 text-[var(--accent-color)]",
                  completed: "bg-emerald-500/15 text-emerald-400",
                  failed: "bg-red-500/15 text-red-400",
                  cancelled: "bg-amber-500/15 text-amber-400",
                };
                return (
                  <li
                    key={taskType}
                    className="flex items-center justify-between rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40 px-3 py-2"
                  >
                    <span className="text-sm text-[var(--text-primary)]">
                      {REFRESH_JOB_LABELS[taskType]}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${pillStyles[state]}`}
                    >
                      {state === "running" && <Loader2 size={9} className="animate-spin" />}
                      {state === "completed" && <Check size={9} />}
                      {state}
                    </span>
                  </li>
                );
              })}
            </ul>
            {!isAnalyzing && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setRefreshProgressOpen(false)}
                  className="rounded-xl bg-[var(--accent-color)] px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {successDialog && (
        <SuccessDialog
          title={successDialog.title}
          description={successDialog.description}
          onConfirm={() => setSuccessDialog(null)}
        />
      )}

      {errorDialog && (
        <ConfirmDialog
          title={errorDialog.title}
          description={errorDialog.description}
          confirmLabel="OK"
          cancelLabel={null}
          tone="default"
          onConfirm={() => setErrorDialog(null)}
          onCancel={() => setErrorDialog(null)}
        />
      )}
    </div>
  );
}

/** Named export used by `LearningHubView` (Roadmap tab). Currently aliases the
 * full view; chrome stripping is a follow-up. */
export const RoadmapPane = KnowledgeGraphView;
