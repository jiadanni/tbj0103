import { create } from "zustand";
import { api, type ActiveJob, type BackgroundTaskEvent, type PauseStatus } from "../lib/api";

export interface JobFailure {
  taskType: string;
  message: string;
  at: number;
  workspaceId?: string;
  model?: string;
}

interface BackgroundJobsState {
  jobs: Map<string, ActiveJob>;
  /**
   * Most recent failure per `task_type`, populated when a `failed` event
   * arrives. Kept in-memory only — clears on reload. Use this to surface
   * an error to the user near the affected job; persistent failure
   * history would need a backend change.
   */
  lastErrors: Map<string, JobFailure>;
  hydrated: boolean;
  hydrating: boolean;
  hydrationError: string | null;
  subscriptionError: string | null;
  pauseError: string | null;
  pauseStatus: PauseStatus | null;
  hydrate: () => Promise<void>;
  applyEvent: (event: BackgroundTaskEvent) => void;
  removeJob: (taskType: string) => void;
  dismissError: (taskType: string) => void;
  fetchPauseStatus: () => Promise<void>;
  applyPauseStatus: (status: PauseStatus) => void;
  pause: (durationSeconds: number | null) => Promise<void>;
  resume: () => Promise<void>;
}

export const useBackgroundJobsStore = create<BackgroundJobsState>((set, get) => {
  let hydration: Promise<void> | null = null;
  let revision = 0;
  let pauseRevision = 0;
  let hydrationRevision = 0;
  let reconcileAfterHydration = false;
  const taskRevisions = new Map<string, number>();
  const runRevisions = new Map<string, number>();
  const contextRequested = new Set<string>();

  const refreshPauseStatus = async () => {
    const requestRevision = ++pauseRevision;
    try {
      const pauseStatus = await api.backgroundJobs.getPauseStatus();
      if (requestRevision === pauseRevision) {
        set({ pauseStatus, pauseError: null });
      }
    } catch (error) {
      if (requestRevision === pauseRevision) {
        set({ pauseError: String(error) });
      }
      throw error;
    }
  };

  return {
  jobs: new Map(),
  lastErrors: new Map(),
  hydrated: false,
  hydrating: false,
  hydrationError: null,
  subscriptionError: null,
  pauseError: null,
  pauseStatus: null,

  hydrate: () => {
    if (hydration) { return hydration; }
    const snapshotRevision = revision;
    hydrationRevision = snapshotRevision;
    const snapshotPauseRevision = ++pauseRevision;
    // Defer the request until the shared promise is installed, including for
    // synchronous store subscribers that request hydration again.
    hydration = Promise.resolve().then(async () => {
      try {
        const [activeJobs, pauseStatus] = await Promise.all([
          api.system.listActiveBackgroundJobs(),
          api.backgroundJobs.getPauseStatus(),
        ]);
        set((state) => {
          const nextJobs = new Map(activeJobs.map((job) => [job.task_type, job]));
          for (const [taskType, taskRevision] of taskRevisions) {
            if (taskRevision <= snapshotRevision) { continue; }
            const current = state.jobs.get(taskType);
            if (!current) {
              nextJobs.delete(taskType);
              continue;
            }
            // Task types are reused between runs. A snapshot begun before a
            // terminal/start boundary cannot supply metadata for the new run.
            const snapshot = (runRevisions.get(taskType) ?? 0) <= snapshotRevision
              ? nextJobs.get(taskType) : undefined;
            nextJobs.set(taskType, {
              ...current,
              workspace_id: current.workspace_id ?? snapshot?.workspace_id,
              started_at: current.started_at ?? snapshot?.started_at,
            });
          }
          return {
            jobs: nextJobs,
            ...(snapshotPauseRevision === pauseRevision ? { pauseStatus, pauseError: null } : {}),
            hydrated: true,
            hydrationError: null,
          };
        });
      } catch (error) {
        set({ hydrationError: String(error) });
        throw error;
      } finally {
        hydration = null;
        set({ hydrating: false });
        if (reconcileAfterHydration) {
          reconcileAfterHydration = false;
          void get().hydrate().catch(() => {});
        }
      }
    });
    set({ hydrating: true, hydrationError: null });
    return hydration;
  },

  fetchPauseStatus: async () => {
    // Passive refresh callers read pauseError; control actions must reject.
    await refreshPauseStatus().catch(() => {});
  },

  applyPauseStatus: (pauseStatus) => {
    ++pauseRevision;
    set({ pauseStatus, pauseError: null });
  },

  pause: async (durationSeconds) => {
    ++pauseRevision;
    try {
      await api.backgroundJobs.pause(durationSeconds);
      await refreshPauseStatus();
    } catch (e) {
      set({ pauseError: String(e) });
      throw e;
    }
  },

  resume: async () => {
    ++pauseRevision;
    try {
      await api.backgroundJobs.resume();
      await refreshPauseStatus();
    } catch (e) {
      set({ pauseError: String(e) });
      throw e;
    }
  },

  applyEvent: (event) => {
    const { task_type, status, message, model, workspace_id, current, total, current_task_type } = event;
    taskRevisions.set(task_type, ++revision);
    if (status === "queued" || status === "started" || status === "processing") {
      const previous = get().jobs.get(task_type);
      const startsRun = (status === "started" && previous?.status !== "queued")
        || (status === "queued" && !previous);
      if (startsRun) { runRevisions.set(task_type, revision); }
      if (!previous || startsRun) { contextRequested.delete(task_type); }
      const needsHydrate = !workspace_id;
      set((state) => {
        const nextJobs = new Map(state.jobs);
        const existing = startsRun ? undefined : nextJobs.get(task_type);
        nextJobs.set(task_type, {
          task_type,
          workspace_id: workspace_id ?? existing?.workspace_id,
          message: message || existing?.message,
          model: model ?? existing?.model,
          started_at: existing?.started_at,
          status: status === "queued" ? "queued" : "running",
          current: current ?? existing?.current,
          total: total ?? existing?.total,
          current_task_type: current_task_type ?? existing?.current_task_type,
        });
        return { jobs: nextJobs };
      });
      // Only hydrate as a last resort if the event arrived without a
      // workspace_id AND we don't already know one. This covers the legacy
      // scheduler path that doesn't carry workspace context; manual job starts
      // always populate workspace_id on the event itself, so they never trip
      // this path.
      if (needsHydrate && !get().jobs.get(task_type)?.workspace_id && !contextRequested.has(task_type)) {
        contextRequested.add(task_type);
        if (hydration && (runRevisions.get(task_type) ?? 0) > hydrationRevision) {
          // At most one follow-up snapshot per unresolved run, rather than
          // attaching the new run to the old run's in-flight request.
          reconcileAfterHydration = true;
        } else {
          get().hydrate().catch(() => {});
        }
        // Preserve the requesting event too if the snapshot has no entry yet.
        taskRevisions.set(task_type, ++revision);
      }
    } else {
      runRevisions.set(task_type, revision);
      contextRequested.delete(task_type);
      // completed | failed | cancelled — clear the entry.
      set((state) => {
        const hasJob = state.jobs.has(task_type);
        if (!hasJob && status !== "failed" && !state.lastErrors.has(task_type)) { return state; }
        const nextJobs = hasJob ? new Map(state.jobs) : state.jobs;
        if (hasJob) { nextJobs.delete(task_type); }
        // Capture the failure reason in-memory so the inference jobs panel
        // can surface it. Completed/cancelled events clear the slot so a
        // successful retry hides the prior error.
        const nextErrors = new Map(state.lastErrors);
        if (status === "failed") {
          nextErrors.set(task_type, {
            taskType: task_type,
            message: (message || "Job failed without a message.").trim(),
            at: Date.now(),
            workspaceId: workspace_id,
            model,
          });
        } else if (nextErrors.has(task_type)) {
          nextErrors.delete(task_type);
        }
        return { jobs: nextJobs, lastErrors: nextErrors };
      });
    }
  },

  removeJob: (taskType) => {
    taskRevisions.set(taskType, ++revision);
    runRevisions.set(taskType, revision);
    contextRequested.delete(taskType);
    set((state) => {
      if (!state.jobs.has(taskType)) { return state; }
      const nextJobs = new Map(state.jobs);
      nextJobs.delete(taskType);
      return { jobs: nextJobs };
    });
  },

  dismissError: (taskType) => {
    set((state) => {
      if (!state.lastErrors.has(taskType)) { return state; }
      const nextErrors = new Map(state.lastErrors);
      nextErrors.delete(taskType);
      return { lastErrors: nextErrors };
    });
  },
  };
});
