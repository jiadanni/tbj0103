// Module-scoped guard: workspaces for which generateWorkspacePrompts is in
// flight or already produced suggestions in this session. Survives ChatView
// unmount/remount during intra-app navigation so re-entering Chat doesn't
// re-fire the (multi-second) LLM call.
const workspacePromptsInFlight = new Set<string>();

export function hasPendingWorkspacePrompts(workspaceId: string): boolean {
  return workspacePromptsInFlight.has(workspaceId);
}

export function markWorkspacePromptsInFlight(workspaceId: string): void {
  workspacePromptsInFlight.add(workspaceId);
}

export function clearWorkspacePromptsInFlight(workspaceId: string): void {
  workspacePromptsInFlight.delete(workspaceId);
}

/** Test-only: clear the entire in-flight dedup set. */
export function __resetWorkspacePromptsDedup(): void {
  workspacePromptsInFlight.clear();
}
