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
          className="flex h-7 w-7 items-center justify-center rounded-lg border-0 bg-transparent text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={15} strokeWidth={1.7} />
        </button>
      </Tooltip>
      <Tooltip content="Go forward (Alt+Right / Cmd+Right / Cmd+])" position="bottom">
        <button
          onClick={goForward}
          disabled={!canGoForward}
          aria-label="Go forward"
          className="flex h-7 w-7 items-center justify-center rounded-lg border-0 bg-transparent text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronRight size={15} strokeWidth={1.7} />
        </button>
      </Tooltip>
    </div>
  );
}

export { BackForwardNavigation };
