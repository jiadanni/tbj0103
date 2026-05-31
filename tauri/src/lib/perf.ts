/**
 * Dev-only timing helpers. In production builds these are pass-throughs with
 * zero overhead and no telemetry (local-first principle).
 *
 * Logs only when the wrapped call exceeds 16ms (one frame at 60Hz), so the
 * console isn't flooded with sub-frame work.
 */

const SLOW_THRESHOLD_MS = 16;
const perfNow = (): number => globalThis.performance.now();

export function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!import.meta.env.DEV) {return fn();}
  const start = perfNow();
  return fn().finally(() => {
    const ms = perfNow() - start;
    if (ms > SLOW_THRESHOLD_MS) {
      // eslint-disable-next-line no-console
      console.log(`[perf] ${label} ${ms.toFixed(1)}ms`);
    }
  });
}

export function timedSync<T>(label: string, fn: () => T): T {
  if (!import.meta.env.DEV) {return fn();}
  const start = perfNow();
  try {
    return fn();
  } finally {
    const ms = perfNow() - start;
    if (ms > SLOW_THRESHOLD_MS) {
      // eslint-disable-next-line no-console
      console.log(`[perf] ${label} ${ms.toFixed(1)}ms`);
    }
  }
}
