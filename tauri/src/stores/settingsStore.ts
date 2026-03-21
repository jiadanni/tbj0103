import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "system" | "light" | "dark" | "oled" | "sepia" | "hacker" | "glasscode";

interface AppSettings {
  preferredModel: string;
  backgroundModel: string;
  ollamaUrl: string;
  embeddingModel: string;
  theme: Theme;
  accentColor: string;
  fontSize: number;
  sidebarWidth: number;
  dualModelEnabled: boolean;
  draftModel: string;
  compareModelA: string;
  compareModelB: string;
  modelLabels: Record<string, string>;
  skipLinkConfirm: boolean;
  immediateDelete: boolean;
  confirmMoveToTrash: boolean;
}

interface SettingsStore extends AppSettings {
  setPreferredModel: (m: string) => void;
  setBackgroundModel: (m: string) => void;
  setOllamaUrl: (url: string) => void;
  setTheme: (t: Theme) => void;
  setAccentColor: (c: string) => void;
  setFontSize: (n: number) => void;
  setSidebarWidth: (n: number) => void;
  setDualModelEnabled: (v: boolean) => void;
  setDraftModel: (m: string) => void;
  setCompareModelA: (m: string) => void;
  setCompareModelB: (m: string) => void;
  setModelLabel: (id: string, label: string) => void;
  setSkipLinkConfirm: (v: boolean) => void;
  setImmediateDelete: (v: boolean) => void;
  setConfirmMoveToTrash: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      preferredModel: "",
      backgroundModel: "",
      ollamaUrl: "http://localhost:11434",
      embeddingModel: "nomic-embed-text",
      theme: "system",
      accentColor: "#007AFF",
      fontSize: 14,
      sidebarWidth: 240,
      dualModelEnabled: false,
      draftModel: "",
      compareModelA: "",
      compareModelB: "",
      modelLabels: {},
      skipLinkConfirm: false,
      immediateDelete: false,
      confirmMoveToTrash: true,
      setPreferredModel: (preferredModel) => set({ preferredModel }),
      setBackgroundModel: (backgroundModel) => set({ backgroundModel }),
      setOllamaUrl: (ollamaUrl) => set({ ollamaUrl }),
      setTheme: (theme) => set({ theme }),
      setAccentColor: (accentColor) => set({ accentColor }),
      setFontSize: (fontSize) => set({ fontSize }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setDualModelEnabled: (dualModelEnabled) => set({ dualModelEnabled }),
      setDraftModel: (draftModel) => set({ draftModel }),
      setCompareModelA: (compareModelA) => set({ compareModelA }),
      setCompareModelB: (compareModelB) => set({ compareModelB }),
      setModelLabel: (id, label) => set((state) => ({ modelLabels: { ...state.modelLabels, [id]: label } })),
      setSkipLinkConfirm: (skipLinkConfirm) => set({ skipLinkConfirm }),
      setImmediateDelete: (immediateDelete) => set({ immediateDelete }),
      setConfirmMoveToTrash: (confirmMoveToTrash) => set({ confirmMoveToTrash }),
    }),
    { name: "aetherium-settings" }
  )
);
