export type ModelFit = "good" | "stretch" | "too-large" | "unknown";

export interface ModelSizingSystemInfo {
  os_name: string;
  cpu_arch: string;
  total_memory_bytes: number;
  physical_cores?: number | null;
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
  const physicalCores = system.physical_cores ?? 0;
  const appleSiliconMac = isAppleSiliconMac(system);
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

  if (physicalCores > 0 && physicalCores <= 4) {
    recommendedMaxParamsB = Math.min(recommendedMaxParamsB, 8);
  }

  if (recommendedMaxParamsB <= 3) {
    return {
      recommendedMaxParamsB,
      headline: "Best with 3B-class local models",
      summary: appleSiliconMac
        ? "This machine is better suited to compact models for responsive local chat and background tasks."
        : "Without unified memory or confirmed VRAM headroom, compact local models are the safest recommendation.",
      caution: appleSiliconMac
        ? "7B+ models may run, but they are more likely to feel slow or memory-constrained."
        : "7B+ models may still run, but this guidance intentionally avoids assuming discrete GPU VRAM is available.",
      basis: appleSiliconMac ? "Estimated from unified memory and CPU cores." : "Estimated conservatively from system RAM and CPU cores, not VRAM.",
    };
  }

  if (recommendedMaxParamsB <= 8) {
    return {
      recommendedMaxParamsB,
      headline: "Comfortable with 7B to 8B local models",
      summary: appleSiliconMac
        ? "This is a solid range for general local chat, categorisation, and lightweight reasoning."
        : "This is a safe default range for CPU-backed or unknown-GPU local inference on most systems.",
      caution: appleSiliconMac
        ? "14B-class models are possible on some systems, but they will usually feel heavier."
        : "14B-class models may fit on paper, but can still be slow without enough usable VRAM.",
      basis: appleSiliconMac ? "Estimated from unified memory and CPU cores." : "Estimated conservatively from system RAM and CPU cores, not VRAM.",
    };
  }

  if (recommendedMaxParamsB <= 14) {
    return {
      recommendedMaxParamsB,
      headline: "Comfortable with 13B to 14B local models",
      summary: appleSiliconMac
        ? "You should have room for stronger local models while keeping everyday responsiveness reasonable."
        : "This machine likely has enough system memory for larger quantized models, but GPU availability still matters.",
      caution: appleSiliconMac
        ? "30B+ models may fit only with aggressive quantization and plenty of free memory."
        : "30B+ models are treated as a stretch unless the runtime has confirmed GPU memory headroom.",
      basis: appleSiliconMac ? "Estimated from unified memory and CPU cores." : "Estimated conservatively from system RAM and CPU cores, not VRAM.",
    };
  }

  if (recommendedMaxParamsB <= 32) {
    return {
      recommendedMaxParamsB,
      headline: appleSiliconMac
        ? "Comfortable up to roughly 32B-class local models"
        : "Large local models may be realistic here",
      summary: appleSiliconMac
        ? "This hardware has enough memory headroom for larger quantized models than most laptops."
        : "There is strong memory headroom here, but this estimate still avoids equating system RAM with usable inference VRAM.",
      caution: appleSiliconMac
        ? "Very large models can still be slow without a strong GPU, so treat 70B as an experiment."
        : "Treat 30B+ models as runtime-dependent until the app can detect GPU memory directly.",
      basis: appleSiliconMac ? "Estimated from unified memory and CPU cores." : "Estimated conservatively from system RAM and CPU cores, not VRAM.",
    };
  }

  return {
    recommendedMaxParamsB,
    headline: "Large local models are realistic here",
    summary: "This system has unusually strong unified-memory headroom for local inference compared with typical desktops and laptops.",
    caution: "Even when they fit, 70B-class models still need significant compute and will not always feel fast.",
    basis: "Estimated from unified memory and CPU cores.",
  };
}

export function classifyModelFit(paramsB: number | null, recommendedMaxParamsB: number): ModelFit {
  if (paramsB === null || !Number.isFinite(paramsB) || paramsB <= 0) {return "unknown";}
  if (paramsB <= recommendedMaxParamsB) {return "good";}
  if (paramsB <= recommendedMaxParamsB * 1.5) {return "stretch";}
  return "too-large";
}
