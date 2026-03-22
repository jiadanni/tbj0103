import { create } from "zustand";
import type { TopicSignature, WorkspaceMatchResult } from "../lib/api";

export interface Workspace {
  id: string;
  name: string;
  topic_signature: TopicSignature;
  signature_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  project_description: string;
  custom_instructions: string;
  color: string;
  icon: string;
  created_at: string;
  updated_at: string;
}

export type PaneId = "primary" | "secondary";
export type NavigationLayout = "side-tabs" | "top-tabs" | "top-dropdown";

export type PaneView =
  | "project"
  | "chat"
  | "notes"
  | "documents"
  | "webcapture"
  | "graph"
  | "flashcards"
  | "thoughts"
  | "recycle-bin";

export interface NoteSelectionState {
  kind: "project" | "daily";
  id?: string;
  date?: string;
}

export interface WorkspacePaneState {
  workspaceId: string | null;
  projectId: string | null;
  view: PaneView;
  chatSessionId: string | null;
  noteSelection: NoteSelectionState | null;
}

const SPLIT_LAYOUT_KEY = "workspaceSplitLayout";

const DEFAULT_PANE_STATE: WorkspacePaneState = {
  workspaceId: null,
  projectId: null,
  view: "project",
  chatSessionId: null,
  noteSelection: null,
};

function cloneDefaultPaneState(): WorkspacePaneState {
  return { ...DEFAULT_PANE_STATE };
}

function readStoredSplitLayout(): Pick<WorkspaceStore, "splitMode" | "splitSizes" | "activePaneId" | "panes"> {
  const fallback = {
    splitMode: false,
    splitSizes: [50, 50] as [number, number],
    activePaneId: "primary" as PaneId,
    panes: {
      primary: cloneDefaultPaneState(),
      secondary: cloneDefaultPaneState(),
    },
  };

  try {
    const raw = window.localStorage.getItem(SPLIT_LAYOUT_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<Pick<WorkspaceStore, "splitMode" | "splitSizes" | "activePaneId" | "panes">>;
    return {
      splitMode: parsed.splitMode ?? fallback.splitMode,
      splitSizes: (parsed.splitSizes?.length === 2 ? parsed.splitSizes : fallback.splitSizes) as [number, number],
      activePaneId: parsed.activePaneId === "secondary" ? "secondary" : "primary",
      panes: {
        primary: { ...cloneDefaultPaneState(), ...parsed.panes?.primary },
        secondary: { ...cloneDefaultPaneState(), ...parsed.panes?.secondary },
      },
    };
  } catch {
    return fallback;
  }
}

function persistSplitLayout(state: Pick<WorkspaceStore, "splitMode" | "splitSizes" | "activePaneId" | "panes">) {
  window.localStorage.setItem(SPLIT_LAYOUT_KEY, JSON.stringify({
    splitMode: state.splitMode,
    splitSizes: state.splitSizes,
    activePaneId: state.activePaneId,
    panes: state.panes,
  }));
}

interface WorkspaceStore {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeProjectId: string | null;
  projects: Project[];
  projectsByWorkspace: Record<string, Project[]>;
  isDemoMode: boolean;
  navLayout: NavigationLayout;
  activeTopicSignature: TopicSignature | null;
  migrationSuggestion: WorkspaceMatchResult | null;
  splitMode: boolean;
  splitSizes: [number, number];
  activePaneId: PaneId;
  panes: Record<PaneId, WorkspacePaneState>;
  setWorkspaces: (ws: Workspace[]) => void;
  setActiveWorkspaceId: (id: string | null) => void;
  setActiveProjectId: (id: string | null) => void;
  setProjects: (ps: Project[]) => void;
  setDemo: (active: boolean, workspaceId?: string) => void;
  addWorkspace: (ws: Workspace) => void;
  addProject: (p: Project) => void;
  removeProject: (id: string) => void;
  setNavLayout: (layout: NavigationLayout) => void;
  setActiveTopicSignature: (sig: TopicSignature | null) => void;
  setWorkspaceTopicSignature: (workspaceId: string, sig: TopicSignature | null) => void;
  setMigrationSuggestion: (suggestion: WorkspaceMatchResult | null) => void;
  dismissMigrationSuggestion: () => void;
  enterSplitMode: () => void;
  exitSplitMode: () => void;
  toggleSplitMode: () => void;
  setSplitSizes: (sizes: [number, number]) => void;
  setActivePaneId: (paneId: PaneId) => void;
  setPaneWorkspace: (paneId: PaneId, workspaceId: string | null) => void;
  setPaneProject: (paneId: PaneId, projectId: string | null) => void;
  setPaneView: (paneId: PaneId, view: PaneView) => void;
  setPaneChatSession: (paneId: PaneId, chatSessionId: string | null) => void;
  setPaneNoteSelection: (paneId: PaneId, selection: NoteSelectionState | null) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => {
  const storedSplitLayout = readStoredSplitLayout();

  return {
  workspaces: [],
  activeWorkspaceId: null,
  activeProjectId: null,
  projects: [],
  projectsByWorkspace: {},
    isDemoMode: false,
    navLayout: (() => {
      const raw = window.localStorage.getItem("navLayout") as NavigationLayout | "sidebar" | "tabs" | null;
      if (raw === "sidebar") {return "side-tabs";}
      if (raw === "tabs") {return "top-tabs";}
      return raw ?? "side-tabs";
    })(),
    activeTopicSignature: null,
    migrationSuggestion: null,
    splitMode: storedSplitLayout.splitMode,
    splitSizes: storedSplitLayout.splitSizes,
    activePaneId: storedSplitLayout.activePaneId,
    panes: storedSplitLayout.panes,
    setWorkspaces: (workspaces) => set((state) => {
      let activeWorkspaceId = state.activeWorkspaceId;
      if (!activeWorkspaceId && workspaces.length > 0) {
        activeWorkspaceId = workspaces[0].id;
      }

      const panes = {
        primary: {
          ...state.panes.primary,
          workspaceId: state.panes.primary.workspaceId ?? activeWorkspaceId,
        },
        secondary: {
          ...state.panes.secondary,
          workspaceId: state.panes.secondary.workspaceId ?? (workspaces.find((ws) => ws.id !== (state.panes.primary.workspaceId ?? activeWorkspaceId))?.id ?? activeWorkspaceId),
        },
      };

      persistSplitLayout({ splitMode: state.splitMode, splitSizes: state.splitSizes, activePaneId: state.activePaneId, panes });
      return { workspaces, activeWorkspaceId, panes };
    }),
    setActiveWorkspaceId: (activeWorkspaceId) => set((state) => {
      const panes = {
        ...state.panes,
        primary: {
          ...state.panes.primary,
          workspaceId: activeWorkspaceId,
          projectId: activeWorkspaceId === state.panes.primary.workspaceId ? state.panes.primary.projectId : null,
          chatSessionId: activeWorkspaceId === state.panes.primary.workspaceId ? state.panes.primary.chatSessionId : null,
          noteSelection: activeWorkspaceId === state.panes.primary.workspaceId ? state.panes.primary.noteSelection : null,
        },
      };
      persistSplitLayout({ splitMode: state.splitMode, splitSizes: state.splitSizes, activePaneId: state.activePaneId, panes });
      return { activeWorkspaceId, panes };
    }),
    setActiveProjectId: (activeProjectId) => set((state) => {
      const panes = {
        ...state.panes,
        primary: {
          ...state.panes.primary,
          projectId: activeProjectId,
        },
      };
      persistSplitLayout({ splitMode: state.splitMode, splitSizes: state.splitSizes, activePaneId: state.activePaneId, panes });
      return { activeProjectId, panes };
    }),
    setProjects: (projects) => set((state) => {
      const workspaceId = projects[0]?.workspace_id ?? state.activeWorkspaceId;
      const projectsByWorkspace = workspaceId
        ? { ...state.projectsByWorkspace, [workspaceId]: projects }
        : state.projectsByWorkspace;
      return { projects, projectsByWorkspace };
    }),
    setDemo: (isDemoMode, workspaceId) => set((state) => {
      const nextWorkspaceId = workspaceId ?? null;
      const panes = {
        ...state.panes,
        primary: {
          ...state.panes.primary,
          workspaceId: nextWorkspaceId,
        },
      };
      persistSplitLayout({ splitMode: state.splitMode, splitSizes: state.splitSizes, activePaneId: state.activePaneId, panes });
      return { isDemoMode, activeWorkspaceId: nextWorkspaceId, panes };
    }),
    addWorkspace: (ws) => set((s) => ({ workspaces: [...s.workspaces, ws] })),
    addProject: (p) => set((s) => ({
      projects: p.workspace_id === s.activeWorkspaceId ? [...s.projects, p] : s.projects,
      projectsByWorkspace: {
        ...s.projectsByWorkspace,
        [p.workspace_id]: [...(s.projectsByWorkspace[p.workspace_id] ?? []), p],
      },
    })),
    removeProject: (id) => set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      projectsByWorkspace: Object.fromEntries(
        Object.entries(s.projectsByWorkspace).map(([workspaceId, projects]) => [
          workspaceId,
          projects.filter((project) => project.id !== id),
        ])
      ),
    })),
    setNavLayout: (navLayout) => {
      window.localStorage.setItem("navLayout", navLayout);
      set({ navLayout });
    },
    setActiveTopicSignature: (activeTopicSignature) => set({ activeTopicSignature }),
    setWorkspaceTopicSignature: (workspaceId, sig) => set((state) => {
      const workspaces = state.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? {
              ...workspace,
              topic_signature: sig ?? workspace.topic_signature,
              signature_updated_at: sig?.generated_at ?? workspace.signature_updated_at,
            }
          : workspace
      );

      return {
        workspaces,
        activeTopicSignature: state.activeWorkspaceId === workspaceId ? sig : state.activeTopicSignature,
      };
    }),
    setMigrationSuggestion: (migrationSuggestion) => set({ migrationSuggestion }),
    dismissMigrationSuggestion: () => set({ migrationSuggestion: null }),
    enterSplitMode: () => set((state) => {
      if (state.workspaces.length < 2) {
        return {};
      }

      const primaryWorkspaceId = state.activeWorkspaceId ?? state.workspaces[0]?.id ?? null;
      const secondaryWorkspaceId = state.workspaces.find((workspace) => workspace.id !== primaryWorkspaceId)?.id ?? primaryWorkspaceId;
      const panes = {
        primary: {
          ...state.panes.primary,
          workspaceId: primaryWorkspaceId,
          projectId: state.activeProjectId,
          chatSessionId: state.panes.primary.chatSessionId,
          view: state.panes.primary.view,
        },
        secondary: {
          ...state.panes.secondary,
          workspaceId: state.panes.secondary.workspaceId && state.panes.secondary.workspaceId !== primaryWorkspaceId
            ? state.panes.secondary.workspaceId
            : secondaryWorkspaceId,
          projectId: state.panes.secondary.workspaceId === secondaryWorkspaceId ? state.panes.secondary.projectId : null,
          chatSessionId: state.panes.secondary.workspaceId === secondaryWorkspaceId ? state.panes.secondary.chatSessionId : null,
          noteSelection: state.panes.secondary.workspaceId === secondaryWorkspaceId ? state.panes.secondary.noteSelection : null,
          view: state.panes.secondary.view ?? "project",
        },
      };
      persistSplitLayout({ splitMode: true, splitSizes: state.splitSizes, activePaneId: state.activePaneId, panes });
      return { splitMode: true, panes };
    }),
    exitSplitMode: () => set((state) => {
      const activeWorkspaceId = state.panes.primary.workspaceId ?? state.activeWorkspaceId;
      const activeProjectId = state.panes.primary.projectId ?? state.activeProjectId;
      persistSplitLayout({ splitMode: false, splitSizes: state.splitSizes, activePaneId: "primary", panes: state.panes });
      return { splitMode: false, activePaneId: "primary", activeWorkspaceId, activeProjectId };
    }),
    toggleSplitMode: () => {
      const { splitMode, exitSplitMode, enterSplitMode } = get();
      if (splitMode) {
        exitSplitMode();
      } else {
        enterSplitMode();
      }
    },
    setSplitSizes: (splitSizes) => set((state) => {
      persistSplitLayout({ splitMode: state.splitMode, splitSizes, activePaneId: state.activePaneId, panes: state.panes });
      return { splitSizes };
    }),
    setActivePaneId: (activePaneId) => set((state) => {
      persistSplitLayout({ splitMode: state.splitMode, splitSizes: state.splitSizes, activePaneId, panes: state.panes });
      return { activePaneId };
    }),
    setPaneWorkspace: (paneId, workspaceId) => set((state) => {
      const nextPane = {
        ...state.panes[paneId],
        workspaceId,
        projectId: workspaceId === state.panes[paneId].workspaceId ? state.panes[paneId].projectId : null,
        chatSessionId: workspaceId === state.panes[paneId].workspaceId ? state.panes[paneId].chatSessionId : null,
        noteSelection: workspaceId === state.panes[paneId].workspaceId ? state.panes[paneId].noteSelection : null,
      };
      const panes = { ...state.panes, [paneId]: nextPane };
      persistSplitLayout({ splitMode: state.splitMode, splitSizes: state.splitSizes, activePaneId: state.activePaneId, panes });
      return { panes };
    }),
    setPaneProject: (paneId, projectId) => set((state) => {
      const panes = {
        ...state.panes,
        [paneId]: {
          ...state.panes[paneId],
          projectId,
        },
      };
      persistSplitLayout({ splitMode: state.splitMode, splitSizes: state.splitSizes, activePaneId: state.activePaneId, panes });
      return { panes };
    }),
    setPaneView: (paneId, view) => set((state) => {
      const panes = {
        ...state.panes,
        [paneId]: {
          ...state.panes[paneId],
          view,
        },
      };
      persistSplitLayout({ splitMode: state.splitMode, splitSizes: state.splitSizes, activePaneId: state.activePaneId, panes });
      return { panes };
    }),
    setPaneChatSession: (paneId, chatSessionId) => set((state) => {
      const panes = {
        ...state.panes,
        [paneId]: {
          ...state.panes[paneId],
          chatSessionId,
        },
      };
      persistSplitLayout({ splitMode: state.splitMode, splitSizes: state.splitSizes, activePaneId: state.activePaneId, panes });
      return { panes };
    }),
    setPaneNoteSelection: (paneId, noteSelection) => set((state) => {
      const panes = {
        ...state.panes,
        [paneId]: {
          ...state.panes[paneId],
          noteSelection,
        },
      };
      persistSplitLayout({ splitMode: state.splitMode, splitSizes: state.splitSizes, activePaneId: state.activePaneId, panes });
      return { panes };
    }),
  };
});
