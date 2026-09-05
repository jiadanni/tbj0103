import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ActiveJob } from "../../lib/api";
import { retryBackgroundJobsConnection, startBackgroundJobsLifecycle } from "../../lib/backgroundJobsLifecycle";
import { useBackgroundJobsStore } from "../../stores/backgroundJobs";

vi.mock("../../lib/api", () => ({
  api: {
    system: { listActiveBackgroundJobs: vi.fn() },
    backgroundJobs: { getPauseStatus: vi.fn() },
    listenBackgroundTask: vi.fn(),
    listenBackgroundSchedulerPauseStatus: vi.fn(),
    knowledge: { listenWorkspaceProgress: vi.fn() },
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("background jobs lifecycle", () => {
  const cleanups: Array<() => void> = [];
  const start = (ready = true) => {
    const cleanup = startBackgroundJobsLifecycle(ready);
    cleanups.push(cleanup);
    return cleanup;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    useBackgroundJobsStore.setState({
      jobs: new Map(), lastErrors: new Map(), hydrated: false,
      hydrating: false, hydrationError: null, subscriptionError: null, pauseError: null, pauseStatus: null,
    });
    vi.mocked(api.system.listActiveBackgroundJobs).mockResolvedValue([]);
    vi.mocked(api.backgroundJobs.getPauseStatus).mockResolvedValue({
      is_paused: false, paused_until: null, paused_indefinitely: false,
    });
    vi.mocked(api.listenBackgroundTask).mockResolvedValue(vi.fn());
    vi.mocked(api.listenBackgroundSchedulerPauseStatus).mockResolvedValue(vi.fn());
    vi.mocked(api.knowledge.listenWorkspaceProgress).mockResolvedValue(vi.fn());
  });

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  it("does not subscribe or query until the boot gate is ready", async () => {
    start(false);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(api.listenBackgroundTask).not.toHaveBeenCalled();
    expect(api.system.listActiveBackgroundJobs).not.toHaveBeenCalled();
    expect(api.backgroundJobs.getPauseStatus).not.toHaveBeenCalled();
    start();
    await vi.waitFor(() => expect(useBackgroundJobsStore.getState().hydrated).toBe(true));
  });

  it("waits for every listener before hydration and replays buffered events over the snapshot", async () => {
    const listening = deferred<() => void>();
    vi.mocked(api.knowledge.listenWorkspaceProgress).mockReturnValue(listening.promise);
    vi.mocked(api.system.listActiveBackgroundJobs).mockResolvedValue([
      { task_type: "done", status: "running" },
    ]);
    start();
    const callback = vi.mocked(api.listenBackgroundTask).mock.calls[0][0];
    callback({ task_type: "done", status: "completed", message: "" });
    callback({ task_type: "new", status: "started", message: "new", workspace_id: "ws-new" });
    await Promise.resolve();
    expect(api.system.listActiveBackgroundJobs).not.toHaveBeenCalled();
    listening.resolve(vi.fn());
    await vi.waitFor(() => expect(useBackgroundJobsStore.getState().hydrated).toBe(true));
    expect([...useBackgroundJobsStore.getState().jobs.keys()]).toEqual(["new"]);
  });

  it("disposes late listener registrations and ignores their events after cleanup", async () => {
    const task = deferred<() => void>();
    const pause = deferred<() => void>();
    const workspace = deferred<() => void>();
    vi.mocked(api.listenBackgroundTask).mockReturnValue(task.promise);
    vi.mocked(api.listenBackgroundSchedulerPauseStatus).mockReturnValue(pause.promise);
    vi.mocked(api.knowledge.listenWorkspaceProgress).mockReturnValue(workspace.promise);
    const cleanup = start();
    cleanup();
    const unlisteners = [vi.fn(), vi.fn(), vi.fn()];
    task.resolve(unlisteners[0]);
    pause.resolve(unlisteners[1]);
    workspace.resolve(unlisteners[2]);
    await vi.waitFor(() => unlisteners.forEach((unlisten) => expect(unlisten).toHaveBeenCalledTimes(1)));
    vi.mocked(api.listenBackgroundTask).mock.calls[0][0]({
      task_type: "late", status: "started", message: "",
    });
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(useBackgroundJobsStore.getState().jobs.size).toBe(0);
    expect(api.system.listActiveBackgroundJobs).not.toHaveBeenCalled();
  });

  it("keeps only the remounted lifecycle active during StrictMode-style setup and cleanup", async () => {
    const oldListener = deferred<() => void>();
    const oldUnlisten = vi.fn();
    const newUnlisten = vi.fn();
    vi.mocked(api.listenBackgroundTask)
      .mockReturnValueOnce(oldListener.promise)
      .mockResolvedValueOnce(newUnlisten);
    start()();
    const cleanup = start();
    await vi.waitFor(() => expect(useBackgroundJobsStore.getState().hydrated).toBe(true));
    oldListener.resolve(oldUnlisten);
    await vi.waitFor(() => expect(oldUnlisten).toHaveBeenCalledTimes(1));
    expect(newUnlisten).not.toHaveBeenCalled();
    expect(api.system.listActiveBackgroundJobs).toHaveBeenCalledTimes(1);
    cleanup();
    expect(newUnlisten).toHaveBeenCalledTimes(1);
  });

  it("cleans up partial subscriptions when one listener rejects, including late successes", async () => {
    const failure = deferred<() => void>();
    const late = deferred<() => void>();
    const earlyUnlisten = vi.fn();
    const lateUnlisten = vi.fn();
    vi.mocked(api.listenBackgroundTask).mockResolvedValue(earlyUnlisten);
    vi.mocked(api.listenBackgroundSchedulerPauseStatus).mockReturnValue(failure.promise);
    vi.mocked(api.knowledge.listenWorkspaceProgress).mockReturnValue(late.promise);
    start();
    failure.reject(new Error("listen failed"));
    await vi.waitFor(() => expect(earlyUnlisten).toHaveBeenCalledTimes(1));
    late.resolve(lateUnlisten);
    await vi.waitFor(() => expect(lateUnlisten).toHaveBeenCalledTimes(1));
    expect(useBackgroundJobsStore.getState().subscriptionError).toContain("listen failed");
    expect(api.system.listActiveBackgroundJobs).not.toHaveBeenCalled();
  });

  it("coalesces focus and visibility hydration and removes both handlers on disposal", async () => {
    const cleanup = start();
    await vi.waitFor(() => expect(useBackgroundJobsStore.getState().hydrated).toBe(true));
    const snapshot = deferred<ActiveJob[]>();
    vi.mocked(api.system.listActiveBackgroundJobs).mockReturnValue(snapshot.promise);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    expect(api.system.listActiveBackgroundJobs).toHaveBeenCalledTimes(2);
    snapshot.resolve([]);
    await useBackgroundJobsStore.getState().hydrate();
    cleanup();
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(api.system.listActiveBackgroundJobs).toHaveBeenCalledTimes(2);
  });

  it("records snapshot failures without an unhandled rejection and retries on focus", async () => {
    vi.mocked(api.system.listActiveBackgroundJobs).mockRejectedValueOnce(new Error("snapshot failed"));
    start();
    await vi.waitFor(() => expect(useBackgroundJobsStore.getState().hydrationError).toContain("snapshot failed"));
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(useBackgroundJobsStore.getState().hydrated).toBe(true));
    expect(useBackgroundJobsStore.getState().hydrationError).toBeNull();
  });

  it("keeps connection errors until retry restores listeners, pause events, and focus hydration", async () => {
    vi.mocked(api.listenBackgroundTask).mockRejectedValueOnce(new Error("Registration failed"));
    const cleanup = start();
    await vi.waitFor(() => expect(useBackgroundJobsStore.getState().subscriptionError).toContain("Registration failed"));
    await useBackgroundJobsStore.getState().hydrate();
    expect(useBackgroundJobsStore.getState().subscriptionError).toContain("Registration failed");
    retryBackgroundJobsConnection();
    await vi.waitFor(() => expect(useBackgroundJobsStore.getState().subscriptionError).toBeNull());
    await useBackgroundJobsStore.getState().hydrate();
    expect(api.listenBackgroundTask).toHaveBeenCalledTimes(2);
    expect(api.listenBackgroundSchedulerPauseStatus).toHaveBeenCalledTimes(2);
    vi.mocked(api.listenBackgroundTask).mock.calls[1][0]({
      task_type: "reconnected", status: "started", workspace_id: "ws-1", message: "Live event",
    });
    expect(useBackgroundJobsStore.getState().jobs.get("reconnected")?.message).toBe("Live event");
    const paused = { is_paused: true, paused_until: null, paused_indefinitely: true };
    vi.mocked(api.listenBackgroundSchedulerPauseStatus).mock.calls[1][0](paused);
    expect(useBackgroundJobsStore.getState().pauseStatus).toEqual(paused);
    const calls = vi.mocked(api.system.listActiveBackgroundJobs).mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await useBackgroundJobsStore.getState().hydrate();
    expect(api.system.listActiveBackgroundJobs).toHaveBeenCalledTimes(calls + 1);
    cleanup();
    retryBackgroundJobsConnection();
    expect(api.listenBackgroundTask).toHaveBeenCalledTimes(2);
  });
});
