/**
 * Platform detection and DOM utilities for keyboard handling.
 */

export const isMac = typeof window !== "undefined" && window.navigator.platform.toUpperCase().includes("MAC");
export const isLinux = typeof window !== "undefined" && window.navigator.platform.toUpperCase().includes("LINUX");
export const isWindows = typeof window !== "undefined" && window.navigator.platform.toUpperCase().includes("WIN");
export const MOD_KEY = isMac ? "⌘" : "Ctrl";
export const CTRL_KEY = isMac ? "⌃" : "Ctrl";

/**
 * Checks if the focused element is an input, textarea, or otherwise editable.
 */
export function isEditableElement(el: Element | null): boolean {
  if (!el) {
    return false;
  }
  if (!(el instanceof Element)) {
    return false;
  }
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if ((el as HTMLElement).isContentEditable || el.getAttribute("contenteditable") === "true") {
    return true;
  }
  return false;
}
