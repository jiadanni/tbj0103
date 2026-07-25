import { ChevronLeft, ChevronRight } from "lucide-react";
import { Tooltip } from "../Tooltip";
import { useNavigationHistory } from "../../hooks/useNavigationHistory";

/** Back/Forward navigation buttons in the titlebar */
function BackForwardNavigation() {
  const { goBack, goForward, canGoBack, canGoForward } = useNavigationHistory();

  return (
    <div className="flex items-center gap-1">
      <Tooltip content="Go back (Alt+Left / Cmd+Left / Cmd+[)" position="bottom">
        <button
          onClick={goBack}
          disabled={!canGoBack}
          aria-label="Go back"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={15} />
        </button>
      </Tooltip>
      <Tooltip content="Go forward (Alt+Right / Cmd+Right / Cmd+])" position="bottom">
        <button
          onClick={goForward}
          disabled={!canGoForward}
          aria-label="Go forward"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronRight size={15} />
        </button>
      </Tooltip>
    </div>
  );
}

export { BackForwardNavigation };
