import { isLinux } from "./platform";

const PIXELS_PER_LINE = 40;
const PIXELS_PER_PAGE = 800;

export function findScrollableAncestor(
  start: Element | null,
  direction: "x" | "y" | "both" = "both",
): Element | Window {
  let el: Element | null = start;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = window.getComputedStyle(el);
    const overflowX = style.overflowX;
    const overflowY = style.overflowY;

    const canScrollX =
      (direction === "x" || direction === "both") &&
      (overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay") &&
      el.scrollWidth > el.clientWidth;

    const canScrollY =
      (direction === "y" || direction === "both") &&
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      el.scrollHeight > el.clientHeight;

    if (canScrollX || canScrollY) { return el; }
    el = el.parentElement;
  }
  return window;
}

export function shouldSkip(target: EventTarget | null): boolean {
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
      // Skip zoom (Ctrl+wheel) events.
      if (event.ctrlKey) { return; }

      const multiplier =
        event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? PIXELS_PER_PAGE : PIXELS_PER_LINE;
      const dx = event.deltaX * multiplier;
      const dy = event.deltaY * multiplier;

      if (dx === 0 && dy === 0) { return; }

      const direction = dx !== 0 && dy === 0 ? "x" : dy !== 0 && dx === 0 ? "y" : "both";
      const target = findScrollableAncestor(event.target as Element | null, direction);
      event.preventDefault();
      target.scrollBy({ left: dx, top: dy, behavior: "auto" });
    },
    { passive: false, capture: true },
  );
}
