export type ModelFit = "good" | "stretch" | "too-large" | "unknown";

export interface ModelSizingSystemInfo {
  os_name: string;
  cpu_arch: string;
  total_memory_bytes: number;
  physical_cores?: number | null;
  gpu_name?: string | null;
  gpu_memory_bytes?: number | null;
  gpu_detection_source?: string | null;
}

export interface HardwareModelGuidance {
  recommendedMaxParamsB: number;
  headline: string;
  summary: string;
  caution: string;
  basis: string;
}

function trimTrailingZeroes(value: number): string {
  return value % 1 === 0 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {return "0 GB";}
  const gib = bytes / (1024 ** 3);
  if (gib >= 10) {return `${Math.round(gib)} GB`;}
  return `${trimTrailingZeroes(gib)} GB`;
}

export function formatParams(paramsB: number | null): string | null {
  if (paramsB === null || !Number.isFinite(paramsB) || paramsB <= 0) {return null;}
  if (paramsB >= 1) {return `${trimTrailingZeroes(paramsB)}B`;}
  return `${Math.round(paramsB * 1000)}M`;
}

export function parseModelParamsB(input: string): number | null {
  const normalized = input.toLowerCase();
  const moeMatch = normalized.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*b/);
  if (moeMatch) {
    return Number(moeMatch[1]) * Number(moeMatch[2]);
  }

  const billionsMatch = normalized.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*b(?=$|[^a-z0-9])/);
  if (billionsMatch) {
    return Number(billionsMatch[1]);
  }

  const millionsMatch = normalized.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*m(?=$|[^a-z0-9])/);
  if (millionsMatch) {
    return Number(millionsMatch[1]) / 1000;
  }

  return null;
}

function isAppleSiliconMac(system: ModelSizingSystemInfo): boolean {
  return system.os_name.toLowerCase().includes("mac") && ["aarch64", "arm64"].includes(system.cpu_arch.toLowerCase());
}

export function inferHardwareModelGuidance(system: ModelSizingSystemInfo): HardwareModelGuidance {
  const totalMemoryGb = system.total_memory_bytes / (1024 ** 3);
  const gpuMemoryGb = (system.gpu_memory_bytes ?? 0) / (1024 ** 3);
  const physicalCores = system.physical_cores ?? 0;
  const appleSiliconMac = isAppleSiliconMac(system);
  const hasDetectedGpuMemory = Number.isFinite(gpuMemoryGb) && gpuMemoryGb > 0;
  let recommendedMaxParamsB = 3;

  if (appleSiliconMac) {
    if (totalMemoryGb >= 48) {
      recommendedMaxParamsB = 70;
    } else if (totalMemoryGb >= 24) {
      recommendedMaxParamsB = 32;
    } else if (totalMemoryGb >= 16) {
      recommendedMaxParamsB = 14;
    } else if (totalMemoryGb >= 8) {
      recommendedMaxParamsB = 8;
    }
  } else if (hasDetectedGpuMemory) {
    if (gpuMemoryGb >= 48) {
      recommendedMaxParamsB = 70;
    } else if (gpuMemoryGb >= 24) {
      recommendedMaxParamsB = 32;
    } else if (gpuMemoryGb >= 16) {
      recommendedMaxParamsB = 14;
    } else if (gpuMemoryGb >= 10) {
      recommendedMaxParamsB = 8;
    } else if (gpuMemoryGb >= 6) {
      recommendedMaxParamsB = 3;
    }
  } else {
    if (totalMemoryGb >= 48) {
      recommendedMaxParamsB = 32;
    } else if (totalMemoryGb >= 24) {
      recommendedMaxParamsB = 14;
    } else if (totalMemoryGb >= 16) {
      recommendedMaxParamsB = 8;
    } else if (totalMemoryGb >= 8) {
      recommendedMaxParamsB = 3;
    }
  }

  if (!hasDetectedGpuMemory && physicalCores > 0 && physicalCores <= 4) {
    recommendedMaxParamsB = Math.min(recommendedMaxParamsB, 8);
  }

  const gpuBasis = system.gpu_name
    ? `${system.gpu_memory_bytes ? `${formatBytes(system.gpu_memory_bytes)} VRAM` : "Detected GPU memory"}${system.gpu_name ? ` on ${system.gpu_name}` : ""}${system.gpu_detection_source ? ` via ${system.gpu_detection_source}` : ""}.`
    : "Estimated from system RAM and CPU cores.";

  if (recommendedMaxParamsB <= 3) {
    return {
      recommendedMaxParamsB,
      headline: "Recommended range: up to 3B",
      summary: appleSiliconMac
        ? "Compact models are the best match here."
        : "Compact models are the safest default here.",
      caution: appleSiliconMac
        ? "7B+ models may run, but will usually feel heavier."
        : "7B+ models may still run, but performance is less predictable.",
      basis: appleSiliconMac ? "Estimated from unified memory and CPU cores." : gpuBasis,
    };
  }

  if (recommendedMaxParamsB <= 8) {
    return {
      recommendedMaxParamsB,
      headline: "Recommended range: 7B to 8B",
      summary: appleSiliconMac
        ? "A solid range for everyday local use."
        : "A practical default range for most systems.",
      caution: appleSiliconMac
        ? "14B-class models may work, but usually feel heavier."
        : "14B-class models may fit, but can still run slowly.",
      basis: appleSiliconMac ? "Estimated from unified memory and CPU cores." : gpuBasis,
    };
  }

  if (recommendedMaxParamsB <= 14) {
    return {
      recommendedMaxParamsB,
      headline: "Recommended range: 13B to 14B",
      summary: appleSiliconMac
        ? "There is room for stronger local models here."
        : "Larger quantized models look realistic here.",
      caution: appleSiliconMac
        ? "30B+ models may work only with aggressive quantization."
        : "30B+ models are still more situational.",
      basis: appleSiliconMac ? "Estimated from unified memory and CPU cores." : gpuBasis,
    };
  }

  if (recommendedMaxParamsB <= 32) {
    return {
      recommendedMaxParamsB,
      headline: appleSiliconMac
        ? "Recommended range: up to 32B"
        : "Large local models look realistic here",
      summary: appleSiliconMac
        ? "This hardware has strong memory headroom."
        : "There is strong memory headroom here.",
      caution: appleSiliconMac
        ? "Very large models can still be slow."
        : "30B+ models are still runtime-dependent.",
      basis: appleSiliconMac ? "Estimated from unified memory and CPU cores." : gpuBasis,
    };
  }

  return {
    recommendedMaxParamsB,
    headline: "Large local models look realistic here",
    summary: "This system has unusually strong memory headroom for local inference.",
    caution: "Even when they fit, 70B-class models can still be slow.",
    basis: "Estimated from unified memory and CPU cores.",
  };
}

export function classifyModelFit(paramsB: number | null, recommendedMaxParamsB: number): ModelFit {
  if (paramsB === null || !Number.isFinite(paramsB) || paramsB <= 0) {return "unknown";}
  if (paramsB <= recommendedMaxParamsB) {return "good";}
  if (paramsB <= recommendedMaxParamsB * 1.5) {return "stretch";}
  return "too-large";
}

/**
 * Approximate memory footprint of a model in bytes.
 * Assumes ~1.1 GB per billion params for a typical 4-bit quantized GGUF —
 * this is intentionally rough and only used to compare against available RAM.
 */
export function estimateModelMemoryBytes(paramsB: number | null): number | null {
  if (paramsB === null || !Number.isFinite(paramsB) || paramsB <= 0) {return null;}
  return paramsB * 1.1 * (1024 ** 3);
}

/**
 * Refine a fit classification using *currently available* memory rather than
 * total RAM. Catches the multitasking case where a system that nominally
 * supports a model can no longer load it because other apps hold the RAM.
 *
 * Escalation rules:
 * - When estimated footprint exceeds available memory ⇒ "too-large".
 * - When footprint exceeds 80% of available memory and current fit is "good"
 *   ⇒ "stretch". (Leaves some headroom for KV cache and OS.)
 * Otherwise returns the original classification.
 */
export function classifyModelFitWithAvailable(
  paramsB: number | null,
  recommendedMaxParamsB: number,
  availableMemoryBytes: number | null | undefined,
): ModelFit {
  const baseline = classifyModelFit(paramsB, recommendedMaxParamsB);
  if (baseline === "unknown" || baseline === "too-large") {return baseline;}
  if (!availableMemoryBytes || availableMemoryBytes <= 0) {return baseline;}

  const footprint = estimateModelMemoryBytes(paramsB);
  if (footprint === null) {return baseline;}

  if (footprint > availableMemoryBytes) {return "too-large";}
  if (baseline === "good" && footprint > availableMemoryBytes * 0.8) {return "stretch";}
  return baseline;
}
