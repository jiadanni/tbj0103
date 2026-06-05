import { create } from "zustand";
import { api, type ActiveJob, type BackgroundTaskEvent } from "../lib/api";

interface BackgroundJobsState {
  jobs: Map<string, ActiveJob>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  applyEvent: (event: BackgroundTaskEvent | { task_type: string; status: string; message: string; model?: string; workspace_id?: string }) => void;
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
    const { task_type, status, model } = event;
    if (status === "started" || status === "processing") {
      set((state) => {
        const nextJobs = new Map(state.jobs);
        const existing = nextJobs.get(task_type);
        nextJobs.set(task_type, {
          task_type,
          workspace_id: ("workspace_id" in event ? event.workspace_id : undefined) ?? existing?.workspace_id,
          model: model ?? existing?.model,
          status,
        });
        return { jobs: nextJobs };
      });
      // Self-heal/re-hydrate workspaceId for prompt bank tasks if not known yet
      if (task_type === "workspace_prompt_bank") {
        get().hydrate().catch(() => {});
      }
    } else {
      set((state) => {
        const nextJobs = new Map(state.jobs);
        nextJobs.delete(task_type);
        return { jobs: nextJobs };
      });
    }
  },
}));
