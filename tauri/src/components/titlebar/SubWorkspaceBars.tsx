import { Plus } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Workspace } from "../../stores/workspaceStore";
import { Tooltip } from "../Tooltip";
import { onDragRegionMouseDown } from "../WindowControls";
import { WorkspaceIcon } from "../../lib/workspaceIcon";
import { isMac } from "../../lib/platform";
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
  if (!parentWorkspaceId) { return null; }

  return (
    <div
      data-tauri-drag-region
      onMouseDown={onDragRegionMouseDown}
      className={`relative flex items-center h-10 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2 shrink-0 select-none ${isMac ? "pl-[72px]" : ""} ${!isMac ? "pr-[112px]" : ""}`}
    >
      <div
        className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none"
        onWheel={handleHorizontalWheel}
      >
        {/* Pinned overview dot — navigates to the parent (overview) workspace */}
        {parent && (
          <Tooltip content={parent.name} position="bottom">
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
              className={`relative mt-0.5 flex h-[34px] w-8 items-center justify-center self-end rounded-t-lg border border-b-0 transition-all select-none border-r-2 border-r-[var(--accent-color)]/60 ${
                activeWorkspaceId === parent.id
                  ? "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--accent-color)]"
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
            className={`relative mt-0.5 flex h-[34px] items-center gap-1.5 self-end rounded-t-lg border border-b-0 px-3 text-sm font-medium whitespace-nowrap transition-all select-none ${
              activeWorkspaceId === workspace.id
                ? "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                : "border-transparent text-[var(--text-secondary)] opacity-60 hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            }`}
          >
            {activeWorkspaceId === workspace.id && (
              <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-[var(--accent-color)]" />
            )}
            <WorkspaceIcon name={workspace.icon} label={workspace.name} className="h-3.5 w-3.5 opacity-70" />
            {workspace.name}
          </button>
        ))}
        {onAdd && (
          <Tooltip content="New Sub-workspace" position="bottom">
            <button
              data-no-drag
              onClick={onAdd}
              title="New Sub-workspace"
              className="ml-1 h-8 w-8 shrink-0 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
            >
              <Plus size={14} />
            </button>
          </Tooltip>
        )}
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
      className={`relative flex items-center gap-2 h-10 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 shrink-0 select-none ${isMac ? "pl-[72px]" : ""} ${!isMac ? "pr-[112px]" : ""}`}
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
