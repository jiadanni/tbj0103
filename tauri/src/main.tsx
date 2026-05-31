import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { installConsoleTimestamps, enableBatchLogForwarding } from "./lib/consoleTimestamps";
import { isLinux } from "./lib/platform";
import { api } from "./lib/api";
import { normalizeTheme } from "./lib/theme";
import "./styles/globals.css";
import "katex/dist/katex.min.css";

// Apply the persisted theme class synchronously, before React mounts, so the
// first paint (loading screen) renders against the user's theme rather than
// the :root default of #ffffff. Without this, app startup briefly flashes a
// white screen — and on slow boots (e.g. Ollama unreachable) that flash can
// linger long enough to feel like the app is broken.
try {
  const raw = window.localStorage.getItem("aetherium-settings");
  if (raw) {
    const parsed = JSON.parse(raw) as { state?: { theme?: string } };
    const theme = normalizeTheme(parsed?.state?.theme ?? "system");
    document.documentElement.classList.add(`theme-${theme}`);
  } else {
    document.documentElement.classList.add("theme-system");
  }
} catch {
  document.documentElement.classList.add("theme-system");
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

installConsoleTimestamps();

// Forward console.warn/error to persistent backend log store (batched)
enableBatchLogForwarding(
  (level, source, message) => {
    api.logs.logFrontendEvent(level, source, message).catch(() => {});
  },
  (events) => {
    api.logs.logFrontendEventsBatch(events).catch(() => {});
  },
);

if (isLinux) {
  document.documentElement.dataset.platform = "linux";
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
