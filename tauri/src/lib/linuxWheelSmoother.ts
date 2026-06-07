import { isLinux } from "./platform";

const PIXELS_PER_LINE = 40;
const PIXELS_PER_PAGE = 800;

function findScrollableAncestor(start: Element | null): Element | Window {
  let el: Element | null = start;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    const canScrollY =
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      el.scrollHeight > el.clientHeight;
    if (canScrollY) { return el; }
    el = el.parentElement;
  }
  return window;
}

function shouldSkip(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) { return false; }
  // CodeMirror handles wheel events itself; don't interfere with editors.
  if (target.closest(".cm-editor")) { return true; }
  if (target.closest("[data-no-wheel-smoothing]")) { return true; }
  return false;
}

export function installLinuxWheelSmoother(): void {
  if (!isLinux) { return; }
  if (typeof document === "undefined") { return; }

  document.addEventListener(
    "wheel",
    (event) => {
      // Only smooth line- or page-stepped events. Pixel-mode events (touchpad
      // smooth scroll, Chromium-style smoothed wheel) are already smooth.
      if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) { return; }
      if (shouldSkip(event.target)) { return; }
      // Skip horizontal-only or zoom (Ctrl+wheel) events.
      if (event.ctrlKey) { return; }

      const multiplier =
        event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? PIXELS_PER_PAGE : PIXELS_PER_LINE;
      const dx = event.deltaX * multiplier;
      const dy = event.deltaY * multiplier;

      const target = findScrollableAncestor(event.target as Element | null);
      event.preventDefault();
      if (target instanceof Window) {
        target.scrollBy({ left: dx, top: dy, behavior: "auto" });
      } else {
        target.scrollBy({ left: dx, top: dy, behavior: "auto" });
      }
    },
    { passive: false, capture: true },
  );
}
