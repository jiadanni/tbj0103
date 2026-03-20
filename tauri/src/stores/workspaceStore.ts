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

interface WorkspaceStore {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeProjectId: string | null;
  projects: Project[];
  isDemoMode: boolean;
  navLayout: "sidebar" | "tabs";
  activeTopicSignature: TopicSignature | null;
  migrationSuggestion: WorkspaceMatchResult | null;
  setWorkspaces: (ws: Workspace[]) => void;
  setActiveWorkspaceId: (id: string | null) => void;
  setActiveProjectId: (id: string | null) => void;
  setProjects: (ps: Project[]) => void;
  setDemo: (active: boolean, workspaceId?: string) => void;
  addWorkspace: (ws: Workspace) => void;
  addProject: (p: Project) => void;
  removeProject: (id: string) => void;
  setNavLayout: (layout: "sidebar" | "tabs") => void;
  setActiveTopicSignature: (sig: TopicSignature | null) => void;
  setMigrationSuggestion: (suggestion: WorkspaceMatchResult | null) => void;
  dismissMigrationSuggestion: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  workspaces: [],
  activeWorkspaceId: null,
  activeProjectId: null,
  projects: [],
  isDemoMode: false,
  navLayout: (localStorage.getItem("navLayout") as "sidebar" | "tabs") ?? "sidebar",
  activeTopicSignature: null,
  migrationSuggestion: null,
  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
  setActiveProjectId: (activeProjectId) => set({ activeProjectId }),
  setProjects: (projects) => set({ projects }),
  setDemo: (isDemoMode, workspaceId) => set({ isDemoMode, activeWorkspaceId: workspaceId ?? null }),
  addWorkspace: (ws) => set((s) => ({ workspaces: [...s.workspaces, ws] })),
  addProject: (p) => set((s) => ({ projects: [...s.projects, p] })),
  removeProject: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
  setNavLayout: (navLayout) => {
    localStorage.setItem("navLayout", navLayout);
    set({ navLayout });
  },
  setActiveTopicSignature: (activeTopicSignature) => set({ activeTopicSignature }),
  setMigrationSuggestion: (migrationSuggestion) => set({ migrationSuggestion }),
  dismissMigrationSuggestion: () => set({ migrationSuggestion: null }),
}));
