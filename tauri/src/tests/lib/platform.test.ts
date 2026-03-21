import { describe, it, expect, vi } from "vitest";
import { isEditableElement, isMac, MOD_KEY, CTRL_KEY } from "@/lib/platform";

// ─── isEditableElement ───────────────────────────────────────────────────────

describe("isEditableElement", () => {
  it("returns false for null", () => {
    expect(isEditableElement(null)).toBe(false);
  });

  it("returns true for <input>", () => {
    expect(isEditableElement(document.createElement("input"))).toBe(true);
  });

  it("returns true for <textarea>", () => {
    expect(isEditableElement(document.createElement("textarea"))).toBe(true);
  });

  it("returns true for <select>", () => {
    expect(isEditableElement(document.createElement("select"))).toBe(true);
  });

  it("returns false for plain <div>", () => {
    expect(isEditableElement(document.createElement("div"))).toBe(false);
  });

  it("returns true for <div contenteditable='true'>", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    expect(isEditableElement(div)).toBe(true);
  });

  it("returns false for <div contenteditable='false'>", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "false");
    expect(isEditableElement(div)).toBe(false);
  });
});

// ─── module-level constants (non-Mac defaults in jsdom) ──────────────────────

describe("platform constants — non-Mac (jsdom default)", () => {
  it("isMac is false", () => {
    expect(isMac).toBe(false);
  });

  it("MOD_KEY is 'Ctrl'", () => {
    expect(MOD_KEY).toBe("Ctrl");
  });

  it("CTRL_KEY is 'Ctrl'", () => {
    expect(CTRL_KEY).toBe("Ctrl");
  });
});

// ─── module-level constants (Mac override) ───────────────────────────────────

describe("platform constants — Mac platform", () => {
  it("isMac is true, MOD_KEY is ⌘, CTRL_KEY is ⌃ when platform is MacIntel", async () => {
    Object.defineProperty(window, "navigator", {
      value: { platform: "MacIntel" },
      writable: true,
      configurable: true,
    });
    vi.resetModules();
    const { isMac: macFlag, MOD_KEY: mod, CTRL_KEY: ctrl } = await import("@/lib/platform");
    expect(macFlag).toBe(true);
    expect(mod).toBe("⌘");
    expect(ctrl).toBe("⌃");
    // Restore to default for other tests
    Object.defineProperty(window, "navigator", {
      value: { platform: "" },
      writable: true,
      configurable: true,
    });
  });
});
