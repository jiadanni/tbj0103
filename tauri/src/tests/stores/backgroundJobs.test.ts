import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useBackgroundJobsStore } from "../../stores/backgroundJobs";
import { api, type ActiveJob, type PauseStatus } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    system: {
      listActiveBackgroundJobs: vi.fn(),
    },
    backgroundJobs: {
      getPauseStatus: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    },
  },
}));

const NOT_PAUSED: PauseStatus = {
  is_paused: false,
  paused_until: null,
  paused_indefinitely: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("backgroundJobsStore", () => {
  afterEach(async () => {
    if (useBackgroundJobsStore.getState().hydrating) {
      await useBackgroundJobsStore.getState().hydrate().catch(() => {});
    }
  });

  beforeEach(() => {
    useBackgroundJobsStore.getState().removeJob("workspace_prompt_bank");
    useBackgroundJobsStore.setState({
      jobs: new Map(),
      lastErrors: new Map(),
      hydrated: false,
      hydrating: false,
      hydrationError: null,
      pauseError: null,
      pauseStatus: null,
    });
    vi.resetAllMocks();
    vi.mocked(api.system.listActiveBackgroundJobs).mockResolvedValue([]);
    vi.mocked(api.backgroundJobs.getPauseStatus).mockResolvedValue(NOT_PAUSED);
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

  it("shares overlapping hydration and preserves events newer than the snapshot", async () => {
    const snapshot = deferred<ActiveJob[]>();
    vi.mocked(api.system.listActiveBackgroundJobs).mockReturnValue(snapshot.promise);
    const store = useBackgroundJobsStore.getState();
    const first = store.hydrate();
    expect(store.hydrate()).toBe(first);
    expect(useBackgroundJobsStore.getState().hydrating).toBe(true);
    await Promise.resolve();
    store.applyEvent({ task_type: "new", status: "started", message: "new task", workspace_id: "ws-new" });
    store.applyEvent({ task_type: "updated", status: "processing", message: "latest", current: 4 });
    store.applyEvent({ task_type: "completed", status: "completed", message: "" });
    store.applyEvent({ task_type: "cancelled", status: "cancelled", message: "" });
    store.applyEvent({ task_type: "failed", status: "failed", message: "failure" });
    store.removeJob("removed");
    snapshot.resolve(["updated", "completed", "cancelled", "failed", "removed"].map((task_type) => ({
      task_type, status: "running", current: 1, workspace_id: "ws-1",
    })));
    await first;
    expect(api.system.listActiveBackgroundJobs).toHaveBeenCalledTimes(1);
    expect(api.backgroundJobs.getPauseStatus).toHaveBeenCalledTimes(1);
    const state = useBackgroundJobsStore.getState();
    expect([...state.jobs.keys()].sort()).toEqual(["new", "updated"]);
    expect(state.jobs.get("updated")).toMatchObject({ current: 4, message: "latest", workspace_id: "ws-1" });
    expect(state.lastErrors.get("failed")?.message).toBe("failure");
    expect(state.hydrating).toBe(false);
  });

  it("keeps a restarted task when its previous run completes during hydration", async () => {
    const snapshot = deferred<ActiveJob[]>();
    vi.mocked(api.system.listActiveBackgroundJobs).mockReturnValue(snapshot.promise);
    const store = useBackgroundJobsStore.getState();
    const hydration = store.hydrate();
    store.applyEvent({ task_type: "retry", status: "completed", message: "" });
    store.applyEvent({ task_type: "retry", status: "started", message: "retrying", workspace_id: "ws-new" });
    snapshot.resolve([]);
    await hydration;
    expect(useBackgroundJobsStore.getState().jobs.get("retry")?.message).toBe("retrying");
  });

  it("never borrows old-run metadata and requests one fresh snapshot for an unresolved restart", async () => {
    const oldSnapshot = deferred<ActiveJob[]>();
    const newSnapshot = deferred<ActiveJob[]>();
    vi.mocked(api.system.listActiveBackgroundJobs)
      .mockReturnValueOnce(oldSnapshot.promise)
      .mockReturnValueOnce(newSnapshot.promise);
    const store = useBackgroundJobsStore.getState();
    const first = store.hydrate();
    store.applyEvent({ task_type: "workspace_prompt_bank", status: "completed", message: "" });
    store.applyEvent({ task_type: "workspace_prompt_bank", status: "started", message: "New run" });
    for (let i = 0; i < 20; i++) {
      store.applyEvent({ task_type: "workspace_prompt_bank", status: "processing", message: "New progress" });
    }
    oldSnapshot.resolve([{
      task_type: "workspace_prompt_bank", status: "running",
      workspace_id: "old-workspace", started_at: "old-time",
    }]);
    await first;
    const restarted = useBackgroundJobsStore.getState().jobs.get("workspace_prompt_bank");
    expect(restarted?.workspace_id).toBeUndefined();
    expect(restarted?.started_at).toBeUndefined();
    expect(restarted?.message).toBe("New progress");
    expect(api.system.listActiveBackgroundJobs).toHaveBeenCalledTimes(2);
    const reconciliation = store.hydrate();
    for (let i = 0; i < 20; i++) {
      store.applyEvent({ task_type: "workspace_prompt_bank", status: "processing", message: "Latest progress" });
    }
    newSnapshot.resolve([{
      task_type: "workspace_prompt_bank", status: "running",
      workspace_id: "new-workspace", started_at: "new-time",
    }]);
    await reconciliation;
    expect(useBackgroundJobsStore.getState().jobs.get("workspace_prompt_bank")).toMatchObject({
      workspace_id: "new-workspace", started_at: "new-time", message: "Latest progress",
    });
    expect(api.system.listActiveBackgroundJobs).toHaveBeenCalledTimes(2);
  });

  it("retains the previous cache and failure history when a snapshot fails, then permits retry", async () => {
    const store = useBackgroundJobsStore.getState();
    store.applyEvent({ task_type: "running", status: "started", message: "running" });
    store.applyEvent({ task_type: "failed", status: "failed", message: "job error" });
    const jobs = useBackgroundJobsStore.getState().jobs;
    const errors = useBackgroundJobsStore.getState().lastErrors;
    vi.mocked(api.system.listActiveBackgroundJobs).mockRejectedValueOnce(new Error("snapshot failed"));
    await expect(store.hydrate()).rejects.toThrow("snapshot failed");
    expect(useBackgroundJobsStore.getState()).toMatchObject({
      jobs, lastErrors: errors, hydrated: false, hydrating: false, hydrationError: "Error: snapshot failed",
    });
    await store.hydrate();
    expect(useBackgroundJobsStore.getState()).toMatchObject({ hydrated: true, hydrationError: null, lastErrors: errors });
  });

  it("does not clear a last failure merely because a refresh succeeds", async () => {
    const store = useBackgroundJobsStore.getState();
    store.applyEvent({ task_type: "job", status: "failed", message: "failed" });
    await store.hydrate();
    expect(useBackgroundJobsStore.getState().lastErrors.has("job")).toBe(true);
    // Completion must clear the failure even when no active entry remains.
    store.applyEvent({ task_type: "job", status: "completed", message: "" });
    expect(useBackgroundJobsStore.getState().lastErrors.has("job")).toBe(false);
  });

  it("reconciles missing context once per run, including across sequential event storms", async () => {
    const store = useBackgroundJobsStore.getState();
    const progress = () => store.applyEvent({
      task_type: "workspace_prompt_bank", status: "processing", message: "working",
    });
    for (let i = 0; i < 20; i++) { progress(); }
    await store.hydrate();
    for (let i = 0; i < 20; i++) { progress(); }
    await Promise.resolve();
    expect(api.system.listActiveBackgroundJobs).toHaveBeenCalledTimes(1);
    expect(useBackgroundJobsStore.getState().jobs.has("workspace_prompt_bank")).toBe(true);
    store.applyEvent({ task_type: "workspace_prompt_bank", status: "completed", message: "" });
    vi.mocked(api.system.listActiveBackgroundJobs).mockResolvedValue([{
      task_type: "workspace_prompt_bank", workspace_id: "resolved", status: "running",
    }]);
    progress();
    await store.hydrate();
    expect(api.system.listActiveBackgroundJobs).toHaveBeenCalledTimes(2);
    expect(useBackgroundJobsStore.getState().jobs.get("workspace_prompt_bank")?.workspace_id).toBe("resolved");
  });

  it("does not continuously retry failed context reconciliation", async () => {
    const store = useBackgroundJobsStore.getState();
    vi.mocked(api.system.listActiveBackgroundJobs).mockRejectedValue(new Error("offline"));
    store.applyEvent({ task_type: "workspace_prompt_bank", status: "started", message: "" });
    await expect(store.hydrate()).rejects.toThrow("offline");
    store.applyEvent({ task_type: "workspace_prompt_bank", status: "processing", message: "" });
    await Promise.resolve();
    expect(api.system.listActiveBackgroundJobs).toHaveBeenCalledTimes(1);
    expect(useBackgroundJobsStore.getState().hydrationError).toContain("offline");
  });

  it("allows a new context request after a refresh removes a finished run", async () => {
    const store = useBackgroundJobsStore.getState();
    const started = () => store.applyEvent({
      task_type: "workspace_prompt_bank", status: "started", message: "",
    });
    started();
    await store.hydrate();
    await store.hydrate();
    expect(useBackgroundJobsStore.getState().jobs.has("workspace_prompt_bank")).toBe(false);
    started();
    await store.hydrate();
    expect(api.system.listActiveBackgroundJobs).toHaveBeenCalledTimes(3);
    expect(useBackgroundJobsStore.getState().jobs.has("workspace_prompt_bank")).toBe(true);
  });

  it("preserves a hydrated cache when only the pause snapshot fails", async () => {
    const store = useBackgroundJobsStore.getState();
    await store.hydrate();
    store.applyEvent({ task_type: "running", status: "started", message: "" });
    vi.mocked(api.backgroundJobs.getPauseStatus).mockRejectedValueOnce(new Error("pause unavailable"));
    await expect(store.hydrate()).rejects.toThrow("pause unavailable");
    expect(useBackgroundJobsStore.getState()).toMatchObject({
      hydrated: true, hydrating: false, pauseStatus: NOT_PAUSED,
      hydrationError: "Error: pause unavailable",
    });
    expect(useBackgroundJobsStore.getState().jobs.has("running")).toBe(true);
  });

  it("does not overwrite a pause event with an older snapshot", async () => {
    const snapshot = deferred<PauseStatus>();
    vi.mocked(api.backgroundJobs.getPauseStatus).mockReturnValue(snapshot.promise);
    const store = useBackgroundJobsStore.getState();
    const hydration = store.hydrate();
    const paused = { is_paused: true, paused_until: null, paused_indefinitely: true };
    store.applyPauseStatus(paused);
    snapshot.resolve(NOT_PAUSED);
    await hydration;
    expect(useBackgroundJobsStore.getState().pauseStatus).toEqual(paused);
  });

  it.each(["pause", "resume"] as const)("rejects failed %s commands and records the error", async (action) => {
    vi.mocked(api.backgroundJobs[action]).mockRejectedValue(new Error("command failed"));
    const store = useBackgroundJobsStore.getState();
    await expect(action === "pause" ? store.pause(null) : store.resume()).rejects.toThrow("command failed");
    expect(useBackgroundJobsStore.getState().pauseError).toContain("command failed");
    expect(api.backgroundJobs.getPauseStatus).not.toHaveBeenCalled();
  });

  it("rejects a pause refresh failure without losing the previous pause status", async () => {
    useBackgroundJobsStore.setState({ pauseStatus: NOT_PAUSED });
    vi.mocked(api.backgroundJobs.getPauseStatus).mockRejectedValue(new Error("refresh failed"));
    await expect(useBackgroundJobsStore.getState().pause(60)).rejects.toThrow("refresh failed");
    expect(useBackgroundJobsStore.getState().pauseStatus).toEqual(NOT_PAUSED);
    expect(useBackgroundJobsStore.getState().pauseError).toContain("refresh failed");
  });
});
