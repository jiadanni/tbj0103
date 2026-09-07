import type { FeedCard } from "../../lib/api";
import {
  formatDifficultyLabel,
  getDifficultyColor,
  resolvePresetId,
} from "../../lib/feed/difficulty";
import type { DifficultyScore } from "../../lib/feed/difficulty";

export type FeedMode = "study" | "test";

interface FeedCardViewProps {
  card: FeedCard;
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
 * One full-pane card in the Boom Scroll feed.
 *
 * - Study mode: long-form explanation cards (`kind: "info"`), always shown.
 * - Test mode: question + answer, revealed by the caller.
 *
 * Ported from the BoomScroll companion app, restyled onto the desktop's theme
 * tokens so it reads correctly in both light and dark.
 */
export default function FeedCardView({
  card,
  mode,
  revealed,
  activePresetId,
  onBanish,
}: FeedCardViewProps) {
  const isStudy = mode === "study";
  const showBack = isStudy || revealed;

  const diffInfo = card.difficulty
    ? formatDifficultyLabel(
        card.difficulty as DifficultyScore,
        resolvePresetId(
          { difficultyPreset: card.difficulty_preset ?? undefined },
          activePresetId,
        ),
        card.difficulty_label ?? undefined,
      )
    : null;
  const diffColors = diffInfo ? getDifficultyColor(diffInfo.score) : null;

  return (
    <div className="flex h-full w-full select-none flex-col items-center justify-between overflow-hidden bg-[var(--bg-primary)] px-6 pb-6 pt-14 text-center">
      <div className="my-auto flex min-h-0 w-full max-w-2xl flex-col items-center gap-3">
        <div className="mb-2 flex shrink-0 flex-wrap items-center justify-center gap-2">
          <span className="rounded-full border border-[rgba(var(--accent-color-rgb),0.35)] bg-[rgba(var(--accent-color-rgb),0.12)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-color)]">
            {card.workspace_name}
          </span>
          {card.topic && (
            <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
              {card.topic}
            </span>
          )}
          {diffInfo && diffColors && (
            <span
              style={diffColors.style}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider"
            >
              <span style={diffColors.dotStyle} className="h-1.5 w-1.5 rounded-full" />
              L{diffInfo.score} • {diffInfo.label}
            </span>
          )}
        </div>

        <h2 className="shrink-0 text-xl font-bold leading-snug tracking-tight text-[var(--text-primary)] sm:text-2xl">
          {card.front}
        </h2>

        {showBack ? (
          // Study cards carry multi-paragraph explanations and have no
          // question/answer split to make room for, so they get most of the
          // pane. Test answers stay compact.
          <div
            className={`mt-4 flex w-full min-h-0 flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-5 text-left transition-all duration-300 ${
              isStudy ? "flex-1" : "max-h-[35vh]"
            }`}
          >
            <div className="mb-2.5 flex shrink-0 items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                {isStudy ? "Detailed explanation" : "Answer"}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--text-secondary)] sm:text-base">
                {card.back}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-1.5 opacity-70">
            <span className="text-lg">⚡</span>
            <p className="text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">
              Click or press Space to reveal
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
            // the answer on click. Stopping the event at pointer-down keeps
            // both from firing when this is pressed.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onBanish();
            }}
            className="flex min-h-[36px] items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 text-xs font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
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
        <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          Scroll or press ↓ for the next card
        </div>
      </div>
    </div>
  );
}
