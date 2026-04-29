import { useEffect, useState } from "react";
import { api, type SystemSpecs } from "../lib/api";

// Module-level cache so multiple components share a single fetch.
// Specs include `available_memory_bytes`, which is sampled at fetch time —
// a 30 s TTL keeps the value reasonably fresh without hammering the backend.
let cachedSpecs: SystemSpecs | null = null;
let cachedAt = 0;
let inflight: Promise<SystemSpecs> | null = null;
const TTL_MS = 30_000;

export function getCachedSystemSpecs(): SystemSpecs | null {
  return cachedSpecs;
}

export async function fetchSystemSpecs(force = false): Promise<SystemSpecs> {
  const now = Date.now();
  if (!force && cachedSpecs && now - cachedAt < TTL_MS) {
    return cachedSpecs;
  }
  if (inflight) { return inflight; }
  inflight = api.system.getSpecs()
    .then((specs) => {
      cachedSpecs = specs;
      cachedAt = Date.now();
      return specs;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useSystemSpecs(): SystemSpecs | null {
  const [specs, setSpecs] = useState<SystemSpecs | null>(cachedSpecs);

  useEffect(() => {
    let cancelled = false;
    fetchSystemSpecs()
      .then((value) => { if (!cancelled) { setSpecs(value); } })
      .catch(() => { /* keep last value */ });
    return () => { cancelled = true; };
  }, []);

  return specs;
}
