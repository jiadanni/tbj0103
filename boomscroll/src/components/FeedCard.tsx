import type { DeckCard } from "../lib/deck";
import { formatDifficultyLabel, getDifficultyColor, resolvePresetId } from "../lib/difficulty";

export type FeedMode = "study" | "test";

interface FeedCardProps {
  card: DeckCard;
  mode: FeedMode;
  revealed: boolean;
  activePresetId?: string;
  /**
   * Banish this card from the feed. Omitted for the background preview card,
   * which must not offer a live control.
   */
  onBanish?: () => void;
}

/**
 * One full-screen card.
 * - Study mode: long-form explanation cards (`kind: "info"`), always shown.
 * - Test mode: question + answer; whether the answer is visible on arrival is
 *   decided by the caller (the "Show answer immediately" preference) and
 *   passed in as `revealed`.
 */
export default function FeedCard({ card, mode, revealed, activePresetId, onBanish }: FeedCardProps) {
  const isStudy = mode === "study";
  const showBack = isStudy || revealed;

  const diffInfo = card.difficulty
    ? formatDifficultyLabel(
        card.difficulty,
        resolvePresetId(card, activePresetId),
        card.difficultyLabel,
      )
    : null;
  const diffColors = diffInfo ? getDifficultyColor(diffInfo.score) : null;

  return (
    <div className="flex h-full w-full flex-col items-center justify-between bg-zinc-950 px-6 pt-[calc(var(--safe-top)+3.5rem)] pb-[calc(var(--safe-bottom)+1.5rem)] text-center select-none overflow-hidden touch-none">
      <div className="flex min-h-0 flex-col items-center gap-3 w-full max-w-lg my-auto">
        <div className="flex flex-wrap items-center justify-center gap-2 mb-2 shrink-0">
          <span className="rounded-full bg-purple-950/60 border border-purple-800/50 px-3 py-1 text-[11px] font-semibold tracking-wider text-purple-300 uppercase">
            {card.workspaceName}
          </span>
          {card.topic && (
            <span className="rounded-full border border-zinc-700/80 bg-zinc-900/80 px-3 py-1 text-[11px] font-medium tracking-wider text-zinc-400 uppercase">
              {card.topic}
            </span>
          )}
          {diffInfo && diffColors && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wider uppercase ${diffColors.bg} ${diffColors.border} ${diffColors.text}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${diffColors.dot}`} />
              L{diffInfo.score} • {diffInfo.label}
            </span>
          )}
        </div>

        <h2 className="shrink-0 text-xl sm:text-2xl font-bold leading-snug text-zinc-50 tracking-tight">
          {card.front}
        </h2>

        {showBack ? (
          // Study cards carry multi-paragraph explanations and have no
          // question/answer split to make room for, so they get most of the
          // screen. Test answers stay compact.
          <div
            className={`mt-4 w-full rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-5 text-left backdrop-blur-md transition-all duration-300 flex min-h-0 flex-col ${
              isStudy ? "flex-1" : "max-h-[35vh]"
            }`}
          >
            <div className="flex items-center gap-2 mb-2.5 shrink-0">
              <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                {isStudy ? "Detailed Explanation" : "Answer"}
              </span>
            </div>
            <div className="overflow-y-auto flex-1 pr-1 touch-pan-y overscroll-contain">
              <p className="text-sm sm:text-base leading-relaxed text-zinc-200 whitespace-pre-line">
                {card.back}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-1.5 opacity-60">
            <span className="text-lg">⚡</span>
            <p className="text-xs uppercase tracking-widest text-zinc-500 font-medium">
              Tap to reveal answer
            </p>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-3 pt-4">
        {onBanish && (
          <button
            type="button"
            aria-label="Banish this card"
            title="Hold this card out of the feed"
            // The card root captures pointers for the swipe gesture and toggles
            // the answer on tap. Stopping the event at pointer-down keeps both
            // from firing when this is pressed.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onBanish();
            }}
            className="flex min-h-[44px] items-center gap-1.5 rounded-full border border-zinc-800/80 bg-zinc-900/60 px-4 text-xs font-medium text-zinc-500 backdrop-blur-md transition-colors hover:border-zinc-700 hover:text-zinc-300 active:opacity-70"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
            Banish
          </button>
        )}
        <div className="text-[10px] text-zinc-600 uppercase tracking-widest">
          Swipe up for next card
        </div>
      </div>
    </div>
  );
}
