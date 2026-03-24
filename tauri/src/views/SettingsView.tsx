/**
 * SettingsView — tabbed sections: Appearance, AI, Security, Backup.
 * Mirrors SettingsView.swift.
 */
import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Palette, Bot, ShieldCheck, HardDrive, ChevronUp, ChevronDown, Trash2, Plus, LayoutGrid, PuzzleIcon, Network, Globe, Pencil, RefreshCw, GitBranch, Settings as SettingsIcon, MessageSquare } from "lucide-react";
import { api, type AppSettings, type AiModel, type MCPServerConfig, type GitSyncStatus, type SecurityStatus } from "../lib/api";
import { MODEL_ROLE_OPTIONS, type ModelRole } from "../lib/modelRoles";
import { ACCENT_COLORS, THEMES } from "../lib/theme";
import { useSettingsStore } from "../stores/settingsStore";
import { type NavigationPresentation, type SplitNavigationPresentation, useWorkspaceStore } from "../stores/workspaceStore";
import WorkspaceSettingsView from "./WorkspaceSettingsView";
import BackupSettingsSection from "./BackupSettingsSection";
import PluginManagerView from "./PluginManagerView";
import { MOD_KEY } from "../lib/platform";

const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 22;

type Tab = "general" | "appearance" | "chat" | "ai" | "webai" | "security" | "workspaces" | "backup" | "plugins" | "mcp" | "sync";

const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
  { id: "general",     label: "General",     Icon: SettingsIcon },
  { id: "appearance",  label: "Appearance",  Icon: Palette },
  { id: "chat",        label: "Chat",        Icon: MessageSquare },
  { id: "ai",          label: "AI",          Icon: Bot },
  { id: "webai",       label: "Web AI",      Icon: Globe },
  { id: "security",    label: "Security",    Icon: ShieldCheck },
  { id: "workspaces",  label: "Workspaces",  Icon: LayoutGrid },
  { id: "backup",      label: "Backup",      Icon: HardDrive },
  { id: "plugins",     label: "Plugins",     Icon: PuzzleIcon },
  { id: "mcp",         label: "MCP",         Icon: Network },
  { id: "sync",        label: "Sync",        Icon: GitBranch },
];

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

export default function SettingsView() {
  const pillSelectClassName = "h-10 w-full appearance-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] pl-3 pr-9 text-sm text-[var(--text-primary)] shadow-sm outline-none transition-colors hover:border-[var(--accent-color)] focus:border-[var(--accent-color)]";
  const zustandSettings = useSettingsStore();
  const { settingsNavLayout, setSettingsNavLayout } = useSettingsStore();
  const location = useLocation();
  const {
    workspaceNavigation,
    sectionNavigation,
    splitWorkspaceNavigation,
    splitSectionNavigation,
    workspaceSortOrder,
    setWorkspaceNavigation,
    setSectionNavigation,
    setSplitWorkspaceNavigation,
    setSplitSectionNavigation,
    setWorkspaceSortOrder,
  } = useWorkspaceStore();
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("general");

  // Handle external tab switching via router state
  useEffect(() => {
    const state = location.state as { settingsTab?: Tab } | null;
    if (state?.settingsTab) {
      setActiveTab(state.settingsTab);
      // Clear state so it doesn't persist on manual refreshes
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const [dbSettings, setDbSettings] = useState<AppSettings | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [_saveError, setSaveError] = useState<string | null>(null);
  const [testingOllama, setTestingOllama] = useState(false);
  const [ollamaTestResult, setOllamaTestResult] = useState<{ success: boolean; msg: string } | null>(null);
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false);
  const [hasLoadedOllamaModels, setHasLoadedOllamaModels] = useState(false);
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

  function syncClientSettings(settings: AppSettings) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    zustandSettings.setTheme(settings.theme as any);
    zustandSettings.setAccentColor(settings.accent_color);
    zustandSettings.setFontSize(settings.font_size);
    zustandSettings.setPreferredModel(settings.preferred_model);
    zustandSettings.setBackgroundModel(settings.background_model);
    zustandSettings.setQuickSearchModels(settings.quick_search_models);
    zustandSettings.setOllamaUrl(settings.ollama_base_url);
    zustandSettings.setDualModelEnabled(settings.dual_model_enabled);
    zustandSettings.setDraftModel(settings.draft_model);
    zustandSettings.setDualModelExecutionMode(settings.dual_model_execution_mode);
    zustandSettings.setCompareModelA(settings.compare_model_a);
    zustandSettings.setCompareModelB(settings.compare_model_b);
    zustandSettings.setImmediateDelete(settings.immediate_delete);
    zustandSettings.setConfirmMoveToTrash(settings.confirm_move_to_trash);
    zustandSettings.setPromptInstructions(settings.prompt_instructions);
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
        if (m.name && zustandSettings.modelLabels[m.model_id] !== m.name) {
          zustandSettings.setModelLabel(m.model_id, m.name);
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
  }

  function refreshOllamaModels(ollamaUrl: string, options?: { clearResult?: boolean }) {
    const requestId = ++ollamaModelsRequestRef.current;
    setOllamaModelsLoading(true);
    if (options?.clearResult) {
      setOllamaTestResult(null);
    }

    api.ollama.listModelsFresh(ollamaUrl || undefined)
      .then((models) => {
        if (requestId !== ollamaModelsRequestRef.current) {return;}
        setOllamaModels(models.map((model) => model.name));
      })
      .catch(() => {
        if (requestId !== ollamaModelsRequestRef.current) {return;}
        setOllamaModels([]);
      })
      .finally(() => {
        if (requestId !== ollamaModelsRequestRef.current) {return;}
        setOllamaModelsLoading(false);
        setHasLoadedOllamaModels(true);
      });
  }

  useEffect(() => {
    api.settings.get().then((s) => {
      setDbSettings(s);
      dbSettingsRef.current = s;
      syncClientSettings(s);
      refreshOllamaModels(s.ollama_base_url);
    }).catch(() => {});
    loadAiModels();
    api.security.getStatus().then(setSecurityStatus).catch(() => {});
    api.mcp.listServers().then(setMcpServers).catch(() => {});
    api.gitSync.getStatus().then((s) => { setGitSync(s); setGitSyncUrl(s.remote_url); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setDbSettings((prev) => prev ? { ...prev, pin_lock_enabled: false } : prev);
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
        Loading settings…
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
            <h1 className="text-sm font-semibold text-[var(--text-primary)]">Settings</h1>
            <p className="text-[11px] text-[var(--text-muted)]">App configuration and workspace preferences</p>
          </div>
          <div className={`text-xs ${autosaveStatusClassName}`}>{autosaveStatus}</div>
        </div>
      )}

      <div className={`flex-1 min-h-0 overflow-hidden ${settingsNavLayout === "side-tabs" ? "flex" : "block"}`}>
        {settingsNavLayout === "side-tabs" && (
          <aside className="w-60 shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 py-4 overflow-y-auto">
            {settingsTabButtons}
          </aside>
        )}

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      {(activeTab === "general" || activeTab === "appearance" || activeTab === "chat" || activeTab === "ai" || activeTab === "security" || activeTab === "webai" || activeTab === "sync") && (
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-lg space-y-5">

          {/* ── General ── */}
          {activeTab === "general" && (
            <>
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

              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-2 block">Workspace Navigation</label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    { id: "sidebar", label: "Sidebar", description: "Keep workspace switching in the left rail beside the main content." },
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
                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    { id: "sidebar", label: "Sidebar", description: "Keep section navigation in the left rail." },
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

              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm text-[var(--text-secondary)]">Auto-generate Flashcards</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Automatically extract flashcards from chat responses and notes</p>
                </div>
                <Toggle
                  on={zustandSettings.autoGenerateFlashcards}
                  onToggle={() => zustandSettings.setAutoGenerateFlashcards(!zustandSettings.autoGenerateFlashcards)}
                />
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
                </div>
              </div>
            </>
          )}

          {/* ── AI / Ollama ── */}
          {activeTab === "ai" && (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[var(--text-secondary)]">Ollama URL</label>
                  <button
                    onClick={async () => {
                      setTestingOllama(true);
                      setOllamaTestResult(null);
                      try {
                        const m = await api.ollama.listModelsFresh(dbSettings.ollama_base_url || undefined);
                        setOllamaTestResult({ success: true, msg: `Success! ${m.length} models found.` });
                        refreshOllamaModels(dbSettings.ollama_base_url);
                      } catch {
                        setOllamaTestResult({ success: false, msg: `Connection failed. Is Ollama running?` });
                      } finally {
                        setTestingOllama(false);
                      }
                    }}
                    disabled={testingOllama}
                    className="text-[10px] text-[var(--accent-color)] hover:underline flex items-center gap-1"
                  >
                    {testingOllama ? <RefreshCw size={10} className="animate-spin" /> : <Network size={10} />}
                    Test Connection
                  </button>
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
                {hasLoadedOllamaModels && !ollamaModelsLoading && ollamaModels.length === 0 && !testingOllama && (
                  <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <div className="flex items-center gap-2 text-amber-500 mb-1">
                      <Bot size={14} />
                      <span className="text-xs font-semibold">No models found</span>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                      Ollama is connected but no models are installed. To use the AI features, please run:
                      <code className="block mt-1.5 p-1.5 rounded bg-[var(--bg-primary)] font-mono text-[10px] text-[var(--text-secondary)]">
                        ollama pull qwen2.5
                      </code>
                    </p>
                  </div>
                )}
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
                    {ollamaModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
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
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="embedding_model"
                      checked={dbSettings.embedding_model === "nomic-embed-text"}
                      onChange={() => set("embedding_model", "nomic-embed-text")}
                      className="accent-[var(--accent-color)]"
                    />
                    <span className="text-sm text-[var(--text-primary)]">nomic-embed-text</span>
                    <span className="text-[10px] text-[var(--text-muted)]">(default)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="embedding_model"
                      checked={dbSettings.embedding_model !== "nomic-embed-text"}
                      onChange={() => set("embedding_model", "")}
                      className="accent-[var(--accent-color)]"
                    />
                    <span className="text-sm text-[var(--text-primary)]">Custom</span>
                  </label>
                  {dbSettings.embedding_model !== "nomic-embed-text" && (
                    <div className="ml-6 space-y-2">
                      <input
                        value={dbSettings.embedding_model}
                        onChange={(e) => set("embedding_model", e.target.value)}
                        placeholder="e.g. mxbai-embed-large"
                        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                      />
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
                        onChange={(e) => { setNewModelId(e.target.value); if (!newModelName) {setNewModelName(e.target.value.split(":")[0]);} }}
                        className="h-9 w-full appearance-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] pl-3 pr-9 text-xs text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--accent-color)] focus:border-[var(--accent-color)]"
                      >
                        <option value="">Select Ollama model...</option>
                        {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
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
                            await api.aiModel.add(newModelName, newModelId, { is_paid: newModelIsPaid, role_tags: newModelRoles });
                            loadAiModels();
                            setShowAddModel(false); setNewModelId(""); setNewModelName(""); setNewModelIsPaid(false); setNewModelRoles(["chat"]);
                          }}
                          className="px-2 py-1 text-xs rounded bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {aiModels.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] py-2">No models configured. Add one above to set up priority ordering.</p>
                ) : (
                  <div className="space-y-1">
                    {aiModels.map((m, idx) => (
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
                                }}
                              />
                            </div>

                            <button
                              onClick={async () => { await api.aiModel.delete(m.id); loadAiModels(); }}
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
                    ))}
                  </div>
                )}
              </div>

              {/* Custom Model Labels */}
              <div className="pt-2">
                <label className="text-xs text-[var(--text-secondary)] mb-2 block">Custom Model Labels (Global)</label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {ollamaModels.length === 0 ? (
                    <p className="text-[10px] text-[var(--text-muted)]">No Ollama models found to label.</p>
                  ) : (
                    ollamaModels.map((modelId) => (
                      <div key={modelId} className="flex items-center gap-2 group">
                        <span className="text-[10px] text-[var(--text-muted)] w-24 truncate" title={modelId}>{modelId}</span>
                        <input
                          value={zustandSettings.modelLabels[modelId] || ""}
                          onChange={(e) => zustandSettings.setModelLabel(modelId, e.target.value)}
                          onBlur={async () => {
                            // If this model is in the priority list, update it there too
                            const matchingAiModel = aiModels.find(am => am.model_id === modelId);
                            if (matchingAiModel && matchingAiModel.name !== zustandSettings.modelLabels[modelId]) {
                              await api.aiModel.update(matchingAiModel.id, { name: zustandSettings.modelLabels[modelId] });
                              loadAiModels();
                            }
                          }}
                          placeholder="Set label…"
                          className="flex-1 px-2 py-1 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] h-7"
                        />
                      </div>
                    ))
                  )}
                </div>
                <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
                  Labels set here will be used throughout the app. Priority list names sync automatically.
                </p>
              </div>
            </>
          )}

          {/* ── Chat ── */}
          {activeTab === "chat" && (
            <>
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
            </>
          )}

          {/* ── Web AI ── */}
          {activeTab === "webai" && (
            <>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Web AI Providers</h3>
                <p className="text-xs text-[var(--text-muted)] mb-3">
                  Use ChatGPT, DeepSeek, Claude, and Gemini via browser automation. Select a web provider from the Chat view model dropdown to activate. Requires Node.js and the <code className="px-1 py-0.5 rounded bg-[var(--bg-hover)] font-mono text-[10px]">playwright</code> npm package (<code className="px-1 py-0.5 rounded bg-[var(--bg-hover)] font-mono text-[10px]">npm install -g playwright && npx playwright install chromium</code>).
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
                <p className="text-xs text-[var(--text-secondary)] font-medium">Enabling web providers</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Go to the <strong>AI</strong> tab → Model Priority List and enable any web AI entry (ChatGPT Web, DeepSeek Web, Claude Web, Gemini Web) to make it appear in the Chat view model dropdown.
                </p>
              </div>

              <div className="pt-3 space-y-2">
                <p className="text-xs text-[var(--text-secondary)] font-medium">Quick Search Buttons</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Pin enabled models as one-tap buttons in the chat composer. They send the current prompt with that model without changing your main dropdown selection.
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
                  <p className="text-[10px] text-[var(--text-muted)]">Enable models in the AI tab first to use them as quick search buttons.</p>
                )}
              </div>
            </>
          )}

          {/* ── Security ── */}
          {activeTab === "security" && (
            <>
              {biometricAvailable && (
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm text-[var(--text-secondary)]">{biometricLabel}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Require {biometricLabel} before opening the app.
                    </p>
                  </div>
                  <Toggle on={dbSettings.touch_id_enabled} onToggle={() => set("touch_id_enabled", !dbSettings.touch_id_enabled)} />
                </div>
              )}

              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-[var(--text-secondary)]">PIN passcode</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-sm">
                      Save a 4 to 8 digit PIN, then choose whether app lock should require it on launch. The PIN is stored as a hash, not plaintext.
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

                <div className="rounded-lg border border-[var(--border-color)]/80 bg-[var(--bg-primary)] px-3 py-2.5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-[var(--text-secondary)]">Require PIN on launch</p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      {pinConfigured ? "Turn this on when you want the app to lock at startup." : "Save a PIN first to make app lock available."}
                    </p>
                  </div>
                  <Toggle
                    on={dbSettings.pin_lock_enabled}
                    disabled={!pinConfigured}
                    onToggle={() => {
                      if (!pinConfigured) {return;}
                      set("pin_lock_enabled", !dbSettings.pin_lock_enabled);
                    }}
                  />
                </div>

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

      {/* ── Full-bleed tabs (workspaces, backup, plugins) ── */}
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

      {activeTab === "plugins" && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <PluginManagerView />
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
