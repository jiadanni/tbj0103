import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { api } from "../lib/api";
import {
  normalizeCodeBlockColorPalette,
  normalizeCodeBlockContainerStyle,
  normalizeCodeBlockKeywordColor,
  type CodeBlockColorPalette,
  type CodeBlockContainerStyle,
  type CodeBlockKeywordColor,
} from "../lib/codeBlockHighlight";
import { normalizeTheme, type Theme } from "../lib/theme";

function createDebouncedLocalStorage(delayMs: number): StateStorage {
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (typeof window !== "undefined") {
      for (const [key, value] of pending) {
        window.localStorage.setItem(key, value);
      }
    }
    pending.clear();
  };
  return {
    getItem: (name) => typeof window !== "undefined" ? window.localStorage.getItem(name) : null,
    setItem: (name, value) => {
      pending.set(name, value);
      if (timer === null) { timer = setTimeout(flush, delayMs); }
    },
    removeItem: (name) => {
      pending.delete(name);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(name);
      }
    },
  };
}

export type DualModelExecutionMode = "serial" | "parallel";
export type SettingsNavigationLayout = "top-tabs" | "side-tabs";
export type ChatMessageStyle = "bubble" | "flat" | "minimal";
export type ComposerMode = "normal" | "family";
export type { CodeBlockColorPalette, CodeBlockContainerStyle, CodeBlockKeywordColor };

interface AppSettings {
  preferredModel: string;
  backgroundModel: string;
  summarizationModel: string;
  memoryExtractionModel: string;
  flashcardModel: string;
  glossaryModel: string;
  topicSignatureModel: string;
  goalSuggestionModel: string;
  conceptHierarchyModel: string;
  workspaceAnalysisModel: string;
  quickSearchWorkspaceScope: string;
  quickSearchTypeFilters: string[];
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
  showGenInfoTokenCount: boolean;
  showGenInfoDuration: boolean;
  showGenInfoSpeed: boolean;
  showGenInfoModel: boolean;
  scrollToTopOnSend: boolean;
  chatMessageStyle: ChatMessageStyle;
  expandChatToWindowWidth: boolean;
  codeBlockContainerStyle: CodeBlockContainerStyle;
  codeBlockColorPalette: CodeBlockColorPalette;
  codeBlockKeywordColor: CodeBlockKeywordColor;
  switchWorkspaceSection: string;
  hideNativeMenu: boolean;
  showUnmanagedModels: boolean;
  modelRefreshCounter: number;
  showComposerWorkspaceSuggestions: boolean;
  showComposerChatFollowUps: boolean;
  composerMode: ComposerMode;
  modelFamilyLabels: Record<string, string>;
  customModelFamilies: string[];
  quickSearchShortcut: string;
  suppressedOversizedModels: string[];
  showStatusBar: boolean;
  userChatLabel: string;
  assistantChatLabel: string;
  webSessionPreserve: boolean;
  chatTitleAutoRefresh: "disabled" | "initial_only" | "periodic";
  chatTitleRefreshInterval: number;
  aboutYou: string;
}

export type OllamaStatus = "unknown" | "checking" | "online" | "offline";

interface SettingsStore extends AppSettings {
  ollamaStatus: OllamaStatus;
  setOllamaStatus: (status: OllamaStatus) => void;
  checkOllamaReachability: () => Promise<boolean>;
  setPreferredModel: (m: string) => void;
  setBackgroundModel: (m: string) => void;
  setSummarizationModel: (m: string) => void;
  setMemoryExtractionModel: (m: string) => void;
  setFlashcardModel: (m: string) => void;
  setGlossaryModel: (m: string) => void;
  setTopicSignatureModel: (m: string) => void;
  setGoalSuggestionModel: (m: string) => void;
  setConceptHierarchyModel: (m: string) => void;
  setWorkspaceAnalysisModel: (m: string) => void;
  setQuickSearchWorkspaceScope: (scope: string) => void;
  setQuickSearchTypeFilters: (filters: string[]) => void;
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
  setShowGenInfoTokenCount: (v: boolean) => void;
  setShowGenInfoDuration: (v: boolean) => void;
  setShowGenInfoSpeed: (v: boolean) => void;
  setShowGenInfoModel: (v: boolean) => void;
  setScrollToTopOnSend: (v: boolean) => void;
  setChatMessageStyle: (v: ChatMessageStyle) => void;
  setExpandChatToWindowWidth: (v: boolean) => void;
  setCodeBlockContainerStyle: (v: CodeBlockContainerStyle) => void;
  setCodeBlockColorPalette: (v: CodeBlockColorPalette) => void;
  setCodeBlockKeywordColor: (v: CodeBlockKeywordColor) => void;
  setSwitchWorkspaceSection: (v: string) => void;
  setHideNativeMenu: (v: boolean) => void;
  setShowUnmanagedModels: (v: boolean) => void;
  incrementModelRefreshCounter: () => void;
  setShowComposerWorkspaceSuggestions: (v: boolean) => void;
  setShowComposerChatFollowUps: (v: boolean) => void;
  setComposerMode: (v: ComposerMode) => void;
  setModelFamilyLabel: (prefix: string, label: string) => void;
  removeModelFamilyLabel: (prefix: string) => void;
  addCustomModelFamily: (family: string) => void;
  removeCustomModelFamily: (family: string) => void;
  setQuickSearchShortcut: (v: string) => void;
  addSuppressedOversizedModel: (model: string) => void;
  clearSuppressedOversizedModels: () => void;
  setShowStatusBar: (v: boolean) => void;
  setUserChatLabel: (v: string) => void;
  setAssistantChatLabel: (v: string) => void;
  setWebSessionPreserve: (v: boolean) => void;
  setChatTitleAutoRefresh: (v: "disabled" | "initial_only" | "periodic") => void;
  setChatTitleRefreshInterval: (v: number) => void;
  setAboutYou: (v: string) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      preferredModel: "",
      backgroundModel: "",
      summarizationModel: "",
      memoryExtractionModel: "",
      flashcardModel: "",
      glossaryModel: "",
      topicSignatureModel: "",
      goalSuggestionModel: "",
      conceptHierarchyModel: "",
      workspaceAnalysisModel: "",
      quickSearchWorkspaceScope: "__all__",
      quickSearchTypeFilters: ["conversation", "message", "artifact", "memory", "summary"],
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
      showGenInfoTokenCount: true,
      showGenInfoDuration: true,
      showGenInfoSpeed: true,
      showGenInfoModel: true,
      scrollToTopOnSend: false,
      chatMessageStyle: "bubble",
      expandChatToWindowWidth: false,
      codeBlockContainerStyle: "rounded",
      codeBlockColorPalette: "balanced",
      codeBlockKeywordColor: "preset",
      switchWorkspaceSection: "",
      hideNativeMenu: false,
      showUnmanagedModels: true,
      modelRefreshCounter: 0,
      showComposerWorkspaceSuggestions: true,
      showComposerChatFollowUps: true,
      composerMode: "normal",
      modelFamilyLabels: {},
      customModelFamilies: [],
      quickSearchShortcut: "CmdOrCtrl+Shift+K",
      suppressedOversizedModels: [],
      showStatusBar: true,
      userChatLabel: "You",
      assistantChatLabel: "Assistant",
      webSessionPreserve: false,
      chatTitleAutoRefresh: "initial_only",
      chatTitleRefreshInterval: 5,
      aboutYou: "",
      ollamaStatus: "unknown",
      setOllamaStatus: (ollamaStatus) => set({ ollamaStatus }),
      checkOllamaReachability: async () => {
        set({ ollamaStatus: "checking" });
        try {
          const models = await api.ollama.listModelsFresh(get().ollamaUrl || undefined);
          const reachable = Array.isArray(models);
          set({ ollamaStatus: reachable ? "online" : "offline" });
          return reachable;
        } catch {
          set({ ollamaStatus: "offline" });
          return false;
        }
      },
      setPreferredModel: (preferredModel) => set({ preferredModel }),
      setBackgroundModel: (backgroundModel) => set({ backgroundModel }),
      setSummarizationModel: (summarizationModel) => set({ summarizationModel }),
      setMemoryExtractionModel: (memoryExtractionModel) => set({ memoryExtractionModel }),
      setFlashcardModel: (flashcardModel) => set({ flashcardModel }),
      setGlossaryModel: (glossaryModel) => set({ glossaryModel }),
      setTopicSignatureModel: (topicSignatureModel) => set({ topicSignatureModel }),
      setGoalSuggestionModel: (goalSuggestionModel) => set({ goalSuggestionModel }),
      setConceptHierarchyModel: (conceptHierarchyModel) => set({ conceptHierarchyModel }),
      setWorkspaceAnalysisModel: (workspaceAnalysisModel) => set({ workspaceAnalysisModel }),
      setQuickSearchWorkspaceScope: (quickSearchWorkspaceScope) => set({ quickSearchWorkspaceScope }),
      setQuickSearchTypeFilters: (quickSearchTypeFilters) => set({ quickSearchTypeFilters }),
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
      setShowGenInfoTokenCount: (showGenInfoTokenCount) => set({ showGenInfoTokenCount }),
      setShowGenInfoDuration: (showGenInfoDuration) => set({ showGenInfoDuration }),
      setShowGenInfoSpeed: (showGenInfoSpeed) => set({ showGenInfoSpeed }),
      setShowGenInfoModel: (showGenInfoModel) => set({ showGenInfoModel }),
      setScrollToTopOnSend: (scrollToTopOnSend) => set({ scrollToTopOnSend }),
      setChatMessageStyle: (chatMessageStyle) => set({ chatMessageStyle }),
      setExpandChatToWindowWidth: (expandChatToWindowWidth) => set({ expandChatToWindowWidth }),
      setCodeBlockContainerStyle: (codeBlockContainerStyle) => set({ codeBlockContainerStyle: normalizeCodeBlockContainerStyle(codeBlockContainerStyle) }),
      setCodeBlockColorPalette: (codeBlockColorPalette) => set({ codeBlockColorPalette: normalizeCodeBlockColorPalette(codeBlockColorPalette) }),
      setCodeBlockKeywordColor: (codeBlockKeywordColor) => set({ codeBlockKeywordColor: normalizeCodeBlockKeywordColor(codeBlockKeywordColor) }),
      setSwitchWorkspaceSection: (switchWorkspaceSection) => set({ switchWorkspaceSection }),
      setHideNativeMenu: (hideNativeMenu) => set({ hideNativeMenu }),
      setShowUnmanagedModels: (showUnmanagedModels) => set({ showUnmanagedModels }),
      incrementModelRefreshCounter: () => set((state) => ({ modelRefreshCounter: state.modelRefreshCounter + 1 })),
      setShowComposerWorkspaceSuggestions: (showComposerWorkspaceSuggestions) => set({ showComposerWorkspaceSuggestions }),
      setShowComposerChatFollowUps: (showComposerChatFollowUps) => set({ showComposerChatFollowUps }),
      setComposerMode: (composerMode) => set({ composerMode }),
      setModelFamilyLabel: (prefix, label) => set((state) => ({ modelFamilyLabels: { ...state.modelFamilyLabels, [prefix]: label } })),
      removeModelFamilyLabel: (prefix) => set((state) => {
        const next = { ...state.modelFamilyLabels };
        delete next[prefix];
        return { modelFamilyLabels: next };
      }),
      addCustomModelFamily: (family) => set((state) => {
        if (state.customModelFamilies.includes(family)) {return state;}
        return { customModelFamilies: [...state.customModelFamilies, family] };
      }),
      removeCustomModelFamily: (family) => set((state) => ({
        customModelFamilies: state.customModelFamilies.filter((f) => f !== family),
      })),
      setQuickSearchShortcut: (quickSearchShortcut) => set({ quickSearchShortcut }),
      addSuppressedOversizedModel: (model) => set((state) => (
        state.suppressedOversizedModels.includes(model)
          ? state
          : { suppressedOversizedModels: [...state.suppressedOversizedModels, model] }
      )),
      clearSuppressedOversizedModels: () => set({ suppressedOversizedModels: [] }),
      setShowStatusBar: (showStatusBar) => set({ showStatusBar }),
      setUserChatLabel: (userChatLabel) => set({ userChatLabel }),
      setAssistantChatLabel: (assistantChatLabel) => set({ assistantChatLabel }),
      setWebSessionPreserve: (webSessionPreserve) => set({ webSessionPreserve }),
      setChatTitleAutoRefresh: (chatTitleAutoRefresh) => set({ chatTitleAutoRefresh }),
      setChatTitleRefreshInterval: (chatTitleRefreshInterval) => set({ chatTitleRefreshInterval }),
      setAboutYou: (aboutYou) => set({ aboutYou }),
    }),
    {
      name: "aetherium-settings",
      storage: createJSONStorage(() => createDebouncedLocalStorage(200)),
      // modelRefreshCounter and ollamaStatus are transient signals — never persist them.
      partialize: (state) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { modelRefreshCounter, ollamaStatus, ...rest } = state;
        return rest as Omit<SettingsStore, "modelRefreshCounter" | "ollamaStatus">;
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
          codeBlockContainerStyle: normalizeCodeBlockContainerStyle(state.codeBlockContainerStyle ?? currentState.codeBlockContainerStyle),
          codeBlockColorPalette: normalizeCodeBlockColorPalette(state.codeBlockColorPalette ?? currentState.codeBlockColorPalette),
          codeBlockKeywordColor: normalizeCodeBlockKeywordColor(state.codeBlockKeywordColor ?? currentState.codeBlockKeywordColor),
          // Always reset transient state on startup.
          modelRefreshCounter: 0,
          ollamaStatus: "unknown",
        };
      },
    }
  )
);
