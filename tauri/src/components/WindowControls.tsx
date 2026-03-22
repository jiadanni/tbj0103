import { getCurrentWindow } from "@tauri-apps/api/window";
import { isLinux } from "../lib/platform";

function WindowControls() {
  if (!isLinux) return null;

  const appWindow = getCurrentWindow();

  return (
    <div className="flex items-center ml-auto gap-0.5 shrink-0">
      <button
        onClick={() => appWindow.minimize()}
        className="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        title="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect fill="currentColor" width="10" height="1" />
        </svg>
      </button>
      <button
        onClick={() => appWindow.toggleMaximize()}
        className="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        title="Maximize"
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
          <rect x="0.5" y="0.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        onClick={() => appWindow.close()}
        className="w-8 h-8 flex items-center justify-center rounded hover:bg-red-500/80 hover:text-white text-[var(--text-secondary)] transition-colors"
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
