import { useCallback, useEffect, useRef } from "react";
import { api, type ThoughtItem } from "../lib/api";

interface UseDueThoughtsParams {
  /** Workspace to scope the due-thought query to. Nullish disables the hook. */
  workspaceId: string | null | undefined;
  /**
   * When false the hook neither checks for nor processes due thoughts (e.g.
   * ChatView only runs it while the thought panel is open). ThoughtQueueView
   * passes `true` since the whole view is dedicated to thoughts.
   */
  enabled: boolean;
  ollamaUrl: string;
  setThoughts: React.Dispatch<React.SetStateAction<ThoughtItem[]>>;
  /** Called with a thought id once its result lands (used to expand its pane). */
  onProcessed?: (thoughtId: string) => void;
}

/**
 * Shared due-thought processor for ChatView and ThoughtQueueView.
 *
 * Instead of each view running its own 60s `getDue` poll (which drifted
 * between the two copies), this hook does an immediate check on
 * mount/enable and then listens for the backend `thought-due` event
 * (emitted by `start_thought_due_watcher`), re-querying `getDue` scoped to
 * the current workspace on each signal. `processDueThought` is returned so a
 * view can also trigger a thought immediately (ThoughtQueueView's "process
 * now" action).
 */
export function useDueThoughts({
  workspaceId,
  enabled,
  ollamaUrl,
  setThoughts,
  onProcessed,
}: UseDueThoughtsParams) {
  const processingRef = useRef<Set<string>>(new Set());

  const processDueThought = useCallback(
    async (thought: ThoughtItem) => {
      if (processingRef.current.has(thought.id)) { return; }
      processingRef.current.add(thought.id);
      try {
        await api.thoughtQueue.updateStatus(thought.id, "processing");
        setThoughts((prev) =>
          prev.map((t) => (t.id === thought.id ? { ...t, status: "processing" } : t))
        );

        const prefix = thought.prompt_prefix.trim();
        const userContent = prefix ? `${prefix}\n\n${thought.content}` : thought.content;

        const result = await api.ollama.sendMessage(
          thought.id,
          thought.model_name,
          [{ role: "user", content: userContent }],
          false,
          ollamaUrl,
        );

        await api.thoughtQueue.updateResult(thought.id, result);
        setThoughts((prev) =>
          prev.map((t) =>
            t.id === thought.id
              ? { ...t, status: "done", result, result_at: new Date().toISOString() }
              : t
          )
        );
        onProcessed?.(thought.id);
      } catch {
        // Revert to scheduled so the next signal can retry.
        await api.thoughtQueue.updateStatus(thought.id, "scheduled").catch(() => {});
        setThoughts((prev) =>
          prev.map((t) => (t.id === thought.id ? { ...t, status: "scheduled" } : t))
        );
      } finally {
        processingRef.current.delete(thought.id);
      }
    },
    [ollamaUrl, setThoughts, onProcessed],
  );

  useEffect(() => {
    if (!enabled || !workspaceId) { return; }

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const checkDue = async () => {
      if (cancelled || !workspaceId) { return; }
      try {
        const due = await api.thoughtQueue.getDue(workspaceId);
        for (const t of due) { processDueThought(t); }
      } catch { /* ignore */ }
    };

    checkDue(); // immediate on mount / enable

    api
      .listenThoughtDue(() => { void checkDue(); })
      .then((fn) => {
        if (cancelled) { fn(); } else { unlisten = fn; }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (unlisten) { unlisten(); }
    };
  }, [enabled, workspaceId, processDueThought]);

  return { processDueThought };
}
