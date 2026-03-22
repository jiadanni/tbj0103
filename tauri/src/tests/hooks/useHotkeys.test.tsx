import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { useHotkeys } from "@/hooks/useHotkeys";
import type { HotkeyBinding } from "@/hooks/useHotkeys";

// Default jsdom platform is non-Mac — navigator.platform === ""
beforeEach(() => {
  vi.stubGlobal("navigator", { platform: "" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Remove any lingering DOM elements added during tests
  document.body.innerHTML = "";
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function fire(key: string, opts: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { key, ...opts });
}

function renderBinding(binding: Partial<HotkeyBinding> & { key: string; action: () => void }) {
  return renderHook(() => useHotkeys([{ ...binding }]));
}

// ─── basic key matching ───────────────────────────────────────────────────────

describe("key matching", () => {
  it("fires action on matching key (no modifier)", () => {
    const action = vi.fn();
    renderBinding({ key: "k", action });
    fire("k");
    expect(action).toHaveBeenCalledOnce();
  });

  it("does not fire on wrong key", () => {
    const action = vi.fn();
    renderBinding({ key: "k", action });
    fire("j");
    expect(action).not.toHaveBeenCalled();
  });

  it("key matching is case-insensitive", () => {
    const action = vi.fn();
    renderBinding({ key: "k", action });
    fire("K");
    expect(action).toHaveBeenCalledOnce();
  });
});

// ─── modifier handling ────────────────────────────────────────────────────────

describe("mod: 'mod' on non-Mac", () => {
  it("fires with Ctrl on non-Mac", () => {
    const action = vi.fn();
    renderBinding({ key: "k", mod: "mod", action });
    fire("k", { ctrlKey: true });
    expect(action).toHaveBeenCalledOnce();
  });

  it("does not fire with Meta on non-Mac", () => {
    const action = vi.fn();
    renderBinding({ key: "k", mod: "mod", action });
    fire("k", { metaKey: true });
    expect(action).not.toHaveBeenCalled();
  });

  it("matches punctuation hotkeys like mod+\\", () => {
    const action = vi.fn();
    renderBinding({ key: "\\", mod: "mod", action });
    fire("\\", { ctrlKey: true });
    expect(action).toHaveBeenCalledOnce();
  });
});

describe("mod: 'mod' on Mac", () => {
  it("fires with Meta on Mac", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    const action = vi.fn();
    renderBinding({ key: "k", mod: "mod", action });
    fire("k", { metaKey: true });
    expect(action).toHaveBeenCalledOnce();
  });

  it("does not fire with Ctrl on Mac when mod is 'mod'", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    const action = vi.fn();
    renderBinding({ key: "k", mod: "mod", action });
    fire("k", { ctrlKey: true });
    expect(action).not.toHaveBeenCalled();
  });
});

describe("mod: 'ctrl'", () => {
  it("fires with Ctrl regardless of platform (non-Mac)", () => {
    const action = vi.fn();
    renderBinding({ key: "k", mod: "ctrl", action });
    fire("k", { ctrlKey: true });
    expect(action).toHaveBeenCalledOnce();
  });

  it("fires with Ctrl on Mac as well", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    const action = vi.fn();
    renderBinding({ key: "k", mod: "ctrl", action });
    fire("k", { ctrlKey: true });
    expect(action).toHaveBeenCalledOnce();
  });
});

// ─── shift matching ───────────────────────────────────────────────────────────

describe("shift modifier", () => {
  it("fires when shift: true and Shift is held", () => {
    const action = vi.fn();
    renderBinding({ key: "k", shift: true, action });
    fire("k", { shiftKey: true });
    expect(action).toHaveBeenCalledOnce();
  });

  it("does not fire when shift: true but Shift is not held", () => {
    const action = vi.fn();
    renderBinding({ key: "k", shift: true, action });
    fire("k");
    expect(action).not.toHaveBeenCalled();
  });
});

// ─── allowInInput ─────────────────────────────────────────────────────────────

describe("allowInInput", () => {
  it("does not fire when an input is focused (default)", () => {
    const action = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    renderBinding({ key: "k", action });
    fire("k");
    expect(action).not.toHaveBeenCalled();
  });

  it("fires even when input is focused when allowInInput: true", () => {
    const action = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    renderBinding({ key: "k", allowInInput: true, action });
    fire("k");
    expect(action).toHaveBeenCalledOnce();
  });
});

// ─── when() guard ─────────────────────────────────────────────────────────────

describe("when() guard", () => {
  it("does not fire when when() returns false", () => {
    const action = vi.fn();
    renderBinding({ key: "k", action, when: () => false });
    fire("k");
    expect(action).not.toHaveBeenCalled();
  });

  it("fires when when() returns true", () => {
    const action = vi.fn();
    renderBinding({ key: "k", action, when: () => true });
    fire("k");
    expect(action).toHaveBeenCalledOnce();
  });
});

// ─── break after first match ──────────────────────────────────────────────────

describe("break after first matching binding", () => {
  it("only the first matching binding fires; second is skipped", () => {
    const action1 = vi.fn();
    const action2 = vi.fn();
    renderHook(() =>
      useHotkeys([
        { key: "k", action: action1 },
        { key: "k", action: action2 },
      ])
    );
    fire("k");
    expect(action1).toHaveBeenCalledOnce();
    expect(action2).not.toHaveBeenCalled();
  });
});

// ─── cleanup on unmount ───────────────────────────────────────────────────────

describe("cleanup", () => {
  it("removes the keydown listener after unmount", () => {
    const spy = vi.spyOn(window, "removeEventListener");
    const action = vi.fn();
    const { unmount } = renderBinding({ key: "k", action });
    unmount();
    expect(spy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });
});
