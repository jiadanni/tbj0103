import { describe, expect, it } from "vitest";
import {
  classifyModelFit,
  classifyModelFitWithAvailable,
  estimateModelMemoryBytes,
  formatBytes,
  formatParams,
  inferHardwareModelGuidance,
  parseModelParamsB,
} from "@/lib/modelSizing";

describe("parseModelParamsB", () => {
  it("parses standard billion-scale tags", () => {
    expect(parseModelParamsB("llama3.1:8b-instruct-q4_K_M")).toBe(8);
    expect(parseModelParamsB("qwen2.5-coder:14b")).toBe(14);
    expect(parseModelParamsB("phi:3.8b")).toBe(3.8);
  });

  it("parses mixture-of-experts names conservatively as total experts times expert size", () => {
    expect(parseModelParamsB("mixtral:8x7b")).toBe(56);
  });

  it("returns null when no obvious size token exists", () => {
    expect(parseModelParamsB("granite")).toBeNull();
  });

  it("returns null for versioned model names where the number is not a size", () => {
    expect(parseModelParamsB("gemma4:latest")).toBeNull();
    expect(parseModelParamsB("gemma4")).toBeNull();
    expect(parseModelParamsB("Gemma 4")).toBeNull();
  });

  it("parses parameter_size strings from Ollama model details", () => {
    expect(parseModelParamsB("4.3B")).toBe(4.3);
    expect(parseModelParamsB("9B")).toBe(9);
    expect(parseModelParamsB("27B")).toBe(27);
  });
});

describe("inferHardwareModelGuidance", () => {
  it("keeps low-memory systems in the compact tier", () => {
    const guidance = inferHardwareModelGuidance({
      os_name: "Linux",
      cpu_arch: "x86_64",
      total_memory_bytes: 6 * 1024 ** 3,
      physical_cores: 4,
    });
    expect(guidance.recommendedMaxParamsB).toBe(3);
  });

  it("treats Apple Silicon unified memory more generously", () => {
    const guidance = inferHardwareModelGuidance({
      os_name: "macOS",
      cpu_arch: "aarch64",
      total_memory_bytes: 16 * 1024 ** 3,
      physical_cores: 8,
    });
    expect(guidance.recommendedMaxParamsB).toBe(14);
  });

  it("keeps non-mac 16GB systems in a conservative tier", () => {
    const guidance = inferHardwareModelGuidance({
      os_name: "Linux",
      cpu_arch: "x86_64",
      total_memory_bytes: 16 * 1024 ** 3,
      physical_cores: 8,
    });
    expect(guidance.recommendedMaxParamsB).toBe(8);
  });

  it("prefers detected GPU memory on non-mac systems", () => {
    const guidance = inferHardwareModelGuidance({
      os_name: "Linux",
      cpu_arch: "x86_64",
      total_memory_bytes: 16 * 1024 ** 3,
      physical_cores: 8,
      gpu_name: "NVIDIA RTX 4090",
      gpu_memory_bytes: 24 * 1024 ** 3,
      gpu_detection_source: "nvidia-smi",
    });
    expect(guidance.recommendedMaxParamsB).toBe(32);
    expect(guidance.basis).toContain("nvidia-smi");
    expect(guidance.basis).toContain("24 GB VRAM");
  });

  it("caps large-memory but low-core systems to a smaller tier", () => {
    const guidance = inferHardwareModelGuidance({
      os_name: "Linux",
      cpu_arch: "x86_64",
      total_memory_bytes: 64 * 1024 ** 3,
      physical_cores: 4,
    });
    expect(guidance.recommendedMaxParamsB).toBe(8);
  });
});

describe("classifyModelFit", () => {
  it("marks models inside the recommendation as a good fit", () => {
    expect(classifyModelFit(7, 8)).toBe("good");
  });

  it("marks slightly larger models as a stretch", () => {
    expect(classifyModelFit(12, 8)).toBe("stretch");
  });

  it("marks much larger models as too large", () => {
    expect(classifyModelFit(32, 8)).toBe("too-large");
  });
});

describe("classifyModelFitWithAvailable", () => {
  it("returns baseline if baseline is 'unknown' or 'too-large'", () => {
    expect(classifyModelFitWithAvailable(null, 8, 16 * 1024 ** 3)).toBe("unknown");
    expect(classifyModelFitWithAvailable(32, 8, 16 * 1024 ** 3)).toBe("too-large");
  });

  it("returns baseline if available memory is missing or invalid", () => {
    expect(classifyModelFitWithAvailable(7, 8, undefined)).toBe("good");
    expect(classifyModelFitWithAvailable(7, 8, null)).toBe("good");
    expect(classifyModelFitWithAvailable(7, 8, 0)).toBe("good");
    expect(classifyModelFitWithAvailable(7, 8, -1)).toBe("good");
  });

  it("escalates to 'too-large' if footprint exceeds available memory", () => {
    // 8B model -> 8.8 GB footprint. If only 8 GB available, too large.
    expect(classifyModelFitWithAvailable(8, 8, 8 * 1024 ** 3)).toBe("too-large");
  });

  it("escalates 'good' to 'stretch' if footprint exceeds 80% of available memory", () => {
    // 8B model -> 8.8 GB footprint. If 10 GB available, 8.8 > 8 (80%).
    expect(classifyModelFitWithAvailable(8, 8, 10 * 1024 ** 3)).toBe("stretch");
  });

  it("preserves 'good' fit if there is enough headroom", () => {
    // 8B model -> 8.8 GB footprint. If 12 GB available, 8.8 <= 9.6 (80%).
    expect(classifyModelFitWithAvailable(8, 8, 12 * 1024 ** 3)).toBe("good");
  });

  it("preserves 'stretch' baseline if footprint fits within available memory", () => {
    // 10B model, 8B recommended -> baseline "stretch".
    // 11 GB footprint. 16 GB available -> footprint fits.
    expect(classifyModelFitWithAvailable(10, 8, 16 * 1024 ** 3)).toBe("stretch");
  });

  it("escalates 'stretch' baseline to 'too-large' if footprint exceeds available memory", () => {
    // 10B model, 8B recommended -> baseline "stretch".
    // 11 GB footprint. 10 GB available -> exceeds.
    expect(classifyModelFitWithAvailable(10, 8, 10 * 1024 ** 3)).toBe("too-large");
  });
});

describe("estimateModelMemoryBytes", () => {
  it("returns null for invalid inputs", () => {
    expect(estimateModelMemoryBytes(null)).toBeNull();
    expect(estimateModelMemoryBytes(NaN)).toBeNull();
    expect(estimateModelMemoryBytes(0)).toBeNull();
    expect(estimateModelMemoryBytes(-1)).toBeNull();
  });

  it("calculates roughly 1.1 GB per billion parameters", () => {
    const tenB = 10;
    const expected = 10 * 1.1 * 1024 ** 3;
    expect(estimateModelMemoryBytes(tenB)).toBe(expected);
  });
});

describe("formatting helpers", () => {
  it("formats bytes and params into compact display strings", () => {
    expect(formatBytes(8 * 1024 ** 3)).toBe("8 GB");
    expect(formatParams(7)).toBe("7B");
    expect(formatParams(0.35)).toBe("350M");
  });
});
