import type { AiModel } from "./api";

export function resolveModelDisplayName(
  modelId: string,
  modelLabels: Record<string, string>,
  aiModelList: AiModel[],
): string {
  const found = aiModelList.find((model) => model.model_id === modelId);
  const baseModelId = modelId.split(":")[0];

  const normalizeStoredLabel = (label: string | undefined) => label?.trim();
  const isAutoTrimmedOllamaLabel = (label: string | undefined) =>
    found?.provider === "ollama" &&
    !!label &&
    label === baseModelId &&
    modelId.includes(":");

  const preferredLabel = normalizeStoredLabel(modelLabels[modelId]);
  if (preferredLabel && !isAutoTrimmedOllamaLabel(preferredLabel)) {
    return preferredLabel;
  }

  const storedName = normalizeStoredLabel(found?.name);
  if (storedName && !isAutoTrimmedOllamaLabel(storedName)) {
    return storedName;
  }

  return modelId;
}
