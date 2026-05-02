import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "../../stores/uiStore";

describe("uiStore", () => {
  beforeEach(() => {
    useUIStore.setState({ titlebarTokenCount: 0 });
  });

  it("initializes with 0 tokens", () => {
    expect(useUIStore.getState().titlebarTokenCount).toBe(0);
  });

  it("updates titlebar token count", () => {
    useUIStore.getState().setTitlebarTokenCount(42);
    expect(useUIStore.getState().titlebarTokenCount).toBe(42);
  });
});
