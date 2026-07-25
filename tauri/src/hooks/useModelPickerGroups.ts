import { useMemo } from "react";
import type { AiModel } from "../lib/api";
import { groupModelsByFamily } from "../lib/modelFamilyGrouping";

export interface ModelPickerGroupOption {
  key: string;
  label: string;
  modelIds: string[];
}

export interface UseModelPickerGroupsArgs {
  availableModels: string[];
  aiModelList: AiModel[];
  modelFamilyLabels: Record<string, string>;
  customModelFamilies: string[];
  modelLabels: Record<string, string>;
  selectedModel: string;
}

export interface UseModelPickerGroupsResult {
  aiModelById: Map<string, AiModel>;
  modelPickerOptions: string[];
  enabledWebModels: AiModel[];
  groupedModelPickerOptions: ModelPickerGroupOption[];
  alternateSendModels: string[];
  groupedAlternateSendModels: ModelPickerGroupOption[];
}

/**
 * Derives the model-picker/send-menu grouping data shown in ChatView's
 * composer (family-grouped picker options, web-search models, and the
 * "send with a different model" alternates list). Pure derivation over
 * settings-store + AI-model-list state — no side effects, no refs.
 */
export function useModelPickerGroups({
  availableModels,
  aiModelList,
  modelFamilyLabels,
  customModelFamilies,
  modelLabels,
  selectedModel,
}: UseModelPickerGroupsArgs): UseModelPickerGroupsResult {
  const aiModelById = useMemo(
    () => new Map(aiModelList.map((model) => [model.model_id, model] as const)),
    [aiModelList],
  );

  const modelPickerOptions = useMemo(
    () => availableModels.filter((modelId) => {
      const meta = aiModelById.get(modelId);
      return !meta?.provider.startsWith("web_");
    }),
    [availableModels, aiModelById],
  );

  const enabledWebModels = useMemo(
    () => aiModelList.filter((m) => m.provider.startsWith("web_") && m.enabled && !m.is_hidden),
    [aiModelList],
  );

  const groupedModelPickerOptions = useMemo(() => {
    const { groups } = groupModelsByFamily(
      modelPickerOptions,
      modelFamilyLabels,
      customModelFamilies,
      modelLabels,
      undefined, // we'll use resolveModelDisplayName in the render loop or similar if needed, but here we just need keys
      true,
    );

    return groups.map((g, idx) => ({
      key: `family-${idx}-${g.label}`,
      label: g.label,
      modelIds: g.options.map((opt) => opt.value),
    }));
  }, [modelPickerOptions, modelFamilyLabels, customModelFamilies, modelLabels]);

  const alternateSendModels = useMemo(
    () => availableModels.filter((id) => id !== selectedModel),
    [availableModels, selectedModel],
  );

  const groupedAlternateSendModels = useMemo(
    () => groupedModelPickerOptions
      .map((g) => ({ ...g, modelIds: g.modelIds.filter((id) => alternateSendModels.includes(id)) }))
      .filter((g) => g.modelIds.length > 0),
    [groupedModelPickerOptions, alternateSendModels],
  );

  return {
    aiModelById,
    modelPickerOptions,
    enabledWebModels,
    groupedModelPickerOptions,
    alternateSendModels,
    groupedAlternateSendModels,
  };
}
