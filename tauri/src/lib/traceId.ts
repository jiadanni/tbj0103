/**
 * Trace ID / correlation ID utilities for cross-cutting log correlation.
 *
 * Usage:
 *   const traceId = generateTraceId();
 *   // Include in IPC payload metadata and local log calls so both frontend
 *   // and backend entries for the same user action share the same ID.
 *
 *   // Frontend log with trace:
 *   bufferLogEntry("info", "chat", "Sending message", JSON.stringify({ trace_id: traceId }));
 *
 *   // IPC call with trace forwarded to backend:
 *   await api.chat.sendMessage({ ..., metadata: JSON.stringify({ trace_id: traceId }) });
 */

/**
 * Generate a random UUID v4 to use as a trace/correlation ID.
 * Uses `crypto.randomUUID()` when available (all modern browsers & Tauri WebView),
 * falling back to a manual implementation for environments that lack it.
 */
export function generateTraceId(): string {
  if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  // Fallback: manual v4 UUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Build a metadata JSON string containing a `trace_id` key plus any extra fields.
 * Convenient for passing to `bufferLogEntry` or IPC metadata params.
 */
export function traceMetadata(traceId: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({ trace_id: traceId, ...extra });
}
