import { useEffect, useRef } from "react";
import { api, type AiModel, type OllamaModel } from "../lib/api";
import { useSettingsStore } from "../stores/settingsStore";

/**
 * Hook to automatically synchronize Ollama models discovered from the Ollama runtime
 * into the managed AI models database table.
 * 
 * It ensures that any model pulled in Ollama but not yet existing in the app's 
 * priority list is added and enabled by default.
 */
export function useAiModelSync(
  aiModels: AiModel[],
  ollamaModels: OllamaModel[],
  isLoadingollama: boolean,
  onModelsSynced: () => void
) {
  const syncingRef = useRef(false);
  const modelLabels = useSettingsStore((s) => s.modelLabels);
  const incrementModelRefreshCounter = useSettingsStore((s) => s.incrementModelRefreshCounter);

  useEffect(() => {
    // Only sync if we have both lists and aren't already syncing
    if (isLoadingollama || syncingRef.current || ollamaModels.length === 0) {
      return;
    }

    const managedOllamaIds = new Set(
      aiModels
        .filter((model) => model.provider === "ollama")
        .map((model) => model.model_id)
    );

    const nonEmbeddingOllamaModels = ollamaModels.filter(
      (model) => !model.name.toLowerCase().includes("embed")
    );

    const missingModels = nonEmbeddingOllamaModels.filter(
      (model) => !managedOllamaIds.has(model.name)
    );

    if (missingModels.length === 0) {
      return;
    }

    const existingOllamaPriorities = aiModels
      .filter((model) => model.provider === "ollama")
      .map((model) => model.priority);
    
    const startPriority = existingOllamaPriorities.length > 0
      ? Math.max(...existingOllamaPriorities) + 1
      : 0;

    syncingRef.current = true;
    
    Promise.allSettled(
      missingModels.map((model, index) => {
        const customLabel = modelLabels[model.name]?.trim();
        const defaultName = customLabel || model.name;
        
        return api.aiModel.add(defaultName, model.name, {
          provider: "ollama",
          enabled: true,
          priority: startPriority + index,
        });
      })
    )
      .then((results) => {
        if (results.some((result) => result.status === "fulfilled")) {
          onModelsSynced();
          incrementModelRefreshCounter();
        }
      })
      .finally(() => {
        syncingRef.current = false;
      });
  }, [
    aiModels,
    ollamaModels,
    isLoadingollama,
    modelLabels,
    incrementModelRefreshCounter,
    onModelsSynced
  ]);
}
