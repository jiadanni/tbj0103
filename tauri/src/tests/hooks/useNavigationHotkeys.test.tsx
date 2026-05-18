import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, fireEvent } from "@testing-library/react";

function fire(key: string, opts: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { key, ...opts });
}

describe("useNavigationHotkeys", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("triggers back on Cmd+[ on macOS", async () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    const { useNavigationHotkeys } = await import("@/hooks/useNavigationHotkeys");
    const onBack = vi.fn();
    const onForward = vi.fn();

    renderHook(() =>
      useNavigationHotkeys({
        onBack,
        onForward,
        canGoBack: true,
        canGoForward: true,
      })
    );

    fire("[", { metaKey: true, code: "BracketLeft" });

    expect(onBack).toHaveBeenCalledOnce();
    expect(onForward).not.toHaveBeenCalled();
  });

  it("triggers forward on Cmd+] on macOS", async () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    const { useNavigationHotkeys } = await import("@/hooks/useNavigationHotkeys");
    const onBack = vi.fn();
    const onForward = vi.fn();

    renderHook(() =>
      useNavigationHotkeys({
        onBack,
        onForward,
        canGoBack: true,
        canGoForward: true,
      })
    );

    fire("]", { metaKey: true, code: "BracketRight" });

    expect(onForward).toHaveBeenCalledOnce();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("does not trigger navigation while an editable element is focused", async () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    const { useNavigationHotkeys } = await import("@/hooks/useNavigationHotkeys");
    const onBack = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    renderHook(() =>
      useNavigationHotkeys({
        onBack,
        canGoBack: true,
      })
    );

    fireEvent.keyDown(input, { key: "[", metaKey: true, code: "BracketLeft" });

    expect(onBack).not.toHaveBeenCalled();
  });
});
