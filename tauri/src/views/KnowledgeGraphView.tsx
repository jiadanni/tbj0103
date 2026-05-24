/**
 * KnowledgeGraphView — workspace knowledge overview.
 * Left rail: AI analysis + concept tools.
 * Main area: overview, suggested actions, graph map, and recent activity.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Brain,
  ChevronDown,
  Clock3,
  FileText,
  Loader2,
  MessageSquare,
  Network,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Trash2,
  X,
} from "lucide-react";
import RoadmapGraph from "../components/RoadmapGraph";
import {
  api,
  type AiModel,
  type AnalysisResult,
  type ConceptLink,
  type ConceptNode,
  type DashboardActivity,
  type DashboardRoute,
  type DashboardSummary,
  type DescendantAnalysisProgress,
  type LearningCard,
  type LearningPathItem,
  type WorkspaceAnalysisProgress,
} from "../lib/api";
import { useSettingsStore } from "../stores/settingsStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useScopedWorkspace, useBubbleUpFlag } from "../lib/workspacePane";
import CompactMenuSelect from "../components/CompactMenuSelect";
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

function colorFor(type: string) {
  return TYPE_COLORS[type.toLowerCase()] ?? TYPE_COLORS.other;
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) { return "just now"; }
  if (minutes < 60) { return `${minutes}m ago`; }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) { return `${hours}h ago`; }
  return `${Math.floor(hours / 24)}d ago`;
}

function normalizeKnowledgeRoute(route: DashboardRoute): { path: string; state?: Record<string, unknown> } {
  if (route.path === "/backlinks" || route.path === "/dedup") {
    return { path: "/graph" };
  }

  return route.state ? { path: route.path, state: route.state } : { path: route.path };
}

function suggestionIcon(kind: string) {
  switch (kind) {
    case "review":
      return <Brain size={16} className="text-emerald-400" />;
    case "goal":
      return <Target size={16} className="text-[var(--accent-color)]" />;
    case "source":
      return <FileText size={16} className="text-amber-400" />;
    default:
      return <Sparkles size={16} className="text-[var(--accent-color)]" />;
  }
}

function activityIcon(kind: DashboardActivity["kind"]) {
  switch (kind) {
    case "chat":
      return <MessageSquare size={14} className="text-[var(--accent-color)]" />;
    case "concept":
      return <Brain size={14} className="text-sky-400" />;
    case "source":
      return <FileText size={14} className="text-amber-400" />;
    default:
      return <Target size={14} className="text-emerald-400" />;
  }
}

function MetricCard({
  label,
  value,
  accentClassName,
}: {
  label: string;
  value: string | number;
  accentClassName: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
      <div className={`mb-3 h-2 w-2 rounded-full ${accentClassName}`} />
      <div className="text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
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
      back: `Use the map to trace the nearby nodes and explain how ${concept.name} supports the broader concept cluster.`,
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

export default function KnowledgeGraphView() {
  const navigate = useNavigate();
  const { activeWorkspaceId } = useScopedWorkspace();
  const includeDescendants = useBubbleUpFlag();
  const { preferredModel, ollamaUrl } = useSettingsStore();
  const isDemoMode = useWorkspaceStore((state) => state.isDemoMode);

  const [nodes, setNodes] = useState<ConceptNode[]>([]);
  const [links, setLinks] = useState<ConceptLink[]>([]);
  const composerMode = useSettingsStore((s) => s.composerMode);
  const modelFamilyLabels = useSettingsStore((s) => s.modelFamilyLabels);
  const customModelFamilies = useSettingsStore((s) => s.customModelFamilies);
  const modelLabels = useSettingsStore((s) => s.modelLabels);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [focusTopic, setFocusTopic] = useState("");
  const [selectedModel, setSelectedModel] = useState(preferredModel || "");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [analyzeResult, setAnalyzeResult] = useState<AnalysisResult | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState<boolean | null>(null);
  const [descendantProgress, setDescendantProgress] = useState<DescendantAnalysisProgress | null>(null);
  const [chunkProgress, setChunkProgress] = useState<WorkspaceAnalysisProgress | null>(null);

  const [conceptSearch, setConceptSearch] = useState("");
  const [selectedConcept, setSelectedConcept] = useState<ConceptNode | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newConceptName, setNewConceptName] = useState("");
  const [newConceptType, setNewConceptType] = useState("topic");

  const [conceptCards, setConceptCards] = useState<LearningCard[]>([]);
  const [isGeneratingCards, setIsGeneratingCards] = useState(false);
  const [genCardError, setGenCardError] = useState("");

  const [learningPath, setLearningPath] = useState<LearningPathItem[]>([]);
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
          if (!ids.includes(selectedModel)) {
            setSelectedModel(ids[0]);
          }
          return;
        }
        return api.ollama.listModels(ollamaUrl);
      })
      .then((models) => {
        if (!models) { return; }
        if (Array.isArray(models)) {
          const names = (models as { name: string }[]).map((model) => model.name);
          setAvailableModels(names);
          if (!names.includes(selectedModel)) {
            setSelectedModel(names[0] || "");
          }
        }
      })
      .catch(() => {});
  }, [ollamaUrl, selectedModel]);

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
      setLearningPath([]);
      return;
    }

    const [nextNodes, nextLinks, nextPath] = await Promise.all([
      api.graph.listConcepts(activeWorkspaceId, undefined, undefined, { includeDescendants }),
      api.graph.listLinks(activeWorkspaceId, undefined, undefined, { includeDescendants }),
      api.graph.getLearningPath(activeWorkspaceId).catch(() => [] as LearningPathItem[]),
    ]);
    setNodes(nextNodes);
    setLinks(nextLinks);
    setLearningPath(nextPath);
  }, [activeWorkspaceId, includeDescendants]);

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
      setWorkspaceReady(null);
      return;
    }
    api.knowledge.checkWorkspaceAnalyzable(activeWorkspaceId)
      .then((result) => setWorkspaceReady(result.ready))
      .catch(() => setWorkspaceReady(null));
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!selectedConcept) {
      setConceptCards([]);
      return;
    }

    api.flashcard.listByConcept(selectedConcept.id).then(setConceptCards).catch(() => setConceptCards([]));
  }, [selectedConcept]);

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
        await Promise.all([loadGraph(), loadSummary()]);
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
      await Promise.all([loadGraph(), loadSummary()]);
    } catch (error: unknown) {
      setAnalyzeError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAnalyzing(false);
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

  function openRoute(route: DashboardRoute) {
    const nextRoute = normalizeKnowledgeRoute(route);
    navigate(nextRoute.path, nextRoute.state ? { state: nextRoute.state } : undefined);
  }

  function refreshKnowledge() {
    void Promise.all([loadGraph(), loadSummary()]);
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
  const weakConcepts = review?.weak_concepts ?? [];
  const progression = summary?.progression.slice(0, 3) ?? [];
  const recentActivity = summary?.recent_activity.slice(0, 5) ?? [];
  const continueLearning = summary?.continue_learning ?? null;
  const hasModels = availableModels.length > 0;
  const isDemoWithoutModels = isDemoMode && !hasModels;
  const canRunAiActions = hasModels || isDemoWithoutModels;
  const insufficientData = workspaceReady === false && !includeDescendants;
  const analyzeButtonLabel = isAnalyzing
    ? (descendantProgress
      ? `Analyzing ${descendantProgress.workspace_name} (${descendantProgress.index + 1}/${descendantProgress.total})…`
      : chunkProgress
        ? `Analyzing chunk ${chunkProgress.chunk_index + 1}/${chunkProgress.total_chunks} — ${chunkProgress.label}…`
        : "Analyzing...")
    : isDemoWithoutModels ? "Simulate Analysis"
    : includeDescendants ? "Analyze All Sub-Workspaces"
    : "Analyze Workspace";
  const analyzeHelpText = isDemoWithoutModels
    ? "Demo data is preloaded. No local models are installed on this machine, so AI actions use simulated demo output."
    : insufficientData
      ? "Not enough workspace material yet to build a useful graph. Add more chat, notes, or documents first."
      : includeDescendants
        ? "Runs analysis on each sub-workspace sequentially. The merged graph updates as each workspace completes. Yields to active chat."
        : hasModels
          ? "Use this to extract concepts and links from what you have already read, asked, and captured."
          : "No local AI models are available yet. Install or connect a model to analyze this workspace.";
  const cardHelpText = isDemoWithoutModels
    ? "Demo mode can generate sample flashcards locally for this concept."
    : hasModels
      ? ""
      : "Install a local model to generate flashcards for this concept.";
  const analyzeResultSummary = isDemoWithoutModels
    ? "Demo analysis refreshed the seeded sample content."
    : analyzeResult
      ? `+${analyzeResult.chapters_created} chapters, +${analyzeResult.sections_created} sections, +${analyzeResult.concepts_created} concepts, +${analyzeResult.links_created} links added`
      : "";

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[var(--bg-primary)]">
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
              options={availableModels.length === 0
                ? [{ value: "", label: isDemoWithoutModels ? "Demo simulation only" : "No models found" }]
                : groupedModelOptions.options
              }
              groups={groupedModelOptions.groups}
              onChange={(val) => setSelectedModel(val)}
              widthClassName="mb-2 w-full"
            />

            <input
              value={focusTopic}
              onChange={(event) => setFocusTopic(event.target.value)}
              placeholder="Focus topic (optional)"
              className="mb-2 w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />

            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !canRunAiActions || insufficientData}
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
                <div className="text-sm font-semibold text-[var(--text-primary)]">{overview?.concepts ?? nodes.length}</div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">Concepts</div>
              </div>
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-2 text-center">
                <div className="text-sm font-semibold text-[var(--text-primary)]">{links.length}</div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">Links</div>
              </div>
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-2 text-center">
                <div className="text-sm font-semibold text-[var(--text-primary)]">{review?.due_today ?? 0}</div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">Due</div>
              </div>
            </div>
          </SidebarCard>

          <SidebarCard className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Concepts</div>
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
                placeholder="Filter concepts..."
                className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] py-2 pl-7 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
              />
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
              <p className="px-2 py-3 text-[10px] text-[var(--text-muted)]">No concepts match this filter yet.</p>
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

      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 sm:px-6">
          <header className="rounded-[28px] border border-[var(--border-color)] bg-[linear-gradient(135deg,rgba(var(--accent-color-rgb),0.12),rgba(255,255,255,0)_55%),var(--bg-elevated)] p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="max-w-2xl">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  Knowledge
                </div>
                <h1 className="mt-2 text-2xl font-semibold text-[var(--text-primary)] sm:text-3xl">
                  See what this workspace knows and what needs attention next.
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

              <div className="flex flex-wrap gap-2 xl:justify-end">
                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing || !canRunAiActions}
                  className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-color)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {analyzeButtonLabel}
                </button>
                <button
                  onClick={refreshKnowledge}
                  disabled={summaryLoading}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)]"
                >
                  <RefreshCw size={14} className={summaryLoading ? "animate-spin" : ""} />
                  Refresh Overview
                </button>
              </div>
            </div>
          </header>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricCard label="Concepts" value={overview?.concepts ?? nodes.length} accentClassName="bg-[var(--accent-color)]" />
            <MetricCard label="Links" value={links.length} accentClassName="bg-[var(--accent-color)]" />
            <MetricCard label="Due Review" value={review?.due_today ?? 0} accentClassName="bg-[var(--accent-color)]" />
            <MetricCard label="Active Goals" value={overview?.active_goals ?? 0} accentClassName="bg-[var(--accent-color)]" />
            <MetricCard label="Isolated Concepts" value={summary?.knowledge_health.isolated_concepts ?? 0} accentClassName="bg-[var(--accent-color)]" />
            <MetricCard label="Unprocessed Sources" value={summary?.knowledge_health.unprocessed_sources ?? 0} accentClassName="bg-[var(--accent-color)]" />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.95fr)]">
            <Section title="Knowledge Map" eyebrow="Roadmap">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
                  <p className="max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
                    A top-down roadmap of your concepts. Chapters anchor the spine; sections and concepts branch beneath them. Scroll to zoom, drag to pan.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-0 flex-1 basis-[240px] 2xl:max-w-[320px]">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input
                        value={graphSearch}
                        onChange={(event) => setGraphSearch(event.target.value)}
                        placeholder="Filter roadmap..."
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 pl-8 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div
                  className="relative h-[560px] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[linear-gradient(180deg,rgba(var(--accent-color-rgb),0.04),rgba(255,255,255,0)),var(--bg-primary)] 2xl:h-[640px]"
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
                      <button
                        onClick={handleAnalyze}
                        disabled={isAnalyzing || !canRunAiActions}
                        className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-color)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        {analyzeButtonLabel}
                      </button>
                    </div>
                  ) : (
                    <RoadmapGraph
                      nodes={nodes}
                      links={links}
                      selectedConceptId={selectedConcept?.id ?? null}
                      onSelectConcept={(c) => setSelectedConcept(c)}
                      searchFilter={graphSearch}
                    />
                  )}
                </div>
              </div>
            </Section>

            <div className="grid gap-6">
              <Section title="Suggested Next Steps" eyebrow="Actions">
                <div className="space-y-3">
                  {continueLearning && (
                    <button
                      onClick={() => openRoute(continueLearning.route)}
                      className="flex w-full items-start justify-between gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-4 text-left transition-colors hover:border-[var(--accent-color)]"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--text-primary)]">Continue learning</div>
                        <div className="mt-1 truncate text-sm text-[var(--text-secondary)]">{continueLearning.title}</div>
                        <div className="mt-2 text-xs text-[var(--text-muted)]">Updated {timeAgo(continueLearning.updated_at)}</div>
                      </div>
                      <ArrowRight size={16} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                    </button>
                  )}

                  {review && review.due_today > 0 && (
                    <button
                      onClick={() => openRoute(review.route)}
                      className="flex w-full items-start justify-between gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-4 text-left transition-colors hover:border-[var(--accent-color)]"
                    >
                      <div>
                        <div className="text-sm font-medium text-[var(--text-primary)]">Review what is due now</div>
                        <div className="mt-1 text-sm text-[var(--text-secondary)]">
                          {review.due_today} card{review.due_today === 1 ? "" : "s"} are ready for reinforcement.
                        </div>
                      </div>
                      <ArrowRight size={16} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                    </button>
                  )}

                  {progression.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => openRoute(item.route)}
                      className="flex w-full items-start gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-4 text-left transition-colors hover:border-[var(--accent-color)]"
                    >
                      <div className="mt-0.5 shrink-0">{suggestionIcon(item.kind)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--text-primary)]">{item.title}</div>
                        <div className="mt-1 text-sm text-[var(--text-secondary)]">{item.description}</div>
                      </div>
                      <ArrowRight size={16} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                    </button>
                  ))}

                  {!continueLearning && progression.length === 0 && (!review || review.due_today === 0) && (
                    <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-4">
                      <div className="text-sm font-medium text-[var(--text-primary)]">No urgent next step yet</div>
                      <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                        Search naturally, capture a few notes or documents, then analyze the workspace to make this page more useful.
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          onClick={() => navigate("/chat")}
                          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)]"
                        >
                          <Search size={14} />
                          Search or chat
                        </button>
                        <button
                          onClick={() => navigate("/documents")}
                          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)]"
                        >
                          <FileText size={14} />
                          Open sources
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </Section>

              <Section title="Knowledge Health" eyebrow="Signals">
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                  <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/70 p-4">
                    <div className="text-xs text-[var(--text-muted)]">Stalled goals</div>
                    <div className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">
                      {summary?.knowledge_health.stalled_goals ?? 0}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/70 p-4">
                    <div className="text-xs text-[var(--text-muted)]">Weak concepts</div>
                    <div className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">
                      {weakConcepts.length}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/70 p-4">
                    <div className="text-xs text-[var(--text-muted)]">Reviewed cards</div>
                    <div className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">
                      {review?.learned ?? 0}
                    </div>
                  </div>
                </div>

                {weakConcepts.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs font-medium text-[var(--text-primary)]">Needs reinforcement</div>
                    <div className="mt-2 space-y-2">
                      {weakConcepts.slice(0, 3).map((concept) => (
                        <button
                          key={concept.concept_id}
                          onClick={() => openRoute(concept.route)}
                          className="flex w-full items-start justify-between gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-3 text-left transition-colors hover:border-[var(--accent-color)]"
                        >
                          <div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">{concept.name}</div>
                            <div className="mt-1 text-xs text-[var(--text-secondary)]">{concept.reason}</div>
                          </div>
                          <ArrowRight size={15} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {(summary?.knowledge_health.active_topic_tags.length ?? 0) > 0 && (
                  <div className="mt-4">
                    <div className="text-xs font-medium text-[var(--text-primary)]">Active topics</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {summary?.knowledge_health.active_topic_tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-[var(--accent-color)]/10 px-2.5 py-1 text-xs text-[var(--accent-color)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </Section>
            </div>
          </div>

          {learningPath.length > 0 && (
            <Section title="Learning Path" eyebrow="Next Steps">
              <div className="space-y-3">
                {learningPath.slice(0, 3).map((item) => (
                  <div key={item.concept_id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--text-primary)]">{item.concept_name}</div>
                        {item.hierarchy_path && (
                          <div className="mt-0.5 text-xs text-[var(--text-muted)]">{item.hierarchy_path}</div>
                        )}
                        {item.concept_description && (
                          <div className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-2">{item.concept_description}</div>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex-1 overflow-hidden rounded-full bg-[var(--border-color)] h-1.5">
                            <div
                              className="h-1.5 rounded-full bg-emerald-400 transition-all"
                              style={{ width: item.met_prereqs + item.unmet_prereqs > 0 ? `${Math.round((item.met_prereqs / (item.met_prereqs + item.unmet_prereqs)) * 100)}%` : '100%' }}
                            />
                          </div>
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {item.met_prereqs}/{item.met_prereqs + item.unmet_prereqs} prereqs
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const node = nodes.find((n) => n.id === item.concept_id);
                          if (node) { setSelectedConcept(node); }
                        }}
                        className="flex-shrink-0 rounded-lg border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--accent-color)] transition-colors hover:bg-[var(--accent-color)]/10"
                      >
                        Focus
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <Section title="Concept Focus" eyebrow="Signals">
              {selectedConcept ? (
                <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-4">
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
                    <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                      {selectedConcept.concept_description}
                    </p>
                  )}
                  <div className="mt-4 text-xs text-[var(--text-muted)]">
                    {conceptCards.length > 0
                      ? `${conceptCards.length} related card${conceptCards.length === 1 ? "" : "s"} available in the sidebar.`
                      : "Select generate cards in the sidebar if you want reinforcement for this concept."}
                  </div>
                </div>
              ) : weakConcepts.length > 0 ? (
                <div className="space-y-2">
                  {weakConcepts.slice(0, 4).map((concept) => (
                    <button
                      key={concept.concept_id}
                      onClick={() => openRoute(concept.route)}
                      className="flex w-full items-start gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-4 text-left transition-colors hover:border-[var(--accent-color)]"
                    >
                      <Brain size={16} className="mt-0.5 shrink-0 text-[var(--accent-color)]" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--text-primary)]">{concept.name}</div>
                        <div className="mt-1 text-sm text-[var(--text-secondary)]">{concept.reason}</div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-4 text-sm leading-6 text-[var(--text-secondary)]">
                  Pick a concept from the sidebar or click a node in the map to inspect it more closely.
                </div>
              )}
            </Section>

            <Section title="Recent Learning Activity" eyebrow="Recent">
              {recentActivity.length > 0 ? (
                <div className="space-y-3">
                  {recentActivity.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => openRoute(item.route)}
                      className="flex w-full items-start gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-4 text-left transition-colors hover:border-[var(--accent-color)]"
                    >
                      <div className="mt-0.5 shrink-0">{activityIcon(item.kind)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--text-primary)]">{item.title}</div>
                        <div className="mt-1 text-sm text-[var(--text-secondary)]">{item.subtitle}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-xs text-[var(--text-muted)]">
                        <Clock3 size={12} />
                        {timeAgo(item.timestamp)}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-4 text-sm leading-6 text-[var(--text-secondary)]">
                  Recent learning activity will appear here after you use search, notes, documents, or review.
                </div>
              )}
            </Section>
          </div>
        </div>
      </div>

      {showCreateForm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="flex w-72 flex-col gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">New Concept</h3>
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
              placeholder="Concept name"
              className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />

            <CompactMenuSelect
              label="Concept Type"
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
    </div>
  );
}
