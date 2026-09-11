import React, { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { ComposerSuggestion } from "../lib/composerSuggestions";

interface WaterfallSuggestionsProps {
  suggestions: ComposerSuggestion[];
  onSelect: (suggestion: ComposerSuggestion) => void;
  /** Blacklist a prompt (hover X). Optional so the component works without it. */
  onDismiss?: (suggestion: ComposerSuggestion) => void;
}

// The per-card leading icon was removed rather than re-keyed. It used to
// regex-match prompt text for web-dev terms (react/css/js/count) with a generic
// document fallback, so outside a front-end workspace every card showed the same
// fallback glyph. Keying it off suggestion provenance instead does not help:
// buildWorkspaceSuggestionRow returns prompt-bank OR AI OR keyword prompts, never
// a mix, so every card visible at once comes from one source and would still
// carry one identical icon. A glyph that is the same on all six cards is not a
// signal, so the prompt text now starts at the card edge.

// Six slots (3 per side) that bow the prompt cards into an arc around the centered
// button. Each card anchors to its near edge (`side`) by `inset` at vertical center
// `top`. Card WIDTH fills the gap from that edge to a reserved center gutter, so the
// heading + button stay clear at any pane width — cards shrink instead of crowding
// the middle. The arc comes from varying inset by row: the MIDDLE row hugs the edge
// (small inset, furthest toward the side) while the TOP and BOTTOM rows pull inward
// (large inset), tracing a convex `‹ ›` bracket framing the button.
type ArcSlot = { side: "left" | "right"; top: string; inset: string };

// Half-width of the protected center zone (heading + button). A card's inner edge
// stays at least this far from the container's horizontal center.
const CENTER_GUTTER = "11rem";

const EDGE = "1.5rem"; // middle row — hugs the pane edge (widest point of the arc)
const PULLED = "5rem"; // top/bottom rows — pulled inward toward center

const ARC_SLOTS: ArcSlot[] = [
  { side: "left", top: "20%", inset: PULLED },
  { side: "left", top: "50%", inset: EDGE },
  { side: "left", top: "80%", inset: PULLED },
  { side: "right", top: "20%", inset: PULLED },
  { side: "right", top: "50%", inset: EDGE },
  { side: "right", top: "80%", inset: PULLED },
];

const SLOT_COUNT = ARC_SLOTS.length;
const CYCLE_MS = 9000; // how long each set of prompts stays before rotating
const FADE_MS = 900; // cross-fade duration when swapping prompts
const FADE_OPACITY = 0.55; // dim (not vanish) during the swap — keeps it subtle

export function WaterfallSuggestions({ suggestions, onSelect, onDismiss }: WaterfallSuggestionsProps) {
  // Rotate which window of prompts fills the slots so the arc feels alive when
  // there are more suggestions than visible slots. `fading` briefly dims the cards
  // around each swap so prompts cross-fade gently instead of popping.
  const [page, setPage] = useState(0);
  const [fading, setFading] = useState(false);

  const canCycle = suggestions.length > SLOT_COUNT;

  // Reset rotation and dimming when suggestions change (e.g. workspace switch)
  const suggestionsKey = useMemo(
    () => suggestions.map((s) => s.id).join(","),
    [suggestions],
  );
  const [prevSuggestionsKey, setPrevSuggestionsKey] = useState(suggestionsKey);
  if (suggestionsKey !== prevSuggestionsKey) {
    setPrevSuggestionsKey(suggestionsKey);
    setPage(0);
    setFading(false);
  }

  useEffect(() => {
    if (!canCycle) { return; }
    const tick = window.setInterval(() => {
      setFading(true);
      window.setTimeout(() => {
        setPage((p) => p + 1);
        setFading(false);
      }, FADE_MS);
    }, CYCLE_MS);
    return () => window.clearInterval(tick);
  }, [canCycle]);

  const arranged = useMemo(() => {
    if (suggestions.length === 0) { return []; }
    return ARC_SLOTS.map((slot, i) => {
      const suggestion = suggestions[(page * SLOT_COUNT + i) % suggestions.length];
      return { slot, suggestion, slotIndex: i };
    });
  }, [suggestions, page]);

  if (suggestions.length === 0) { return null; }

  return (
    <div className="pointer-events-none absolute inset-0 select-none overflow-hidden [container-type:inline-size]">
      {arranged.map(({ slot, suggestion, slotIndex }) => {
        // Anchor to the near edge by `inset`; width fills the gap from there to the
        // reserved center gutter, capped at a comfortable max. On narrow panes the
        // gap shrinks so cards stay out of the center instead of overlapping it.
        const availableWidth = `calc(50cqw - ${CENTER_GUTTER} - ${slot.inset})`;
        const positionStyle: React.CSSProperties = {
          top: slot.top,
          width: `clamp(11rem, ${availableWidth}, 18rem)`,
          transform: "translateY(-50%)",
          opacity: fading ? FADE_OPACITY : 1,
          transitionDuration: `${FADE_MS}ms`,
          ...(slot.side === "left" ? { left: slot.inset } : { right: slot.inset }),
        };
        return (
          <div
            // Stable per-slot key keeps the card mounted in place so prompt swaps
            // cross-fade via the opacity transition instead of remounting.
            key={slotIndex}
            style={positionStyle}
            className="group pointer-events-auto absolute transition-opacity ease-in-out"
          >
            {/* Frosted control. The translucent fill + backdrop-blur only read
                as glass because the empty state behind it carries the ambient
                dot grid and centre wash (.ambient-canvas) — over a flat void
                the same treatment resolves to a uniform grey rectangle.
                Corners are control-scale (rounded-lg -> --radius-control), not
                the panel-scale rounded-2xl this used before: panel radii on a
                small control are a large part of why these read as generic
                rounded rectangles rather than buttons. */}
            <button
              type="button"
              className="flex w-full cursor-pointer items-start rounded-lg border border-[var(--surface-border)] bg-[color-mix(in_srgb,var(--surface-raised)_72%,transparent)] px-3.5 py-2.5 text-left text-[13px] font-medium leading-5 text-[var(--text-secondary)] shadow-[0_1px_2px_rgba(0,0,0,0.25)] ring-1 ring-inset ring-white/[0.06] backdrop-blur-md transition-[color,background-color,border-color,transform] duration-200 hover:-translate-y-px hover:border-[rgba(var(--accent-color-rgb),0.45)] hover:bg-[color-mix(in_srgb,var(--surface-hover)_85%,transparent)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]"
              onClick={() => onSelect(suggestion)}
            >
              <span className="flex min-w-0 flex-col gap-1.5">
                <span className="min-w-0">{suggestion.label}</span>
                {suggestion.workspaceName && (
                  // Shown only for prompts belonging to another workspace —
                  // selecting one opens its chat there, so the origin has to be
                  // visible before the click, not a surprise after it.
                  <span className="label-chrome truncate">{suggestion.workspaceName}</span>
                )}
              </span>
            </button>
            {onDismiss && (
              <button
                type="button"
                aria-label="Dismiss this suggestion"
                title="Don't suggest this again"
                onClick={() => onDismiss(suggestion)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-raised)] text-[var(--text-secondary)] opacity-0 shadow-sm transition-opacity duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
