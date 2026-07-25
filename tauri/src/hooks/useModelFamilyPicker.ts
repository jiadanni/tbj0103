import { useMemo, useState } from "react";
import type { AiModel } from "../lib/api";
import type { ComposerMode } from "../stores/settingsStore";

export interface ModelFamilyGroup {
  prefix: string;
  label: string;
  models: AiModel[];
}

export interface UseModelFamilyPickerArgs {
  enabledModels: AiModel[];
  modelFamilyLabels: Record<string, string>;
  selectedModel: string | null;
  composerMode: ComposerMode;
  isStreaming: boolean;
}

export interface UseModelFamilyPickerResult {
  modelFamilies: ModelFamilyGroup[];
  selectedFamily: string | null;
  setSelectedFamily: React.Dispatch<React.SetStateAction<string | null>>;
  activeFamilyModels: AiModel[];
  activeFamilyDefaultModelId: string | null;
  setShowFamilyVariant: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useModelFamilyPicker({
  enabledModels,
  modelFamilyLabels,
  selectedModel,
  composerMode,
  isStreaming,
}: UseModelFamilyPickerArgs): UseModelFamilyPickerResult {
  // Family mode: group enabled models by ID prefix
  const modelFamilies = useMemo(() => {
    const map = new Map<string, AiModel[]>();
    enabledModels.forEach((m) => {
      const prefix = m.model_id.includes(":") ? m.model_id.split(":")[0] : m.model_id;
      const existing = map.get(prefix);
      if (existing) { existing.push(m); } else { map.set(prefix, [m]); }
    });
    return [...map.entries()].map(([prefix, models]) => ({
      prefix,
      label: modelFamilyLabels[prefix] ?? prefix,
      models: [...models].sort((a, b) => a.priority - b.priority),
    }));
  }, [enabledModels, modelFamilyLabels]);

  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);
  const [, setShowFamilyVariant] = useState(false);

  // Revert the family picker label back to family-level once generation ends.
  // Adjust state during render (React's recommended pattern for deriving state
  // from a prop transition) instead of an effect, to avoid an extra commit+effect
  // render pass.
  const [prevIsStreaming, setPrevIsStreaming] = useState(isStreaming);
  if (isStreaming !== prevIsStreaming) {
    setPrevIsStreaming(isStreaming);
    if (prevIsStreaming && !isStreaming && composerMode === "family") {
      setShowFamilyVariant(false);
    }
  }

  // Sync selectedFamily from selectedModel when entering family mode.
  // Also adjusted during render rather than in an effect.
  if (composerMode === "family" && selectedFamily === null) {
    const prefix = selectedModel
      ? (selectedModel.includes(":") ? selectedModel.split(":")[0] : selectedModel)
      : null;
    const nextFamily = prefix ?? (modelFamilies[0]?.prefix ?? null);
    if (nextFamily !== selectedFamily) {
      setSelectedFamily(nextFamily);
    }
  }

  const activeFamilyModels = useMemo(
    () => modelFamilies.find((f) => f.prefix === selectedFamily)?.models ?? [],
    [modelFamilies, selectedFamily]
  );
  const activeFamilyDefaultModelId = activeFamilyModels[0]?.model_id ?? null;

  return {
    modelFamilies,
    selectedFamily,
    setSelectedFamily,
    activeFamilyModels,
    activeFamilyDefaultModelId,
    setShowFamilyVariant,
  };
}
