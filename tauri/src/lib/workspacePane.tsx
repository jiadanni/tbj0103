/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useMemo } from "react";
import { useChatStore } from "../stores/chatStore";
import {
  type PaneId,
  type PaneView,
  useWorkspaceStore,
  type NoteSelectionState,
  type Project,
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
const EMPTY_PROJECTS: Project[] = [];

export function useScopedWorkspace() {
  const pane = useWorkspacePane();
  const paneId = pane?.paneId ?? null;

  // Granular selectors — only re-render when the specific field changes,
  // not on every unrelated store update. Critical for split-pane performance
  // where two ChatView instances are mounted simultaneously.
  const activeWorkspaceId = useWorkspaceStore(
    useCallback(
      (s) => (paneId ? s.panes[paneId].workspaceId : s.activeWorkspaceId),
      [paneId],
    ),
  );
  const activeProjectId = useWorkspaceStore(
    useCallback(
      (s) => (paneId ? s.panes[paneId].projectId : s.activeProjectId),
      [paneId],
    ),
  );
  const activeView = useWorkspaceStore(
    useCallback(
      (s): PaneView => (paneId ? s.panes[paneId].view : "chat"),
      [paneId],
    ),
  );
  const noteSelection = useWorkspaceStore(
    useCallback(
      (s): NoteSelectionState | null => (paneId ? s.panes[paneId].noteSelection : null),
      [paneId],
    ),
  );

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
      activeWorkspaceId,
      activeProjectId,
      activeView,
      noteSelection,
      setActiveWorkspaceId,
      setActiveProjectId,
      setActiveView: NOOP_SET_VIEW,
      setNoteSelection: NOOP_SET_NOTE,
      setPaneFocus: NOOP_FOCUS,
      isSplitPane: false,
    };
  }

  return {
    paneId: pane.paneId,
    activeWorkspaceId,
    activeProjectId,
    activeView,
    noteSelection,
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
  const paneId = pane?.paneId ?? null;

  // Granular selectors — subscribe only to the specific chat ID field,
  // not the entire chatStore + workspaceStore.
  const globalActiveChatId = useChatStore((s) => s.activeChatId);
  const paneChatSessionId = useWorkspaceStore(
    useCallback((s) => (paneId ? s.panes[paneId].chatSessionId : null), [paneId]),
  );

  const activeChatId = paneId ? paneChatSessionId : globalActiveChatId;

  const setActiveChatId = useCallback(
    (chatSessionId: string | null) => {
      if (paneId) { useWorkspaceStore.getState().setPaneChatSession(paneId, chatSessionId); }
      else { useChatStore.getState().setActiveChatId(chatSessionId); }
    },
    [paneId],
  );

  return {
    activeChatId,
    setActiveChatId,
    isSplitPane: paneId !== null,
  };
}

export function useScopedProjects() {
  const pane = useWorkspacePane();
  const paneId = pane?.paneId ?? null;

  return useWorkspaceStore(
    useCallback(
      (s) => {
        if (!paneId) { return s.projects; }
        const workspaceId = s.panes[paneId].workspaceId;
        return workspaceId ? (s.projectsByWorkspace[workspaceId] ?? EMPTY_PROJECTS) : EMPTY_PROJECTS;
      },
      [paneId],
    ),
  );
}
