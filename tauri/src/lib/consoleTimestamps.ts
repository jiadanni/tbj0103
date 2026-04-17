const PATCH_FLAG = "__aetheriumConsoleTimestampPatched__";

type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";

const LEVEL_MAP: Record<ConsoleMethod, string> = {
  debug: "debug",
  info: "info",
  log: "info",
  warn: "warn",
  error: "error",
};

let forwardToBackend = false;
let forwardFn: ((level: string, source: string, message: string) => void) | null = null;

/**
 * Enable forwarding console.warn and console.error to the backend log store.
 * Call after installing timestamps and after Tauri IPC is available.
 */
export function enableLogForwarding(fn: (level: string, source: string, message: string) => void): void {
  forwardFn = fn;
  forwardToBackend = true;
}

export function installConsoleTimestamps(): void {
  /* eslint-disable no-console */
  const consoleWithFlag = console as Console & { [PATCH_FLAG]?: boolean };
  if (consoleWithFlag[PATCH_FLAG]) {
    return;
  }

  const methods: ConsoleMethod[] = ["debug", "error", "info", "log", "warn"];

  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = ((...args: unknown[]) => {
      original(`[${new Date().toISOString()}]`, ...args);
      // Forward warn/error to persistent backend logs
      if (forwardToBackend && forwardFn && (method === "warn" || method === "error")) {
        try {
          const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
          forwardFn(LEVEL_MAP[method], "frontend", msg);
        } catch {
          // never throw from logging
        }
      }
    }) as Console[ConsoleMethod];
  }

  consoleWithFlag[PATCH_FLAG] = true;
  /* eslint-enable no-console */
}
