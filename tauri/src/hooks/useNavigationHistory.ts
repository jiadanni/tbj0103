import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

interface NavigationEntry {
  path: string;
  search: string;
  state?: Record<string, unknown>;
  timestamp: number;
}

const MAX_HISTORY_SIZE = 50;
let globalHistory: NavigationEntry[] = [];
let historyIndex = -1;
let isNavigatingBackOrForward = false;

// Pub-sub: notify all hook instances when history changes so canGoBack/canGoForward
// stay in sync even though the underlying state is module-level.
type Listener = () => void;
const historyListeners = new Set<Listener>();
function notifyHistoryChange() {
  historyListeners.forEach((l) => l());
}

/**
 * Hook for managing browser-like navigation history with back/forward support.
 * Automatically tracks all navigation and provides goBack() and goForward() functions.
 */
export function useNavigationHistory() {
  const navigate = useNavigate();
  const location = useLocation();
  // forceUpdate makes canGoBack/canGoForward reactive after history mutations.
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    function listener() { forceUpdate((n) => n + 1); }
    historyListeners.add(listener);
    return () => { historyListeners.delete(listener); };
  }, []);

  useEffect(() => {
    // If we're handling a back/forward, don't add to history again
    if (isNavigatingBackOrForward) {
      isNavigatingBackOrForward = false;
      notifyHistoryChange();
      return;
    }

    // Add new entry if it differs from the last one
    const lastEntry = globalHistory[historyIndex];
    if (!lastEntry || lastEntry.path !== location.pathname || lastEntry.search !== location.search) {
      // Truncate forward history if we're in the middle
      globalHistory = globalHistory.slice(0, historyIndex + 1);

      // Add new entry
      globalHistory.push({
        path: location.pathname,
        search: location.search,
        state: (location.state as Record<string, unknown>) || undefined,
        timestamp: Date.now(),
      });

      // Limit history size
      if (globalHistory.length > MAX_HISTORY_SIZE) {
        globalHistory = globalHistory.slice(-MAX_HISTORY_SIZE);
      }

      historyIndex = globalHistory.length - 1;
      notifyHistoryChange();
    }
  }, [location.pathname, location.search, location.state]);

  const goBack = () => {
    if (historyIndex > 0) {
      historyIndex--;
      const entry = globalHistory[historyIndex];
      isNavigatingBackOrForward = true;
      navigate(entry.path + entry.search, { replace: true, state: entry.state });
    }
  };

  const goForward = () => {
    if (historyIndex < globalHistory.length - 1) {
      historyIndex++;
      const entry = globalHistory[historyIndex];
      isNavigatingBackOrForward = true;
      navigate(entry.path + entry.search, { replace: true, state: entry.state });
    }
  };

  return {
    goBack,
    goForward,
    canGoBack: historyIndex > 0,
    canGoForward: historyIndex < globalHistory.length - 1,
  };
}
