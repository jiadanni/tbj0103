import { create } from 'zustand';
import { api } from '../lib/api';
import type { ArtifactSummary, Artifact } from '../models/artifact';

interface ArtifactState {
  artifacts: ArtifactSummary[];
  activeArtifact: Artifact | null;
  isPanelOpen: boolean;
  isLoading: boolean;
  
  // Actions
  setPanelOpen: (open: boolean) => void;
  setActiveArtifact: (artifact: Artifact | null) => void;
  loadArtifacts: (workspaceId: string) => Promise<void>;
  loadArtifact: (id: string) => Promise<void>;
  createArtifact: (req: any) => Promise<Artifact>;
  deleteArtifact: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
}

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  artifacts: [],
  activeArtifact: null,
  isPanelOpen: false,
  isLoading: false,

  setPanelOpen: (open) => set({ isPanelOpen: open }),
  
  setActiveArtifact: (artifact) => set({ activeArtifact: artifact }),

  loadArtifacts: async (workspaceId) => {
    set({ isLoading: true });
    try {
      const artifacts = await api.artifact.list(workspaceId);
      set({ artifacts });
    } catch (e) {
      console.error('Failed to load artifacts:', e);
    } finally {
      set({ isLoading: false });
    }
  },

  loadArtifact: async (id) => {
    try {
      const artifact = await api.artifact.get(id);
      set({ activeArtifact: artifact });
    } catch (e) {
      console.error('Failed to load artifact:', e);
    }
  },

  createArtifact: async (req) => {
    const artifact = await api.artifact.create(req);
    const summary: ArtifactSummary = {
      id: artifact.id,
      title: artifact.title,
      artifact_type: artifact.artifact_type,
      language: artifact.language,
      description: artifact.description,
      tags: JSON.parse(artifact.tags),
      is_pinned: artifact.is_pinned,
      version: artifact.version,
      updated_at: artifact.updated_at,
    };
    set((state) => ({ 
      artifacts: [summary, ...state.artifacts],
      activeArtifact: artifact,
      isPanelOpen: true
    }));
    return artifact;
  },

  deleteArtifact: async (id) => {
    await api.artifact.delete(id);
    set((state) => ({
      artifacts: state.artifacts.filter((a) => a.id !== id),
      activeArtifact: state.activeArtifact?.id === id ? null : state.activeArtifact,
    }));
  },

  togglePin: async (id) => {
    const artifact = get().artifacts.find((a) => a.id === id);
    if (!artifact) {return;}
    await api.artifact.update(id, { is_pinned: !artifact.is_pinned });
    set((state) => ({
      artifacts: state.artifacts.map((a) => 
        a.id === id ? { ...a, is_pinned: !a.is_pinned } : a
      ),
    }));
  }
}));
