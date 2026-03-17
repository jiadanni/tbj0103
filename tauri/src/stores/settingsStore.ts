import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "system" | "light" | "dark" | "oled" | "sepia" | "hacker";

interface AppSettings {
  preferredModel: string;
  ollamaUrl: string;
  embeddingModel: string;
  theme: Theme;
  accentColor: string;
  fontSize: number;
  sidebarWidth: number;
  dualModelEnabled: boolean;
  draftModel: string;
}

interface SettingsStore extends AppSettings {
  setPreferredModel: (m: string) => void;
  setOllamaUrl: (url: string) => void;
  setTheme: (t: Theme) => void;
  setAccentColor: (c: string) => void;
  setFontSize: (n: number) => void;
  setSidebarWidth: (n: number) => void;
  setDualModelEnabled: (v: boolean) => void;
  setDraftModel: (m: string) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      preferredModel: "",
      ollamaUrl: "http://localhost:11434",
      embeddingModel: "nomic-embed-text",
      theme: "system",
      accentColor: "#007AFF",
      fontSize: 14,
      sidebarWidth: 240,
      dualModelEnabled: false,
      draftModel: "",
      setPreferredModel: (preferredModel) => set({ preferredModel }),
      setOllamaUrl: (ollamaUrl) => set({ ollamaUrl }),
      setTheme: (theme) => set({ theme }),
      setAccentColor: (accentColor) => set({ accentColor }),
      setFontSize: (fontSize) => set({ fontSize }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setDualModelEnabled: (dualModelEnabled) => set({ dualModelEnabled }),
      setDraftModel: (draftModel) => set({ draftModel }),
    }),
    { name: "aetherium-settings" }
  )
);
