import { useEffect, useLayoutEffect, useRef } from "react";

interface NavigationHotkeysOptions {
  onBack?: () => void;
  onForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

/**
 * Hook for handling back/forward navigation hotkeys and gestures.
 * Supports:
 * - Escape key to go back
 * - Alt/Cmd+Left/Right Arrow for back/forward (macOS browser convention)
 * - Trackpad/touch swipe gestures
 *
 * Uses refs internally so event listeners are registered only once and
 * always read the latest canGoBack/canGoForward values without stale closures.
 */
export function useNavigationHotkeys(options: NavigationHotkeysOptions) {
  const { onBack, onForward, canGoBack = true, canGoForward = true } = options;

  // Keep refs current so the single-registered effect always has fresh values.
  const onBackRef = useRef(onBack);
  const onForwardRef = useRef(onForward);
  const canGoBackRef = useRef(canGoBack);
  const canGoForwardRef = useRef(canGoForward);

  // Sync refs after every render so effects always see the latest values.
  useLayoutEffect(() => {
    onBackRef.current = onBack;
    onForwardRef.current = onForward;
    canGoBackRef.current = canGoBack;
    canGoForwardRef.current = canGoForward;
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't interfere with text inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Alt+Left or Cmd+Left for back (macOS browser convention)
      if ((e.metaKey || e.altKey) && e.key === "ArrowLeft" && canGoBackRef.current && onBackRef.current) {
        e.preventDefault();
        onBackRef.current();
        return;
      }

      // Alt+Right or Cmd+Right for forward
      if ((e.metaKey || e.altKey) && e.key === "ArrowRight" && canGoForwardRef.current && onForwardRef.current) {
        e.preventDefault();
        onForwardRef.current();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // Intentionally empty — reads latest values via refs at call time

  // Handle trackpad/touch gestures using Pointer Events
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let isSwiping = false;

    function handlePointerDown(e: PointerEvent) {
      if (e.pointerType === "mouse") { return; }
      startX = e.clientX;
      startY = e.clientY;
      isSwiping = false;
    }

    function handlePointerMove(e: PointerEvent) {
      if (e.pointerType === "mouse") { return; }
      const deltaAbsX = Math.abs(e.clientX - startX);
      const deltaAbsY = Math.abs(e.clientY - startY);
      if (deltaAbsX > deltaAbsY && deltaAbsX > 80) {
        isSwiping = true;
      }
    }

    function handlePointerUp(e: PointerEvent) {
      if (!isSwiping || e.pointerType === "mouse") { return; }
      const deltaX = e.clientX - startX;
      if (deltaX < -80 && canGoForwardRef.current && onForwardRef.current) {
        onForwardRef.current();
      } else if (deltaX > 80 && canGoBackRef.current && onBackRef.current) {
        onBackRef.current();
      }
      isSwiping = false;
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []); // Intentionally empty — reads latest values via refs at call time
}
