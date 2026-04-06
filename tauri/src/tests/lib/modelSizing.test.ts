import { describe, expect, it } from "vitest";
import {
  classifyModelFit,
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

describe("formatting helpers", () => {
  it("formats bytes and params into compact display strings", () => {
    expect(formatBytes(8 * 1024 ** 3)).toBe("8 GB");
    expect(formatParams(7)).toBe("7B");
    expect(formatParams(0.35)).toBe("350M");
  });
});
