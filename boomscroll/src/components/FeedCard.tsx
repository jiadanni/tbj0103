import type { DeckCard } from "../lib/deck";
import { formatDifficultyLabel, getDifficultyColor, resolvePresetId } from "../lib/difficulty";

export type FeedMode = "study" | "test";

interface FeedCardProps {
  card: DeckCard;
  mode: FeedMode;
  revealed: boolean;
  activePresetId?: string;
}

/**
 * One full-screen card.
 * - Study mode: long-form explanation cards (`kind: "info"`), always shown.
 * - Test mode: question + answer; whether the answer is visible on arrival is
 *   decided by the caller (the "Show answer immediately" preference) and
 *   passed in as `revealed`.
 */
export default function FeedCard({ card, mode, revealed, activePresetId }: FeedCardProps) {
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

  // Suppress topic badge if it merely duplicates the workspace or is already in the title
  const cleanFront = card.front
    .replace(/^Core Engineering Concept:\s*/i, "")
    .replace(/\s*\(#?\d+\)$/, "");

  const isTopicRedundant =
    !card.topic ||
    card.topic.trim().toLowerCase() === card.workspaceName.trim().toLowerCase() ||
    cleanFront.toLowerCase().includes(card.topic.trim().toLowerCase());

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-zinc-950 px-6 pt-[calc(var(--safe-top)+2rem)] pb-[calc(var(--safe-bottom)+2rem)] text-center select-none overflow-hidden touch-none">
      <div className="flex min-h-0 flex-col items-center gap-3 w-full max-w-lg">
        <div className="shrink-0 text-xs font-semibold tracking-wide text-zinc-500">
          {card.workspaceName}
          {!isTopicRedundant && card.topic && <span> · {card.topic}</span>}
          {diffInfo && diffColors && (
            <span className={diffColors.text}> · {diffInfo.label}</span>
          )}
        </div>

        <h2 className="shrink-0 text-2xl sm:text-3xl font-bold leading-snug text-zinc-50 tracking-tight">
          {cleanFront}
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
            {!isStudy && (
              <div className="flex items-center gap-2 mb-2.5 shrink-0">
                <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  Answer
                </span>
              </div>
            )}
            <div className="overflow-y-auto flex-1 pr-1 touch-pan-y overscroll-contain">
              <p className="text-base sm:text-lg leading-relaxed text-zinc-200 whitespace-pre-line">
                {card.back}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-1.5 opacity-60">
            <p className="text-xs uppercase tracking-widest text-zinc-500 font-medium">
              Tap to reveal answer
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
