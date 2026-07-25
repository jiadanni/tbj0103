import { useEffect } from "react";
import { api } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

// Background job task types whose completion can change a workspace's topic
// signature: the dedicated `topic_signature` recompute, `concept_hierarchy`
// (runs after topic linking), and `workspace_prompt_bank` (the "Starter
// Prompts / Topic Signatures" job).
const SIGNATURE_AFFECTING_TASK_TYPES = new Set([
  "topic_signature",
  "concept_hierarchy",
  "workspace_prompt_bank",
]);

/**
 * Keeps the active workspace's topic signature fresh.
 *
 * Instead of a blind 60s poll, it refetches only when there's a reason to: on
 * window focus / visibility regain, and whenever a signature-affecting
 * background job completes for this workspace. Results are written back into
 * the workspace store via the stable `setWorkspaceTopicSignature` action. No
 * value is returned — this is a pure side-effect hook.
 */
export function useTopicSignatureRefresh(effectiveWorkspaceId: string | null | undefined) {
  const setWorkspaceTopicSignature = useWorkspaceStore((s) => s.setWorkspaceTopicSignature);

  useEffect(() => {
    if (!effectiveWorkspaceId) { return; }

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const refreshSignature = () => {
      if (document.visibilityState === "hidden") { return; }
      api.topicSignature.get(effectiveWorkspaceId)
        .then((sig) => {
          if (!cancelled) {
            setWorkspaceTopicSignature(effectiveWorkspaceId, sig);
          }
        })
        .catch(() => { });
    };

    document.addEventListener("visibilitychange", refreshSignature);
    window.addEventListener("focus", refreshSignature);

    api.listenBackgroundTask((event) => {
      if (event.status !== "completed") { return; }
      if (!SIGNATURE_AFFECTING_TASK_TYPES.has(event.task_type)) { return; }
      if (event.workspace_id && event.workspace_id !== effectiveWorkspaceId) { return; }
      refreshSignature();
    })
      .then((fn) => { if (cancelled) { fn(); } else { unlisten = fn; } })
      .catch(() => {});

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", refreshSignature);
      window.removeEventListener("focus", refreshSignature);
      if (unlisten) { unlisten(); }
    };
  }, [effectiveWorkspaceId, setWorkspaceTopicSignature]);
}
