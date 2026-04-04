import React, { useState, useEffect, useCallback, useRef } from "react";

export interface ToolbarState {
  x: number;
  y: number;
  text: string;
}

/**
 * Hook to manage a floating toolbar that appears when text is selected
 * within a specific container.
 */
export function useTextSelectionToolbar(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [toolbarState, setToolbarState] = useState<ToolbarState | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
    setToolbarState(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      
      if (!selection || selection.isCollapsed || !containerRef.current) {
        setToolbarState(null);
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        setToolbarState(null);
        return;
      }

      const anchorNode = selection.anchorNode;
      const range = selection.getRangeAt(0);

      // Guard: Ensure selection starts inside the container
      if (!anchorNode || !containerRef.current.contains(anchorNode)) {
        setToolbarState(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      
      // Position the toolbar above the center of the selection
      setToolbarState({
        x: rect.left + rect.width / 2,
        y: rect.top,
        text,
      });
    };

    const handleMouseDown = (e: MouseEvent) => {
      // If clicking the toolbar itself, don't dismiss
      if (toolbarRef.current?.contains(e.target as Node)) {
        return;
      }
      
      // If clicking elsewhere and we have a toolbar, it might be dismissed
      // by selectionchange if the selection is cleared, but we can be explicit.
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dismiss();
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [containerRef, dismiss]);

  return { toolbarState, toolbarRef, dismiss };
}
