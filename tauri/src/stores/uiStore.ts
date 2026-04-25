import { create } from "zustand";

interface UIStore {
  titlebarTokenCount: number;
  setTitlebarTokenCount: (n: number) => void;
}

export const useUIStore = create<UIStore>()((set) => ({
  titlebarTokenCount: 0,
  setTitlebarTokenCount: (titlebarTokenCount) => set({ titlebarTokenCount }),
}));
