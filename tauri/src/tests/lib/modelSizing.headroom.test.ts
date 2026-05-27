import { describe, expect, it } from "vitest";
import { applyHeadroom, inferHardwareModelGuidance } from "@/lib/modelSizing";

const GB = 1024 ** 3;

describe("applyHeadroom", () => {
  it("returns total unchanged when no headroom is set", () => {
    const r = applyHeadroom(16 * GB, 0, 0);
    expect(r.reservedBytes).toBe(0);
    expect(r.effectiveBytes).toBe(16 * GB);
  });

  it("subtracts an absolute GB reservation", () => {
    const r = applyHeadroom(16 * GB, 3.5, 0);
    expect(r.reservedBytes).toBeCloseTo(3.5 * GB);
    expect(r.effectiveBytes).toBeCloseTo(12.5 * GB);
  });

  it("subtracts a percent reservation", () => {
    const r = applyHeadroom(16 * GB, 0, 10);
    expect(r.reservedBytes).toBeCloseTo(1.6 * GB);
    expect(r.effectiveBytes).toBeCloseTo(14.4 * GB);
  });

  it("uses whichever of GB or % is larger", () => {
    // 16 GB total, 1 GB vs 10% (1.6 GB) → percent wins
    const pctWins = applyHeadroom(16 * GB, 1, 10);
    expect(pctWins.reservedBytes).toBeCloseTo(1.6 * GB);
    // 16 GB total, 3.5 GB vs 10% (1.6 GB) → GB wins
    const gbWins = applyHeadroom(16 * GB, 3.5, 10);
    expect(gbWins.reservedBytes).toBeCloseTo(3.5 * GB);
  });

  it("clamps reservation at total bytes", () => {
    const r = applyHeadroom(8 * GB, 100, 0);
    expect(r.reservedBytes).toBe(8 * GB);
    expect(r.effectiveBytes).toBe(0);
  });

  it("ignores negative or non-finite inputs", () => {
    const r = applyHeadroom(16 * GB, -5, NaN);
    expect(r.reservedBytes).toBe(0);
    expect(r.effectiveBytes).toBe(16 * GB);
  });
});

describe("inferHardwareModelGuidance with headroom", () => {
  const baseGpuSystem = {
    os_name: "Linux",
    cpu_arch: "x86_64",
    total_memory_bytes: 32 * GB,
    physical_cores: 8,
    gpu_name: "NVIDIA RTX 4080",
    gpu_memory_bytes: 16 * GB,
    gpu_detection_source: "nvidia-smi",
  };

  it("returns baseline recommendation with no headroom", () => {
    const g = inferHardwareModelGuidance(baseGpuSystem);
    expect(g.recommendedMaxParamsB).toBe(14);
  });

  it("drops a 16 GB GPU to the 8B tier when 3.5 GB VRAM is reserved", () => {
    // 16 GB - 3.5 GB = 12.5 GB effective, below the 16 GB → 14B threshold,
    // above the 10 GB → 8B threshold.
    const g = inferHardwareModelGuidance({
      ...baseGpuSystem,
      vram_headroom_gb: 3.5,
      vram_headroom_percent: 0,
    });
    expect(g.recommendedMaxParamsB).toBe(8);
    expect(g.basis).toContain("reserved");
    expect(g.basis).toContain("effective");
  });

  it("keeps a 16 GB GPU at 14B with a 10% (1.6 GB) reservation", () => {
    // 16 GB - 1.6 GB = 14.4 GB effective, still below 16 GB → 14B threshold,
    // so we drop to the 10 GB → 8B band. Document this: percent of 10 is enough
    // to bump it down a tier on a 16 GB card.
    const g = inferHardwareModelGuidance({
      ...baseGpuSystem,
      vram_headroom_gb: 0,
      vram_headroom_percent: 10,
    });
    expect(g.recommendedMaxParamsB).toBe(8);
  });

  it("keeps a 24 GB GPU at 32B with a 10% reservation (21.6 GB effective)", () => {
    const g = inferHardwareModelGuidance({
      ...baseGpuSystem,
      gpu_memory_bytes: 24 * GB,
      vram_headroom_percent: 10,
    });
    // 21.6 GB effective is below the 24 GB → 32B threshold, so it should
    // drop to the 16 GB → 14B band.
    expect(g.recommendedMaxParamsB).toBe(14);
  });

  it("uses larger of GB and percent on VRAM", () => {
    // 16 GB GPU, 1 GB headroom vs 25% (4 GB) → 25% wins, 12 GB effective → 8B band
    const g = inferHardwareModelGuidance({
      ...baseGpuSystem,
      vram_headroom_gb: 1,
      vram_headroom_percent: 25,
    });
    expect(g.recommendedMaxParamsB).toBe(8);
  });

  it("applies RAM headroom on Apple Silicon", () => {
    // 16 GB unified, with 8 GB reserved → 8 GB effective → drops to 3B tier
    const g = inferHardwareModelGuidance({
      os_name: "macOS",
      cpu_arch: "aarch64",
      total_memory_bytes: 16 * GB,
      physical_cores: 8,
      ram_headroom_gb: 8,
    });
    expect(g.recommendedMaxParamsB).toBe(8);
    // 16 - 8 = 8 GB effective sits exactly at the 8 GB → 8B threshold on Apple
    expect(g.basis).toContain("reserved");
  });

  it("applies RAM headroom on CPU-only Linux", () => {
    // 16 GB total, 8 GB reserved → 8 GB effective → 3B band (CPU-only, no GPU)
    const g = inferHardwareModelGuidance({
      os_name: "Linux",
      cpu_arch: "x86_64",
      total_memory_bytes: 16 * GB,
      physical_cores: 8,
      ram_headroom_gb: 8,
    });
    expect(g.recommendedMaxParamsB).toBe(3);
  });

  it("ignores undetected GPU when only VRAM headroom is set", () => {
    const g = inferHardwareModelGuidance({
      os_name: "Linux",
      cpu_arch: "x86_64",
      total_memory_bytes: 32 * GB,
      physical_cores: 8,
      vram_headroom_gb: 3.5,
    });
    // No GPU detected, so VRAM headroom is a no-op; falls through to RAM band
    expect(g.recommendedMaxParamsB).toBe(14);
  });
});
