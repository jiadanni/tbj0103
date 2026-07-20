import { describe, expect, it } from "vitest";

// Exercises the real `GET /api/tags` reachability check that
// scripts/ensure-ollama.mjs relies on to decide whether to spawn
// `ollama serve`. Requires a live Ollama instance — run via
// `npm run test:ollama`, not the default `npm run test` suite.
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";

describe("live Ollama reachability", () => {
  it("responds to GET /api/tags with a list of installed models", async () => {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    expect(response.ok).toBe(true);

    const body = await response.json();
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBeGreaterThan(0);
  });
});
