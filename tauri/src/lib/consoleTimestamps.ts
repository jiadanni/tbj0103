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
let batchForwardFn: ((events: Array<{ level: string; source: string; message: string }>) => void) | null = null;

// Batch buffer for frontend log forwarding
const LOG_BATCH_INTERVAL_MS = 500;
const LOG_BATCH_MAX_SIZE = 50;
let logBuffer: Array<{ level: string; source: string; message: string }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushLogBuffer(): void {
  if (logBuffer.length === 0) {
    return;
  }
  const batch = logBuffer;
  logBuffer = [];
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (batchForwardFn) {
    try {
      batchForwardFn(batch);
    } catch {
      // never throw from logging
    }
  } else if (forwardFn) {
    // Fallback to individual sends if batch fn not available
    for (const entry of batch) {
      try {
        forwardFn(entry.level, entry.source, entry.message);
      } catch {
        // never throw from logging
      }
    }
  }
}

function bufferLogEntry(level: string, source: string, message: string): void {
  logBuffer.push({ level, source, message });
  if (logBuffer.length >= LOG_BATCH_MAX_SIZE) {
    flushLogBuffer();
  } else if (flushTimer === null) {
    flushTimer = setTimeout(flushLogBuffer, LOG_BATCH_INTERVAL_MS);
  }
}

/**
 * Enable forwarding console.warn and console.error to the backend log store.
 * Call after installing timestamps and after Tauri IPC is available.
 */
export function enableLogForwarding(fn: (level: string, source: string, message: string) => void): void {
  forwardFn = fn;
  forwardToBackend = true;
}

/**
 * Enable batch forwarding — the preferred mode. When set, buffered entries
 * are sent in a single IPC call instead of one-per-event.
 */
export function enableBatchLogForwarding(
  singleFn: (level: string, source: string, message: string) => void,
  batchFn: (events: Array<{ level: string; source: string; message: string }>) => void,
): void {
  forwardFn = singleFn;
  batchForwardFn = batchFn;
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
      if (forwardToBackend && (method === "warn" || method === "error")) {
        try {
          const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");

          // Filter out noisy HMR failure messages from being persisted to backend
          if (!msg.includes("[hmr]")) {
            bufferLogEntry(LEVEL_MAP[method], "frontend", msg);
          }
        } catch {
          // never throw from logging
        }
      }
    }) as Console[ConsoleMethod];
  }

  consoleWithFlag[PATCH_FLAG] = true;
  /* eslint-enable no-console */
}
