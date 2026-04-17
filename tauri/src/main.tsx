import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { installConsoleTimestamps, enableLogForwarding } from "./lib/consoleTimestamps";
import { isLinux } from "./lib/platform";
import { api } from "./lib/api";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

installConsoleTimestamps();

// Forward console.warn/error to persistent backend log store
enableLogForwarding((level, source, message) => {
  api.logs.logFrontendEvent(level, source, message).catch(() => {});
});

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
