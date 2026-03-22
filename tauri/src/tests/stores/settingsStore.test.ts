import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";

const SETTINGS_INITIAL = {
  preferredModel: "",
  backgroundModel: "",
  quickSearchModels: [],
  ollamaUrl: "http://localhost:11434",
  embeddingModel: "nomic-embed-text",
  theme: "system" as const,
  accentColor: "#007AFF",
  fontSize: 14,
  sidebarWidth: 240,
  settingsNavLayout: "top-tabs" as const,
  dualModelEnabled: false,
  draftModel: "",
  dualModelExecutionMode: "serial" as const,
  compareModelA: "",
  compareModelB: "",
  modelLabels: {},
  skipLinkConfirm: false,
  immediateDelete: false,
  confirmMoveToTrash: true,
};

beforeEach(() => {
  localStorage.clear();
  // Merge mode preserves action functions on the store.
  useSettingsStore.setState(SETTINGS_INITIAL);
});

// ─── defaults ───────────────────────────────────────────────────────────────

describe("default values", () => {
  it("ollamaUrl defaults to localhost:11434", () => {
    expect(useSettingsStore.getState().ollamaUrl).toBe("http://localhost:11434");
  });

  it("fontSize defaults to 14", () => {
    expect(useSettingsStore.getState().fontSize).toBe(14);
  });

  it("sidebarWidth defaults to 240", () => {
    expect(useSettingsStore.getState().sidebarWidth).toBe(240);
  });

  it("settingsNavLayout defaults to top-tabs", () => {
    expect(useSettingsStore.getState().settingsNavLayout).toBe("top-tabs");
  });

  it("theme defaults to 'system'", () => {
    expect(useSettingsStore.getState().theme).toBe("system");
  });

  it("modelLabels defaults to empty object", () => {
    expect(useSettingsStore.getState().modelLabels).toEqual({});
  });

  it("dualModelEnabled defaults to false", () => {
    expect(useSettingsStore.getState().dualModelEnabled).toBe(false);
  });

  it("skipLinkConfirm defaults to false", () => {
    expect(useSettingsStore.getState().skipLinkConfirm).toBe(false);
  });

  it("dualModelExecutionMode defaults to serial", () => {
    expect(useSettingsStore.getState().dualModelExecutionMode).toBe("serial");
  });
});

// ─── setters ─────────────────────────────────────────────────────────────────

describe("setters", () => {
  it("setOllamaUrl updates ollamaUrl only", () => {
    useSettingsStore.getState().setOllamaUrl("http://remote:11434");
    const state = useSettingsStore.getState();
    expect(state.ollamaUrl).toBe("http://remote:11434");
    expect(state.fontSize).toBe(14); // unchanged
  });

  it("setFontSize updates fontSize only", () => {
    useSettingsStore.getState().setFontSize(18);
    expect(useSettingsStore.getState().fontSize).toBe(18);
  });

  it("setBackgroundModel updates backgroundModel", () => {
    useSettingsStore.getState().setBackgroundModel("qwen2.5:1.5b");
    expect(useSettingsStore.getState().backgroundModel).toBe("qwen2.5:1.5b");
  });

  it("setQuickSearchModels updates quickSearchModels", () => {
    useSettingsStore.getState().setQuickSearchModels(["claude-web", "gemini-web"]);
    expect(useSettingsStore.getState().quickSearchModels).toEqual(["claude-web", "gemini-web"]);
  });

  it("setSidebarWidth updates sidebarWidth only", () => {
    useSettingsStore.getState().setSidebarWidth(320);
    expect(useSettingsStore.getState().sidebarWidth).toBe(320);
  });

  it("setSettingsNavLayout updates settingsNavLayout", () => {
    useSettingsStore.getState().setSettingsNavLayout("side-tabs");
    expect(useSettingsStore.getState().settingsNavLayout).toBe("side-tabs");
  });

  it("setTheme updates theme", () => {
    useSettingsStore.getState().setTheme("dark");
    expect(useSettingsStore.getState().theme).toBe("dark");
  });

  it("setAccentColor updates accentColor", () => {
    useSettingsStore.getState().setAccentColor("#f59e0b");
    expect(useSettingsStore.getState().accentColor).toBe("#f59e0b");
  });

  it("setDualModelEnabled flips to true", () => {
    useSettingsStore.getState().setDualModelEnabled(true);
    expect(useSettingsStore.getState().dualModelEnabled).toBe(true);
  });

  it("setSkipLinkConfirm flips to true", () => {
    useSettingsStore.getState().setSkipLinkConfirm(true);
    expect(useSettingsStore.getState().skipLinkConfirm).toBe(true);
  });

  it("setDualModelExecutionMode updates the strategy", () => {
    useSettingsStore.getState().setDualModelExecutionMode("parallel");
    expect(useSettingsStore.getState().dualModelExecutionMode).toBe("parallel");
  });
});

// ─── setModelLabel ───────────────────────────────────────────────────────────

describe("setModelLabel", () => {
  it("merges without overwriting other keys", () => {
    useSettingsStore.getState().setModelLabel("model-a", "Alpha");
    useSettingsStore.getState().setModelLabel("model-b", "Beta");
    const { modelLabels } = useSettingsStore.getState();
    expect(modelLabels["model-a"]).toBe("Alpha");
    expect(modelLabels["model-b"]).toBe("Beta");
  });

  it("accumulates labels across multiple calls", () => {
    useSettingsStore.getState().setModelLabel("x", "First");
    useSettingsStore.getState().setModelLabel("x", "Second");
    expect(useSettingsStore.getState().modelLabels["x"]).toBe("Second");
    expect(Object.keys(useSettingsStore.getState().modelLabels)).toHaveLength(1);
  });
});

// ─── persistence ─────────────────────────────────────────────────────────────

describe("zustand/persist", () => {
  it("writes to localStorage['aetherium-settings']", () => {
    useSettingsStore.getState().setFontSize(20);
    const raw = localStorage.getItem("aetherium-settings");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.fontSize).toBe(20);
  });

  it("after localStorage.clear() + setState reset, state reverts to defaults", () => {
    useSettingsStore.getState().setFontSize(20);
    localStorage.clear();
    useSettingsStore.setState(SETTINGS_INITIAL, true);
    expect(useSettingsStore.getState().fontSize).toBe(14);
  });
});
