import { describe, expect, it } from "vitest";
import { findScrollableAncestor, shouldSkip } from "@/lib/linuxWheelSmoother";

describe("linuxWheelSmoother", () => {
  describe("findScrollableAncestor", () => {
    it("finds a horizontal scroll ancestor when direction is x", () => {
      const outer = document.createElement("div");
      Object.defineProperty(outer, "scrollHeight", { value: 500, configurable: true });
      Object.defineProperty(outer, "clientHeight", { value: 200, configurable: true });
      outer.style.overflowY = "auto";

      const inner = document.createElement("div");
      Object.defineProperty(inner, "scrollWidth", { value: 600, configurable: true });
      Object.defineProperty(inner, "clientWidth", { value: 200, configurable: true });
      inner.style.overflowX = "auto";
      outer.appendChild(inner);

      const target = document.createElement("span");
      inner.appendChild(target);
      document.body.appendChild(outer);

      try {
        const ancestorX = findScrollableAncestor(target, "x");
        expect(ancestorX).toBe(inner);

        const ancestorY = findScrollableAncestor(target, "y");
        expect(ancestorY).toBe(outer);
      } finally {
        document.body.removeChild(outer);
      }
    });

    it("falls back to window when no ancestor scrolls in the requested direction", () => {
      const container = document.createElement("div");
      const target = document.createElement("span");
      container.appendChild(target);
      document.body.appendChild(container);

      try {
        expect(findScrollableAncestor(target, "x")).toBe(window);
        expect(findScrollableAncestor(target, "y")).toBe(window);
      } finally {
        document.body.removeChild(container);
      }
    });
  });

  describe("shouldSkip", () => {
    it("skips CodeMirror editors", () => {
      const editor = document.createElement("div");
      editor.className = "cm-editor";
      const child = document.createElement("span");
      editor.appendChild(child);

      expect(shouldSkip(child)).toBe(true);
    });

    it("skips elements with data-no-wheel-smoothing", () => {
      const el = document.createElement("div");
      el.setAttribute("data-no-wheel-smoothing", "true");
      const child = document.createElement("span");
      el.appendChild(child);

      expect(shouldSkip(child)).toBe(true);
    });

    it("does not skip normal elements", () => {
      const el = document.createElement("div");
      expect(shouldSkip(el)).toBe(false);
    });

    it("handles non-element targets cleanly", () => {
      expect(shouldSkip(null)).toBe(false);
    });
  });
});
