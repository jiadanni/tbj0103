import React, { useMemo } from "react";
import { Atom, Braces, Code, FileText, Hash, type LucideIcon } from "lucide-react";
import type { ComposerSuggestion } from "../lib/composerSuggestions";

interface WaterfallSuggestionsProps {
  suggestions: ComposerSuggestion[];
  onSelect: (suggestion: ComposerSuggestion) => void;
}

function iconFor(label: string): LucideIcon {
  const text = label.toLowerCase();
  if (/\breact\b|\bhook\b|\buse[a-z]/.test(text)) { return Atom; }
  if (/\bcss\b|\bhtml\b|flexbox|\bstyle\b/.test(text)) { return Code; }
  if (/javascript|\bjs\b|function|require|\btype\b|[{}]/.test(text)) { return Braces; }
  if (/count|number|sort/.test(text)) { return Hash; }
  return FileText;
}

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

export function WaterfallSuggestions({ suggestions, onSelect }: WaterfallSuggestionsProps) {
  const arranged = useMemo(() => {
    if (suggestions.length === 0) { return []; }
    return ARC_SLOTS.map((slot, i) => ({
      slot,
      suggestion: suggestions[i % suggestions.length],
      key: `${suggestions[i % suggestions.length].id}-${i}`,
    }));
  }, [suggestions]);

  if (suggestions.length === 0) { return null; }

  return (
    <div className="pointer-events-none absolute inset-0 select-none overflow-hidden [container-type:inline-size]">
      {arranged.map(({ slot, suggestion, key }) => {
        const Icon = iconFor(suggestion.label);
        // Anchor to the near edge by `inset`; width fills the gap from there to the
        // reserved center gutter, capped at a comfortable max. On narrow panes the
        // gap shrinks so cards stay out of the center instead of overlapping it.
        const availableWidth = `calc(50cqw - ${CENTER_GUTTER} - ${slot.inset})`;
        const positionStyle: React.CSSProperties = {
          top: slot.top,
          width: `clamp(11rem, ${availableWidth}, 18rem)`,
          transform: "translateY(-50%)",
          ...(slot.side === "left" ? { left: slot.inset } : { right: slot.inset }),
        };
        return (
          <button
            key={key}
            type="button"
            style={positionStyle}
            className="pointer-events-auto absolute flex cursor-pointer items-start gap-2.5 rounded-2xl border border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.10)] px-4 py-2.5 text-left text-[13px] font-medium leading-5 text-[var(--text-secondary)] shadow-[0_12px_32px_-16px_rgba(0,0,0,0.85)] ring-1 ring-inset ring-white/10 backdrop-blur-md transition-colors duration-200 hover:border-[rgba(var(--accent-color-rgb),0.55)] hover:bg-[rgba(var(--accent-color-rgb),0.16)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]"
            onClick={() => onSelect(suggestion)}
          >
            <Icon size={14} className="mt-0.5 shrink-0 opacity-70" />
            <span className="min-w-0">{suggestion.label}</span>
          </button>
        );
      })}
    </div>
  );
}
