import React, { useEffect, useRef, useState } from "react";
import { Brain, Pause, Play, Clock, Infinity as InfinityIcon } from "lucide-react";
import { useBackgroundJobsStore } from "../../stores/backgroundJobs";
import { retryBackgroundJobsConnection } from "../../lib/backgroundJobsLifecycle";
import { Tooltip } from "../Tooltip";

export default function SchedulerPauseButton() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pauseStatus = useBackgroundJobsStore((s) => s.pauseStatus);
  const activeJobs = useBackgroundJobsStore((s) => s.jobs);
  const pauseError = useBackgroundJobsStore((s) => s.pauseError);
  const hydrationError = useBackgroundJobsStore((s) => s.hydrationError);
  const subscriptionError = useBackgroundJobsStore((s) => s.subscriptionError);
  const hydrating = useBackgroundJobsStore((s) => s.hydrating);
  const hydrate = useBackgroundJobsStore((s) => s.hydrate);
  const pauseScheduler = useBackgroundJobsStore((s) => s.pause);
  const resumeScheduler = useBackgroundJobsStore((s) => s.resume);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const error = subscriptionError ?? pauseError ?? hydrationError;

  const [timeLeft, setTimeLeft] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handleDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", handleDown);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("mousedown", handleDown);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  useEffect(() => {
    if (!pauseStatus || !pauseStatus.is_paused || !pauseStatus.paused_until) {
      return;
    }

    const pausedUntilStr = pauseStatus.paused_until;

    const updateTimer = () => {
      const until = new Date(pausedUntilStr).getTime();
      const now = Date.now();
      const diff = until - now;
      if (diff <= 0) {
        setTimeLeft(null);
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${mins}m ${secs}s`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => {
      clearInterval(interval);
      setTimeLeft(null);
    };
  }, [pauseStatus]);

  const isPaused = pauseStatus?.is_paused ?? false;
  const isPausedIndefinitely = pauseStatus?.paused_indefinitely ?? false;
  const isJobRunning = activeJobs.size > 0;

  // Visual cues based on status
  let buttonClass = "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]";
  let iconClass = "transition-all";

  if (error) {
    buttonClass = "border-red-500/30 bg-red-500/10 text-red-500 hover:border-red-500/60";
  } else if (isPaused) {
    buttonClass = "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:border-amber-500/60";
  } else if (isJobRunning) {
    buttonClass = "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:border-emerald-500/60";
    iconClass = "animate-pulse";
  }

  const tooltipContent = error
    ? `Scheduler status error: ${error}`
    : !pauseStatus
    ? "Scheduler status unavailable"
    : isPaused
    ? isPausedIndefinitely
      ? "Scheduler Frozen (Indefinitely)"
      : `Scheduler Frozen (Resumes in ${timeLeft || "soon"})`
    : isJobRunning
    ? "Scheduler Active (Processing background tasks)"
    : "Scheduler Active (Idle)";

  const runAction = async (action: () => Promise<void>) => {
    if (pendingRef.current) { return; }
    pendingRef.current = true;
    setPending(true);
    try {
      await action();
      setOpen(false);
    } catch (actionError) {
      // The store retains the failure; keep its controls open for retry.
      console.error("Scheduler action failed:", actionError);
      setOpen(true);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const handlePauseOption = (seconds: number | null) => { void runAction(() => pauseScheduler(seconds)); };
  const handleResume = () => { void runAction(resumeScheduler); };

  return (
    <div ref={rootRef} className="relative inline-block">
      <Tooltip content={tooltipContent} position="bottom">
        <button
          onClick={() => setOpen(!open)}
          aria-label="Scheduler Status and Controls"
          className={`flex h-8 px-2 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium transition-all ${buttonClass}`}
        >
          {isPaused ? (
            <Pause size={13} className="shrink-0" />
          ) : (
            <Brain size={14} className={`shrink-0 ${iconClass}`} />
          )}
          {error && <span aria-label="Scheduler error" className="font-bold">!</span>}
          {timeLeft && (
            <span className="text-[10px] tabular-nums font-medium opacity-90">{timeLeft}</span>
          )}
        </button>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-56 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-2xl py-1 text-xs">
          <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/50">
            <span className="block font-semibold text-[var(--text-primary)]">Scheduled Jobs</span>
            <span className="mt-0.5 block text-[10px] text-[var(--text-muted)] font-medium">
              {hydrating
                ? "Refreshing status..."
                : error
                ? "Status may be out of date"
                : !pauseStatus
                ? "Status unavailable"
                : isPaused
                ? isPausedIndefinitely
                  ? "Status: Frozen indefinitely"
                  : `Status: Frozen (resumes in ${timeLeft || "soon"})`
                : isJobRunning
                ? "Status: Active & processing"
                : "Status: Active & idle"}
            </span>
          </div>

          {error && (
            <div role="alert" className="px-3 py-2 text-red-500">
              {error}
              <button
                type="button"
                disabled={hydrating || pending}
                onClick={() => {
                  if (subscriptionError) { retryBackgroundJobsConnection(); }
                  else { void hydrate().catch((refreshError) => console.error("Scheduler refresh failed:", refreshError)); }
                }}
                className="mt-1 block underline disabled:opacity-50"
              >
                {subscriptionError ? "Reconnect background updates" : "Retry status refresh"}
              </button>
            </div>
          )}
          {pending && <p role="status" className="px-3 py-1">Updating scheduler...</p>}
          <fieldset disabled={pending || !pauseStatus} className="py-1 disabled:opacity-50">
            {isPaused ? (
              <>
                <button
                  onClick={handleResume}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] font-medium transition-colors"
                >
                  <Play size={12} className="text-emerald-500 shrink-0" />
                  Resume Jobs
                </button>
                {!isPausedIndefinitely && (
                  <button
                    onClick={() => handlePauseOption(null)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <InfinityIcon size={12} className="text-amber-500 shrink-0" />
                    Pause Indefinitely (Turn off Timer)
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={() => handlePauseOption(null)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <InfinityIcon size={12} className="text-amber-500 shrink-0" />
                  Pause Indefinitely
                </button>
                <div className="my-1 h-px bg-[var(--border-color)]" />
                <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-[var(--text-muted)] font-bold">
                  Pause for Duration
                </div>
                <button
                  onClick={() => handlePauseOption(300)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <Clock size={12} className="text-amber-500 shrink-0" opacity={0.7} />
                  5 Minutes
                </button>
                <button
                  onClick={() => handlePauseOption(900)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <Clock size={12} className="text-amber-500 shrink-0" opacity={0.7} />
                  15 Minutes
                </button>
                <button
                  onClick={() => handlePauseOption(3600)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <Clock size={12} className="text-amber-500 shrink-0" opacity={0.7} />
                  1 Hour
                </button>
                <button
                  onClick={() => handlePauseOption(14400)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <Clock size={12} className="text-amber-500 shrink-0" opacity={0.7} />
                  4 Hours
                </button>
              </>
            )}
          </fieldset>
        </div>
      )}
    </div>
  );
}
