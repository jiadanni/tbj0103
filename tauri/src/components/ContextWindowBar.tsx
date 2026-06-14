import React from "react";
import { Tooltip } from "./Tooltip";

const DEFAULT_CONTEXT_SIZE = 8192;

interface Props {
  tokensUsed: number;
  contextSize: number;
  /** Whether `contextSize` is a manual per-model override vs the default. */
  isOverride?: boolean;
  /** Model name, shown in the tooltip for context. */
  modelName?: string;
  /** Invoked when the pill is clicked — wires navigation to model settings. */
  onConfigure?: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1000) { return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`; }
  return String(n);
}

export function ContextWindowBar({ tokensUsed, contextSize, isOverride = false, modelName, onConfigure }: Props) {
  if (tokensUsed <= 0) { return null; }

  const pct = Math.min(tokensUsed / contextSize, 1);
  const isWarning = pct >= 0.6 && pct < 0.8;
  const isCritical = pct >= 0.8;

  const barColor = isCritical
    ? "bg-red-500"
    : isWarning
    ? "bg-amber-400"
    : "bg-emerald-500";

  const textColor = isCritical
    ? "text-red-500"
    : isWarning
    ? "text-amber-400"
    : "text-[var(--text-muted)]";

  const tooltipContent = (
    <div className="flex flex-col gap-1.5 w-52">
      <div className="font-semibold text-xs">Context window</div>
      <div className="text-[11px] flex flex-col gap-0.5">
        <div>
          Limit: <span className="font-mono text-[var(--accent-color)]">{contextSize}</span> tok
          <span className="text-[var(--text-muted)]"> ({isOverride ? "configured" : "default"})</span>
        </div>
        {isOverride && <div>Default: <span className="font-mono">{DEFAULT_CONTEXT_SIZE}</span> tok</div>}
        {modelName && <div className="text-[var(--text-muted)] truncate">Model: {modelName}</div>}
      </div>
      <div className="mt-0.5 text-[11px] text-[var(--text-muted)] leading-snug">
        This is the configured num_ctx for this model. Usable size is also bounded by available VRAM at runtime.
      </div>
      {onConfigure && (
        <div className="mt-0.5 text-[11px] text-[var(--accent-color)] font-medium">
          Change in Preferences →
        </div>
      )}
    </div>
  );

  const pill = (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="w-20 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <span className={`text-[10px] tabular-nums whitespace-nowrap ${textColor}`}>
        {formatTokens(tokensUsed)}/{formatTokens(contextSize)}
      </span>
    </div>
  );

  return (
    <Tooltip content={tooltipContent}>
      {onConfigure ? (
        <button
          type="button"
          onClick={onConfigure}
          aria-label="Context window — click to change in Preferences"
          className="flex items-center shrink-0 rounded-sm hover:opacity-80 transition-opacity"
        >
          {pill}
        </button>
      ) : (
        pill
      )}
    </Tooltip>
  );
}
