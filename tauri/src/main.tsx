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

// Pre-React boot overlay: injected synchronously so the user sees *something*
// even if React or the webview bundle is slow to come up. Removed in an
// effect inside App once the first React commit lands. Uses inline styles so
// it does not depend on Tailwind, theme variables, or any other CSS being
// applied yet — anything to avoid the bare-white screen.
function mountBootOverlay() {
  if (typeof document === "undefined") { return; }
  if (document.getElementById("aetherium-boot-overlay")) { return; }
  const overlay = document.createElement("div");
  overlay.id = "aetherium-boot-overlay";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "gap:14px",
    "background:#0e0e0e",
    "color:#f4f4f5",
    "font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',sans-serif",
    "transition:opacity 120ms ease-out",
  ].join(";");
  const spinner = document.createElement("div");
  spinner.setAttribute("aria-hidden", "true");
  spinner.style.cssText = [
    "width:24px",
    "height:24px",
    "border:2px solid rgba(255,255,255,0.18)",
    "border-top-color:rgba(255,255,255,0.85)",
    "border-radius:50%",
    "animation:aetherium-boot-spin 0.8s linear infinite",
  ].join(";");
  const label = document.createElement("div");
  label.id = "aetherium-boot-overlay-label";
  label.textContent = "Loading…";
  label.style.cssText = "opacity:0.7;letter-spacing:0.01em";
  const keyframes = document.createElement("style");
  keyframes.textContent =
    "@keyframes aetherium-boot-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}";
  overlay.appendChild(keyframes);
  overlay.appendChild(spinner);
  overlay.appendChild(label);
  document.body.appendChild(overlay);
}

mountBootOverlay();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
