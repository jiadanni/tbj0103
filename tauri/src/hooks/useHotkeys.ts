import { useEffect, useLayoutEffect, useRef } from "react";
import { isEditableElement } from "../lib/platform";

export interface HotkeyBinding {
  key: string;       // "k", "d", "1", "Tab", etc.
  mod?: "mod" | "ctrl" | "none"; // mod (⌘/Ctrl), ctrl (always Ctrl), or none
  shift?: boolean;
  action: () => void;
  allowInInput?: boolean; // If true, hotkey fires even if focus is in an input/textarea
  when?: () => boolean;
  label?: string;
  category?: string;
}

/**
 * Registers global hotkey listeners.
 */
export function useHotkeys(bindings: HotkeyBinding[]) {
  const bindingsRef = useRef(bindings);
  useLayoutEffect(() => {
    bindingsRef.current = bindings;
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      for (const binding of bindingsRef.current) {
        // Match base key (case insensitive)
        const keyMatch = e.key.toLowerCase() === binding.key.toLowerCase();
        if (!keyMatch) {
          continue;
        }

        // Match modifier
        const isMac = window.navigator.platform.toUpperCase().includes("MAC");
        let modMatch = false;
        if (binding.mod === "mod") {
          modMatch = isMac ? e.metaKey : e.ctrlKey;
        } else if (binding.mod === "ctrl") {
          modMatch = e.ctrlKey;
        } else {
          modMatch = !e.metaKey && !e.ctrlKey;
        }
        if (!modMatch) {
          continue;
        }

        // Match shift
        const shiftMatch = !!binding.shift === e.shiftKey;
        if (!shiftMatch) {
          continue;
        }

        // Skip if focus is in an editable element, unless allowed
        if (!binding.allowInInput && isEditableElement(document.activeElement)) {
          continue;
        }

        // Match guard
        if (binding.when && !binding.when()) {
          continue;
        }

        // Execute action
        e.preventDefault();
        binding.action();
        break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
