import type { AiModel } from "./api";

type ProviderNeutralWebModelMeta = {
  label: string;
  technicalId: string;
  autoLabels: string[];
};

const PROVIDER_NEUTRAL_WEB_MODELS: Record<string, ProviderNeutralWebModelMeta> = {
  "chatgpt-web": {
    label: "Browser Assistant A",
    technicalId: "browser-assistant-a",
    autoLabels: ["ChatGPT (Web)", "chatgpt-web"],
  },
  "deepseek-web": {
    label: "Browser Assistant B",
    technicalId: "browser-assistant-b",
    autoLabels: ["DeepSeek (Web)", "deepseek-web"],
  },
  "claude-web": {
    label: "Browser Assistant C",
    technicalId: "browser-assistant-c",
    autoLabels: ["Claude (Web)", "claude-web"],
  },
  "gemini-web": {
    label: "Browser Assistant D",
    technicalId: "browser-assistant-d",
    autoLabels: ["Gemini (Web)", "gemini-web"],
  },
};

function getProviderNeutralWebModelMeta(
  modelId: string,
  provider?: string | null,
): ProviderNeutralWebModelMeta | null {
  if (!provider?.startsWith("web_")) {
    return null;
  }

  return PROVIDER_NEUTRAL_WEB_MODELS[modelId] ?? {
    label: "Browser Assistant",
    technicalId: "browser-assistant",
    autoLabels: [modelId],
  };
}

export function resolveModelDisplayName(
  modelId: string,
  modelLabels: Record<string, string>,
  aiModelList: AiModel[],
): string {
  const found = aiModelList.find((model) => model.model_id === modelId);
  const baseModelId = modelId.split(":")[0];
  const providerNeutralWebMeta = getProviderNeutralWebModelMeta(modelId, found?.provider);

  const normalizeStoredLabel = (label: string | undefined) => label?.trim();
  const isAutoTrimmedOllamaLabel = (label: string | undefined) =>
    found?.provider === "ollama" &&
    !!label &&
    label === baseModelId &&
    modelId.includes(":");
  const isProviderNeutralWebAutoLabel = (label: string | undefined) =>
    !!providerNeutralWebMeta &&
    !!label &&
    providerNeutralWebMeta.autoLabels.some(
      (candidate) => candidate.toLowerCase() === label.trim().toLowerCase(),
    );

  const preferredLabel = normalizeStoredLabel(modelLabels[modelId]);
  if (preferredLabel && !isAutoTrimmedOllamaLabel(preferredLabel)) {
    if (isProviderNeutralWebAutoLabel(preferredLabel)) {
      return providerNeutralWebMeta?.label ?? preferredLabel;
    }
    return preferredLabel;
  }

  const storedName = normalizeStoredLabel(found?.name);
  if (storedName && !isAutoTrimmedOllamaLabel(storedName)) {
    if (isProviderNeutralWebAutoLabel(storedName)) {
      return providerNeutralWebMeta?.label ?? storedName;
    }
    return storedName;
  }

  if (providerNeutralWebMeta) {
    return providerNeutralWebMeta.label;
  }

  return modelId;
}

export function resolveModelSecondaryDisplayName(
  modelId: string,
  provider?: string | null,
): string {
  return getProviderNeutralWebModelMeta(modelId, provider)?.technicalId ?? modelId;
}
