import { api } from "./api";
import { useBackgroundJobsStore } from "../stores/backgroundJobs";

const RETRY_CONNECTION_EVENT = "aetherium:retry-background-jobs";

export function retryBackgroundJobsConnection() {
  window.dispatchEvent(new Event(RETRY_CONNECTION_EVENT));
}

/** Owns listeners for one effect lifetime, including asynchronous registration. */
export function startBackgroundJobsLifecycle(ready: boolean): () => void {
  if (!ready) { return () => {}; }
  let disconnect = connectBackgroundJobs();
  const reconnect = () => {
    disconnect();
    disconnect = connectBackgroundJobs();
  };
  window.addEventListener(RETRY_CONNECTION_EVENT, reconnect);
  return () => {
    window.removeEventListener(RETRY_CONNECTION_EVENT, reconnect);
    disconnect();
  };
}

function connectBackgroundJobs(): () => void {
  let disposed = false;
  let subscribed = false;
  const unlisteners: Array<() => void> = [];
  const pendingEvents: Array<() => void> = [];
  const dispatch = (apply: () => void) => {
    if (disposed) { return; }
    if (subscribed) { apply(); } else { pendingEvents.push(apply); }
  };
  const hydrate = () => {
    if (disposed || !subscribed) { return; }
    void useBackgroundJobsStore.getState().hydrate().catch(() => {});
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") { hydrate(); }
  };
  const cleanup = () => {
    disposed = true;
    pendingEvents.length = 0;
    unlisteners.splice(0).forEach((unlisten) => unlisten());
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", hydrate);
  };
  const register = async (listen: () => Promise<() => void>) => {
    const unlisten = await listen();
    if (disposed) { unlisten(); } else { unlisteners.push(unlisten); }
  };

  void Promise.all([
    register(() => api.listenBackgroundTask((payload) => dispatch(() => {
      useBackgroundJobsStore.getState().applyEvent(payload);
    }))),
    register(() => api.listenBackgroundSchedulerPauseStatus((status) => dispatch(() => {
      useBackgroundJobsStore.getState().applyPauseStatus(status);
    }))),
    register(() => api.knowledge.listenWorkspaceProgress((payload) => dispatch(() => {
      const store = useBackgroundJobsStore.getState();
      if (payload.status === "started") {
        // Workspace analysis preempts prompt-bank display without inventing
        // a failure event (both jobs share the global semaphore).
        store.removeJob("workspace_prompt_bank");
        store.applyEvent({
          task_type: "workspace_analysis",
          status: "started",
          message: payload.label,
          model: payload.model,
          workspace_id: payload.workspace_id,
        });
      } else {
        store.removeJob("workspace_analysis");
      }
    }))),
  ]).then(() => {
    if (disposed) { return; }
    subscribed = true;
    useBackgroundJobsStore.setState({ subscriptionError: null });
    // Start the snapshot revision before replaying events received during
    // registration so those events win over the snapshot as well.
    hydrate();
    pendingEvents.splice(0).forEach((apply) => apply());
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", hydrate);
  }).catch((error: unknown) => {
    if (!disposed) {
      useBackgroundJobsStore.setState({ subscriptionError: `Background updates disconnected: ${String(error)}` });
      cleanup();
    }
  });

  return cleanup;
}
