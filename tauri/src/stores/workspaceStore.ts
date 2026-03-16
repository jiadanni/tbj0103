import { create } from "zustand";

export interface Workspace {
  id: string;
  name: string;
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

interface WorkspaceStore {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeProjectId: string | null;
  projects: Project[];
  isDemoMode: boolean;
  setWorkspaces: (ws: Workspace[]) => void;
  setActiveWorkspaceId: (id: string | null) => void;
  setActiveProjectId: (id: string | null) => void;
  setProjects: (ps: Project[]) => void;
  setDemo: (active: boolean, workspaceId?: string) => void;
  addWorkspace: (ws: Workspace) => void;
  addProject: (p: Project) => void;
  removeProject: (id: string) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  workspaces: [],
  activeWorkspaceId: null,
  activeProjectId: null,
  projects: [],
  isDemoMode: false,
  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
  setActiveProjectId: (activeProjectId) => set({ activeProjectId }),
  setProjects: (projects) => set({ projects }),
  setDemo: (isDemoMode, workspaceId) => set({ isDemoMode, activeWorkspaceId: workspaceId ?? null }),
  addWorkspace: (ws) => set((s) => ({ workspaces: [...s.workspaces, ws] })),
  addProject: (p) => set((s) => ({ projects: [...s.projects, p] })),
  removeProject: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
}));
