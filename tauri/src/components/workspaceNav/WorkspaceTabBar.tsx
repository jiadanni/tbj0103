import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { message } from "@tauri-apps/plugin-dialog";
import {
  Columns2,
  ExternalLink,
  Pencil,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Workspace } from "../../stores/workspaceStore";
import { api } from "../../lib/api";
import { inferWorkspaceIconName } from "../../lib/workspaceIconRules";
import { isMac } from "../../lib/platform";
import { Tooltip } from "../Tooltip";
import AppHeaderMenu from "../AppHeaderMenu";
import WindowControls, { onDragRegionMouseDown, onDragRegionDoubleClick } from "../WindowControls";
import ConfirmDialog from "../ConfirmDialog";
import PromptDialog from "../PromptDialog";
import { WorkspaceNavigationTabs } from "./WorkspaceNavigationTabs";
import { SectionDropdownSelect } from "./SectionNavigation";
import {
  SplitTitlebarWorkspaceNavigation,
  SingleTitlebarWorkspaceDropdown,
} from "../titlebar/TitlebarWorkspaceNav";
import {
  SubWorkspaceTabBar,
  SubWorkspaceDropdownSelect,
  SubWorkspaceDropdownBar,
} from "../titlebar/SubWorkspaceBars";
import { BackForwardNavigation } from "../titlebar/BackForwardNavigation";
import { TitlebarSortMenu } from "../titlebar/TitlebarSortMenu";
import { TitlebarHistoryMenu } from "../titlebar/TitlebarHistoryMenu";
import SchedulerPauseButton from "../titlebar/SchedulerPauseButton";
import {
  WORKSPACE_ICON_OPTIONS,
  resolveWorkspaceSelection,
  resolveSplitWorkspaceNavigation,
  handleHorizontalWheel,
} from "./workspaceNavShared";
import type { WorkspaceDialogState } from "./workspaceNavShared";

function WorkspaceTabBar({
  onToggleSplit,
  showWorkspaceTabs = true,
}: {
  onToggleSplit: () => void;
  showWorkspaceTabs?: boolean;
}) {
  const location = useLocation();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const rootWorkspaces = workspaces.filter((ws) => ws.parent_workspace_id === null);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeParentWorkspaceId = useWorkspaceStore((state) => state.activeParentWorkspaceId);
  const setActiveParentWorkspaceId = useWorkspaceStore((state) => state.setActiveParentWorkspaceId);
  const splitMode = useWorkspaceStore((state) => state.splitMode);
  const workspaceNavigation = useWorkspaceStore((state) => state.workspaceNavigation);
  const splitWorkspaceNavigation = useWorkspaceStore((state) => state.splitWorkspaceNavigation);
  const subWorkspaceNavigation = useWorkspaceStore((state) => state.subWorkspaceNavigation);
  const sectionNavigation = useWorkspaceStore((state) => state.sectionNavigation);
  const combineWorkspaceDropdown = useWorkspaceStore((state) => state.combineWorkspaceDropdown);
  const combineSubWorkspaceDropdown = useWorkspaceStore((state) => state.combineSubWorkspaceDropdown);
  const combineSectionDropdown = useWorkspaceStore((state) => state.combineSectionDropdown);
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);
  const addWorkspace = useWorkspaceStore((state) => state.addWorkspace);
  const setWorkspaces = useWorkspaceStore((state) => state.setWorkspaces);
  const isDemoMode = useWorkspaceStore((state) => state.isDemoMode);
  const switchWorkspaceSection = useSettingsStore((state) => state.switchWorkspaceSection);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [contextMenu, setContextMenu] = useState<{ workspace: Workspace; x: number; y: number } | null>(null);
  const [dialogState, setDialogState] = useState<WorkspaceDialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [promptDialog, setPromptDialog] = useState<{ kind: "create-sub" | "rename"; workspace?: Workspace } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const splitUnsupportedRoute = ["/preferences"].some((path) => location.pathname.startsWith(path));
  const resolvedSplitWorkspaceNavigation = resolveSplitWorkspaceNavigation(
    workspaceNavigation,
    splitWorkspaceNavigation,
  );
  const showSplitTitlebarWorkspaceNavigation = splitMode && !splitUnsupportedRoute && resolvedSplitWorkspaceNavigation !== "sidebar";
  const showSinglePaneWorkspaceDropdown = !showSplitTitlebarWorkspaceNavigation && showWorkspaceTabs && workspaceNavigation === "top-dropdown";
  const showSinglePaneWorkspaceSidebar = !showSplitTitlebarWorkspaceNavigation && showWorkspaceTabs && workspaceNavigation === "sidebar";
  const showSplitToggle = !splitUnsupportedRoute || splitMode;
  function resetCreateWorkspaceForm() {
    setNewName("");
    setNewDescription("");
    setCreating(false);
  }

  function activateWorkspace(workspaceId: string, { allowRoot = false }: { allowRoot?: boolean } = {}) {
    const { workspaceId: nextWorkspaceId, parentWorkspaceId } = resolveWorkspaceSelection(workspaces, workspaceId, { allowRoot });
    const isChanged = nextWorkspaceId !== activeWorkspaceId;
    setActiveParentWorkspaceId(parentWorkspaceId);
    setActiveWorkspaceId(nextWorkspaceId, { allowRoot });
    if (isChanged && switchWorkspaceSection) { navigate(switchWorkspaceSection); }
    setContextMenu(null);
  }

  function activateSubWorkspace(workspaceId: string) {
    activateWorkspace(workspaceId);
  }

  function activateOverviewWorkspace(workspaceId: string) {
    activateWorkspace(workspaceId, { allowRoot: true });
  }

  function createSubWorkspace() {
    if (!activeParentWorkspaceId) { return; }
    setPromptDialog({ kind: "create-sub" });
  }

  async function handleCreateSubWorkspace(name: string) {
    if (!activeParentWorkspaceId) { return; }
    setPromptDialog(null);
    const ws = await api.workspace.createChild(activeParentWorkspaceId, name);
    addWorkspace(ws);
    activateSubWorkspace(ws.id);
    void api.workspace.generateIcon(ws.id).catch(() => {});
  }

  async function createWorkspace() {
    if (!newName.trim()) { return; }
    const trimmedDescription = newDescription.trim();
    const ws = await api.workspace.create(newName.trim(), trimmedDescription || undefined);
    addWorkspace(ws);
    activateWorkspace(ws.id);
    resetCreateWorkspaceForm();
    void api.workspace.generateIcon(ws.id).catch(() => {});
  }

  function renameWorkspace(workspace: Workspace) {
    setContextMenu(null);
    setPromptDialog({ kind: "rename", workspace });
  }

  async function handleRenameWorkspace(workspace: Workspace, nextName: string) {
    if (nextName === workspace.name) {
      setPromptDialog(null);
      return;
    }
    setPromptDialog(null);
    await api.workspace.update(workspace.id, nextName, workspace.description, workspace.prompt_instructions);
    setWorkspaces(workspaces.map((item) => item.id === workspace.id ? { ...item, name: nextName } : item));
  }

  async function performDeleteWorkspace(workspace: Workspace) {
    if (isDemoMode) {
      await message("Workspace deletion is not available in Demo Mode.", { title: "Demo Mode" });
      return;
    }
    await api.workspace.delete(workspace.id);
    const remaining = await api.workspace.list();
    setWorkspaces(remaining);
    setContextMenu(null);
  }

  function deleteWorkspace(workspace: Workspace) {
    setContextMenu(null);
    if (workspaces.length === 1) {
      setDialogState({ kind: "last-workspace" });
      return;
    }
    setDialogState({ kind: "delete", workspace });
  }

  async function updateWorkspaceIcon(workspace: Workspace, icon: string) {
    setContextMenu(null);
    setWorkspaces(workspaces.map((item) => item.id === workspace.id ? { ...item, icon } : item));
    try {
      await api.workspace.updateIcon(workspace.id, icon);
    } catch {
      const current = await api.workspace.list();
      setWorkspaces(current);
    }
  }

  useEffect(() => {
    if (!contextMenu) {return;}

    function handlePointerDown(event: MouseEvent) {
      if (contextMenuRef.current?.contains(event.target as Node)) {return;}
      setContextMenu(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("contextmenu", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("blur", () => setContextMenu(null), { once: true });

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("contextmenu", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) {return;}
    const el = contextMenuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = contextMenu.x;
    let y = contextMenu.y;
    if (rect.right > window.innerWidth - pad) { x = window.innerWidth - rect.width - pad; }
    if (rect.bottom > window.innerHeight - pad) { y = window.innerHeight - rect.height - pad; }
    if (x < pad) { x = pad; }
    if (y < pad) { y = pad; }
    if (x !== contextMenu.x || y !== contextMenu.y) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }, [contextMenu]);

  // Combined titlebar breadcrumb: each axis joins only when it is in top-dropdown
  // mode AND its combine switch is on (and, for sub-workspaces, an active parent
  // exists). Axes that are dropdown but not combined keep their standalone bar.
  const singlePaneNav = !showSplitTitlebarWorkspaceNavigation && showWorkspaceTabs;
  const workspaceCrumbCombined = showSinglePaneWorkspaceDropdown && combineWorkspaceDropdown;
  const subWorkspaceCrumbCombined = singlePaneNav && subWorkspaceNavigation === "top-dropdown" && combineSubWorkspaceDropdown && !!activeParentWorkspaceId;
  const sectionCrumbCombined = singlePaneNav && sectionNavigation === "top-dropdown" && combineSectionDropdown;
  const combinedCrumbs: { key: string; node: React.ReactNode }[] = [];
  if (workspaceCrumbCombined) {
    combinedCrumbs.push({ key: "workspace", node: (
      <SingleTitlebarWorkspaceDropdown activeWorkspaceId={activeWorkspaceId} onChange={activateWorkspace} />
    ) });
  }
  if (subWorkspaceCrumbCombined) {
    combinedCrumbs.push({ key: "sub-workspace", node: (
      <SubWorkspaceDropdownSelect
        parentWorkspaceId={activeParentWorkspaceId}
        activeWorkspaceId={activeWorkspaceId}
        onSelect={activateSubWorkspace}
        onSelectOverview={activateOverviewWorkspace}
      />
    ) });
  }
  if (sectionCrumbCombined) {
    combinedCrumbs.push({ key: "section", node: <SectionDropdownSelect /> });
  }
  const combinedBreadcrumbNode = combinedCrumbs.length > 0 ? (
    <div data-no-drag className="flex min-w-0 items-center gap-1.5">
      {combinedCrumbs.map((crumb, index) => (
        <React.Fragment key={crumb.key}>
          {index > 0 && <span className="shrink-0 select-none text-[var(--text-muted)] opacity-60">/</span>}
          <div className="min-w-0">{crumb.node}</div>
        </React.Fragment>
      ))}
    </div>
  ) : null;

  return (
    <div className="relative z-20">
      <div
        data-tauri-drag-region
        onMouseDown={onDragRegionMouseDown}
        onDoubleClick={onDragRegionDoubleClick}
        className={`relative flex items-center h-10 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2 shrink-0 select-none ${isMac ? "pl-[72px]" : ""} ${!isMac ? "pr-[112px]" : ""}`}
      >
        {showSplitTitlebarWorkspaceNavigation && <SplitTitlebarWorkspaceNavigation />}
        {!isMac && <div className="relative z-10"><AppHeaderMenu /></div>}
        <div
          onWheel={handleHorizontalWheel}
          className={
            showSplitTitlebarWorkspaceNavigation
              ? "relative z-0 min-w-0 flex-1"
              : showSinglePaneWorkspaceDropdown
              ? "min-w-0 flex-1"
              : showSinglePaneWorkspaceSidebar
              ? "min-w-0 flex-1"
              : "min-w-0 flex-1 overflow-visible"
          }
          {...(showWorkspaceTabs && !showSplitTitlebarWorkspaceNavigation && !showSinglePaneWorkspaceDropdown && !showSinglePaneWorkspaceSidebar ? { "data-workspace-tab-strip": "", "data-no-drag": "" } : {})}
        >
          {showSinglePaneWorkspaceDropdown ? (
            <div className="flex h-10 items-center gap-1.5">
              {/* When the workspace dropdown is combined it appears as the first
                  breadcrumb crumb; otherwise it renders standalone, with any
                  combined sub/section crumbs appended after it. */}
              {!combineWorkspaceDropdown && (
                <SingleTitlebarWorkspaceDropdown
                  activeWorkspaceId={activeWorkspaceId}
                  onChange={activateWorkspace}
                />
              )}
              {combinedBreadcrumbNode}
            </div>
          ) : showSinglePaneWorkspaceSidebar ? (
            // Workspace switching lives in the left sidebar; keep the titlebar slot
            // empty for window dragging unless combined sub/section crumbs need it.
            combinedBreadcrumbNode ? (
              <div className="flex h-10 items-center">{combinedBreadcrumbNode}</div>
            ) : (
              <div className="h-10" />
            )
          ) : (
            <div className={`${showSplitTitlebarWorkspaceNavigation ? "hidden" : "flex min-w-0 flex-1 items-center"}`}>
              {!showSplitTitlebarWorkspaceNavigation && showWorkspaceTabs ? (
                <WorkspaceNavigationTabs
                  workspaces={rootWorkspaces}
                  activeWorkspaceId={activeParentWorkspaceId ?? activeWorkspaceId}
                  onSelect={activateWorkspace}
                  onContextMenu={(ws, x, y) => setContextMenu({ workspace: ws, x, y })}
                />
              ) : null}
              {showWorkspaceTabs ? (
                <Tooltip content="New Workspace" position="bottom">
                  <button
                    onClick={() => setCreating(true)}
                    className="ml-1 w-9 h-10 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
                  >
                    <Plus size={20} />
                  </button>
                </Tooltip>
              ) : null}
              {combinedBreadcrumbNode}
            </div>
          )}
        </div>
        <div
          data-window-drag-handle
          className="mx-2 hidden h-5 shrink-0 sm:block w-16"
        />
        <div className="relative z-10 ml-2 flex shrink-0 items-center gap-1" data-workspace-titlebar-actions>
          <BackForwardNavigation />
          <TitlebarSortMenu />
          <TitlebarHistoryMenu />
          <SchedulerPauseButton />
          {!showSplitTitlebarWorkspaceNavigation && !splitUnsupportedRoute && (
            <Tooltip content="Preferences" position="bottom">
              <button
                onClick={() => navigate("/preferences")}
                title="Preferences"
                aria-label="Preferences"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
              >
                <SettingsIcon size={15} />
              </button>
            </Tooltip>
          )}
          {showSplitToggle && (
            <Tooltip content="Toggle Split View" position="bottom">
              <button
                onClick={onToggleSplit}
                disabled={workspaces.length < 2}
                title="Toggle Split View"
                aria-label="Toggle Split View"
                className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
                  splitMode
                    ? "border-[var(--accent-color)] bg-[var(--accent-color)] text-white"
                    : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
                } disabled:opacity-40 disabled:hover:border-[var(--border-color)] disabled:hover:text-[var(--text-secondary)]`}
              >
                <Columns2 size={15} />
              </button>
            </Tooltip>
          )}
        </div>
        {!isMac && (
          <div className="absolute inset-y-0 right-2 z-10 flex items-center" data-workspace-window-controls>
            <WindowControls />
          </div>
        )}
      </div>
      {/* Row 2: Sub-workspace navigation for the active parent workspace. The
          sidebar presentation renders as a left rail in the body instead. */}
      {!showSplitTitlebarWorkspaceNavigation && showWorkspaceTabs && subWorkspaceNavigation === "top-tabs" && (
        <SubWorkspaceTabBar
          parentWorkspaceId={activeParentWorkspaceId}
          activeWorkspaceId={activeWorkspaceId}
          onSelect={activateSubWorkspace}
          onSelectOverview={activateOverviewWorkspace}
          onAdd={createSubWorkspace}
          onContextMenu={(ws, x, y) => setContextMenu({ workspace: ws, x, y })}
        />
      )}
      {!showSplitTitlebarWorkspaceNavigation && showWorkspaceTabs && subWorkspaceNavigation === "top-dropdown" && !combineSubWorkspaceDropdown && (
        <SubWorkspaceDropdownBar
          parentWorkspaceId={activeParentWorkspaceId}
          activeWorkspaceId={activeWorkspaceId}
          onSelect={activateSubWorkspace}
          onSelectOverview={activateOverviewWorkspace}
          onAdd={createSubWorkspace}
        />
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          data-workspace-context-menu
          className="fixed z-50 min-w-[190px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              activateWorkspace(contextMenu.workspace.id);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <ExternalLink size={11} /> Open {contextMenu.workspace.parent_workspace_id ? "sub-workspace" : "workspace"}
          </button>
          <button
            onClick={() => {
              void renameWorkspace(contextMenu.workspace);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <Pencil size={11} /> Rename {contextMenu.workspace.parent_workspace_id ? "sub-workspace" : "workspace"}
          </button>
          <div className="my-1 border-t border-[var(--border-color)]" />
          <div className="px-3 py-1.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Icon</span>
              <button
                type="button"
                onClick={() => {
                  void updateWorkspaceIcon(contextMenu.workspace, inferWorkspaceIconName(contextMenu.workspace.name));
                }}
                title="Auto-pick icon"
                aria-label="Auto-pick workspace icon"
                className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <WandSparkles size={12} />
              </button>
            </div>
            <div className="grid grid-cols-5 gap-1">
              {WORKSPACE_ICON_OPTIONS.map(({ name, label, Icon }) => {
                const isSelected = contextMenu.workspace.icon === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      void updateWorkspaceIcon(contextMenu.workspace, name);
                    }}
                    title={label}
                    aria-label={`Set workspace icon to ${label}`}
                    aria-pressed={isSelected}
                    className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                      isSelected
                        ? "bg-[rgba(var(--accent-color-rgb),0.18)] text-[var(--accent-color)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Icon size={13} />
                  </button>
                );
              })}
            </div>
          </div>
          <button
            onClick={() => {
              navigate("/preferences", { state: { settingsTab: "workspaces" } });
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <SettingsIcon size={11} /> Manage workspaces
          </button>
          <div className="my-1 border-t border-[var(--border-color)]" />
          <button
            onClick={() => {
              void deleteWorkspace(contextMenu.workspace);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-[var(--bg-hover)]"
          >
            <Trash2 size={11} /> Delete {contextMenu.workspace.parent_workspace_id ? "sub-workspace" : "workspace"}
          </button>
        </div>
      )}
      {dialogState && (
        <ConfirmDialog
          title={dialogState.kind === "delete" ? (dialogState.workspace.parent_workspace_id ? "Confirm Sub-workspace Deletion" : "Confirm Deletion") : "Cannot Delete Workspace"}
          description={
            dialogState.kind === "delete"
              ? `Delete "${dialogState.workspace.name}" and all its projects, notes, and data? This cannot be undone.`
              : "You need at least one workspace in Aetherium."
          }
          confirmLabel={dialogState.kind === "delete" ? "Delete Workspace" : "OK"}
          cancelLabel={dialogState.kind === "delete" ? "Cancel" : null}
          tone={dialogState.kind === "delete" ? "danger" : "default"}
          busy={dialogBusy}
          onCancel={() => {
            if (!dialogBusy) {
              setDialogState(null);
            }
          }}
          onConfirm={async () => {
            if (dialogBusy) {return;}
            if (dialogState.kind !== "delete") {
              setDialogState(null);
              return;
            }

            setDialogBusy(true);
            try {
              await performDeleteWorkspace(dialogState.workspace);
              setDialogState(null);
            } finally {
              setDialogBusy(false);
            }
          }}
        />
      )}
      {promptDialog && (
        <PromptDialog
          title={promptDialog.kind === "create-sub" ? "New Sub-workspace" : (promptDialog.workspace?.parent_workspace_id ? "Rename Sub-workspace" : "Rename Workspace")}
          description={promptDialog.kind === "create-sub" ? "Enter a name for the new sub-workspace." : undefined}
          defaultValue={promptDialog.kind === "rename" && promptDialog.workspace ? promptDialog.workspace.name : ""}
          placeholder={promptDialog.kind === "create-sub" || promptDialog.workspace?.parent_workspace_id ? "Sub-workspace name" : "Workspace name"}
          confirmLabel={promptDialog.kind === "create-sub" ? "Create" : "Rename"}
          onCancel={() => setPromptDialog(null)}
          onConfirm={(value) => {
            if (promptDialog.kind === "create-sub") {
              handleCreateSubWorkspace(value);
            } else if (promptDialog.kind === "rename" && promptDialog.workspace) {
              handleRenameWorkspace(promptDialog.workspace, value);
            }
          }}
        />
      )}
      {creating && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => { resetCreateWorkspaceForm(); }}
        >
          <div
            className="mx-4 flex w-full max-w-sm flex-col gap-5 rounded-3xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">New Workspace</div>
              <h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">Name your workspace</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Add an optional description to capture what this workspace is for.</p>
            </div>
            <div className="flex flex-col gap-3">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { void createWorkspace(); }
                  if (e.key === "Escape") { resetCreateWorkspaceForm(); }
                }}
                placeholder="e.g. Python deep dive"
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
              />
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { resetCreateWorkspaceForm(); }
                }}
                placeholder="Optional description"
                rows={3}
                className="resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { resetCreateWorkspaceForm(); }}
                className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={() => { void createWorkspace(); }}
                disabled={!newName.trim()}
                className="rounded-xl bg-[var(--accent-color)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { WorkspaceTabBar };
