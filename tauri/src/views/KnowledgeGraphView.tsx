/**
 * KnowledgeGraphView — AI-first tabbed knowledge hub.
 * Sidebar: AI analysis + stats + concept list.
 * Tabs: Graph | Backlinks | Dedup | Insights | Flashcards | Learning
 */
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import ForceGraph2D from "react-force-graph-2d";
import {
  Plus, Search, X, Trash2, ZoomIn, ZoomOut,
  Sparkles, Loader2, Check, Target, GitMerge,
  Link2, Hash, ArrowLeft, RotateCcw, CheckCircle,
} from "lucide-react";
import {
  api,
  type ConceptNode,
  type ConceptLink,
  type BacklinkEntry,
  type ProjectNote,
  type LearningGoal,
  type LearningCard,
  type AnalysisResult,
  type SuggestedGoal,
  type ReviewStats,
} from "../lib/api";
import { useSettingsStore } from "../stores/settingsStore";
import { useScopedWorkspace } from "../lib/workspacePane";
import type { GraphSubView } from "../components/navigationItems";
import LearningPathView from "./LearningPathView";

// ─── D3 types ──────────────────────────────────────────────────────────────

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  concept_type: string;
  x: number;
  y: number;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  id: string;
  link_type: string;
  strength: number;
  source: D3Node | string;
  target: D3Node | string;
}

const QUALITY_LABELS = [
  { q: 0, label: "Blackout",   color: "text-red-500",    bg: "bg-red-500/10 hover:bg-red-500/20" },
  { q: 1, label: "Forgot",     color: "text-orange-400",  bg: "bg-orange-400/10 hover:bg-orange-400/20" },
  { q: 2, label: "Hard",       color: "text-yellow-400",  bg: "bg-yellow-400/10 hover:bg-yellow-400/20" },
  { q: 3, label: "Good",       color: "text-green-400",   bg: "bg-green-400/10 hover:bg-green-400/20" },
  { q: 4, label: "Easy",       color: "text-blue-400",    bg: "bg-blue-400/10 hover:bg-blue-400/20" },
  { q: 5, label: "Perfect",    color: "text-indigo-400",  bg: "bg-indigo-400/10 hover:bg-indigo-400/20" },
];

const TYPE_COLORS: Record<string, string> = {
  person:      "#60a5fa",
  place:       "#34d399",
  event:       "#f472b6",
  topic:       "#a78bfa",
  object:      "#fb923c",
  theory:      "#facc15",
  technology:  "#38bdf8",
  definition:  "#f87171",
  question:    "#fb923c",
  insight:     "#4ade80",
  resource:    "#94a3b8",
  custom:      "#e879f9",
  other:       "#94a3b8",
};
function colorFor(type: string) {
  return TYPE_COLORS[type.toLowerCase()] ?? TYPE_COLORS.other;
}

// ─── Dedup helpers ─────────────────────────────────────────────────────────

interface DupPair { a: ConceptNode; b: ConceptNode; score: number; dismissed: boolean }

function nameSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) {return 1;}
  if (na.includes(nb) || nb.includes(na)) {return 0.85;}
  let common = 0;
  for (const c of na) { if (nb.includes(c)) {common++;} }
  return common / Math.max(na.length, nb.length, 1);
}

function buildDupPairs(concepts: ConceptNode[], threshold: number): DupPair[] {
  const found: DupPair[] = [];
  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length; j++) {
      const score = nameSimilarity(concepts[i].name, concepts[j].name);
      if (score >= threshold) {found.push({ a: concepts[i], b: concepts[j], score, dismissed: false });}
    }
  }
  return found.sort((a, b) => b.score - a.score);
}

// ─── Main component ────────────────────────────────────────────────────────

type Tab = "graph" | "backlinks" | "dedup" | "insights" | "flashcards" | "learning";

export default function KnowledgeGraphView() {
  const { activeWorkspaceId } = useScopedWorkspace();
  const { preferredModel, ollamaUrl } = useSettingsStore();
  const location = useLocation();

  // Graph data
  const [nodes, setNodes] = useState<ConceptNode[]>([]);
  const [links, setLinks] = useState<ConceptLink[]>([]);

  // Active tab
  const [tab, setTab] = useState<Tab>("graph");

  // Dedup settings
  const [dupThreshold, setDupThreshold] = useState(0.75);

  // Handle external tab switching via router state
  useEffect(() => {
    const state = location.state as { subView?: GraphSubView } | null;
    if (state?.subView) {
      setTab(state.subView as Tab);
      // Clear state so it doesn't persist on manual refreshes
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Sidebar AI analysis
  const [focusTopic, setFocusTopic] = useState("");
  const [selectedModel, setSelectedModel] = useState(preferredModel || "");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [analyzeResult, setAnalyzeResult] = useState<AnalysisResult | null>(null);

  // Sidebar concept list
  const [conceptSearch, setConceptSearch] = useState("");
  const [selectedConcept, setSelectedConcept] = useState<ConceptNode | null>(null);

  // Create concept form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newConceptName, setNewConceptName] = useState("");
  const [newConceptType, setNewConceptType] = useState("topic");

  // D3 refs

  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [graphSearch, setGraphSearch] = useState("");

  // Dedup
  const [dupPairs, setDupPairs] = useState<DupPair[]>([]);
  const [dupLoading, setDupLoading] = useState(false);
  const [mergingPair, setMergingPair] = useState<string | null>(null);

  // Backlinks
  const [blSearch, setBlSearch] = useState("");
  const [blGroups, setBlGroups] = useState<{ conceptName: string; entries: BacklinkEntry[] }[]>([]);
  const [blLoading, setBlLoading] = useState(false);
  const [blSelected, setBlSelected] = useState<string | null>(null);
  const [blNote, setBlNote] = useState<ProjectNote | null>(null);
  const [blNoteLoading, setBlNoteLoading] = useState(false);

  // Insights
  const [suggestedGoals, setSuggestedGoals] = useState<SuggestedGoal[]>([]);
  const [isSuggestingGoals, setIsSuggestingGoals] = useState(false);
  const [dismissedGoals, setDismissedGoals] = useState<Set<number>>(new Set());
  const [acceptingGoal, setAcceptingGoal] = useState<number | null>(null);
  const [existingGoals, setExistingGoals] = useState<LearningGoal[]>([]);
  const [pagerankNodes, setPagerankNodes] = useState<{ id: string; name: string; score: number }[]>([]);
  const [communities, setCommunities] = useState<{ id: string; members: string[] }[]>([]);

  // Flashcards tab state
  const [fcCards, setFcCards] = useState<LearningCard[]>([]);
  const [fcCurrentIndex, setFcCurrentIndex] = useState(0);
  const [fcIsFlipped, setFcIsFlipped] = useState(false);
  const [fcStats, setFcStats] = useState<ReviewStats | null>(null);
  const [fcReviewed, setFcReviewed] = useState(0);

  // Flashcard Generate state
  const [fcTopic, setFcTopic] = useState("");
  const [fcCardCount, setFcCardCount] = useState(5);
  const [fcIsGenerating, setFcIsGenerating] = useState(false);
  const [fcGenerateError, setFcGenerateError] = useState("");

  // Flashcard Manual create state
  const [fcShowCreate, setFcShowCreate] = useState(false);
  const [fcNewFront, setFcNewFront] = useState("");
  const [fcNewBack, setFcNewBack] = useState("");

  // Concept flashcards (for sidebar)
  const [conceptCards, setConceptCards] = useState<LearningCard[]>([]);
  const [isGeneratingCards, setIsGeneratingCards] = useState(false);
  const [genCardError, setGenCardError] = useState("");

  // ── Load models ───────────────────────────────────────────────────────────
  useEffect(() => {
    api.aiModel.list()
      .then((models) => {
        const enabled = models.filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
        if (enabled.length > 0) {
          const ids = enabled.map((m) => m.model_id);
          setAvailableModels(ids);
          if (!ids.includes(selectedModel)) {setSelectedModel(ids[0]);}
          return;
        }
        return api.ollama.listModels(ollamaUrl);
      })
      .then((models) => {
        if (!models) {return;}
        const names = (models as { name: string }[]).map((x) => x.name);
        setAvailableModels(names);
        if (!names.includes(selectedModel)) {setSelectedModel(names[0] || "");}
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ollamaUrl]);

  // ── Load graph data ───────────────────────────────────────────────────────
  const loadGraph = useCallback(async () => {
    if (!activeWorkspaceId) {return;}
    const [ns, ls] = await Promise.all([
      api.graph.listConcepts(activeWorkspaceId),
      api.graph.listLinks(activeWorkspaceId),
    ]);
    setNodes(ns);
    setLinks(ls);
  }, [activeWorkspaceId]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  // ── Load flashcards linked to selected concept ──────────────────────────
  useEffect(() => {
    if (!selectedConcept) { setConceptCards([]); return; }
    api.flashcard.listByConcept(selectedConcept.id).then(setConceptCards).catch(() => setConceptCards([]));
  }, [selectedConcept]);

  // ── Load flashcards for review tab ──────────────────────────────────────
  useEffect(() => {
    if (tab !== "flashcards" || !activeWorkspaceId) {return;}
    if (selectedConcept) {
      api.flashcard.listByConcept(selectedConcept.id).then((cards) => {
        setFcCards(cards);
        setFcCurrentIndex(0);
        setFcIsFlipped(false);
      }).catch(() => {});
    } else {
      api.flashcard.listDue(activeWorkspaceId, { limit: 200, offset: 0 }).then((due) => {
        setFcCards(due);
        setFcCurrentIndex(0);
        setFcIsFlipped(false);
      }).catch(() => {});
    }
    api.flashcard.getStats(activeWorkspaceId).then(setFcStats).catch(() => {});
  }, [tab, activeWorkspaceId, selectedConcept]);

  async function fcReview(quality: number) {
    const currentCard = fcCards[fcCurrentIndex];
    if (!currentCard) {return;}
    const updated = await api.flashcard.review(currentCard.id, quality);
    setFcCards((prev) => {
      const next = [...prev];
      next[fcCurrentIndex] = updated;
      return next;
    });
    setFcReviewed((r) => r + 1);
    setFcIsFlipped(false);
    if (fcCurrentIndex < fcCards.length - 1) {
      setFcCurrentIndex((i) => i + 1);
    } else {
      if (activeWorkspaceId) {api.flashcard.getStats(activeWorkspaceId).then(setFcStats).catch(() => {});}
    }
  }

  async function fcGenerateCards() {
    if (!activeWorkspaceId || !selectedModel || fcIsGenerating) {return;}
    if (!selectedConcept && !fcTopic.trim()) {return;}

    setFcIsGenerating(true);
    setFcGenerateError("");
    try {
      let generated;
      if (selectedConcept) {
        generated = await api.flashcard.generateFromConcept(activeWorkspaceId, selectedConcept.id, selectedModel, fcCardCount, ollamaUrl);
      } else {
        generated = await api.flashcard.generate(activeWorkspaceId, fcTopic.trim(), selectedModel, fcCardCount, ollamaUrl);
        setFcTopic("");
      }
      setFcCards((prev) => [...prev, ...generated]);
      api.flashcard.getStats(activeWorkspaceId).then(setFcStats).catch(() => {});
    } catch (err) {
      setFcGenerateError(err instanceof Error ? err.message : String(err));
    } finally {
      setFcIsGenerating(false);
    }
  }

  async function fcCreateCard() {
    if (!fcNewFront.trim() || !fcNewBack.trim() || !activeWorkspaceId) {return;}
    const card = await api.flashcard.create(activeWorkspaceId, fcNewFront.trim(), fcNewBack.trim());
    setFcCards((prev) => [...prev, card]);
    setFcNewFront("");
    setFcNewBack("");
    setFcShowCreate(false);
  }

  const fcCurrentCard = fcCards[fcCurrentIndex] ?? null;
  const fcIsDone = fcCards.length > 0 && fcCurrentIndex >= fcCards.length;

  async function generateConceptCards() {
    if (!selectedConcept || !activeWorkspaceId || !selectedModel || isGeneratingCards) {return;}
    setIsGeneratingCards(true);
    setGenCardError("");
    try {
      const cards = await api.flashcard.generateFromConcept(activeWorkspaceId, selectedConcept.id, selectedModel, 5, ollamaUrl);
      setConceptCards((prev) => [...cards, ...prev]);
    } catch (err) {
      setGenCardError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingCards(false);
    }
  }

  // ── Load existing goals when Insights tab opens ───────────────────────────
  useEffect(() => {
    if (tab !== "insights" || !activeWorkspaceId) {return;}
    api.learningGoal.list(activeWorkspaceId).then(setExistingGoals).catch(() => {});
  }, [tab, activeWorkspaceId]);

  // ── ForceGraph variables ──────────────────────────────────────────────────
  const filteredNodes = useMemo(
    () => graphSearch ? nodes.filter((n) => n.name.toLowerCase().includes(graphSearch.toLowerCase())) : nodes,
    [nodes, graphSearch],
  );

  const graphData = useMemo(() => {
    const nodeById = new Set(filteredNodes.map(n => n.id));
    return {
      nodes: filteredNodes.map(n => ({...n, val: 1})),
      links: links.filter(l => nodeById.has(l.source_id) && nodeById.has(l.target_id)).map(l => ({...l, source: l.source_id, target: l.target_id}))
    };
  }, [filteredNodes, links]);

  // ── AI: analyze workspace ─────────────────────────────────────────────────
  async function handleAnalyze() {
    if (!activeWorkspaceId || !selectedModel || isAnalyzing) {return;}
    setIsAnalyzing(true);
    setAnalyzeError("");
    setAnalyzeResult(null);
    try {
      const result = await api.knowledge.analyzeWorkspace(activeWorkspaceId, selectedModel, {
        ollamaUrl,
        focusTopic: focusTopic.trim() || undefined,
      });
      setAnalyzeResult(result);
      await loadGraph();
    } catch (e) {
      setAnalyzeError(String(e));
    } finally {
      setIsAnalyzing(false);
    }
  }

  // ── Create / delete concept ────────────────────────────────────────────────
  async function createConcept() {
    if (!newConceptName.trim() || !activeWorkspaceId) {return;}
    const concept = await api.graph.createConcept(activeWorkspaceId, newConceptName.trim(), {
      concept_type: newConceptType,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    setNodes((prev) => [...prev, concept]);
    setNewConceptName("");
    setShowCreateForm(false);
  }

  async function deleteConcept(id: string) {
    await api.graph.deleteConcept(id);
    setNodes((p) => p.filter((n) => n.id !== id));
    setLinks((p) => p.filter((l) => l.source_id !== id && l.target_id !== id));
    setSelectedConcept(null);
  }

  // ── Zoom ──────────────────────────────────────────────────────────────────
  function zoomIn()  { if (fgRef.current) { fgRef.current.zoom(fgRef.current.zoom() * 1.4, 400); } }
  function zoomOut() { if (fgRef.current) { fgRef.current.zoom(fgRef.current.zoom() / 1.4, 400); } }

  // ── Dedup ─────────────────────────────────────────────────────────────────
  async function runDedup() {
    if (!activeWorkspaceId) {return;}
    setDupLoading(true);
    try {
      const all = await api.graph.listConcepts(activeWorkspaceId);
      setDupPairs(buildDupPairs(all, dupThreshold));
    } finally {
      setDupLoading(false);
    }
  }

  async function mergePair(pair: DupPair, keepIdx: number) {
    const keep   = keepIdx === 0 ? pair.a : pair.b;
    const remove = keepIdx === 0 ? pair.b : pair.a;
    setMergingPair(pair.a.id + pair.b.id);
    try {
      const mergedAliases = [...new Set([...(keep.aliases ?? []), ...(remove.aliases ?? []), remove.name])];
      await api.graph.updateConcept(keep.id, { aliases: mergedAliases });
      await api.graph.deleteConcept(remove.id);
      setNodes((prev) => prev.filter((c) => c.id !== remove.id));
      setDupPairs((prev) => prev.filter((p) => !(p.a.id === pair.a.id && p.b.id === pair.b.id)));
    } finally {
      setMergingPair(null);
    }
  }

  // ── Backlinks ─────────────────────────────────────────────────────────────
  const loadBacklinks = useCallback(async () => {
    if (!activeWorkspaceId) {return;}
    setBlLoading(true);
    try {
      const concepts = await api.graph.listConcepts(activeWorkspaceId);
      const filtered = blSearch
        ? concepts.filter((c) => c.name.toLowerCase().includes(blSearch.toLowerCase()))
        : concepts;
      const results: { conceptName: string; entries: BacklinkEntry[] }[] = [];
      for (const c of filtered.slice(0, 50)) {
        const entries = await api.note.getBacklinks(activeWorkspaceId, c.name);
        if (entries.length > 0) {results.push({ conceptName: c.name, entries });}
      }
      setBlGroups(results);
    } catch (err) {
      console.error("Failed to load backlinks:", err);
    } finally {
      setBlLoading(false);
    }
  }, [activeWorkspaceId, blSearch]);

  useEffect(() => {
    if (tab === "backlinks") {loadBacklinks();}
  }, [tab, loadBacklinks]);

  async function openBlSource(entry: BacklinkEntry) {
    if (entry.source_type !== "note") {return;}
    setBlNoteLoading(true);
    setBlSelected(entry.concept_name);
    try {
      const note = await api.note.get(entry.source_id);
      setBlNote(note);
    } catch { setBlNote(null); }
    finally { setBlNoteLoading(false); }
  }

  // ── Insights: suggest goals ───────────────────────────────────────────────
  async function handleSuggestGoals() {
    if (!activeWorkspaceId || !selectedModel || isSuggestingGoals) {return;}
    setIsSuggestingGoals(true);
    try {
      const goals = await api.knowledge.suggestGoals(activeWorkspaceId, selectedModel, ollamaUrl);
      setSuggestedGoals(goals);
      setDismissedGoals(new Set());
    } catch (e) {
      console.error("Failed to suggest goals:", e);
    } finally {
      setIsSuggestingGoals(false);
    }
  }

  async function acceptGoal(goal: SuggestedGoal, idx: number) {
    if (!activeWorkspaceId) {return;}
    setAcceptingGoal(idx);
    try {
      const created = await api.learningGoal.create(activeWorkspaceId, goal.title);
      setExistingGoals((prev) => [created, ...prev]);
      setDismissedGoals((prev) => new Set([...prev, idx]));
    } finally {
      setAcceptingGoal(null);
    }
  }

  // ── PageRank & communities ─────────────────────────────────────────────────
  async function runPagerank() {
    if (!activeWorkspaceId || nodes.length === 0) {return;}
    try {
      const result = await api.graphAlgo.pagerank(activeWorkspaceId, 0.85, 100);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sorted = [...result].sort((a: any, b: any) => b.score - a.score).slice(0, 10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setPagerankNodes(sorted.map((r: any) => ({
        id: r.id,
        name: nodes.find((n) => n.id === r.id)?.name ?? r.id,
        score: r.score,
      })));
    } catch (e) { console.error("PageRank failed:", e); }
  }

  async function runCommunities() {
    if (!activeWorkspaceId || nodes.length === 0) {return;}
    try {
      const result = await api.graphAlgo.communities(activeWorkspaceId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCommunities((result as any[]).slice(0, 6).map((c: any, i: number) => ({
        id: String(i),
        members: (c.members ?? []).map((mid: string) => nodes.find((n) => n.id === mid)?.name ?? mid),
      })));
    } catch (e) { console.error("Communities failed:", e); }
  }

  useEffect(() => {
    if (tab === "insights" && nodes.length > 0) {
      runPagerank();
      runCommunities();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, nodes.length]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">

      {/* ─── LEFT SIDEBAR ─────────────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-sidebar)] overflow-y-auto">

        {/* AI Analysis panel */}
        <div className="p-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles size={14} className="text-[var(--accent-color)]" />
            <span className="text-xs font-semibold text-[var(--text-primary)]">AI Analysis</span>
          </div>

          {/* Model selector */}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full mb-2 px-2 py-1 text-xs rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none"
          >
            {availableModels.length === 0 && <option value="">No models found</option>}
            {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>

          {/* Optional topic */}
          <input
            value={focusTopic}
            onChange={(e) => setFocusTopic(e.target.value)}
            placeholder="Focus topic (optional)"
            className="w-full mb-2 px-2 py-1 text-xs rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />

          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !activeWorkspaceId || !selectedModel}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAnalyzing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {isAnalyzing ? "Analyzing…" : "Analyze Workspace"}
          </button>

          <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
            Works best after the workspace has a reasonable amount of material.
            Aim for several chats, notes, or documents before analyzing, otherwise the graph may stay generic.
          </p>

          {analyzeResult && (
            <p className="mt-2 text-[10px] text-[var(--text-muted)] text-center">
              +{analyzeResult.concepts_created} concepts · +{analyzeResult.links_created} links
              {analyzeResult.concepts_skipped > 0 && ` · ${analyzeResult.concepts_skipped} skipped`}
            </p>
          )}
          {analyzeError && (
            <p className="mt-2 text-[10px] text-red-400 break-words">{analyzeError}</p>
          )}
        </div>

        {/* Stats */}
        <div className="px-3 py-2 flex gap-4 border-b border-[var(--border-color)]">
          <div className="text-center">
            <div className="text-sm font-semibold text-[var(--text-primary)]">{nodes.length}</div>
            <div className="text-[10px] text-[var(--text-muted)]">Concepts</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold text-[var(--text-primary)]">{links.length}</div>
            <div className="text-[10px] text-[var(--text-muted)]">Links</div>
          </div>
        </div>

        {/* Concept list */}
        <div className="px-2 py-2 border-b border-[var(--border-color)]">
          <div className="relative mb-2">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={conceptSearch}
              onChange={(e) => setConceptSearch(e.target.value)}
              placeholder="Filter concepts…"
              className="w-full pl-6 pr-2 py-1 text-xs rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
          </div>
          <div className="space-y-0.5 max-h-44 overflow-y-auto">
            {nodes
              .filter((n) => !conceptSearch || n.name.toLowerCase().includes(conceptSearch.toLowerCase()))
              .map((n) => (
                <button
                  key={n.id}
                  onClick={() => setSelectedConcept(selectedConcept?.id === n.id ? null : n)}
                  className={`w-full text-left px-2 py-1 rounded text-xs truncate flex items-center gap-1.5 transition-colors ${
                    selectedConcept?.id === n.id
                      ? "bg-[var(--accent-color)]/20 text-[var(--accent-color)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: colorFor(n.concept_type) }}
                  />
                  {n.name}
                </button>
              ))
            }
          </div>
        </div>

        {/* Manual create button */}
        <div className="p-2">
          <button
            onClick={() => setShowCreateForm(true)}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <Plus size={11} /> Add Concept
          </button>
        </div>

        {/* Selected concept details */}
        {selectedConcept && (
          <div className="p-3 border-t border-[var(--border-color)] mt-auto">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-[var(--text-primary)] truncate">{selectedConcept.name}</span>
              <button onClick={() => setSelectedConcept(null)}><X size={12} className="text-[var(--text-muted)]" /></button>
            </div>
            <span
              className="inline-block px-1.5 py-0.5 text-[10px] rounded-full mb-1.5"
              style={{ backgroundColor: colorFor(selectedConcept.concept_type) + "33", color: colorFor(selectedConcept.concept_type) }}
            >
              {selectedConcept.concept_type}
            </span>
            {selectedConcept.concept_description && (
              <p className="text-[10px] text-[var(--text-muted)] mb-2">{selectedConcept.concept_description}</p>
            )}
            {/* Flashcard integration */}
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={generateConceptCards}
                disabled={isGeneratingCards || !selectedModel}
                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-[var(--border-color)] text-[var(--accent-color)] hover:bg-[var(--accent-color)]/10 disabled:opacity-40 transition-colors"
              >
                {isGeneratingCards ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                {isGeneratingCards ? "Generating..." : "Generate Cards"}
              </button>
              {conceptCards.length > 0 && (
                <span className="text-[10px] text-[var(--text-muted)]">
                  {conceptCards.length} card{conceptCards.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {genCardError && (
              <p className="text-[10px] text-red-400 mb-2 leading-tight">{genCardError}</p>
            )}
            {conceptCards.length > 0 && (
              <div className="mb-2 max-h-24 overflow-y-auto space-y-1">
                {conceptCards.slice(0, 5).map((c) => (
                  <div key={c.id} className="text-[10px] text-[var(--text-muted)] truncate px-1.5 py-0.5 bg-[var(--bg-hover)] rounded">
                    {c.front}
                  </div>
                ))}
                {conceptCards.length > 5 && (
                  <div className="text-[10px] text-[var(--text-muted)] px-1.5">+{conceptCards.length - 5} more</div>
                )}
              </div>
            )}
            <button
              onClick={() => deleteConcept(selectedConcept.id)}
              className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 transition-colors"
            >
              <Trash2 size={10} /> Delete
            </button>
          </div>
        )}
      </div>

      {/* ─── MAIN AREA ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Tab bar */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] flex-shrink-0">
          {(["graph", "backlinks", "dedup", "insights", "flashcards", "learning"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs rounded transition-colors capitalize ${
                tab === t
                  ? "bg-[var(--accent-color)] text-white"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {t === "backlinks" ? "Backlinks" : t === "dedup" ? "Deduplication" : t === "insights" ? "Insights" : t === "flashcards" ? "Flashcards" : t === "learning" ? "Learning" : "Graph"}
            </button>
          ))}
        </div>

        {/* ── GRAPH TAB ───────────────────────────────────────────── */}
        {tab === "graph" && (
          <div className="flex-1 relative overflow-hidden" ref={containerRef}>
            {/* Toolbar */}
            <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-2">
              <div className="relative flex-1 max-w-xs">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={graphSearch}
                  onChange={(e) => setGraphSearch(e.target.value)}
                  placeholder="Filter graph…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--bg-elevated)]/90 border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none backdrop-blur"
                />
              </div>
              <button onClick={zoomIn}  className="p-1.5 rounded-lg bg-[var(--bg-elevated)]/90 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] backdrop-blur"><ZoomIn size={14} /></button>
              <button onClick={zoomOut} className="p-1.5 rounded-lg bg-[var(--bg-elevated)]/90 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] backdrop-blur"><ZoomOut size={14} /></button>
            </div>

            {/* Empty state */}
            {nodes.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none">
                <p className="text-[var(--text-muted)] text-sm text-center max-w-xs">
                  {activeWorkspaceId
                    ? "Analyze your workspace to auto-discover concepts"
                    : "Select a workspace first"}
                </p>
                {activeWorkspaceId && (
                  <button
                    className="pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent-color)] text-white text-sm hover:opacity-90"
                    onClick={handleAnalyze}
                    disabled={isAnalyzing || !selectedModel}
                  >
                    {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Analyze with AI
                  </button>
                )}
              </div>
            )}

            {containerRef.current && (
              <ForceGraph2D
                ref={fgRef}
                width={containerRef.current.clientWidth}
                height={containerRef.current.clientHeight}
                graphData={graphData}
                nodeRelSize={6}
                nodeColor={(n: any) => colorFor(n.concept_type)}
                linkColor={() => "#475569"}
                linkWidth={(l: any) => Math.max(1, l.strength * 2)}
                linkLabel="link_type"
                nodeCanvasObjectMode={() => "after"}
                nodeCanvasObject={(node: any, ctx, globalScale) => {
                  const label = node.name.slice(0, 14) + (node.name.length > 14 ? "…" : "");
                  const fontSize = 12/globalScale;
                  ctx.font = `${fontSize}px Sans-Serif`;
                  ctx.fillStyle = '#e2e8f0';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(label, node.x, node.y);
                }}
                onNodeClick={(node: any) => setSelectedConcept(nodes.find(n => n.id === node.id) ?? null)}
                backgroundColor="transparent"
              />
            )}

            {/* Create concept overlay */}
            {showCreateForm && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-30 backdrop-blur-sm">
                <div className="w-72 bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-color)] p-5 shadow-xl flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">New Concept</h3>
                    <button onClick={() => setShowCreateForm(false)}><X size={14} className="text-[var(--text-muted)]" /></button>
                  </div>
                  <input
                    autoFocus
                    value={newConceptName}
                    onChange={(e) => setNewConceptName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") {createConcept();} if (e.key === "Escape") {setShowCreateForm(false);} }}
                    placeholder="Concept name"
                    className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                  />
                  <select
                    value={newConceptType}
                    onChange={(e) => setNewConceptType(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-secondary)] outline-none"
                  >
                    {["topic","person","technology","definition","question","insight","resource","custom"].map((t) => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={() => setShowCreateForm(false)} className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">Cancel</button>
                    <button onClick={createConcept} className="flex-1 py-2 rounded-lg bg-[var(--accent-color)] text-white text-xs hover:opacity-90">Create</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── DEDUPLICATION TAB ────────────────────────────────────── */}
        {tab === "dedup" && (
          <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg-primary)]">
            <div className="p-4 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <GitMerge size={16} className="text-[var(--accent-color)]" />
                  Deduplication
                </h2>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Identify and merge duplicate concepts across the workspace</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                  <span>Similarity: {Math.round(dupThreshold * 100)}%</span>
                  <input
                    type="range" min={0.5} max={0.99} step={0.05}
                    value={dupThreshold}
                    onChange={(e) => setDupThreshold(Number(e.target.value))}
                    className="w-24 accent-[var(--accent-color)]"
                  />
                </div>
                <button
                  onClick={runDedup}
                  disabled={dupLoading}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--accent-color)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-all"
                >
                  {dupLoading ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                  {dupPairs.length > 0 ? "Re-scan" : "Scan for Duplicates"}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {dupLoading && dupPairs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <Loader2 size={32} className="animate-spin text-[var(--accent-color)]" />
                  <p className="text-sm text-[var(--text-muted)]">Analyzing concept similarity…</p>
                </div>
              ) : dupPairs.filter((p) => !p.dismissed).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                    <CheckCircle size={32} />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-[var(--text-primary)]">All Clear</h3>
                    <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xs mx-auto">
                      No duplicate concept candidates found above 75% similarity. Your knowledge graph is nice and clean.
                    </p>
                  </div>
                  {dupPairs.length === 0 && !dupLoading && (
                    <button
                      onClick={runDedup}
                      className="mt-2 text-xs text-[var(--accent-color)] hover:underline"
                    >
                      Run a fresh scan
                    </button>
                  )}
                </div>
              ) : (
                <div className="max-w-4xl mx-auto space-y-3">
                  <p className="text-xs text-[var(--text-muted)] mb-4">
                    The following pairs have high name similarity. Select which name to keep for the merged concept.
                    Merging will combine all backlinks and links.
                  </p>
                  {dupPairs.filter((p) => !p.dismissed).map((pair, i) => (
                    <div key={pair.a.id + pair.b.id} className="group rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 hover:border-[var(--accent-color)]/30 transition-all">
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col items-center shrink-0">
                          <span className="text-[10px] font-bold text-[var(--accent-color)] tabular-nums">{Math.round(pair.score * 100)}%</span>
                          <span className="text-[9px] uppercase tracking-tighter text-[var(--text-muted)]">Match</span>
                        </div>
                        
                        <div className="grid grid-cols-2 flex-1 gap-4">
                          <button
                            onClick={() => mergePair(pair, 0)}
                            disabled={mergingPair === pair.a.id + pair.b.id}
                            className={`relative text-left p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--accent-color)] hover:ring-1 hover:ring-[var(--accent-color)] transition-all ${
                              mergingPair === pair.a.id + pair.b.id ? "opacity-50 cursor-wait" : ""
                            }`}
                          >
                            <span className="block text-[10px] text-[var(--text-muted)] mb-1 uppercase tracking-wide">Keep this name</span>
                            <span className="text-sm font-medium text-[var(--text-primary)]">{pair.a.name}</span>
                            <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[9px] text-[var(--text-muted)]">{pair.a.concept_type}</span>
                          </button>

                          <button
                            onClick={() => mergePair(pair, 1)}
                            disabled={mergingPair === pair.a.id + pair.b.id}
                            className={`relative text-left p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--accent-color)] hover:ring-1 hover:ring-[var(--accent-color)] transition-all ${
                              mergingPair === pair.a.id + pair.b.id ? "opacity-50 cursor-wait" : ""
                            }`}
                          >
                            <span className="block text-[10px] text-[var(--text-muted)] mb-1 uppercase tracking-wide">Keep this name</span>
                            <span className="text-sm font-medium text-[var(--text-primary)]">{pair.b.name}</span>
                            <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[9px] text-[var(--text-muted)]">{pair.b.concept_type}</span>
                          </button>
                        </div>

                        <button
                          onClick={() => setDupPairs((prev) => prev.map((p, pi) => pi === i ? { ...p, dismissed: true } : p))}
                          className="p-2 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10 transition-colors"
                          title="Dismiss"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── BACKLINKS TAB ────────────────────────────────────────── */}
        {tab === "backlinks" && (
          <div className="flex flex-1 overflow-hidden">
            {/* Left: concept list */}
            <div className="w-72 flex-shrink-0 border-r border-[var(--border-color)] flex flex-col">
              <div className="p-3 border-b border-[var(--border-color)]">
                <div className="flex items-center gap-2 mb-2">
                  <Link2 size={14} className="text-[var(--accent-color)]" />
                  <span className="text-xs font-semibold text-[var(--text-primary)]">Backlinks</span>
                </div>
                <div className="relative">
                  <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    value={blSearch}
                    onChange={(e) => setBlSearch(e.target.value)}
                    placeholder="Filter concepts…"
                    className="w-full pl-6 pr-2 py-1 text-xs rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {blLoading ? (
                  <div className="flex items-center justify-center pt-8 gap-2 text-[var(--text-muted)]">
                    <Loader2 size={14} className="animate-spin" /><span className="text-xs">Loading…</span>
                  </div>
                ) : blGroups.length === 0 ? (
                  <div className="p-4 text-center">
                    <Hash size={28} className="mx-auto mb-2 opacity-20 text-[var(--text-muted)]" />
                    <p className="text-xs text-[var(--text-muted)]">No backlinks yet.</p>
                    <p className="text-[10px] text-[var(--text-muted)] mt-1">Use [[concept]] syntax in notes.</p>
                  </div>
                ) : (
                  blGroups.map((g) => (
                    <div key={g.conceptName} className="mb-1">
                      <button
                        onClick={() => setBlSelected(blSelected === g.conceptName ? null : g.conceptName)}
                        className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between hover:bg-[var(--bg-hover)] transition-colors ${
                          blSelected === g.conceptName ? "bg-[var(--bg-hover)] text-[var(--accent-color)]" : "text-[var(--text-primary)]"
                        }`}
                      >
                        <span className="font-medium truncate">{g.conceptName}</span>
                        <span className="ml-2 text-[var(--text-muted)] flex-shrink-0">{g.entries.length}</span>
                      </button>
                      {blSelected === g.conceptName && (
                        <div className="ml-3 mt-0.5 space-y-0.5">
                          {g.entries.map((e, i) => (
                            <button
                              key={i}
                              onClick={() => openBlSource(e)}
                              className="w-full text-left px-2 py-1 rounded text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                            >
                              <span className="opacity-60">{e.source_type}</span>: {e.source_id.slice(0, 8)}…
                              {e.context && <p className="opacity-50 truncate mt-0.5">…{e.context.slice(0, 60)}…</p>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
            {/* Right: note preview */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {blNote ? (
                <>
                  <div className="flex items-center gap-2 p-3 border-b border-[var(--border-color)]">
                    <button onClick={() => { setBlNote(null); setBlSelected(null); }} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]">
                      <ArrowLeft size={14} />
                    </button>
                    <h3 className="text-sm font-semibold truncate">{blNote.title}</h3>
                  </div>
                  <div className="flex-1 overflow-y-auto p-5">
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed font-normal text-[var(--text-primary)]">
                      {blNote.content || <span className="italic text-[var(--text-muted)]">Empty note</span>}
                    </pre>
                  </div>
                </>
              ) : blNoteLoading ? (
                <div className="flex-1 flex items-center justify-center gap-2 text-[var(--text-muted)]">
                  <Loader2 size={16} className="animate-spin" /><span className="text-sm">Loading…</span>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)]">
                  <Link2 size={32} className="mb-3 opacity-20" />
                  <p className="text-sm">Select a backlink to preview the note</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── INSIGHTS TAB ─────────────────────────────────────────── */}
        {tab === "insights" && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

            {/* AI-suggested goals */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">AI Suggested Goals</h2>
                <button
                  onClick={handleSuggestGoals}
                  disabled={isSuggestingGoals || !selectedModel || !activeWorkspaceId || nodes.length === 0}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-50"
                >
                  {isSuggestingGoals ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  Suggest
                </button>
              </div>
              {suggestedGoals.length === 0 && !isSuggestingGoals && (
                <p className="text-xs text-[var(--text-muted)]">
                  {nodes.length === 0
                    ? "Analyze your workspace first to generate suggestions."
                    : "Click Suggest to get AI-recommended learning goals."}
                </p>
              )}
              <div className="space-y-2">
                {suggestedGoals.map((goal, idx) => {
                  if (dismissedGoals.has(idx)) {return null;}
                  return (
                    <div key={idx} className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-color)]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--text-primary)]">{goal.title}</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">{goal.description}</p>
                          {goal.related_concepts.length > 0 && (
                            <div className="flex gap-1 mt-1.5 flex-wrap">
                              {goal.related_concepts.map((c) => (
                                <span key={c} className="px-1.5 py-0.5 text-[10px] rounded-full bg-[var(--accent-color)]/10 text-[var(--accent-color)]">{c}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => acceptGoal(goal, idx)}
                            disabled={acceptingGoal === idx}
                            className="p-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-50"
                            title="Accept goal"
                          >
                            {acceptingGoal === idx ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          </button>
                          <button
                            onClick={() => setDismissedGoals((prev) => new Set([...prev, idx]))}
                            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* PageRank top concepts */}
            {pagerankNodes.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Top Concepts (PageRank)</h2>
                <div className="space-y-1.5">
                  {pagerankNodes.slice(0, 8).map((n, i) => (
                    <div key={n.id} className="flex items-center gap-2">
                      <span className="text-[10px] text-[var(--text-muted)] w-4">{i + 1}.</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs text-[var(--text-primary)]">{n.name}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">{n.score.toFixed(3)}</span>
                        </div>
                        <div className="h-1 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[var(--accent-color)]"
                            style={{ width: `${Math.min(100, (n.score / (pagerankNodes[0]?.score || 1)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Communities */}
            {communities.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Concept Clusters</h2>
                <div className="space-y-2">
                  {communities.map((c, i) => (
                    <div key={c.id} className="p-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)]">
                      <p className="text-[10px] text-[var(--text-muted)] mb-1">Cluster {i + 1}</p>
                      <div className="flex flex-wrap gap-1">
                        {c.members.slice(0, 8).map((name) => (
                          <span key={name} className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--bg-hover)] text-[var(--text-secondary)]">{name}</span>
                        ))}
                        {c.members.length > 8 && <span className="text-[10px] text-[var(--text-muted)]">+{c.members.length - 8}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Existing goals */}
            {existingGoals.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                  Learning Goals ({existingGoals.length})
                </h2>
                <div className="space-y-2">
                  {existingGoals.map((goal) => (
                    <div key={goal.id} className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-color)]">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Target size={12} className={goal.is_completed ? "text-green-400" : "text-[var(--accent-color)]"} />
                        <p className={`text-xs font-medium flex-1 truncate ${goal.is_completed ? "line-through opacity-60" : "text-[var(--text-primary)]"}`}>
                          {goal.title}
                        </p>
                        <span className="text-[10px] text-[var(--text-muted)]">{Math.round(goal.progress * 100)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--accent-color)] transition-all"
                          style={{ width: `${goal.progress * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {nodes.length === 0 && existingGoals.length === 0 && (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <Target size={36} className="text-[var(--text-muted)] opacity-30" />
                <p className="text-sm text-[var(--text-muted)]">Analyze your workspace to see insights here.</p>
                <button
                  onClick={() => setTab("graph")}
                  className="px-4 py-2 rounded-xl bg-[var(--accent-color)] text-white text-sm hover:opacity-90"
                >
                  Go to Graph tab
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── FLASHCARDS TAB ───────────────────────────────────────── */}
        {tab === "flashcards" && (
          <div className="flex h-full overflow-hidden">
            {/* Tab Sidebar */}
            <div className="w-56 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] flex flex-col overflow-hidden shrink-0">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Reviews</h2>
                <button
                  onClick={() => setFcShowCreate(true)}
                  className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  title="Add card manually"
                >
                  <Plus size={14} />
                </button>
              </div>

              {/* Generate — context aware */}
              <div className="px-3 py-3 border-b border-[var(--border-color)] space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent-color)]">
                  <Sparkles size={12} />
                  {selectedConcept ? "Generate from Concept" : "Generate from Topic"}
                </div>
                {selectedConcept ? (
                  <div className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] flex items-center gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-color)]/10 text-[var(--accent-color)] uppercase">
                      {selectedConcept.concept_type}
                    </span>
                    <span className="text-xs text-[var(--text-primary)] font-medium truncate">{selectedConcept.name}</span>
                  </div>
                ) : (
                  <input
                    value={fcTopic}
                    onChange={(e) => setFcTopic(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") {fcGenerateCards();} }}
                    placeholder="e.g. Rust ownership model"
                    disabled={fcIsGenerating}
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] transition-colors"
                  />
                )}
                <div className="flex gap-1.5">
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="flex-1 text-[11px] px-1.5 py-1 rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-secondary)] outline-none min-w-0"
                  >
                    {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select
                    value={fcCardCount}
                    onChange={(e) => setFcCardCount(Number(e.target.value))}
                    className="w-14 text-[11px] px-1 py-1 rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-secondary)] outline-none"
                  >
                    {[3, 5, 8, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <button
                  onClick={fcGenerateCards}
                  disabled={fcIsGenerating || (!selectedConcept && !fcTopic.trim()) || !selectedModel}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[var(--accent-color)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {fcIsGenerating ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} />
                      Generate {fcCardCount} Cards
                    </>
                  )}
                </button>
                {fcGenerateError && (
                  <p className="text-[10px] text-red-400 leading-tight">{fcGenerateError}</p>
                )}
              </div>

              {/* Stats */}
              {fcStats && (
                <div className="px-4 py-2.5 border-b border-[var(--border-color)] space-y-1.5">
                  {[
                    { label: "Total", value: fcStats.total_cards },
                    { label: "Due today", value: fcStats.due_today, accent: true },
                    { label: "Learned", value: fcStats.learned },
                  ].map(({ label, value, accent }) => (
                    <div key={label} className="flex justify-between items-center text-xs">
                      <span className="text-[var(--text-muted)] text-[10px]">{label}</span>
                      <span className={accent ? "text-[var(--accent-color)] font-semibold" : "text-[var(--text-secondary)]"}>
                        {value}
                      </span>
                    </div>
                  ))}
                  {fcReviewed > 0 && (
                    <div className="text-[10px] text-[var(--text-muted)] pt-1">
                      Reviewed: <span className="text-[var(--accent-color)]">{fcReviewed}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Card list */}
              <div className="flex-1 overflow-y-auto">
                {fcCards.map((c, i) => (
                  <button
                    key={c.id}
                    onClick={() => { setFcCurrentIndex(i); setFcIsFlipped(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[10px] truncate transition-colors ${
                      i === fcCurrentIndex
                        ? "bg-[var(--accent-color)]/20 text-[var(--accent-color)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    {c.front.slice(0, 32)}{c.front.length > 32 ? "…" : ""}
                  </button>
                ))}
                {fcCards.length === 0 && (
                  <p className="text-[10px] text-[var(--text-muted)] py-4 px-3 text-center">
                    {selectedConcept
                      ? "No cards for this concept."
                      : "No cards due. Generate some above!"}
                  </p>
                )}
              </div>
            </div>

            {/* Card area */}
            <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8 bg-[var(--bg-primary)]">
              {fcIsDone ? (
                <div className="flex flex-col items-center gap-4 text-center">
                  <CheckCircle size={48} className="text-green-400" />
                  <h2 className="text-xl font-semibold text-[var(--text-primary)]">Session Complete!</h2>
                  <p className="text-sm text-[var(--text-muted)]">
                    You reviewed {fcReviewed} card{fcReviewed !== 1 ? "s" : ""}.
                  </p>
                  <button
                    onClick={() => {
                      setFcCurrentIndex(0);
                      setFcIsFlipped(false);
                      setFcReviewed(0);
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm hover:opacity-90"
                  >
                    <RotateCcw size={14} /> Restart
                  </button>
                </div>
              ) : fcCurrentCard ? (
                <>
                  {/* Progress */}
                  <div className="w-full max-w-lg">
                    <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                      <span>{fcCurrentIndex + 1} / {fcCards.length}</span>
                      <span className="capitalize">{fcCurrentCard.source_type.replace(/_/g, " ")}</span>
                    </div>
                    <div className="h-1 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent-color)] transition-all"
                        style={{ width: `${((fcCurrentIndex + 1) / fcCards.length) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Card */}
                  <div
                    className="w-full max-w-lg cursor-pointer"
                    onClick={() => setFcIsFlipped((f) => !f)}
                    title="Click to flip"
                  >
                    <div className={`relative min-h-[240px] rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-8 flex flex-col justify-center transition-all duration-300 ${fcIsFlipped ? "shadow-lg shadow-[var(--accent-color)]/10" : ""}`}>
                      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-4">
                        {fcIsFlipped ? "Answer" : "Question — click to reveal"}
                      </div>
                      <p className="text-base text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
                        {fcIsFlipped ? fcCurrentCard.back : fcCurrentCard.front}
                      </p>
                      {!fcIsFlipped && (
                        <div className="absolute bottom-5 right-5 opacity-20">
                          <RotateCcw size={18} className="text-[var(--text-muted)]" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quality buttons (only when flipped) */}
                  {fcIsFlipped && (
                    <div className="w-full max-w-lg grid grid-cols-6 gap-2">
                      {QUALITY_LABELS.map(({ q, label, color, bg }) => (
                        <button
                          key={q}
                          onClick={() => fcReview(q)}
                          className={`py-2 rounded-xl text-xs font-medium transition-colors ${color} ${bg}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center gap-5 text-center max-w-md">
                  <Sparkles size={40} className="text-[var(--accent-color)] opacity-30" />
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">No cards to review</h2>
                  <p className="text-sm text-[var(--text-muted)]">
                    {selectedConcept
                      ? `Generate flashcards for "${selectedConcept.name}" to start learning.`
                      : "Select a concept or enter a topic to generate cards with AI."}
                  </p>
                </div>
              )}
            </div>

            {/* Manual create card modal */}
            {fcShowCreate && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="w-96 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-2xl p-6 shadow-2xl flex flex-col gap-4">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Add Card Manually</h3>
                  <textarea
                    autoFocus
                    value={fcNewFront}
                    onChange={(e) => setFcNewFront(e.target.value)}
                    placeholder="Front (question)"
                    rows={3}
                    className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] resize-none"
                  />
                  <textarea
                    value={fcNewBack}
                    onChange={(e) => setFcNewBack(e.target.value)}
                    placeholder="Back (answer)"
                    rows={3}
                    className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] resize-none"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => setFcShowCreate(false)} className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                      Cancel
                    </button>
                    <button onClick={fcCreateCard} className="flex-1 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm hover:opacity-90">
                      Add Card
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── LEARNING TAB ─────────────────────────────────────────── */}
        {tab === "learning" && (
          <div className="flex-1 overflow-hidden">
            <LearningPathView />
          </div>
        )}
      </div>
    </div>
  );
}
