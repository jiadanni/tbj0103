/**
 * FlashcardReviewView — SM-2 spaced repetition card flip UI.
 * Mirrors FlashcardReviewView.swift.
 */
import { useEffect, useState } from "react";
import { RotateCcw, Plus, CheckCircle, XCircle, Minus, ChevronRight } from "lucide-react";
import { api, type LearningCard, type ReviewStats } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

const QUALITY_LABELS = [
  { q: 0, label: "Blackout",   color: "text-red-500",    bg: "bg-red-500/10 hover:bg-red-500/20" },
  { q: 1, label: "Forgot",     color: "text-orange-400",  bg: "bg-orange-400/10 hover:bg-orange-400/20" },
  { q: 2, label: "Hard",       color: "text-yellow-400",  bg: "bg-yellow-400/10 hover:bg-yellow-400/20" },
  { q: 3, label: "Good",       color: "text-green-400",   bg: "bg-green-400/10 hover:bg-green-400/20" },
  { q: 4, label: "Easy",       color: "text-blue-400",    bg: "bg-blue-400/10 hover:bg-blue-400/20" },
  { q: 5, label: "Perfect",    color: "text-indigo-400",  bg: "bg-indigo-400/10 hover:bg-indigo-400/20" },
];

export default function FlashcardReviewView() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [cards, setCards] = useState<LearningCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [reviewed, setReviewed] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [newFront, setNewFront] = useState("");
  const [newBack, setNewBack] = useState("");

  const currentCard = cards[currentIndex] ?? null;

  useEffect(() => {
    if (!activeWorkspaceId) return;
    Promise.all([
      api.flashcard.listDue(activeWorkspaceId),
      api.flashcard.getStats(activeWorkspaceId),
    ]).then(([due, s]) => {
      setCards(due);
      setStats(s);
      setCurrentIndex(0);
      setIsFlipped(false);
    }).catch(() => {});
  }, [activeWorkspaceId]);

  async function review(quality: number) {
    if (!currentCard) return;
    const updated = await api.flashcard.review(currentCard.id, quality);
    setCards((prev) => {
      const next = [...prev];
      next[currentIndex] = updated;
      return next;
    });
    setReviewed((r) => r + 1);
    setIsFlipped(false);
    // Move to next card
    if (currentIndex < cards.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      // Done — reload stats
      if (activeWorkspaceId) api.flashcard.getStats(activeWorkspaceId).then(setStats).catch(() => {});
    }
  }

  async function createCard() {
    if (!newFront.trim() || !newBack.trim() || !activeWorkspaceId) return;
    const card = await api.flashcard.create(activeWorkspaceId, newFront.trim(), newBack.trim());
    setCards((prev) => [...prev, card]);
    setNewFront("");
    setNewBack("");
    setShowCreate(false);
  }

  const isDone = cards.length > 0 && currentIndex >= cards.length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Stats sidebar */}
      <div className="w-56 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] flex flex-col px-4 py-4 gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Flashcards</h2>
          <button
            onClick={() => setShowCreate(true)}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <Plus size={14} />
          </button>
        </div>

        {stats && (
          <div className="space-y-2">
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
          </div>
        )}

        {reviewed > 0 && (
          <div className="text-xs text-[var(--text-muted)]">
            Reviewed this session: <span className="text-[var(--accent-color)]">{reviewed}</span>
          </div>
        )}

        {/* Card list */}
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {cards.map((c, i) => (
            <button
              key={c.id}
              onClick={() => { setCurrentIndex(i); setIsFlipped(false); }}
              className={`w-full text-left px-2 py-1.5 rounded text-xs truncate transition-colors ${
                i === currentIndex
                  ? "bg-[var(--accent-color)]/20 text-[var(--accent-color)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {c.front.slice(0, 32)}{c.front.length > 32 ? "…" : ""}
            </button>
          ))}
          {cards.length === 0 && (
            <p className="text-xs text-[var(--text-muted)] py-2">
              {activeWorkspaceId ? "No cards due — great job!" : "No workspace active"}
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
                <span className="capitalize">{currentCard.source_type}</span>
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
                  {isFlipped ? "Answer" : "Question — click to reveal"}
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
          <p className="text-[var(--text-muted)] text-sm">
            {activeWorkspaceId ? "No cards due right now" : "No workspace active"}
          </p>
        )}
      </div>

      {/* Create card modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-96 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-2xl p-6 shadow-2xl flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">New Flashcard</h3>
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
