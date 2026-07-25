import type { AiModel, ModelSpeedStat } from "./api";
import type { ModelFit } from "./modelSizing";
import { STRUCTURED_OUTPUT_MIN_PARAMS_B } from "./inferenceJobsCatalog";

export const DEFAULT_CONTEXT_TOKENS = 8192;

/**
 * Why a model cannot be the background default. `null` means it can.
 * Kept as a discriminated reason (rather than a bare boolean) so the row can
 * render the cause inline instead of hiding it in a hover tooltip.
 */
export type BackgroundIneligibility = "disabled" | "too-small" | "not-local" | null;

export function getBackgroundIneligibility(
  model: Pick<AiModel, "provider" | "enabled">,
  modelParams: number | null,
): BackgroundIneligibility {
  if (model.provider !== "ollama") {return "not-local";}
  if (!model.enabled) {return "disabled";}
  if (modelParams != null && modelParams < STRUCTURED_OUTPUT_MIN_PARAMS_B) {return "too-small";}
  return null;
}

export function ineligibilityCopy(
  reason: Exclude<BackgroundIneligibility, null>,
): { short: string; long: string } {
  if (reason === "disabled") {
    return {
      short: "Turn on Active first",
      long: "This model is inactive. Background jobs only run on active models — switch Active on to make it eligible.",
    };
  }
  if (reason === "too-small") {
    return {
      short: `Needs ${STRUCTURED_OUTPUT_MIN_PARAMS_B}B+`,
      long: `Too small for background work. Structured jobs (flashcards, glossary, starter prompts, memory extraction) need roughly ${STRUCTURED_OUTPUT_MIN_PARAMS_B}B+ to emit valid JSON reliably.`,
    };
  }
  return {
    short: "Local models only",
    long: "Background jobs run on local Ollama models only, so remote providers cannot be the background default.",
  };
}

export function formatModelSpeed(
  stat: ModelSpeedStat | undefined,
): { chatAverage: string; weighted: string } | null {
  if (
    !stat ||
    !Number.isFinite(stat.avg_chat_tokens_per_second) ||
    stat.avg_chat_tokens_per_second <= 0 ||
    !Number.isFinite(stat.weighted_tokens_per_second) ||
    stat.weighted_tokens_per_second <= 0
  ) {
    return null;
  }

  return {
    chatAverage: `${stat.avg_chat_tokens_per_second.toFixed(1)} tok/s`,
    weighted: `${stat.weighted_tokens_per_second.toFixed(1)} tok/s`,
  };
}

export function formatCapabilityLabel(capability: string): string {
  return capability
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getModelFitMeta(modelFit: ModelFit): {
  dotClassName: string;
  chipClassName: string;
  title: string;
  label: string | null;
} {
  if (modelFit === "good") {
    return {
      dotClassName: "bg-emerald-400",
      chipClassName: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
      title: "Runs comfortably on this system",
      label: "Fits",
    };
  }

  if (modelFit === "stretch") {
    return {
      dotClassName: "bg-amber-400",
      chipClassName: "border-amber-400/30 bg-amber-400/10 text-amber-300",
      title: "Usable, but near the upper range for this system",
      label: "Tight",
    };
  }

  if (modelFit === "too-large") {
    return {
      dotClassName: "bg-red-400",
      chipClassName: "border-red-400/30 bg-red-400/10 text-red-300",
      title: "Likely to strain this system",
      label: "Heavy",
    };
  }

  return {
    dotClassName: "bg-[var(--text-muted)]",
    chipClassName: "border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-muted)]",
    title: "Fit guidance unavailable — system specs unknown",
    label: null,
  };
}
