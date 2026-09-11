import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Workspace } from "../../stores/workspaceStore";
import { Tooltip } from "../Tooltip";
import { onDragRegionMouseDown } from "../WindowControls";
import { WorkspaceIcon } from "../../lib/workspaceIcon";
import { CompactMenuSelect } from "../CompactMenuSelect";
import { handleHorizontalWheel } from "../workspaceNav/workspaceNavShared";

function SubWorkspaceTabBar({
  parentWorkspaceId,
  activeWorkspaceId,
  onSelect,
  onSelectOverview,
  onAdd,
  onContextMenu,
}: {
  parentWorkspaceId: string | null;
  activeWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onSelectOverview?: (workspaceId: string) => void;
  onAdd?: () => void;
  onContextMenu?: (workspace: Workspace, x: number, y: number) => void;
}) {
  const allWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const parent = parentWorkspaceId ? allWorkspaces.find((ws) => ws.id === parentWorkspaceId) : null;
  const children = parentWorkspaceId
    ? allWorkspaces.filter((ws) => ws.parent_workspace_id === parentWorkspaceId)
    : [];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuListRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) {return;}
      if (menuListRef.current?.contains(event.target as Node)) {return;}
      setMenuOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    function updateMenuPosition() {
      const root = menuRef.current;
      if (!root) {return;}

      const rect = root.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const margin = 8;
      const menuGap = 4;
      const preferredMaxHeight = 360;
      const minUsefulHeight = 120;
      const belowSpace = viewportHeight - rect.bottom - margin - menuGap;
      const aboveSpace = rect.top - margin - menuGap;
      const openBelow = belowSpace >= minUsefulHeight || belowSpace >= aboveSpace;
      const availableHeight = Math.max(minUsefulHeight, openBelow ? belowSpace : aboveSpace);
      const maxHeight = Math.min(preferredMaxHeight, availableHeight);
      const top = openBelow
        ? rect.bottom + menuGap
        : Math.max(margin, rect.top - menuGap - maxHeight);
      const width = 240;
      const left = Math.min(
        Math.max(margin, rect.right - width),
        Math.max(margin, viewportWidth - width - margin)
      );

      setMenuStyle({
        left,
        top,
        width,
        maxHeight,
      });
    }

    updateMenuPosition();
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen]);

  if (!parentWorkspaceId) { return null; }

  return (
    <div
      data-tauri-drag-region
      onMouseDown={onDragRegionMouseDown}
      className="relative flex items-center h-8 border-b border-[var(--surface-border)] bg-[var(--bg-base)]/80 px-2 shrink-0 select-none"
    >
      {/* Fade the right edge so a long, horizontally-scrollable tab list reads
          as continuing off-screen instead of being clipped mid-label. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-[linear-gradient(to_right,transparent,var(--bg-base))]"
      />
      <div
        className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none"
        onWheel={handleHorizontalWheel}
      >
        {/* Pinned overview dot — navigates to the parent (overview) workspace */}
        {parent && (
          <Tooltip content={`${parent.name} (Overview)`} position="bottom">
            <button
              data-no-drag
              onClick={() => (onSelectOverview ?? onSelect)(parent.id)}
              onContextMenu={(event) => {
                if (onContextMenu) {
                  event.preventDefault();
                  event.stopPropagation();
                  onContextMenu(parent, event.clientX, event.clientY);
                }
              }}
              aria-label={`${parent.name} (Overview)`}
              className={`relative flex h-[24px] w-7 items-center justify-center shrink-0 rounded-md border transition-all select-none border-r-2 border-r-[var(--accent-color)]/60 ${
                activeWorkspaceId === parent.id
                  ? "border-[var(--surface-border)] bg-[var(--surface)] text-[var(--accent-color)] shadow-xs"
                  : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <svg width="6" height="6" viewBox="0 0 6 6" className="fill-current opacity-80 shrink-0"><circle cx="3" cy="3" r="3" /></svg>
            </button>
          </Tooltip>
        )}
        {children.map((workspace) => (
          <button
            key={workspace.id}
            onClick={() => onSelect(workspace.id)}
            onContextMenu={(event) => {
              if (onContextMenu) {
                event.preventDefault();
                event.stopPropagation();
                onContextMenu(workspace, event.clientX, event.clientY);
              }
            }}
            className={`relative flex h-[24px] items-center gap-1.5 shrink-0 rounded-md border px-2.5 text-xs whitespace-nowrap transition-all select-none ${
              activeWorkspaceId === workspace.id
                ? "border-[var(--surface-border)] bg-[var(--surface)] font-medium text-[var(--text-primary)] shadow-xs"
                : "border-transparent font-normal text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            }`}
          >
            {activeWorkspaceId === workspace.id && (
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-color)] shrink-0" />
            )}
            <WorkspaceIcon name={workspace.icon} label={workspace.name} className="h-3.5 w-3.5 opacity-70 shrink-0" />
            {workspace.name}
          </button>
        ))}
        {onAdd && (
          <Tooltip content="New Sub-workspace" position="bottom">
            <button
              data-no-drag
              onClick={onAdd}
              title="New Sub-workspace"
              aria-label="New Sub-workspace"
              className="h-6 w-6 shrink-0 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-md transition-colors"
            >
              <Plus size={14} />
            </button>
          </Tooltip>
        )}
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            data-no-drag
            title="All Sub-workspaces"
            aria-label="All Sub-workspaces"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((current) => !current);
            }}
            className="h-6 w-6 shrink-0 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-md transition-colors"
          >
            <ChevronDown size={14} />
          </button>

          {menuOpen && menuStyle
            ? createPortal(
                <div
                  ref={menuListRef}
                  role="menu"
                  data-no-drag
                  aria-label="Sub-workspace menu"
                  className="fixed z-[1000] flex max-h-80 w-60 flex-col overflow-y-auto rounded-xl border border-[var(--surface-border)] bg-[var(--bg-elevated)] p-1 shadow-xl"
                  style={menuStyle}
                >
                  {parent && (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={activeWorkspaceId === parent.id}
                      onClick={() => {
                        (onSelectOverview ?? onSelect)(parent.id);
                        setMenuOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                        activeWorkspaceId === parent.id
                          ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)] font-semibold"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <svg width="6" height="6" viewBox="0 0 6 6" className="fill-current opacity-80 shrink-0"><circle cx="3" cy="3" r="3" /></svg>
                      <span className="truncate">{parent.name} (Overview)</span>
                    </button>
                  )}
                  {parent && children.length > 0 && (
                    <div className="my-1 border-t border-[var(--surface-border)]" />
                  )}
                  {children.map((child) => {
                    const isActive = child.id === activeWorkspaceId;
                    return (
                      <button
                        key={child.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isActive}
                        onClick={() => {
                          onSelect(child.id);
                          setMenuOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                          isActive
                            ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)] font-semibold"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        <WorkspaceIcon name={child.icon} label={child.name} className="h-3.5 w-3.5 opacity-70 shrink-0" />
                        <span className="truncate flex-1">{child.name}</span>
                        {isActive && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-color)] shrink-0" />}
                      </button>
                    );
                  })}
                </div>,
                document.body
              )
            : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The sub-workspace picker control on its own — the parent "(Overview)" entry
 * plus each child workspace. Returns null when there is no parent (nothing to
 * navigate). Reused both in the standalone bar and the combined titlebar line.
 */
function SubWorkspaceDropdownSelect({
  parentWorkspaceId,
  activeWorkspaceId,
  onSelect,
  onSelectOverview,
}: {
  parentWorkspaceId: string | null;
  activeWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onSelectOverview?: (workspaceId: string) => void;
}) {
  const allWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const parent = parentWorkspaceId ? allWorkspaces.find((ws) => ws.id === parentWorkspaceId) : null;
  const children = parentWorkspaceId
    ? allWorkspaces.filter((ws) => ws.parent_workspace_id === parentWorkspaceId)
    : [];
  if (!parentWorkspaceId) { return null; }

  const options = [
    ...(parent ? [{ value: parent.id, label: `${parent.name} (Overview)` }] : []),
    ...children.map((ws) => ({ value: ws.id, label: ws.name })),
  ];
  const selectedValue = options.some((option) => option.value === activeWorkspaceId)
    ? activeWorkspaceId ?? options[0]?.value ?? ""
    : options[0]?.value ?? "";

  return (
    <CompactMenuSelect
      label="Sub-workspace"
      value={selectedValue}
      options={options}
      onChange={(value) => {
        if (parent && value === parent.id) {
          (onSelectOverview ?? onSelect)(value);
        } else {
          onSelect(value);
        }
      }}
      widthClassName="min-w-0 w-full max-w-[260px] sm:w-[240px]"
      buttonClassName="h-8 bg-[var(--bg-primary)]"
    />
  );
}

function SubWorkspaceDropdownBar({
  parentWorkspaceId,
  activeWorkspaceId,
  onSelect,
  onSelectOverview,
  onAdd,
}: {
  parentWorkspaceId: string | null;
  activeWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onSelectOverview?: (workspaceId: string) => void;
  onAdd?: () => void;
}) {
  if (!parentWorkspaceId) { return null; }

  return (
    <div
      data-tauri-drag-region
      onMouseDown={onDragRegionMouseDown}
      className="relative flex items-center gap-2 h-8 border-b border-[var(--surface-border)] bg-[var(--bg-base)]/80 px-3 shrink-0 select-none"
    >
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
        Sub-workspace
      </span>
      <div data-no-drag className="min-w-0">
        <SubWorkspaceDropdownSelect
          parentWorkspaceId={parentWorkspaceId}
          activeWorkspaceId={activeWorkspaceId}
          onSelect={onSelect}
          onSelectOverview={onSelectOverview}
        />
      </div>
      {onAdd && (
        <Tooltip content="New Sub-workspace" position="bottom">
          <button
            data-no-drag
            onClick={onAdd}
            title="New Sub-workspace"
            className="h-8 w-8 shrink-0 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
          >
            <Plus size={14} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export { SubWorkspaceTabBar, SubWorkspaceDropdownSelect, SubWorkspaceDropdownBar };
