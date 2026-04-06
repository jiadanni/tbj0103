import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalizeTheme, type Theme } from "../lib/theme";

export type DualModelExecutionMode = "serial" | "parallel";
export type SettingsNavigationLayout = "top-tabs" | "side-tabs";
export type ChatMessageStyle = "bubble" | "flat";

interface AppSettings {
  preferredModel: string;
  backgroundModel: string;
  quickSearchModels: string[];
  ollamaUrl: string;
  mlxUrl: string;
  llamacppModelPaths: string[];
  embeddingModel: string;
  theme: Theme;
  accentColor: string;
  fontSize: number;
  sidebarWidth: number;
  settingsNavLayout: SettingsNavigationLayout;
  dualModelEnabled: boolean;
  draftModel: string;
  dualModelExecutionMode: DualModelExecutionMode;
  compareModelA: string;
  compareModelB: string;
  modelLabels: Record<string, string>;
  skipLinkConfirm: boolean;
  immediateDelete: boolean;
  confirmMoveToTrash: boolean;
  promptInstructions: string;
  autoGenerateFlashcards: boolean;
  showGenInfo: boolean;
  scrollToTopOnSend: boolean;
  chatMessageStyle: ChatMessageStyle;
  expandChatToWindowWidth: boolean;
  switchWorkspaceToChat: boolean;
  hideNativeMenu: boolean;
  modelRefreshCounter: number;
}

interface SettingsStore extends AppSettings {
  setPreferredModel: (m: string) => void;
  setBackgroundModel: (m: string) => void;
  setQuickSearchModels: (models: string[]) => void;
  setOllamaUrl: (url: string) => void;
  setMlxUrl: (url: string) => void;
  setLlamacppModelPaths: (paths: string[]) => void;
  setTheme: (t: Theme) => void;
  setAccentColor: (c: string) => void;
  setFontSize: (n: number) => void;
  setSidebarWidth: (n: number) => void;
  setSettingsNavLayout: (layout: SettingsNavigationLayout) => void;
  setDualModelEnabled: (v: boolean) => void;
  setDraftModel: (m: string) => void;
  setDualModelExecutionMode: (mode: DualModelExecutionMode) => void;
  setCompareModelA: (m: string) => void;
  setCompareModelB: (m: string) => void;
  setModelLabel: (id: string, label: string) => void;
  setSkipLinkConfirm: (v: boolean) => void;
  setImmediateDelete: (v: boolean) => void;
  setConfirmMoveToTrash: (v: boolean) => void;
  setPromptInstructions: (v: string) => void;
  setAutoGenerateFlashcards: (v: boolean) => void;
  setShowGenInfo: (v: boolean) => void;
  setScrollToTopOnSend: (v: boolean) => void;
  setChatMessageStyle: (v: ChatMessageStyle) => void;
  setExpandChatToWindowWidth: (v: boolean) => void;
  setSwitchWorkspaceToChat: (v: boolean) => void;
  setHideNativeMenu: (v: boolean) => void;
  incrementModelRefreshCounter: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      preferredModel: "",
      backgroundModel: "",
      quickSearchModels: [],
      ollamaUrl: "http://localhost:11434",
      mlxUrl: "http://localhost:8080",
      llamacppModelPaths: [],
      embeddingModel: "nomic-embed-text",
      theme: "system",
      accentColor: "#007AFF",
      fontSize: 16,
      sidebarWidth: 240,
      settingsNavLayout: "top-tabs",
      dualModelEnabled: false,
      draftModel: "",
      dualModelExecutionMode: "serial",
      compareModelA: "",
      compareModelB: "",
      modelLabels: {},
      skipLinkConfirm: false,
      immediateDelete: false,
      confirmMoveToTrash: true,
      promptInstructions: "",
      autoGenerateFlashcards: false,
      showGenInfo: true,
      scrollToTopOnSend: false,
      chatMessageStyle: "bubble",
      expandChatToWindowWidth: false,
      switchWorkspaceToChat: false,
      hideNativeMenu: false,
      modelRefreshCounter: 0,
      setPreferredModel: (preferredModel) => set({ preferredModel }),
      setBackgroundModel: (backgroundModel) => set({ backgroundModel }),
      setQuickSearchModels: (quickSearchModels) => set({ quickSearchModels }),
      setOllamaUrl: (ollamaUrl) => set({ ollamaUrl }),
      setMlxUrl: (mlxUrl) => set({ mlxUrl }),
      setLlamacppModelPaths: (llamacppModelPaths) => set({ llamacppModelPaths }),
      setTheme: (theme) => set({ theme: normalizeTheme(theme) }),
      setAccentColor: (accentColor) => set({ accentColor }),
      setFontSize: (fontSize) => set({ fontSize }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setSettingsNavLayout: (settingsNavLayout) => set({ settingsNavLayout }),
      setDualModelEnabled: (dualModelEnabled) => set({ dualModelEnabled }),
      setDraftModel: (draftModel) => set({ draftModel }),
      setDualModelExecutionMode: (dualModelExecutionMode) => set({ dualModelExecutionMode }),
      setCompareModelA: (compareModelA) => set({ compareModelA }),
      setCompareModelB: (compareModelB) => set({ compareModelB }),
      setModelLabel: (id, label) => set((state) => ({ modelLabels: { ...state.modelLabels, [id]: label } })),
      setSkipLinkConfirm: (skipLinkConfirm) => set({ skipLinkConfirm }),
      setImmediateDelete: (immediateDelete) => set({ immediateDelete }),
      setConfirmMoveToTrash: (confirmMoveToTrash) => set({ confirmMoveToTrash }),
      setPromptInstructions: (promptInstructions) => set({ promptInstructions }),
      setAutoGenerateFlashcards: (autoGenerateFlashcards) => set({ autoGenerateFlashcards }),
      setShowGenInfo: (showGenInfo) => set({ showGenInfo }),
      setScrollToTopOnSend: (scrollToTopOnSend) => set({ scrollToTopOnSend }),
      setChatMessageStyle: (chatMessageStyle) => set({ chatMessageStyle }),
      setExpandChatToWindowWidth: (expandChatToWindowWidth) => set({ expandChatToWindowWidth }),
      setSwitchWorkspaceToChat: (switchWorkspaceToChat) => set({ switchWorkspaceToChat }),
      setHideNativeMenu: (hideNativeMenu) => set({ hideNativeMenu }),
      incrementModelRefreshCounter: () => set((state) => ({ modelRefreshCounter: state.modelRefreshCounter + 1 })),
    }),
    {
      name: "aetherium-settings",
      // modelRefreshCounter is a transient signal — never persist it.
      partialize: (state) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { modelRefreshCounter, ...rest } = state;
        return rest as Omit<SettingsStore, "modelRefreshCounter">;
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as
          | Partial<SettingsStore>
          | { state?: Partial<SettingsStore> }
          | undefined;
        const state = (persisted && "state" in persisted && persisted.state
          ? persisted.state
          : persisted) as Partial<SettingsStore> | undefined;

        if (!state) {
          return currentState;
        }

        return {
          ...currentState,
          ...state,
          theme: normalizeTheme(state.theme ?? currentState.theme),
          // Always reset to 0 on startup — it's a transient counter.
          modelRefreshCounter: 0,
        };
      },
    }
  )
);
