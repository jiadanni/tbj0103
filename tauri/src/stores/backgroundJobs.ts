import { create } from "zustand";
import { api, type ActiveJob, type BackgroundTaskEvent } from "../lib/api";

interface BackgroundJobsState {
  jobs: Map<string, ActiveJob>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  applyEvent: (event: BackgroundTaskEvent) => void;
  removeJob: (taskType: string) => void;
}

export const useBackgroundJobsStore = create<BackgroundJobsState>((set, get) => ({
  jobs: new Map(),
  hydrated: false,

  hydrate: async () => {
    try {
      const activeJobs = await api.system.listActiveBackgroundJobs();
      set(() => {
        const nextJobs = new Map<string, ActiveJob>();
        activeJobs.forEach((job) => {
          nextJobs.set(job.task_type, job);
        });
        return {
          jobs: nextJobs,
          hydrated: true,
        };
      });
    } catch (e) {
      console.error("Failed to hydrate background jobs:", e);
    }
  },

  applyEvent: (event) => {
    const { task_type, status, message, model, workspace_id } = event;
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
        if (!state.jobs.has(task_type)) { return state; }
        const nextJobs = new Map(state.jobs);
        nextJobs.delete(task_type);
        return { jobs: nextJobs };
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
}));
