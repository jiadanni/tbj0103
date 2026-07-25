import type { DeckCard } from "../lib/deck";

export type FeedMode = "test" | "study" | "info";

interface FeedCardProps {
  card: DeckCard;
  mode: FeedMode;
  revealed: boolean;
}

/**
 * One full-screen card.
 * - Test mode: Question only; tap toggles answer reveal.
 * - Study mode: Question + concise answer together.
 * - Info (Deep Dive) mode: Question + full detailed paragraph explanation & takeaways.
 */
export default function FeedCard({ card, mode, revealed }: FeedCardProps) {
  const showBack = mode !== "test" || revealed;

  return (
    <div className="flex h-full w-full flex-col items-center justify-between bg-zinc-950 px-6 pt-[calc(var(--safe-top)+3.5rem)] pb-[calc(var(--safe-bottom)+1.5rem)] text-center select-none overflow-hidden touch-none">
      <div className="flex flex-col items-center gap-3 w-full max-w-lg my-auto">
        <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
          <span className="rounded-full bg-purple-950/60 border border-purple-800/50 px-3 py-1 text-[11px] font-semibold tracking-wider text-purple-300 uppercase">
            {card.workspaceName}
          </span>
          {card.topic && (
            <span className="rounded-full border border-zinc-700/80 bg-zinc-900/80 px-3 py-1 text-[11px] font-medium tracking-wider text-zinc-400 uppercase">
              {card.topic}
            </span>
          )}
        </div>

        <h2 className="text-xl sm:text-2xl font-bold leading-snug text-zinc-50 tracking-tight">
          {card.front}
        </h2>

        {showBack ? (
          <div className="mt-4 w-full rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-5 text-left backdrop-blur-md transition-all duration-300 flex flex-col max-h-[35vh]">
            <div className="flex items-center gap-2 mb-2.5 shrink-0">
              <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                {mode === "info" ? "Detailed Explanation" : "Answer"}
              </span>
            </div>
            <div className="overflow-y-auto flex-1 pr-1 touch-pan-y">
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

      <div className="text-[10px] text-zinc-600 uppercase tracking-widest pt-4">
        Swipe up for next card
      </div>
    </div>
  );
}

