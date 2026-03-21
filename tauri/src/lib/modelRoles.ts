import type { AiModel } from "./api";

export const MODEL_ROLE_OPTIONS = ["chat", "background", "reasoning", "vision"] as const;

export type ModelRole = (typeof MODEL_ROLE_OPTIONS)[number];

export function resolveModelForRole(
  models: AiModel[],
  role: ModelRole,
  explicitModel?: string | null,
  fallbackModel?: string | null
) {
  if (explicitModel) {
    return explicitModel;
  }

  const tagged = models
    .filter((model) => model.enabled && model.role_tags.includes(role))
    .sort((a, b) => a.priority - b.priority)[0];

  return tagged?.model_id || fallbackModel || "";
}
