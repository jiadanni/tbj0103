import { useEffect, useRef } from "react";
import { api, type AiModel, type OllamaModel } from "../lib/api";
import { useSettingsStore } from "../stores/settingsStore";

export function deriveOllamaRoleTags(model: Pick<OllamaModel, "capabilities">): string[] {
  return model.capabilities?.includes("vision") ? ["chat", "vision"] : ["chat"];
}

function roleTagsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((tag, index) => tag === b[index]);
}

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
  const onModelsSyncedRef = useRef(onModelsSynced);
  useEffect(() => {
    onModelsSyncedRef.current = onModelsSynced;
  }, [onModelsSynced]);

  const modelLabels = useSettingsStore((s) => s.modelLabels);
  const incrementModelRefreshCounter = useSettingsStore((s) => s.incrementModelRefreshCounter);

  useEffect(() => {
    // Only sync if we have both lists and aren't already syncing
    if (isLoadingollama || syncingRef.current || ollamaModels.length === 0) {
      return;
    }
    let cancelled = false;

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
    const staleRoleTagModels = aiModels
      .filter((model) => model.provider === "ollama")
      .flatMap((model) => {
        const runtimeModel = nonEmbeddingOllamaModels.find((candidate) => candidate.name === model.model_id);
        if (!runtimeModel) {
          return [];
        }

        const derivedRoleTags = deriveOllamaRoleTags(runtimeModel);
        if (roleTagsMatch(model.role_tags, derivedRoleTags)) {
          return [];
        }

        return [{ id: model.id, role_tags: derivedRoleTags }];
      });

    if (missingModels.length === 0 && staleRoleTagModels.length === 0) {
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
      [
        ...missingModels.map((model, index) => {
          const customLabel = modelLabels[model.name]?.trim();
          const defaultName = customLabel || model.name;

          return api.aiModel.add(defaultName, model.name, {
            provider: "ollama",
            enabled: true,
            priority: startPriority + index,
            role_tags: deriveOllamaRoleTags(model),
          });
        }),
        ...staleRoleTagModels.map((model) => (
          api.aiModel.update(model.id, { role_tags: model.role_tags })
        )),
      ]
    )
      .then((results) => {
        if (cancelled) { return; }
        if (results.some((result) => result.status === "fulfilled")) {
          onModelsSyncedRef.current();
          incrementModelRefreshCounter();
        }
      })
      .finally(() => {
        syncingRef.current = false;
      });

    return () => { cancelled = true; };
  }, [
    aiModels,
    ollamaModels,
    isLoadingollama,
    modelLabels,
    incrementModelRefreshCounter,
  ]);
}
