/* eslint-disable react-refresh/only-export-components */
import React, { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isLinux, isMac } from "../lib/platform";
import { Tooltip } from "./Tooltip";

async function maximizeWindow() {
  const appWindow = getCurrentWindow();

  if (isLinux) {
    await appWindow.setFocus().catch(() => {});
  }

  await appWindow.maximize();

  // Some Linux WMs ignore the first maximize on undecorated windows.
  if (isLinux) {
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    const maximized = await appWindow.isMaximized().catch(() => false);
    if (!maximized) {
      await appWindow.setFocus().catch(() => {});
      await appWindow.maximize().catch(() => {});
    }
  }
}

/** onMouseDown handler that initiates window dragging. Use on drag region elements. */
export function onDragRegionMouseDown(e: React.MouseEvent) {
  if (isMac) {return;}
  // Only drag on left-click, and only when clicking the element itself (not child buttons/inputs)
  if (e.button !== 0) {return;}
  const target = e.target as HTMLElement;
  if (target.closest("button, input, select, textarea, a, [data-no-drag]")) {return;}
  e.preventDefault();
  getCurrentWindow().startDragging();
}

export async function onDragRegionDoubleClick(e: React.MouseEvent) {
  if (isMac || e.button !== 0) {return;}
  const target = e.target as HTMLElement;
  if (target.closest("button, input, select, textarea, a, [data-no-drag]")) {return;}

  const appWindow = getCurrentWindow();
  const maximized = await appWindow.isMaximized();
  if (maximized) {
    await appWindow.unmaximize();
  } else {
    await maximizeWindow();
  }
}

function WindowControls() {
  const appWindow = getCurrentWindow();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (isMac) {return;}
    let unlisten: (() => void) | undefined;

    appWindow.isMaximized().then(setIsMaximized);

    appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [appWindow]);

  if (isMac) {return null;}

  async function handleMaximizeToggle() {
    if (isMaximized) {
      await appWindow.unmaximize();
    } else {
      await maximizeWindow();
    }
  }

  return (
    <div className="relative z-10 flex min-w-[96px] shrink-0 items-center justify-end gap-0.5" data-no-drag>
      <Tooltip content="Minimise" position="bottom">
        <button
          onClick={() => appWindow.minimize()}
          className="w-8 h-10 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect fill="currentColor" width="10" height="1" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip content={isMaximized ? "Restore" : "Maximise"} position="bottom">
        <button
          onClick={handleMaximizeToggle}
          className="w-8 h-10 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          {isMaximized ? (
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <rect x="2.5" y="0.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1" />
              <rect x="0.5" y="2.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1" fill="var(--bg-primary)" />
            </svg>
          ) : (
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <rect x="0.5" y="0.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
      </Tooltip>
      <Tooltip content="Close" position="bottom">
        <button
          onClick={() => appWindow.close()}
          className="w-8 h-10 flex items-center justify-center rounded hover:bg-red-500/80 hover:text-white text-[var(--text-secondary)] transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </Tooltip>
    </div>
  );
}

export default WindowControls;

export function LinuxResizeBorders() {
  if (!isLinux) {return null;}
  const appWindow = getCurrentWindow();
  
  return (
    <>
      <div className="absolute top-0 left-2 right-2 h-1 cursor-n-resize z-[9999]" onMouseDown={() => appWindow.startResizeDragging('North')} />
      <div className="absolute bottom-0 left-2 right-2 h-1.5 cursor-s-resize z-[9999]" onMouseDown={() => appWindow.startResizeDragging('South')} />
      <div className="absolute top-2 bottom-2 left-0 w-1.5 cursor-w-resize z-[9999]" onMouseDown={() => appWindow.startResizeDragging('West')} />
      <div className="absolute top-2 bottom-2 right-0 w-1.5 cursor-e-resize z-[9999]" onMouseDown={() => appWindow.startResizeDragging('East')} />
      
      {/* corners */}
      <div className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize z-[10000]" onMouseDown={() => appWindow.startResizeDragging('NorthWest')} />
      <div className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize z-[10000]" onMouseDown={() => appWindow.startResizeDragging('NorthEast')} />
      <div className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-[10000]" onMouseDown={() => appWindow.startResizeDragging('SouthWest')} />
      <div className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize z-[10000]" onMouseDown={() => appWindow.startResizeDragging('SouthEast')} />
    </>
  );
}
