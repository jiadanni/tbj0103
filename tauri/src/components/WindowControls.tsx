/* eslint-disable react-refresh/only-export-components */
import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isLinux, isMac } from "../lib/platform";

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
  if (!isLinux) {return;}
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
  if (!isLinux) {return null;}

  const appWindow = getCurrentWindow();

  async function handleMaximizeToggle() {
    const maximized = await appWindow.isMaximized();
    if (maximized) {
      await appWindow.unmaximize();
    } else {
      await maximizeWindow();
    }
  }

  return (
    <div className="flex items-center ml-auto gap-0.5 shrink-0" data-no-drag>
      <button
        onClick={() => appWindow.minimize()}
        className="w-8 h-10 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        title="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect fill="currentColor" width="10" height="1" />
        </svg>
      </button>
      <button
        onClick={handleMaximizeToggle}
        className="w-8 h-10 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        title="Maximize"
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
          <rect x="0.5" y="0.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        onClick={() => appWindow.close()}
        className="w-8 h-10 flex items-center justify-center rounded hover:bg-red-500/80 hover:text-white text-[var(--text-secondary)] transition-colors"
        title="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export default WindowControls;
