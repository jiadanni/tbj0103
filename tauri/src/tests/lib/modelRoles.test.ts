import { describe, expect, it } from "vitest";
import { resolveModelForRole } from "@/lib/modelRoles";
import type { AiModel } from "@/lib/api";

function makeModel(overrides: Partial<AiModel>): AiModel {
  return {
    id: "m1",
    name: "Model",
    model_id: "model",
    provider: "ollama",
    role_tags: [],
    priority: 0,
    is_paid: false,
    enabled: true,
    is_hidden: false,
    tokens_used_total: 0,
    created_at: "2026-03-22T00:00:00Z",
    ...overrides,
  };
}

describe("resolveModelForRole", () => {
  it("prefers the explicit model override", () => {
    const result = resolveModelForRole([], "background", "manual-model", "fallback-model");
    expect(result).toBe("manual-model");
  });

  it("falls back to the highest-priority tagged model", () => {
    const result = resolveModelForRole([
      makeModel({ id: "a", model_id: "chat-fast", priority: 2, role_tags: ["background"] }),
      makeModel({ id: "b", model_id: "chat-small", priority: 1, role_tags: ["background"] }),
    ], "background", "", "fallback-model");
    expect(result).toBe("chat-small");
  });

  it("uses the fallback model when no tagged model exists", () => {
    const result = resolveModelForRole([
      makeModel({ model_id: "chat-main", role_tags: ["chat"] }),
    ], "background", "", "chat-main");
    expect(result).toBe("chat-main");
  });
});
