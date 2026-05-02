import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { api } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    system: {
      getSpecs: vi.fn(),
    },
  },
}));

describe("useSystemSpecs", () => {
  const mockSpecs = {
    os_name: "linux",
    os_version: "1.0",
    cpu_brand: "AMD Ryzen",
    cpu_arch: "x86_64",
    logical_cores: 16,
    total_memory_bytes: 16000000000,
    available_memory_bytes: 8000000000,
    total_swap_bytes: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("fetches and caches system specs", async () => {
    vi.mocked(api.system.getSpecs).mockResolvedValue(mockSpecs);
    
    const { fetchSystemSpecs, getCachedSystemSpecs } = await import("../../hooks/useSystemSpecs");
    
    expect(getCachedSystemSpecs()).toBeNull();
    
    const promise1 = fetchSystemSpecs();
    const promise2 = fetchSystemSpecs();
    
    const specs1 = await promise1;
    const specs2 = await promise2;
    
    expect(api.system.getSpecs).toHaveBeenCalledTimes(1);
    expect(specs1).toEqual(mockSpecs);
    expect(specs2).toEqual(mockSpecs);
    expect(getCachedSystemSpecs()).toEqual(mockSpecs);
  });

  it("hook returns specs", async () => {
    vi.mocked(api.system.getSpecs).mockResolvedValue(mockSpecs);
    const { useSystemSpecs } = await import("../../hooks/useSystemSpecs");
    
    const { result } = renderHook(() => useSystemSpecs());
    
    expect(result.current).toBeNull();
    
    await waitFor(() => {
      expect(result.current).toEqual(mockSpecs);
    });
  });
});
