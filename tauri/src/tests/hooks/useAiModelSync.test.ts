import { describe, expect, it } from "vitest";
import { deriveOllamaRoleTags } from "@/hooks/useAiModelSync";

describe("deriveOllamaRoleTags", () => {
  it("defaults Ollama models to chat", () => {
    expect(deriveOllamaRoleTags({ capabilities: [] })).toEqual(["chat"]);
    expect(deriveOllamaRoleTags({})).toEqual(["chat"]);
  });

  it("persists vision capability when Ollama reports it", () => {
    expect(deriveOllamaRoleTags({ capabilities: ["completion", "vision"] })).toEqual(["chat", "vision"]);
  });
});
