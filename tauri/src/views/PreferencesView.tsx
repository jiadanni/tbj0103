/**
 * PreferencesView — integrated preferences hub with focused tabs for app,
 * navigation, appearance, chat, AI, security, backup, and workspace controls.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { message } from "@tauri-apps/plugin-dialog";
import { Palette, Bot, ShieldCheck, HardDrive, Trash2, Plus, LayoutGrid, Network, Globe, Pencil, RefreshCw, GitBranch, Settings as SettingsIcon, MessageSquare, FileText, FolderInput, ScrollText, Eye, EyeOff, GripVertical, Pin, Info, Brain } from "lucide-react";
import { api, type AppSettings, type AiModel, type MCPServerConfig, type GitSyncStatus, type SecurityStatus, type OllamaModel, type SystemSpecs, type ModelSpeedStat } from "../lib/api";
import { resolveModelDisplayName, resolveModelSecondaryDisplayName } from "../lib/modelDisplayName";
import { getModelGroupMeta } from "../lib/modelGroups";
import { classifyModelFit, formatBytes, formatParams, inferHardwareModelGuidance, parseModelParamsB, type ModelFit } from "../lib/modelSizing";
import { ACCENT_COLORS, THEMES, THEME_DEFAULT_ACCENTS, normalizeTheme } from "../lib/theme";
import { useSettingsStore, type ChatMessageStyle } from "../stores/settingsStore";
import { type NavigationPresentation, useWorkspaceStore } from "../stores/workspaceStore";
import WorkspaceSettingsView from "./WorkspaceSettingsView";
import BackupSettingsSection from "./BackupSettingsSection";
import GlobalBackupSection from "./GlobalBackupSection";
import ImportSettingsSection from "./ImportSettingsSection";
import MemoryView from "./MemoryView";
const LogsView = React.lazy(() => import("./LogsView"));
import CompactMenuSelect from "../components/CompactMenuSelect";
import { MOD_KEY, isLinux, isMac } from "../lib/platform";
import type { PreferencesSection } from "../components/navigationItems";
import { useAiModelSync } from "../hooks/useAiModelSync";

const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 22;
const DEFAULT_FONT_SIZE = 16;

const TABS: { id: PreferencesSection; label: string; Icon: React.ElementType }[] = [
  { id: "app", label: "App", Icon: SettingsIcon },
  { id: "navigation", label: "Navigation", Icon: LayoutGrid },
  { id: "appearance", label: "Appearance", Icon: Palette },
  { id: "chat", label: "Chat", Icon: MessageSquare },
  { id: "ai", label: "AI", Icon: Bot },
  { id: "webai", label: "Browser Automation", Icon: Globe },
  { id: "security", label: "Security", Icon: ShieldCheck },
  { id: "workspaces", label: "Workspaces", Icon: LayoutGrid },
  { id: "backup", label: "Backup", Icon: HardDrive },
  { id: "import", label: "Import", Icon: FolderInput },
  { id: "mcp", label: "MCP", Icon: Network },
  { id: "sync", label: "Sync", Icon: GitBranch },
  { id: "memory", label: "Memory", Icon: Brain },
  { id: "logs", label: "Logs", Icon: ScrollText },
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
      className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
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

function formatModelSpeed(stat: ModelSpeedStat | undefined): { chatAverage: string; weighted: string } | null {
  if (
    !stat ||
    !Number.isFinite(stat.avg_chat_tokens_per_second) ||
    stat.avg_chat_tokens_per_second <= 0 ||
    !Number.isFinite(stat.weighted_tokens_per_second) ||
    stat.weighted_tokens_per_second <= 0
  ) {
    return null;
  }

  return {
    chatAverage: `${stat.avg_chat_tokens_per_second.toFixed(1)} tok/s`,
    weighted: `${stat.weighted_tokens_per_second.toFixed(1)} tok/s`,
  };
}

function formatCapabilityLabel(capability: string): string {
  return capability
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getModelFitMeta(modelFit: ModelFit): {
  dotClassName: string;
  title: string;
  label: string | null;
  textClassName: string;
} {
  if (modelFit === "good") {
    return {
      dotClassName: "bg-emerald-400",
      title: "Recommended for this system",
      label: "recommended",
      textClassName: "text-emerald-400",
    };
  }

  if (modelFit === "stretch") {
    return {
      dotClassName: "bg-amber-400",
      title: "Usable, but closer to the upper range for this system",
      label: "usable",
      textClassName: "text-amber-400",
    };
  }

  if (modelFit === "too-large") {
    return {
      dotClassName: "bg-red-400",
      title: "Likely demanding for this system",
      label: "demanding",
      textClassName: "text-red-400",
    };
  }

  return {
    dotClassName: "bg-[var(--text-muted)]",
    title: "Fit guidance unavailable",
    label: null,
    textClassName: "text-[var(--text-muted)]",
  };
}

export default function PreferencesView() {
  const settingsNavLayout = useSettingsStore((state) => state.settingsNavLayout);
  const setSettingsNavLayout = useSettingsStore((state) => state.setSettingsNavLayout);
  const autoGenerateFlashcards = useSettingsStore((state) => state.autoGenerateFlashcards);
  const setAutoGenerateFlashcards = useSettingsStore((state) => state.setAutoGenerateFlashcards);
  const showGenInfo = useSettingsStore((state) => state.showGenInfo);
  const setShowGenInfo = useSettingsStore((state) => state.setShowGenInfo);
  const showGenInfoTokenCount = useSettingsStore((state) => state.showGenInfoTokenCount);
  const setShowGenInfoTokenCount = useSettingsStore((state) => state.setShowGenInfoTokenCount);
  const showGenInfoDuration = useSettingsStore((state) => state.showGenInfoDuration);
  const setShowGenInfoDuration = useSettingsStore((state) => state.setShowGenInfoDuration);
  const showGenInfoSpeed = useSettingsStore((state) => state.showGenInfoSpeed);
  const setShowGenInfoSpeed = useSettingsStore((state) => state.setShowGenInfoSpeed);
  const showGenInfoModel = useSettingsStore((state) => state.showGenInfoModel);
  const setShowGenInfoModel = useSettingsStore((state) => state.setShowGenInfoModel);
  const scrollToTopOnSend = useSettingsStore((state) => state.scrollToTopOnSend);
  const setScrollToTopOnSend = useSettingsStore((state) => state.setScrollToTopOnSend);
  const chatMessageStyle = useSettingsStore((state) => state.chatMessageStyle);
  const setChatMessageStyle = useSettingsStore((state) => state.setChatMessageStyle);
  const expandChatToWindowWidth = useSettingsStore((state) => state.expandChatToWindowWidth);
  const setExpandChatToWindowWidth = useSettingsStore((state) => state.setExpandChatToWindowWidth);
  const switchWorkspaceSection = useSettingsStore((state) => state.switchWorkspaceSection);
  const showComposerTopicTags = useSettingsStore((state) => state.showComposerTopicTags);
  const setShowComposerTopicTags = useSettingsStore((state) => state.setShowComposerTopicTags);
  const showComposerWorkspaceSuggestions = useSettingsStore((state) => state.showComposerWorkspaceSuggestions);
  const setShowComposerWorkspaceSuggestions = useSettingsStore((state) => state.setShowComposerWorkspaceSuggestions);
  const showComposerChatFollowUps = useSettingsStore((state) => state.showComposerChatFollowUps);
  const setShowComposerChatFollowUps = useSettingsStore((state) => state.setShowComposerChatFollowUps);
  const composerMode = useSettingsStore((state) => state.composerMode);
  const setComposerMode = useSettingsStore((state) => state.setComposerMode);
  const modelFamilyLabels = useSettingsStore((state) => state.modelFamilyLabels);
  const setModelFamilyLabel = useSettingsStore((state) => state.setModelFamilyLabel);
  const customModelFamilies = useSettingsStore((state) => state.customModelFamilies);
  const addCustomModelFamily = useSettingsStore((state) => state.addCustomModelFamily);
  const _removeCustomModelFamily = useSettingsStore((state) => state.removeCustomModelFamily);
  const modelLabels = useSettingsStore((state) => state.modelLabels);
  const location = useLocation();
  const workspaceNavigation = useWorkspaceStore((state) => state.workspaceNavigation);
  const sectionNavigation = useWorkspaceStore((state) => state.sectionNavigation);
  const workspaceSortOrder = useWorkspaceStore((state) => state.workspaceSortOrder);
  const setWorkspaceNavigation = useWorkspaceStore((state) => state.setWorkspaceNavigation);
  const setSectionNavigation = useWorkspaceStore((state) => state.setSectionNavigation);
  const incrementModelRefreshCounter = useSettingsStore((state) => state.incrementModelRefreshCounter);
  const setWorkspaceSortOrder = useWorkspaceStore((state) => state.setWorkspaceSortOrder);
  const isDemoMode = useWorkspaceStore((state) => state.isDemoMode);
  const setDemo = useWorkspaceStore((state) => state.setDemo);
  const setWorkspaces = useWorkspaceStore((state) => state.setWorkspaces);

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
  const [modelSpeedStats, setModelSpeedStats] = useState<Record<string, ModelSpeedStat>>({});
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus | null>(null);

  const [draggedModelId, setDraggedModelId] = useState<string | null>(null);
  const [dragOverModelId, setDragOverModelId] = useState<string | null>(null);
  const [draggedFamilyId, setDraggedFamilyId] = useState<string | null>(null);
  const [dragOverFamilyId, setDragOverFamilyId] = useState<string | null>(null);

  // Refs so document-level pointer listeners can read the latest drag target
  const dragOverModelIdRef = useRef<string | null>(null);
  const dragOverFamilyIdRef = useRef<string | null>(null);

  // Pointer-event-based drag engine (HTML5 DnD is broken in WebKitGTK / Linux)
  useEffect(() => {
    if (!draggedModelId && !draggedFamilyId) {return;}

    const handlePointerMove = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el) {return;}

      if (draggedFamilyId) {
        // Family drag — look for a family header or a model row (to target its group)
        const familyEl = el.closest("[data-family-key]") as HTMLElement | null;
        const modelEl = el.closest("[data-model-id]") as HTMLElement | null;
        let targetKey: string | null = null;
        if (familyEl) {targetKey = familyEl.dataset.familyKey ?? null;}
        else if (modelEl) {targetKey = modelEl.dataset.familyKey ?? null;}

        if (targetKey && targetKey !== draggedFamilyId) {
          dragOverFamilyIdRef.current = targetKey;
          setDragOverFamilyId(targetKey);
        } else {
          dragOverFamilyIdRef.current = null;
          setDragOverFamilyId(null);
        }
        return;
      }

      // Model drag
      const modelEl = el.closest("[data-model-id]") as HTMLElement | null;
      if (modelEl) {
        const targetId = modelEl.dataset.modelId ?? null;
        if (targetId && targetId !== draggedModelId) {
          dragOverModelIdRef.current = targetId;
          setDragOverModelId(targetId);
          // Also set family highlight if in family mode
          const fKey = modelEl.dataset.familyKey ?? null;
          dragOverFamilyIdRef.current = fKey;
          setDragOverFamilyId(fKey);
        } else {
          dragOverModelIdRef.current = null;
          setDragOverModelId(null);
        }
      } else {
        // Maybe hovering a family header — allow cross-family model drops
        const familyEl = el.closest("[data-family-key]") as HTMLElement | null;
        if (familyEl) {
          const fKey = familyEl.dataset.familyKey ?? null;
          dragOverFamilyIdRef.current = fKey;
          setDragOverFamilyId(fKey);
        }
        dragOverModelIdRef.current = null;
        setDragOverModelId(null);
      }
    };

    const handlePointerUp = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      // Dispatch a custom event so the React tree can handle the drop synchronously
      window.dispatchEvent(new CustomEvent("model-drag-drop", {
        detail: {
          draggedModelId,
          draggedFamilyId,
          overModelId: dragOverModelIdRef.current,
          overFamilyId: dragOverFamilyIdRef.current,
        },
      }));
      setDraggedModelId(null);
      setDraggedFamilyId(null);
      setDragOverModelId(null);
      setDragOverFamilyId(null);
      dragOverModelIdRef.current = null;
      dragOverFamilyIdRef.current = null;
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, [draggedModelId, draggedFamilyId]);

  const [showAddModel, setShowAddModel] = useState(false);
  const [newModelId, setNewModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [newModelIsPaid, setNewModelIsPaid] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const systemGuidance = systemSpecs
    ? inferHardwareModelGuidance(systemSpecs)
    : null;
  const nonEmbeddingOllamaModels = ollamaModels.filter((model) => !model.name.toLowerCase().includes("embed"));
  const groupedAiModels = useMemo(() => {
    // 1. Gather all models (DB + Detected)
    const allMerged: AiModel[] = [...aiModels];

    const addDetected = (detectedId: string, name: string, provider: string, capabilities: string[] = []) => {
      const exists = aiModels.some((m) => m.model_id === detectedId && m.provider === provider);
      if (!exists) {
        allMerged.push({
          id: `transient-${provider}-${detectedId}`,
          name,
          model_id: detectedId,
          provider,
          role_tags: capabilities.includes("vision") ? ["chat", "vision"] : ["chat"],
          priority: 9999,
          is_paid: false,
          enabled: false,
          is_hidden: false,
          tokens_used_total: 0,
          created_at: new Date().toISOString(),
        });
      }
    };

    nonEmbeddingOllamaModels.forEach((om) => addDetected(om.name, om.name, "ollama", om.capabilities || []));
    if (isMac) { mlxModels.forEach((m) => addDetected(m, m, "mlx")); }
    llamacppModels.forEach((p) => addDetected(p, p.split("/").pop() || p, "llamacpp"));

    // 2. Group them
    if (composerMode === "family") {
      const familyGroups: Record<string, { key: string; label: string; order: number; models: AiModel[] }> = {};
      allMerged.forEach((m) => {
        const rawPrefix = m.model_id.includes(":") ? m.model_id.split(":")[0] : m.model_id;
        const label = modelFamilyLabels[rawPrefix] ?? rawPrefix;
        
        if (!familyGroups[label]) {
          familyGroups[label] = {
            key: `family-${label.toLowerCase().replace(/\s+/g, "-")}`,
            label: label,
            order: 0,
            models: []
          };
        }
        familyGroups[label].models.push(m);
      });

      // 3. Add any custom empty groups
      customModelFamilies.forEach((family) => {
        if (!familyGroups[family]) {
          familyGroups[family] = {
            key: `family-${family.toLowerCase().replace(/\s+/g, "-")}`,
            label: family,
            order: 0,
            models: []
          };
        }
      });

      // Sort families by the lowest priority of their members
      return Object.values(familyGroups).sort((a, b) => {
        const minA = Math.min(...a.models.map(m => m.priority));
        const minB = Math.min(...b.models.map(m => m.priority));
        return minA - minB;
      });
    }

    // Default Provider Grouping
    const providerGroups: Record<string, { key: string; label: string; order: number; models: AiModel[] }> = {};
    allMerged.forEach((m) => {
      const meta = getModelGroupMeta(m.provider);
      if (!providerGroups[meta.key]) {
        providerGroups[meta.key] = { ...meta, models: [] };
      }
      providerGroups[meta.key].models.push(m);
    });

    return Object.values(providerGroups).sort((a, b) => a.order - b.order);
  }, [aiModels, nonEmbeddingOllamaModels, mlxModels, llamacppModels, composerMode, modelFamilyLabels, customModelFamilies]);

  // Separate local models (AI tab) from web models (Browser Automation tab)
  const localGroupedAiModels = useMemo(
    () => groupedAiModels
      .map((g) => ({ ...g, models: g.models.filter((m) => !m.provider.startsWith("web_")) }))
      .filter((g) => g.models.length > 0),
    [groupedAiModels]
  );
  const webAiModels = useMemo(
    () => aiModels.filter((m) => m.provider.startsWith("web_")),
    [aiModels]
  );

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
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  useEffect(() => {
    dbSettingsRef.current = dbSettings;
  }, [dbSettings]);

  useEffect(() => () => {
    if (saveNoticeTimeoutRef.current !== null) {
      window.clearTimeout(saveNoticeTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    let val = dbSettings?.quick_search_shortcut ?? "";
    if (val === "CmdOrCtrl+Shift+K") {
      val = isMac ? "Cmd+Shift+K" : "Ctrl+Shift+K";
    }
    setQuickSearchShortcutDraft(val);
  }, [dbSettings?.quick_search_shortcut]);

  function syncClientSettings(settings: AppSettings) {
    const settingsStore = useSettingsStore.getState();
    settingsStore.setTheme(normalizeTheme(settings.theme));
    settingsStore.setAccentColor(settings.accent_color);
    settingsStore.setFontSize(settings.font_size);
    settingsStore.setPreferredModel(settings.preferred_model);
    settingsStore.setBackgroundModel(settings.background_model);
    settingsStore.setQuickSearchModels(settings.quick_search_models);
    settingsStore.setQuickSearchWorkspaceScope(settings.quick_search_workspace_scope);
    settingsStore.setQuickSearchTypeFilters(settings.quick_search_type_filters);
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
    settingsStore.setSwitchWorkspaceSection(settings.switch_workspace_section);
    settingsStore.setHideNativeMenu(settings.hide_native_menu);
    settingsStore.setShowGenInfo(settings.show_gen_info);
    settingsStore.setShowGenInfoTokenCount(settings.show_gen_info_token_count);
    settingsStore.setShowGenInfoDuration(settings.show_gen_info_duration);
    settingsStore.setShowGenInfoSpeed(settings.show_gen_info_speed);
    settingsStore.setShowGenInfoModel(settings.show_gen_info_model);
    settingsStore.setQuickSearchShortcut(settings.quick_search_shortcut);
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
      .catch(() => { })
      .then(async () => {
        const changedMenubarStyle = dbSettingsRef.current?.menubar_icon_style !== nextSettings.menubar_icon_style;
        await api.settings.update(nextSettings);
        if (changedMenubarStyle && isMac) {
          try {
            await api.settings.reloadTrayIcon();
          } catch (err) {
            // Ignore errors from tray icon reload
            console.warn("Failed to reload tray icon:", err);
          }
        }
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
    if (!current) { return; }

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
    }).catch(() => { });
    api.aiModel.listSpeedStats().then((stats) => {
      setModelSpeedStats(
        stats.reduce<Record<string, ModelSpeedStat>>((acc, stat) => {
          acc[stat.model_name] = stat;
          return acc;
        }, {})
      );
    }).catch(() => { });
  }

  useAiModelSync(
    aiModels,
    ollamaModels,
    ollamaModelsLoading,
    loadAiModels
  );

  async function reorderFamilyBeforeGroup(draggedFamilyKey: string, targetGroupKey: string) {
    const draggedGroup = groupedAiModels.find(g => g.key === draggedFamilyKey);
    const targetGroup = groupedAiModels.find(g => g.key === targetGroupKey);
    if (!draggedGroup || !targetGroup) {return;}

    const allModels = groupedAiModels
      .flatMap(g => g.models)
      .filter(x => !x.id.startsWith("transient-"))
      .sort((a, b) => a.priority - b.priority);
    const draggedModels = draggedGroup.models.filter(x => !x.id.startsWith("transient-"));
    const targetModels = targetGroup.models.filter(x => !x.id.startsWith("transient-"));

    if (draggedModels.length === 0) {return;}

    const remainingModels = allModels.filter(x => !draggedModels.find(dm => dm.id === x.id));
    let targetStartIdx = remainingModels.length;
    if (targetModels.length > 0) {
      const idx = remainingModels.findIndex(x => x.id === targetModels[0].id);
      if (idx !== -1) {targetStartIdx = idx;}
    }

    const reordered = [...remainingModels];
    reordered.splice(targetStartIdx, 0, ...draggedModels);

    const originalPriorities = allModels.map(x => x.priority);
    await Promise.all(reordered.map((x, i) => {
      const newPriority = originalPriorities[i] ?? (i + 1);
      if (x.priority !== newPriority) {
        return api.aiModel.update(x.id, { priority: newPriority }).catch(() => {});
      }
    }));
    loadAiModels();
    incrementModelRefreshCounter();
  }

  // Handle the custom drop event dispatched by the pointer-based drag engine
  useEffect(() => {
    const handleDrop = async (e: Event) => {
      const { draggedModelId: dModel, draggedFamilyId: dFamily, overModelId, overFamilyId } =
        (e as CustomEvent).detail as {
          draggedModelId: string | null;
          draggedFamilyId: string | null;
          overModelId: string | null;
          overFamilyId: string | null;
        };

      // Family reorder
      if (dFamily && overFamilyId && dFamily !== overFamilyId) {
        await reorderFamilyBeforeGroup(dFamily, overFamilyId);
        return;
      }

      // Model dropped on a family header (reassign family in family mode)
      if (dModel && !overModelId && overFamilyId && composerMode === "family") {
        const m = aiModels.find(x => x.id === dModel);
        if (m && !m.id.startsWith("transient-")) {
          const rawPrefix = m.model_id.includes(":") ? m.model_id.split(":")[0] : m.model_id;
          const targetGroup = groupedAiModels.find(g => g.key === overFamilyId);
          if (targetGroup) {
            setModelFamilyLabel(rawPrefix, targetGroup.label);
            await new Promise(r => setTimeout(r, 50));
            loadAiModels();
            incrementModelRefreshCounter();
          }
        }
        return;
      }

      // Model reorder
      if (dModel && overModelId && dModel !== overModelId) {
        const allModels = [...aiModels].sort((a, b) => a.priority - b.priority);
        const draggedIdx = allModels.findIndex(x => x.id === dModel);
        const targetIdx = allModels.findIndex(x => x.id === overModelId);

        if (draggedIdx !== -1 && targetIdx !== -1) {
          const reordered = [...allModels];
          const [removed] = reordered.splice(draggedIdx, 1);
          reordered.splice(targetIdx, 0, removed);

          const originalPriorities = allModels.map(x => x.priority);
          await Promise.all(reordered.map((x, i) => {
            if (x.priority !== originalPriorities[i]) {
              return api.aiModel.update(x.id, { priority: originalPriorities[i] }).catch(() => {});
            }
          }));
          loadAiModels();
          incrementModelRefreshCounter();
        }
      }
    };

    window.addEventListener("model-drag-drop", handleDrop);
    return () => window.removeEventListener("model-drag-drop", handleDrop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiModels, groupedAiModels, composerMode]);

  function toggleQuickSearchModel(modelId: string) {
    if (!dbSettings) { return; }
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

  function refreshOllamaModels(ollamaUrl: string, options?: { clearResult?: boolean; useCache?: boolean }) {
    const requestId = ++ollamaModelsRequestRef.current;
    setOllamaModelsLoading(true);
    if (options?.clearResult) {
      setOllamaTestResult(null);
      setOllamaReachable(null);
    }

    const mode = options?.useCache ? api.ollama.listModels : api.ollama.listModelsFresh;
    mode(ollamaUrl || undefined)
      .then((models) => {
        if (requestId !== ollamaModelsRequestRef.current) { return; }
        setOllamaReachable(true);
        setOllamaModels(models);
      })
      .catch(() => {
        if (requestId !== ollamaModelsRequestRef.current) { return; }
        setOllamaReachable(false);
        setOllamaModels([]);
      })
      .finally(() => {
        if (requestId !== ollamaModelsRequestRef.current) { return; }
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
      refreshOllamaModels(normalizedSettings.ollama_base_url, { useCache: true });
    }).catch(() => { });
    loadSystemSpecs();
    loadAiModels();
    api.security.getStatus().then(setSecurityStatus).catch(() => { });
    api.mcp.listServers().then(setMcpServers).catch(() => { });
    api.gitSync.getStatus().then((s) => { setGitSync(s); setGitSyncUrl(s.remote_url); }).catch(() => { });

    // Initial fetch and listen for workspace changes
    api.workspace.list().then(setWorkspaces).catch(() => { });
    const unlistenWorkspaces = listen("workspaces-changed", async () => {
      try {
        const workspaces = await api.workspace.list();
        setWorkspaces(workspaces);
      } catch (err) {
        console.error("Failed to re-fetch workspaces in preferences:", err);
      }
    });

    const unlistenSettings = listen("settings-changed", async () => {
      try {
        const s = await api.settings.get();
        const normalizedSettings = normalizeAppSettingsTheme(s);
        setDbSettings(normalizedSettings);
        dbSettingsRef.current = normalizedSettings;
        syncClientSettings(normalizedSettings);
      } catch (err) {
        console.error("Failed to re-fetch settings in preferences:", err);
      }
    });

    return () => {
      unlistenWorkspaces.then((fn) => fn());
      unlistenSettings.then((fn) => fn());
    };
  }, [setWorkspaces]);

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
    if (!dbSettings) { return; }

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
    if (!dbSettings) { return; }

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
          className={`flex items-center gap-2 whitespace-nowrap transition-colors ${settingsNavLayout === "top-tabs"
            ? `px-3.5 py-2.5 text-sm rounded-t-lg border-b-2 ${activeTab === id
              ? "border-[var(--accent-color)] text-[var(--accent-color)] font-medium"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`
            : `w-full rounded-xl px-2.5 py-2 text-left text-sm ${activeTab === id
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
  const contentWidthClassName = activeTab === "ai" ? "max-w-5xl" : "max-w-4xl";
  const ollamaModelsSection = (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Models</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Pick which local models to enable, set priority, or review capabilities. New local models are detected automatically.
          </p>
          {composerMode === "family" && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text-secondary)]">Tip:</span> drag a model to the top of its family to make it the default — that is the model that runs when you hit Enter in family mode.
            </p>
          )}
        </div>
      </div>

      {aiModels.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] py-2">No models configured. Add one above to set up priority ordering.</p>
      ) : (
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_100px_40px_120px_60px_60px_20px] items-center gap-3 px-4 py-2.5 bg-[var(--bg-hover)]/30 border-b border-[var(--border-color)] text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
          <span>Model</span>
          <span className="text-center">Background</span>
          <span className="text-center">Pin</span>
          <span className="text-right">Speed</span>
          <span className="text-center">Active</span>
          <span className="text-center">Visible</span>
          <span />
        </div>

          <div className="divide-y divide-[var(--border-color)]">

          {localGroupedAiModels.map((group) => (
            <React.Fragment key={group.key}>
              <div
                data-family-key={group.key}
                onPointerDown={(e) => {
                  if (composerMode !== "family") {return;}
                  // Only start family drag from primary button
                  if (e.button !== 0) {return;}
                  e.preventDefault();
                  setDraggedFamilyId(group.key);
                }}
                className={`px-4 py-1.5 transition-colors select-none ${dragOverFamilyId === group.key ? "bg-[var(--accent-color)]/20" : "bg-[var(--bg-hover)]/10"} text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)] ${composerMode === "family" ? "cursor-grab active:cursor-grabbing" : ""}`}
              >
                {group.label}
              </div>

              {group.models.map((m, _idx) => {
                const ollamaMeta = ollamaModels.find((model) => model.name === m.model_id);
                const speedStat = modelSpeedStats[m.model_id];
                const speedLabels = formatModelSpeed(speedStat);
                const modelParams = parseModelParamsB(m.model_id) ?? parseModelParamsB(m.name) ?? parseModelParamsB(ollamaMeta?.details?.parameter_size ?? "");
                const formattedParams = formatParams(modelParams);
                const formattedStorage = typeof ollamaMeta?.size === "number" ? formatBytes(ollamaMeta.size) : null;
                const modelFit = systemGuidance
                  ? classifyModelFit(modelParams, systemGuidance.recommendedMaxParamsB)
                  : "unknown";
                const fitMeta = getModelFitMeta(modelFit);
                const metadataParts = [formattedParams, formattedStorage].filter(Boolean) as string[];
                const isOllamaModel = m.provider === "ollama";
                const isWebModel = m.provider.startsWith("web_");
                const canBeBackgroundModel = isOllamaModel && m.enabled;
                const isBackgroundModel = dbSettings.background_model === m.model_id;
                const providerMeta = group;
                const capabilityBadges = (isOllamaModel ? ollamaMeta?.capabilities ?? [] : [])
                  .filter((c) => c.toLowerCase() !== "completion");
                const displayName = resolveModelDisplayName(m.model_id, modelLabels, aiModels);
                const secondaryDisplayName = resolveModelSecondaryDisplayName(m.model_id, m.provider);

                return (
                  <div
                    key={m.id}
                    data-model-id={m.id}
                    data-family-key={group.key}
                    className={`transition-colors select-none ${draggedModelId === m.id ? "opacity-50" : ""} ${dragOverModelId === m.id ? "bg-[var(--accent-color)]/10" : "hover:bg-[var(--bg-hover)]/5"} px-4 py-3`}
                  >
                    <div className="flex flex-col gap-2 md:grid md:grid-cols-[minmax(0,1fr)_100px_40px_120px_60px_60px_20px] md:items-start md:gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <div
                          className="flex items-center pt-1.5 text-[var(--text-muted)] cursor-grab hover:text-[var(--text-primary)]"
                          onPointerDown={(e) => {
                            if (editingModelId || m.id.startsWith("transient-") || e.button !== 0) {return;}
                            e.preventDefault();
                            e.stopPropagation();
                            setDraggedModelId(m.id);
                          }}
                        >
                          <GripVertical size={14} />
                        </div>

                        <div className="min-w-0 flex-1">
                          {editingModelId === m.id ? (
                            <input
                              autoFocus
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onBlur={async () => {
                                const nextName = editingName.trim() || m.model_id;
                                await api.aiModel.update(m.id, { name: nextName });
                                setEditingModelId(null);
                                loadAiModels();
                              }}
                              onKeyDown={async (e) => {
                                if (e.key === "Enter") {
                                  const nextName = editingName.trim() || m.model_id;
                                  await api.aiModel.update(m.id, { name: nextName });
                                  setEditingModelId(null);
                                  loadAiModels();
                                }
                                if (e.key === "Escape") { setEditingModelId(null); }
                              }}
                              className="w-full rounded border border-[var(--accent-color)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-sm text-[var(--text-primary)] outline-none"
                            />
                          ) : (
                            <div className="group min-w-0">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${fitMeta.dotClassName}`} title={fitMeta.title} />
                                <span className="truncate text-sm font-medium text-[var(--text-primary)]">{displayName}</span>
                                {!m.id.startsWith("transient-") && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingModelId(m.id);
                                      setEditingName(m.name);
                                    }}
                                    className="shrink-0 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--text-primary)]"
                                    title="Rename model"
                                    aria-label={`Rename ${displayName}`}
                                  >
                                    <Pencil size={10} />
                                  </button>
                                )}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-[var(--text-muted)]">
                                {!isOllamaModel && (
                                  <span className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                                    {providerMeta.label}
                                  </span>
                                )}
                                <span className="truncate">{secondaryDisplayName}</span>
                                {capabilityBadges.length > 0 && (
                                  <div
                                    className="ml-1 shrink-0 cursor-help text-[var(--text-muted)] transition-colors hover:text-[var(--accent-color)]"
                                    title={`Capabilities: ${capabilityBadges.map(formatCapabilityLabel).join(", ")}`}
                                  >
                                    <Info size={12} />
                                  </div>
                                )}
                              </div>
                              {(metadataParts.length > 0 || fitMeta.label) && (
                                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                                  {metadataParts.map((part, partIndex) => (
                                    <React.Fragment key={`${m.id}-${part}`}>
                                      {partIndex > 0 && <span className="text-[var(--text-muted)]">•</span>}
                                      <span>{part}</span>
                                    </React.Fragment>
                                  ))}
                                  {fitMeta.label && metadataParts.length > 0 && <span className="text-[var(--text-muted)]">•</span>}
                                  {fitMeta.label && <span className={`font-medium ${fitMeta.textClassName}`}>{fitMeta.label}</span>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {isOllamaModel && (
                        <label
                          className={`flex items-center justify-center md:w-[100px] ${canBeBackgroundModel ? "cursor-pointer text-[var(--text-secondary)]" : "cursor-not-allowed text-[var(--text-muted)] opacity-60"
                            }`}
                          title={canBeBackgroundModel ? "Use for background tasks" : "Enable this model to make it selectable for background tasks"}
                        >
                          <input
                            type="radio"
                            name="background_model"
                            checked={isBackgroundModel}
                            disabled={!canBeBackgroundModel}
                            onChange={() => set("background_model", m.model_id)}
                            className="accent-[var(--accent-color)]"
                            aria-label={`Use ${m.name} for background tasks`}
                          />
                          <span className="sr-only">Background model</span>
                        </label>
                      )}
                      {!isOllamaModel && <div className="hidden md:block md:w-7" />}

                      <button
                        onClick={() => toggleQuickSearchModel(m.model_id)}
                        className={`flex items-center justify-center md:w-10 transition-colors ${dbSettings.quick_search_models.includes(m.model_id)
                          ? "text-[var(--accent-color)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                          }`}
                        title={dbSettings.quick_search_models.includes(m.model_id) ? "Unpin from Quick Send" : "Pin to Quick Send"}
                      >
                        <Pin size={14} fill={dbSettings.quick_search_models.includes(m.model_id) ? "currentColor" : "none"} />
                      </button>

                      <div className="text-right text-[10px] leading-5 text-[var(--text-muted)] md:w-[120px]">
                        {m.is_paid && (
                          <div className="font-medium uppercase tracking-wide text-amber-400">Paid</div>
                        )}
                        {speedLabels && !isWebModel && (
                          <div
                            className="tabular-nums whitespace-nowrap text-[var(--text-secondary)]"
                            title={`Average generation speed across ${speedStat.chat_count} chats`}
                          >
                            {speedLabels.chatAverage} avg
                          </div>
                        )}
                        {speedLabels && !isWebModel && (
                          <div
                            className="tabular-nums whitespace-nowrap text-[var(--text-secondary)]"
                            title="Weighted overall generation speed across all recorded assistant messages"
                          >
                            {speedLabels.weighted} weighted
                          </div>
                        )}
                        {!isWebModel && (
                          <div
                            className="tabular-nums whitespace-nowrap"
                            title={`${m.tokens_used_total.toLocaleString()} total tokens recorded`}
                          >
                            {m.tokens_used_total.toLocaleString()} tok total
                          </div>
                        )}
                      </div>

                      <div className="flex justify-center pt-0.5 md:w-[80px]">
                        {!isWebModel && !m.id.startsWith("transient-") && (
                          <input
                            type="number"
                            min={512}
                            max={1048576}
                            step={512}
                            defaultValue={m.context_size ?? ""}
                            placeholder="auto"
                            className="w-[72px] rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1 py-0.5 text-center text-[10px] tabular-nums text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                            title="Per-model num_ctx override (tokens). Leave blank for the global default."
                            aria-label={`Context window for ${m.name}`}
                            onBlur={async (e) => {
                              const raw = e.currentTarget.value.trim();
                              const parsed = raw === "" ? null : Number.parseInt(raw, 10);
                              const next = parsed === null
                                ? null
                                : Number.isFinite(parsed) && parsed > 0
                                  ? Math.min(1_048_576, Math.max(512, parsed))
                                  : null;
                              if ((m.context_size ?? null) === next) {return;}
                              await api.aiModel.update(m.id, { context_size: next });
                              loadAiModels();
                            }}
                          />
                        )}
                      </div>

                      <div className="flex justify-center pt-0.5 md:w-[60px]">
                        <Toggle
                          on={m.enabled}
                          onToggle={async () => {
                            if (m.id.startsWith("transient-")) {
                              // Auto-add to DB on first enable
                              await api.aiModel.add(m.name, m.model_id, {
                                provider: m.provider,
                                enabled: true,
                                priority: aiModels.length > 0 ? Math.max(...aiModels.map(x => x.priority)) + 1 : 1
                              });
                            } else {
                              await api.aiModel.update(m.id, { enabled: !m.enabled });
                            }
                            loadAiModels();
                            incrementModelRefreshCounter();
                          }}
                        />
                      </div>

                      <div className="flex justify-center pt-1 md:w-[60px]">
                        <button
                          onClick={async () => {
                            await api.aiModel.update(m.id, { is_hidden: !m.is_hidden });
                            loadAiModels();
                            incrementModelRefreshCounter();
                          }}
                          className={`p-1 transition-colors ${m.is_hidden ? "text-[var(--text-muted)] hover:text-[var(--text-primary)]" : "text-[var(--accent-color)] hover:opacity-80"}`}
                          title={m.is_hidden ? "Show in Chat" : "Hide from Chat"}
                        >
                          {m.is_hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>

                      <button
                        onClick={async () => { await api.aiModel.delete(m.id); loadAiModels(); incrementModelRefreshCounter(); }}
                        className="p-1 text-[var(--text-muted)] transition-colors hover:text-red-400 md:w-5"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
          </div>
        </div>
      )}

      {composerMode === "family" && (
        <div className="pt-2">
          {isAddingGroup ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Group name (e.g. Gemma)"
                className="w-48 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)] transition-all shadow-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newGroupName.trim()) {
                    addCustomModelFamily(newGroupName.trim());
                    setNewGroupName("");
                    setIsAddingGroup(false);
                  } else if (e.key === "Escape") {
                    setIsAddingGroup(false);
                    setNewGroupName("");
                  }
                }}
                onBlur={() => {
                  setIsAddingGroup(false);
                  setNewGroupName("");
                }}
              />
              <span className="text-[10px] text-[var(--text-muted)]">Press Enter to create</span>
            </div>
          ) : (
            <button
              onClick={() => setIsAddingGroup(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent-color)] hover:text-[var(--accent-color-hover)] transition-colors px-1"
            >
              <Plus size={14} />
              Add Group
            </button>
          )}
        </div>
      )}
    </div>
  );

  const NavPreview = ({ workspaceNav, sectionNav }: { workspaceNav: NavigationPresentation; sectionNav: NavigationPresentation }) => (
    <div className="mb-2 rounded overflow-hidden border border-[var(--border-color)] opacity-70 flex flex-col" style={{ height: 56 }}>
      {/* Workspace top bar */}
      {workspaceNav === "top-tabs" && (
        <div className="flex items-center gap-1 px-1.5 py-1 bg-[var(--bg-secondary)] shrink-0">
          <div className="h-2 w-6 rounded-full bg-[var(--accent-color)] opacity-80" />
          <div className="h-2 w-4 rounded-full bg-[var(--text-muted)] opacity-40" />
          <div className="h-2 w-5 rounded-full bg-[var(--text-muted)] opacity-40" />
        </div>
      )}
      {workspaceNav === "top-dropdown" && (
        <div className="flex items-center gap-1.5 px-1.5 py-1 bg-[var(--bg-secondary)] shrink-0">
          <div className="h-2 w-9 rounded-full bg-[var(--accent-color)] opacity-80" />
          <div className="h-1.5 w-1.5 bg-[var(--text-muted)] opacity-40" style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
        </div>
      )}
      {/* Section top bar (only when workspace is not sidebar) */}
      {workspaceNav !== "sidebar" && sectionNav === "top-tabs" && (
        <div className="flex items-center gap-1 px-1.5 py-0.5 bg-[var(--bg-secondary)]/70 shrink-0">
          <div className="h-1.5 w-5 rounded-full bg-[var(--accent-color)] opacity-70" />
          <div className="h-1.5 w-3 rounded-full bg-[var(--text-muted)] opacity-35" />
          <div className="h-1.5 w-4 rounded-full bg-[var(--text-muted)] opacity-35" />
        </div>
      )}
      {workspaceNav !== "sidebar" && sectionNav === "top-dropdown" && (
        <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-[var(--bg-secondary)]/70 shrink-0">
          <div className="h-1.5 w-7 rounded-full bg-[var(--accent-color)] opacity-70" />
          <div className="h-1 w-1 bg-[var(--text-muted)] opacity-35" style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
        </div>
      )}
      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Workspace sidebar rail */}
        {workspaceNav === "sidebar" && (
          <div className="flex flex-col gap-1 px-1 pt-1 bg-[var(--bg-secondary)] w-7 shrink-0">
            <div className="h-1.5 w-4 rounded-sm bg-[var(--accent-color)] opacity-80" />
            <div className="h-1.5 w-3 rounded-sm bg-[var(--text-muted)] opacity-40" />
            <div className="h-1.5 w-4 rounded-sm bg-[var(--text-muted)] opacity-40" />
          </div>
        )}
        {/* Section sidebar rail (inside body) */}
        {sectionNav === "sidebar" && (
          <div className="flex flex-col gap-1 px-1 pt-1 bg-[var(--bg-secondary)]/60 w-6 shrink-0">
            <div className="h-1.5 w-3 rounded-sm bg-[var(--accent-color)] opacity-70" />
            <div className="h-1.5 w-3 rounded-sm bg-[var(--text-muted)] opacity-35" />
            <div className="h-1.5 w-3 rounded-sm bg-[var(--text-muted)] opacity-35" />
          </div>
        )}
        {/* Section top bars when workspace is sidebar */}
        {workspaceNav === "sidebar" && sectionNav === "top-tabs" && (
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-[var(--bg-secondary)]/70 shrink-0">
              <div className="h-1.5 w-5 rounded-full bg-[var(--accent-color)] opacity-70" />
              <div className="h-1.5 w-3 rounded-full bg-[var(--text-muted)] opacity-35" />
              <div className="h-1.5 w-4 rounded-full bg-[var(--text-muted)] opacity-35" />
            </div>
            <div className="flex-1 px-1.5 pt-1 flex flex-col gap-1 bg-[var(--bg-primary)]">
              <div className="h-1.5 w-8 rounded-sm bg-[var(--text-muted)] opacity-25" />
              <div className="h-1.5 w-6 rounded-sm bg-[var(--text-muted)] opacity-15" />
            </div>
          </div>
        )}
        {workspaceNav === "sidebar" && sectionNav === "top-dropdown" && (
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-[var(--bg-secondary)]/70 shrink-0">
              <div className="h-1.5 w-7 rounded-full bg-[var(--accent-color)] opacity-70" />
              <div className="h-1 w-1 bg-[var(--text-muted)] opacity-35" style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
            </div>
            <div className="flex-1 px-1.5 pt-1 flex flex-col gap-1 bg-[var(--bg-primary)]">
              <div className="h-1.5 w-8 rounded-sm bg-[var(--text-muted)] opacity-25" />
              <div className="h-1.5 w-6 rounded-sm bg-[var(--text-muted)] opacity-15" />
            </div>
          </div>
        )}
        {/* Content area (default — no special section handling needed) */}
        {!(workspaceNav === "sidebar" && sectionNav !== "sidebar") && (
          <div className="flex-1 px-1.5 pt-1 flex flex-col gap-1 bg-[var(--bg-primary)]">
            <div className="h-1.5 w-8 rounded-sm bg-[var(--text-muted)] opacity-25" />
            <div className="h-1.5 w-6 rounded-sm bg-[var(--text-muted)] opacity-15" />
          </div>
        )}
      </div>
    </div>
  );

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
          <aside className="w-52 shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2.5 py-4 overflow-y-auto">
            {settingsTabButtons}
          </aside>
        )}

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {(activeTab === "app" || activeTab === "navigation" || activeTab === "appearance" || activeTab === "chat" || activeTab === "ai" || activeTab === "security" || activeTab === "webai" || activeTab === "sync") && (
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              <div className={`${contentWidthClassName} space-y-4`}>

                {/* ── App ── */}
                {activeTab === "app" && (
                  <>
                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Startup & background</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Control how Aetherium launches and whether it stays available after the main window closes.
                        </p>
                      </div>

                      <div className="flex items-center justify-between py-0.5">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">
                            {isLinux ? "Start with desktop session" : "Start at login"}
                          </p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {isLinux
                              ? "Adds Aetherium to your desktop environment's autostart applications"
                              : "Automatically launch Aetherium when you log in"}
                          </p>
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

                      <div className="flex items-center justify-between py-0.5">
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

                      <div className="flex items-center justify-between py-0.5">
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

                      <div className="flex items-center justify-between py-0.5">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Hide native menu</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Removes the standard application menu bar (macOS only).
                          </p>
                        </div>
                        <Toggle
                          on={dbSettings.hide_native_menu}
                          onToggle={() => set("hide_native_menu", !dbSettings.hide_native_menu)}
                        />
                      </div>

                      {isDemoMode ? (
                        <div className="flex items-center justify-between py-0.5">
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Exit Demo Mode</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              Exit demo and return to your regular workspaces. All demo data will be deleted.
                            </p>
                          </div>
                          <button
                            onClick={async () => {
                              try {
                                // Mark demo as dismissed to prevent re-auto-activation
                                await api.settings.update({ ...dbSettings, demo_dismissed: true });
                                await api.demo.deactivate();
                                setDemo(false);
                                window.location.reload();
                              } catch (e) {
                                await message(`Failed to exit demo mode.\n${e}`, { title: "Error", kind: "error" });
                              }
                            }}
                            className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 transition-colors hover:border-red-500 hover:bg-red-500/10"
                          >
                            Exit Demo
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between py-0.5">
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Start Demo Mode</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              Explore Aetherium with pre-populated examples and a fully featured workspace.
                            </p>
                          </div>
                          <button
                            onClick={async () => {
                              try {
                                // Ensure demo_dismissed is false when manually starting demo
                                await api.settings.update({ ...dbSettings, demo_dismissed: false });
                                const demoWorkspaceId = await api.demo.activate();
                                setDemo(true, demoWorkspaceId);
                                window.location.reload();
                              } catch (e) {
                                await message(`Failed to activate demo mode.\n${e}`, { title: "Error", kind: "error" });
                              }
                            }}
                            className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--accent-color)]"
                          >
                            Start Demo
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Features</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Enable or disable optional features across Aetherium.
                        </p>
                      </div>

                      <div className="flex items-center justify-between py-0.5">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Workspace Memory</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Store and use workspace-scoped persistent facts, preferences, and context
                          </p>
                        </div>
                        <Toggle
                          on={dbSettings.memory_enabled}
                          onToggle={() => set("memory_enabled", !dbSettings.memory_enabled)}
                        />
                      </div>
                    </div>

                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-3">
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
                            Use a Tauri accelerator like <code>{isMac ? "Cmd+Shift+K" : "Ctrl+Shift+K"}</code>. Leave blank to disable the global hotkey.
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
                        placeholder={isMac ? "Cmd+Shift+K" : "Ctrl+Shift+K"}
                        className="h-11 w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                      />
                    </div>
                  </>
                )}

                {/* ── Navigation ── */}
                {activeTab === "navigation" && (
                  <>
                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Main layout</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Choose how workspace and section switching is presented in the main window.
                        </p>
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
                              className={`rounded-lg border px-3 py-2 text-left transition-colors ${workspaceNavigation === option.id
                                ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                                : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                }`}
                            >
                              <NavPreview workspaceNav={option.id as NavigationPresentation} sectionNav={sectionNavigation} />
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
                              className={`rounded-lg border px-3 py-2 text-left transition-colors ${sectionNavigation === option.id
                                ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                                : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                }`}
                            >
                              <NavPreview workspaceNav={workspaceNavigation} sectionNav={option.id as NavigationPresentation} />
                              <div className="text-xs font-medium">{option.label}</div>
                              <div className="mt-1 text-[11px] opacity-75">{option.description}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>


                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Workspace behavior</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Tune workspace ordering and what happens when you jump between workspaces.
                        </p>
                      </div>

                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block">Workspace Sort Order</label>
                        <div className="grid gap-2 sm:grid-cols-4">
                          {([
                            { id: "manual", label: "Manual Order" },
                            { id: "name-asc", label: "Name A\u2013Z" },
                            { id: "name-desc", label: "Name Z\u2013A" },
                            { id: "created-newest", label: "Newest First" },
                            { id: "created-oldest", label: "Oldest First" },
                            { id: "updated-newest", label: "Recently Updated" },
                            { id: "last-message-newest", label: "Last Message" },
                            { id: "updated-oldest", label: "Least Recently Updated" },
                          ] as const).map((option) => (
                            <button
                              key={option.id}
                              onClick={() => setWorkspaceSortOrder(option.id)}
                              className={`rounded-lg border px-3 py-2 text-left transition-colors ${workspaceSortOrder === option.id
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
                          <p className="text-sm text-[var(--text-secondary)]">Navigate on workspace switch</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Auto-navigate to a section when switching workspaces, or stay on the current view.
                          </p>
                        </div>
                        <select
                          value={switchWorkspaceSection}
                          onChange={(e) => set("switch_workspace_section", e.target.value)}
                          className="text-sm bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg px-2 py-1 text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                        >
                          <option value="">Stay on current</option>
                          <option value="/project">Dashboard</option>
                          <option value="/chat">Chat</option>
                          <option value="/notes">Notes</option>
                          <option value="/sources">Sources</option>
                          <option value="/graph">Knowledge</option>
                          <option value="/history">History</option>
                        </select>
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
                              className={`rounded-lg border px-3 py-2 text-left transition-colors ${settingsNavLayout === layout.id
                                ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                                : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                }`}
                            >
                              {/* Mini preview — shows what the settings panel will look like */}
                              {layout.id === "top-tabs" ? (
                                <div className="mb-2 rounded overflow-hidden border border-[var(--border-color)] opacity-70" style={{ height: 52 }}>
                                  {/* Settings header with horizontal tab bar */}
                                  <div className="flex items-center gap-1 px-2 py-1.5 bg-[var(--bg-secondary)]">
                                    <div className="h-2 w-6 rounded-full bg-[var(--accent-color)] opacity-80" />
                                    <div className="h-2 w-4 rounded-full bg-[var(--text-muted)] opacity-40" />
                                    <div className="h-2 w-5 rounded-full bg-[var(--text-muted)] opacity-40" />
                                    <div className="h-2 w-3 rounded-full bg-[var(--text-muted)] opacity-40" />
                                  </div>
                                  {/* Content area */}
                                  <div className="px-2 pt-1.5 flex flex-col gap-1 bg-[var(--bg-primary)]">
                                    <div className="h-1.5 w-12 rounded-sm bg-[var(--text-muted)] opacity-30" />
                                    <div className="h-1.5 w-8 rounded-sm bg-[var(--text-muted)] opacity-20" />
                                  </div>
                                </div>
                              ) : (
                                <div className="mb-2 rounded overflow-hidden border border-[var(--border-color)] opacity-70 flex" style={{ height: 52 }}>
                                  {/* Side rail with section list */}
                                  <div className="flex flex-col gap-1 px-1.5 pt-1.5 bg-[var(--bg-secondary)] w-10 shrink-0">
                                    <div className="h-1.5 w-6 rounded-sm bg-[var(--accent-color)] opacity-80" />
                                    <div className="h-1.5 w-5 rounded-sm bg-[var(--text-muted)] opacity-40" />
                                    <div className="h-1.5 w-7 rounded-sm bg-[var(--text-muted)] opacity-40" />
                                    <div className="h-1.5 w-4 rounded-sm bg-[var(--text-muted)] opacity-40" />
                                  </div>
                                  {/* Content area */}
                                  <div className="flex-1 px-2 pt-1.5 flex flex-col gap-1 bg-[var(--bg-primary)]">
                                    <div className="h-1.5 w-10 rounded-sm bg-[var(--text-muted)] opacity-30" />
                                    <div className="h-1.5 w-8 rounded-sm bg-[var(--text-muted)] opacity-20" />
                                  </div>
                                </div>
                              )}
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
                            onClick={() => updateSettings({ theme: t, accent_color: THEME_DEFAULT_ACCENTS[t] })}
                            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize ${dbSettings.theme === t
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
                            className={`relative h-8 w-8 rounded-full border-2 transition-transform ${dbSettings.accent_color === value ? "border-white scale-110 shadow-sm" : "border-transparent"
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

                    {isMac && (
                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block">Menubar Icon Style</label>
                        <div className="flex flex-wrap gap-2">
                          {["monochrome", "white", "black"].map((style) => (
                            <button
                              key={style}
                              onClick={() => updateSettings({ menubar_icon_style: style as "monochrome" | "white" | "black" })}
                              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize ${dbSettings.menubar_icon_style === style
                                ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                                : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                }`}
                            >
                              {style}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                  </>
                )}

                {/* ── AI / Ollama ── */}
                {activeTab === "ai" && (
                  <>
                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Detected hardware guidance</p>
                          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                            Based on detected memory and available compute.
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
                          {systemGuidance && (
                            <div className="rounded-lg border border-[var(--accent-color)]/20 bg-[var(--accent-color)]/8 px-3 py-2.5">
                              <p className="text-[11px] font-semibold text-[var(--text-primary)]">{systemGuidance.headline}</p>
                              <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{systemGuidance.summary}</p>
                              <p className="mt-1 text-[10px] text-[var(--text-secondary)]">{systemGuidance.basis}</p>
                            </div>
                          )}

                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                              <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">System</p>
                              <p className="mt-0.5 text-xs text-[var(--text-primary)]">{formatSystemName(systemSpecs)}</p>
                              <p className="text-[10px] text-[var(--text-secondary)]">{systemSpecs.cpu_arch}</p>
                            </div>
                            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                              <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">CPU</p>
                              <p className="mt-0.5 text-xs text-[var(--text-primary)]">{systemSpecs.cpu_brand}</p>
                              <p className="text-[10px] text-[var(--text-secondary)]">
                                {systemSpecs.physical_cores ? `${systemSpecs.physical_cores} physical` : "Physical cores unavailable"} / {systemSpecs.logical_cores} logical
                              </p>
                            </div>
                            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                              <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">Memory</p>
                              <p className="mt-0.5 text-xs text-[var(--text-primary)]">{formatBytes(systemSpecs.total_memory_bytes)} total</p>
                              <p className="text-[10px] text-[var(--text-secondary)]">{formatBytes(systemSpecs.available_memory_bytes)} available now</p>
                            </div>
                            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                              <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                                {systemSpecs.gpu_name ? "GPU" : "Swap"}
                              </p>
                              <p className="mt-0.5 text-xs text-[var(--text-primary)]">
                                {systemSpecs.gpu_name
                                  ? systemSpecs.gpu_name
                                  : `${formatBytes(systemSpecs.total_swap_bytes)} configured`}
                              </p>
                              <p className="text-[10px] text-[var(--text-secondary)]">
                                {systemSpecs.gpu_name
                                  ? (systemSpecs.gpu_memory_bytes
                                    ? `${formatBytes(systemSpecs.gpu_memory_bytes)} VRAM`
                                    : (systemSpecs.gpu_detection_source || "GPU memory unavailable"))
                                  : (systemSpecs.host_name ? systemSpecs.host_name : (systemSpecs.kernel_version || "Kernel version unavailable"))}
                              </p>
                            </div>
                          </div>

                          {systemGuidance?.caution && (
                            <p className="text-[10px] text-[var(--text-secondary)]">{systemGuidance.caution}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-[11px] text-[var(--text-secondary)]">
                          {systemSpecsLoading ? "Reading local system specs..." : (systemSpecsError || "System specs are not available yet.")}
                        </p>
                      )}
                    </div>

                    {ollamaModelsSection}

                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Local inference providers</h3>
                          <p className="text-xs text-[var(--text-muted)] mt-1">
                            Kept in one place so setup feels like one workflow. The local server is the main path, with MLX and llama.cpp as optional local runtimes.
                          </p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Local server</p>
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
                            <label className="text-xs text-[var(--text-secondary)]">Server URL</label>
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
                                Start server
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
                            Enable auto-start to try to start the server on launch when you use the default local address.
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

                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-3">
                      <div>
                        <p className="text-sm text-[var(--text-secondary)]">Dual-model execution</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          Choose whether the draft and refine models run one after the other or at the same time.
                        </p>
                      </div>
                      <CompactMenuSelect
                        label="Execution"
                        value={dbSettings.dual_model_execution_mode}
                        options={[
                          { value: "serial", label: "Serial: draft, then refine" },
                          { value: "parallel", label: "Parallel: draft and refine together" },
                        ]}
                        onChange={(val) => set("dual_model_execution_mode", val as AppSettings["dual_model_execution_mode"])}
                        widthClassName="w-full"
                      />
                      <p className="text-[10px] text-[var(--text-muted)]">
                        Serial is steadier and uses one Ollama generation at a time. Parallel feels faster overall, but can use more compute and memory.
                      </p>
                    </div>

                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Embedding model</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Choose the model used for embeddings and retrieval.
                        </p>
                      </div>

                      <div className="space-y-2">
                        {(() => {
                          const isModelInstalled = (name: string) =>
                            ollamaModels.length === 0 ||
                            ollamaModels.some((model) => model.name === name || model.name.startsWith(`${name}:`));
                          const nomicInstalled = isModelInstalled("nomic-embed-text");
                          const isCustom = dbSettings.embedding_model !== "nomic-embed-text";
                          const customInstalled = !isCustom || isModelInstalled(dbSettings.embedding_model);

                          return (
                            <>
                              <div className="flex flex-row flex-wrap gap-x-6 gap-y-2 mb-1">
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
                                  {!nomicInstalled && hasLoadedOllamaModels && (
                                    <span className="rounded border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
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
                              </div>

                              {isCustom && (
                                <div className="ml-6 space-y-2">
                                  <input
                                    value={dbSettings.embedding_model}
                                    onChange={(e) => set("embedding_model", e.target.value)}
                                    placeholder="e.g. mxbai-embed-large"
                                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                                  />
                                  {!customInstalled && dbSettings.embedding_model && hasLoadedOllamaModels && (
                                    <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
                                      <p className="text-[11px] font-medium text-red-400">Model not installed</p>
                                      <p className="mt-0.5 text-[10px] text-red-400/80">
                                        Run: <code className="rounded bg-[var(--bg-primary)] px-1">ollama pull {dbSettings.embedding_model}</code>
                                      </p>
                                    </div>
                                  )}
                                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 space-y-1">
                                    <p className="text-[11px] font-medium text-amber-400">Before switching</p>
                                    <ul className="ml-3 list-disc space-y-0.5 text-[10px] text-amber-400/80">
                                      <li>Pull the model first: <code className="rounded bg-[var(--bg-primary)] px-1">ollama pull model-name</code></li>
                                      <li>Changing models invalidates existing embeddings for memories, documents, and artifacts</li>
                                      <li>You will need to re-index data for search and deduplication to work correctly</li>
                                    </ul>
                                  </div>
                                </div>
                              )}

                              {!isCustom && !nomicInstalled && hasLoadedOllamaModels && (
                                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
                                  <p className="text-[11px] font-medium text-red-400">Model not installed — embeddings are disabled</p>
                                  <p className="mt-0.5 text-[10px] text-red-400/80">
                                    Run: <code className="rounded bg-[var(--bg-primary)] px-1">ollama pull nomic-embed-text</code>
                                  </p>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>

                  </>
                )}

                {/* ── Chat ── */}
                {activeTab === "chat" && (
                  <>
                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Conversation defaults</h3>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Set the instructions and learning behaviors that apply across chats and notes.
                          </p>
                        </div>
                        <label className="flex items-center gap-2 text-xs cursor-pointer whitespace-nowrap">
                          <Toggle
                            on={autoGenerateFlashcards}
                            onToggle={() => setAutoGenerateFlashcards(!autoGenerateFlashcards)}
                          />
                          <span className="text-[var(--text-secondary)]">Auto-generate Flashcards</span>
                        </label>
                      </div>

                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-1 block">Global Prompt Instructions</label>
                        <textarea
                          value={dbSettings.prompt_instructions}
                          onChange={(e) => set("prompt_instructions", e.target.value)}
                          placeholder="e.g. Always respond in concise bullet points…"
                          rows={3}
                          className="w-full text-sm bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] resize-y"
                        />
                      </div>
                    </div>

                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-2">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Composer Suggestions</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Manage the suggestion chips shown above the composer input.
                        </p>
                      </div>
                      <div className="flex flex-row items-center gap-x-5">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <Toggle on={showComposerTopicTags} onToggle={() => setShowComposerTopicTags(!showComposerTopicTags)} />
                          <span className="text-[var(--text-secondary)]">Topic tags</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <Toggle on={showComposerWorkspaceSuggestions} onToggle={() => setShowComposerWorkspaceSuggestions(!showComposerWorkspaceSuggestions)} />
                          <span className="text-[var(--text-secondary)]">Context prompts</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <Toggle on={showComposerChatFollowUps} onToggle={() => setShowComposerChatFollowUps(!showComposerChatFollowUps)} />
                          <span className="text-[var(--text-secondary)]">Follow-up suggestions</span>
                        </label>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-2">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Composer Mode</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Normal: one send button per message. Family: send buttons grouped by model family.
                        </p>
                      </div>
                      <div className="flex flex-row items-center gap-x-6">
                        {(["normal", "family"] as const).map((mode) => (
                          <label key={mode} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="radio"
                              name="composer_mode"
                              checked={composerMode === mode}
                              onChange={() => setComposerMode(mode)}
                              className="accent-[var(--accent-color)]"
                            />
                            <span className="text-[var(--text-secondary)] capitalize">{mode}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Chat Title Auto-Generation */}
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] mb-2 block">Chat Title Auto-Generation</label>
                      <div className="flex flex-row items-center gap-x-6">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name="chat_title_refresh"
                            checked={dbSettings.chat_title_auto_refresh === "disabled"}
                            onChange={() => set("chat_title_auto_refresh", "disabled")}
                            className="accent-[var(--accent-color)]"
                          />
                          <span className="text-[var(--text-secondary)]">Disabled</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name="chat_title_refresh"
                            checked={dbSettings.chat_title_auto_refresh === "initial_only"}
                            onChange={() => set("chat_title_auto_refresh", "initial_only")}
                            className="accent-[var(--accent-color)]"
                          />
                          <span className="text-[var(--text-secondary)]">Initial title only</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer whitespace-nowrap">
                          <input
                            type="radio"
                            name="chat_title_refresh"
                            checked={dbSettings.chat_title_auto_refresh === "periodic"}
                            onChange={() => set("chat_title_auto_refresh", "periodic")}
                            className="accent-[var(--accent-color)]"
                          />
                          <span className="text-[var(--text-secondary)]">Refresh periodically every</span>
                          {dbSettings.chat_title_auto_refresh === "periodic" && (
                            <div className="flex items-center gap-2">
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
                        </label>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-2">
                        AI-generated titles improve chat organization. &apos;Periodic&apos; refreshes the title based on conversation progress.
                      </p>
                    </div>

                    {/* Deletion Settings */}
                    <div className="flex items-center justify-between py-0.5">
                      <div>
                        <p className="text-sm text-[var(--text-secondary)]">Immediate Delete</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">Bypass recycle bin and delete chats immediately with confirmation</p>
                      </div>
                      <Toggle on={dbSettings.immediate_delete} onToggle={() => set("immediate_delete", !dbSettings.immediate_delete)} />
                    </div>

                    {!dbSettings.immediate_delete && (
                      <div className="flex items-center justify-between py-0.5">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Confirm Move to Trash</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">Prompt for confirmation before moving chats to the recycle bin</p>
                        </div>
                        <Toggle on={dbSettings.confirm_move_to_trash} onToggle={() => set("confirm_move_to_trash", !dbSettings.confirm_move_to_trash)} />
                      </div>
                    )}

                    {/* Show Gen Info */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between py-0.5">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Show Gen Info</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">Display token count, duration, and speed (tok/s) below assistant messages. Speed benchmarks are suppressed for Web AI models.</p>
                        </div>
                        <Toggle on={showGenInfo} onToggle={() => setShowGenInfo(!showGenInfo)} />
                      </div>
                      {showGenInfo && (
                        <div className="flex flex-row items-center gap-x-5 ml-4 border-l border-[var(--border-color)] pl-4 py-2">
                          <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <Toggle on={showGenInfoModel} onToggle={() => setShowGenInfoModel(!showGenInfoModel)} />
                            <span className="text-[var(--text-secondary)]">Model name</span>
                          </label>
                          <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <Toggle on={showGenInfoTokenCount} onToggle={() => setShowGenInfoTokenCount(!showGenInfoTokenCount)} />
                            <span className="text-[var(--text-secondary)]">Token count</span>
                          </label>
                          <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <Toggle on={showGenInfoDuration} onToggle={() => setShowGenInfoDuration(!showGenInfoDuration)} />
                            <span className="text-[var(--text-secondary)]">Generation duration</span>
                          </label>
                          <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <Toggle on={showGenInfoSpeed} onToggle={() => setShowGenInfoSpeed(!showGenInfoSpeed)} />
                            <span className="text-[var(--text-secondary)]">Generation speed (tok/s)</span>
                          </label>
                        </div>
                      )}
                    </div>

                    {/* Scroll message to top on send */}
                    <div className="flex items-center justify-between py-0.5">
                      <div>
                        <p className="text-sm text-[var(--text-secondary)]">Scroll Message to Top on Send</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">After sending, scroll so your message appears at the top of the view</p>
                      </div>
                      <Toggle on={scrollToTopOnSend} onToggle={() => setScrollToTopOnSend(!scrollToTopOnSend)} />
                    </div>

                    {/* Chat messages style */}
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] mb-2 block">Chat Messages Style</label>
                      <div className="flex flex-row flex-wrap gap-x-6 gap-y-2">
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
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Manual Browser Targets</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Use manual browser automation for user-configured web targets. Select an enabled browser-backed model from the Chat view model dropdown to activate it. Requires Node.js and the <code className="px-1 py-0.5 rounded bg-[var(--bg-hover)] font-mono text-[10px]">playwright</code> npm package (<code className="px-1 py-0.5 rounded bg-[var(--bg-hover)] font-mono text-[10px]">npm install -g playwright && npx playwright install chromium</code>).
                        </p>
                      </div>
                      <button
                        onClick={() => { setShowAddModel(!showAddModel); setNewModelId(""); setNewModelName(""); setNewModelIsPaid(false); }}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 whitespace-nowrap"
                      >
                        <Plus size={11} /> Add Model
                      </button>
                    </div>

                    {showAddModel && (
                      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-4 mb-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Provider Target</label>
                            <CompactMenuSelect
                              label="Select Provider"
                              value={newModelId}
                              options={[
                                { value: "", label: "Select provider..." },
                                { value: "chatgpt-web", label: "ChatGPT (Web)" },
                                { value: "deepseek-web", label: "DeepSeek (Web)" },
                                { value: "claude-web", label: "Claude (Web)" },
                                { value: "gemini-web", label: "Gemini (Web)" },
                              ]}
                              onChange={(val) => {
                                setNewModelId(val);
                                if (!newModelName) {
                                  const label = val === "chatgpt-web" ? "ChatGPT" : val === "deepseek-web" ? "DeepSeek" : val === "claude-web" ? "Claude" : val === "gemini-web" ? "Gemini" : "";
                                  setNewModelName(label);
                                }
                              }}
                              widthClassName="w-full"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Display Name</label>
                            <input
                              value={newModelName}
                              onChange={(e) => setNewModelName(e.target.value)}
                              placeholder="e.g. Browser Assistant A"
                              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-[var(--border-color)]">
                          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                            <input type="checkbox" checked={newModelIsPaid} onChange={(e) => setNewModelIsPaid(e.target.checked)} className="accent-[var(--accent-color)]" />
                            Requires subscription (Paid)
                          </label>
                          <div className="flex gap-2">
                            <button onClick={() => setShowAddModel(false)} className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Cancel</button>
                            <button
                              disabled={!newModelId || !newModelName}
                              onClick={async () => {
                                const provider = `web_${newModelId.split("-")[0]}`;
                                await api.aiModel.add(newModelName, newModelId, {
                                  provider,
                                  is_paid: newModelIsPaid,
                                  enabled: true,
                                  priority: aiModels.length > 0 ? Math.max(...aiModels.map(m => m.priority)) + 1 : 1
                                });
                                loadAiModels();
                                incrementModelRefreshCounter();
                                setShowAddModel(false); setNewModelId(""); setNewModelName(""); setNewModelIsPaid(false);
                              }}
                              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40"
                            >
                              Add Target
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

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

                    {/* Web model list */}
                    {webAiModels.length > 0 && (
                      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] overflow-hidden">
                        <div className="grid grid-cols-[minmax(0,1fr)_60px_60px_20px] items-center gap-3 px-4 py-2.5 bg-[var(--bg-hover)]/30 border-b border-[var(--border-color)] text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                          <span>Model</span>
                          <span className="text-center">Active</span>
                          <span className="text-center">Visible</span>
                          <span />
                        </div>
                        <div className="divide-y divide-[var(--border-color)]">
                          {webAiModels.map((m) => {
                            const displayName = resolveModelDisplayName(m.model_id, modelLabels, aiModels);
                            const secondaryDisplayName = resolveModelSecondaryDisplayName(m.model_id, m.provider);
                            return (
                              <div key={m.id} className="px-4 py-3 hover:bg-[var(--bg-hover)]/5 transition-colors">
                                <div className="grid grid-cols-[minmax(0,1fr)_60px_60px_20px] items-center gap-3">
                                  <div className="min-w-0">
                                    <span className="text-sm font-medium text-[var(--text-primary)] truncate block">{displayName}</span>
                                    <span className="text-xs text-[var(--text-muted)] truncate block mt-0.5">{secondaryDisplayName}</span>
                                  </div>
                                  <div className="flex justify-center">
                                    <Toggle
                                      on={m.enabled}
                                      onToggle={async () => {
                                        await api.aiModel.update(m.id, { enabled: !m.enabled });
                                        loadAiModels();
                                        incrementModelRefreshCounter();
                                      }}
                                    />
                                  </div>
                                  <div className="flex justify-center">
                                    <button
                                      onClick={async () => {
                                        await api.aiModel.update(m.id, { is_hidden: !m.is_hidden });
                                        loadAiModels();
                                        incrementModelRefreshCounter();
                                      }}
                                      className={`p-1 transition-colors ${m.is_hidden ? "text-[var(--text-muted)] hover:text-[var(--text-primary)]" : "text-[var(--accent-color)] hover:opacity-80"}`}
                                      title={m.is_hidden ? "Show in Chat" : "Hide from Chat"}
                                    >
                                      {m.is_hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                  </div>
                                  <button
                                    onClick={async () => { await api.aiModel.delete(m.id); loadAiModels(); incrementModelRefreshCounter(); }}
                                    className="p-1 text-[var(--text-muted)] transition-colors hover:text-red-400"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="pt-2 space-y-2">
                      <p className="text-xs text-[var(--text-secondary)] font-medium">Using browser targets</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        Enabled browser targets appear as a dedicated <strong>Globe</strong> button in the Chat composer. Click it to pick a browser target and send your message.
                      </p>
                    </div>

                  </>
                )}

                {/* ── Security ── */}
                {activeTab === "security" && (
                  <>
                    {/* ── App Lock ── */}
                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] divide-y divide-[var(--border-color)]">
                      <div className={`flex items-center justify-between px-4 py-2 transition-opacity ${!pinConfigured ? "opacity-40" : ""}`}>
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
                            if (!pinConfigured) { return; }
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
                        <div className={`flex items-center justify-between px-4 py-2 transition-opacity ${!dbSettings.pin_lock_enabled ? "opacity-40" : ""}`}>
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
                              if (!dbSettings.pin_lock_enabled) { return; }
                              set("touch_id_enabled", !dbSettings.touch_id_enabled);
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {/* ── PIN Passcode ── */}
                    <div className={`rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-3 transition-opacity ${pinConfigured && !dbSettings.pin_lock_enabled ? "opacity-40 pointer-events-none" : ""}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">PIN passcode</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-sm">
                            4 to 8 digits. Stored as a hash, never plaintext.
                          </p>
                        </div>
                        <span className={`text-[11px] px-2 py-1 rounded-full border ${dbSettings.pin_lock_enabled
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
                        <p className={`text-xs ${pinMessage.type === "success" ? "text-emerald-400" : "text-red-400"
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
                    <div className={`space-y-2 transition-opacity ${!anyLockEnabled ? "opacity-40 pointer-events-none" : ""}`}>
                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block">Auto-lock</label>
                        <p className="text-[11px] text-[var(--text-muted)] mb-2">Auto-lock becomes active once a launch lock is enabled.</p>
                        <div className="flex flex-row flex-wrap gap-x-6 gap-y-2">
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
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
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
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
                                    if (val > 0) { set("auto_lock_minutes", val); }
                                  }}
                                  className="w-20 px-2 py-1 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                                />
                                <span className="text-xs text-[var(--text-secondary)]">minutes</span>
                              </span>
                            )}
                          </label>
                        </div>
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
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="space-y-8 p-5">
                  {/* Workspace backup section */}
                  <div>
                    <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Workspace Backup</h2>
                    <BackupSettingsSection />
                  </div>
                  {/* Global backup section */}
                  <div className="border-t border-[var(--border-color)] pt-8">
                    <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Global Backup</h2>
                    <GlobalBackupSection />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "import" && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <ImportSettingsSection />
            </div>
          )}

          {activeTab === "logs" && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <React.Suspense fallback={null}>
                <LogsView />
              </React.Suspense>
            </div>
          )}

          {activeTab === "memory" && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <MemoryView />
            </div>
          )}

          {activeTab === "mcp" && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-4xl w-full">
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
            </div>
          )}
        </div>
      </div >
    </div >
  );
}
