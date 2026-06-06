import React from "react";
import { Plus } from "lucide-react";
import { Tooltip } from "../Tooltip";

export type SinglePaneWorkspaceSidebarDensity = "comfortable" | "compact";

export interface SinglePaneWorkspaceSidebarItem {
  id: string;
  name: string;
  isActive: boolean;
  isDragTarget?: boolean;
  onClick?: () => void;
  onDragOver?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnter?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLButtonElement>) => void;
}

interface SinglePaneWorkspaceSidebarProps {
  items: SinglePaneWorkspaceSidebarItem[];
  headerLabel: string;
  density?: SinglePaneWorkspaceSidebarDensity;
  /** When provided, renders a "+" button in the header that fires this
   *  callback. Tooltip text is configurable via `createTooltip`. */
  onCreate?: () => void;
  createTooltip?: string;
  testId?: string;
  /** Optional dot-prefixed "Overview" entry rendered before the items
   *  list. Used by the sub-workspace sidebar to surface the parent
   *  workspace. When `onClick` is omitted the entry is non-interactive
   *  (used by the preview). */
  overview?: {
    label: string;
    isActive?: boolean;
    onClick?: () => void;
  };
}

const SIZES = {
  comfortable: {
    container: "w-[180px]",
    header:
      "px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]",
    list: "flex-1 overflow-y-auto px-2 pb-2 space-y-0.5",
    item: "rounded-md px-2 py-1.5 text-xs",
    itemActive: "bg-[var(--accent-color)] text-white",
    itemInactive:
      "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
    itemDrag:
      "bg-[var(--accent-color)]/20 text-[var(--accent-color)] ring-1 ring-inset ring-[var(--accent-color)]",
    headerButton:
      "flex h-5 w-5 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
    headerIconSize: 12,
    overviewGap: "gap-1.5",
    overviewDotSize: 6,
  },
  compact: {
    container: "w-[85px] p-1 gap-0.5",
    header:
      "px-1.5 py-0.5 mb-0.5 text-[0.55em] uppercase tracking-wider text-[var(--text-muted)] font-bold opacity-60",
    list: "flex flex-col gap-0.5",
    item: "rounded px-1.5 py-0.5 text-[0.6em] truncate leading-tight",
    itemActive: "bg-[var(--accent-color)] text-white font-semibold",
    itemInactive: "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/40",
    itemDrag:
      "bg-[var(--accent-color)]/20 text-[var(--accent-color)] ring-1 ring-inset ring-[var(--accent-color)]",
    headerButton:
      "flex h-3 w-3 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
    headerIconSize: 8,
    overviewGap: "gap-1",
    overviewDotSize: 4,
  },
} as const;

/**
 * Vertical workspace rail rendered in single-pane layouts. Shared between
 * the real app's left sidebar (comfortable density, with click + drag-drop
 * handlers and an "add workspace" button) and the Preferences Live App
 * Preview (compact density, static items). The same Tailwind classes drive
 * both renderings so the preview cannot drift from the real chrome.
 */
export function SinglePaneWorkspaceSidebar({
  items,
  headerLabel,
  density = "comfortable",
  onCreate,
  createTooltip,
  testId,
  overview,
}: SinglePaneWorkspaceSidebarProps) {
  const sizes = SIZES[density];

  const headerButton = onCreate ? (
    <button
      type="button"
      onClick={onCreate}
      className={sizes.headerButton}
      aria-label={createTooltip ?? "New"}
    >
      <Plus size={sizes.headerIconSize} />
    </button>
  ) : null;

  const overviewEntry = overview
    ? (() => {
        const className = `flex w-full items-center text-left truncate transition-colors ${sizes.overviewGap} ${sizes.item} ${
          overview.isActive ? sizes.itemActive : sizes.itemInactive
        }`;
        const dot = (
          <svg
            width={sizes.overviewDotSize}
            height={sizes.overviewDotSize}
            viewBox="0 0 6 6"
            className="fill-current opacity-80 shrink-0"
          >
            <circle cx="3" cy="3" r="3" />
          </svg>
        );
        if (overview.onClick) {
          return (
            <button
              type="button"
              onClick={overview.onClick}
              className={className}
            >
              {dot}
              <span className="truncate">{overview.label}</span>
            </button>
          );
        }
        return (
          <div className={`${className} select-none`}>
            {dot}
            <span className="truncate">{overview.label}</span>
          </div>
        );
      })()
    : null;

  return (
    <div
      className={`flex h-full shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] ${sizes.container}`}
      data-testid={testId}
    >
      <div className={`flex items-center justify-between ${sizes.header}`}>
        <span>{headerLabel}</span>
        {headerButton && createTooltip ? (
          <Tooltip content={createTooltip} position="right">
            {headerButton}
          </Tooltip>
        ) : (
          headerButton
        )}
      </div>
      <div className={sizes.list}>
        {overviewEntry}
        {items.map((item) => {
          const className = `flex w-full items-center text-left truncate transition-colors ${sizes.item} ${
            item.isDragTarget
              ? sizes.itemDrag
              : item.isActive
                ? sizes.itemActive
                : sizes.itemInactive
          }`;
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              onDragOver={item.onDragOver}
              onDragEnter={item.onDragEnter}
              onDragLeave={item.onDragLeave}
              onDrop={item.onDrop}
              className={className}
            >
              {item.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default React.memo(SinglePaneWorkspaceSidebar);
