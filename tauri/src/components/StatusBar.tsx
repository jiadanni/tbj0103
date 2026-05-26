import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type PerformanceStats, type BackgroundTaskEvent } from "../lib/api";
import { useChatStore } from "../stores/chatStore";
import { Tooltip } from "./Tooltip";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return (bytes / 1024 ** 3).toFixed(1) + " GB";
  }
  if (bytes >= 1024 ** 2) {
    return (bytes / 1024 ** 2).toFixed(0) + " MB";
  }
  return (bytes / 1024).toFixed(0) + " KB";
}

function pct(used: number, total: number): number {
  if (total === 0) {
    return 0;
  }
  return Math.min(100, Math.round((used / total) * 100));
}

function barColor(percent: number): string {
  if (percent >= 95) {
    return "bg-red-500/70";
  }
  if (percent >= 85) {
    return "bg-amber-400/70";
  }
  // FIX: bg-[var(...)]/60 is invalid for hex/rgba variables in standard CSS.
  // We use the RGB components provided in globals.css for reliable opacity.
  return "bg-[rgba(var(--accent-color-rgb),0.6)]";
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Label: [bar] N%  — used for RAM/GPU fallback */
function MiniBar({ percent, label, sublabel }: { percent: number; label: string; sublabel?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-[var(--text-secondary)] leading-none font-medium">{label}:</span>
      {/* Track background using color-mix for safe opacity on theme variables */}
      <div 
        className="relative h-1.5 w-16 rounded-full overflow-hidden bg-[color-mix(in_srgb,var(--border-color),transparent_50%)]"
      >
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${barColor(percent)}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-[var(--text-secondary)] leading-none">
        {sublabel ?? `${percent}%`}
      </span>
    </div>
  );
}

/** Floating mini bar-chart popup shown when hovering the CPU solid bar. */
function CoreGraphPopup({ cores, anchorRect }: { cores: number[]; anchorRect: DOMRect }) {
  const POPUP_BAR_MAX_H = 40;
  const POPUP_BAR_W = 10;
  const GAP = 4;
  const PADDING = 10;
  const ROW_SIZE = 8;
  const rows: number[][] = [];
  for (let i = 0; i < cores.length; i += ROW_SIZE) {
    rows.push(cores.slice(i, i + ROW_SIZE));
  }

  const rowCount = rows.length;
  const maxRowLen = Math.max(...rows.map((r) => r.length));
  const popupW = PADDING * 2 + maxRowLen * (POPUP_BAR_W + GAP) - GAP;
  const popupH = 24 + rowCount * (POPUP_BAR_MAX_H + 18) + PADDING * 2;
  const left = anchorRect.left + anchorRect.width / 2 - popupW / 2;
  const top = anchorRect.top - popupH - 8;

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: `${Math.max(4, left)}px`,
        top: `${Math.max(4, top)}px`,
        width: `${popupW}px`,
        zIndex: 9999,
        padding: `${PADDING}px`,
        pointerEvents: "none",
        animation: "tooltip-fade-in-top 0.15s cubic-bezier(0.16,1,0.3,1) both",
      }}
      className="rounded-md border border-[var(--border-color)] bg-[var(--bg-sidebar)] backdrop-blur-sm shadow-lg"
    >
      <div className="text-[11px] text-[var(--text-secondary)] font-medium mb-2 leading-none">
        {cores.length} cores
      </div>
      {rows.map((row, ri) => (
        <div key={ri} className="flex items-end mb-2 last:mb-0" style={{ gap: `${GAP}px` }}>
          {row.map((v, ci) => {
            const rounded = Math.round(v);
            return (
              <div key={ci} className="flex flex-col items-center" style={{ width: `${POPUP_BAR_W}px` }}>
                <div
                  className={`rounded-[1px] transition-none ${barColor(rounded)}`}
                  style={{
                    width: `${POPUP_BAR_W}px`,
                    height: `${Math.max(3, Math.round((v / 100) * POPUP_BAR_MAX_H))}px`,
                  }}
                />
                <span
                  className="text-[var(--text-secondary)] tabular-nums leading-none mt-1"
                  style={{ fontSize: "9px" }}
                >
                  {rounded}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/**
 * CPU:  [solid bar]  N%
 * Solid aggregate bar matching RAM/VRAM style. Hovering shows CoreGraphPopup
 * with per-core breakdown.
 */
function CoreBars({ cores, aggregate }: { cores: number[]; aggregate: number }) {
  const displayed = cores.slice(0, 32);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const showPopup = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (barRef.current) {
        setAnchorRect(barRef.current.getBoundingClientRect());
      }
    }, 200);
  }, []);

  const hidePopup = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); }
    setAnchorRect(null);
  }, []);

  useEffect(() => () => { if (timerRef.current) { clearTimeout(timerRef.current); } }, []);

  return (
    <div
      className="flex items-center gap-1.5"
      ref={barRef}
      onMouseEnter={showPopup}
      onMouseLeave={hidePopup}
    >
      <span className="text-xs text-[var(--text-secondary)] leading-none font-medium">CPU:</span>
      <div className="relative h-1.5 w-16 rounded-full overflow-hidden bg-[color-mix(in_srgb,var(--border-color),transparent_50%)]">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${barColor(aggregate)}`}
          style={{ width: `${aggregate}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-[var(--text-secondary)] leading-none">
        {aggregate}%
      </span>
      {anchorRect && <CoreGraphPopup cores={displayed} anchorRect={anchorRect} />}
    </div>
  );
}

// ── Job pill ─────────────────────────────────────────────────────────────────

const JOB_LABELS: Record<string, string> = {
  memory_extraction: "Memory Extraction",
  summarization: "Summarization",
  git_sync: "Git Sync",
  ai_generating: "Generating…",
  workspace_glossary: "Glossary Refresh",
  hover_definition_scan: "Definition Scan",
};

function formatTaskName(taskType: string): string {
  if (JOB_LABELS[taskType]) {
    return JOB_LABELS[taskType];
  }
  return taskType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function JobPill({ taskType }: { taskType: string }) {
  return (
    <div className="flex items-center gap-2">
      {/* Pulsing dot */}
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span className="text-xs text-emerald-400 leading-none font-medium">
        {formatTaskName(taskType)}
      </span>
    </div>
  );
}

// ── Main StatusBar ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2500;

export default function StatusBar() {
  const streamingSessionId = useChatStore((s) => s.streamingSessionId);
  const refiningSessionId = useChatStore((s) => s.refiningSessionId);
  const isAiStreaming = streamingSessionId !== null || refiningSessionId !== null;

  const [stats, setStats] = useState<PerformanceStats | null>(null);
  const [activeJobs, setActiveJobs] = useState<Set<string>>(new Set());
  // [P2] In-flight guard: prevents overlapping getPerformanceStats() calls.
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll performance stats — reschedule only after each response completes.
  useEffect(() => {
    let cancelled = false;

    function scheduleNext() {
      if (cancelled) { return; }
      timerRef.current = setTimeout(() => { void fetchOnce(); }, POLL_INTERVAL_MS);
    }

    async function fetchOnce() {
      if (cancelled || inFlightRef.current) {
        scheduleNext();
        return;
      }
      inFlightRef.current = true;
      try {
        const result = await api.system.getPerformanceStats();
        if (!cancelled) { setStats(result); }
      } catch {
        // silently ignore — backend may not be ready yet
      } finally {
        inFlightRef.current = false;
        scheduleNext();
      }
    }

    // Kick off immediately, then reschedule after each completion.
    void fetchOnce();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) { clearTimeout(timerRef.current); }
    };
  }, []);

  // Listen for background task events via the shared api.ts wrapper.
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    const setup = async () => {
      unlistenFn = await api.listenBackgroundTask((payload: BackgroundTaskEvent) => {
        const { task_type, status } = payload;
        setActiveJobs((prev) => {
          const next = new Set(prev);
          if (status === "started" || status === "processing") {
            next.add(task_type);
          } else {
            // completed or failed
            next.delete(task_type);
          }
          return next;
        });
      });
    };

    void setup();
    return () => { unlistenFn?.(); };
  }, []);

  const cpuPct = stats ? Math.round(stats.cpu_usage_percent) : 0;
  const cpuCores = stats?.cpu_core_usages ?? [];
  const ramPct = stats ? pct(stats.memory_used_bytes, stats.memory_total_bytes) : 0;
  const ramLabel = stats
    ? `${formatBytes(stats.memory_used_bytes)} / ${formatBytes(stats.memory_total_bytes)}`
    : "— / —";

  const gpuVramTotal = stats?.gpu_vram_total_bytes ?? null;
  const gpuVramUsed = stats?.gpu_vram_used_bytes ?? null;
  const hasGpu = gpuVramTotal !== null && gpuVramTotal > 0;

  // [P2] Use the explicit flag from the backend — never infer from used === total.
  const hasLiveUsage = stats?.gpu_vram_usage_available === true;
  const gpuPct = hasGpu && hasLiveUsage && gpuVramUsed !== null
    ? pct(gpuVramUsed, gpuVramTotal)
    : 0;

  let gpuLabel = "";
  if (hasGpu) {
    if (hasLiveUsage && gpuVramUsed !== null) {
      gpuLabel = `${formatBytes(gpuVramUsed)} / ${formatBytes(gpuVramTotal)}`;
    } else {
      gpuLabel = formatBytes(gpuVramTotal);
    }
  }

  const jobList = Array.from(activeJobs);

  // [P2] Build a screen-reader announcement string for background jobs only —
  // the continuously-updating metrics are not announced.
  const allActiveTypes = [...(isAiStreaming ? ["ai_generating"] : []), ...jobList];
  const jobAnnouncement = allActiveTypes.length > 0
    ? allActiveTypes.map((t) => formatTaskName(t)).join(", ") + " running"
    : "";

  return (
    // [P2] No role="status" / aria-live on the container — metrics update every
    // 2.5 s and would flood screen readers. A hidden live region below handles
    // discrete job announcements only.
    <div
      aria-label="System status bar"
      className="shrink-0 flex h-7 items-center justify-between gap-5 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/80 px-3 backdrop-blur-sm select-none"
    >
      {/* Hidden live region — announces job state changes only */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {jobAnnouncement}
      </span>

      {/* Left — active background jobs + AI streaming (visible) */}
      <div className="flex items-center gap-4 min-w-0 overflow-hidden" aria-hidden="true">
        {isAiStreaming && <JobPill taskType="ai_generating" />}
        {jobList.slice(0, 3).map((type) => <JobPill key={type} taskType={type} />)}
      </div>

      {/* Right — performance meters (aria-hidden; screen readers get no value from constant churn) */}
      <div className="flex items-center gap-4 shrink-0" aria-hidden="true">
        {/* CPU — per-core bars when available, fallback to aggregate */}
        {cpuCores.length > 0
          ? <CoreBars cores={cpuCores} aggregate={cpuPct} />
          : <MiniBar percent={cpuPct} label="CPU" />
        }

        {/* Divider */}
        <span className="h-3.5 w-px bg-[var(--border-color)]" />

        {/* RAM — RAM: [bar] used / total */}
        <MiniBar percent={ramPct} label="RAM" sublabel={ramLabel} />

        {/* GPU (only when detected) */}
        {hasGpu && (
          <>
            <span className="h-3.5 w-px bg-[var(--border-color)]" />
            {hasLiveUsage
              ? <MiniBar percent={gpuPct} label="VRAM" sublabel={gpuLabel} />
              : (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[var(--text-secondary)] leading-none font-medium">VRAM:</span>
                    <Tooltip content={stats?.gpu_name ?? ""}>
                      <span
                        className="text-xs text-[var(--text-secondary)] leading-none tabular-nums truncate max-w-[100px]"
                      >
                        {gpuLabel}
                      </span>
                    </Tooltip>
                </div>
              )
            }
          </>
        )}
      </div>
    </div>
  );
}
