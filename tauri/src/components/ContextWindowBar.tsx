import React from "react";

interface Props {
  tokensUsed: number;
  contextSize: number;
}

function formatTokens(n: number): string {
  if (n >= 1000) { return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`; }
  return String(n);
}

export function ContextWindowBar({ tokensUsed, contextSize }: Props) {
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

  return (
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
}
