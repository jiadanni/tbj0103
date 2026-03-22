import React, { createContext, useContext, useMemo } from "react";
import { useChatStore } from "../stores/chatStore";
import {
  type PaneId,
  type PaneView,
  useWorkspaceStore,
  type NoteSelectionState,
} from "../stores/workspaceStore";

interface WorkspacePaneContextValue {
  paneId: PaneId;
}

const WorkspacePaneContext = createContext<WorkspacePaneContextValue | null>(null);

export function WorkspacePaneProvider({
  paneId,
  children,
}: React.PropsWithChildren<{ paneId: PaneId }>) {
  const value = useMemo(() => ({ paneId }), [paneId]);
  return <WorkspacePaneContext.Provider value={value}>{children}</WorkspacePaneContext.Provider>;
}

export function useWorkspacePane() {
  return useContext(WorkspacePaneContext);
}

export function useScopedWorkspace() {
  const pane = useWorkspacePane();
  const store = useWorkspaceStore();

  if (!pane) {
    return {
      paneId: null,
      activeWorkspaceId: store.activeWorkspaceId,
      activeProjectId: store.activeProjectId,
      activeView: "chat" as PaneView,
      noteSelection: null as NoteSelectionState | null,
      setActiveWorkspaceId: store.setActiveWorkspaceId,
      setActiveProjectId: store.setActiveProjectId,
      setActiveView: (_view: PaneView) => undefined,
      setNoteSelection: (_selection: NoteSelectionState | null) => undefined,
      setPaneFocus: () => undefined,
      isSplitPane: false,
    };
  }

  const paneState = store.panes[pane.paneId];
  return {
    paneId: pane.paneId,
    activeWorkspaceId: paneState.workspaceId,
    activeProjectId: paneState.projectId,
    activeView: paneState.view,
    noteSelection: paneState.noteSelection,
    setActiveWorkspaceId: (workspaceId: string | null) => store.setPaneWorkspace(pane.paneId, workspaceId),
    setActiveProjectId: (projectId: string | null) => store.setPaneProject(pane.paneId, projectId),
    setActiveView: (view: PaneView) => store.setPaneView(pane.paneId, view),
    setNoteSelection: (selection: NoteSelectionState | null) => store.setPaneNoteSelection(pane.paneId, selection),
    setPaneFocus: () => store.setActivePaneId(pane.paneId),
    isSplitPane: true,
  };
}

export function useScopedChat() {
  const pane = useWorkspacePane();
  const chatStore = useChatStore();
  const workspaceStore = useWorkspaceStore();

  if (!pane) {
    return {
      activeChatId: chatStore.activeChatId,
      setActiveChatId: chatStore.setActiveChatId,
      isSplitPane: false,
    };
  }

  return {
    activeChatId: workspaceStore.panes[pane.paneId].chatSessionId,
    setActiveChatId: (chatSessionId: string | null) => workspaceStore.setPaneChatSession(pane.paneId, chatSessionId),
    isSplitPane: true,
  };
}

export function useScopedProjects() {
  const pane = useWorkspacePane();
  const store = useWorkspaceStore();

  if (!pane) {
    return store.projects;
  }

  const workspaceId = store.panes[pane.paneId].workspaceId;
  return workspaceId ? (store.projectsByWorkspace[workspaceId] ?? []) : [];
}
