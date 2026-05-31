import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import PreferencesView from "@/views/PreferencesView";

const apiMocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsGetCore: vi.fn(),
  settingsGetAi: vi.fn(),
  settingsGetAdvanced: vi.fn(),
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
  workspaceList: vi.fn(() => Promise.resolve([])),
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
  switchWorkspaceSection: "",
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
  userChatLabel: "You",
  assistantChatLabel: "Assistant",
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
  setUserChatLabel: vi.fn(),
  setAssistantChatLabel: vi.fn(),
  setSwitchWorkspaceSection: vi.fn(),
  setHideNativeMenu: vi.fn(),
  setSummarizationModel: vi.fn(),
  setMemoryExtractionModel: vi.fn(),
  setFlashcardModel: vi.fn(),
  setGlossaryModel: vi.fn(),
  setTopicSignatureModel: vi.fn(),
  setGoalSuggestionModel: vi.fn(),
  setQuickSearchWorkspaceScope: vi.fn(),
  setQuickSearchTypeFilters: vi.fn(),
  setQuickSearchShortcut: vi.fn(),
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
  setWorkspaces: vi.fn(),
};

vi.mock("@/lib/api", () => ({
  api: {
    settings: {
      get: apiMocks.settingsGet,
      getCore: apiMocks.settingsGetCore,
      getAi: apiMocks.settingsGetAi,
      getAdvanced: apiMocks.settingsGetAdvanced,
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
    workspace: {
      list: apiMocks.workspaceList,
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

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@/views/WorkspaceSettingsView", () => ({ default: () => <div>Workspace Settings</div> }));
vi.mock("@/views/BackupSettingsSection", () => ({ default: () => <div>Backup Settings</div> }));
vi.mock("@/views/ImportSettingsSection", () => ({ default: () => <div>Import Settings</div> }));

describe("PreferencesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem("preferencesActiveTab", "ai");

    const fullSettings = {
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
      user_chat_label: "You",
      assistant_chat_label: "Assistant",
      switch_workspace_section: "",
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
      memory_extraction_threshold: 5,
      memory_extraction_idle_minutes: 5,
      topic_analysis_interval_minutes: 30,
      summarization_min_messages: 10,
      summarization_max_sessions: 5,
      git_sync_interval_minutes: 5,
    } as Record<string, unknown>;

    apiMocks.settingsGet.mockResolvedValue(fullSettings);
    apiMocks.settingsGetCore.mockResolvedValue({
      theme: fullSettings.theme,
      accent_color: fullSettings.accent_color,
      font_size: fullSettings.font_size,
      sidebar_width: fullSettings.sidebar_width,
      menubar_icon_style: "monochrome",
      hide_native_menu: fullSettings.hide_native_menu,
      switch_workspace_section: fullSettings.switch_workspace_section,
      user_chat_label: fullSettings.user_chat_label,
      assistant_chat_label: fullSettings.assistant_chat_label,
      demo_dismissed: fullSettings.demo_dismissed,
      web_session_preserve: fullSettings.web_session_preserve,
      chat_title_auto_refresh: fullSettings.chat_title_auto_refresh,
      chat_title_refresh_interval: fullSettings.chat_title_refresh_interval,
      about_you: "",
      inject_about_you_into_chat: true,
      prompt_instructions: fullSettings.prompt_instructions,
    });
    apiMocks.settingsGetAi.mockResolvedValue({
      preferred_model: fullSettings.preferred_model,
      background_model: fullSettings.background_model,
      summarization_model: "",
      memory_extraction_model: "",
      flashcard_model: "",
      glossary_model: "",
      topic_signature_model: "",
      goal_suggestion_model: "",
      embedding_model: fullSettings.embedding_model,
      draft_model: fullSettings.draft_model,
      compare_model_a: fullSettings.compare_model_a,
      compare_model_b: fullSettings.compare_model_b,
      ollama_base_url: fullSettings.ollama_base_url,
      auto_start_ollama: fullSettings.auto_start_ollama,
      mlx_base_url: fullSettings.mlx_base_url,
      llamacpp_model_paths: fullSettings.llamacpp_model_paths,
      dual_model_enabled: fullSettings.dual_model_enabled,
      dual_model_execution_mode: fullSettings.dual_model_execution_mode,
      chat_json_storage: fullSettings.chat_json_storage,
      chat_encryption_enabled: fullSettings.chat_encryption_enabled,
      show_gen_info: fullSettings.show_gen_info,
      show_gen_info_token_count: fullSettings.show_gen_info_token_count,
      show_gen_info_duration: fullSettings.show_gen_info_duration,
      show_gen_info_speed: fullSettings.show_gen_info_speed,
      show_gen_info_model: fullSettings.show_gen_info_model,
      background_inference_enabled: true,
    });
    apiMocks.settingsGetAdvanced.mockResolvedValue({
      quick_search_models: fullSettings.quick_search_models,
      quick_search_shortcut: fullSettings.quick_search_shortcut,
      quick_search_workspace_scope: "__all__",
      quick_search_type_filters: ["conversation", "message", "artifact", "memory", "summary"],
      backup_enabled: fullSettings.backup_enabled,
      touch_id_enabled: fullSettings.touch_id_enabled,
      pin_lock_enabled: fullSettings.pin_lock_enabled,
      auto_lock_minutes: fullSettings.auto_lock_minutes,
      start_at_login: fullSettings.start_at_login,
      open_in_background: fullSettings.open_in_background,
      keep_running_in_tray: fullSettings.keep_running_in_tray,
      immediate_delete: fullSettings.immediate_delete,
      confirm_move_to_trash: fullSettings.confirm_move_to_trash,
      memory_enabled: fullSettings.memory_enabled,
      memory_extraction_threshold: fullSettings.memory_extraction_threshold,
      memory_extraction_idle_minutes: fullSettings.memory_extraction_idle_minutes,
      topic_analysis_interval_minutes: fullSettings.topic_analysis_interval_minutes,
      summarization_min_messages: fullSettings.summarization_min_messages,
      summarization_max_sessions: fullSettings.summarization_max_sessions,
      hover_definition_scan_enabled: true,
      hover_definition_scan_max_sessions: 3,
      workspace_glossary_refresh_interval_minutes: 60,
      git_sync_interval_minutes: fullSettings.git_sync_interval_minutes,
      vram_headroom_gb: 0,
      vram_headroom_percent: 10,
      ram_headroom_gb: 0,
      ram_headroom_percent: 10,
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
        id: "model-llamacpp",
        name: "Local GGUF",
        model_id: "local-gguf",
        provider: "llamacpp",
        role_tags: ["chat"],
        priority: 3,
        is_paid: false,
        enabled: true,
        is_hidden: false,
        tokens_used_total: 0,
        created_at: "2026-04-10T08:10:00Z",
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
    expect(screen.getByText("Gemma 4")).toBeInTheDocument();

    // Switch to Browser Automation tab for Web AI models
    const webAiTab = screen.getByText("Browser Automation");
    fireEvent.click(webAiTab);
    
    expect(await screen.findByText("Manual Browser Targets")).toBeInTheDocument();
    expect(await screen.findByText("Browser Assistant A")).toBeInTheDocument();
    expect(screen.getByText("browser-assistant-a")).toBeInTheDocument();
  });

  it("renders read-only capability badges for Ollama models", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <PreferencesView />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Ollama", { selector: "div" })).toBeInTheDocument();
    });
    expect(await screen.findByText("gemma4:latest")).toBeInTheDocument();
    
    expect(screen.queryByTitle("Toggle chat role")).not.toBeInTheDocument();
  });

  it("does not show role controls in the add model form", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <PreferencesView />
      </MemoryRouter>,
    );

    await screen.findByText("Gemma 4");
    
    // Switch to Browser Automation tab for Add Model button
    fireEvent.click(screen.getByText("Browser Automation"));
    fireEvent.click(screen.getByRole("button", { name: /add model/i }));

    expect(screen.queryByText("Roles")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "chat" })).not.toBeInTheDocument();
  });

  it("renders and updates About You tab fields successfully", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <PreferencesView />
      </MemoryRouter>,
    );

    await screen.findByText("Gemma 4");

    // Switch to About You tab
    fireEvent.click(screen.getByText("About You"));

    // Verify displays and inputs are present
    const nameInput = screen.getByPlaceholderText("e.g. Alex");
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toHaveValue("");

    // Simulate typing and blur to check commit behavior
    fireEvent.change(nameInput, { target: { value: "Alex" } });
    expect(nameInput).toHaveValue("Alex");
    expect(apiMocks.settingsUpdate).not.toHaveBeenCalled();

    fireEvent.blur(nameInput);
    await waitFor(() => {
      expect(apiMocks.settingsUpdate).toHaveBeenCalled();
    });
  });
});
