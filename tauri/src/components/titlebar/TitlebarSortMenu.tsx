import { useEffect, useRef, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { Tooltip } from "../Tooltip";

function TitlebarSortMenu() {
  const workspaceSortOrder = useWorkspaceStore((state) => state.workspaceSortOrder);
  const setWorkspaceSortOrder = useWorkspaceStore((state) => state.setWorkspaceSortOrder);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) { return; }
    function handleDown(e: MouseEvent) { if (!rootRef.current?.contains(e.target as Node)) { setOpen(false); } }
    function handleEsc(e: KeyboardEvent) { if (e.key === "Escape") { setOpen(false); } }
    window.addEventListener("mousedown", handleDown);
    window.addEventListener("keydown", handleEsc);
    return () => { window.removeEventListener("mousedown", handleDown); window.removeEventListener("keydown", handleEsc); };
  }, [open]);

  const options = [
    { id: "manual", label: "Manual Order" },
    { id: "name-asc", label: "Name A–Z" },
    { id: "name-desc", label: "Name Z–A" },
    { id: "created-newest", label: "Newest First" },
    { id: "created-oldest", label: "Oldest First" },
    { id: "updated-newest", label: "Recently Updated" },
    { id: "last-message-newest", label: "Last Message" },
    { id: "updated-oldest", label: "Least Recently Updated" },
  ] as const;

  const reverseSortOrder = useWorkspaceStore((state) => state.reverseSortOrder);
  const isReverseApplicable = workspaceSortOrder !== "manual";

  return (
    <div ref={rootRef} className="relative">
      <Tooltip content="Sort Workspaces" position="bottom">
        <button
          onClick={() => setOpen(!open)}
          aria-label="Sort Workspaces"
          className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
            open
              ? "border-[var(--accent-color)] bg-[var(--accent-color)] text-white"
              : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
          }`}
        >
          <ArrowUpDown size={15} />
        </button>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-48 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-xl py-1">
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => { setWorkspaceSortOrder(opt.id); setOpen(false); }}
              className={`flex w-full items-center px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--bg-hover)] ${
                workspaceSortOrder === opt.id ? "text-[var(--accent-color)] font-medium" : "text-[var(--text-secondary)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
          {isReverseApplicable && (
            <>
              <div className="my-1 h-px bg-[var(--border-color)]" />
              <button
                onClick={() => { reverseSortOrder(); setOpen(false); }}
                className="flex w-full items-center px-3 py-2 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                <ArrowUpDown size={12} className="mr-2" />
                Reverse Sort
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export { TitlebarSortMenu };
