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

// Slots that scatter the prompt cards around the centered button, matching the
// mockup. Each card is anchored to its near edge (`side`) by a small `inset`, and
// sits at vertical center `top`. Card WIDTH is computed so the inner edge never
// crosses a reserved center gutter — this keeps the heading + button clear at any
// pane width (including a narrow 1080px window), shrinking cards instead of
// congesting the middle. `near`/`far` insets give the arc its splay: rows flanking
// the button tuck closer to the edge, corners reach a touch further in.
type ArcSlot = { side: "left" | "right"; top: string; inset: string };

// Half-width of the protected center zone (heading + button). A card's inner edge
// stays at least this far from the container's horizontal center.
const CENTER_GUTTER = "12.5rem";

const NEAR = "1.5rem"; // card sits near the pane edge
const FAR = "3.5rem"; // card pulled slightly inward (corners)

const ARC_SLOTS: ArcSlot[] = [
  { side: "left", top: "22%", inset: FAR },
  { side: "left", top: "40%", inset: NEAR },
  { side: "left", top: "62%", inset: NEAR },
  { side: "left", top: "80%", inset: FAR },
  { side: "right", top: "22%", inset: FAR },
  { side: "right", top: "40%", inset: NEAR },
  { side: "right", top: "62%", inset: NEAR },
  { side: "right", top: "80%", inset: FAR },
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
          width: `clamp(8rem, ${availableWidth}, 18rem)`,
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
            <span className="min-w-0 line-clamp-2">{suggestion.label}</span>
          </button>
        );
      })}
    </div>
  );
}
