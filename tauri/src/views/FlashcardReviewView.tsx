/**
 * FlashcardReviewView — SM-2 spaced repetition card flip UI.
 * Primary flow: generate cards from a topic via AI.
 * Manual creation available as secondary option.
 */
import { useEffect, useState, useMemo, useCallback } from "react";
import { RotateCcw, Plus, CheckCircle, Sparkles, Loader2, ChevronDown, ChevronRight, Play, X, Filter } from "lucide-react";
import { api, type LearningCard, type ReviewStats, type FlashcardTopic, type SuggestedTopic, type ConceptNode } from "../lib/api";
import { useSettingsStore } from "../stores/settingsStore";
import { useScopedWorkspace, useBubbleUpFlag } from "../lib/workspacePane";
import { CompactMenuSelect } from "../components/CompactMenuSelect";
import { Tooltip } from "../components/Tooltip";
import { groupModelsByFamily } from "../lib/modelFamilyGrouping";
import { resolveModelDisplayName } from "../lib/modelDisplayName";
import type { AiModel } from "../lib/api";

const QUALITY_LABELS = [
  { q: 0, label: "Blackout",   color: "text-red-500",    bg: "bg-red-500/10 hover:bg-red-500/20" },
  { q: 1, label: "Forgot",     color: "text-orange-400",  bg: "bg-orange-400/10 hover:bg-orange-400/20" },
  { q: 2, label: "Hard",       color: "text-yellow-400",  bg: "bg-yellow-400/10 hover:bg-yellow-400/20" },
  { q: 3, label: "Good",       color: "text-green-400",   bg: "bg-green-400/10 hover:bg-green-400/20" },
  { q: 4, label: "Easy",       color: "text-blue-400",    bg: "bg-blue-400/10 hover:bg-blue-400/20" },
  { q: 5, label: "Perfect",    color: "text-indigo-400",  bg: "bg-indigo-400/10 hover:bg-indigo-400/20" },
];

interface TopicRowProps {
  topic: FlashcardTopic;
  indent: boolean;
  hasChildren: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  isLoading: boolean;
  disabled: boolean;
  cardCount: number;
  onGenerate: () => void;
}

function TopicRow({ topic, indent, hasChildren, collapsed, onToggle, isLoading, disabled, cardCount, onGenerate }: TopicRowProps) {
  const pct = Math.round(topic.mastery_score * 100);
  return (
    <div className={`group flex items-center gap-1 px-1 py-1 rounded hover:bg-[var(--bg-hover)] ${indent ? "ml-3" : ""}`}>
      {hasChildren ? (
        <button
          onClick={onToggle}
          className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        </button>
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1.5">
          <span
            className={`text-[11px] truncate ${indent ? "text-[var(--text-secondary)]" : "text-[var(--text-primary)]"}`}
            title={topic.topic}
          >
            {topic.topic}
          </span>
          <span
            className="text-[9px] text-[var(--text-muted)] tabular-nums shrink-0"
            title={`${topic.card_count} card${topic.card_count === 1 ? "" : "s"} in this topic`}
          >
            {topic.card_count} {topic.card_count === 1 ? "card" : "cards"}
          </span>
        </div>
        <div className="h-0.5 bg-[var(--bg-hover)] rounded-full overflow-hidden mt-0.5">
          <div
            className="h-full bg-[var(--accent-color)] transition-all"
            style={{ width: `${pct}%` }}
            title={`Mastery ${pct}%`}
          />
        </div>
      </div>
      <Tooltip content={`Generate ${cardCount} more`}>
        <button
          onClick={onGenerate}
          disabled={isLoading || disabled}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent-color)] hover:bg-[var(--bg-elevated)] disabled:opacity-40"
        >
          {isLoading ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
        </button>
      </Tooltip>
    </div>
  );
}

export default function FlashcardReviewView({
  conceptId,
  hideSidebar = false,
  onClearConcept,
}: { conceptId?: string | null; hideSidebar?: boolean; onClearConcept?: () => void } = {}) {
  const { activeWorkspaceId } = useScopedWorkspace();
  const includeDescendants = useBubbleUpFlag();
  const preferredModel = useSettingsStore((s) => s.preferredModel);
  const ollamaUrl = useSettingsStore((s) => s.ollamaUrl);

  const composerMode = useSettingsStore((s) => s.composerMode);
  const modelFamilyLabels = useSettingsStore((s) => s.modelFamilyLabels);
  const customModelFamilies = useSettingsStore((s) => s.customModelFamilies);
  const modelLabels = useSettingsStore((s) => s.modelLabels);

  const [cards, setCards] = useState<LearningCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [reviewed, setReviewed] = useState(0);
  const [concept, setConcept] = useState<ConceptNode | null>(null);

  useEffect(() => {
    if (!conceptId) {
      setConcept(null);
      return;
    }
    let isMounted = true;
    api.graph
      .getConcept(conceptId)
      .then((c) => {
        if (isMounted) {
          setConcept(c);
        }
      })
      .catch(() => {
        if (isMounted) {
          setConcept(null);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [conceptId]);

  // Generate state
  const [topic, setTopic] = useState("");
  const [cardCount, setCardCount] = useState(5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [selectedModel, setSelectedModel] = useState(preferredModel || "");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [aiModels, setAiModels] = useState<AiModel[]>([]);

  // Manual create state
  const [showCreate, setShowCreate] = useState(false);
  const [newFront, setNewFront] = useState("");
  const [newBack, setNewBack] = useState("");

  // Generate modal state
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [modalTopic, setModalTopic] = useState("");
  const [modalTopicId, setModalTopicId] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<"topic" | "custom">("custom");

  // Topic list state (chat-derived)
  const [topics, setTopics] = useState<FlashcardTopic[]>([]);
  const [generatingTopicId, setGeneratingTopicId] = useState<string | null>(null);
  const [showCustomTopic, setShowCustomTopic] = useState(false);
  const [suggested, setSuggested] = useState<SuggestedTopic | null>(null);
  const [collapsedRoots, setCollapsedRoots] = useState<Record<string, boolean>>({});

  const currentCard = cards[currentIndex] ?? null;

  // Load models
  useEffect(() => {
    api.aiModel.list().then((models) => {
      setAiModels(models);
      const enabled = models.filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
      if (enabled.length > 0) {
        const ids = enabled.map((m) => m.model_id);
        setAvailableModels(ids);
        if (!ids.includes(selectedModel)) {setSelectedModel(ids[0]);}
        return;
      }
      const disabledManagedIds = models.filter((m) => !m.enabled).map((m) => m.model_id);
      api.ollama.listModels(ollamaUrl).then((m) => {
        const names = m.map((x) => x.name).filter((name) => !disabledManagedIds.includes(name));
        setAvailableModels(names);
        if (!names.includes(selectedModel)) {setSelectedModel(names[0] || "");}
      }).catch(() => {});
    }).catch(() => {
      api.ollama.listModels(ollamaUrl).then((m) => {
        const names = m.map((x) => x.name);
        setAvailableModels(names);
        if (!names.includes(selectedModel)) {setSelectedModel(names[0] || "");}
      }).catch(() => {});
    });
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

  // Load due cards + stats
  useEffect(() => {
    if (!activeWorkspaceId) {return;}
    Promise.all([
      api.flashcard.listDue(activeWorkspaceId, { limit: 200, offset: 0, includeDescendants, conceptId: conceptId ?? undefined }),
      api.flashcard.getStats(activeWorkspaceId),
    ]).then(([due, s]) => {
      setCards(due);
      setStats(s);
      setCurrentIndex(0);
      setIsFlipped(false);
    }).catch(() => {});
  }, [activeWorkspaceId, includeDescendants, conceptId]);

  // Load chat-derived topic list + suggestion
  const refreshTopics = useCallback(() => {
    if (!activeWorkspaceId) {return;}
    api.flashcard.listTopics(activeWorkspaceId, includeDescendants)
      .then(setTopics)
      .catch(() => {});
    api.flashcard.suggestNext(activeWorkspaceId, includeDescendants)
      .then(setSuggested)
      .catch(() => {});
  }, [activeWorkspaceId, includeDescendants]);

  // Group topics into roots + children once per topics update.
  const topicTree = useMemo(() => {
    const byId = new Map(topics.map((t) => [t.id, t]));
    const roots: FlashcardTopic[] = [];
    const childrenOf = new Map<string, FlashcardTopic[]>();
    for (const t of topics) {
      const parentId = t.parent_topic_id && byId.has(t.parent_topic_id) ? t.parent_topic_id : null;
      if (parentId) {
        const arr = childrenOf.get(parentId) ?? [];
        arr.push(t);
        childrenOf.set(parentId, arr);
      } else {
        roots.push(t);
      }
    }
    return { roots, childrenOf };
  }, [topics]);

  function startSuggested() {
    if (!suggested) {return;}
    const topicCards = cards.filter((c) => c.topic_id === suggested.topic.id);
    if (topicCards.length > 0) {
      const idx = cards.findIndex((c) => c.id === topicCards[0].id);
      if (idx >= 0) {
        setCurrentIndex(idx);
        setIsFlipped(false);
        return;
      }
    }
    // No due cards loaded for that topic → generate a fresh batch.
    generateForTopic(suggested.topic.id);
  }

  useEffect(() => {
    refreshTopics();
  }, [refreshTopics]);

  async function generateForTopic(topicId: string) {
    if (!activeWorkspaceId || !selectedModel || generatingTopicId) {return;}
    setGeneratingTopicId(topicId);
    setGenerateError("");
    try {
      const generated = await api.flashcard.generateForTopic(activeWorkspaceId, topicId, selectedModel, cardCount, ollamaUrl);
      setCards((prev) => [...prev, ...generated]);
      refreshTopics();
      api.flashcard.getStats(activeWorkspaceId).then(setStats).catch(() => {});
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingTopicId(null);
    }
  }

  const review = useCallback(
    async (quality: number) => {
      if (!currentCard) {return;}
      const updated = await api.flashcard.review(currentCard.id, quality);
      setCards((prev) => {
        const next = [...prev];
        next[currentIndex] = updated;
        return next;
      });
      setReviewed((r) => r + 1);
      setIsFlipped(false);
      setCurrentIndex((i) => i + 1);
      if (currentIndex >= cards.length - 1) {
        if (activeWorkspaceId) {api.flashcard.getStats(activeWorkspaceId).then(setStats).catch(() => {});}
      }
      if (updated.topic_id) {
        refreshTopics();
      }
    },
    [currentCard, currentIndex, cards.length, activeWorkspaceId, refreshTopics],
  );

  async function generateCards(customTopicName?: string) {
    const targetTopic = customTopicName ?? topic;
    if (!targetTopic.trim() || !activeWorkspaceId || !selectedModel || isGenerating) {return;}
    setIsGenerating(true);
    setGenerateError("");
    try {
      const generated = await api.flashcard.generate(activeWorkspaceId, targetTopic.trim(), selectedModel, cardCount, ollamaUrl);
      setCards((prev) => [...prev, ...generated]);
      if (!customTopicName) { setTopic(""); }
      refreshTopics();
      // Refresh stats
      api.flashcard.getStats(activeWorkspaceId).then(setStats).catch(() => {});
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  }

  async function createCard() {
    if (!newFront.trim() || !newBack.trim() || !activeWorkspaceId) {return;}
    const card = await api.flashcard.create(activeWorkspaceId, newFront.trim(), newBack.trim());
    setCards((prev) => [...prev, card]);
    setNewFront("");
    setNewBack("");
    setShowCreate(false);
  }

  const isDone = cards.length > 0 && currentIndex >= cards.length;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showCreate || showGenerateModal) {return;}
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (currentCard && !isDone) {
          setIsFlipped((f) => !f);
        }
        return;
      }

      if (isFlipped && currentCard && !isDone) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 6) {
          e.preventDefault();
          review(num - 1);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showCreate, showGenerateModal, currentCard, isDone, isFlipped, review]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar — hidden when mounted inside LearningHubView which provides its own shared concept tree. */}
      {!hideSidebar && (
      <div className="w-56 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] flex flex-col overflow-hidden shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Flashcards</h2>
          <div className="flex items-center gap-1">
            <Tooltip content="Generate flashcards with AI">
              <button
                onClick={() => setShowGenerateModal(true)}
                className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--accent-color)]"
              >
                <Sparkles size={14} />
              </button>
            </Tooltip>
            <Tooltip content="Add card manually">
              <button
                onClick={() => setShowCreate(true)}
                className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <Plus size={14} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Stats — compact, with progress */}
        {stats && (
          <div className="px-4 py-3 border-b border-[var(--border-color)] space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Ready to review</span>
              <span className="text-lg font-semibold text-[var(--accent-color)] tabular-nums">{stats.due_today}</span>
            </div>
            <div className="h-1 bg-[var(--bg-hover)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--accent-color)] transition-all"
                style={{ width: stats.total_cards > 0 ? `${(stats.learned / stats.total_cards) * 100}%` : "0%" }}
                title={`${stats.learned} learned of ${stats.total_cards}`}
              />
            </div>
            <div className="flex justify-between text-[10px] text-[var(--text-muted)] tabular-nums">
              <span>{stats.learned} learned / {stats.total_cards} total</span>
              <span>ease {stats.avg_ease.toFixed(2)}</span>
            </div>
            {conceptId && (
              <div className="mt-2 pt-2 border-t border-[var(--border-color)]/60 text-[10px]">
                <div className="flex items-center justify-between text-[var(--text-secondary)] mb-1">
                  <span className="truncate" title={concept?.name || "Filtered concept"}>
                    Concept: {concept?.name || "Filtered"}
                  </span>
                  <span className="font-semibold text-[var(--accent-color)] tabular-nums shrink-0 ml-1">
                    {cards.length} cards
                  </span>
                </div>
                {onClearConcept && (
                  <button
                    onClick={onClearConcept}
                    className="text-[9px] text-[var(--accent-color)] hover:underline flex items-center gap-0.5"
                  >
                    <span>Show all {stats.due_today} workspace cards</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Suggested next review */}
        {suggested && (
          <div className="px-3 py-3 border-b border-[var(--border-color)]">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Suggested</div>
            <button
              onClick={startSuggested}
              disabled={!!generatingTopicId}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/30 hover:bg-[var(--accent-color)]/20 text-left disabled:opacity-50"
            >
              <Play size={12} className="text-[var(--accent-color)] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium text-[var(--text-primary)] truncate" title={suggested.topic.topic}>
                  {suggested.topic.topic}
                </div>
                <div className="text-[9px] text-[var(--text-muted)] truncate">{suggested.reason}</div>
              </div>
            </button>
          </div>
        )}

        {/* Topics — hierarchical (root then children) */}
        <div className="px-3 py-3 border-b border-[var(--border-color)] space-y-2 flex-1 overflow-y-auto min-h-0">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent-color)]">
              <Sparkles size={12} />
              Topics
            </div>
            <Tooltip content="Cards generated per click of the + button">
              <div className="shrink-0">
                <CompactMenuSelect
                  label="+"
                  value={cardCount.toString()}
                  options={[3, 5, 8, 10, 15, 20].map((n) => ({ value: n.toString(), label: `+${n}` }))}
                  onChange={(val) => setCardCount(Number(val))}
                  widthClassName="w-14"
                />
              </div>
            </Tooltip>
          </div>

          {topics.length === 0 ? (
            <p className="text-[10px] text-[var(--text-muted)] leading-snug">
              Topics will appear here as you chat.
            </p>
          ) : (
            <div className="space-y-0.5 -mx-1 px-1">
              {topicTree.roots.map((root) => {
                const children = topicTree.childrenOf.get(root.id) ?? [];
                const hasChildren = children.length > 0;
                const collapsed = collapsedRoots[root.id] ?? false;
                return (
                  <div key={root.id}>
                    <TopicRow
                      topic={root}
                      indent={false}
                      hasChildren={hasChildren}
                      collapsed={collapsed}
                      onToggle={() => setCollapsedRoots((p) => ({ ...p, [root.id]: !collapsed }))}
                      isLoading={generatingTopicId === root.id}
                      disabled={!!generatingTopicId || !selectedModel}
                      cardCount={cardCount}
                      onGenerate={() => generateForTopic(root.id)}
                    />
                    {hasChildren && !collapsed && children.map((child) => (
                      <TopicRow
                        key={child.id}
                        topic={child}
                        indent
                        hasChildren={false}
                        isLoading={generatingTopicId === child.id}
                        disabled={!!generatingTopicId || !selectedModel}
                        cardCount={cardCount}
                        onGenerate={() => generateForTopic(child.id)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Custom topic — disclosure; model + count live here */}
          <button
            type="button"
            onClick={() => setShowCustomTopic((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors pt-1"
          >
            {showCustomTopic ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Custom topic
          </button>
          {showCustomTopic && (
            <div className="space-y-1.5">
              <CompactMenuSelect
                label="AI Model"
                value={selectedModel}
                options={groupedModelOptions.options}
                groups={groupedModelOptions.groups}
                onChange={(val) => setSelectedModel(val)}
                widthClassName="w-full"
              />
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") {generateCards();} }}
                placeholder="e.g. Rust ownership model"
                disabled={isGenerating}
                className="w-full px-2 py-1 text-[11px] rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
              />
              <button
                onClick={() => generateCards()}
                disabled={isGenerating || !topic.trim() || !selectedModel}
                className="w-full flex items-center justify-center gap-1 py-1 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-secondary)] text-[10px] hover:border-[var(--accent-color)] disabled:opacity-40"
              >
                {isGenerating ? (
                  <><Loader2 size={10} className="animate-spin" /> Generating...</>
                ) : (
                  <>Generate {cardCount} cards</>
                )}
              </button>
            </div>
          )}
          {generateError && (
            <p className="text-[10px] text-red-400 leading-tight">{generateError}</p>
          )}
        </div>
      </div>
      )}

      {/* Card area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6 sm:p-8 overflow-y-auto min-h-0">
        {conceptId && !isDone && (
          <div className="w-full max-w-2xl xl:max-w-3xl flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[rgba(var(--accent-color-rgb),0.08)] border border-[rgba(var(--accent-color-rgb),0.2)] text-xs text-[var(--text-secondary)]">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-[var(--accent-color)] shrink-0 flex items-center gap-1">
                <Filter size={12} /> Concept:
              </span>
              <span className="font-medium text-[var(--text-primary)] truncate" title={concept?.name || "Selected Concept"}>
                {concept?.name || "Loading concept…"}
              </span>
              <span className="text-[var(--text-muted)] text-[11px] shrink-0">
                ({cards.length} cards · {stats?.due_today ?? cards.length} across workspace)
              </span>
            </div>
            {onClearConcept && (
              <button
                onClick={onClearConcept}
                className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-[var(--accent-color)] hover:underline ml-3"
              >
                <span>Review all</span>
                <X size={12} />
              </button>
            )}
          </div>
        )}

        {isDone ? (
          <div className="flex flex-col items-center gap-4 text-center max-w-lg">
            <CheckCircle size={48} className="text-green-400" />
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">Session Complete!</h2>
            <p className="text-sm text-[var(--text-muted)]">
              You reviewed {reviewed} card{reviewed !== 1 ? "s" : ""}. Practice whenever you feel like it next.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setCurrentIndex(0);
                  setIsFlipped(false);
                  setReviewed(0);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm hover:opacity-90"
              >
                <RotateCcw size={14} /> Restart
              </button>
              {topics.length > 0 && (
                <button
                  onClick={() => {
                    const next = topics.find((t) => t.card_count > 0) ?? topics[0];
                    if (next) {generateForTopic(next.id);}
                  }}
                  disabled={!!generatingTopicId || !selectedModel}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] text-sm hover:bg-[var(--bg-hover)] disabled:opacity-40"
                >
                  <Sparkles size={14} /> Study a new topic
                </button>
              )}
            </div>
          </div>
        ) : currentCard ? (
          <>
            {/* Progress */}
            <div className="w-full max-w-2xl xl:max-w-3xl">
              <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1.5">
                <span className="font-medium text-[var(--text-secondary)]">
                  Card {currentIndex + 1} of {cards.length}
                </span>
                <span className="capitalize text-[var(--text-muted)]">
                  {currentCard.source_type === "ai_generated" ? "AI generated" : currentCard.source_type}
                </span>
              </div>
              <div className="h-1.5 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--accent-color)] transition-all duration-200"
                  style={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }}
                />
              </div>
            </div>

            {/* Card */}
            <Tooltip content={isFlipped ? "Click or press Space to flip back" : "Click or press Space to reveal answer"}>
              <div
                className="w-full max-w-2xl xl:max-w-3xl cursor-pointer select-none"
                onClick={() => setIsFlipped((f) => !f)}
              >
                <div
                  className={`relative min-h-[280px] sm:min-h-[320px] rounded-2xl border bg-[var(--bg-elevated)] p-6 sm:p-8 flex flex-col justify-between transition-all duration-200 ${
                    isFlipped
                      ? "border-[var(--accent-color)]/30 shadow-xl shadow-[rgba(var(--accent-color-rgb),0.06)]"
                      : "border-[var(--border-color)] hover:border-[var(--accent-color)]/40 shadow-md"
                  }`}
                >
                  {!isFlipped ? (
                    <div className="flex flex-col flex-1 justify-between">
                      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                        <span className="font-semibold">Question</span>
                        <span className="flex items-center gap-1.5 normal-case tracking-normal text-[11px] text-[var(--text-muted)]">
                          <span>Press</span>
                          <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] font-mono text-[10px] text-[var(--text-secondary)]">
                            Space
                          </kbd>
                          <span>or click to reveal</span>
                        </span>
                      </div>
                      <p className="my-auto py-6 text-lg sm:text-xl text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap font-medium">
                        {currentCard.front}
                      </p>
                      <div className="flex items-center justify-end text-[var(--text-muted)] opacity-40">
                        <RotateCcw size={16} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col flex-1 justify-between">
                      <div>
                        <div className="text-[10px] uppercase font-semibold tracking-wider text-[var(--text-muted)] mb-1.5">
                          Question
                        </div>
                        <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                          {currentCard.front}
                        </p>
                      </div>

                      <div className="my-4 border-t border-[var(--border-color)]/70" />

                      <div className="my-auto py-2">
                        <div className="text-[11px] uppercase font-semibold tracking-wider text-[var(--accent-color)] mb-2">
                          Answer
                        </div>
                        <p className="text-base sm:text-lg text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap font-medium">
                          {currentCard.back}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-3 text-[10px] text-[var(--text-muted)]">
                        <span className="flex items-center gap-1">
                          <RotateCcw size={12} /> Click or <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] font-mono text-[9px] text-[var(--text-secondary)]">Space</kbd> to flip back
                        </span>
                        <span>Rate below to advance</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Tooltip>

            {/* Quality buttons (only when flipped) */}
            {isFlipped && (
              <div className="w-full max-w-2xl xl:max-w-3xl grid grid-cols-6 gap-2 sm:gap-3">
                {QUALITY_LABELS.map(({ q, label, color, bg }) => (
                  <button
                    key={q}
                    onClick={() => review(q)}
                    className={`group py-2.5 px-1.5 sm:px-2 rounded-xl text-xs font-medium transition-all flex flex-col items-center justify-center gap-1 border border-transparent hover:border-current/30 active:scale-[0.98] ${color} ${bg}`}
                  >
                    <span className="font-semibold text-xs tracking-tight">{label}</span>
                    <kbd className="px-1.5 py-0.5 text-[9px] rounded bg-black/15 dark:bg-white/10 font-mono opacity-60 group-hover:opacity-100 transition-opacity">
                      {q + 1}
                    </kbd>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-5 text-center max-w-md">
            <Sparkles size={40} className="text-[var(--accent-color)] opacity-50" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">All caught up!</h2>
            <p className="text-sm text-[var(--text-muted)]">
              All cards have been reviewed for now. Generate new flashcards from workspace topics or add custom cards anytime.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
              <button
                onClick={() => setShowGenerateModal(true)}
                disabled={!selectedModel || isGenerating}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--accent-color)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Sparkles size={16} /> Generate Flashcards
              </button>
              {suggested && (
                <button
                  onClick={startSuggested}
                  disabled={!!generatingTopicId}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/30 text-[var(--accent-color)] text-sm font-medium hover:bg-[var(--accent-color)]/20 transition-colors disabled:opacity-50"
                >
                  <Play size={14} /> Study {suggested.topic.topic}
                </button>
              )}
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-[var(--text-secondary)] text-sm font-medium hover:bg-[var(--bg-hover)] transition-colors"
              >
                <Plus size={16} /> Add Card Manually
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Manual create card modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowCreate(false)}
          onKeyDown={(e) => { if (e.key === "Escape") { setShowCreate(false); } }}
        >
          <div
            className="w-96 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Add Card Manually</h3>
            <textarea
              autoFocus
              value={newFront}
              onChange={(e) => setNewFront(e.target.value)}
              placeholder="Front (question)"
              rows={3}
              className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] resize-none"
            />
            <textarea
              value={newBack}
              onChange={(e) => setNewBack(e.target.value)}
              placeholder="Back (answer)"
              rows={3}
              className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] resize-none"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                Cancel
              </button>
              <button onClick={createCard} className="flex-1 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm hover:opacity-90">
                Add Card
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Generate flashcards modal */}
      {showGenerateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowGenerateModal(false)}
          onKeyDown={(e) => { if (e.key === "Escape") { setShowGenerateModal(false); } }}
        >
          <div
            className="w-[420px] bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-[var(--accent-color)]" />
                <h3 className="text-base font-semibold text-[var(--text-primary)]">Generate Flashcards with AI</h3>
              </div>
              <button
                onClick={() => setShowGenerateModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm px-1.5 py-0.5 rounded hover:bg-[var(--bg-hover)]"
              >
                ✕
              </button>
            </div>

            {/* Mode selection tabs */}
            <div className="flex gap-2 rounded-lg bg-[var(--bg-primary)] p-1 border border-[var(--border-color)]">
              <button
                onClick={() => setModalMode("custom")}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  modalMode === "custom"
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Custom Topic
              </button>
              {topics.length > 0 && (
                <button
                  onClick={() => {
                    setModalMode("topic");
                    if (!modalTopicId && topics.length > 0) { setModalTopicId(topics[0].id); }
                  }}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    modalMode === "topic"
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  Workspace Topic ({topics.length})
                </button>
              )}
            </div>

            {modalMode === "custom" ? (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-secondary)]">Topic or Subject</label>
                <input
                  autoFocus
                  value={modalTopic}
                  onChange={(e) => setModalTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && modalTopic.trim() && selectedModel && !isGenerating) {
                      generateCards(modalTopic).then(() => {
                        setModalTopic("");
                        setShowGenerateModal(false);
                      });
                    }
                  }}
                  placeholder="e.g. Memory safety in Rust, French grammar rules"
                  disabled={isGenerating}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-secondary)]">Select Workspace Topic</label>
                <select
                  value={modalTopicId ?? ""}
                  onChange={(e) => setModalTopicId(e.target.value)}
                  disabled={isGenerating}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                >
                  {topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.topic} ({t.card_count} existing card{t.card_count === 1 ? "" : "s"})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-secondary)]">AI Model</label>
                <CompactMenuSelect
                  label="Model"
                  value={selectedModel}
                  options={groupedModelOptions.options}
                  groups={groupedModelOptions.groups}
                  onChange={(val) => setSelectedModel(val)}
                  widthClassName="w-full"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-secondary)]">Card Count</label>
                <CompactMenuSelect
                  label="Cards"
                  value={cardCount.toString()}
                  options={[3, 5, 8, 10, 15, 20].map((n) => ({ value: n.toString(), label: `${n} cards` }))}
                  onChange={(val) => setCardCount(Number(val))}
                  widthClassName="w-full"
                />
              </div>
            </div>

            {generateError && (
              <p className="text-xs text-red-400 font-medium">{generateError}</p>
            )}

            <div className="flex gap-2 pt-2 border-t border-[var(--border-color)]">
              <button
                onClick={() => setShowGenerateModal(false)}
                className="flex-1 py-2 rounded-xl border border-[var(--border-color)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (modalMode === "topic" && modalTopicId) {
                    await generateForTopic(modalTopicId);
                    setShowGenerateModal(false);
                  } else if (modalMode === "custom" && modalTopic.trim()) {
                    await generateCards(modalTopic);
                    setModalTopic("");
                    setShowGenerateModal(false);
                  }
                }}
                disabled={
                  isGenerating ||
                  !selectedModel ||
                  (modalMode === "custom" && !modalTopic.trim()) ||
                  (modalMode === "topic" && !modalTopicId)
                }
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-[var(--accent-color)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-40"
              >
                {isGenerating ? (
                  <><Loader2 size={14} className="animate-spin" /> Generating…</>
                ) : (
                  <><Sparkles size={14} /> Generate Cards</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Named export used by `LearningHubView` so the Review tab can mount the
 * card player while passing a `conceptId` filter from the shared sidebar.
 * The default export remains the full sidebar-plus-player surface used by
 * the legacy `/flashcards` route and any direct mounts. */
export const ReviewPane = FlashcardReviewView;
