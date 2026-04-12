import { describe, expect, it } from "vitest";

import { getModelGroupMeta } from "@/lib/modelGroups";

describe("getModelGroupMeta", () => {
  it("treats missing providers as Ollama", () => {
    expect(getModelGroupMeta(undefined)).toEqual({
      key: "ollama",
      label: "Ollama",
      order: 0,
    });
  });

  it("groups browser-backed providers as Web AI", () => {
    expect(getModelGroupMeta("web_chatgpt")).toEqual({
      key: "web-ai",
      label: "Web AI",
      order: 1,
    });
  });

  it("keeps other runtimes in their own groups", () => {
    expect(getModelGroupMeta("mlx").label).toBe("MLX");
    expect(getModelGroupMeta("llamacpp").label).toBe("llama.cpp");
  });
});
