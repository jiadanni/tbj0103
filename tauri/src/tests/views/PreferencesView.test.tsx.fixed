import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import PreferencesView from "@/views/PreferencesView";

const apiMocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsUpdate: vi.fn(() => Promise.resolve(undefined)),
  aiModelList: vi.fn(),
  aiModelListSpeedStats: vi.fn(() => Promise.resolve([])),
  systemGetSpecs: vi.fn(() => Promise.resolve({
    os_name: "macOS",
    os_version: "14.0",
    cpu_brand: "Apple M3",
    cpu_arch: "arm64",
    logical_cores: 8,
    physical_cores: 8,
    total_memory_bytes: 32_000_000_000,
    available_memory_bytes: 24_000_000_000,
    total_swap_bytes: 0,
    gpu_name: "Apple GPU",
    gpu_memory_bytes: null,
    gpu_detection_source: null,
  })),
  ollamaListModels: vi.fn(() => Promise.resolve([
    {
      name: "gemma4:latest",
      capabilities: ["vision"],
      details: { parameter_size: "4.3B" },
    },
  ])),
  ollamaListModelsFresh: vi.fn(() => Promise.resolve([
    {
      name: "gemma4:latest",
      capabilities: ["vision"],
      details: { parameter_size: "4.3B" },
    },
  ])),
  securityGetStatus: vi.fn(() => Promise.resolve({
    pin_enabled: false,
    pin_lock_enabled: false,
    touch_id_enabled: false,
    biometric_available: false,
    biometric_label: "Touch ID",
  })),
  mcpListServers: vi.fn(() => Promise.resolve([])),
  gitSyncGetStatus: vi.fn(() => Promise.resolve({
    enabled: false,
    remote_url: "",
    last_synced_at: "",
    last_error: "",
  })),
  llamacppListModels: vi.fn(() => Promise.resolve([])),
}));

const settingsStoreState = {
  settingsNavLayout: "top-tabs" as const,
  autoGenerateFlashcards: false,
  modelLabels: {},
  showGenInfo: true,
  showGenInfoTokenCount: true,
  showGenInfoDuration: true,
  showGenInfoSpeed: true,
  showGenInfoModel: true,
  scrollToTopOnSend: false,
  chatMessageStyle: "bubble" as const,
  expandChatToWindowWidth: false,
  switchWorkspaceToChat: false,
  hideNativeMenu: false,
  preferredModel: "",
  backgroundModel: "",
  quickSearchModels: [],
  ollamaUrl: "http://localhost:11434",
  mlxUrl: "http://localhost:8080",
  llamacppModelPaths: [],
  embeddingModel: "nomic-embed-text",
  theme: "system" as const,
  accentColor: "#007AFF",
  fontSize: 16,
  sidebarWidth: 240,
  dualModelEnabled: false,
  draftModel: "",
  dualModelExecutionMode: "serial" as const,
  compareModelA: "",
  compareModelB: "",
  skipLinkConfirm: false,
  immediateDelete: false,
  confirmMoveToTrash: true,
  promptInstructions: "",
  modelRefreshCounter: 0,
  setSettingsNavLayout: vi.fn(),
  setAutoGenerateFlashcards: vi.fn(),
  setShowGenInfo: vi.fn(),
  setShowGenInfoTokenCount: vi.fn(),
  setShowGenInfoDuration: vi.fn(),
  setShowGenInfoSpeed: vi.fn(),
  setShowGenInfoModel: vi.fn(),
  setScrollToTopOnSend: vi.fn(),
  setChatMessageStyle: vi.fn(),
  setExpandChatToWindowWidth: vi.fn(),
  incrementModelRefreshCounter: vi.fn(),
  setTheme: vi.fn(),
  setAccentColor: vi.fn(),
  setFontSize: vi.fn(),
  setSidebarWidth: vi.fn(),
  setPreferredModel: vi.fn(),
  setBackgroundModel: vi.fn(),
  setQuickSearchModels: vi.fn(),
  setOllamaUrl: vi.fn(),
  setMlxUrl: vi.fn(),
  setLlamacppModelPaths: vi.fn(),
  setDualModelEnabled: vi.fn(),
  setDraftModel: vi.fn(),
  setDualModelExecutionMode: vi.fn(),
  setCompareModelA: vi.fn(),
  setCompareModelB: vi.fn(),
  setSkipLinkConfirm: vi.fn(),
  setImmediateDelete: vi.fn(),
  setConfirmMoveToTrash: vi.fn(),
  setPromptInstructions: vi.fn(),
  setSwitchWorkspaceToChat: vi.fn(),
  setHideNativeMenu: vi.fn(),
  setModelLabel: vi.fn(),
};

const workspaceStoreState = {
  workspaceNavigation: "sidebar" as const,
  sectionNavigation: "sidebar" as const,
  workspaceSortOrder: "name-asc" as const,
  setWorkspaceNavigation: vi.fn(),
  setSectionNavigation: vi.fn(),
  setWorkspaceSortOrder: vi.fn(),
  isDemoMode: false,
  setDemo: vi.fn(),
};

vi.mock("@/lib/api", () => ({
  api: {
    settings: {
      get: apiMocks.settingsGet,
      update: apiMocks.settingsUpdate,
    },
    aiModel: {
      listModels: apiMocks.ollamaListModels,
      list: apiMocks.aiModelList,
      listSpeedStats: apiMocks.aiModelListSpeedStats,
      add: vi.fn(() => Promise.resolve()),
      update: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    },
    system: {
      getSpecs: apiMocks.systemGetSpecs,
    },
    ollama: {
      listModels: apiMocks.ollamaListModels,
      listModelsFresh: apiMocks.ollamaListModelsFresh,
      ensureRunning: vi.fn(),
    },
    security: {
      getStatus: apiMocks.securityGetStatus,
      setPin: vi.fn(),
      removePin: vi.fn(),
    },
    mcp: {
      listServers: apiMocks.mcpListServers,
    },
    gitSync: {
      getStatus: apiMocks.gitSyncGetStatus,
      configure: vi.fn(),
      triggerSync: vi.fn(),
    },
    llamacpp: {
      listModels: apiMocks.llamacppListModels,
    },
    mlx: {
      listModels: vi.fn(() => Promise.resolve([])),
    },
  },
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: Object.assign(
    <T,>(selector: (state: typeof settingsStoreState) => T) => selector(settingsStoreState),
    {
      getState: () => settingsStoreState,
    },
  ),
}));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: <T,>(selector: (state: typeof workspaceStoreState) => T) => selector(workspaceStoreState),
}));

vi.mock("@/views/WorkspaceSettingsView", () => ({ default: () => <div>Workspace Settings</div> }));
vi.mock("@/views/BackupSettingsSection", () => ({ default: () => <div>Backup Settings</div> }));
vi.mock("@/views/ImportSettingsSection", () => ({ default: () => <div>Import Settings</div> }));

describe("PreferencesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem("preferencesActiveTab", "ai");

    apiMocks.settingsGet.mockResolvedValue({
      theme: "system",
      accent_color: "#007AFF",
      font_size: 16,
      preferred_model: "gemma4:latest",
      background_model: "",
      quick_search_models: [],
      ollama_base_url: "http://localhost:11434",
      mlx_base_url: "http://localhost:8080",
      llamacpp_model_paths: [],
      embedding_model: "nomic-embed-text",
      dual_model_enabled: false,
      draft_model: "",
      dual_model_execution_mode: "serial",
      compare_model_a: "",
      compare_model_b: "",
      immediate_delete: false,
      confirm_move_to_trash: true,
      prompt_instructions: "",
      switch_workspace_to_chat: false,
      hide_native_menu: false,
      pin_lock_enabled: false,
      touch_id_enabled: false,
      quick_search_shortcut: "",
      web_session_preserve: false,
      chat_title_auto_refresh: "disabled",
      chat_title_refresh_interval: 5,
      backup_enabled: false,
      auto_lock_minutes: 5,
      sidebar_width: 240,
      auto_start_ollama: false,
      chat_json_storage: false,
      chat_encryption_enabled: false,
      start_at_login: false,
      open_in_background: false,
      keep_running_in_tray: false,
      show_gen_info: true,
      show_gen_info_token_count: true,
      show_gen_info_duration: true,
      show_gen_info_speed: true,
      show_gen_info_model: true,
      demo_dismissed: false,
      memory_enabled: true,
    });

    apiMocks.aiModelList.mockResolvedValue([
      {
        id: "model-1",
        name: "Gemma 4",
        model_id: "gemma4:latest",
        provider: "ollama",
        role_tags: ["chat"],
        priority: 1,
        is_paid: false,
        enabled: true,
        tokens_used_total: 0,
        created_at: "2026-04-10T08:00:00Z",
      },
      {
        id: "model-2",
        name: "ChatGPT (Web)",
        model_id: "chatgpt-web",
        provider: "web_chatgpt",
        role_tags: ["chat"],
        priority: 2,
        is_paid: false,
        enabled: false,
        tokens_used_total: 0,
        created_at: "2026-04-10T08:05:00Z",
      },
    ]);
  });

  it("renders visible provider group headers in the AI settings tab", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <PreferencesView />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(apiMocks.aiModelList).toHaveBeenCalled();
    });

    expect(await screen.findByText("Ollama", { selector: "div" })).toBeInTheDocument();
    expect(screen.getByText("Web AI", { selector: "div" })).toBeInTheDocument();
    expect(screen.getByText("Gemma 4")).toBeInTheDocument();
    expect(screen.getByText("Browser Assistant A")).toBeInTheDocument();
    expect(screen.getByText("browser-assistant-a")).toBeInTheDocument();
  });

  it("renders read-only capability badges for Ollama models", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <PreferencesView />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Vision")).toBeInTheDocument();
    expect(screen.getByText("Capabilities")).toBeInTheDocument();
    expect(screen.queryByTitle("Toggle chat role")).not.toBeInTheDocument();
  });

  it("does not show role controls in the add model form", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <PreferencesView />
      </MemoryRouter>,
    );

    await screen.findByText("Gemma 4");
    fireEvent.click(screen.getByRole("button", { name: /add model/i }));

    expect(screen.queryByText("Roles")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "chat" })).not.toBeInTheDocument();
  });
});
