import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { PaneId } from "../../stores/workspaceStore";
import { CompactMenuSelect } from "../CompactMenuSelect";
import { WorkspaceNavDropdownSelect } from "../chrome/WorkspaceNavDropdownSelect";
import { WorkspaceNavigationTabs } from "../workspaceNav/WorkspaceNavigationTabs";
import {
  getWorkspaceOptionLabel,
  buildWorkspaceGroups,
  resolvePaneWorkspaceSelection,
  resolveSplitWorkspaceNavigation,
} from "../workspaceNav/workspaceNavShared";
import { isMac, isLinux, isWindows } from "../../lib/platform";

function SplitTitlebarWorkspaceTabs({ paneId }: { paneId: PaneId }) {
  const allWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const rootWorkspaces = allWorkspaces.filter((ws) => ws.parent_workspace_id === null);
  const paneWorkspaceId = useWorkspaceStore((s) => s.panes[paneId].workspaceId);
  const setPaneWorkspace = useWorkspaceStore((s) => s.setPaneWorkspace);
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId);
  const activeWorkspaceId = paneWorkspaceId ?? "";

  function selectWorkspace(workspaceId: string) {
    setActivePaneId(paneId);
    setPaneWorkspace(paneId, resolvePaneWorkspaceSelection(allWorkspaces, workspaceId));
  }

  return (
    <WorkspaceNavigationTabs
      workspaces={rootWorkspaces}
      activeWorkspaceId={activeWorkspaceId}
      onSelect={selectWorkspace}
      paneId={paneId}
    />
  );
}

function SplitTitlebarWorkspaceDropdown({ paneId }: { paneId: PaneId }) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const paneWorkspaceId = useWorkspaceStore((s) => s.panes[paneId].workspaceId);
  const setPaneWorkspace = useWorkspaceStore((s) => s.setPaneWorkspace);
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId);
  const workspaceOptions = workspaces.map((workspace) => ({ value: workspace.id, label: getWorkspaceOptionLabel(workspace, workspaces) }));
  const workspaceGroups = buildWorkspaceGroups(workspaces);
  const selectedWorkspaceId = workspaceOptions.some((workspace) => workspace.value === paneWorkspaceId)
    ? paneWorkspaceId ?? workspaceOptions[0]?.value ?? ""
    : workspaceOptions[0]?.value ?? "";

  return (
    <CompactMenuSelect
      label={`Workspace ${paneId}`}
      value={selectedWorkspaceId}
      options={workspaceOptions}
      groups={workspaceGroups}
      onChange={(value) => {
        setActivePaneId(paneId);
        setPaneWorkspace(paneId, resolvePaneWorkspaceSelection(workspaces, value));
      }}
      widthClassName="w-full min-w-0"
      buttonClassName="h-8 bg-[var(--bg-primary)]"
    />
  );
}

function SingleTitlebarWorkspaceDropdown({
  activeWorkspaceId,
  onChange,
}: {
  activeWorkspaceId: string | null;
  onChange: (workspaceId: string) => void;
}) {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const workspaceOptions = workspaces.map((workspace) => ({
    value: workspace.id,
    label: getWorkspaceOptionLabel(workspace, workspaces),
  }));
  const workspaceGroups = buildWorkspaceGroups(workspaces);
  const selectedWorkspaceId = workspaceOptions.some((workspace) => workspace.value === activeWorkspaceId)
    ? activeWorkspaceId ?? workspaceOptions[0]?.value ?? ""
    : workspaceOptions[0]?.value ?? "";

  return (
    <WorkspaceNavDropdownSelect
      density="comfortable"
      label="Workspace"
      value={selectedWorkspaceId}
      options={workspaceOptions}
      groups={workspaceGroups}
      onChange={onChange}
    />
  );
}

function SplitTitlebarWorkspaceNavigation() {
  const splitSizes = useWorkspaceStore((s) => s.splitSizes);
  const workspaceNavigation = useWorkspaceStore((s) => s.workspaceNavigation);
  const splitWorkspaceNavigation = useWorkspaceStore((s) => s.splitWorkspaceNavigation);
  const resolvedSplitWorkspaceNavigation = resolveSplitWorkspaceNavigation(
    workspaceNavigation,
    splitWorkspaceNavigation,
  );
  const hasCustomWindowControls = isLinux || isWindows;
  const primaryPanePaddingClass = (isLinux ? "pl-[52px]" : isMac ? "pl-[80px]" : "pl-2") + " pr-2";
  const secondaryPaneTrailingInset = hasCustomWindowControls ? "pr-[192px]" : "pr-24";
  const secondaryPaneClass = "min-w-0 pl-2 " + secondaryPaneTrailingInset;

  return (
    <div
      className="absolute inset-y-0 left-0 right-0 z-0 flex items-center"
      data-split-titlebar-workspace-nav
    >
      <div className="min-w-0" style={{ flexBasis: 0, flexGrow: splitSizes[0] }}>
        <div className={primaryPanePaddingClass}>
          {resolvedSplitWorkspaceNavigation === "dropdown" ? (
            <SplitTitlebarWorkspaceDropdown paneId="primary" />
          ) : (
            <SplitTitlebarWorkspaceTabs paneId="primary" />
          )}
        </div>
      </div>
      <div className="relative z-20 h-10 w-px shrink-0 bg-[var(--border-color)]" aria-hidden="true" />
      <div className="min-w-0" style={{ flexBasis: 0, flexGrow: splitSizes[1] }}>
        <div className={secondaryPaneClass}>
          {resolvedSplitWorkspaceNavigation === "dropdown" ? (
            <SplitTitlebarWorkspaceDropdown paneId="secondary" />
          ) : (
            <SplitTitlebarWorkspaceTabs paneId="secondary" />
          )}
        </div>
      </div>
    </div>
  );
}

export {
  SplitTitlebarWorkspaceTabs,
  SplitTitlebarWorkspaceDropdown,
  SingleTitlebarWorkspaceDropdown,
  SplitTitlebarWorkspaceNavigation,
};
