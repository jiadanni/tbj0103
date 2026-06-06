import React from "react";
import type { LucideIcon } from "lucide-react";

export type SectionNavSidebarDensity = "comfortable" | "compact";

export interface SectionNavSidebarItem {
  id: string;
  label: string;
  icon: LucideIcon;
  isActive: boolean;
  onClick?: () => void;
  onMouseEnter?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onFocus?: (event: React.FocusEvent<HTMLButtonElement>) => void;
  onBlur?: (event: React.FocusEvent<HTMLButtonElement>) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

interface SectionNavSidebarProps {
  items: SectionNavSidebarItem[];
  density?: SectionNavSidebarDensity;
  /** Optional className appended to the outer `<nav>` so the comfortable
   *  real-app caller can keep its `px-1.5` spacing without baking layout
   *  choices into the chrome itself. */
  navClassName?: string;
}

const SIZES = {
  comfortable: {
    button:
      "flex items-center justify-center w-10 h-10 rounded-xl transition-colors select-none",
    active: "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)]",
    inactive:
      "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
    iconSize: 20,
    iconClass: "",
    showLabel: false,
    label: "",
    defaultNav: "flex flex-col items-center gap-1",
  },
  compact: {
    button:
      "flex flex-col items-center justify-center w-full py-1 rounded-lg text-[0.55em] transition-colors select-none",
    active:
      "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)] font-semibold",
    inactive: "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/50",
    iconSize: 12,
    iconClass: "mb-0.5",
    showLabel: true,
    label: "scale-[0.9] origin-center truncate w-full text-center",
    defaultNav: "flex flex-col gap-0.5 px-1 w-full",
  },
} as const;

/**
 * Vertical section navigation list shared between the real app's icon-bar
 * Sidebar and the Preferences Live App Preview "sidebar" section nav. The
 * chrome owns only the per-item button rendering; tooltip / context-menu /
 * popover / fontSize behavior stays in the real `Sidebar` wrapper.
 *
 * Both callers should source items from `PRIMARY_NAV_ITEMS` so the preview
 * cannot drift from the real navigation set.
 */
export function SectionNavSidebar({
  items,
  density = "comfortable",
  navClassName,
}: SectionNavSidebarProps) {
  const sizes = SIZES[density];
  const navClass = navClassName ?? sizes.defaultNav;

  return (
    <nav className={navClass}>
      {items.map((item) => {
        const Icon = item.icon;
        const className = `${sizes.button} ${item.isActive ? sizes.active : sizes.inactive}`;
        return (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            onMouseEnter={item.onMouseEnter}
            onMouseLeave={item.onMouseLeave}
            onFocus={item.onFocus}
            onBlur={item.onBlur}
            onContextMenu={item.onContextMenu}
            aria-label={!sizes.showLabel ? item.label : undefined}
            aria-current={item.isActive ? "page" : undefined}
            className={className}
          >
            <Icon size={sizes.iconSize} strokeWidth={1.5} className={sizes.iconClass} />
            {sizes.showLabel && <span className={sizes.label}>{item.label}</span>}
          </button>
        );
      })}
    </nav>
  );
}

export default React.memo(SectionNavSidebar);
