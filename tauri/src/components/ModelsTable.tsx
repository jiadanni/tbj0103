import React from "react";
import { Eye, EyeOff, GripVertical, Info, Pencil, RefreshCw } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { Toggle } from "./Toggle";
import type { AiModel, ModelSpeedStat, OllamaModel } from "../lib/api";
import { classifyModelFit, formatBytes, formatParams, parseModelParamsB } from "../lib/modelSizing";
import { resolveModelDisplayName, resolveModelSecondaryDisplayName } from "../lib/modelDisplayName";
import {
  DEFAULT_CONTEXT_TOKENS,
  formatCapabilityLabel,
  formatModelSpeed,
  getBackgroundIneligibility,
  getModelFitMeta,
  ineligibilityCopy,
  type BackgroundIneligibility,
} from "../lib/modelsTableFormat";

export interface ModelFamilyGroup {
  key: string;
  label: string;
  models: AiModel[];
}

/**
 * Info affordance for a column/field label. Replaces the old 8px `ⓘ` glyph at
 * 60% opacity, which was effectively invisible against --text-muted.
 */
function InfoHint({ content, label }: { content: string; label: string }) {
  return (
    <Tooltip content={content} position="top">
      <button
        type="button"
        aria-label={`About ${label}`}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--border-color)] text-[var(--text-muted)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-color)]"
      >
        <Info size={10} strokeWidth={2.5} />
      </button>
    </Tooltip>
  );
}

function ContextSizeInput({ modelName, savedValue, onSave, onClear }: {
  modelName: string;
  savedValue: number | null;
  onSave: (value: number | null) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [draft, setDraft] = React.useState<string>(savedValue !== null ? String(savedValue) : "");

  React.useEffect(() => {
    setDraft(savedValue !== null ? String(savedValue) : "");
  }, [savedValue]);

  async function commit() {
    const raw = draft.trim();
    const parsed = raw === "" ? null : Number.parseInt(raw, 10);
    const next = parsed === null ? null : Number.isFinite(parsed) && parsed > 0 ? Math.max(512, parsed) : null;
    if ((savedValue ?? null) !== next) {
      await onSave(next);
    }
    setDraft(next !== null ? String(next) : "");
  }

  const isOverridden = savedValue !== null;

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={512}
        step={512}
        value={draft}
        placeholder={String(DEFAULT_CONTEXT_TOKENS)}
        className={`w-[74px] rounded border bg-[var(--bg-primary)] px-1.5 py-1 text-center text-[11px] tabular-nums outline-none transition-colors ${
          isOverridden
            ? "border-[var(--accent-color)]/50 text-[var(--accent-color)]"
            : "border-[var(--border-color)] text-[var(--text-secondary)] focus:border-[var(--accent-color)]"
        } [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
        aria-label={`Context window for ${modelName}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
      />
      {isOverridden ? (
        <Tooltip content={`Reset to Ollama's default (${DEFAULT_CONTEXT_TOKENS} tok)`}>
          <button
            type="button"
            onClick={async () => { await onClear(); setDraft(""); }}
            aria-label={`Reset context window for ${modelName} to default`}
            className="shrink-0 text-[var(--text-muted)] transition-colors hover:text-[var(--accent-color)]"
          >
            <RefreshCw size={11} />
          </button>
        </Tooltip>
      ) : (
        <span className="w-[11px] shrink-0" aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * The background-default control. One row in the whole table wears this badge,
 * so it reads as a single assignment rather than as N competing radios.
 */
function BackgroundDefaultControl({
  model,
  isCurrent,
  ineligibility,
  onSelect,
}: {
  model: AiModel;
  isCurrent: boolean;
  ineligibility: BackgroundIneligibility;
  onSelect: () => void;
}) {
  if (isCurrent) {
    return (
      <Tooltip content="This model runs background AI jobs (memory extraction, summarization, flashcards, glossary, topic signatures) whenever no per-job model is set in Inference Jobs.">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-color)] bg-[var(--accent-color)]/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--accent-color)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-color)]" aria-hidden="true" />
          Background
        </span>
      </Tooltip>
    );
  }

  if (ineligibility) {
    const copy = ineligibilityCopy(ineligibility);
    return (
      <Tooltip content={copy.long}>
        <span
          className="inline-flex cursor-help items-center gap-1 rounded-full border border-dashed border-[var(--border-color)] px-2 py-1 text-[10px] text-[var(--text-muted)]"
          aria-label={`${model.name} cannot be the background default: ${copy.short}`}
        >
          {copy.short}
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip content="Make this the background default — it will run background AI jobs that have no per-job model set.">
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Use ${model.name} as the background default model`}
        className="rounded-full border border-[var(--border-color)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-color)]"
      >
        Set as default
      </button>
    </Tooltip>
  );
}

export interface ModelsTableProps {
  groups: ModelFamilyGroup[];
  aiModels: AiModel[];
  ollamaModels: OllamaModel[];
  modelSpeedStats: Record<string, ModelSpeedStat>;
  modelLabels: Record<string, string>;
  backgroundModelId: string | undefined;
  recommendedMaxParamsB: number | null;
  composerMode: string;
  showFamilyHeadings: boolean;

  editingModelId: string | null;
  editingName: string;
  onEditingNameChange: (next: string) => void;
  onStartRename: (model: AiModel) => void;
  onCommitRename: (model: AiModel) => void;
  onCancelRename: () => void;

  draggedModelId: string | null;
  dragOverModelId: string | null;
  draggedFamilyId: string | null;
  dragOverFamilyId: string | null;
  onModelDragStart: (modelId: string) => void;
  onFamilyDragStart: (familyKey: string) => void;

  onSelectBackgroundModel: (modelId: string) => void;
  onToggleEnabled: (model: AiModel) => void;
  onToggleHidden: (model: AiModel) => void;
  onSaveContextSize: (model: AiModel, next: number | null) => Promise<void>;
  onClearContextSize: (model: AiModel) => Promise<void>;
}

export function ModelsTable({
  groups,
  aiModels,
  ollamaModels,
  modelSpeedStats,
  modelLabels,
  backgroundModelId,
  recommendedMaxParamsB,
  composerMode,
  showFamilyHeadings,
  editingModelId,
  editingName,
  onEditingNameChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  draggedModelId,
  dragOverModelId,
  draggedFamilyId,
  dragOverFamilyId,
  onModelDragStart,
  onFamilyDragStart,
  onSelectBackgroundModel,
  onToggleEnabled,
  onToggleHidden,
  onSaveContextSize,
  onClearContextSize,
}: ModelsTableProps) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] overflow-hidden">
      {/* Column legend. Deliberately not a <th> row: the body is card-shaped,
          so this exists to name the right-hand control cluster, not to align. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[var(--border-color)] bg-[var(--bg-hover)]/30 px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
          Model
        </span>
        <div className="flex items-center gap-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            Background
            <InfoHint
              label="Background"
              content="Background default: the model that runs background AI tasks (memory extraction, summarization, flashcards, glossary, topic signatures) when no per-job model is set in Inference Jobs. Exactly one model holds this at a time; per-job overrides take precedence."
            />
          </span>
          <span className="inline-flex items-center gap-1.5">
            Context
            <InfoHint
              label="Context"
              content={`Context window, in tokens: how much conversation the model holds at once. Larger remembers more but uses more VRAM. Blank uses Ollama's default (${DEFAULT_CONTEXT_TOKENS}).`}
            />
          </span>
          <span className="inline-flex items-center gap-1.5">
            Active
            <InfoHint
              label="Active"
              content="Active: enables this model app-wide. Inactive models never run for chat or background tasks, even if selected elsewhere."
            />
          </span>
          <span className="inline-flex items-center gap-1.5">
            In picker
            <InfoHint
              label="In picker"
              content="Controls whether this model appears in the chat model picker. Hide models you want running in the background without cluttering the selector."
            />
          </span>
        </div>
      </div>

      <div className="divide-y divide-[var(--border-color)]">
        {groups.map((group) => (
          <React.Fragment key={group.key}>
            {showFamilyHeadings && (
              <div
                data-family-key={group.key}
                onPointerDown={(e) => {
                  if (composerMode !== "family") {return;}
                  if (e.button !== 0) {return;}
                  e.preventDefault();
                  onFamilyDragStart(group.key);
                }}
                className={`relative select-none border-t border-[var(--border-color)]/40 px-4 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] transition-colors ${
                  draggedFamilyId === group.key ? "opacity-50" : ""
                } ${
                  dragOverFamilyId === group.key && !dragOverModelId
                    ? (draggedFamilyId
                        ? "bg-[var(--accent-color)]/5 before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-[var(--accent-color)] before:z-10"
                        : "bg-[var(--accent-color)]/20")
                    : ""
                } ${composerMode === "family" ? "cursor-grab active:cursor-grabbing" : ""}`}
              >
                {group.label}
              </div>
            )}

            {group.models.map((m) => {
              const ollamaMeta = ollamaModels.find((model) => model.name === m.model_id);
              const speedStat = modelSpeedStats[m.model_id];
              const speedLabels = formatModelSpeed(speedStat);
              const modelParams =
                parseModelParamsB(m.model_id) ??
                parseModelParamsB(m.name) ??
                parseModelParamsB(ollamaMeta?.details?.parameter_size ?? "");
              const formattedParams = formatParams(modelParams);
              const formattedStorage = typeof ollamaMeta?.size === "number" ? formatBytes(ollamaMeta.size) : null;
              const modelFit = recommendedMaxParamsB != null
                ? classifyModelFit(modelParams, recommendedMaxParamsB)
                : "unknown";
              const fitMeta = getModelFitMeta(modelFit);
              const isOllamaModel = m.provider === "ollama";
              const isWebModel = m.provider.startsWith("web_");
              const isTransient = m.id.startsWith("transient-");
              const ineligibility = getBackgroundIneligibility(m, modelParams);
              const isBackgroundModel = backgroundModelId === m.model_id;
              const capabilityBadges = (isOllamaModel ? ollamaMeta?.capabilities ?? [] : [])
                .filter((c) => c.toLowerCase() !== "completion");
              const displayName = resolveModelDisplayName(m.model_id, modelLabels, aiModels);
              const secondaryDisplayName = resolveModelSecondaryDisplayName(m.model_id, m.provider);
              const hasRunData = m.tokens_used_total > 0;

              const isDragOver = dragOverModelId === m.id;
              let dropIndicatorClass = "";
              if (isDragOver && draggedModelId) {
                const draggedModel = aiModels.find((x) => x.id === draggedModelId);
                if (draggedModel) {
                  dropIndicatorClass = draggedModel.priority < m.priority
                    ? "before:absolute before:inset-x-0 before:bottom-0 before:h-0.5 before:bg-[var(--accent-color)] before:z-10"
                    : "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-[var(--accent-color)] before:z-10";
                }
              }

              return (
                <div
                  key={m.id}
                  data-model-id={m.id}
                  data-family-key={group.key}
                  data-background-default={isBackgroundModel ? "true" : undefined}
                  className={`relative select-none px-4 py-3 transition-colors ${
                    draggedModelId === m.id || draggedFamilyId === group.key ? "opacity-50" : ""
                  } ${isDragOver ? `bg-[var(--accent-color)]/5 ${dropIndicatorClass}` : "hover:bg-[var(--bg-hover)]/5"} ${
                    isBackgroundModel ? "bg-[var(--accent-color)]/[0.04]" : ""
                  } ${!m.enabled ? "opacity-70" : ""}`}
                >
                  {/* Accent rail marks the background default without stealing a column. */}
                  {isBackgroundModel && (
                    <span
                      className="absolute inset-y-0 left-0 w-[3px] bg-[var(--accent-color)]"
                      aria-hidden="true"
                    />
                  )}

                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
                    {/* Identity block */}
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      <div
                        className={`flex items-center pt-0.5 text-[var(--text-muted)] ${
                          isTransient || editingModelId ? "cursor-default opacity-40" : "cursor-grab hover:text-[var(--text-primary)]"
                        }`}
                        onPointerDown={(e) => {
                          if (editingModelId || isTransient || e.button !== 0) {return;}
                          e.preventDefault();
                          e.stopPropagation();
                          onModelDragStart(m.id);
                        }}
                      >
                        <GripVertical size={14} />
                      </div>

                      <div className="min-w-0 flex-1">
                        {editingModelId === m.id ? (
                          <input
                            autoFocus
                            value={editingName}
                            onChange={(e) => onEditingNameChange(e.target.value)}
                            onBlur={() => onCommitRename(m)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { onCommitRename(m); }
                              if (e.key === "Escape") { onCancelRename(); }
                            }}
                            aria-label={`Rename ${displayName}`}
                            className="w-full rounded border border-[var(--accent-color)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-sm text-[var(--text-primary)] outline-none"
                          />
                        ) : (
                          <div className="group min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                                {displayName}
                              </span>

                              {!m.enabled && (
                                <span className="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-hover)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                                  Off
                                </span>
                              )}
                              {m.is_paid && (
                                <span className="shrink-0 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-300">
                                  Paid
                                </span>
                              )}
                              {!isTransient && (
                                <Tooltip content="Rename model">
                                  <button
                                    type="button"
                                    onClick={() => onStartRename(m)}
                                    className="shrink-0 text-[var(--text-muted)] opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:text-[var(--text-primary)]"
                                    aria-label={`Rename ${displayName}`}
                                  >
                                    <Pencil size={11} />
                                  </button>
                                </Tooltip>
                              )}
                            </div>

                            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                              {!isOllamaModel && (
                                <span className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                                  {group.label}
                                </span>
                              )}
                              <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                                {secondaryDisplayName}
                              </span>
                              {formattedParams && (
                                <span className="tabular-nums text-[var(--text-secondary)]">{formattedParams}</span>
                              )}
                              {formattedStorage && (
                                <>
                                  <span className="text-[var(--text-muted)]">·</span>
                                  <span className="tabular-nums text-[var(--text-secondary)]">{formattedStorage}</span>
                                </>
                              )}
                              {fitMeta.label && (
                                <Tooltip content={fitMeta.title}>
                                  <span
                                    className={`inline-flex shrink-0 cursor-help items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-medium ${fitMeta.chipClassName}`}
                                  >
                                    <span className={`h-1.5 w-1.5 rounded-full ${fitMeta.dotClassName}`} aria-hidden="true" />
                                    {fitMeta.label}
                                  </span>
                                </Tooltip>
                              )}
                              {capabilityBadges.length > 0 && (
                                <Tooltip content={`Capabilities: ${capabilityBadges.map(formatCapabilityLabel).join(", ")}`}>
                                  <span className="inline-flex shrink-0 cursor-help items-center text-[var(--text-muted)] transition-colors hover:text-[var(--accent-color)]">
                                    <Info size={12} />
                                  </span>
                                </Tooltip>
                              )}
                            </div>

                            {/* Throughput. One anchored line, so an unrun model
                                reads as "not measured" rather than as zero. */}
                            {!isWebModel && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--text-muted)]">
                                {speedLabels ? (
                                  <>
                                    <Tooltip content={`Average generation speed across ${speedStat.chat_count} chat${speedStat.chat_count === 1 ? "" : "s"}`}>
                                      <span className="cursor-help tabular-nums text-[var(--text-secondary)]">
                                        {speedLabels.chatAverage}
                                      </span>
                                    </Tooltip>
                                    <Tooltip content="Weighted throughput across all recorded assistant messages">
                                      <span className="cursor-help tabular-nums">
                                        ({speedLabels.weighted} weighted)
                                      </span>
                                    </Tooltip>
                                  </>
                                ) : (
                                  <span className="italic">Speed not measured yet</span>
                                )}
                                <span className="text-[var(--border-color)]">|</span>
                                <Tooltip content={hasRunData
                                  ? `${m.tokens_used_total.toLocaleString()} tokens generated so far`
                                  : "This model has not generated any tokens yet"}>
                                  <span className="cursor-help tabular-nums">
                                    {hasRunData ? `${m.tokens_used_total.toLocaleString()} tok` : "unused"}
                                  </span>
                                </Tooltip>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Control cluster */}
                    <div className="flex shrink-0 items-center gap-4 pl-6 lg:pl-0">
                      <div className="flex min-w-[104px] justify-start lg:justify-center">
                        {isOllamaModel ? (
                          <BackgroundDefaultControl
                            model={m}
                            isCurrent={isBackgroundModel}
                            ineligibility={ineligibility}
                            onSelect={() => onSelectBackgroundModel(m.model_id)}
                          />
                        ) : (
                          <span className="text-[10px] text-[var(--text-muted)]">—</span>
                        )}
                      </div>

                      <div className="flex min-w-[104px] justify-start lg:justify-center">
                        {!isWebModel && !isTransient ? (
                          <ContextSizeInput
                            modelName={m.name}
                            savedValue={m.context_size ?? null}
                            onSave={(next) => onSaveContextSize(m, next)}
                            onClear={() => onClearContextSize(m)}
                          />
                        ) : (
                          <span className="text-[10px] text-[var(--text-muted)]">—</span>
                        )}
                      </div>

                      <div className="flex w-[52px] justify-center">
                        <Tooltip content={m.enabled ? "Active — turn off to stop using this model" : "Inactive — turn on to use this model"}>
                          <span className="inline-flex">
                            <Toggle on={m.enabled} onToggle={() => onToggleEnabled(m)} />
                          </span>
                        </Tooltip>
                      </div>

                      <div className="flex w-[52px] justify-center">
                        <Tooltip content={m.is_hidden ? "Hidden from the chat picker — click to show" : "Shown in the chat picker — click to hide"}>
                          <button
                            type="button"
                            onClick={() => onToggleHidden(m)}
                            aria-label={m.is_hidden ? `Show ${displayName} in chat picker` : `Hide ${displayName} from chat picker`}
                            aria-pressed={!m.is_hidden}
                            className={`rounded p-1 transition-colors ${
                              m.is_hidden
                                ? "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                : "text-[var(--accent-color)] hover:opacity-80"
                            }`}
                          >
                            {m.is_hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default ModelsTable;
