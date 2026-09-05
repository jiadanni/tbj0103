/* eslint-disable react-refresh/only-export-components */
import type React from "react";
import {
  BookOpen,
  Code,
  Container,
  Database,
  Folder,
  GitBranch,
  HeartPulse,
  Music,
  Palette,
  Plug,
  Rocket,
  ShieldCheck,
  Sparkles,
  Terminal,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Workspace } from "../../stores/workspaceStore";

type WorkspaceDialogState =
  | { kind: "last-workspace" }
  | { kind: "delete"; workspace: Workspace };

const WORKSPACE_ICON_OPTIONS: { name: string; label: string; Icon: LucideIcon }[] = [
  { name: "folder", label: "Folder", Icon: Folder },
  { name: "code", label: "Code", Icon: Code },
  { name: "palette", label: "Design", Icon: Palette },
  { name: "heart-pulse", label: "Health", Icon: HeartPulse },
  { name: "book-open", label: "Study", Icon: BookOpen },
  { name: "sparkles", label: "AI", Icon: Sparkles },
  { name: "music", label: "Music", Icon: Music },
  { name: "plug", label: "Integrate", Icon: Plug },
  { name: "user", label: "Person", Icon: User },
  { name: "terminal", label: "Terminal", Icon: Terminal },
  { name: "git-branch", label: "Git", Icon: GitBranch },
  { name: "database", label: "Database", Icon: Database },
  { name: "shield-check", label: "Security", Icon: ShieldCheck },
  { name: "container", label: "Container", Icon: Container },
  { name: "rocket", label: "Productivity", Icon: Rocket },
];

function getWorkspaceOptionLabel(workspace: Workspace, workspaces: Workspace[]) {
  if (!workspace.parent_workspace_id) {
    return workspace.name;
  }

  const parentWorkspace = workspaces.find((item) => item.id === workspace.parent_workspace_id);
  return parentWorkspace ? `${parentWorkspace.name} / ${workspace.name}` : workspace.name;
}

function resolveWorkspaceSelection(
  workspaces: Workspace[],
  workspaceId: string | null,
  { allowRoot = false }: { allowRoot?: boolean } = {},
) {
  if (!workspaceId) {
    return { workspaceId: null, parentWorkspaceId: null };
  }

  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    return { workspaceId, parentWorkspaceId: workspaceId };
  }

  if (workspace.parent_workspace_id) {
    return {
      workspaceId: workspace.id,
      parentWorkspaceId: workspace.parent_workspace_id,
    };
  }

  // Root workspace: resolve to first child unless the caller explicitly wants the root (overview)
  if (!allowRoot) {
    const firstChild = workspaces.find((w) => w.parent_workspace_id === workspace.id);
    if (firstChild) {
      return {
        workspaceId: firstChild.id,
        parentWorkspaceId: workspace.id,
      };
    }
  }

  return {
    workspaceId: workspace.id,
    parentWorkspaceId: workspace.id,
  };
}

function resolvePaneWorkspaceSelection(workspaces: Workspace[], workspaceId: string | null) {
  return resolveWorkspaceSelection(workspaces, workspaceId).workspaceId;
}

function handleHorizontalWheel(event: React.WheelEvent<HTMLDivElement>) {
  const element = event.currentTarget;
  if (element.scrollWidth <= element.clientWidth) {return;}
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {return;}
  element.scrollLeft += event.deltaY;
  event.preventDefault();
}

function resolveSplitWorkspaceNavigation(
  workspaceNavigation: ReturnType<typeof useWorkspaceStore.getState>["workspaceNavigation"],
  splitWorkspaceNavigation: ReturnType<typeof useWorkspaceStore.getState>["splitWorkspaceNavigation"] = "match-main"
): "sidebar" | "tabs" | "dropdown" {
  if (splitWorkspaceNavigation === "dropdown") { return "dropdown"; }
  if (splitWorkspaceNavigation === "tabs") { return "tabs"; }
  if (workspaceNavigation === "top-dropdown") { return "dropdown"; }
  if (workspaceNavigation === "sidebar") { return "sidebar"; }
  return "tabs";
}

function workspaceTabClassName({
  isActive,
  isDragTarget = false,
}: {
  isActive: boolean;
  isDragTarget?: boolean;
}) {
  // h-full + self-end so the tab meets the titlebar's bottom border, the way a
  // browser tab does. A fixed height with `mt-1` inside an `items-center` strip
  // left the tabs sitting a few px below the chevron/+/action buttons.
  return `relative flex h-[34px] items-center gap-1.5 self-end rounded-t-xl border border-b-0 px-3.5 text-sm font-medium whitespace-nowrap transition-all select-none ${
    isDragTarget
      ? "border-[rgba(var(--accent-color-rgb),0.45)] bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)] shadow-sm"
      : isActive
      ? "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_-10px_25px_-20px_rgba(15,23,42,0.55)]"
      : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
  }`;
}

function buildWorkspaceGroups(workspaces: Workspace[]) {
  const roots = workspaces.filter((ws) => ws.parent_workspace_id === null);
  return roots.map((root) => ({
    label: root.name,
    value: root.id,
    options: workspaces
      .filter((ws) => ws.parent_workspace_id === root.id)
      .map((ws) => ({ value: ws.id, label: ws.name })),
  }));
}

export {
  WORKSPACE_ICON_OPTIONS,
  getWorkspaceOptionLabel,
  resolveWorkspaceSelection,
  resolvePaneWorkspaceSelection,
  handleHorizontalWheel,
  resolveSplitWorkspaceNavigation,
  workspaceTabClassName,
  buildWorkspaceGroups,
};
export type { WorkspaceDialogState };
