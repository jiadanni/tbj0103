import { describe, it, expect, vi, beforeEach } from "vitest";
import type React from "react";

const platformState = vi.hoisted(() => ({ isMac: false }));

vi.mock("@/lib/platform", () => ({
  get isMac() { return platformState.isMac; },
  get isLinux() { return !platformState.isMac; },
  isWindows: false,
  MOD_KEY: "Ctrl",
  CTRL_KEY: "Ctrl",
  isEditableElement: () => false,
}));

const windowMock = vi.hoisted(() => ({
  startDragging: vi.fn(),
  isMaximized: vi.fn().mockResolvedValue(false),
  maximize: vi.fn().mockResolvedValue(undefined),
  unmaximize: vi.fn().mockResolvedValue(undefined),
  setFocus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowMock,
}));

import { onDragRegionMouseDown, onDragRegionDoubleClick } from "@/components/WindowControls";

/** Minimal MouseEvent stand-in; the handlers only read `button`, `target`. */
function mouseEvent(target: HTMLElement, button = 0) {
  return {
    button,
    target,
    preventDefault: vi.fn(),
  } as unknown as React.MouseEvent;
}

describe("drag region handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    windowMock.isMaximized.mockResolvedValue(false);
    document.body.innerHTML = "";
  });

  // Regression: dragging the titlebar was a no-op on macOS because both
  // handlers returned early there, deferring to `-webkit-app-region: drag` —
  // a Chromium property that does nothing in macOS's WKWebView.
  for (const isMac of [true, false]) {
    const platform = isMac ? "macOS" : "Linux";

    it(`starts dragging from a bare drag region on ${platform}`, () => {
      platformState.isMac = isMac;
      const region = document.createElement("div");
      document.body.appendChild(region);

      onDragRegionMouseDown(mouseEvent(region));

      expect(windowMock.startDragging).toHaveBeenCalledTimes(1);
    });

    it(`toggles maximize on double-click on ${platform}`, async () => {
      platformState.isMac = isMac;
      const region = document.createElement("div");
      document.body.appendChild(region);

      await onDragRegionDoubleClick(mouseEvent(region));

      // Linux retries the maximize once when the WM reports it did not take.
      expect(windowMock.maximize).toHaveBeenCalledTimes(isMac ? 1 : 2);
      expect(windowMock.unmaximize).not.toHaveBeenCalled();
    });

    it(`does not drag from an interactive child on ${platform}`, () => {
      platformState.isMac = isMac;
      const region = document.createElement("div");
      const button = document.createElement("button");
      region.appendChild(button);
      document.body.appendChild(region);

      onDragRegionMouseDown(mouseEvent(button));

      expect(windowMock.startDragging).not.toHaveBeenCalled();
    });

    it(`does not drag from a [data-no-drag] subtree on ${platform}`, () => {
      platformState.isMac = isMac;
      const region = document.createElement("div");
      const noDrag = document.createElement("div");
      noDrag.setAttribute("data-no-drag", "");
      const label = document.createElement("span");
      noDrag.appendChild(label);
      region.appendChild(noDrag);
      document.body.appendChild(region);

      onDragRegionMouseDown(mouseEvent(label));

      expect(windowMock.startDragging).not.toHaveBeenCalled();
    });

    it(`ignores non-left-click on ${platform}`, () => {
      platformState.isMac = isMac;
      const region = document.createElement("div");
      document.body.appendChild(region);

      onDragRegionMouseDown(mouseEvent(region, 2));

      expect(windowMock.startDragging).not.toHaveBeenCalled();
    });
  }

  it("unmaximizes a maximized window on double-click", async () => {
    platformState.isMac = true;
    windowMock.isMaximized.mockResolvedValue(true);
    const region = document.createElement("div");
    document.body.appendChild(region);

    await onDragRegionDoubleClick(mouseEvent(region));

    expect(windowMock.unmaximize).toHaveBeenCalledTimes(1);
    expect(windowMock.maximize).not.toHaveBeenCalled();
  });
});
