import React from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Pure-presentational horizontal section-tabs strip.
 *
 * Used by:
 * - `TopTabsNavigation` in `Layout.tsx` (real app, density="comfortable")
 * - `LiveAppPreview` in `PreferencesView.tsx` (preview, density="compact")
 *
 * Holds no routing or store state. Wrappers supply the items, the active id,
 * and the callbacks. Right-click handling is opt-in via `onContextMenu`.
 *
 * Active-tab indicator is the thin absolute accent strip at the top of the
 * tab — matches the workspace tab pattern in `WorkspaceNavigationTabs`.
 */

export interface SectionNavTopTabItem {
  /** Stable identifier used both as React key and to match `activeId`. */
  id: string;
  label: string;
  icon: LucideIcon;
}

export type SectionNavTopTabsDensity = "comfortable" | "compact";

interface SectionNavTopTabsProps {
  items: SectionNavTopTabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onContextMenu?: (id: string, x: number, y: number) => void;
  density?: SectionNavTopTabsDensity;
}

const SIZES = {
  comfortable: {
    container: "h-10 px-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]",
    tab: "mt-1 h-[34px] gap-1.5 px-3.5 text-sm rounded-t-xl",
    iconSize: 18,
    activeStripInset: "inset-x-3",
    activeShadow: "shadow-[0_-10px_25px_-20px_rgba(15,23,42,0.55)]",
    activeBorder: "border-[var(--border-color)]",
  },
  compact: {
    container: "h-8 px-3 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]",
    tab: "h-full gap-1 px-1 text-[0.65em] rounded-none",
    iconSize: 10,
    activeStripInset: "inset-x-1",
    activeShadow: "",
    activeBorder: "border-transparent",
  },
} as const;

export function SectionNavTopTabs({
  items,
  activeId,
  onSelect,
  onContextMenu,
  density = "comfortable",
}: SectionNavTopTabsProps) {
  const sizes = SIZES[density];

  return (
    <div className={`flex items-center shrink-0 overflow-x-auto select-none ${sizes.container}`}>
      <div className="flex items-center shrink-0">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              onContextMenu={
                onContextMenu
                  ? (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onContextMenu(item.id, event.clientX, event.clientY);
                    }
                  : undefined
              }
              className={`relative flex items-center self-end border border-b-0 font-medium whitespace-nowrap transition-all select-none ${sizes.tab} ${
                isActive
                  ? `${sizes.activeBorder} bg-[var(--bg-primary)] text-[var(--text-primary)] ${sizes.activeShadow}`
                  : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              {isActive && (
                <span
                  className={`absolute top-0 h-0.5 rounded-full bg-[var(--accent-color)] ${sizes.activeStripInset}`}
                />
              )}
              <Icon size={sizes.iconSize} />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default React.memo(SectionNavTopTabs);
