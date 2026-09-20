import { create } from "zustand";
import { api, type AppProfile } from "../lib/api";

interface ProfileStore {
  profiles: AppProfile[];
  activeProfileId: string;
  activeProfile: AppProfile | null;
  loading: boolean;
  error: string | null;

  loadProfiles: () => Promise<void>;
  createProfile: (name: string, description?: string, switchTo?: boolean) => Promise<AppProfile>;
  switchProfile: (profileId: string) => Promise<void>;
  renameProfile: (profileId: string, name: string, description?: string) => Promise<AppProfile>;
  deleteProfile: (profileId: string) => Promise<void>;
}

export const useProfileStore = create<ProfileStore>()((set, get) => ({
  profiles: [],
  activeProfileId: "default",
  activeProfile: null,
  loading: false,
  error: null,

  loadProfiles: async () => {
    set({ loading: true, error: null });
    try {
      const res = await api.profile.list();
      set({
        profiles: res.profiles,
        activeProfileId: res.active_profile_id,
        activeProfile: res.active_profile,
        loading: false,
      });
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  createProfile: async (name: string, description?: string, switchTo = true) => {
    set({ error: null });
    try {
      const created = await api.profile.create(name, description, switchTo);
      if (!switchTo) {
        await get().loadProfiles();
      }
      return created;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      throw new Error(msg);
    }
  },

  switchProfile: async (profileId: string) => {
    set({ error: null });
    try {
      await api.profile.switch(profileId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      throw new Error(msg);
    }
  },

  renameProfile: async (profileId: string, name: string, description?: string) => {
    set({ error: null });
    try {
      const updated = await api.profile.rename(profileId, name, description);
      await get().loadProfiles();
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      throw new Error(msg);
    }
  },

  deleteProfile: async (profileId: string) => {
    set({ error: null });
    try {
      await api.profile.delete(profileId);
      await get().loadProfiles();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      throw new Error(msg);
    }
  },
}));
