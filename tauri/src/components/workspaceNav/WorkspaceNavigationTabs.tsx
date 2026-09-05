import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Workspace, PaneId } from "../../stores/workspaceStore";
import { api } from "../../lib/api";
import { WorkspaceIcon } from "../../lib/workspaceIcon";
import { handleHorizontalWheel, workspaceTabClassName } from "./workspaceNavShared";

function WorkspaceNavigationTabs({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onContextMenu,
  paneId,
}: {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onContextMenu?: (workspace: Workspace, x: number, y: number) => void;
  paneId?: PaneId;
}) {
  const allWorkspaces = useWorkspaceStore((state) => state.workspaces);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOverWorkspaceId, setDragOverWorkspaceId] = useState<string | null>(null);
  const [_draggedWorkspaceId, setDraggedWorkspaceId] = useState<string | null>(null);
  const reorderWorkspaces = useWorkspaceStore((state) => state.reorderWorkspaces);
  const dragHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuListRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);

  useEffect(() => () => {
    if (dragHoverTimerRef.current) { clearTimeout(dragHoverTimerRef.current); }
  }, []);

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
      const preferredMaxHeight = 440;
      const minUsefulHeight = 160;
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

  return (
    <div className="relative flex h-full min-w-0 flex-1 items-center gap-1" data-no-drag>
      {/* items-end (not items-center) so each tab's `self-end` resolves against
          the titlebar's bottom edge. With items-center the tabs sat a few px
          below the chevron and + buttons beside them. */}
      <div
        className="flex h-full min-w-0 flex-1 items-end gap-1 overflow-x-auto scrollbar-none"
        onWheel={handleHorizontalWheel}
      >
        {workspaces.map((workspace) => (
          <button
            key={`${paneId ? paneId + "-" : ""}${workspace.id}`}
            onClick={() => onSelect(workspace.id)}
            onContextMenu={(event) => {
              if (onContextMenu) {
                event.preventDefault();
                event.stopPropagation();
                onContextMenu(workspace, event.clientX, event.clientY);
              }
            }}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-workspace-id", workspace.id);
              event.dataTransfer.effectAllowed = "move";
              setDraggedWorkspaceId(workspace.id);
            }}
            onDragEnd={() => {
              setDraggedWorkspaceId(null);
              setDragOverWorkspaceId(null);
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("application/x-workspace-id")) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                return;
              }
              if (!event.dataTransfer.types.includes("application/x-chat-session-ids")) {
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDragEnter={(event) => {
              if (event.dataTransfer.types.includes("application/x-workspace-id")) {
                event.preventDefault();
                setDragOverWorkspaceId(workspace.id);
                return;
              }
              if (!event.dataTransfer.types.includes("application/x-chat-session-ids")) {
                return;
              }
              event.preventDefault();
              setDragOverWorkspaceId(workspace.id);
              if (dragHoverTimerRef.current) {
                clearTimeout(dragHoverTimerRef.current);
              }
              dragHoverTimerRef.current = setTimeout(() => {
                onSelect(workspace.id);
              }, 600);
            }}
            onDragLeave={(event) => {
              const related = event.relatedTarget as Node | null;
              if (related && event.currentTarget.contains(related)) {
                return;
              }
              if (dragOverWorkspaceId === workspace.id) {
                setDragOverWorkspaceId(null);
              }
              if (dragHoverTimerRef.current) {
                clearTimeout(dragHoverTimerRef.current);
                dragHoverTimerRef.current = null;
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragOverWorkspaceId(null);
              if (dragHoverTimerRef.current) {
                clearTimeout(dragHoverTimerRef.current);
                dragHoverTimerRef.current = null;
              }

              const wsId = event.dataTransfer.getData("application/x-workspace-id");
              if (wsId && wsId !== workspace.id) {
                const sourceIndex = workspaces.findIndex(w => w.id === wsId);
                const targetIndex = workspaces.findIndex(w => w.id === workspace.id);
                if (sourceIndex !== -1 && targetIndex !== -1) {
                  const nextWorkspaces = [...workspaces];
                  const [removed] = nextWorkspaces.splice(sourceIndex, 1);
                  nextWorkspaces.splice(targetIndex, 0, removed);
                  void reorderWorkspaces(nextWorkspaces.map(w => w.id));
                }
                return;
              }

              const raw = event.dataTransfer.getData("application/x-chat-session-ids");
              if (!raw) {
                return;
              }
              try {
                const sessionIds = JSON.parse(raw) as string[];
                if (sessionIds.length > 0) {
                  void api.chat.moveSessions(sessionIds, workspace.id).then(() => {
                    onSelect(workspace.id);
                  });
                }
              } catch {
                /* ignore malformed data */
              }
            }}
            className={workspaceTabClassName({
              isActive: activeWorkspaceId === workspace.id,
              isDragTarget: dragOverWorkspaceId === workspace.id,
            })}
          >
            {(dragOverWorkspaceId === workspace.id || activeWorkspaceId === workspace.id) && (
              <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-[var(--accent-color)]" />
            )}
            <WorkspaceIcon name={workspace.icon} label={workspace.name} className="h-3.5 w-3.5 opacity-70" />
            {workspace.name}
          </button>
        ))}
      </div>
      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          data-no-drag
          aria-label={paneId ? `More workspaces for ${paneId}` : "More workspaces"}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpen((current) => !current);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] shadow-sm transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
        >
          <ChevronDown size={14} />
        </button>

        {menuOpen && menuStyle
          ? createPortal(
              <div
                ref={menuListRef}
                role="menu"
                data-no-drag
                aria-label={paneId ? `Workspace menu ${paneId}` : "Workspace menu"}
                className="fixed z-[1000] flex flex-col overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1 shadow-xl"
                style={menuStyle}
              >
                {(() => {
                  const roots = allWorkspaces.filter((ws) => ws.parent_workspace_id === null);
                  return roots.map((root) => {
                    const children = allWorkspaces.filter((ws) => ws.parent_workspace_id === root.id);
                    const isRootActive = root.id === activeWorkspaceId;
                    return (
                      <React.Fragment key={root.id}>
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={isRootActive}
                          onClick={() => { onSelect(root.id); setMenuOpen(false); }}
                          className={`flex w-full items-center rounded-lg px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors ${
                            isRootActive
                              ? "text-[var(--accent-color)]"
                              : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                          }`}
                        >
                          <span className="truncate">{root.name}</span>
                        </button>
                        {children.map((child) => {
                          const isActive = child.id === activeWorkspaceId;
                          return (
                            <button
                              key={child.id}
                              type="button"
                              role="menuitemradio"
                              aria-checked={isActive}
                              onClick={() => { onSelect(child.id); setMenuOpen(false); }}
                              className={`flex w-full items-center rounded-lg py-2 pl-6 pr-3 text-left text-sm transition-colors ${
                                isActive
                                  ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                              }`}
                            >
                              <span className="truncate">{child.name}</span>
                            </button>
                          );
                        })}
                      </React.Fragment>
                    );
                  });
                })()}
              </div>,
              document.body
            )
          : null}
      </div>
    </div>
  );
}

export { WorkspaceNavigationTabs };
