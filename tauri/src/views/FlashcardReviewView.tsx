/**
 * FlashcardReviewView — SM-2 spaced repetition card flip UI.
 * Primary flow: generate cards from a topic via AI.
 * Manual creation available as secondary option.
 */
import { useEffect, useState, useMemo } from "react";
import { RotateCcw, Plus, CheckCircle, Sparkles, Loader2 } from "lucide-react";
import { api, type LearningCard, type ReviewStats } from "../lib/api";
import { useSettingsStore } from "../stores/settingsStore";
import { useScopedWorkspace, useBubbleUpFlag } from "../lib/workspacePane";
import CompactMenuSelect from "../components/CompactMenuSelect";
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

export default function FlashcardReviewView() {
  const { activeWorkspaceId } = useScopedWorkspace();
  const includeDescendants = useBubbleUpFlag();
  const { preferredModel, ollamaUrl } = useSettingsStore();

  const composerMode = useSettingsStore((s) => s.composerMode);
  const modelFamilyLabels = useSettingsStore((s) => s.modelFamilyLabels);
  const customModelFamilies = useSettingsStore((s) => s.customModelFamilies);
  const modelLabels = useSettingsStore((s) => s.modelLabels);

  const [cards, setCards] = useState<LearningCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [reviewed, setReviewed] = useState(0);

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
      api.flashcard.listDue(activeWorkspaceId, { limit: 200, offset: 0, includeDescendants }),
      api.flashcard.getStats(activeWorkspaceId),
    ]).then(([due, s]) => {
      setCards(due);
      setStats(s);
      setCurrentIndex(0);
      setIsFlipped(false);
    }).catch(() => {});
  }, [activeWorkspaceId, includeDescendants]);

  async function review(quality: number) {
    if (!currentCard) {return;}
    const updated = await api.flashcard.review(currentCard.id, quality);
    setCards((prev) => {
      const next = [...prev];
      next[currentIndex] = updated;
      return next;
    });
    setReviewed((r) => r + 1);
    setIsFlipped(false);
    if (currentIndex < cards.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      if (activeWorkspaceId) {api.flashcard.getStats(activeWorkspaceId).then(setStats).catch(() => {});}
    }
  }

  async function generateCards() {
    if (!topic.trim() || !activeWorkspaceId || !selectedModel || isGenerating) {return;}
    setIsGenerating(true);
    setGenerateError("");
    try {
      const generated = await api.flashcard.generate(activeWorkspaceId, topic.trim(), selectedModel, cardCount, ollamaUrl);
      setCards((prev) => [...prev, ...generated]);
      setTopic("");
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

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-56 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] flex flex-col overflow-hidden shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Flashcards</h2>
          <button
            onClick={() => setShowCreate(true)}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="Add card manually"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Generate from topic — primary action */}
        <div className="px-3 py-3 border-b border-[var(--border-color)] space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent-color)]">
            <Sparkles size={12} />
            Generate from Topic
          </div>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") {generateCards();} }}
            placeholder="e.g. Rust ownership model"
            disabled={isGenerating}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] transition-colors"
          />
          <div className="flex gap-1.5">
            <CompactMenuSelect
              label="AI Model"
              value={selectedModel}
              options={groupedModelOptions.options}
              groups={groupedModelOptions.groups}
              onChange={(val) => setSelectedModel(val)}
              widthClassName="min-w-0 flex-1"
            />
            <CompactMenuSelect
              label="Count"
              value={cardCount.toString()}
              options={[3, 5, 8, 10, 15, 20].map((n) => ({ value: n.toString(), label: n.toString() }))}
              onChange={(val) => setCardCount(Number(val))}
              widthClassName="w-16"
            />
          </div>
          <button
            onClick={generateCards}
            disabled={isGenerating || !topic.trim() || !selectedModel}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[var(--accent-color)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {isGenerating ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles size={12} />
                Generate {cardCount} Cards
              </>
            )}
          </button>
          {generateError && (
            <p className="text-[10px] text-red-400 leading-tight">{generateError}</p>
          )}
        </div>

        {/* Stats */}
        {stats && (
          <div className="px-4 py-2.5 border-b border-[var(--border-color)] space-y-1.5">
            {[
              { label: "Total", value: stats.total_cards },
              { label: "Due today", value: stats.due_today, accent: true },
              { label: "Learned", value: stats.learned },
              { label: "Avg ease", value: stats.avg_ease.toFixed(2) },
            ].map(({ label, value, accent }) => (
              <div key={label} className="flex justify-between items-center text-xs">
                <span className="text-[var(--text-muted)]">{label}</span>
                <span className={accent ? "text-[var(--accent-color)] font-semibold" : "text-[var(--text-secondary)]"}>
                  {value}
                </span>
              </div>
            ))}
            {reviewed > 0 && (
              <div className="text-xs text-[var(--text-muted)] pt-1">
                Reviewed: <span className="text-[var(--accent-color)]">{reviewed}</span>
              </div>
            )}
          </div>
        )}

        {/* Card list */}
        <div className="flex-1 overflow-y-auto">
          {cards.map((c, i) => (
            <button
              key={c.id}
              onClick={() => { setCurrentIndex(i); setIsFlipped(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs truncate transition-colors ${
                i === currentIndex
                  ? "bg-[var(--accent-color)]/20 text-[var(--accent-color)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {c.front.slice(0, 32)}{c.front.length > 32 ? "\u2026" : ""}
            </button>
          ))}
          {cards.length === 0 && (
            <p className="text-xs text-[var(--text-muted)] py-4 px-3 text-center">
              {activeWorkspaceId ? "No cards due. Generate some from a topic above!" : "No workspace active"}
            </p>
          )}
        </div>
      </div>

      {/* Card area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
        {isDone ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <CheckCircle size={48} className="text-green-400" />
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">Session Complete!</h2>
            <p className="text-sm text-[var(--text-muted)]">
              You reviewed {reviewed} card{reviewed !== 1 ? "s" : ""}. Come back tomorrow for more.
            </p>
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
          </div>
        ) : currentCard ? (
          <>
            {/* Progress */}
            <div className="w-full max-w-lg">
              <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                <span>{currentIndex + 1} / {cards.length}</span>
                <span className="capitalize">{currentCard.source_type === "ai_generated" ? "AI generated" : currentCard.source_type}</span>
              </div>
              <div className="h-1 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--accent-color)] transition-all"
                  style={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }}
                />
              </div>
            </div>

            {/* Card */}
            <div
              className="w-full max-w-lg cursor-pointer"
              onClick={() => setIsFlipped((f) => !f)}
              title="Click to flip"
            >
              <div className={`relative min-h-[220px] rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-7 flex flex-col justify-center transition-all duration-300 ${isFlipped ? "shadow-lg shadow-[var(--accent-color)]/10" : ""}`}>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-3">
                  {isFlipped ? "Answer" : "Question \u2014 click to reveal"}
                </div>
                <p className="text-base text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
                  {isFlipped ? currentCard.back : currentCard.front}
                </p>
                {!isFlipped && (
                  <div className="absolute bottom-4 right-4 opacity-30">
                    <RotateCcw size={16} className="text-[var(--text-muted)]" />
                  </div>
                )}
              </div>
            </div>

            {/* Quality buttons (only when flipped) */}
            {isFlipped && (
              <div className="w-full max-w-lg grid grid-cols-6 gap-2">
                {QUALITY_LABELS.map(({ q, label, color, bg }) => (
                  <button
                    key={q}
                    onClick={() => review(q)}
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
            <Sparkles size={40} className="text-[var(--accent-color)] opacity-50" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">No cards due right now</h2>
            <p className="text-sm text-[var(--text-muted)]">
              Type a topic in the sidebar and generate flashcards with AI, or add one manually with the + button.
            </p>
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
    </div>
  );
}
