import React, { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type PerformanceStats, type BackgroundTaskEvent } from "../lib/api";

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
  if (percent >= 90) {
    return "bg-red-500/70";
  }
  if (percent >= 70) {
    return "bg-amber-400/70";
  }
  return "bg-[var(--accent-color)]/60";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MiniBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] tabular-nums text-[var(--text-muted)] leading-none w-[26px] text-right">
        {percent}%
      </span>
      <div className="relative h-[5px] w-16 rounded-full overflow-hidden bg-[var(--border-color)]/60">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${barColor(percent)}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-[10px] text-[var(--text-muted)] leading-none">{label}</span>
    </div>
  );
}

// ── Job pill ─────────────────────────────────────────────────────────────────

const JOB_LABELS: Record<string, string> = {
  memory_extraction: "Memory",
  summarization: "Summary",
  git_sync: "Git Sync",
};

function JobPill({ taskType }: { taskType: string }) {
  return (
    <div className="flex items-center gap-1.5 animate-fade-in">
      {/* Pulsing dot */}
      <span className="relative flex h-[7px] w-[7px]">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-emerald-500" />
      </span>
      <span className="text-[10px] text-emerald-400 leading-none font-medium">
        {JOB_LABELS[taskType] ?? taskType}
      </span>
    </div>
  );
}

// ── Main StatusBar ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2500;

export default function StatusBar() {
  const [stats, setStats] = useState<PerformanceStats | null>(null);
  const [activeJobs, setActiveJobs] = useState<Set<string>>(new Set());
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll performance stats
  useEffect(() => {
    let cancelled = false;

    async function fetchOnce() {
      try {
        const result = await api.system.getPerformanceStats();
        if (!cancelled) { setStats(result); }
      } catch {
        // silently ignore — backend may not be ready yet
      }
    }

    void fetchOnce();
    pollingRef.current = setInterval(() => { void fetchOnce(); }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollingRef.current !== null) { clearInterval(pollingRef.current); }
    };
  }, []);

  // Listen for background task events
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    const setup = async () => {
      unlistenFn = await listen<BackgroundTaskEvent>("background_task", (event) => {
        const { task_type, status } = event.payload;
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
  const ramPct = stats ? pct(stats.memory_used_bytes, stats.memory_total_bytes) : 0;
  const ramLabel = stats
    ? `${formatBytes(stats.memory_used_bytes)} / ${formatBytes(stats.memory_total_bytes)}`
    : "— / —";

  const gpuVramTotal = stats?.gpu_vram_total_bytes ?? null;
  const gpuVramUsed = stats?.gpu_vram_used_bytes ?? null;
  const hasGpu = gpuVramTotal !== null && gpuVramTotal > 0;

  const gpuPct = hasGpu && gpuVramUsed !== null ? pct(gpuVramUsed, gpuVramTotal) : 0;

  // On macOS used == total (capacity only) — show capacity label, no usage bar
  const isTotalOnly = hasGpu && gpuVramUsed === gpuVramTotal;

  let gpuLabel = "";
  if (hasGpu) {
    if (isTotalOnly) {
      gpuLabel = formatBytes(gpuVramTotal);
    } else if (gpuVramUsed !== null) {
      gpuLabel = `${formatBytes(gpuVramUsed)} / ${formatBytes(gpuVramTotal)}`;
    }
  }

  const jobList = Array.from(activeJobs);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="System status bar"
      className="shrink-0 flex h-[22px] items-center justify-between gap-4 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/80 px-3 backdrop-blur-sm select-none"
    >
      {/* Left — active background jobs */}
      <div className="flex items-center gap-3 min-w-0 overflow-hidden">
        {jobList.length === 0 ? (
          <span className="text-[10px] text-[var(--text-muted)]/50 leading-none">
            No background jobs
          </span>
        ) : (
          jobList.slice(0, 3).map((type) => <JobPill key={type} taskType={type} />)
        )}
      </div>

      {/* Right — performance meters */}
      <div className="flex items-center gap-3 shrink-0">
        {/* CPU */}
        <MiniBar percent={cpuPct} label="CPU" />

        {/* Divider */}
        <span className="h-3 w-px bg-[var(--border-color)]" aria-hidden="true" />

        {/* RAM */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] tabular-nums text-[var(--text-muted)] leading-none w-[26px] text-right">
            {ramPct}%
          </span>
          <div className="relative h-[5px] w-16 rounded-full overflow-hidden bg-[var(--border-color)]/60">
            <div
              className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${barColor(ramPct)}`}
              style={{ width: `${ramPct}%` }}
            />
          </div>
          <span className="text-[10px] text-[var(--text-muted)] leading-none tabular-nums">
            {ramLabel} RAM
          </span>
        </div>

        {/* GPU (only when detected) */}
        {hasGpu && (
          <>
            <span className="h-3 w-px bg-[var(--border-color)]" aria-hidden="true" />
            <div className="flex items-center gap-1.5">
              {!isTotalOnly && (
                <span className="text-[10px] tabular-nums text-[var(--text-muted)] leading-none w-[26px] text-right">
                  {gpuPct}%
                </span>
              )}
              {!isTotalOnly && (
                <div className="relative h-[5px] w-14 rounded-full overflow-hidden bg-[var(--border-color)]/60">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${barColor(gpuPct)}`}
                    style={{ width: `${gpuPct}%` }}
                  />
                </div>
              )}
              <span
                className="text-[10px] text-[var(--text-muted)] leading-none tabular-nums truncate max-w-[120px]"
                title={stats?.gpu_name ?? undefined}
              >
                {gpuLabel} VRAM
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
