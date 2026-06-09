import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  api,
  type PerformanceStats,
  type BackgroundTaskPromptEvent,
  type InferenceJobStatus,
} from "../lib/api";
import { useChatStore } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useBackgroundJobsStore } from "../stores/backgroundJobs";
import { Tooltip } from "./Tooltip";

const ZOOM_MIN = 11;
const ZOOM_MAX = 22;
const ZOOM_DEFAULT = 16;

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
function CoreGraphPopup({
  cores,
  anchorRect,
  sectionRect,
}: {
  cores: number[];
  anchorRect: DOMRect;
  sectionRect: DOMRect | null;
}) {
  const POPUP_BAR_MAX_H = 40;
  const POPUP_BAR_W = 10;
  const GAP = 4;
  const PADDING = 10;
  const ROW_SIZE = 8;
  const rows: number[][] = [];
  for (let i = 0; i < cores.length; i += ROW_SIZE) {
    rows.push(cores.slice(i, i + ROW_SIZE));
  }

  const maxRowLen = Math.max(...rows.map((r) => r.length));
  const intrinsicW = PADDING * 2 + maxRowLen * (POPUP_BAR_W + GAP) - GAP;
  const popupW = sectionRect ? sectionRect.width : intrinsicW;
  const left = sectionRect ? sectionRect.left : anchorRect.left + anchorRect.width / 2 - popupW / 2;
  // Anchor by bottom so the popup sits flush against the status bar regardless
  // of its rendered height. anchorRect.top is the status bar's top edge.
  const bottom = window.innerHeight - anchorRect.top;

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: `${Math.max(4, left)}px`,
        bottom: `${bottom}px`,
        width: `${popupW}px`,
        zIndex: 9999,
        padding: `${PADDING}px`,
        pointerEvents: "none",
        animation: "tooltip-fade-in 0.15s cubic-bezier(0.16,1,0.3,1) both",
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
  const [sectionRect, setSectionRect] = useState<DOMRect | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const showPopup = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (barRef.current) {
        const barRect = barRef.current.getBoundingClientRect();
        let el: HTMLElement | null = barRef.current;
        let statusTop = barRect.top;
        while (el) {
          if (el.getAttribute("aria-label") === "System status bar") {
            statusTop = el.getBoundingClientRect().top;
            break;
          }
          el = el.parentElement;
        }
        // Use the CoreBars row itself as the CPU section bounds.
        setSectionRect(rowRef.current?.getBoundingClientRect() ?? null);
        setAnchorRect(new DOMRect(barRect.left, statusTop, barRect.width, barRect.height));
      }
    }, 200);
  }, []);

  const hidePopup = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); }
    setAnchorRect(null);
    setSectionRect(null);
  }, []);

  useEffect(() => () => { if (timerRef.current) { clearTimeout(timerRef.current); } }, []);

  return (
    <div
      className="flex items-center gap-1.5"
      ref={rowRef}
      onMouseEnter={showPopup}
      onMouseLeave={hidePopup}
    >
      <span className="text-xs text-[var(--text-secondary)] leading-none font-medium">CPU:</span>
      <div ref={barRef} className="relative h-1.5 w-16 rounded-full overflow-hidden bg-[color-mix(in_srgb,var(--border-color),transparent_50%)]">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${barColor(aggregate)}`}
          style={{ width: `${aggregate}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-[var(--text-secondary)] leading-none">
        {aggregate}%
      </span>
      {anchorRect && <CoreGraphPopup cores={displayed} anchorRect={anchorRect} sectionRect={sectionRect} />}
    </div>
  );
}

// ── Job pill ─────────────────────────────────────────────────────────────────

const JOB_LABELS: Record<string, string> = {
  memory_extraction: "Memory Extraction",
  summarization: "Summarization",
  flashcard_generation: "Flashcard Generation",
  concept_hierarchy: "Topic Linking",
  workspace_prompt_bank: "Starter Prompts",
  workspace_analysis: "Workspace Analysis",
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

function JobPill({
  taskType,
  detail,
  model,
  onStop,
}: {
  taskType: string;
  detail?: string;
  model?: string;
  onStop?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {/* Pulsing dot */}
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span className="text-xs text-emerald-400 leading-none font-medium">
        {formatTaskName(taskType)}
      </span>
      {detail && (
        <span className="text-[10px] text-[var(--text-muted)] leading-none truncate max-w-[140px]" title={detail}>
          {detail}
        </span>
      )}
      {model && (
        <span className="text-[10px] text-[var(--text-muted)] leading-none truncate max-w-[100px]" title={model}>
          {model}
        </span>
      )}
      {onStop && (
        <Tooltip content="Stop this task">
          <button
            type="button"
            onClick={onStop}
            aria-label={`Stop ${formatTaskName(taskType)}`}
            className="flex h-3.5 w-3.5 items-center justify-center rounded-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-[color-mix(in_srgb,var(--border-color),transparent_60%)] transition-colors"
          >
            <svg viewBox="0 0 8 8" className="h-2 w-2 fill-current" aria-hidden="true">
              <rect x="0" y="0" width="8" height="8" rx="1" />
            </svg>
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function QueuedJobPill({
  taskType,
  model,
}: {
  taskType: string;
  model?: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 opacity-80">
      <span className="relative inline-flex h-2 w-2 rounded-full border border-[var(--border-color)] bg-transparent" aria-hidden="true" />
      <span className="text-xs text-[var(--text-secondary)] leading-none font-medium">
        {formatTaskName(taskType)}
      </span>
      <span className="rounded-full border border-[var(--border-color)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)] leading-none">
        Queued
      </span>
      {model && (
        <span className="text-[10px] text-[var(--text-muted)] leading-none truncate max-w-[100px]" title={model}>
          {model}
        </span>
      )}
    </div>
  );
}

function JobPromptPill({
  taskType,
  heavyModel,
  smallModel,
  mode,
  onConfirm,
  onDismiss,
}: {
  taskType: string;
  heavyModel?: string;
  smallModel?: string;
  mode: "confirm_only" | "dual_model";
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const modelLabel = heavyModel ?? smallModel;
  const tooltip = (() => {
    const label = formatTaskName(taskType);
    if (mode === "dual_model") {
      return `Run ${label} with ${heavyModel ?? "heavy model"}. Ignore to run with ${smallModel ?? "default"}.`;
    }
    return `Run ${label} with ${heavyModel ?? "configured model"}. Ignore to skip this tick.`;
  })();
  return (
    <div
      className="flex shrink-0 items-center gap-2 animate-[tooltip-fade-in-top_0.3s_cubic-bezier(0.16,1,0.3,1)_both]"
      role="group"
      aria-label={tooltip}
    >
      <Tooltip content={tooltip}>
        <button
          type="button"
          onClick={onConfirm}
          aria-label={`Run ${formatTaskName(taskType)} now${heavyModel ? ` with ${heavyModel}` : ""}`}
          className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/40 hover:text-emerald-300 animate-pulse transition-colors"
        >
          <svg viewBox="0 0 8 8" className="h-2 w-2 fill-current" aria-hidden="true">
            <polygon points="1,0 7,4 1,8" />
          </svg>
        </button>
      </Tooltip>
      <span className="text-xs text-[var(--text-secondary)] leading-none font-medium">
        {formatTaskName(taskType)}
      </span>
      {modelLabel && (
        <span className="text-[10px] text-[var(--text-muted)] leading-none truncate max-w-[100px]" title={modelLabel}>
          {modelLabel}
        </span>
      )}
      <Tooltip content="Dismiss">
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss ${formatTaskName(taskType)} prompt`}
          className="flex h-3.5 w-3.5 items-center justify-center rounded-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          <svg viewBox="0 0 8 8" className="h-2 w-2" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <line x1="1" y1="1" x2="7" y2="7" />
            <line x1="7" y1="1" x2="1" y2="7" />
          </svg>
        </button>
      </Tooltip>
    </div>
  );
}

function scheduledStateLabel(state: string): string {
  switch (state) {
    case "running": return "Running";
    case "queued": return "Queued";
    case "due_now": return "Due now";
    case "disabled": return "Disabled";
    case "waiting_for_idle": return "Waiting";
    case "no_eligible_work": return "No work";
    default: return "Scheduled";
  }
}

function ScheduledJobsPopover({
  anchorRect,
  jobs,
  loading,
  onClose,
}: {
  anchorRect: DOMRect;
  jobs: InferenceJobStatus[];
  loading: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { onClose(); }
    }
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-scheduled-jobs-popover]") || target?.closest("[data-scheduled-jobs-trigger]")) {
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [onClose]);

  const width = 360;
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - width - 8));
  const bottom = window.innerHeight - anchorRect.top + 6;

  return createPortal(
    <div
      data-scheduled-jobs-popover
      className="fixed z-[9999] rounded-md border border-[var(--border-color)] bg-[var(--bg-sidebar)] p-2 shadow-xl"
      style={{ left, bottom, width }}
      role="dialog"
      aria-label="Scheduled jobs"
    >
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Scheduled Jobs</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scheduled jobs"
          className="h-5 w-5 rounded-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          ×
        </button>
      </div>
      {loading && <div className="py-4 text-xs text-[var(--text-muted)]">Loading…</div>}
      {!loading && jobs.length === 0 && (
        <div className="py-4 text-xs text-[var(--text-muted)]">No scheduled jobs found.</div>
      )}
      {!loading && jobs.length > 0 && (
        <div className="max-h-[500px] overflow-y-auto divide-y divide-[var(--border-color)]/60">
          {jobs.map((job) => (
            <div key={job.job_key} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-[var(--text-primary)]">{job.label}</div>
                <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{job.due_label}</div>
              </div>
              <span className="shrink-0 rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                {scheduledStateLabel(job.state)}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 pt-2 border-t border-[var(--border-color)]/60 flex justify-end">
        <button
          type="button"
          onClick={() => {
            navigate("/preferences", { state: { settingsTab: "inference-jobs" } });
            onClose();
          }}
          className="text-[10px] text-[var(--accent-color)] hover:underline font-medium"
        >
          Configure Jobs →
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Zoom slider — binds to the global font-size setting (11–22 px). */
function ZoomSlider() {
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setFontSize = useSettingsStore((s) => s.setFontSize);

  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fontSize || ZOOM_DEFAULT));
  const percent = Math.round(((clamped - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100);

  const commit = (next: number) => {
    const bounded = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(next)));
    if (bounded === fontSize) { return; }
    setFontSize(bounded);
    api.settings.updateOne("font_size", bounded).catch(() => {});
  };

  return (
    <Tooltip content={`Zoom — ${clamped}px (double-click to reset)`}>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-[var(--text-secondary)] leading-none font-medium">Zoom:</span>
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={1}
          value={clamped}
          onChange={(e) => commit(parseInt(e.target.value, 10))}
          onDoubleClick={() => commit(ZOOM_DEFAULT)}
          aria-label="App zoom level"
          className="h-1.5 w-20 cursor-pointer appearance-none rounded-full bg-[color-mix(in_srgb,var(--border-color),transparent_50%)] accent-[var(--accent-color)]"
          style={{
            background: `linear-gradient(to right, rgba(var(--accent-color-rgb),0.6) 0%, rgba(var(--accent-color-rgb),0.6) ${percent}%, color-mix(in srgb, var(--border-color), transparent 50%) ${percent}%, color-mix(in srgb, var(--border-color), transparent 50%) 100%)`,
          }}
        />
        <span className="text-xs tabular-nums text-[var(--text-secondary)] leading-none w-7 text-right">
          {clamped}
        </span>
      </div>
    </Tooltip>
  );
}

// ── Main StatusBar ────────────────────────────────────────────────────────────

const PERFORMANCE_POLL_INTERVAL_MS = 10_000;


export default function StatusBar() {
  const streamingSessionId = useChatStore((s) => s.streamingSessionId);
  const refiningSessionId = useChatStore((s) => s.refiningSessionId);
  const isAiStreaming = streamingSessionId !== null || refiningSessionId !== null;
  const streamingModel = useChatStore((s) => {
    const id = s.streamingSessionId ?? s.refiningSessionId;
    if (!id) { return null; }
    const session = s.sessions.find((sess) => sess.id === id);
    return session?.model_name ?? null;
  });

  const [stats, setStats] = useState<PerformanceStats | null>(null);
  const activeJobs = useBackgroundJobsStore((s) => s.jobs);
  const [pendingPrompts, setPendingPrompts] = useState<
    Map<string, { heavyModel?: string; smallModel?: string; mode: "confirm_only" | "dual_model" }>
  >(new Map());
  const [scheduledPopoverRect, setScheduledPopoverRect] = useState<DOMRect | null>(null);
  const [scheduledJobs, setScheduledJobs] = useState<InferenceJobStatus[]>([]);
  const [scheduledJobsLoading, setScheduledJobsLoading] = useState(false);
  const promptTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll performance stats on a slower cadence, rescheduling after each
  // response completes so a slow backend sample never overlaps with the next.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    function clearTimer() {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function scheduleNext() {
      clearTimer();
      if (cancelled) { return; }
      timerRef.current = setTimeout(() => { void fetchOnce(); }, PERFORMANCE_POLL_INTERVAL_MS);
    }

    async function fetchOnce() {
      if (cancelled || inFlight) {
        scheduleNext();
        return;
      }
      inFlight = true;
      try {
        const result = await api.system.getPerformanceStats();
        if (!cancelled) { setStats(result); }
      } catch {
        // silently ignore — backend may not be ready yet
      } finally {
        inFlight = false;
        scheduleNext();
      }
    }

    void fetchOnce();

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, []);

  // Background task events are listened to globally at App.tsx and update the store.

  // Listen for background-task-prompt events (confirmation requests).
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    const timers = promptTimersRef.current;

    const clearTimer = (taskType: string) => {
      const t = timers.get(taskType);
      if (t) {
        clearTimeout(t);
        timers.delete(taskType);
      }
    };

    const setup = async () => {
      unlistenFn = await api.listenBackgroundTaskPrompt((payload: BackgroundTaskPromptEvent) => {
        const { task_type, status, mode, heavy_model, small_model, timeout_seconds } = payload;
        if (status === "pending") {
          if (mode !== "confirm_only" && mode !== "dual_model") { return; }
          setPendingPrompts((prev) => {
            const next = new Map(prev);
            next.set(task_type, { heavyModel: heavy_model, smallModel: small_model, mode });
            return next;
          });
          // Auto-dismiss locally if the backend doesn't notify within timeout.
          clearTimer(task_type);
          const ms = Math.max(1, timeout_seconds) * 1000;
          const t = setTimeout(() => {
            setPendingPrompts((prev) => {
              if (!prev.has(task_type)) { return prev; }
              const next = new Map(prev);
              next.delete(task_type);
              return next;
            });
            timers.delete(task_type);
          }, ms);
          timers.set(task_type, t);
        } else {
          // dismissed | confirmed | cancelled — clear the prompt.
          clearTimer(task_type);
          setPendingPrompts((prev) => {
            if (!prev.has(task_type)) { return prev; }
            const next = new Map(prev);
            next.delete(task_type);
            return next;
          });
        }
      });
    };

    void setup();
    return () => {
      unlistenFn?.();
      for (const t of timers.values()) { clearTimeout(t); }
      timers.clear();
    };
  }, []);

  // Clear any pending prompt as soon as the matching job actually starts —
  // covers the race where the "confirmed" prompt event arrives after the
  // job's "started" task event.
  useEffect(() => {
    if (activeJobs.size === 0) { return; }
    setPendingPrompts((prev) => {
      let mutated = false;
      const next = new Map(prev);
      for (const taskType of activeJobs.keys()) {
        if (next.delete(taskType)) {
          mutated = true;
          const t = promptTimersRef.current.get(taskType);
          if (t) {
            clearTimeout(t);
            promptTimersRef.current.delete(taskType);
          }
        }
      }
      return mutated ? next : prev;
    });
  }, [activeJobs]);

  // Polling reconciliation has been removed in favor of useBackgroundJobsStore.

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

  const jobList = Array.from(activeJobs.entries()).filter(([type, meta]) => {
    if (type === "workspace_glossary" && meta.status === "running" && activeJobs.has("workspace_analysis")) {
      return false;
    }
    return true;
  });
  const runningJobs = jobList.filter(([, meta]) => meta.status === "running");
  const queuedJobs = jobList.filter(([, meta]) => meta.status === "queued");
  const promptList = Array.from(pendingPrompts.entries());

  const handleConfirmPrompt = useCallback((taskType: string) => {
    setPendingPrompts((prev) => {
      if (!prev.has(taskType)) { return prev; }
      const next = new Map(prev);
      next.delete(taskType);
      return next;
    });
    const t = promptTimersRef.current.get(taskType);
    if (t) {
      clearTimeout(t);
      promptTimersRef.current.delete(taskType);
    }
    void api.backgroundJobs.confirm(taskType).catch(() => undefined);
  }, []);

  const handleDismissPrompt = useCallback((taskType: string) => {
    setPendingPrompts((prev) => {
      if (!prev.has(taskType)) { return prev; }
      const next = new Map(prev);
      next.delete(taskType);
      return next;
    });
    const t = promptTimersRef.current.get(taskType);
    if (t) {
      clearTimeout(t);
      promptTimersRef.current.delete(taskType);
    }
    void api.backgroundJobs.dismiss(taskType).catch(() => undefined);
  }, []);

  const handleStopJob = useCallback((taskType: string) => {
    void api.backgroundJobs.cancel(taskType).catch(() => undefined);
  }, []);

  const toggleScheduledJobsPopover = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (scheduledPopoverRect) {
      setScheduledPopoverRect(null);
      return;
    }
    setScheduledPopoverRect(event.currentTarget.getBoundingClientRect());
    setScheduledJobsLoading(true);
    api.backgroundJobs.getInferenceJobStatuses()
      .then(setScheduledJobs)
      .catch(() => setScheduledJobs([]))
      .finally(() => setScheduledJobsLoading(false));
  }, [scheduledPopoverRect]);

  // [P2] Build a screen-reader announcement string for active tasks only —
  // the continuously-updating metrics are not announced.
  const runningTypes = [...(isAiStreaming ? ["ai_generating"] : []), ...runningJobs.map(([t]) => t)];
  const queuedTypes = queuedJobs.map(([t]) => t);
  const announcementParts: string[] = [];
  if (runningTypes.length > 0) {
    announcementParts.push(`${runningTypes.map((t) => formatTaskName(t)).join(", ")} running`);
  }
  if (queuedTypes.length > 0) {
    announcementParts.push(`${queuedTypes.map((t) => formatTaskName(t)).join(", ")} queued`);
  }
  const jobAnnouncement = announcementParts.join(". ");

  return (
    // [P2] No role="status" / aria-live on the container — metrics update every
    // 2.5 s and would flood screen readers. A hidden live region below handles
    // discrete job announcements only.
    <div
      aria-label="System status bar"
      className="shrink-0 flex h-7 items-center justify-between gap-5 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 select-none"
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

      {/* Left — pending confirmations, active tasks, AI streaming */}
      <div className="flex min-w-0 items-center gap-4 overflow-x-auto overflow-y-hidden">
        <button
          type="button"
          data-scheduled-jobs-trigger
          onClick={toggleScheduledJobsPopover}
          className="flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          aria-label="Show scheduled jobs"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]" aria-hidden="true" />
          Jobs
        </button>
        {promptList.map(([type, meta]) => (
          <JobPromptPill
            key={`prompt-${type}`}
            taskType={type}
            heavyModel={meta.heavyModel}
            smallModel={meta.smallModel}
            mode={meta.mode}
            onConfirm={() => handleConfirmPrompt(type)}
            onDismiss={() => handleDismissPrompt(type)}
          />
        ))}
        {isAiStreaming && <JobPill taskType="ai_generating" model={streamingModel ?? undefined} />}
        {runningJobs.map(([type, meta]) => (
          <JobPill
            key={type}
            taskType={type}
            detail={type === "workspace_analysis" ? meta.message : undefined}
            model={meta.model}
            onStop={() => handleStopJob(type)}
          />
        ))}
        {queuedJobs.map(([type, meta]) => (
          <QueuedJobPill
            key={type}
            taskType={type}
            model={meta.model}
          />
        ))}
      </div>
      {scheduledPopoverRect && (
        <ScheduledJobsPopover
          anchorRect={scheduledPopoverRect}
          jobs={scheduledJobs}
          loading={scheduledJobsLoading}
          onClose={() => setScheduledPopoverRect(null)}
        />
      )}

      {/* Right — performance meters (aria-hidden; screen readers get no value from constant churn) */}
      <div className="flex items-center gap-4 shrink-0" aria-hidden="true">
        <ZoomSlider />

        <span className="h-3.5 w-px bg-[var(--border-color)]" />

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
