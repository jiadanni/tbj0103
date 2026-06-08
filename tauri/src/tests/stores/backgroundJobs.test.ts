import { describe, it, expect, beforeEach, vi } from "vitest";
import { useBackgroundJobsStore } from "../../stores/backgroundJobs";
import { api, type ActiveJob } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    system: {
      listActiveBackgroundJobs: vi.fn(),
    },
  },
}));

describe("backgroundJobsStore", () => {
  beforeEach(() => {
    useBackgroundJobsStore.setState({
      jobs: new Map(),
      hydrated: false,
    });
    vi.clearAllMocks();
  });

  it("hydrates active jobs and replaces the map", async () => {
    const mockJobs: ActiveJob[] = [
      {
        task_type: "workspace_prompt_bank",
        workspace_id: "ws-1",
        status: "running",
        model: "llama3",
      },
      {
        task_type: "memory_extraction",
        status: "queued",
      },
    ];
    vi.mocked(api.system.listActiveBackgroundJobs).mockResolvedValue(mockJobs);

    await useBackgroundJobsStore.getState().hydrate();

    const state = useBackgroundJobsStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.jobs.size).toBe(2);
    expect(state.jobs.get("workspace_prompt_bank")).toEqual(mockJobs[0]);
    expect(state.jobs.get("memory_extraction")).toEqual(mockJobs[1]);
  });

  it("applies 'queued', 'started', and 'processing' events by setting entries", () => {
    const store = useBackgroundJobsStore.getState();

    store.applyEvent({
      task_type: "summarization",
      status: "queued",
      message: "Queued for summarization",
      model: "gemma",
    });

    let jobs = useBackgroundJobsStore.getState().jobs;
    expect(jobs.size).toBe(1);
    expect(jobs.get("summarization")).toEqual({
      task_type: "summarization",
      workspace_id: undefined,
      message: "Queued for summarization",
      model: "gemma",
      status: "queued",
    });

    // Test 'started' event
    store.applyEvent({
      task_type: "summarization",
      status: "started",
      message: "Summarization started",
      model: "gemma",
    });

    jobs = useBackgroundJobsStore.getState().jobs;
    expect(jobs.size).toBe(1);
    expect(jobs.get("summarization")).toEqual({
      task_type: "summarization",
      workspace_id: undefined,
      message: "Summarization started",
      model: "gemma",
      status: "running",
    });

    // Test 'processing' event preserves existing metadata
    store.applyEvent({
      task_type: "summarization",
      status: "processing",
      message: "Processing summarization",
    });

    jobs = useBackgroundJobsStore.getState().jobs;
    expect(jobs.size).toBe(1);
    expect(jobs.get("summarization")).toEqual({
      task_type: "summarization",
      workspace_id: undefined,
      message: "Processing summarization",
      model: "gemma", // Preserved from previous
      status: "running",
    });
  });

  it("applies terminal events ('completed', 'failed') by deleting entries", () => {
    const store = useBackgroundJobsStore.getState();
    
    // Seed the store with a job
    useBackgroundJobsStore.setState({
      jobs: new Map([
        [
          "workspace_prompt_bank",
          {
            task_type: "workspace_prompt_bank",
            workspace_id: "ws-1",
            status: "running",
          },
        ],
      ]),
    });

    // Apply 'completed' event
    store.applyEvent({
      task_type: "workspace_prompt_bank",
      status: "completed",
      message: "Starter prompts refreshed",
    });

    let jobs = useBackgroundJobsStore.getState().jobs;
    expect(jobs.size).toBe(0);

    // Seed again and apply 'failed' event
    useBackgroundJobsStore.setState({
      jobs: new Map([
        [
          "workspace_prompt_bank",
          {
            task_type: "workspace_prompt_bank",
            workspace_id: "ws-1",
            status: "running",
          },
        ],
      ]),
    });

    store.applyEvent({
      task_type: "workspace_prompt_bank",
      status: "failed",
      message: "Starter prompts refresh failed",
    });

    jobs = useBackgroundJobsStore.getState().jobs;
    expect(jobs.size).toBe(0);
  });

  it("multiple hydrate calls are idempotent and replace map contents", async () => {
    const store = useBackgroundJobsStore.getState();
    
    const mockJobs1: ActiveJob[] = [
      {
        task_type: "memory_extraction",
        status: "running",
      },
    ];
    vi.mocked(api.system.listActiveBackgroundJobs).mockResolvedValue(mockJobs1);

    await store.hydrate();
    expect(useBackgroundJobsStore.getState().jobs.size).toBe(1);
    expect(useBackgroundJobsStore.getState().jobs.get("memory_extraction")?.status).toBe("running");

    const mockJobs2: ActiveJob[] = [
      {
        task_type: "summarization",
        status: "queued",
      },
    ];
    vi.mocked(api.system.listActiveBackgroundJobs).mockResolvedValue(mockJobs2);

    await store.hydrate();
    expect(useBackgroundJobsStore.getState().jobs.size).toBe(1);
    expect(useBackgroundJobsStore.getState().jobs.get("summarization")?.status).toBe("queued");
    expect(useBackgroundJobsStore.getState().jobs.get("memory_extraction")).toBeUndefined();
  });
});
