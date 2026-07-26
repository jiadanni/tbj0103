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
  pauseStatus: PauseStatus | null;
  hydrate: () => Promise<void>;
  applyEvent: (event: BackgroundTaskEvent) => void;
  removeJob: (taskType: string) => void;
  dismissError: (taskType: string) => void;
  fetchPauseStatus: () => Promise<void>;
  pause: (durationSeconds: number | null) => Promise<void>;
  resume: () => Promise<void>;
}

export const useBackgroundJobsStore = create<BackgroundJobsState>((set, get) => ({
  jobs: new Map(),
  lastErrors: new Map(),
  hydrated: false,
  pauseStatus: null,

  hydrate: async () => {
    try {
      const activeJobs = await api.system.listActiveBackgroundJobs();
      const pauseStatus = await api.backgroundJobs.getPauseStatus();
      set(() => {
        const nextJobs = new Map<string, ActiveJob>();
        activeJobs.forEach((job) => {
          nextJobs.set(job.task_type, job);
        });
        return {
          jobs: nextJobs,
          pauseStatus,
          hydrated: true,
        };
      });
    } catch (e) {
      console.error("Failed to hydrate background jobs:", e);
    }
  },

  fetchPauseStatus: async () => {
    try {
      const status = await api.backgroundJobs.getPauseStatus();
      set({ pauseStatus: status });
    } catch (e) {
      console.error("Failed to fetch pause status:", e);
    }
  },

  pause: async (durationSeconds) => {
    try {
      await api.backgroundJobs.pause(durationSeconds);
      await get().fetchPauseStatus();
    } catch (e) {
      console.error("Failed to pause scheduler:", e);
    }
  },

  resume: async () => {
    try {
      await api.backgroundJobs.resume();
      await get().fetchPauseStatus();
    } catch (e) {
      console.error("Failed to resume scheduler:", e);
    }
  },

  applyEvent: (event) => {
    const { task_type, status, message, model, workspace_id, current, total, current_task_type } = event;
    if (status === "queued" || status === "started" || status === "processing") {
      const needsHydrate = task_type === "workspace_prompt_bank" && !workspace_id;
      set((state) => {
        const nextJobs = new Map(state.jobs);
        const existing = nextJobs.get(task_type);
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
      if (needsHydrate && !get().jobs.get(task_type)?.workspace_id) {
        get().hydrate().catch(() => {});
      }
    } else {
      // completed | failed | cancelled — clear the entry.
      set((state) => {
        const hasJob = state.jobs.has(task_type);
        if (!hasJob && status !== "failed") { return state; }
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
}));
