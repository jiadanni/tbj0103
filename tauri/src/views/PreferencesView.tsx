/**
 * PreferencesView — integrated preferences hub with focused tabs for app,
 * navigation, appearance, chat, AI, security, backup, and workspace controls.
 */
import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Palette, Bot, ShieldCheck, HardDrive, ChevronUp, ChevronDown, Trash2, Plus, LayoutGrid, Network, Globe, Pencil, RefreshCw, GitBranch, Settings as SettingsIcon, MessageSquare, FileText, FolderInput, Info } from "lucide-react";
import { api, type AppSettings, type AiModel, type MCPServerConfig, type GitSyncStatus, type SecurityStatus, type OllamaModel, type SystemSpecs } from "../lib/api";
import { MODEL_ROLE_OPTIONS, type ModelRole } from "../lib/modelRoles";
import { classifyModelFit, formatBytes, formatParams, inferHardwareModelGuidance, parseModelParamsB } from "../lib/modelSizing";
import { ACCENT_COLORS, THEMES, normalizeTheme } from "../lib/theme";
import { useSettingsStore, type ChatMessageStyle } from "../stores/settingsStore";
import { type NavigationPresentation, type SplitNavigationPresentation, useWorkspaceStore } from "../stores/workspaceStore";
import WorkspaceSettingsView from "./WorkspaceSettingsView";
import BackupSettingsSection from "./BackupSettingsSection";
import ImportSettingsSection from "./ImportSettingsSection";
import { MOD_KEY, isMac } from "../lib/platform";
import type { PreferencesSection } from "../components/navigationItems";

const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 22;
const DEFAULT_FONT_SIZE = 16;

const TABS: { id: PreferencesSection; label: string; Icon: React.ElementType }[] = [
  { id: "app",         label: "App",         Icon: SettingsIcon },
  { id: "navigation",  label: "Navigation",  Icon: LayoutGrid },
  { id: "appearance",  label: "Appearance",  Icon: Palette },
  { id: "chat",        label: "Chat",        Icon: MessageSquare },
  { id: "ai",          label: "AI",          Icon: Bot },
  { id: "webai",       label: "Browser Automation", Icon: Globe },
  { id: "security",    label: "Security",    Icon: ShieldCheck },
  { id: "workspaces",  label: "Workspaces",  Icon: LayoutGrid },
  { id: "backup",      label: "Backup",      Icon: HardDrive },
  { id: "import",      label: "Import",      Icon: FolderInput },
  { id: "mcp",         label: "MCP",         Icon: Network },
  { id: "sync",        label: "Sync",        Icon: GitBranch },
];

function normalizePreferencesSection(section: string | undefined): PreferencesSection | null {
  if (section === "general") {
    return "app";
  }
  return TABS.some((tab) => tab.id === section) ? section as PreferencesSection : null;
}

const IMMEDIATE_SAVE_EXCEPTIONS = new Set<keyof AppSettings>([]);

function Toggle({ on, onToggle, disabled = false }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <div
      onClick={() => {
        if (!disabled) {
          onToggle();
        }
      }}
      role="switch"
      aria-checked={on}
      aria-disabled={disabled}
      className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${on ? "bg-[var(--accent-color)]" : "bg-[var(--bg-hover)]"}`}
    >
      <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0"}`} />
    </div>
  );
}

function normalizeAppSettingsTheme(settings: AppSettings): AppSettings {
  return {
    ...settings,
    theme: normalizeTheme(settings.theme),
  };
}

function formatSystemName(specs: SystemSpecs): string {
  return [specs.os_name, specs.os_version].filter(Boolean).join(" ");
}

function ollamaModelDetails(model: OllamaModel, systemSpecs: SystemSpecs | null): string {
  const params = parseModelParamsB(model.name);
  const details: string[] = [];
  const formattedParams = formatParams(params);
  if (formattedParams) {
    details.push(formattedParams);
  } else if (typeof model.size === "number" && model.size > 0) {
    details.push(formatBytes(model.size));
  }

  if (systemSpecs) {
    const guidance = inferHardwareModelGuidance(systemSpecs);
    const fit = classifyModelFit(params, guidance.recommendedMaxParamsB);
    if (fit === "good") {
      details.push("fits this machine");
    } else if (fit === "stretch") {
      details.push("stretch");
    } else if (fit === "too-large") {
      details.push("likely heavy");
    }
  }

  return details.join(" - ");
}

export default function PreferencesView() {
  const pillSelectClassName = "h-10 w-full appearance-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] pl-3 pr-9 text-sm text-[var(--text-primary)] shadow-sm outline-none transition-colors hover:border-[var(--accent-color)] focus:border-[var(--accent-color)]";
  const settingsNavLayout = useSettingsStore((state) => state.settingsNavLayout);
  const setSettingsNavLayout = useSettingsStore((state) => state.setSettingsNavLayout);
  const autoGenerateFlashcards = useSettingsStore((state) => state.autoGenerateFlashcards);
  const setAutoGenerateFlashcards = useSettingsStore((state) => state.setAutoGenerateFlashcards);
  const modelLabels = useSettingsStore((state) => state.modelLabels);
  const setModelLabel = useSettingsStore((state) => state.setModelLabel);
  const showGenInfo = useSettingsStore((state) => state.showGenInfo);
  const setShowGenInfo = useSettingsStore((state) => state.setShowGenInfo);
  const scrollToTopOnSend = useSettingsStore((state) => state.scrollToTopOnSend);
  const setScrollToTopOnSend = useSettingsStore((state) => state.setScrollToTopOnSend);
  const chatMessageStyle = useSettingsStore((state) => state.chatMessageStyle);
  const setChatMessageStyle = useSettingsStore((state) => state.setChatMessageStyle);
  const expandChatToWindowWidth = useSettingsStore((state) => state.expandChatToWindowWidth);
  const setExpandChatToWindowWidth = useSettingsStore((state) => state.setExpandChatToWindowWidth);
  const switchWorkspaceToChat = useSettingsStore((state) => state.switchWorkspaceToChat);
  const location = useLocation();
  const workspaceNavigation = useWorkspaceStore((state) => state.workspaceNavigation);
  const sectionNavigation = useWorkspaceStore((state) => state.sectionNavigation);
  const splitWorkspaceNavigation = useWorkspaceStore((state) => state.splitWorkspaceNavigation);
  const splitSectionNavigation = useWorkspaceStore((state) => state.splitSectionNavigation);
  const workspaceSortOrder = useWorkspaceStore((state) => state.workspaceSortOrder);
  const setWorkspaceNavigation = useWorkspaceStore((state) => state.setWorkspaceNavigation);
  const setSectionNavigation = useWorkspaceStore((state) => state.setSectionNavigation);
  const setSplitWorkspaceNavigation = useWorkspaceStore((state) => state.setSplitWorkspaceNavigation);
  const incrementModelRefreshCounter = useSettingsStore((state) => state.incrementModelRefreshCounter);
  const setSplitSectionNavigation = useWorkspaceStore((state) => state.setSplitSectionNavigation);
  const setWorkspaceSortOrder = useWorkspaceStore((state) => state.setWorkspaceSortOrder);

  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [activeTab, setActiveTab] = useState<PreferencesSection>(() => (window.localStorage.getItem("preferencesActiveTab") as PreferencesSection) || "app");

  // Handle external tab switching via router state
  useEffect(() => {
    window.localStorage.setItem("preferencesActiveTab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    const state = location.state as { settingsTab?: string } | null;
    const nextTab = normalizePreferencesSection(state?.settingsTab);
    if (nextTab) {
      setActiveTab(nextTab);
      // Clear state so it doesn't persist on manual refreshes
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const [dbSettings, setDbSettings] = useState<AppSettings | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [_saveError, setSaveError] = useState<string | null>(null);
  const [testingOllama, setTestingOllama] = useState(false);
  const [startingOllama, setStartingOllama] = useState(false);
  const [ollamaTestResult, setOllamaTestResult] = useState<{ success: boolean; msg: string } | null>(null);
  const [ollamaReachable, setOllamaReachable] = useState<boolean | null>(null);
  const [testingMlx, setTestingMlx] = useState(false);
  const [mlxTestResult, setMlxTestResult] = useState<{ success: boolean; msg: string } | null>(null);
  const [mlxModels, setMlxModels] = useState<string[]>([]);
  const [llamacppModels, setLlamacppModels] = useState<string[]>([]);
  const [_refreshingLlamacpp, setRefreshingLlamacpp] = useState(false);
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false);
  const [hasLoadedOllamaModels, setHasLoadedOllamaModels] = useState(false);
  const [systemSpecs, setSystemSpecs] = useState<SystemSpecs | null>(null);
  const [systemSpecsLoading, setSystemSpecsLoading] = useState(false);
  const [systemSpecsError, setSystemSpecsError] = useState<string | null>(null);
  const dbSettingsRef = useRef<AppSettings | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveNoticeTimeoutRef = useRef<number | null>(null);
  const ollamaModelsRequestRef = useRef(0);

  const [aiModels, setAiModels] = useState<AiModel[]>([]);
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus | null>(null);
  const [showAddModel, setShowAddModel] = useState(false);
  const [newModelId, setNewModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [newModelIsPaid, setNewModelIsPaid] = useState(false);
  const [newModelRoles, setNewModelRoles] = useState<ModelRole[]>(["chat"]);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const systemGuidance = systemSpecs
    ? inferHardwareModelGuidance(systemSpecs)
    : null;
  const ollamaModelNames = ollamaModels.map((model) => model.name);
  const nonEmbeddingOllamaModels = ollamaModels.filter((model) => !model.name.toLowerCase().includes("embed"));

  async function refreshLlamacppModels(paths: string[]) {
    if (paths.length === 0) {
      setLlamacppModels([]);
      return;
    }
    setRefreshingLlamacpp(true);
    try {
      const models = await api.llamacpp.listModels(paths);
      setLlamacppModels(models);
    } catch (e) {
      console.error("Failed to refresh llama.cpp models:", e);
    } finally {
      setRefreshingLlamacpp(false);
    }
  }

  useEffect(() => {
    if (dbSettings?.llamacpp_model_paths) {
      refreshLlamacppModels(dbSettings.llamacpp_model_paths);
    }
  }, [dbSettings?.llamacpp_model_paths]);

  // MCP state
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [showAddMcpServer, setShowAddMcpServer] = useState(false);
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpCommand, setNewMcpCommand] = useState("");
  const [newMcpArgs, setNewMcpArgs] = useState("");

  // Git sync state
  const [gitSync, setGitSync] = useState<GitSyncStatus | null>(null);
  const [gitSyncUrl, setGitSyncUrl] = useState("");
  const [gitSyncing, setGitSyncing] = useState(false);
  const [gitSyncSaving, setGitSyncSaving] = useState(false);
  const isGitSyncSshUrl = gitSyncUrl.trim().startsWith("git@") || gitSyncUrl.trim().startsWith("ssh://");
  const [quickSearchShortcutDraft, setQuickSearchShortcutDraft] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [pinMessage, setPinMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  useEffect(() => {
    dbSettingsRef.current = dbSettings;
  }, [dbSettings]);

  useEffect(() => () => {
    if (saveNoticeTimeoutRef.current !== null) {
      window.clearTimeout(saveNoticeTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    setQuickSearchShortcutDraft(dbSettings?.quick_search_shortcut ?? "");
  }, [dbSettings?.quick_search_shortcut]);

  function syncClientSettings(settings: AppSettings) {
    const settingsStore = useSettingsStore.getState();
    settingsStore.setTheme(normalizeTheme(settings.theme));
    settingsStore.setAccentColor(settings.accent_color);
    settingsStore.setFontSize(settings.font_size);
    settingsStore.setPreferredModel(settings.preferred_model);
    settingsStore.setBackgroundModel(settings.background_model);
    settingsStore.setQuickSearchModels(settings.quick_search_models);
    settingsStore.setOllamaUrl(settings.ollama_base_url);
    settingsStore.setMlxUrl(settings.mlx_base_url);
    settingsStore.setLlamacppModelPaths(settings.llamacpp_model_paths);
    settingsStore.setDualModelEnabled(settings.dual_model_enabled);
    settingsStore.setDraftModel(settings.draft_model);
    settingsStore.setDualModelExecutionMode(settings.dual_model_execution_mode);
    settingsStore.setCompareModelA(settings.compare_model_a);
    settingsStore.setCompareModelB(settings.compare_model_b);
    settingsStore.setImmediateDelete(settings.immediate_delete);
    settingsStore.setConfirmMoveToTrash(settings.confirm_move_to_trash);
    settingsStore.setPromptInstructions(settings.prompt_instructions);
    settingsStore.setSwitchWorkspaceToChat(settings.switch_workspace_to_chat);
    settingsStore.setHideNativeMenu(settings.hide_native_menu);
  }

  function scheduleSavedNoticeReset() {
    if (saveNoticeTimeoutRef.current !== null) {
      window.clearTimeout(saveNoticeTimeoutRef.current);
    }
    saveNoticeTimeoutRef.current = window.setTimeout(() => {
      setSaveStatus("idle");
      saveNoticeTimeoutRef.current = null;
    }, 1600);
  }

  function persistSettings(nextSettings: AppSettings) {
    setSaveStatus("saving");
    setSaveError(null);
    saveQueueRef.current = saveQueueRef.current
      .catch(() => {})
      .then(async () => {
        await api.settings.update(nextSettings);
        setSaveStatus("saved");
        scheduleSavedNoticeReset();
      })
      .catch((err) => {
        setSaveStatus("error");
        setSaveError(err instanceof Error ? err.message : "Unable to save settings.");
      });
  }

  function updateSettings(patch: Partial<AppSettings>) {
    const current = dbSettingsRef.current;
    if (!current) {return;}

    const nextSettings = { ...current, ...patch };
    dbSettingsRef.current = nextSettings;
    setDbSettings(nextSettings);
    syncClientSettings(nextSettings);

    const changedKeys = Object.keys(patch) as Array<keyof AppSettings>;
    if (changedKeys.some((key) => !IMMEDIATE_SAVE_EXCEPTIONS.has(key))) {
      persistSettings(nextSettings);
    }
  }

  function loadAiModels() {
    api.aiModel.list().then((models) => {
      setAiModels(models);
      // Sync names to modelLabels store
      models.forEach((m) => {
        if (m.name && useSettingsStore.getState().modelLabels[m.model_id] !== m.name) {
          useSettingsStore.getState().setModelLabel(m.model_id, m.name);
        }
      });
    }).catch(() => {});
  }

  function toggleRole(currentRoles: string[], role: ModelRole) {
    return currentRoles.includes(role)
      ? currentRoles.filter((value) => value !== role)
      : [...currentRoles, role];
  }

  function toggleQuickSearchModel(modelId: string) {
    if (!dbSettings) {return;}
    const next = dbSettings.quick_search_models.includes(modelId)
      ? dbSettings.quick_search_models.filter((value) => value !== modelId)
      : [...dbSettings.quick_search_models, modelId];
    set("quick_search_models", next);
    incrementModelRefreshCounter();
  }

  function loadSystemSpecs() {
    setSystemSpecsLoading(true);
    setSystemSpecsError(null);
    api.system.getSpecs()
      .then((specs) => {
        setSystemSpecs(specs);
      })
      .catch((error) => {
        setSystemSpecsError(error instanceof Error ? error.message : "Unable to read system specs.");
      })
      .finally(() => {
        setSystemSpecsLoading(false);
      });
  }

  function refreshOllamaModels(ollamaUrl: string, options?: { clearResult?: boolean }) {
    const requestId = ++ollamaModelsRequestRef.current;
    setOllamaModelsLoading(true);
    if (options?.clearResult) {
      setOllamaTestResult(null);
      setOllamaReachable(null);
    }

    api.ollama.listModelsFresh(ollamaUrl || undefined)
      .then((models) => {
        if (requestId !== ollamaModelsRequestRef.current) {return;}
        setOllamaReachable(true);
        setOllamaModels(models);
      })
      .catch(() => {
        if (requestId !== ollamaModelsRequestRef.current) {return;}
        setOllamaReachable(false);
        setOllamaModels([]);
      })
      .finally(() => {
        if (requestId !== ollamaModelsRequestRef.current) {return;}
        setOllamaModelsLoading(false);
        setHasLoadedOllamaModels(true);
      });
  }

  function applyOllamaRuntimeStatus(status: { available: boolean; message: string; models: OllamaModel[] }) {
    setOllamaReachable(status.available);
    setOllamaModels(status.models);
    setHasLoadedOllamaModels(true);
    setOllamaModelsLoading(false);
    setOllamaTestResult({ success: status.available, msg: status.message });
  }

  useEffect(() => {
    api.settings.get().then((s) => {
      const normalizedSettings = normalizeAppSettingsTheme(s);
      setDbSettings(normalizedSettings);
      dbSettingsRef.current = normalizedSettings;
      syncClientSettings(normalizedSettings);
      refreshOllamaModels(normalizedSettings.ollama_base_url);
    }).catch(() => {});
    loadSystemSpecs();
    loadAiModels();
    api.security.getStatus().then(setSecurityStatus).catch(() => {});
    api.mcp.listServers().then(setMcpServers).catch(() => {});
    api.gitSync.getStatus().then((s) => { setGitSync(s); setGitSyncUrl(s.remote_url); }).catch(() => {});
  }, []);

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    updateSettings({ [key]: value } as Partial<AppSettings>);
  }

  function setAppearance<K extends "theme" | "accent_color" | "font_size">(key: K, value: AppSettings[K]) {
    updateSettings({ [key]: value } as Partial<AppSettings>);
  }

  function resetPinForm() {
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
  }

  async function handleSetPin() {
    if (!dbSettings) {return;}

    const hadConfiguredPin = securityStatus?.pin_enabled ?? false;
    setPinMessage(null);

    if (!/^\d{4,8}$/.test(newPin)) {
      setPinMessage({ type: "error", text: "PIN must be 4 to 8 digits." });
      return;
    }

    if (newPin !== confirmPin) {
      setPinMessage({ type: "error", text: "New PIN and confirmation do not match." });
      return;
    }

    if (hadConfiguredPin && !/^\d{4,8}$/.test(currentPin)) {
      setPinMessage({ type: "error", text: "Enter your current PIN to change it." });
      return;
    }

    setPinSaving(true);
    try {
      await api.security.setPin(newPin, hadConfiguredPin ? currentPin : undefined);
      const refreshedStatus = await api.security.getStatus();
      setSecurityStatus(refreshedStatus);
      resetPinForm();
      setPinMessage({
        type: "success",
        text: hadConfiguredPin
          ? "PIN updated."
          : dbSettings.pin_lock_enabled
          ? "PIN saved."
          : "PIN saved. Enable app lock to require it on launch.",
      });
    } catch (err) {
      setPinMessage({ type: "error", text: err instanceof Error ? err.message : "Unable to save PIN." });
    } finally {
      setPinSaving(false);
    }
  }
  async function handleRemovePin() {
    if (!dbSettings) {return;}

    setPinMessage(null);
    if (!/^\d{4,8}$/.test(currentPin)) {
      setPinMessage({ type: "error", text: "Enter your current PIN to remove it." });
      return;
    }

    setPinSaving(true);
    try {
      await api.security.removePin(currentPin);
      const refreshedStatus = await api.security.getStatus();
      setSecurityStatus(refreshedStatus);
      setDbSettings((prev) => prev ? { ...prev, pin_lock_enabled: false, touch_id_enabled: false } : prev);
      resetPinForm();
      setPinMessage({ type: "success", text: "PIN removed." });
    } catch (err) {
      setPinMessage({ type: "error", text: err instanceof Error ? err.message : "Unable to remove PIN." });
    } finally {
      setPinSaving(false);
    }
  }
  if (!dbSettings) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
        Loading preferences…
      </div>
    );
  }

  const pinConfigured = securityStatus?.pin_enabled ?? false;
  const biometricAvailable = securityStatus?.biometric_available ?? false;
  const biometricLabel = securityStatus?.biometric_label ?? "Biometric authentication";
  const anyLockEnabled = dbSettings.pin_lock_enabled || dbSettings.touch_id_enabled;

  const settingsTabButtons = (
    <div className={settingsNavLayout === "top-tabs" ? "flex gap-1.5 overflow-x-auto pb-0.5" : "flex flex-col gap-1.5"}>
      {TABS.map(({ id, label, Icon }, idx) => (
        <button
          key={id}
          onClick={() => setActiveTab(id)}
          title={`${label} (${MOD_KEY}⇧${idx + 1})`}
          className={`flex items-center gap-2 whitespace-nowrap transition-colors ${
            settingsNavLayout === "top-tabs"
              ? `px-3.5 py-2.5 text-sm rounded-t-lg border-b-2 ${
                  activeTab === id
                    ? "border-[var(--accent-color)] text-[var(--accent-color)] font-medium"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`
              : `w-full rounded-xl px-3 py-2 text-left text-sm ${
                  activeTab === id
                    ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
                }`
          }`}
        >
          <Icon size={15} />
          {label}
        </button>
      ))}
    </div>
  );

  const autosaveStatus = saveStatus === "saving"
    ? "Saving..."
    : saveStatus === "saved"
    ? "Saved"
    : saveStatus === "error"
    ? "Save failed"
    : "Changes save automatically";

  const autosaveStatusClassName = saveStatus === "error"
    ? "text-red-400"
    : saveStatus === "saved"
    ? "text-emerald-400"
    : "text-[var(--text-muted)]";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {settingsNavLayout === "top-tabs" ? (
        <div className="flex items-center justify-between px-4 pt-3 pb-0 border-b border-[var(--border-color)] flex-shrink-0">
          {settingsTabButtons}
          <div className={`mb-1 text-xs ${autosaveStatusClassName}`}>{autosaveStatus}</div>
        </div>
      ) : (
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] flex-shrink-0">
          <div>
            <h1 className="text-sm font-semibold text-[var(--text-primary)]">Preferences</h1>
            <p className="text-[11px] text-[var(--text-muted)]">App configuration and workspace management</p>
          </div>
          <div className={`text-xs ${autosaveStatusClassName}`}>{autosaveStatus}</div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {settingsNavLayout === "side-tabs" && (
          <aside className="w-60 shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 py-4 overflow-y-auto">
            {settingsTabButtons}
          </aside>
        )}

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      {(activeTab === "app" || activeTab === "navigation" || activeTab === "appearance" || activeTab === "chat" || activeTab === "ai" || activeTab === "security" || activeTab === "webai" || activeTab === "sync") && (
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
        <div className="max-w-lg space-y-5">

          {/* ── App ── */}
          {activeTab === "app" && (
            <>
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Startup & background</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Control how Aetherium launches and whether it stays available after the main window closes.
                  </p>
                </div>

                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm text-[var(--text-secondary)]">Start at login</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">Automatically launch Aetherium when you log in</p>
                  </div>
                  <Toggle
                    on={dbSettings.start_at_login}
                    onToggle={() => {
                      const nextStartAtLogin = !dbSettings.start_at_login;
                      set("start_at_login", nextStartAtLogin);
                      if (!nextStartAtLogin && dbSettings.open_in_background) {
                        set("open_in_background", false);
                      }
                    }}
                  />
                </div>

                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className={`text-sm ${dbSettings.start_at_login ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}`}>Open in background</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      {dbSettings.start_at_login
                        ? "Launch without bringing window to front"
                        : "Available only when Start at login is enabled"}
                    </p>
                  </div>
                  <Toggle
                    on={dbSettings.open_in_background}
                    disabled={!dbSettings.start_at_login}
                    onToggle={() => set("open_in_background", !dbSettings.open_in_background)}
                  />
                </div>

                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm text-[var(--text-secondary)]">Keep running in tray</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Closing the main window keeps the menu bar or tray app alive so quick search still works.
                    </p>
                  </div>
                  <Toggle
                    on={dbSettings.keep_running_in_tray}
                    onToggle={() => set("keep_running_in_tray", !dbSettings.keep_running_in_tray)}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Shortcut</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Set the global accelerator used to open quick search from anywhere.
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-[var(--text-secondary)]">Quick search shortcut</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Use a Tauri accelerator like <code>CmdOrCtrl+Shift+K</code>. Leave blank to disable the global hotkey.
                    </p>
                  </div>
                  <button
                    onClick={() => set("quick_search_shortcut", quickSearchShortcutDraft.trim())}
                    className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--accent-color)]"
                  >
                    Apply
                  </button>
                </div>
                <input
                  value={quickSearchShortcutDraft}
                  onChange={(event) => setQuickSearchShortcutDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      set("quick_search_shortcut", quickSearchShortcutDraft.trim());
                    }
                  }}
                  placeholder="CmdOrCtrl+Shift+K"
                  className="h-11 w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                />
              </div>
            </>
          )}

          {/* ── Navigation ── */}
          {activeTab === "navigation" && (
            <>
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Main layout</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Choose how workspace and section switching is presented in the main window.
                  </p>
                </div>

                <div>
                  <label className="text-xs text-[var(--text-secondary)] mb-2 block">Workspace Navigation</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { id: "sidebar", label: "Sidebar", description: "Keep workspace switching in the left rail beside the main content." },
                      { id: "icon-bar", label: "Icon Bar", description: "Compact icon-only sidebar without text labels." },
                      { id: "top-tabs", label: "Top Tabs", description: "Show workspaces as visible tabs across the top." },
                      { id: "top-dropdown", label: "Top Dropdown", description: "Use a compact workspace picker in the top bar." },
                    ].map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setWorkspaceNavigation(option.id as NavigationPresentation)}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          workspaceNavigation === option.id
                            ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                            : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        <div className="text-xs font-medium">{option.label}</div>
                        <div className="mt-1 text-[11px] opacity-75">{option.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-[var(--text-secondary)] mb-2 block">Section Navigation</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { id: "sidebar", label: "Sidebar", description: "Keep section navigation in the left rail." },
                      { id: "icon-bar", label: "Icon Bar", description: "Compact icon-only sidebar without text labels." },
                      { id: "top-tabs", label: "Top Tabs", description: "Show sections as visible tabs across the top." },
                      { id: "top-dropdown", label: "Top Dropdown", description: "Use a compact section picker in the top bar." },
                    ].map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setSectionNavigation(option.id as NavigationPresentation)}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          sectionNavigation === option.id
                            ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                            : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        <div className="text-xs font-medium">{option.label}</div>
                        <div className="mt-1 text-[11px] opacity-75">{option.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Split view</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Override how navigation is shown when a secondary pane is open.
                  </p>
                </div>

                <div>
                  <label className="text-xs text-[var(--text-secondary)] mb-2 block">Split Workspace Navigation</label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      { id: "match-main", label: "Same", description: "Follow the main workspace navigation style by default." },
                      { id: "tabs", label: "Tabs", description: "Always show workspace switching as tabs in split view." },
                      { id: "dropdown", label: "Dropdown", description: "Always show workspace switching as a dropdown in split view." },
                    ].map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setSplitWorkspaceNavigation(option.id as SplitNavigationPresentation)}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          splitWorkspaceNavigation === option.id
                            ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                            : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        <div className="text-xs font-medium">{option.label}</div>
                        <div className="mt-1 text-[11px] opacity-75">{option.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-[var(--text-secondary)] mb-2 block">Split Section Navigation</label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      { id: "match-main", label: "Same", description: "Follow the main section navigation style by default." },
                      { id: "tabs", label: "Tabs", description: "Always show section navigation as tabs in split view." },
                      { id: "dropdown", label: "Dropdown", description: "Always show section navigation as a dropdown in split view." },
                    ].map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setSplitSectionNavigation(option.id as SplitNavigationPresentation)}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          splitSectionNavigation === option.id
                            ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                            : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        <div className="text-xs font-medium">{option.label}</div>
                        <div className="mt-1 text-[11px] opacity-75">{option.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Workspace behavior</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Tune workspace ordering and what happens when you jump between workspaces.
                  </p>
                </div>

                <div>
                  <label className="text-xs text-[var(--text-secondary)] mb-2 block">Workspace Sort Order</label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {([
                      { id: "name-asc", label: "Name A\u2013Z" },
                      { id: "name-desc", label: "Name Z\u2013A" },
                      { id: "created-newest", label: "Newest First" },
                      { id: "created-oldest", label: "Oldest First" },
                      { id: "updated-newest", label: "Recently Updated" },
                      { id: "updated-oldest", label: "Least Recently Updated" },
                    ] as const).map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setWorkspaceSortOrder(option.id)}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          workspaceSortOrder === option.id
                            ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                            : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        <div className="text-xs font-medium">{option.label}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm text-[var(--text-secondary)]">Open Chats when switching workspace</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Always return to the main Chats view instead of keeping the current section in the new workspace.
                    </p>
                  </div>
                  <Toggle
                    on={switchWorkspaceToChat}
                    onToggle={() => set("switch_workspace_to_chat", !switchWorkspaceToChat)}
                  />
                </div>

                <div>
                  <label className="text-xs text-[var(--text-secondary)] mb-2 block">Settings Navigation</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { id: "top-tabs", label: "Top Tabs", description: "Keep settings sections across the top." },
                      { id: "side-tabs", label: "Side Tabs", description: "Keep settings sections in a dedicated side rail." },
                    ].map((layout) => (
                      <button
                        key={layout.id}
                        onClick={() => setSettingsNavLayout(layout.id as "top-tabs" | "side-tabs")}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          settingsNavLayout === layout.id
                            ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                            : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        <div className="text-xs font-medium">{layout.label}</div>
                        <div className="mt-1 text-[11px] opacity-75">{layout.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Appearance ── */}
          {activeTab === "appearance" && (
            <>
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-2 block">Theme</label>
                <div className="flex flex-wrap gap-2">
                  {THEMES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setAppearance("theme", t)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize ${
                        dbSettings.theme === t
                          ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                          : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-2 block">Accent Color</label>
                <div className="flex flex-wrap gap-2">
                  {ACCENT_COLORS.map(({ label, value }) => (
                    <button
                      key={value}
                      onClick={() => setAppearance("accent_color", value)}
                      title={label}
                      aria-label={`Use ${label} accent`}
                      className={`relative h-8 w-8 rounded-full border-2 transition-transform ${
                        dbSettings.accent_color === value ? "border-white scale-110 shadow-sm" : "border-transparent"
                      }`}
                      style={{ backgroundColor: value }}
                    >
                      <span className="sr-only">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-2 block">Text Size</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAppearance("font_size", Math.max(MIN_FONT_SIZE, dbSettings.font_size - 1))}
                    disabled={dbSettings.font_size <= MIN_FONT_SIZE}
                    className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    A-
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppearance("font_size", Math.min(MAX_FONT_SIZE, dbSettings.font_size + 1))}
                    disabled={dbSettings.font_size >= MAX_FONT_SIZE}
                    className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    A+
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppearance("font_size", DEFAULT_FONT_SIZE)}
                    disabled={dbSettings.font_size === DEFAULT_FONT_SIZE}
                    className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Reset
                  </button>
                  <span className="ml-2 text-xs font-medium text-[var(--text-muted)] w-8 text-center bg-[var(--bg-hover)] px-2 py-1 rounded-md">
                    {dbSettings.font_size}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between py-1 mt-4 border-t border-[var(--border-color)] pt-5">
                <div>
                  <p className="text-sm text-[var(--text-secondary)]">Hide Native Window Menu</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Use an in-app hamburger menu instead of the OS native menu bar. Note: requires app restart to apply correctly.
                  </p>
                </div>
                <Toggle
                  on={dbSettings.hide_native_menu}
                  onToggle={() => set("hide_native_menu", !dbSettings.hide_native_menu)}
                />
              </div>
            </>
          )}

          {/* ── AI / Ollama ── */}
          {activeTab === "ai" && (
            <>
              <div className="rounded-2xl border border-[var(--accent-color)]/25 bg-[var(--accent-color)]/8 p-4 space-y-4">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Ollama models</p>
                  <span
                    title="Rename your installed models so they are easier to recognize throughout the app."
                    className="inline-flex items-center text-[var(--text-muted)]"
                  >
                    <Info size={13} />
                  </span>
                </div>
                <div className="space-y-2">
                  {ollamaModels.length === 0 ? (
                    <p className="text-[11px] text-[var(--text-muted)]">No Ollama models found to label yet.</p>
                  ) : (
                    nonEmbeddingOllamaModels.map((model) => (
                      <div key={model.name} className="grid gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)] sm:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-[var(--text-primary)]" title={model.name}>{model.name}</p>
                          <p className="text-[10px] text-[var(--text-muted)]">{ollamaModelDetails(model, systemSpecs)}</p>
                        </div>
                        <div>
                          <div className="mb-1 flex items-center gap-1.5">
                            <label className="text-[11px] font-medium text-[var(--text-secondary)]">Custom label</label>
                            <span
                              title="Used in chat pickers, model badges, and the priority list. Leave blank to keep the original model name."
                              className="inline-flex items-center text-[var(--text-muted)]"
                            >
                              <Info size={12} />
                            </span>
                          </div>
                          <input
                            value={modelLabels[model.name] || ""}
                            onChange={(e) => setModelLabel(model.name, e.target.value)}
                            onBlur={async () => {
                              const matchingAiModel = aiModels.find((am) => am.model_id === model.name);
                              if (matchingAiModel && matchingAiModel.name !== modelLabels[model.name]) {
                                await api.aiModel.update(matchingAiModel.id, { name: modelLabels[model.name] });
                                loadAiModels();
                              }
                            }}
                            placeholder="Set label…"
                            className="h-10 w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent-color)]"
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <p className="text-[10px] text-[var(--text-muted)]">
                  Priority list names stay in sync automatically.
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Local inference providers</h3>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Kept in one place so setup feels like one workflow instead of separate tabs. Ollama is the main path, with MLX and llama.cpp as optional local runtimes.
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-[var(--text-secondary)]">Ollama</p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        Manage the local server, discover installed models, and power the default local chat flow.
                      </p>
                    </div>
                    <Toggle
                      on={dbSettings.auto_start_ollama}
                      onToggle={() => set("auto_start_ollama", !dbSettings.auto_start_ollama)}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <label className="text-xs text-[var(--text-secondary)]">Ollama URL</label>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={async () => {
                            setStartingOllama(true);
                            setOllamaTestResult(null);
                            try {
                              const status = await api.ollama.ensureRunning(dbSettings.ollama_base_url || undefined);
                              applyOllamaRuntimeStatus(status);
                            } catch (error) {
                              const msg = error instanceof Error ? error.message : "Automatic startup failed.";
                              setOllamaReachable(false);
                              setOllamaTestResult({ success: false, msg });
                            } finally {
                              setStartingOllama(false);
                            }
                          }}
                          disabled={startingOllama || testingOllama}
                          className="text-[10px] text-[var(--accent-color)] hover:underline flex items-center gap-1 disabled:opacity-50"
                        >
                          {startingOllama ? <RefreshCw size={10} className="animate-spin" /> : <Bot size={10} />}
                          Start Ollama
                        </button>
                        <button
                          onClick={async () => {
                            setTestingOllama(true);
                            setOllamaTestResult(null);
                            try {
                              const models = await api.ollama.listModelsFresh(dbSettings.ollama_base_url || undefined);
                              setOllamaReachable(true);
                              setOllamaModels(models);
                              setHasLoadedOllamaModels(true);
                              setOllamaTestResult({ success: true, msg: `Success! ${models.length} model(s) found.` });
                            } catch (error) {
                              setOllamaReachable(false);
                              const msg = error instanceof Error ? error.message : "Connection failed.";
                              setOllamaTestResult({ success: false, msg });
                            } finally {
                              setTestingOllama(false);
                            }
                          }}
                          disabled={testingOllama || startingOllama}
                          className="text-[10px] text-[var(--accent-color)] hover:underline flex items-center gap-1 disabled:opacity-50"
                        >
                          {testingOllama ? <RefreshCw size={10} className="animate-spin" /> : <Network size={10} />}
                          Test Connection
                        </button>
                      </div>
                    </div>
                    <input
                      value={dbSettings.ollama_base_url}
                      onChange={(e) => {
                        set("ollama_base_url", e.target.value);
                        refreshOllamaModels(e.target.value, { clearResult: true });
                      }}
                      placeholder="http://localhost:11434"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                    />
                    <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
                      Enable auto-start to try `ollama serve` on launch when you use the default local address.
                    </p>
                    {ollamaTestResult && (
                      <p className={`text-[10px] mt-1.5 font-medium ${ollamaTestResult.success ? "text-green-400" : "text-red-400"}`}>
                        {ollamaTestResult.msg}
                      </p>
                    )}
                    {ollamaModelsLoading && (
                      <p className="text-[10px] mt-1.5 text-[var(--text-muted)]">
                        Loading available models...
                      </p>
                    )}
                    {hasLoadedOllamaModels && !ollamaModelsLoading && ollamaReachable === false && !testingOllama && !startingOllama && (
                      <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                        <div className="flex items-center gap-2 text-red-400 mb-1">
                          <Network size={14} />
                          <span className="text-xs font-semibold">Ollama unavailable</span>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                          Aetherium could not reach Ollama at this URL. Start it manually with:
                          <code className="block mt-1.5 p-1.5 rounded bg-[var(--bg-primary)] font-mono text-[10px] text-[var(--text-secondary)]">
                            ollama serve
                          </code>
                          Or enable auto-start above for the default local address.
                        </p>
                      </div>
                    )}
                    {hasLoadedOllamaModels && !ollamaModelsLoading && ollamaReachable === true && nonEmbeddingOllamaModels.length === 0 && !testingOllama && !startingOllama && (
                      <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <div className="flex items-center gap-2 text-amber-500 mb-1">
                          <Bot size={14} />
                          <span className="text-xs font-semibold">No models found</span>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                          Ollama is connected but no models are installed yet. Pull any model you want to use, then refresh the connection.
                          <code className="block mt-1.5 p-1.5 rounded bg-[var(--bg-primary)] font-mono text-[10px] text-[var(--text-secondary)]">
                            ollama pull &lt;model-name&gt;
                          </code>
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {isMac && (
                  <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 space-y-3">
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <label className="text-sm text-[var(--text-secondary)]">MLX</label>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          Apple Silicon local inference with unified-memory friendly acceleration.
                        </p>
                      </div>
                      <button
                        onClick={async () => {
                          setTestingMlx(true);
                          setMlxTestResult(null);
                          try {
                            const m = await api.mlx.listModels(dbSettings.mlx_base_url || undefined);
                            setMlxTestResult({ success: true, msg: `Success! ${m.length} models found.` });
                            setMlxModels(m.map((model) => model.id));
                          } catch {
                            setMlxTestResult({ success: false, msg: "Connection failed. Is MLX server running?" });
                          } finally {
                            setTestingMlx(false);
                          }
                        }}
                        disabled={testingMlx}
                        className="text-[10px] text-[var(--accent-color)] hover:underline flex items-center gap-1"
                      >
                        {testingMlx ? <RefreshCw size={10} className="animate-spin" /> : <Network size={10} />}
                        Test Connection
                      </button>
                    </div>
                    <input
                      value={dbSettings.mlx_base_url}
                      onChange={(e) => {
                        set("mlx_base_url", e.target.value);
                      }}
                      placeholder="http://localhost:8080"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                    />
                    {mlxTestResult && (
                      <p className={`text-[10px] mt-1.5 font-medium ${mlxTestResult.success ? "text-green-400" : "text-red-400"}`}>
                        {mlxTestResult.msg}
                      </p>
                    )}
                    <p className="text-[10px] text-[var(--text-muted)]">
                      Run via: <code className="bg-[var(--bg-elevated)] px-1 rounded">mlx_lm.server --model ...</code>
                    </p>
                  </div>
                )}

                <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <label className="text-sm text-[var(--text-secondary)]">llama.cpp (GGUF)</label>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        Add local GGUF files for embedded inference without a separate server.
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          const selected = await openDialog({
                            multiple: true,
                            filters: [{ name: "GGUF Model", extensions: ["gguf"] }],
                          });
                          if (selected && Array.isArray(selected)) {
                            const currentPaths = dbSettings.llamacpp_model_paths || [];
                            const newPaths = [...new Set([...currentPaths, ...selected])];
                            updateSettings({ llamacpp_model_paths: newPaths });
                          }
                        } catch (err) {
                          console.error("Failed to open file picker:", err);
                        }
                      }}
                      className="text-[10px] text-[var(--accent-color)] hover:underline flex items-center gap-1"
                    >
                      <Plus size={10} /> Add GGUF File
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {(dbSettings.llamacpp_model_paths || []).map((path) => (
                      <div key={path} className="flex items-center justify-between gap-2 p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] group">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText size={12} className="text-[var(--text-muted)] shrink-0" />
                          <span className="text-[11px] text-[var(--text-primary)] truncate" title={path}>
                            {path.split("/").pop()}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            const next = dbSettings.llamacpp_model_paths.filter((p) => p !== path);
                            updateSettings({ llamacpp_model_paths: next });
                          }}
                          className="p-1 rounded hover:bg-red-400/10 text-[var(--text-muted)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                    {(dbSettings.llamacpp_model_paths || []).length === 0 && (
                      <p className="text-[10px] text-[var(--text-muted)] italic">No GGUF models added yet.</p>
                    )}
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    Embedded inference via llama.cpp with local acceleration when available.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-[var(--text-secondary)]">Detected hardware guidance</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Aetherium uses unified memory on Apple Silicon, detected GPU memory when available, and otherwise falls back to conservative RAM and CPU estimates.
                    </p>
                  </div>
                  <button
                    onClick={loadSystemSpecs}
                    disabled={systemSpecsLoading}
                    className="text-[10px] text-[var(--accent-color)] hover:underline flex items-center gap-1 disabled:opacity-50"
                  >
                    {systemSpecsLoading ? <RefreshCw size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                    Refresh specs
                  </button>
                </div>

                {systemSpecs ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">System</p>
                        <p className="mt-1 text-sm text-[var(--text-primary)]">{formatSystemName(systemSpecs)}</p>
                        <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{systemSpecs.cpu_arch}</p>
                      </div>
                      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">CPU</p>
                        <p className="mt-1 text-sm text-[var(--text-primary)]">{systemSpecs.cpu_brand}</p>
                        <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                          {systemSpecs.physical_cores ? `${systemSpecs.physical_cores} physical` : "Physical cores unavailable"} / {systemSpecs.logical_cores} logical
                        </p>
                      </div>
                      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Memory</p>
                        <p className="mt-1 text-sm text-[var(--text-primary)]">{formatBytes(systemSpecs.total_memory_bytes)} total</p>
                        <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{formatBytes(systemSpecs.available_memory_bytes)} available now</p>
                      </div>
                      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                          {systemSpecs.gpu_name ? "GPU" : "Swap"}
                        </p>
                        <p className="mt-1 text-sm text-[var(--text-primary)]">
                          {systemSpecs.gpu_name
                            ? systemSpecs.gpu_name
                            : `${formatBytes(systemSpecs.total_swap_bytes)} configured`}
                        </p>
                        <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                          {systemSpecs.gpu_name
                            ? (systemSpecs.gpu_memory_bytes
                              ? `${formatBytes(systemSpecs.gpu_memory_bytes)} VRAM${systemSpecs.gpu_detection_source ? ` via ${systemSpecs.gpu_detection_source}` : ""}`
                              : (systemSpecs.gpu_detection_source || "GPU memory unavailable"))
                            : (systemSpecs.host_name ? systemSpecs.host_name : (systemSpecs.kernel_version || "Kernel version unavailable"))}
                        </p>
                      </div>
                    </div>

                    {systemGuidance && (
                      <div className="rounded-lg border border-[var(--accent-color)]/20 bg-[var(--accent-color)]/8 px-3 py-3">
                        <p className="text-[11px] font-semibold text-[var(--text-primary)]">{systemGuidance.headline}</p>
                        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{systemGuidance.summary}</p>
                        <p className="mt-1 text-[10px] text-[var(--text-muted)]">{systemGuidance.basis}</p>
                        <p className="mt-1 text-[10px] text-[var(--text-muted)]">{systemGuidance.caution}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {systemSpecsLoading ? "Reading local system specs..." : (systemSpecsError || "System specs are not available yet.")}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Model defaults</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Choose the supporting local models used for background tasks, embeddings, and dual-model workflows.
                  </p>
                </div>

                <div>
                <label className="text-xs text-[var(--text-secondary)] mb-1 block">Background Task Model</label>
                <div className="relative">
                  <select
                    value={dbSettings.background_model}
                    onChange={(e) => set("background_model", e.target.value)}
                    className={pillSelectClassName}
                  >
                    <option value="">Use preferred chat model</option>
                    {nonEmbeddingOllamaModels.map((m) => (
                      <option key={m.name} value={m.name}>{m.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                </div>
                <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
                  Used for lightweight background AI work like topic clouds and workspace tagging.
                </p>
              </div>

              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-2 block">Embedding Model</label>
                <div className="space-y-2">
                  {(() => {
                    const isModelInstalled = (name: string) =>
                      !hasLoadedOllamaModels ||
                      ollamaModelNames.some((modelName) => modelName === name || modelName.startsWith(`${name}:`));
                    const nomicInstalled = isModelInstalled("nomic-embed-text");
                    const isCustom = dbSettings.embedding_model !== "nomic-embed-text";
                    const customInstalled = !isCustom || isModelInstalled(dbSettings.embedding_model);
                    return (
                      <>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="embedding_model"
                            checked={!isCustom}
                            onChange={() => set("embedding_model", "nomic-embed-text")}
                            className="accent-[var(--accent-color)]"
                          />
                          <span className="text-sm text-[var(--text-primary)]">nomic-embed-text</span>
                          <span className="text-[10px] text-[var(--text-muted)]">(default)</span>
                          {!nomicInstalled && (
                            <span className="text-[10px] font-medium text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">
                              not installed
                            </span>
                          )}
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="embedding_model"
                            checked={isCustom}
                            onChange={() => set("embedding_model", "")}
                            className="accent-[var(--accent-color)]"
                          />
                          <span className="text-sm text-[var(--text-primary)]">Custom</span>
                        </label>
                        {isCustom && (
                          <div className="ml-6 space-y-2">
                            <input
                              value={dbSettings.embedding_model}
                              onChange={(e) => set("embedding_model", e.target.value)}
                              placeholder="e.g. mxbai-embed-large"
                              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                            />
                            {!customInstalled && dbSettings.embedding_model && (
                              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                                <p className="text-[11px] font-medium text-red-400">Model not installed</p>
                                <p className="text-[10px] text-red-400/80 mt-0.5">
                                  Run: <code className="bg-[var(--bg-primary)] px-1 rounded">ollama pull {dbSettings.embedding_model}</code>
                                </p>
                              </div>
                            )}
                            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 space-y-1">
                              <p className="text-[11px] font-medium text-amber-400">Before switching</p>
                              <ul className="text-[10px] text-amber-400/80 list-disc ml-3 space-y-0.5">
                                <li>Pull the model first: <code className="bg-[var(--bg-primary)] px-1 rounded">ollama pull model-name</code></li>
                                <li>Changing models invalidates all existing embeddings (memories, documents, artifacts)</li>
                                <li>You will need to re-index your data for search and deduplication to work correctly</li>
                              </ul>
                            </div>
                          </div>
                        )}
                        {!isCustom && !nomicInstalled && hasLoadedOllamaModels && (
                          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                            <p className="text-[11px] font-medium text-red-400">Model not installed — embeddings are disabled</p>
                            <p className="text-[10px] text-red-400/80 mt-0.5">
                              Run: <code className="bg-[var(--bg-primary)] px-1 rounded">ollama pull nomic-embed-text</code>
                            </p>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
              </div>

              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-3">
                <div>
                  <p className="text-sm text-[var(--text-secondary)]">Dual-model execution</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Choose whether the draft and refine models run one after the other or at the same time.
                  </p>
                </div>
                <div className="relative">
                  <select
                    value={dbSettings.dual_model_execution_mode}
                    onChange={(e) => set("dual_model_execution_mode", e.target.value as AppSettings["dual_model_execution_mode"])}
                    className={pillSelectClassName}
                  >
                    <option value="serial">Serial: draft, then refine</option>
                    <option value="parallel">Parallel: draft and refine together</option>
                  </select>
                  <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                </div>
                <p className="text-[10px] text-[var(--text-muted)]">
                  Serial is steadier and uses one Ollama generation at a time. Parallel feels faster overall, but can use more compute and memory.
                </p>
              </div>

              {/* Model Priority List */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-[var(--text-secondary)]">Model Priority List</label>
                  <button
                    onClick={() => { setShowAddModel(!showAddModel); setNewModelId(""); setNewModelName(""); setNewModelIsPaid(false); setNewModelRoles(["chat"]); }}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90"
                  >
                    <Plus size={11} /> Add Model
                  </button>
                </div>

                {showAddModel && (
                  <div className="mb-3 p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] space-y-2">
                    <div className="relative">
                      <select
                        value={newModelId}
                        onChange={(e) => {
                          setNewModelId(e.target.value);
                          if (!newModelName) {
                            const name = e.target.value.split(":")[0];
                            setNewModelName(name);
                          }
                        }}
                        className="h-9 w-full appearance-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] pl-3 pr-9 text-xs text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--accent-color)] focus:border-[var(--accent-color)]"
                      >
                        <option value="">Select model...</option>
                        <optgroup label="Ollama">
                          {nonEmbeddingOllamaModels.map((m) => <option key={`ollama-${m.name}`} value={m.name}>{m.name}</option>)}
                        </optgroup>
                        {isMac && mlxModels.length > 0 && (
                          <optgroup label="MLX">
                            {mlxModels.map((m) => <option key={`mlx-${m}`} value={`mlx:${m}`}>{m}</option>)}
                          </optgroup>
                        )}
                        {llamacppModels.length > 0 && (
                          <optgroup label="llama.cpp (GGUF)">
                            {llamacppModels.map((p) => <option key={`llamacpp-${p}`} value={`llamacpp:${p}`}>{p.split("/").pop()}</option>)}
                          </optgroup>
                        )}
                      </select>
                      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      </div>
                      <input
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                      placeholder="Display name"
                      className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                      />
                      <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Roles</p>
                      <div className="flex flex-wrap gap-1.5">
                        {MODEL_ROLE_OPTIONS.map((role) => {
                          const active = newModelRoles.includes(role);
                          return (
                            <button
                              key={role}
                              type="button"
                              onClick={() => setNewModelRoles(toggleRole(newModelRoles, role) as ModelRole[])}
                              className={`rounded-full px-2 py-1 text-[10px] transition-colors ${
                                active
                                  ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                                  : "bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                              }`}
                            >
                              {role}
                            </button>
                          );
                        })}
                      </div>
                      </div>
                      <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                        <input type="checkbox" checked={newModelIsPaid} onChange={(e) => setNewModelIsPaid(e.target.checked)} className="accent-[var(--accent-color)]" />
                        Paid model
                      </label>
                      <div className="flex gap-2">
                        <button onClick={() => setShowAddModel(false)} className="px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Cancel</button>
                        <button
                          disabled={!newModelId || !newModelName}
                          onClick={async () => {
                            const isMlx = newModelId.startsWith("mlx:");
                            const isLlamacpp = newModelId.startsWith("llamacpp:");
                            const modelId = isMlx ? newModelId.replace("mlx:", "") : isLlamacpp ? newModelId.replace("llamacpp:", "") : newModelId;
                            const provider = isMlx ? "mlx" : isLlamacpp ? "llamacpp" : "ollama";
                            await api.aiModel.add(newModelName, modelId, { provider, is_paid: newModelIsPaid, role_tags: newModelRoles });
                            loadAiModels();
                            incrementModelRefreshCounter();
                            setShowAddModel(false); setNewModelId(""); setNewModelName(""); setNewModelIsPaid(false); setNewModelRoles(["chat"]);
                          }}
                          className="px-2 py-1 text-xs rounded bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40"
                        >
                          Add
                        </button>                      </div>
                    </div>
                  </div>
                )}

                {aiModels.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] py-2">No models configured. Add one above to set up priority ordering.</p>
                ) : (
                  <div className="space-y-1">
                    {aiModels.map((m, idx) => {
                      const ollamaMeta = ollamaModels.find((model) => model.name === m.model_id);
                      const modelParams = parseModelParamsB(m.model_id) ?? parseModelParamsB(m.name);
                      const formattedParams = formatParams(modelParams);
                      const formattedStorage = typeof ollamaMeta?.size === "number" ? formatBytes(ollamaMeta.size) : null;
                      const modelFit = systemGuidance
                        ? classifyModelFit(modelParams, systemGuidance.recommendedMaxParamsB)
                        : "unknown";

                      return (
                      <div key={m.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-2">
                        <div className="flex items-start gap-2">
                          {/* Priority arrows */}
                          <div className="flex flex-col gap-0.5 pt-0.5">
                            <button
                              disabled={idx === 0}
                              onClick={async () => {
                                const prev = aiModels[idx - 1];
                                await api.aiModel.update(m.id, { priority: prev.priority });
                                await api.aiModel.update(prev.id, { priority: m.priority });
                                loadAiModels();
                                incrementModelRefreshCounter();
                              }}
                              className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-20"
                            >
                              <ChevronUp size={11} />
                            </button>
                            <button
                              disabled={idx === aiModels.length - 1}
                              onClick={async () => {
                                const next = aiModels[idx + 1];
                                await api.aiModel.update(m.id, { priority: next.priority });
                                await api.aiModel.update(next.id, { priority: m.priority });
                                loadAiModels();
                                incrementModelRefreshCounter();
                              }}
                              className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-20"
                            >
                              <ChevronDown size={11} />
                            </button>
                          </div>

                          {/* Model info */}
                          <div className="min-w-0 flex-1">
                            {editingModelId === m.id ? (
                              <input
                                autoFocus
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onBlur={async () => {
                                  await api.aiModel.update(m.id, { name: editingName });
                                  setEditingModelId(null);
                                  loadAiModels();
                                }}
                                onKeyDown={async (e) => {
                                  if (e.key === "Enter") {
                                    await api.aiModel.update(m.id, { name: editingName });
                                    setEditingModelId(null);
                                    loadAiModels();
                                  }
                                  if (e.key === "Escape") {setEditingModelId(null);}
                                }}
                                className="w-full px-1.5 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--accent-color)] text-sm text-[var(--text-primary)] outline-none"
                              />
                            ) : (
                              <div className="group min-w-0 cursor-pointer" onClick={() => { setEditingModelId(m.id); setEditingName(m.name); }}>
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="truncate text-sm font-medium text-[var(--text-primary)]">{m.name}</span>
                                  <Pencil size={10} className="shrink-0 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{m.model_id}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  {formattedParams && (
                                    <span className="rounded-full bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                                      {formattedParams}
                                    </span>
                                  )}
                                  {formattedStorage && (
                                    <span className="rounded-full bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                                      {formattedStorage}
                                    </span>
                                  )}
                                  {modelFit === "good" && (
                                    <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                                      good fit
                                    </span>
                                  )}
                                  {modelFit === "stretch" && (
                                    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                                      stretch
                                    </span>
                                  )}
                                  {modelFit === "too-large" && (
                                    <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-400">
                                      likely heavy
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="ml-auto flex shrink-0 items-start gap-2">
                            <div className="flex flex-wrap items-center justify-end gap-1.5 pt-0.5">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)]">{m.provider}</span>
                              {m.is_paid && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">PAID</span>
                              )}
                              <span className="text-[10px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">{m.tokens_used_total.toLocaleString()} tok</span>
                            </div>

                            <div className="pt-0.5">
                              <Toggle
                                on={m.enabled}
                                onToggle={async () => {
                                  await api.aiModel.update(m.id, { enabled: !m.enabled });
                                  loadAiModels();
                                  incrementModelRefreshCounter();
                                }}
                              />
                            </div>

                            <button
                              onClick={async () => { await api.aiModel.delete(m.id); loadAiModels(); incrementModelRefreshCounter(); }}
                              className="p-1 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {m.role_tags.length > 0 && m.role_tags.map((role) => (
                            <span key={`active-${role}`} className="rounded-full bg-[var(--accent-color)]/10 px-1.5 py-0.5 text-[10px] text-[var(--accent-color)]">
                              {role}
                            </span>
                          ))}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {MODEL_ROLE_OPTIONS.map((role) => {
                            const active = m.role_tags.includes(role);
                            return (
                              <button
                                key={role}
                                onClick={async () => {
                                  await api.aiModel.update(m.id, { role_tags: toggleRole(m.role_tags, role) });
                                  loadAiModels();
                                  incrementModelRefreshCounter();
                                }}
                                className={`rounded-full px-1.5 py-0.5 text-[10px] transition-colors ${
                                  active
                                    ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                                    : "bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                                }`}
                                title={`Toggle ${role} role`}
                              >
                                {role}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );})}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Chat ── */}
          {activeTab === "chat" && (
            <>
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Conversation defaults</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Set the instructions and learning behaviors that apply across chats and notes.
                  </p>
                </div>

                <div>
                  <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">Global Prompt Instructions</label>
                  <p className="text-[11px] text-[var(--text-muted)] mb-2">
                    Custom instructions prepended to every chat across all workspaces.
                  </p>
                  <textarea
                    value={dbSettings.prompt_instructions}
                    onChange={(e) => set("prompt_instructions", e.target.value)}
                    placeholder="e.g. Always respond in concise bullet points…"
                    rows={4}
                    className="w-full text-sm bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] resize-y"
                  />
                </div>

                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm text-[var(--text-secondary)]">Auto-generate Flashcards</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">Automatically extract flashcards from chat responses and notes</p>
                  </div>
                  <Toggle
                    on={autoGenerateFlashcards}
                    onToggle={() => setAutoGenerateFlashcards(!autoGenerateFlashcards)}
                  />
                </div>
              </div>

              {/* Chat Title Auto-Generation */}
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-2 block">Chat Title Auto-Generation</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="chat_title_refresh"
                      checked={dbSettings.chat_title_auto_refresh === "disabled"}
                      onChange={() => set("chat_title_auto_refresh", "disabled")}
                      className="accent-[var(--accent-color)]"
                    />
                    <span className="text-[var(--text-secondary)]">Disabled</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="chat_title_refresh"
                      checked={dbSettings.chat_title_auto_refresh === "initial_only"}
                      onChange={() => set("chat_title_auto_refresh", "initial_only")}
                      className="accent-[var(--accent-color)]"
                    />
                    <span className="text-[var(--text-secondary)]">Initial title only</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="chat_title_refresh"
                      checked={dbSettings.chat_title_auto_refresh === "periodic"}
                      onChange={() => set("chat_title_auto_refresh", "periodic")}
                      className="accent-[var(--accent-color)]"
                    />
                    <span className="text-[var(--text-secondary)]">Refresh periodically every</span>
                  </label>
                  {dbSettings.chat_title_auto_refresh === "periodic" && (
                    <div className="ml-5 flex items-center gap-2">
                      <input
                        type="number"
                        min={2}
                        max={50}
                        value={dbSettings.chat_title_refresh_interval || 5}
                        onChange={(e) => set("chat_title_refresh_interval", Number(e.target.value))}
                        className="w-16 px-2 py-1 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                      />
                      <span className="text-xs text-[var(--text-secondary)]">messages</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-2">
                  AI-generated titles improve chat organization. &apos;Periodic&apos; refreshes the title based on conversation progress.
                </p>
              </div>

              {/* Deletion Settings */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm text-[var(--text-secondary)]">Immediate Delete</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Bypass recycle bin and delete chats immediately with confirmation</p>
                </div>
                <Toggle on={dbSettings.immediate_delete} onToggle={() => set("immediate_delete", !dbSettings.immediate_delete)} />
              </div>

              {!dbSettings.immediate_delete && (
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm text-[var(--text-secondary)]">Confirm Move to Trash</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">Prompt for confirmation before moving chats to the recycle bin</p>
                  </div>
                  <Toggle on={dbSettings.confirm_move_to_trash} onToggle={() => set("confirm_move_to_trash", !dbSettings.confirm_move_to_trash)} />
                </div>
              )}

              {/* Show Gen Info */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm text-[var(--text-secondary)]">Show Gen Info</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Display token count, duration, and speed (tok/s) below assistant messages</p>
                </div>
                <Toggle on={showGenInfo} onToggle={() => setShowGenInfo(!showGenInfo)} />
              </div>

              {/* Scroll message to top on send */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm text-[var(--text-secondary)]">Scroll Message to Top on Send</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">After sending, scroll so your message appears at the top of the view</p>
                </div>
                <Toggle on={scrollToTopOnSend} onToggle={() => setScrollToTopOnSend(!scrollToTopOnSend)} />
              </div>

              {/* Chat messages style */}
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-2 block">Chat Messages Style</label>
                <div className="space-y-2">
                  {(["bubble", "flat"] as ChatMessageStyle[]).map((style) => (
                    <label key={style} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="chat_message_style"
                        checked={chatMessageStyle === style}
                        onChange={() => setChatMessageStyle(style)}
                        className="accent-[var(--accent-color)]"
                      />
                      <span className="text-[var(--text-secondary)] capitalize">{style}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-2">
                  <strong>Bubble:</strong> colored rounded message bubbles. <strong>Flat:</strong> borderless document-style layout.
                </p>
              </div>

              {/* Expand chat container to window width */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm text-[var(--text-secondary)]">Expand Chat Container to Window Width</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Remove the maximum width constraint on the chat area</p>
                </div>
                <Toggle on={expandChatToWindowWidth} onToggle={() => setExpandChatToWindowWidth(!expandChatToWindowWidth)} />
              </div>
            </>
          )}

          {/* ── Browser Automation ── */}
          {activeTab === "webai" && (
            <>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Manual Browser Targets</h3>
                <p className="text-xs text-[var(--text-muted)] mb-3">
                  Use manual browser automation for user-configured web targets. Select an enabled browser-backed model from the Chat view model dropdown to activate it. Requires Node.js and the <code className="px-1 py-0.5 rounded bg-[var(--bg-hover)] font-mono text-[10px]">playwright</code> npm package (<code className="px-1 py-0.5 rounded bg-[var(--bg-hover)] font-mono text-[10px]">npm install -g playwright && npx playwright install chromium</code>).
                </p>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-[var(--border-color)]">
                <div>
                  <p className="text-sm text-[var(--text-secondary)]">Preserve browser session</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-sm">
                    When <strong>off</strong> (default): login cookies are wiped from disk after every query — safest. When <strong>on</strong>: session is saved so you stay logged in between queries.
                  </p>
                  {dbSettings.web_session_preserve && (
                    <p className="mt-1.5 text-[11px] px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 max-w-sm">
                      ⚠ Login cookies for web AI providers are stored on disk. Disable to wipe credentials after every query.
                    </p>
                  )}
                </div>
                <Toggle
                  on={dbSettings.web_session_preserve}
                  onToggle={() => set("web_session_preserve", !dbSettings.web_session_preserve)}
                />
              </div>

              <div className="pt-2 space-y-2">
                <p className="text-xs text-[var(--text-secondary)] font-medium">Enabling browser-backed models</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Go to the <strong>AI</strong> tab → Model Priority List and enable any browser-backed entry to make it appear in the Chat view model dropdown.
                </p>
              </div>

              <div className="pt-3 space-y-2">
                <p className="text-xs text-[var(--text-secondary)] font-medium">Quick Send Models</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Pin enabled models as alternate actions in the chat composer send-button dropdown. They send the current prompt with that model without changing your main dropdown selection.
                </p>
                <div className="flex flex-wrap gap-2">
                  {aiModels.filter((model) => model.enabled).map((model) => {
                    const active = dbSettings.quick_search_models.includes(model.model_id);
                    return (
                      <button
                        key={model.id}
                        onClick={() => toggleQuickSearchModel(model.model_id)}
                        className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                          active
                            ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                            : "bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                        }`}
                      >
                        {model.name}
                      </button>
                    );
                  })}
                </div>
                {aiModels.filter((model) => model.enabled).length === 0 && (
                  <p className="text-[10px] text-[var(--text-muted)]">Enable models in the AI tab first to add them to the send-button dropdown.</p>
                )}
              </div>
            </>
          )}

          {/* ── Security ── */}
          {activeTab === "security" && (
            <>
              {/* ── App Lock ── */}
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] divide-y divide-[var(--border-color)]">
                <div className={`flex items-center justify-between px-4 py-3 transition-opacity ${!pinConfigured ? "opacity-40" : ""}`}>
                  <div>
                    <p className="text-sm text-[var(--text-secondary)]">Require PIN on launch</p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      {pinConfigured ? "Lock the app at startup. Touch ID can be used as a shortcut when enabled below." : "Save a PIN first to enable app lock."}
                    </p>
                  </div>
                  <Toggle
                    on={dbSettings.pin_lock_enabled}
                    disabled={!pinConfigured}
                    onToggle={() => {
                      if (!pinConfigured) {return;}
                      const next = !dbSettings.pin_lock_enabled;
                      set("pin_lock_enabled", next);
                      // Touch ID requires PIN as its fallback — disable it together
                      if (!next && dbSettings.touch_id_enabled) {
                        set("touch_id_enabled", false);
                      }
                    }}
                  />
                </div>
                {biometricAvailable && (
                  <div className={`flex items-center justify-between px-4 py-3 transition-opacity ${!dbSettings.pin_lock_enabled ? "opacity-40" : ""}`}>
                    <div>
                      <p className="text-sm text-[var(--text-secondary)]">{biometricLabel}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {dbSettings.pin_lock_enabled
                          ? `Use ${biometricLabel} as a quick unlock. PIN is always available as a fallback.`
                          : `Enable PIN lock first to use ${biometricLabel}.`}
                      </p>
                    </div>
                    <Toggle
                      on={dbSettings.touch_id_enabled}
                      disabled={!dbSettings.pin_lock_enabled}
                      onToggle={() => {
                        if (!dbSettings.pin_lock_enabled) {return;}
                        set("touch_id_enabled", !dbSettings.touch_id_enabled);
                      }}
                    />
                  </div>
                )}
              </div>

              {/* ── PIN Passcode ── */}
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-[var(--text-secondary)]">PIN passcode</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-sm">
                      4 to 8 digits. Stored as a hash, never plaintext.
                    </p>
                  </div>
                  <span className={`text-[11px] px-2 py-1 rounded-full border ${
                    dbSettings.pin_lock_enabled
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : pinConfigured
                      ? "border-sky-500/30 bg-sky-500/10 text-sky-400"
                      : "border-[var(--border-color)] text-[var(--text-muted)]"
                  }`}>
                    {dbSettings.pin_lock_enabled ? "Enabled" : pinConfigured ? "Saved" : "Not set"}
                  </span>
                </div>

                {pinConfigured && (
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">Current PIN</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={currentPin}
                      onChange={(e) => { setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setPinMessage(null); }}
                      placeholder="Current PIN"
                      className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                    />
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">{pinConfigured ? "New PIN" : "PIN"}</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={newPin}
                      onChange={(e) => { setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setPinMessage(null); }}
                      placeholder="4 to 8 digits"
                      className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">Confirm PIN</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={confirmPin}
                      onChange={(e) => { setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setPinMessage(null); }}
                      placeholder="Repeat PIN"
                      className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                    />
                  </div>
                </div>

                {pinMessage && (
                  <p className={`text-xs ${
                    pinMessage.type === "success" ? "text-emerald-400" : "text-red-400"
                  }`}>
                    {pinMessage.text}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleSetPin}
                    disabled={pinSaving}
                    className="px-3.5 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-60"
                  >
                    {pinSaving ? "Saving..." : pinConfigured ? "Update PIN" : "Save PIN"}
                  </button>
                  {pinConfigured && (
                    <button
                      onClick={handleRemovePin}
                      disabled={pinSaving}
                      className="px-3.5 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
                    >
                      Remove PIN
                    </button>
                  )}
                </div>
              </div>

              {/* ── Auto-lock ── */}
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-2 block">Auto-lock</label>
                <p className="text-[11px] text-[var(--text-muted)] mb-2">Auto-lock becomes active once a launch lock is enabled.</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="auto_lock"
                      checked={dbSettings.auto_lock_minutes === 0}
                      onChange={() => set("auto_lock_minutes", 0)}
                      disabled={!anyLockEnabled}
                      className="accent-[var(--accent-color)]"
                    />
                    <span className="text-[var(--text-secondary)]">Off</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="auto_lock"
                      checked={dbSettings.auto_lock_minutes > 0}
                      onChange={() => set("auto_lock_minutes", dbSettings.auto_lock_minutes > 0 ? dbSettings.auto_lock_minutes : 5)}
                      disabled={!anyLockEnabled}
                      className="accent-[var(--accent-color)]"
                    />
                    <span className="text-[var(--text-secondary)]">Lock after</span>
                    {dbSettings.auto_lock_minutes > 0 && (
                      <span className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={1440}
                          value={dbSettings.auto_lock_minutes}
                          disabled={!anyLockEnabled}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            if (val > 0) {set("auto_lock_minutes", val);}
                          }}
                          className="w-20 px-2 py-1 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                        />
                        <span className="text-xs text-[var(--text-secondary)]">minutes</span>
                      </span>
                    )}
                  </label>
                </div>
              </div>
            </>
          )}

          {/* ── Sync ── */}
          {activeTab === "sync" && (
            <>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Multi-device Sync</h3>
                <p className="text-xs text-[var(--text-muted)] mb-3">
                  Sync your chats, memories, and settings across devices using a private Git remote.
                  Requires a private repository (GitHub, GitLab, or any SSH-accessible bare repo) and
                  Git installed on this machine.
                </p>
              </div>

              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm text-[var(--text-secondary)]">Enable sync</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Automatically sync every 5 minutes in the background</p>
                </div>
                <Toggle
                  on={gitSync?.enabled ?? false}
                  onToggle={async () => {
                    if (!gitSync) { return; }
                    const next = !gitSync.enabled;
                    setGitSyncSaving(true);
                    try {
                      await api.gitSync.configure(gitSyncUrl, next);
                      setGitSync((s) => s ? { ...s, enabled: next } : s);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    } catch (e: any) {
                      setGitSync((s) => s ? { ...s, last_error: String(e) } : s);
                    } finally {
                      setGitSyncSaving(false);
                    }
                  }}
                />
              </div>

              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-1 block">Remote URL</label>
                <div className="flex gap-2">
                  <input
                    value={gitSyncUrl}
                    onChange={(e) => setGitSyncUrl(e.target.value)}
                    placeholder="git@github.com:you/aetherium-sync.git"
                    className="flex-1 px-3 py-1.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)] font-mono"
                  />
                  <button
                  disabled={gitSyncSaving || !gitSyncUrl.trim() || !isGitSyncSshUrl}
                    onClick={async () => {
                      setGitSyncSaving(true);
                      try {
                        await api.gitSync.configure(gitSyncUrl, gitSync?.enabled ?? false);
                        setGitSync((s) => s ? { ...s, remote_url: gitSyncUrl, last_error: "" } : s);
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      } catch (e: any) {
                        setGitSync((s) => s ? { ...s, last_error: String(e) } : s);
                      } finally {
                        setGitSyncSaving(false);
                      }
                    }}
                    className="px-3 py-1.5 text-xs rounded bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {gitSyncSaving ? <RefreshCw size={12} className="animate-spin" /> : "Save"}
                  </button>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                  SSH remote required. Use `git@...` or `ssh://...` and ensure your key is loaded in `ssh-agent`.
                </p>
                {gitSyncUrl.trim() && !isGitSyncSshUrl && (
                  <p className="text-[11px] text-amber-400 mt-1">
                    Git sync only accepts SSH remotes.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-xs text-[var(--text-muted)]">Last synced</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {gitSync?.last_synced_at ? new Date(gitSync.last_synced_at).toLocaleString() : "Never"}
                  </p>
                </div>
                <button
                  disabled={gitSyncing || !gitSync?.enabled}
                  onClick={async () => {
                    setGitSyncing(true);
                    try {
                      const s = await api.gitSync.triggerSync();
                      setGitSync(s);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    } catch (e: any) {
                      setGitSync((s) => s ? { ...s, last_error: String(e) } : s);
                    } finally {
                      setGitSyncing(false);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                >
                  {gitSyncing ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Sync Now
                </button>
              </div>

              {gitSync?.last_error && (
                <div className="px-3 py-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                  {gitSync.last_error}
                </div>
              )}
            </>
          )}

        </div>
      </div>
      )}

      {/* ── Full-bleed tabs (workspaces, backup, import) ── */}
      {activeTab === "workspaces" && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <WorkspaceSettingsView />
        </div>
      )}

      {activeTab === "backup" && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <BackupSettingsSection />
        </div>
      )}

      {activeTab === "import" && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <ImportSettingsSection />
        </div>
      )}

      {activeTab === "mcp" && (
        <div className="flex-1 overflow-y-auto p-6">
          <h2 className="text-2xl font-bold mb-4">Model Context Protocol Servers</h2>

          <div className="mb-6">
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Configure external MCP servers to integrate with external knowledge sources and tools.
            </p>
          </div>

          <div className="mb-6">
            <button
              onClick={() => setShowAddMcpServer(!showAddMcpServer)}
              className="flex items-center gap-2 px-4 py-2 rounded bg-[var(--accent-color)] text-white hover:opacity-90 transition"
            >
              <Plus size={18} /> Add MCP Server
            </button>
          </div>

          {showAddMcpServer && (
            <div className="mb-6 p-4 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)]">
              <h3 className="font-bold mb-4">New MCP Server</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Server Name</label>
                  <input
                    type="text"
                    value={newMcpName}
                    onChange={(e) => setNewMcpName(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] focus:outline-none"
                    placeholder="e.g., my-knowledge-server"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Command</label>
                  <input
                    type="text"
                    value={newMcpCommand}
                    onChange={(e) => setNewMcpCommand(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] focus:outline-none"
                    placeholder="e.g., /path/to/server-binary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Arguments (comma-separated)</label>
                  <input
                    type="text"
                    value={newMcpArgs}
                    onChange={(e) => setNewMcpArgs(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] focus:outline-none"
                    placeholder="e.g., --config /path/config.json"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => {
                      setShowAddMcpServer(false);
                      setNewMcpName("");
                      setNewMcpCommand("");
                      setNewMcpArgs("");
                    }}
                    className="px-4 py-2 rounded border border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await api.mcp.addServer(
                          newMcpName,
                          newMcpCommand,
                          newMcpArgs.split(",").map((s) => s.trim()).filter(Boolean),
                          "" // workspace_id
                        );
                        const servers = await api.mcp.listServers();
                        setMcpServers(servers);
                        setShowAddMcpServer(false);
                        setNewMcpName("");
                        setNewMcpCommand("");
                        setNewMcpArgs("");
                      } catch (err) {
                        console.error("Failed to add MCP server:", err);
                      }
                    }}
                    className="px-4 py-2 rounded bg-[var(--accent-color)] text-white hover:opacity-90 transition"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {mcpServers.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)] italic">No MCP servers configured yet.</p>
            ) : (
              mcpServers.map((server) => (
                <div key={server.id} className="p-4 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)]">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-bold">{server.name}</h4>
                      <p className="text-sm text-[var(--text-secondary)] font-mono">{server.command}</p>
                      {server.args.length > 0 && (
                        <p className="text-xs text-[var(--text-secondary)] mt-1">{server.args.join(" ")}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          try {
                            await api.mcp.deleteServer(server.name);
                            const servers = await api.mcp.listServers();
                            setMcpServers(servers);
                          } catch (err) {
                            console.error("Failed to delete MCP server:", err);
                          }
                        }}
                        className="p-2 rounded hover:bg-[var(--bg-hover)] transition text-red-500"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
