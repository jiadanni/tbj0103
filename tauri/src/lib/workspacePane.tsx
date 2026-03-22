import React, { createContext, useCallback, useContext, useMemo } from "react";
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

const NOOP_SET_VIEW = (_view: PaneView) => undefined;
const NOOP_SET_NOTE = (_selection: NoteSelectionState | null) => undefined;
const NOOP_FOCUS = () => undefined;

export function useScopedWorkspace() {
  const pane = useWorkspacePane();
  const store = useWorkspaceStore();
  const paneId = pane?.paneId ?? null;

  const setActiveWorkspaceId = useCallback(
    (workspaceId: string | null) => {
      if (paneId) { useWorkspaceStore.getState().setPaneWorkspace(paneId, workspaceId); }
      else { useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId); }
    },
    [paneId],
  );

  const setActiveProjectId = useCallback(
    (projectId: string | null) => {
      if (paneId) { useWorkspaceStore.getState().setPaneProject(paneId, projectId); }
      else { useWorkspaceStore.getState().setActiveProjectId(projectId); }
    },
    [paneId],
  );

  const setActiveView = useCallback(
    (view: PaneView) => {
      if (paneId) { useWorkspaceStore.getState().setPaneView(paneId, view); }
    },
    [paneId],
  );

  const setNoteSelection = useCallback(
    (selection: NoteSelectionState | null) => {
      if (paneId) { useWorkspaceStore.getState().setPaneNoteSelection(paneId, selection); }
    },
    [paneId],
  );

  const setPaneFocus = useCallback(
    () => {
      if (paneId) { useWorkspaceStore.getState().setActivePaneId(paneId); }
    },
    [paneId],
  );

  if (!pane) {
    return {
      paneId: null,
      activeWorkspaceId: store.activeWorkspaceId,
      activeProjectId: store.activeProjectId,
      activeView: "chat" as PaneView,
      noteSelection: null as NoteSelectionState | null,
      setActiveWorkspaceId,
      setActiveProjectId,
      setActiveView: NOOP_SET_VIEW,
      setNoteSelection: NOOP_SET_NOTE,
      setPaneFocus: NOOP_FOCUS,
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
    setActiveWorkspaceId,
    setActiveProjectId,
    setActiveView,
    setNoteSelection,
    setPaneFocus,
    isSplitPane: true,
  };
}

export function useScopedChat() {
  const pane = useWorkspacePane();
  const chatStore = useChatStore();
  const workspaceStore = useWorkspaceStore();
  const paneId = pane?.paneId ?? null;

  const setActiveChatId = useCallback(
    (chatSessionId: string | null) => {
      if (paneId) { useWorkspaceStore.getState().setPaneChatSession(paneId, chatSessionId); }
      else { useChatStore.getState().setActiveChatId(chatSessionId); }
    },
    [paneId],
  );

  if (!pane) {
    return {
      activeChatId: chatStore.activeChatId,
      setActiveChatId,
      isSplitPane: false,
    };
  }

  return {
    activeChatId: workspaceStore.panes[pane.paneId].chatSessionId,
    setActiveChatId,
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
