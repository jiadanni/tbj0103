import type { NavigateFunction } from "react-router-dom";
import type { QuickSearchResult } from "./api";

/**
 * Route to the thing a quick-search result points at.
 *
 * Shared so every surface opens a result the same way: the systray window
 * routes through the `app:navigate-target` Tauri event (handled in `App.tsx`),
 * while the dashboard omnibox is already inside the main window and calls this
 * directly rather than round-tripping through the backend — going through
 * `open_quick_search_result` there would also try to hide the systray window.
 */
export function navigateToQuickSearchResult(
  navigate: NavigateFunction,
  target: QuickSearchResult,
) {
  switch (target.kind) {
    case "artifact":
      navigate(target.session_id ? `/chat/${target.session_id}` : "/chat");
      // Let the chat view mount before asking it to open the artifact.
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("aetherium:open-artifact", {
          detail: { artifactId: target.target_id },
        }));
      }, 0);
      break;
    case "memory":
      if (target.source_session_id) {
        navigate(`/chat/${target.source_session_id}`);
      } else {
        navigate("/preferences", { state: { settingsTab: "memory" } });
      }
      break;
    case "message":
    case "summary":
      navigate(target.session_id ? `/chat/${target.session_id}` : "/chat");
      break;
    case "conversation":
    default: {
      const sessionId = target.session_id ?? target.target_id;
      navigate(sessionId ? `/chat/${sessionId}` : "/chat");
      break;
    }
  }
}
