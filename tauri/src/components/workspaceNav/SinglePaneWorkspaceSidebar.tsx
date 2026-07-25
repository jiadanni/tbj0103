import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { api } from "../../lib/api";
import PromptDialog from "../PromptDialog";
import { SinglePaneWorkspaceSidebar as SinglePaneWorkspaceSidebarChrome } from "../chrome/SinglePaneWorkspaceSidebar";
import { resolveWorkspaceSelection } from "./workspaceNavShared";

function SinglePaneWorkspaceSidebar() {
  const navigate = useNavigate();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const rootWorkspaces = workspaces.filter((ws) => ws.parent_workspace_id === null);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeParentWorkspaceId = useWorkspaceStore((state) => state.activeParentWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);
  const setActiveParentWorkspaceId = useWorkspaceStore((state) => state.setActiveParentWorkspaceId);
  const addWorkspace = useWorkspaceStore((state) => state.addWorkspace);
  const switchWorkspaceSection = useSettingsStore((state) => state.switchWorkspaceSection);
  const [creating, setCreating] = useState(false);
  const [dragOverWorkspaceId, setDragOverWorkspaceId] = useState<string | null>(null);
  const dragHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRootId = activeParentWorkspaceId ?? activeWorkspaceId;

  useEffect(() => () => {
    if (dragHoverTimerRef.current) { clearTimeout(dragHoverTimerRef.current); }
  }, []);

  function selectWorkspace(workspaceId: string) {
    const { workspaceId: nextWorkspaceId, parentWorkspaceId } = resolveWorkspaceSelection(workspaces, workspaceId);
    const isChanged = nextWorkspaceId !== activeWorkspaceId;
    setActiveParentWorkspaceId(parentWorkspaceId);
    setActiveWorkspaceId(nextWorkspaceId);
    if (isChanged && switchWorkspaceSection) { navigate(switchWorkspaceSection); }
  }

  async function handleCreate(name: string) {
    setCreating(false);
    const trimmed = name.trim();
    if (!trimmed) { return; }
    const ws = await api.workspace.create(trimmed, "");
    addWorkspace(ws);
    selectWorkspace(ws.id);
  }

  const items = rootWorkspaces.map((ws) => ({
    id: ws.id,
    name: ws.name,
    isActive: ws.id === activeRootId,
    isDragTarget: dragOverWorkspaceId === ws.id,
    onClick: () => selectWorkspace(ws.id),
    onDragOver: (event: React.DragEvent<HTMLButtonElement>) => {
      if (!event.dataTransfer.types.includes("application/x-chat-session-ids")) { return; }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDragOverWorkspaceId(ws.id);
    },
    onDragEnter: (event: React.DragEvent<HTMLButtonElement>) => {
      if (!event.dataTransfer.types.includes("application/x-chat-session-ids")) { return; }
      event.preventDefault();
      setDragOverWorkspaceId(ws.id);
      if (dragHoverTimerRef.current) { clearTimeout(dragHoverTimerRef.current); }
      dragHoverTimerRef.current = setTimeout(() => selectWorkspace(ws.id), 600);
    },
    onDragLeave: (event: React.DragEvent<HTMLButtonElement>) => {
      const related = event.relatedTarget as Node | null;
      if (related && event.currentTarget.contains(related)) { return; }
      if (dragOverWorkspaceId === ws.id) { setDragOverWorkspaceId(null); }
      if (dragHoverTimerRef.current) {
        clearTimeout(dragHoverTimerRef.current);
        dragHoverTimerRef.current = null;
      }
    },
    onDrop: (event: React.DragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setDragOverWorkspaceId(null);
      if (dragHoverTimerRef.current) {
        clearTimeout(dragHoverTimerRef.current);
        dragHoverTimerRef.current = null;
      }
      const raw = event.dataTransfer.getData("application/x-chat-session-ids");
      if (!raw) { return; }
      try {
        const sessionIds = JSON.parse(raw) as string[];
        if (sessionIds.length > 0) {
          void api.chat.moveSessions(sessionIds, ws.id).then(() => selectWorkspace(ws.id));
        }
      } catch { /* ignore malformed data */ }
    },
  }));

  return (
    <>
      <SinglePaneWorkspaceSidebarChrome
        density="comfortable"
        headerLabel="Workspaces"
        testId="single-pane-workspace-sidebar"
        onCreate={() => setCreating(true)}
        createTooltip="New Workspace"
        items={items}
      />
      {creating && (
        <PromptDialog
          title="Create Workspace"
          placeholder="Workspace name"
          confirmLabel="Create"
          onConfirm={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}
    </>
  );
}

function SinglePaneSubWorkspaceSidebar() {
  const navigate = useNavigate();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeParentWorkspaceId = useWorkspaceStore((state) => state.activeParentWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);
  const setActiveParentWorkspaceId = useWorkspaceStore((state) => state.setActiveParentWorkspaceId);
  const addWorkspace = useWorkspaceStore((state) => state.addWorkspace);
  const switchWorkspaceSection = useSettingsStore((state) => state.switchWorkspaceSection);
  const [creating, setCreating] = useState(false);

  const parent = activeParentWorkspaceId
    ? workspaces.find((ws) => ws.id === activeParentWorkspaceId)
    : null;
  const children = activeParentWorkspaceId
    ? workspaces.filter((ws) => ws.parent_workspace_id === activeParentWorkspaceId)
    : [];

  if (!activeParentWorkspaceId) { return null; }

  function selectWorkspace(workspaceId: string, options?: { allowRoot?: boolean }) {
    const { workspaceId: nextWorkspaceId, parentWorkspaceId } = resolveWorkspaceSelection(workspaces, workspaceId, options);
    const isChanged = nextWorkspaceId !== activeWorkspaceId;
    setActiveParentWorkspaceId(parentWorkspaceId);
    setActiveWorkspaceId(nextWorkspaceId, options);
    if (isChanged && switchWorkspaceSection) { navigate(switchWorkspaceSection); }
  }

  async function handleCreate(name: string) {
    setCreating(false);
    const trimmed = name.trim();
    if (!trimmed || !activeParentWorkspaceId) { return; }
    const ws = await api.workspace.createChild(activeParentWorkspaceId, trimmed);
    addWorkspace(ws);
    selectWorkspace(ws.id);
  }

  return (
    <>
      <SinglePaneWorkspaceSidebarChrome
        density="comfortable"
        headerLabel="Sub-workspaces"
        testId="single-pane-subworkspace-sidebar"
        onCreate={() => setCreating(true)}
        createTooltip="New Sub-workspace"
        overview={
          parent
            ? {
                label: "Overview",
                isActive: activeWorkspaceId === parent.id,
                onClick: () => selectWorkspace(parent.id, { allowRoot: true }),
              }
            : undefined
        }
        items={children.map((ws) => ({
          id: ws.id,
          name: ws.name,
          isActive: ws.id === activeWorkspaceId,
          onClick: () => selectWorkspace(ws.id),
        }))}
      />
      {creating && (
        <PromptDialog
          title="New Sub-workspace"
          description="Enter a name for the new sub-workspace."
          placeholder="Sub-workspace name"
          confirmLabel="Create"
          onConfirm={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}
    </>
  );
}

export { SinglePaneWorkspaceSidebar, SinglePaneSubWorkspaceSidebar };
