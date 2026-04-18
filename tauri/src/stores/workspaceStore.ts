import { create } from "zustand";
import type { TopicSignature, WorkspaceMatchResult } from "../lib/api";
import { useChatStore } from "./chatStore";

export interface Workspace {
  id: string;
  name: string;
  description: string;
  prompt_instructions: string;
  topic_signature: TopicSignature;
  signature_updated_at: string | null;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
  parent_workspace_id: string | null;
  icon: string;
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

export type WorkspaceSortOrder = "name-asc" | "name-desc" | "created-newest" | "created-oldest" | "updated-newest" | "updated-oldest";

export type PaneId = "primary" | "secondary";
export type NavigationPresentation = "sidebar" | "icon-bar" | "top-tabs" | "top-dropdown";
export type SplitNavigationPresentation = "match-main" | "tabs" | "dropdown";

export type PaneView =
  | "project"
  | "chat"
  | "memory"
  | "notes"
  | "sources"
  | "documents"
  | "webcapture"
  | "graph"
  | "flashcards"
  | "thoughts"
  | "settings"
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

function normalizeNavigationPresentation(
  value: NavigationPresentation | null | undefined,
  fallback: NavigationPresentation,
): NavigationPresentation {
  if (value === "icon-bar") {
    return "sidebar";
  }
  return value ?? fallback;
}

function sortWorkspaces(workspaces: Workspace[], order: WorkspaceSortOrder = "name-asc"): Workspace[] {
  return [...workspaces].sort((a, b) => {
    switch (order) {
      case "name-asc":
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
          || a.created_at.localeCompare(b.created_at)
          || a.id.localeCompare(b.id);
      case "name-desc":
        return b.name.localeCompare(a.name, undefined, { sensitivity: "base", numeric: true })
          || a.created_at.localeCompare(b.created_at)
          || a.id.localeCompare(b.id);
      case "created-newest":
        return b.created_at.localeCompare(a.created_at)
          || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
      case "created-oldest":
        return a.created_at.localeCompare(b.created_at)
          || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
      case "updated-newest":
        return b.updated_at.localeCompare(a.updated_at)
          || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
      case "updated-oldest":
        return a.updated_at.localeCompare(b.updated_at)
          || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    }
  });
}

function findFallbackWorkspaceId(
  workspaces: Workspace[],
  preferredWorkspaceId: string | null,
  excludeWorkspaceId?: string | null,
): string | null {
  if (preferredWorkspaceId && workspaces.some((workspace) => workspace.id === preferredWorkspaceId)) {
    return preferredWorkspaceId;
  }

  return workspaces.find((workspace) => workspace.id !== excludeWorkspaceId)?.id
    ?? workspaces[0]?.id
    ?? null;
}

function normalizeWorkspaceSelection(
  workspaces: Workspace[],
  preferredWorkspaceId: string | null,
  preferredParentWorkspaceId?: string | null,
): { workspaceId: string | null; parentWorkspaceId: string | null } {
  if (workspaces.length === 0) {
    return {
      workspaceId: preferredWorkspaceId,
      parentWorkspaceId: preferredParentWorkspaceId ?? preferredWorkspaceId,
    };
  }

  let workspaceId = preferredWorkspaceId && workspaces.some((workspace) => workspace.id === preferredWorkspaceId)
    ? preferredWorkspaceId
    : null;

  if (!workspaceId && preferredParentWorkspaceId) {
    workspaceId = workspaces.find((workspace) => workspace.parent_workspace_id === preferredParentWorkspaceId)?.id
      ?? (workspaces.some((workspace) => workspace.id === preferredParentWorkspaceId) ? preferredParentWorkspaceId : null);
  }

  workspaceId = findFallbackWorkspaceId(workspaces, workspaceId);
  if (!workspaceId) {
    return { workspaceId: null, parentWorkspaceId: null };
  }

  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    return { workspaceId, parentWorkspaceId: null };
  }

  if (workspace.parent_workspace_id) {
    return {
      workspaceId: workspace.id,
      parentWorkspaceId: workspace.parent_workspace_id,
    };
  }

  const childWorkspace = workspaces.find((item) => item.parent_workspace_id === workspace.id);
  if (childWorkspace) {
    return {
      workspaceId: childWorkspace.id,
      parentWorkspaceId: workspace.id,
    };
  }

  return {
    workspaceId: workspace.id,
    parentWorkspaceId: workspace.id,
  };
}

function normalizePaneWorkspaceId(
  workspaces: Workspace[],
  preferredWorkspaceId: string | null,
  excludeWorkspaceId?: string | null,
) {
  const fallbackWorkspaceId = findFallbackWorkspaceId(workspaces, preferredWorkspaceId, excludeWorkspaceId);
  return normalizeWorkspaceSelection(workspaces, fallbackWorkspaceId).workspaceId;
}

function hasProjectId(projects: Project[], projectId: string | null) {
  return !!projectId && projects.some((project) => project.id === projectId);
}

function reconcilePaneProjectsForWorkspace(
  panes: Record<PaneId, WorkspacePaneState>,
  workspaceId: string,
  projects: Project[],
): Record<PaneId, WorkspacePaneState> {
  const nextPanes = { ...panes };

  (["primary", "secondary"] as PaneId[]).forEach((paneId) => {
    const pane = panes[paneId];
    if (pane.workspaceId !== workspaceId || !pane.projectId || hasProjectId(projects, pane.projectId)) {
      return;
    }

    nextPanes[paneId] = {
      ...pane,
      projectId: null,
    };
  });

  return nextPanes;
}

interface WorkspaceStore {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeParentWorkspaceId: string | null;
  activeProjectId: string | null;
  projects: Project[];
  projectsByWorkspace: Record<string, Project[]>;
  isDemoMode: boolean;
  workspaceNavigation: NavigationPresentation;
  sectionNavigation: NavigationPresentation;
  splitWorkspaceNavigation: SplitNavigationPresentation;
  splitSectionNavigation: SplitNavigationPresentation;
  workspaceSortOrder: WorkspaceSortOrder;
  activeTopicSignature: TopicSignature | null;
  migrationSuggestion: WorkspaceMatchResult | null;
  splitMode: boolean;
  splitSizes: [number, number];
  activePaneId: PaneId;
  panes: Record<PaneId, WorkspacePaneState>;
  setWorkspaces: (ws: Workspace[]) => void;
  setActiveWorkspaceId: (id: string | null) => void;
  setActiveParentWorkspaceId: (id: string | null) => void;
  setActiveProjectId: (id: string | null) => void;
  setProjects: (ps: Project[]) => void;
  setProjectsForWorkspace: (workspaceId: string, projects: Project[]) => void;
  setDemo: (active: boolean, workspaceId?: string) => void;
  addWorkspace: (ws: Workspace) => void;
  addProject: (p: Project) => void;
  removeProject: (id: string) => void;
  setWorkspaceNavigation: (layout: NavigationPresentation) => void;
  setSectionNavigation: (layout: NavigationPresentation) => void;
  setSplitWorkspaceNavigation: (layout: SplitNavigationPresentation) => void;
  setSplitSectionNavigation: (layout: SplitNavigationPresentation) => void;
  setWorkspaceSortOrder: (order: WorkspaceSortOrder) => void;
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
  const readNavigationSetting = (key: "workspaceNavigation" | "sectionNavigation", fallback: NavigationPresentation) => {
    const raw = window.localStorage.getItem(key) as NavigationPresentation | null;
    return normalizeNavigationPresentation(raw, fallback);
  };
  const readSplitNavigationSetting = (
    key: "splitWorkspaceNavigation" | "splitSectionNavigation",
    fallback: SplitNavigationPresentation
  ) => {
    const raw = window.localStorage.getItem(key) as SplitNavigationPresentation | null;
    return raw ?? fallback;
  };
  const legacyNavLayout = window.localStorage.getItem("navLayout") as "side-tabs" | "top-tabs" | "top-dropdown" | "sidebar" | "tabs" | null;
  const migratedNavigation = (() => {
    const workspaceNavigation = readNavigationSetting(
      "workspaceNavigation",
      legacyNavLayout === "top-tabs"
        ? "top-tabs"
        : legacyNavLayout === "top-dropdown"
        ? "top-dropdown"
        : "top-tabs"
    );
    const sectionNavigation = readNavigationSetting(
      "sectionNavigation",
      workspaceNavigation
    );
    return { workspaceNavigation, sectionNavigation };
  })();

  return {
  workspaces: [],
  activeWorkspaceId: null,
  activeParentWorkspaceId: null,
  activeProjectId: null,
  projects: [],
  projectsByWorkspace: {},
    isDemoMode: false,
    workspaceNavigation: migratedNavigation.workspaceNavigation,
    sectionNavigation: migratedNavigation.sectionNavigation,
    splitWorkspaceNavigation: readSplitNavigationSetting("splitWorkspaceNavigation", "match-main"),
    splitSectionNavigation: readSplitNavigationSetting("splitSectionNavigation", "match-main"),
    workspaceSortOrder: (window.localStorage.getItem("workspaceSortOrder") as WorkspaceSortOrder | null) ?? "name-asc",
    activeTopicSignature: null,
    migrationSuggestion: null,
    splitMode: storedSplitLayout.splitMode,
    splitSizes: storedSplitLayout.splitSizes,
    activePaneId: storedSplitLayout.activePaneId,
    panes: storedSplitLayout.panes,
    setWorkspaces: (workspaces) => set((state) => {
      let filteredWorkspaces = workspaces;
      if (state.isDemoMode) {
        filteredWorkspaces = workspaces.filter(ws => ws.id.startsWith("demo-"));
      }
      const sortedWorkspaces = sortWorkspaces(filteredWorkspaces, state.workspaceSortOrder);
      const activeSelection = normalizeWorkspaceSelection(
        sortedWorkspaces,
        state.activeWorkspaceId,
        state.activeParentWorkspaceId,
      );
      const activeWorkspaceId = activeSelection.workspaceId;
      const primaryWorkspaceId = normalizePaneWorkspaceId(
        sortedWorkspaces,
        state.panes.primary.workspaceId ?? activeWorkspaceId,
      );
      const secondaryWorkspaceId = normalizePaneWorkspaceId(
        sortedWorkspaces,
        state.panes.secondary.workspaceId,
        primaryWorkspaceId,
      );
      const activeWorkspaceChanged = activeWorkspaceId !== state.activeWorkspaceId;
      const primaryWorkspaceChanged = primaryWorkspaceId !== state.panes.primary.workspaceId;
      const secondaryWorkspaceChanged = secondaryWorkspaceId !== state.panes.secondary.workspaceId;

      const panes = {
        primary: {
          ...state.panes.primary,
          workspaceId: primaryWorkspaceId,
          projectId: primaryWorkspaceChanged ? null : state.panes.primary.projectId,
          chatSessionId: primaryWorkspaceChanged ? null : state.panes.primary.chatSessionId,
          noteSelection: primaryWorkspaceChanged ? null : state.panes.primary.noteSelection,
        },
        secondary: {
          ...state.panes.secondary,
          workspaceId: secondaryWorkspaceId,
          projectId: secondaryWorkspaceChanged ? null : state.panes.secondary.projectId,
          chatSessionId: secondaryWorkspaceChanged ? null : state.panes.secondary.chatSessionId,
          noteSelection: secondaryWorkspaceChanged ? null : state.panes.secondary.noteSelection,
        },
      };

      if (activeWorkspaceChanged) {
        useChatStore.getState().setActiveChatId(null);
      }

      persistSplitLayout({ splitMode: state.splitMode, splitSizes: state.splitSizes, activePaneId: state.activePaneId, panes });
      return {
        workspaces: sortedWorkspaces,
        activeWorkspaceId,
        activeParentWorkspaceId: activeSelection.parentWorkspaceId,
        activeProjectId: activeWorkspaceChanged ? null : state.activeProjectId,
        panes,
        projectsByWorkspace: Object.fromEntries(
          Object.entries(state.projectsByWorkspace).filter(([workspaceId]) =>
            sortedWorkspaces.some((workspace) => workspace.id === workspaceId)
          )
        ),
      };
    }),
    setActiveWorkspaceId: (activeWorkspaceId) => set((state) => {
      const nextSelection = normalizeWorkspaceSelection(
        state.workspaces,
        activeWorkspaceId,
        state.activeParentWorkspaceId,
      );
      const workspaceChanged = nextSelection.workspaceId !== state.activeWorkspaceId;
      const panes = {
        ...state.panes,
        primary: {
          ...state.panes.primary,
          workspaceId: nextSelection.workspaceId,
          projectId: nextSelection.workspaceId === state.panes.primary.workspaceId ? state.panes.primary.projectId : null,
          chatSessionId: nextSelection.workspaceId === state.panes.primary.workspaceId ? state.panes.primary.chatSessionId : null,
          noteSelection: nextSelection.workspaceId === state.panes.primary.workspaceId ? state.panes.primary.noteSelection : null,
        },
      };
      if (workspaceChanged) {
        useChatStore.getState().setActiveChatId(null);
      }
      persistSplitLayout({ splitMode: state.splitMode, splitSizes: state.splitSizes, activePaneId: state.activePaneId, panes });
      return {
        activeWorkspaceId: nextSelection.workspaceId,
        activeParentWorkspaceId: nextSelection.parentWorkspaceId,
        activeProjectId: workspaceChanged ? null : state.activeProjectId,
        panes,
      };
    }),
    setActiveParentWorkspaceId: (activeParentWorkspaceId) => set(() => ({ activeParentWorkspaceId })),
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
      const activeProjectId = workspaceId === state.activeWorkspaceId && !hasProjectId(projects, state.activeProjectId)
        ? null
        : state.activeProjectId;
      const panes = workspaceId
        ? reconcilePaneProjectsForWorkspace(state.panes, workspaceId, projects)
        : state.panes;

      if (panes !== state.panes) {
        persistSplitLayout({ splitMode: state.splitMode, splitSizes: state.splitSizes, activePaneId: state.activePaneId, panes });
      }

      return { projects, projectsByWorkspace, activeProjectId, panes };
    }),
    setProjectsForWorkspace: (workspaceId, projects) => set((state) => {
      const activeProjectId = workspaceId === state.activeWorkspaceId && !hasProjectId(projects, state.activeProjectId)
        ? null
        : state.activeProjectId;
      const panes = reconcilePaneProjectsForWorkspace(state.panes, workspaceId, projects);

      if (panes !== state.panes) {
        persistSplitLayout({ splitMode: state.splitMode, splitSizes: state.splitSizes, activePaneId: state.activePaneId, panes });
      }

      return {
        projects: workspaceId === state.activeWorkspaceId ? projects : state.projects,
        activeProjectId,
        projectsByWorkspace: {
          ...state.projectsByWorkspace,
          [workspaceId]: projects,
        },
        panes,
      };
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
      return { isDemoMode, activeWorkspaceId: nextWorkspaceId, activeParentWorkspaceId: nextWorkspaceId, panes };
    }),
    addWorkspace: (ws) => set((s) => {
      if (s.isDemoMode && !ws.id.startsWith("demo-")) {
        return {}; // Hide regular workspaces in demo mode
      }
      return { workspaces: sortWorkspaces([...s.workspaces, ws], s.workspaceSortOrder) };
    }),
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
    setWorkspaceNavigation: (workspaceNavigation) => {
      const normalized = normalizeNavigationPresentation(workspaceNavigation, "sidebar");
      window.localStorage.setItem("workspaceNavigation", normalized);
      set({ workspaceNavigation: normalized });
    },
    setSectionNavigation: (sectionNavigation) => {
      const normalized = normalizeNavigationPresentation(sectionNavigation, "sidebar");
      window.localStorage.setItem("sectionNavigation", normalized);
      set({ sectionNavigation: normalized });
    },
    setSplitWorkspaceNavigation: (splitWorkspaceNavigation) => {
      window.localStorage.setItem("splitWorkspaceNavigation", splitWorkspaceNavigation);
      set({ splitWorkspaceNavigation });
    },
    setSplitSectionNavigation: (splitSectionNavigation) => {
      window.localStorage.setItem("splitSectionNavigation", splitSectionNavigation);
      set({ splitSectionNavigation });
    },
    setWorkspaceSortOrder: (workspaceSortOrder) => {
      window.localStorage.setItem("workspaceSortOrder", workspaceSortOrder);
      set((state) => ({
        workspaceSortOrder,
        workspaces: sortWorkspaces(state.workspaces, workspaceSortOrder),
      }));
    },
    setActiveTopicSignature: (activeTopicSignature) => set({ activeTopicSignature }),
    setWorkspaceTopicSignature: (workspaceId, sig) => set((state) => {
      const existing = state.workspaces.find((w) => w.id === workspaceId);
      const nextSig = sig ?? existing?.topic_signature ?? {
        domain_tags: [],
        manual_tags: [],
        ignored_tags: [],
        intent_patterns: [],
        generated_at: null,
        message_count_at_gen: null,
        ollama_enriched: false,
      };
      const nextUpdatedAt = sig?.generated_at ?? existing?.signature_updated_at ?? null;

      // Bail out if nothing actually changed to avoid creating a new array reference.
      if (
        existing &&
        existing.topic_signature === nextSig &&
        existing.signature_updated_at === nextUpdatedAt &&
        (state.activeWorkspaceId !== workspaceId || state.activeTopicSignature === sig)
      ) {
        return {};
      }

      const workspaces = state.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? {
              ...workspace,
              topic_signature: nextSig,
              signature_updated_at: nextUpdatedAt,
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
      useChatStore.getState().setActiveChatId(null);
      return { splitMode: true, panes };
    }),
    exitSplitMode: () => set((state) => {
      const nextSelection = normalizeWorkspaceSelection(
        state.workspaces,
        state.panes.primary.workspaceId ?? state.activeWorkspaceId,
        state.activeParentWorkspaceId,
      );
      const activeWorkspaceId = nextSelection.workspaceId;
      const activeProjectId = state.panes.primary.projectId ?? state.activeProjectId;
      useChatStore.getState().setActiveChatId(state.panes.primary.chatSessionId ?? null);
      persistSplitLayout({ splitMode: false, splitSizes: state.splitSizes, activePaneId: "primary", panes: state.panes });
      return {
        splitMode: false,
        activePaneId: "primary",
        activeWorkspaceId,
        activeParentWorkspaceId: nextSelection.parentWorkspaceId,
        activeProjectId,
      };
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
      const nextWorkspaceId = normalizePaneWorkspaceId(
        state.workspaces,
        workspaceId,
        paneId === "secondary" ? state.panes.primary.workspaceId : undefined,
      );
      const nextPane = {
        ...state.panes[paneId],
        workspaceId: nextWorkspaceId,
        projectId: nextWorkspaceId === state.panes[paneId].workspaceId ? state.panes[paneId].projectId : null,
        chatSessionId: nextWorkspaceId === state.panes[paneId].workspaceId ? state.panes[paneId].chatSessionId : null,
        noteSelection: nextWorkspaceId === state.panes[paneId].workspaceId ? state.panes[paneId].noteSelection : null,
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
