import type { DeckCard } from "../lib/deck";

export type FeedMode = "info" | "test";

interface FeedCardProps {
  card: DeckCard;
  mode: FeedMode;
  revealed: boolean;
}

/**
 * One full-screen text card.
 * Info mode: question and answer are always shown together, reading-feed style.
 * Test mode: front only; the parent toggles `revealed` on tap.
 */
export default function FeedCard({ card, mode, revealed }: FeedCardProps) {
  const showBack = mode === "info" || revealed;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 px-8 text-center select-none">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs uppercase tracking-widest text-zinc-300">
          {card.workspaceName}
        </span>
        {card.topic && (
          <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs uppercase tracking-widest text-zinc-400">
            {card.topic}
          </span>
        )}
      </div>
      <p className="text-2xl font-semibold leading-snug text-zinc-50">{card.front}</p>
      {showBack ? (
        <p className="text-lg leading-relaxed text-zinc-300">{card.back}</p>
      ) : (
        <p className="text-xs uppercase tracking-widest text-zinc-600">tap to reveal</p>
      )}
    </div>
  );
}
