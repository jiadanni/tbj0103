import type { AiModel } from "./api";

export interface ModelPickerOption {
  value: string;
  label: string;
}

export interface ModelPickerGroup {
  label: string;
  options: ModelPickerOption[];
}

/**
 * Groups models by family labels for use in CompactMenuSelect or custom pickers.
 */
export function groupModelsByFamily(
  models: (AiModel | string)[],
  modelFamilyLabels: Record<string, string>,
  customModelFamilies: string[],
  modelLabels: Record<string, string> = {},
  resolveDisplayName?: (id: string) => string,
  usePrefixAsFallback: boolean = true
): { options: ModelPickerOption[]; groups: ModelPickerGroup[] } {
  const groups: Record<string, ModelPickerOption[]> = {};
  const ungrouped: ModelPickerOption[] = [];

  // Initialize custom families to ensure they exist in our map
  customModelFamilies.forEach((family) => {
    groups[family] = [];
  });

  models.forEach((m) => {
    const modelId = typeof m === "string" ? m : m.model_id;
    const label = resolveDisplayName 
      ? resolveDisplayName(modelId) 
      : (typeof m === "string" ? modelLabels[modelId] || modelId : m.name || modelId);
    
    const opt: ModelPickerOption = { value: modelId, label };
    
    const rawPrefix = modelId.includes(":") ? modelId.split(":")[0] : modelId;
    const family = modelFamilyLabels[rawPrefix] 
      || (customModelFamilies.includes(rawPrefix) ? rawPrefix : (usePrefixAsFallback ? rawPrefix : null));

    if (family) {
      if (!groups[family]) {
        groups[family] = [];
      }
      groups[family].push(opt);
    } else {
      ungrouped.push(opt);
    }
  });

  const resultGroups: ModelPickerGroup[] = Object.entries(groups)
    .filter(([_, opts]) => opts.length > 0)
    .map(([familyLabel, opts]) => ({
      label: familyLabel,
      options: opts,
    }));

  return {
    options: ungrouped,
    groups: resultGroups,
  };
}
