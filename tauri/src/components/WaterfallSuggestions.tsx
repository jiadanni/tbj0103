import React, { type ReactNode, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { ComposerSuggestion } from "../lib/composerSuggestions";
import { useSettingsStore } from "../stores/settingsStore";

interface WaterfallSuggestionsProps {
  suggestions: ComposerSuggestion[];
  onSelect: (suggestion: ComposerSuggestion) => void;
  /** Blacklist a prompt (hover X). Optional so the component works without it. */
  onDismiss?: (suggestion: ComposerSuggestion) => void;
  /**
   * The "Start a new chat" action (button + privacy-mode menu), owned by
   * ChatView. The set-type and bracket layouts render this floating over the
   * center of the pane themselves; the mosaic layout instead asks for it via
   * `renderAction` so it can lay it into a grid cell in place of a floating
   * button. Layouts that don't need the slot ignore `renderAction`.
   */
  action: ReactNode;
  /** Only mosaic needs to lay the action out differently — see above. */
  renderAction?: (action: ReactNode) => ReactNode;
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

const CYCLE_MS = 9000; // how long each set of prompts stays before rotating
const FADE_MS = 900; // cross-fade duration when swapping prompts
const FADE_OPACITY = 0.55; // dim (not vanish) during the swap — keeps it subtle

/**
 * Shared rotation/cross-fade state machine: which window of `slotCount`
 * suggestions is visible right now, and are we mid cross-fade. All three
 * waterfall layouts need this, they just render the result differently.
 */
function useRotatingSlots(suggestions: ComposerSuggestion[], slotCount: number) {
  const [page, setPage] = useState(0);
  const [fading, setFading] = useState(false);

  const canCycle = suggestions.length > slotCount;

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
    return Array.from({ length: slotCount }, (_, i) => ({
      suggestion: suggestions[(page * slotCount + i) % suggestions.length],
      slotIndex: i,
    }));
  }, [suggestions, page, slotCount]);

  return { arranged, fading };
}

interface SuggestionCardProps {
  suggestion: ComposerSuggestion;
  onSelect: (suggestion: ComposerSuggestion) => void;
  onDismiss?: (suggestion: ComposerSuggestion) => void;
  style?: React.CSSProperties;
  className: string;
  dismissClassName?: string;
}

function SuggestionCard({ suggestion, onSelect, onDismiss, style, className, dismissClassName }: SuggestionCardProps) {
  return (
    <div style={style} className={`group pointer-events-auto ${className}`}>
      <button type="button" className="flex w-full cursor-pointer flex-col items-start" onClick={() => onSelect(suggestion)}>
        <span className="min-w-0">{suggestion.label}</span>
        {suggestion.workspaceName && (
          // Shown only for prompts belonging to another workspace —
          // selecting one opens its chat there, so the origin has to be
          // visible before the click, not a surprise after it.
          <span className="label-chrome mt-1.5 truncate">{suggestion.workspaceName}</span>
        )}
      </button>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss this suggestion"
          title="Don't suggest this again"
          onClick={() => onDismiss(suggestion)}
          className={dismissClassName ?? "absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-raised)] text-[var(--text-secondary)] opacity-0 shadow-sm transition-opacity duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] group-hover:opacity-100"}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * 3a — Set type. No boxes: prompts render as bare styled text arranged in the
 * existing arc around a radial dot-grid/ring background. Closest to the
 * original layout, just de-chromed and given a drawn field behind it.
 */
function WaterfallSetType({ suggestions, onSelect, onDismiss, action }: Omit<WaterfallSuggestionsProps, "renderAction">) {
  const { arranged, fading } = useRotatingSlots(suggestions, ARC_SLOTS.length);
  if (suggestions.length === 0) { return <>{action}</>; }

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <circle cx="50%" cy="50%" r="18%" fill="none" stroke="rgba(var(--accent-color-rgb),0.22)" />
        <circle cx="50%" cy="50%" r="32%" fill="none" stroke="rgba(148,163,184,0.12)" />
        <circle cx="50%" cy="50%" r="46%" fill="none" stroke="rgba(148,163,184,0.07)" />
        <line x1="0" y1="50%" x2="100%" y2="50%" stroke="rgba(148,163,184,0.07)" />
        <line x1="50%" y1="0" x2="50%" y2="100%" stroke="rgba(148,163,184,0.07)" />
      </svg>
      <div className="pointer-events-none absolute inset-0 select-none overflow-hidden [container-type:inline-size]">
        {arranged.map(({ suggestion, slotIndex }) => {
          const slot = ARC_SLOTS[slotIndex];
          const availableWidth = `calc(50cqw - ${CENTER_GUTTER} - ${slot.inset})`;
          const style: React.CSSProperties = {
            top: slot.top,
            width: `clamp(11rem, ${availableWidth}, 18rem)`,
            transform: "translateY(-50%)",
            opacity: fading ? FADE_OPACITY : 1,
            transitionDuration: `${FADE_MS}ms`,
            textAlign: slot.side === "left" ? "left" : "right",
            ...(slot.side === "left" ? { left: slot.inset } : { right: slot.inset }),
          };
          return (
            <SuggestionCard
              key={slotIndex}
              suggestion={suggestion}
              onSelect={onSelect}
              onDismiss={onDismiss}
              style={style}
              className={`absolute text-[15px] font-medium leading-[1.3] text-[var(--text-primary)] transition-opacity ease-in-out hover:text-[var(--accent-color)] ${slot.side === "right" ? "items-end" : "items-start"}`}
              dismissClassName={`absolute -top-1.5 ${slot.side === "left" ? "-right-6" : "-left-6"} flex h-5 w-5 items-center justify-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-raised)] text-[var(--text-secondary)] opacity-0 shadow-sm transition-opacity duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] group-hover:opacity-100`}
            />
          );
        })}
      </div>
      <div className="pointer-events-auto relative z-10 flex flex-col items-center gap-5">{action}</div>
    </>
  );
}

const MOSAIC_PROMPT_SLOTS = 7;

/**
 * 3b — Mosaic. A 3x3 grid fills the whole pane: prompt cells, one accent-filled
 * cell holding the "Start a new chat" action, and a "POOL" cell showing how
 * many more prompts are waiting in rotation.
 */
function WaterfallMosaic({ suggestions, onSelect, onDismiss, action, renderAction }: WaterfallSuggestionsProps) {
  const { arranged, fading } = useRotatingSlots(suggestions, MOSAIC_PROMPT_SLOTS);
  if (suggestions.length === 0) { return <>{action}</>; }

  const poolCount = Math.max(suggestions.length - MOSAIC_PROMPT_SLOTS, 0);
  const cells: ReactNode[] = arranged.map(({ suggestion, slotIndex }) => (
    <SuggestionCard
      key={slotIndex}
      suggestion={suggestion}
      onSelect={onSelect}
      onDismiss={onDismiss}
      style={{ opacity: fading ? FADE_OPACITY : 1, transitionDuration: `${FADE_MS}ms` }}
      className="relative flex h-full w-full flex-col justify-between bg-[var(--surface-raised)] p-4 text-left text-[15px] leading-[1.35] text-[var(--text-primary)] transition-opacity ease-in-out hover:bg-[var(--surface-hover)]"
    />
  ));
  // Insert the action cell after the 4th prompt cell (mirrors the design's
  // reading order: four cells, the action, then the remaining prompts + pool).
  cells.splice(
    4,
    0,
    <div key="action" className="flex h-full w-full flex-col justify-between bg-[var(--accent-color)] p-4 text-white">
      {renderAction ? renderAction(action) : action}
    </div>,
  );
  cells.push(
    <div key="pool" className="flex h-full w-full flex-col justify-between bg-[var(--surface-sunken)] p-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.01em] text-[var(--text-muted)]">Pool</span>
      <span className="font-mono text-3xl text-[var(--surface-border)]">{poolCount}</span>
    </div>,
  );

  return (
    <div className="pointer-events-auto absolute inset-0 grid grid-cols-3 grid-rows-3 gap-px overflow-hidden bg-[var(--surface-border)]">
      {cells}
    </div>
  );
}

const BRACKET_SLOTS: ArcSlot[] = ARC_SLOTS;

/**
 * 3c — Bracket. Cut-corner tiles arranged along two dashed guide paths that
 * trace a bracket shape around a centered action.
 */
function WaterfallBracket({ suggestions, onSelect, onDismiss, action }: Omit<WaterfallSuggestionsProps, "renderAction">) {
  const { arranged, fading } = useRotatingSlots(suggestions, BRACKET_SLOTS.length);
  if (suggestions.length === 0) { return <>{action}</>; }

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <path d="M35% 15% Q32% 50% 33% 85%" fill="none" stroke="rgba(var(--accent-color-rgb),0.28)" strokeDasharray="2 5" />
        <path d="M65% 15% Q68% 50% 67% 85%" fill="none" stroke="rgba(var(--accent-color-rgb),0.28)" strokeDasharray="2 5" />
      </svg>
      <div className="pointer-events-none absolute inset-0 select-none overflow-hidden [container-type:inline-size]">
        {arranged.map(({ suggestion, slotIndex }) => {
          const slot = BRACKET_SLOTS[slotIndex];
          const isPrimary = slotIndex === 0;
          const availableWidth = `calc(50cqw - ${CENTER_GUTTER} - ${slot.inset})`;
          const style: React.CSSProperties = {
            top: slot.top,
            width: `clamp(11rem, ${availableWidth}, 18rem)`,
            transform: "translateY(-50%)",
            opacity: fading ? FADE_OPACITY : 1,
            transitionDuration: `${FADE_MS}ms`,
            clipPath: slot.side === "left"
              ? "polygon(0 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%)"
              : "polygon(0 0,100% 0,100% 100%,12px 100%,0 calc(100% - 12px))",
            borderTop: `2px solid ${isPrimary ? "var(--accent-color)" : "var(--surface-border)"}`,
            ...(slot.side === "left" ? { left: slot.inset } : { right: slot.inset }),
          };
          return (
            <SuggestionCard
              key={slotIndex}
              suggestion={suggestion}
              onSelect={onSelect}
              onDismiss={onDismiss}
              style={style}
              className="absolute box-border bg-[var(--surface-raised)] px-3 py-2.5 text-[13.5px] leading-[1.4] text-[var(--text-primary)] transition-opacity ease-in-out hover:bg-[var(--surface-hover)]"
            />
          );
        })}
      </div>
      <div className="pointer-events-auto relative z-10 flex flex-col items-center gap-5">{action}</div>
    </>
  );
}

export function WaterfallSuggestions({ suggestions, onSelect, onDismiss, action, renderAction }: WaterfallSuggestionsProps) {
  const waterfallStyle = useSettingsStore((state) => state.waterfallStyle);

  if (suggestions.length === 0) { return <>{action}</>; }

  const wrapperClassName = waterfallStyle === "mosaic"
    ? "absolute inset-0 select-none overflow-hidden"
    : "pointer-events-none absolute inset-0 flex flex-1 min-w-0 flex-col items-center justify-center gap-6 text-center select-none overflow-hidden [container-type:inline-size]";

  return (
    <div className={wrapperClassName}>
      {waterfallStyle === "mosaic" && (
        <WaterfallMosaic suggestions={suggestions} onSelect={onSelect} onDismiss={onDismiss} action={action} renderAction={renderAction} />
      )}
      {waterfallStyle === "bracket" && (
        <WaterfallBracket suggestions={suggestions} onSelect={onSelect} onDismiss={onDismiss} action={action} />
      )}
      {waterfallStyle === "set-type" && (
        <WaterfallSetType suggestions={suggestions} onSelect={onSelect} onDismiss={onDismiss} action={action} />
      )}
    </div>
  );
}
