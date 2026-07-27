/**
 * PreferencesView — integrated preferences hub with focused tabs for app,
 * navigation, appearance, chat, inference, security, backup, and workspace controls.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { message } from "@tauri-apps/plugin-dialog";
import { Palette, Bot, ShieldCheck, HardDrive, Plus, LayoutGrid, Network, Globe, RefreshCw, GitBranch, Settings as SettingsIcon, MessageSquare, FolderInput, ScrollText, Info, Brain, ChevronDown, GraduationCap, Search, UserCircle, SlidersHorizontal, X } from "lucide-react";
import { api, type AppSettings, type AiModel, type MCPServerConfig, type GitSyncStatus, type SecurityStatus, type OllamaModel, type SystemSpecs, type ModelSpeedStat, type CoreSettings, type InferenceSettings, type AdvancedSettings, type InferenceJobSetting, type InferenceJobStatus, type BackgroundJobRunMode } from "../lib/api";
import { resolveModelDisplayName } from "../lib/modelDisplayName";
import { getModelGroupMeta } from "../lib/modelGroups";
import { groupModelsByFamily } from "../lib/modelFamilyGrouping";
import { useBackgroundJobsStore } from "../stores/backgroundJobs";
import { classifyModelFit, formatParams, inferHardwareModelGuidance, parseModelParamsB, type ModelFit } from "../lib/modelSizing";
import { normalizeTheme } from "../lib/theme";
import { useSettingsStore, type ChatMessageStyle, type CodeBlockColorPalette, type CodeBlockContainerStyle, type CodeBlockKeywordColor } from "../stores/settingsStore";
import { type NavigationPresentation, useWorkspaceStore } from "../stores/workspaceStore";
// Heavy tab-specific subviews are lazy-loaded so opening the standalone
// preferences window doesn't have to parse/initialize them up-front.
const WorkspaceSettingsView = React.lazy(() => import("./WorkspaceSettingsView"));
const BackupSettingsSection = React.lazy(() => import("./BackupSettingsSection"));
const GlobalBackupSection = React.lazy(() => import("./GlobalBackupSection"));
const BoomScrollExportSection = React.lazy(() => import("./BoomScrollExportSection"));
const ImportSettingsSection = React.lazy(() => import("./ImportSettingsSection"));
const GlobalMemoryView = React.lazy(() => import("./GlobalMemoryView"));
const LogsView = React.lazy(() => import("./LogsView"));
import { CompactMenuSelect } from "../components/CompactMenuSelect";
import { Tooltip } from "../components/Tooltip";
import { MOD_KEY, isLinux, isMac } from "../lib/platform";
import type { PreferencesSection } from "../components/navigationItems";
import { useAiModelSync } from "../hooks/useAiModelSync";
import { useNavigationHistory } from "../hooks/useNavigationHistory";
import { usePrefsWindowMode } from "../lib/prefsWindowMode";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import LiveAppPreview from "./preferences/LiveAppPreview";
import { Toggle } from "../components/Toggle";
import { ModelsTable } from "../components/ModelsTable";
import { AppPreferencesPanel } from "../components/preferences/AppPreferencesPanel";
import { AboutYouPreferencesPanel } from "../components/preferences/AboutYouPreferencesPanel";
import { AppearancePreferencesPanel } from "../components/preferences/AppearancePreferencesPanel";
import { WebAiPreferencesPanel } from "../components/preferences/WebAiPreferencesPanel";
import { NavigationPreferencesPanel } from "../components/preferences/NavigationPreferencesPanel";
import { ChatPreferencesPanel } from "../components/preferences/ChatPreferencesPanel";
import { SecurityPreferencesPanel } from "../components/preferences/SecurityPreferencesPanel";
import { InferencePreferencesPanel } from "../components/preferences/InferencePreferencesPanel";
import { LearningPreferencesPanel } from "../components/preferences/LearningPreferencesPanel";
import { SyncPreferencesPanel } from "../components/preferences/SyncPreferencesPanel";
import { McpPreferencesPanel } from "../components/preferences/McpPreferencesPanel";
import { DataControlsPreferences } from "../components/preferences/DataControlsPreferences";
import { STRUCTURED_OUTPUT_MIN_PARAMS_B, INFERENCE_JOBS_CATALOG, RUN_MODE_OPTIONS } from "../lib/inferenceJobsCatalog";

const TABS: { id: PreferencesSection; label: string; Icon: React.ElementType }[] = [
  { id: "app", label: "App", Icon: SettingsIcon },
  { id: "appearance", label: "Appearance", Icon: Palette },
  { id: "navigation", label: "Navigation", Icon: LayoutGrid },
  { id: "about-you", label: "About You", Icon: UserCircle },
  { id: "inference", label: "Inference", Icon: Bot },
  { id: "chat", label: "Chat", Icon: MessageSquare },
  { id: "learning", label: "Learning", Icon: GraduationCap },
  { id: "inference-jobs", label: "Inference Jobs", Icon: RefreshCw },
  { id: "memory", label: "Memory", Icon: Brain },
  { id: "mcp", label: "MCP", Icon: Network },
  { id: "webai", label: "Browser Automation", Icon: Globe },
  { id: "workspaces", label: "Workspaces", Icon: LayoutGrid },
  { id: "sync", label: "Sync", Icon: GitBranch },
  { id: "backup", label: "Backup", Icon: HardDrive },
  { id: "import", label: "Import", Icon: FolderInput },
  { id: "data", label: "Data Controls", Icon: SlidersHorizontal },
  { id: "security", label: "Security", Icon: ShieldCheck },
  { id: "logs", label: "Logs", Icon: ScrollText },
];

// Static keyword index per tab. Used to filter the tab navigation by option
// text — only the active tab is mounted, so we can't enumerate options at
// runtime across all tabs. Keep in sync when adding visible options.
const TAB_KEYWORDS: Record<string, string[]> = {
  app: [
    "Startup", "background", "Start at login", "desktop session", "Open in background",
    "Keep running in tray", "Hide native menu", "Single window mode", "Demo Mode",
    "Features", "Shortcut", "Quick search", "Git Sync",
    "Confirm Move to Trash", "Immediate Delete",
  ],
  navigation: [
    "Main layout", "Settings Navigation", "Workspace Navigation", "Section Navigation",
    "Sub-Workspace Navigation", "Sub-workspace",
    "Combine dropdowns into titlebar line", "Combine dropdowns", "titlebar line",
    "Workspace behavior", "Workspace Sort Order", "Navigate on workspace switch",
    "Stay on current", "Chat", "Dashboard", "History", "Knowledge", "Notes", "Sources",
  ],
  appearance: [
    "Theme", "Accent Color", "Theme & Accent", "Typography", "Interface",
    "Text Size", "Font size", "Menubar Icon Style",
  ],
  chat: [
    "Chat Layout", "Preview", "Expand Chat Container", "Scroll Message to Top",
    "Chat Messages Style", "Composer", "Input", "Composer Mode", "Composer Suggestions",
    "Workspace suggestions", "Follow-up suggestions", "Metadata", "Diagnostics",
    "Show Gen Info", "Token count", "Generation duration", "Model name", "Show Status Bar",
    "Chat Title Auto-Generation", "Initial title only", "Refresh periodically",
    "Chat Identifiers", "User Identifier", "Assistant Identifier",
    "Safety", "Deletion", "Confirm Move to Trash", "Immediate Delete",
  ],
  learning: [
    "Flashcards", "Auto-generate from chats", "Generation model",
  ],
  "about-you": [
    "About You", "Profile", "Name", "Pronouns", "Role", "Interests", "Inject into chat",
  ],
  inference: [
    "Local inference providers", "Ollama", "Server URL", "Remote Ollama", "Auto-start Ollama",
    "MLX", "llama.cpp", "Embedding model", "Dual-model execution",
    "Activity Monitor", "VRAM headroom", "Memory headroom", "Detected hardware",
    "Models", "Background model", "Draft model", "Compare models",
  ],
  "inference-jobs": [
    "Inference Jobs", "Background Tasks", "Background Jobs", "Run mode",
    "Auto", "Ask first", "Heavy model", "Small model", "Confirmation timeout",
    "Play button", "Memory Extraction", "Summarization", "Flashcard Generation",
    "Workspace Glossary", "Hover Definitions", "Topic Hierarchy",
    "Starter Prompts", "Topic Signatures",
  ],
  webai: [
    "Browser Automation", "Manual Browser Targets", "Preserve browser session",
    "Provider Target", "Display Name", "Model",
  ],
  security: [
    "PIN", "PIN passcode", "Require PIN on launch", "Auto-lock", "Lock after",
    "Touch ID", "Biometric", "Set a PIN", "Current PIN", "New PIN", "Confirm PIN",
  ],
  sync: [
    "Multi-device Sync", "Enable sync", "Remote URL", "Last synced", "Git",
  ],
  workspaces: ["Workspaces", "Workspace management"],
  data: ["Data Controls", "Reset AI-Inferred Workspace Data", "Derived data", "Global maintenance"],
  backup: ["Workspace Backup", "Global Backup", "Backup directory", "Schedule", "Boom Scroll"],
  import: ["Import", "Migrate"],
  mcp: ["Model Context Protocol", "MCP Server", "Server Name", "Command"],
  memory: ["Global Memory", "Memory entries"],
  logs: ["Logs", "Activity log"],
};

function tabMatchesFilter(tab: { id: string; label: string }, query: string): boolean {
  if (!query) { return true; }
  const q = query.toLowerCase();
  if (tab.label.toLowerCase().includes(q)) { return true; }
  if (tab.id.toLowerCase().includes(q)) { return true; }
  const kws = TAB_KEYWORDS[tab.id];
  if (kws && kws.some((kw) => kw.toLowerCase().includes(q))) { return true; }
  return false;
}

function normalizePreferencesSection(section: string | undefined): PreferencesSection | null {
  if (section === "general") {
    return "app";
  }
  if (section === "ai") {
    return "inference";
  }
  if (section === "scheduled-tasks") {
    return "inference-jobs";
  }
  return TABS.some((tab) => tab.id === section) ? section as PreferencesSection : null;
}

const IMMEDIATE_SAVE_EXCEPTIONS = new Set<keyof AppSettings>([]);
const SPLIT_LAYOUT_TABS: PreferencesSection[] = [
  "app",
  "navigation",
  "appearance",
  "inference",
  "chat",
  "learning",
  "about-you",
];

function PreferencesCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Tooltip content="Close Preferences" position="bottom">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close Preferences"
        className="flex h-7 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
      >
        <X size={14} />
        Done
      </button>
    </Tooltip>
  );
}

function normalizeAppSettingsTheme(settings: AppSettings): AppSettings {
  return {
    ...settings,
    theme: normalizeTheme(settings.theme),
  };
}

// Reassemble the three split settings slices into the AppSettings shape the
// Preferences form already operates on. Preferences edits every field, so it
// still needs to fetch all three — but it now does so in parallel with three
// small IPC payloads instead of serializing a single 70-field blob.
function mergeSplitSettings(
  core: CoreSettings,
  inference: InferenceSettings,
  advanced: AdvancedSettings,
): AppSettings {
  return {
    // core
    theme: core.theme,
    accent_color: core.accent_color,
    font_size: core.font_size,
    sidebar_width: core.sidebar_width,
    menubar_icon_style: core.menubar_icon_style,
    hide_native_menu: core.hide_native_menu,
    switch_workspace_section: core.switch_workspace_section,
    user_chat_label: core.user_chat_label,
    assistant_chat_label: core.assistant_chat_label,
    demo_dismissed: core.demo_dismissed,
    web_session_preserve: core.web_session_preserve,
    chat_title_auto_refresh: core.chat_title_auto_refresh,
    chat_title_refresh_interval: core.chat_title_refresh_interval,
    about_you: core.about_you,
    inject_about_you_into_chat: core.inject_about_you_into_chat,
    prompt_instructions: core.prompt_instructions,
    // inference
    preferred_model: inference.preferred_model,
    background_model: inference.background_model,
    summarization_model: inference.summarization_model,
    memory_extraction_model: inference.memory_extraction_model,
    memory_cleanup_model: inference.memory_cleanup_model,
    flashcard_model: inference.flashcard_model,
    flashcard_cleanup_model: inference.flashcard_cleanup_model,
    glossary_model: inference.glossary_model,
    topic_signature_model: inference.topic_signature_model,
    goal_suggestion_model: inference.goal_suggestion_model,
    concept_hierarchy_model: inference.concept_hierarchy_model,
    workspace_analysis_model: inference.workspace_analysis_model,
    embedding_model: inference.embedding_model,
    draft_model: inference.draft_model,
    compare_model_a: inference.compare_model_a,
    compare_model_b: inference.compare_model_b,
    ollama_base_url: inference.ollama_base_url,
    ollama_remote_enabled: inference.ollama_remote_enabled,
    auto_start_ollama: inference.auto_start_ollama,
    mlx_base_url: inference.mlx_base_url,
    llamacpp_model_paths: inference.llamacpp_model_paths,
    dual_model_enabled: inference.dual_model_enabled,
    dual_model_execution_mode: inference.dual_model_execution_mode,
    chat_json_storage: inference.chat_json_storage,
    chat_encryption_enabled: inference.chat_encryption_enabled,
    show_gen_info: inference.show_gen_info,
    show_gen_info_token_count: inference.show_gen_info_token_count,
    show_gen_info_duration: inference.show_gen_info_duration,
    show_gen_info_speed: inference.show_gen_info_speed,
    show_gen_info_model: inference.show_gen_info_model,
    background_inference_enabled: inference.background_inference_enabled,
    // advanced
    quick_search_models: advanced.quick_search_models,
    quick_search_shortcut: advanced.quick_search_shortcut,
    quick_search_workspace_scope: advanced.quick_search_workspace_scope,
    quick_search_type_filters: advanced.quick_search_type_filters,
    backup_enabled: advanced.backup_enabled,
    touch_id_enabled: advanced.touch_id_enabled,
    pin_lock_enabled: advanced.pin_lock_enabled,
    strict_auth_mode: advanced.strict_auth_mode,
    auto_lock_minutes: advanced.auto_lock_minutes,
    start_at_login: advanced.start_at_login,
    open_in_background: advanced.open_in_background,
    keep_running_in_tray: advanced.keep_running_in_tray,
    immediate_delete: advanced.immediate_delete,
    confirm_move_to_trash: advanced.confirm_move_to_trash,
    memory_enabled: advanced.memory_enabled,
    memory_extraction_threshold: advanced.memory_extraction_threshold,
    memory_extraction_idle_minutes: advanced.memory_extraction_idle_minutes,
    topic_analysis_interval_minutes: advanced.topic_analysis_interval_minutes,
    summarization_min_messages: advanced.summarization_min_messages,
    summarization_max_sessions: advanced.summarization_max_sessions,
    hover_definition_scan_enabled: advanced.hover_definition_scan_enabled,
    hover_definition_scan_max_sessions: advanced.hover_definition_scan_max_sessions,
    log_retention_enabled: advanced.log_retention_enabled,
    log_retention_days: advanced.log_retention_days,
    workspace_glossary_refresh_interval_minutes: advanced.workspace_glossary_refresh_interval_minutes,
    git_sync_interval_minutes: advanced.git_sync_interval_minutes,
    vram_headroom_gb: advanced.vram_headroom_gb,
    vram_headroom_percent: advanced.vram_headroom_percent,
    ram_headroom_gb: advanced.ram_headroom_gb,
    ram_headroom_percent: advanced.ram_headroom_percent,
    inference_job_runs_retention_days: advanced.inference_job_runs_retention_days,
  };
}

async function fetchSplitSettings(): Promise<AppSettings> {
  const [core, inference, advanced] = await Promise.all([
    api.settings.getCore(),
    api.settings.getInference(),
    api.settings.getAdvanced(),
  ]);
  return mergeSplitSettings(core, inference, advanced);
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

function useIsLargeScreen() {
  const [isLarge, setIsLarge] = useState(() => 
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(min-width: 1280px)").matches
      : true
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(min-width: 1280px)");
    const listener = (e: MediaQueryListEvent) => setIsLarge(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  return isLarge;
}

function handleLinuxPreferencesWheel(event: React.WheelEvent<HTMLDivElement>) {
  if (!isLinux || event.ctrlKey) { return; }
  const element = event.currentTarget;
  if (element.scrollHeight <= element.clientHeight) { return; }
  if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) { return; }

  const maxScrollTop = element.scrollHeight - element.clientHeight;
  const multiplier = event.deltaMode === 1 ? 48 : event.deltaMode === 2 ? element.clientHeight : 2.8;
  const nextScrollTop = Math.max(0, Math.min(maxScrollTop, element.scrollTop + event.deltaY * multiplier));
  if (nextScrollTop === element.scrollTop) { return; }

  event.preventDefault();
  element.scrollTop = nextScrollTop;
}

interface PreferencesSplitLayoutProps {
  isLargeScreen: boolean;
  children: React.ReactNode;
  dbSettings: AppSettings;
  hoverOverrides: {
    theme?: string | null;
    accentColor?: string | null;
    fontSize?: number | null;
    workspaceNavigation?: NavigationPresentation | null;
    sectionNavigation?: NavigationPresentation | null;
    subWorkspaceNavigation?: NavigationPresentation | null;
    workspaceSortOrder?: string | null;
    chatMessageStyle?: ChatMessageStyle | null;
    composerMode?: string | null;
  };
}

function PreferencesSplitLayout({
  isLargeScreen,
  children,
  dbSettings,
  hoverOverrides,
}: PreferencesSplitLayoutProps) {
  if (isLargeScreen && isLinux) {
    return (
      <div className="flex h-full min-h-0 flex-1 overflow-hidden">
        <div
          className="h-full min-h-0 basis-[55%] overflow-y-auto overscroll-contain px-5 py-4"
          onWheel={handleLinuxPreferencesWheel}
          data-testid="preferences-options-scroll"
        >
          <div className="max-w-4xl">
            {children}
          </div>
        </div>
        <div className="w-2 shrink-0 border-x-[3px] border-transparent bg-[var(--border-color)] bg-clip-content" />
        <div className="flex min-h-0 basis-[45%] flex-col items-center justify-center overflow-hidden bg-[var(--bg-secondary)]/10 p-6 select-none">
          <LiveAppPreview dbSettings={dbSettings} overrides={hoverOverrides} />
        </div>
      </div>
    );
  }

  if (isLargeScreen) {
    return (
      <PanelGroup direction="horizontal" className="flex h-full min-h-0 flex-1 overflow-hidden">
        <Panel
          id="prefs-options"
          order={0}
          defaultSize={55}
          minSize={30}
          className="h-full min-h-0"
        >
          <div
            className="h-full min-h-0 overflow-y-auto overscroll-contain px-5 py-4"
            onWheel={handleLinuxPreferencesWheel}
            style={isLinux ? { contain: "layout paint" } : undefined}
            data-testid="preferences-options-scroll"
          >
            <div className="max-w-4xl">
              {children}
            </div>
          </div>
        </Panel>
        <PanelResizeHandle className="w-2 border-x-[3px] border-transparent bg-[var(--border-color)] hover:bg-[var(--accent-color)] bg-clip-content transition-colors cursor-col-resize shrink-0" />
        <Panel
          id="prefs-preview"
          order={1}
          defaultSize={45}
          minSize={25}
          className="min-h-0 bg-[var(--bg-secondary)]/10 flex flex-col items-center justify-center p-6 select-none overflow-hidden"
          style={isLinux ? { contain: "layout paint style", transform: "translateZ(0)", backfaceVisibility: "hidden" } : undefined}
        >
          <LiveAppPreview dbSettings={dbSettings} overrides={hoverOverrides} />
        </Panel>
      </PanelGroup>
    );
  }

  return (
    <div
      className="h-full min-h-0 grow shrink max-w-4xl overflow-y-auto overscroll-contain px-5 py-4"
      onWheel={handleLinuxPreferencesWheel}
      data-testid="preferences-options-scroll"
    >
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

function scheduledStateMeta(state?: string): { label: string; className: string } {
  switch (state) {
    case "running":
      return { label: "Running", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
    case "queued":
      return { label: "Queued", className: "border-sky-500/30 bg-sky-500/10 text-sky-300" };
    case "due_now":
      return { label: "Due now", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" };
    case "disabled":
      return { label: "Disabled", className: "border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-muted)]" };
    case "no_eligible_work":
      return { label: "Up to date", className: "border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-muted)]" };
    case "waiting_for_idle":
      return { label: "Waiting", className: "border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]" };
    default:
      return { label: "Scheduled", className: "border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]" };
  }
}

function ScheduledJobStatePill({ state }: { state?: string }) {
  const meta = scheduledStateMeta(state);
  return (
    <span className={`inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function InferenceJobsCard({
  ollamaModels,
  aiModels,
  modelLabels,
  dbSettings,
  set,
  systemGuidance,
}: {
  ollamaModels: OllamaModel[];
  aiModels: AiModel[];
  modelLabels: Record<string, string>;
  dbSettings: AppSettings;
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  systemGuidance: ReturnType<typeof inferHardwareModelGuidance> | null;
}) {
  const [scheduled, setScheduled] = useState<Record<string, InferenceJobSetting>>({});
  const [statuses, setStatuses] = useState<Record<string, InferenceJobStatus>>({});
  const [timeoutSeconds, setTimeoutSec] = useState<number>(20);
  const [loading, setLoading] = useState<boolean>(true);
  const [queueingJob, setQueueingJob] = useState<string | null>(null);
  const [openJobModelMenu, setOpenJobModelMenu] = useState<string | null>(null);
  const jobMenuRef = useRef<HTMLDivElement | null>(null);
  const lastErrors = useBackgroundJobsStore((s) => s.lastErrors);
  const dismissError = useBackgroundJobsStore((s) => s.dismissError);

  useEffect(() => {
    if (!openJobModelMenu) { return; }
    function handlePointerDown(event: MouseEvent) {
      if (jobMenuRef.current?.contains(event.target as Node)) { return; }
      setOpenJobModelMenu(null);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenJobModelMenu(null);
      }
    }
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [openJobModelMenu]);

  const loadScheduledStatus = () => {
    return api.backgroundJobs.getInferenceJobStatuses().then((items) => {
      const byKey: Record<string, InferenceJobStatus> = {};
      for (const item of items) { byKey[item.job_key] = item; }
      setStatuses(byKey);
    }).catch(() => undefined);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.backgroundJobs.getInferenceJobSettings(),
      api.backgroundJobs.getInferenceJobStatuses().catch(() => [] as InferenceJobStatus[]),
    ]).then(([s, statusItems]) => {
      if (cancelled) { return; }
      const byKey: Record<string, InferenceJobSetting> = {};
      for (const j of s.jobs) { byKey[j.job_key] = j; }
      const statusByKey: Record<string, InferenceJobStatus> = {};
      for (const item of statusItems) { statusByKey[item.job_key] = item; }
      setScheduled(byKey);
      setStatuses(statusByKey);
      setTimeoutSec(s.confirm_timeout_seconds);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) { setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  const eligibleModels = aiModels.filter((m) => m.provider === "ollama" && m.enabled);
  const smallModelOptions = useMemo(
    () => {
      const bgId = dbSettings.background_model as string | undefined;
      let bgLabel = "background model";
      if (bgId) {
        bgLabel = resolveModelDisplayName(bgId, modelLabels, aiModels);
      } else {
        const topModel = [...eligibleModels].sort((a, b) => a.priority - b.priority)[0];
        if (topModel) {
          bgLabel = resolveModelDisplayName(topModel.model_id, modelLabels, aiModels);
        }
      }
      return [
        { value: "", label: `Default (${bgLabel})` },
        ...eligibleModels.map((m) => ({
          value: m.model_id,
          label: resolveModelDisplayName(m.model_id, modelLabels, aiModels),
        })),
      ];
    },
    [eligibleModels, modelLabels, aiModels, dbSettings.background_model],
  );
  // Parameter counts for every eligible model (null when unparseable).
  const modelParamsById = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const m of eligibleModels) {
      const meta = ollamaModels.find((om) => om.name === m.model_id);
      map.set(
        m.model_id,
        parseModelParamsB(m.model_id)
          ?? parseModelParamsB(m.name)
          ?? parseModelParamsB(meta?.details?.parameter_size ?? ""),
      );
    }
    return map;
  }, [eligibleModels, ollamaModels]);

  // Structured jobs must parse strict JSON — models under the floor are not
  // offered at all (models with unknown sizes stay selectable).
  const structuredEligibleModels = useMemo(
    () =>
      eligibleModels.filter((m) => {
        const params = modelParamsById.get(m.model_id);
        return params == null || params >= STRUCTURED_OUTPUT_MIN_PARAMS_B;
      }),
    [eligibleModels, modelParamsById],
  );

  const structuredSmallModelOptions = useMemo(
    () => [
      smallModelOptions[0],
      ...structuredEligibleModels.map((m) => ({
        value: m.model_id,
        label: resolveModelDisplayName(m.model_id, modelLabels, aiModels),
      })),
    ],
    [smallModelOptions, structuredEligibleModels, modelLabels, aiModels],
  );

  const structuredHeavyModelOptions = useMemo(
    () => [
      { value: "", label: "None (small model only)" },
      ...structuredEligibleModels.map((m) => ({
        value: m.model_id,
        label: resolveModelDisplayName(m.model_id, modelLabels, aiModels),
      })),
    ],
    [structuredEligibleModels, modelLabels, aiModels],
  );

  const heavyModelOptions = useMemo(
    () => [
      { value: "", label: "None (small model only)" },
      ...eligibleModels.map((m) => ({
        value: m.model_id,
        label: resolveModelDisplayName(m.model_id, modelLabels, aiModels),
      })),
    ],
    [eligibleModels, modelLabels, aiModels],
  );
  const manualModelOptions = useMemo(
    () => {
      const topModel = [...eligibleModels].sort((a, b) => a.priority - b.priority)[0];
      const topModelLabel = topModel
        ? resolveModelDisplayName(topModel.model_id, modelLabels, aiModels)
        : "top enabled model";

      return [
        { value: "", label: `Default - ${topModelLabel}` },
        ...eligibleModels.map((m) => ({
        value: m.model_id,
        label: resolveModelDisplayName(m.model_id, modelLabels, aiModels),
        })),
      ];
    },
    [eligibleModels, modelLabels, aiModels],
  );
  const modeOptions = RUN_MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

  const updateRunMode = (jobKey: string, mode: BackgroundJobRunMode) => {
    setScheduled((prev) => ({
      ...prev,
      [jobKey]: { ...(prev[jobKey] ?? { job_key: jobKey, run_mode: mode, heavy_model: "" }), run_mode: mode },
    }));
    void api.backgroundJobs.setInferenceJobSetting(`${jobKey}_run_mode`, mode);
  };

  const updateHeavyModel = (jobKey: string, modelId: string) => {
    setScheduled((prev) => ({
      ...prev,
      [jobKey]: { ...(prev[jobKey] ?? { job_key: jobKey, run_mode: "auto", heavy_model: modelId }), heavy_model: modelId },
    }));
    void api.backgroundJobs.setInferenceJobSetting(`${jobKey}_heavy_model`, modelId);
  };

  const queueJobNow = async (jobKey: string) => {
    setQueueingJob(jobKey);
    try {
      await api.backgroundJobs.queueNow(jobKey);
      await loadScheduledStatus();
    } finally {
      setQueueingJob((current) => current === jobKey ? null : current);
    }
  };

  const updateTimeout = (value: number) => {
    const clamped = Math.max(5, Math.min(120, value || 20));
    setTimeoutSec(clamped);
    void api.backgroundJobs.setInferenceJobSetting(
      "background_confirm_timeout_seconds",
      String(clamped),
    );
  };

  return (
    <section className="space-y-2 max-w-[1400px] mx-auto" data-pref-section>
      <div className="pb-1 border-b border-[var(--border-color)]">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          Inference Jobs
        </h3>
      </div>

      <div className="space-y-2">
        <div className="flex items-start gap-3 py-0.5">
          <Toggle
            on={dbSettings.background_inference_enabled}
            onToggle={() => set("background_inference_enabled", !dbSettings.background_inference_enabled)}
          />
          <p className="text-sm text-[var(--text-secondary)]">
            Run memory, summarization, and glossary jobs automatically when idle
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--text-secondary)]">Play-button confirmation timeout</p>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={5}
              max={120}
              value={timeoutSeconds}
              onChange={(e) => updateTimeout(Number(e.target.value))}
              className="w-16 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
            />
            <span className="text-xs text-[var(--text-muted)]">s</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--text-secondary)]">Keep run history for</p>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={365}
              value={Number(dbSettings.inference_job_runs_retention_days ?? 30)}
              onChange={(e) => {
                const next = Math.max(1, Math.min(365, Number(e.target.value) || 30));
                set("inference_job_runs_retention_days", next as never);
              }}
              className="w-16 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
            />
            <span className="text-xs text-[var(--text-muted)]">days</span>
          </div>
        </div>

        {loading && (
          <div className="py-3 text-xs text-[var(--text-muted)]">Loading…</div>
        )}

        {!loading && (
          <div className="space-y-4 md:space-y-0">
            {/* Table Header (hidden on mobile) */}
            <div className="hidden md:grid md:grid-cols-[minmax(320px,3.5fr)_minmax(96px,0.7fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(140px,1.2fr)_auto] gap-3 px-3 pb-2 border-b border-[var(--border-color)]">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Job</div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Run Mode
                <Tooltip content="Auto: runs in background. Ask first: prompts you to confirm before running."><Info size={12} /></Tooltip>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Small Model
                <Tooltip content="Fast model used for automatic background processing."><Info size={12} /></Tooltip>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Heavy Model
                <Tooltip content="Optional larger model used only when you manually confirm a run."><Info size={12} /></Tooltip>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Progress
                <Tooltip content="Average runtime and run count over the retention window (workspace-scoped). Falls back to pending work when no history exists yet."><Info size={12} /></Tooltip>
              </div>
              <div className="w-[88px]"></div>
            </div>

            <div className="space-y-2 md:space-y-0 md:divide-y md:divide-[var(--border-color)]">
              {INFERENCE_JOBS_CATALOG.map((job) => {
                const entry = scheduled[job.job_key];
                const status = statuses[job.job_key];
                const runMode = (entry?.run_mode ?? "auto") as BackgroundJobRunMode;
                const heavyModel = entry?.heavy_model ?? "";
                const smallModel = (dbSettings[job.model_setting] as string) ?? "";
                const isManualTask = job.manual === true;

                const smallSelected = smallModel ? eligibleModels.find((m) => m.model_id === smallModel) : null;
                const smallOllamaMeta = smallSelected ? ollamaModels.find((om) => om.name === smallSelected.model_id) : null;
                const smallParams = smallSelected
                  ? parseModelParamsB(smallSelected.model_id)
                    ?? parseModelParamsB(smallSelected.name)
                    ?? parseModelParamsB(smallOllamaMeta?.details?.parameter_size ?? "")
                  : null;
                const smallParamsLabel = smallParams != null ? formatParams(smallParams) : null;
                const smallFit = systemGuidance ? classifyModelFit(smallParams, systemGuidance.recommendedMaxParamsB) : "unknown";
                const smallFitMeta = getModelFitMeta(smallFit);

                const heavySelected = heavyModel ? eligibleModels.find((m) => m.model_id === heavyModel) : null;
                const heavyOllamaMeta = heavySelected ? ollamaModels.find((om) => om.name === heavySelected.model_id) : null;
                const heavyParams = heavySelected
                  ? parseModelParamsB(heavySelected.model_id)
                    ?? parseModelParamsB(heavySelected.name)
                    ?? parseModelParamsB(heavyOllamaMeta?.details?.parameter_size ?? "")
                  : null;
                const heavyParamsLabel = heavyParams != null ? formatParams(heavyParams) : null;

                // Structured jobs parse strict JSON from the model. Warn when
                // the model that will actually run (explicit small model, or
                // the background-model fallback) is below the reliability floor.
                const effectiveModelId =
                  smallModel ||
                  (dbSettings.background_model as string) ||
                  ([...eligibleModels].sort((a, b) => a.priority - b.priority)[0]?.model_id ?? "");
                const effectiveOllamaMeta = effectiveModelId
                  ? ollamaModels.find((om) => om.name === effectiveModelId)
                  : null;
                const effectiveParams = effectiveModelId
                  ? parseModelParamsB(effectiveModelId)
                    ?? parseModelParamsB(effectiveOllamaMeta?.details?.parameter_size ?? "")
                  : null;
                const structuredWarning =
                  job.structured &&
                  effectiveParams != null &&
                  effectiveParams < STRUCTURED_OUTPUT_MIN_PARAMS_B
                    ? `${resolveModelDisplayName(effectiveModelId, modelLabels, aiModels)} (${formatParams(effectiveParams) ?? "small"}) is below the ~${STRUCTURED_OUTPUT_MIN_PARAMS_B}B floor for this job — models this small usually emit invalid JSON, so runs will fail. Pick a ${STRUCTURED_OUTPUT_MIN_PARAMS_B}B+ model${smallModel ? "" : " or change the background model"}.`
                    : null;

                const failure = lastErrors.get(job.job_key);

                return (
                  <div
                    key={job.job_key}
                    className="rounded-lg md:rounded-none border md:border-0 border-[var(--border-color)] bg-[var(--bg-primary)] md:bg-transparent px-3 py-3"
                  >
                    {failure && (
                      <div className="mb-2 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5">
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-red-300">
                            Last run failed
                          </div>
                          <div className="mt-0.5 break-words text-[11px] leading-snug text-red-200">
                            {failure.message}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => dismissError(job.job_key)}
                          className="shrink-0 rounded p-0.5 text-red-300 transition-colors hover:bg-red-500/20 hover:text-red-100"
                          aria-label="Dismiss error"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-[minmax(320px,3.5fr)_minmax(96px,0.7fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(140px,1.2fr)_auto] gap-3 md:gap-3 items-start md:items-center">
                      {/* Column 1: Job Info */}
                      <div className="flex flex-col min-w-0 md:pr-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-[var(--text-primary)]">{job.label}</div>
                          {isManualTask ? (
                            <span className="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                              Manual
                            </span>
                          ) : (
                            <ScheduledJobStatePill state={status?.state} />
                          )}
                        </div>
                        <div className="mt-0.5 text-sm text-[var(--text-secondary)]">{job.description}</div>
                        <div className="mt-1 flex items-center gap-x-2 text-[11px] text-[var(--text-secondary)] overflow-hidden whitespace-nowrap text-ellipsis min-w-0">
                          <span className="shrink-0">{job.note}</span>
                          <span className="shrink-0 text-[var(--text-muted)]">·</span>
                          <span className="truncate">{isManualTask ? "global setting; uses the top enabled model unless overridden" : status?.due_label ?? "checks every minute when idle"}</span>
                        </div>
                      </div>

                      {/* Column 2: Run Mode */}
                      <div className="flex flex-col gap-1 min-w-0">
                        {!isManualTask ? (
                          <>
                            <div className="md:hidden text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Run mode</div>
                            <CompactMenuSelect
                              label="Run mode"
                              value={runMode}
                              options={modeOptions}
                              menuWidth={200}
                              onChange={(value) => updateRunMode(job.job_key, value as BackgroundJobRunMode)}
                            />
                          </>
                        ) : null}
                      </div>

                      {/* Column 3: Small Model */}
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="md:hidden text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
                          {isManualTask ? "Model" : "Small model"}
                        </div>
                        <CompactMenuSelect
                          label={isManualTask ? "Model" : "Small model"}
                          value={smallModel}
                          options={isManualTask ? manualModelOptions : job.structured ? structuredSmallModelOptions : smallModelOptions}
                          menuWidth={220}
                          onChange={(value) => set(job.model_setting, value as never)}
                        />
                        {smallSelected && (smallParamsLabel || smallFitMeta.label) && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-[var(--text-muted)] pl-1">
                            {smallParamsLabel && <span>{smallParamsLabel}</span>}
                            {smallParamsLabel && smallFitMeta.label && <span>·</span>}
                            {smallFitMeta.label && <span className={`font-medium ${smallFitMeta.textClassName}`}>{smallFitMeta.label}</span>}
                          </div>
                        )}
                        {structuredWarning && (
                          <div className="mt-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] leading-snug text-amber-300">
                            {structuredWarning}
                          </div>
                        )}
                      </div>

                      {/* Column 4: Heavy Model */}
                      <div className="flex flex-col gap-1 min-w-0">
                        {!isManualTask ? (
                          <>
                            <div className="md:hidden text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Heavy model</div>
                            <CompactMenuSelect
                              label="Heavy model"
                              value={heavyModel}
                              options={job.structured ? structuredHeavyModelOptions : heavyModelOptions}
                              menuWidth={220}
                              onChange={(value) => updateHeavyModel(job.job_key, value)}
                            />
                            {heavyParamsLabel && (
                              <div className="mt-0.5 text-[10px] text-[var(--text-muted)] pl-1">{heavyParamsLabel}</div>
                            )}
                          </>
                        ) : null}
                      </div>

                      {/* Column 5: Progress / monitoring */}
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="md:hidden text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Progress</div>
                        {(() => {
                          const runs = status?.runs_count ?? 0;
                          const avgMs = status?.avg_duration_ms ?? null;
                          const successRate = status?.success_rate ?? null;
                          const pendingTokens = status?.pending_input_tokens ?? 0;
                          const pendingCount = status?.pending_work_count ?? 0;

                          const formatMs = (ms: number) => {
                            if (ms < 1000) { return `${Math.round(ms)}ms`; }
                            if (ms < 60_000) { return `${(ms / 1000).toFixed(1)}s`; }
                            return `${Math.round(ms / 1000)}s`;
                          };
                          const formatTokens = (t: number) => {
                            if (t >= 10_000) { return `${Math.round(t / 1000)}k`; }
                            if (t >= 1000) { return `${(t / 1000).toFixed(1)}k`; }
                            return `${Math.round(t)}`;
                          };

                          if (runs > 0 && avgMs != null) {
                            const runStr = `${runs} run${runs === 1 ? "" : "s"}`;
                            const showRate = successRate != null && successRate < 0.999;
                            return (
                              <div className="flex flex-col text-[11px] text-[var(--text-secondary)] leading-tight">
                                <span>avg {formatMs(avgMs)}</span>
                                <span className="text-[var(--text-muted)]">
                                  {runStr}
                                  {showRate && ` · ${Math.round(successRate * 100)}% ok`}
                                </span>
                              </div>
                            );
                          }
                          if (pendingTokens > 0 || pendingCount > 0) {
                            const tokenStr = pendingTokens > 0 ? `~${formatTokens(pendingTokens)} tok pending` : "";
                            const countStr = pendingCount > 0
                              ? `${pendingCount} ${pendingCount === 1 ? "item" : "items"}`
                              : "";
                            return (
                              <div className="flex flex-col text-[11px] text-[var(--text-secondary)] leading-tight">
                                {tokenStr && <span>{tokenStr}</span>}
                                {countStr && <span className="text-[var(--text-muted)]">{countStr}</span>}
                              </div>
                            );
                          }
                          return <span className="text-[11px] text-[var(--text-muted)]">—</span>;
                        })()}
                      </div>

                      {/* Column 6: Action */}
                      <div className="flex justify-end w-full md:w-[110px]">
                        {!isManualTask ? (
                          <div ref={openJobModelMenu === job.job_key ? jobMenuRef : null} className="relative inline-flex shrink-0 items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--accent-color)] transition-colors">
                            <button
                              type="button"
                              onClick={() => void queueJobNow(job.job_key)}
                              disabled={queueingJob === job.job_key || status?.state === "running" || status?.state === "queued"}
                              className="px-2.5 py-1 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 rounded-l-lg"
                            >
                              {queueingJob === job.job_key ? "Queueing…" : status?.state === "queued" ? "Queued" : "Run next"}
                            </button>
                            <div className="h-3.5 w-[1px] bg-[var(--border-color)]" />
                            <button
                              type="button"
                              onClick={() => { setOpenJobModelMenu(openJobModelMenu === job.job_key ? null : job.job_key); }}
                              disabled={queueingJob === job.job_key || status?.state === "running" || status?.state === "queued"}
                              title="Select model to run job with"
                              className="px-1.5 py-1 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 rounded-r-lg"
                            >
                              <ChevronDown size={12} className={`transition-transform duration-200 ${openJobModelMenu === job.job_key ? "rotate-180" : ""}`} />
                            </button>

                            {openJobModelMenu === job.job_key && (
                              <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] max-h-56 overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1.5 shadow-xl text-xs text-[var(--text-primary)]">
                                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)] mb-1">
                                  Run {job.label} with Model
                                </div>
                                {eligibleModels.map((m) => {
                                  const isSelected = (heavyModel || smallModel) === m.model_id;
                                  return (
                                    <button
                                      key={m.model_id}
                                      type="button"
                                      onClick={() => {
                                        setOpenJobModelMenu(null);
                                        updateHeavyModel(job.job_key, m.model_id);
                                        void queueJobNow(job.job_key);
                                      }}
                                      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                                        isSelected ? "bg-[var(--accent-color)]/20 text-[var(--accent-color)] font-medium" : "text-[var(--text-secondary)] hover:bg-[var(--accent-color)]/15 hover:text-[var(--text-primary)]"
                                      }`}
                                    >
                                      <span className="truncate">{resolveModelDisplayName(m.model_id, modelLabels, aiModels)}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {job.cadence && job.cadence.length > 0 && (
                      <div className="mt-1 pt-1 flex flex-wrap items-center gap-x-4 gap-y-1 md:pl-3 md:border-l-2 md:border-[var(--border-color)]">
                        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
                          Timers
                        </span>
                        {job.cadence.map((field) => {
                          const gateOn = field.gatedBy
                            ? Boolean(dbSettings[field.gatedBy])
                            : true;
                          if (field.kind === "toggle") {
                            return (
                              <label key={String(field.setting)} className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                                <Toggle
                                  on={Boolean(dbSettings[field.setting])}
                                  onToggle={() => set(field.setting, !dbSettings[field.setting] as never)}
                                />
                                <span>{field.label}</span>
                              </label>
                            );
                          }
                          const currentValue = Number(dbSettings[field.setting] ?? field.fallback);
                          return (
                            <div
                              key={String(field.setting)}
                              className={`flex items-center gap-2 text-[11px] text-[var(--text-secondary)] ${gateOn ? "" : "opacity-50"}`}
                            >
                              <span>{field.label}</span>
                              <input
                                type="number"
                                min={field.min}
                                max={field.max}
                                disabled={!gateOn}
                                value={currentValue}
                                onChange={(e) => {
                                  const next = Math.max(
                                    field.min,
                                    Math.min(field.max, Number(e.target.value) || field.fallback),
                                  );
                                  set(field.setting, next as never);
                                }}
                                className="w-16 rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-0.5 text-center text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)] disabled:cursor-not-allowed"
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function PreferencesView() {
  const isLargeScreen = useIsLargeScreen();
  const settingsNavLayout = useSettingsStore((state) => state.settingsNavLayout);
  const [singleWindowMode, toggleSingleWindowMode] = usePrefsWindowMode();
  const composerMode = useSettingsStore((state) => state.composerMode);
  const modelFamilyLabels = useSettingsStore((state) => state.modelFamilyLabels);
  const setModelFamilyLabel = useSettingsStore((state) => state.setModelFamilyLabel);
  const customModelFamilies = useSettingsStore((state) => state.customModelFamilies);
  const addCustomModelFamily = useSettingsStore((state) => state.addCustomModelFamily);
  const _removeCustomModelFamily = useSettingsStore((state) => state.removeCustomModelFamily);
  const modelLabels = useSettingsStore((state) => state.modelLabels);
  const location = useLocation();
  const navigate = useNavigate();
  const { goBack, canGoBack } = useNavigationHistory();
  // Preferences is a routed screen; closing returns to wherever the user came
  // from, falling back to Dashboard when there is no in-app history to pop.
  const closePreferences = () => {
    if (canGoBack) {
      goBack();
    } else {
      navigate("/folder");
    }
  };
  const incrementModelRefreshCounter = useSettingsStore((state) => state.incrementModelRefreshCounter);
  const isDemoMode = useWorkspaceStore((state) => state.isDemoMode);
  const setDemo = useWorkspaceStore((state) => state.setDemo);
  const setWorkspaces = useWorkspaceStore((state) => state.setWorkspaces);

  const [hoverOverrides, setHoverOverrides] = useState<{
    theme?: string | null;
    accentColor?: string | null;
    fontSize?: number | null;
    workspaceNavigation?: NavigationPresentation | null;
    sectionNavigation?: NavigationPresentation | null;
    subWorkspaceNavigation?: NavigationPresentation | null;
    workspaceSortOrder?: string | null;
    chatMessageStyle?: ChatMessageStyle | null;
    composerMode?: string | null;
    codeBlockContainerStyle?: CodeBlockContainerStyle | null;
    codeBlockColorPalette?: CodeBlockColorPalette | null;
    codeBlockKeywordColor?: CodeBlockKeywordColor | null;
  }>({});

  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [activeTab, setActiveTab] = useState<PreferencesSection>(() => (window.localStorage.getItem("preferencesActiveTab") as PreferencesSection) || "app");
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set([activeTab]));
  const [tabFilter, setTabFilter] = useState("");
  const contentRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(activeTab)) { return prev; }
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

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

  // Filter option rows within the active tab. We tag each "section card" and
  // "option row" at runtime by walking the rendered DOM under the scroll
  // container. Cards/rows that don't contain the query text get hidden via a
  // data-attribute -> CSS rule. Matching substrings inside visible sections
  // are wrapped in <mark data-pref-highlight> so the user can see what hit.
  // The tab nav is filtered separately via the static TAB_KEYWORDS index
  // above (only the active tab is mounted).
  useEffect(() => {
    const root = contentRootRef.current;
    if (!root) { return; }
    const scrollers = Array.from(
      root.querySelectorAll<HTMLElement>('[data-testid="preferences-options-scroll"]'),
    );
    const query = tabFilter.trim().toLowerCase();

    const unwrapHighlights = (el: HTMLElement) => {
      el.querySelectorAll<HTMLElement>('mark[data-pref-highlight]').forEach((mark) => {
        const parent = mark.parentNode;
        if (!parent) { return; }
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
        parent.normalize();
      });
    };

    const reset = (el: HTMLElement) => {
      el.querySelectorAll<HTMLElement>('[data-pref-filtered]').forEach((node) => {
        node.removeAttribute('data-pref-filtered');
      });
      unwrapHighlights(el);
    };

    if (!query) {
      scrollers.forEach(reset);
      return;
    }

    const highlightInside = (root_: HTMLElement, q: string) => {
      const skipTags = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SCRIPT', 'STYLE', 'MARK']);
      const walker = document.createTreeWalker(root_, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) { return NodeFilter.FILTER_REJECT; }
          if (skipTags.has(parent.tagName)) { return NodeFilter.FILTER_REJECT; }
          if (parent.closest('[data-pref-filtered="hidden"]')) { return NodeFilter.FILTER_REJECT; }
          const text = node.nodeValue || '';
          if (!text.toLowerCase().includes(q)) { return NodeFilter.FILTER_REJECT; }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const textNodes: Text[] = [];
      let current = walker.nextNode();
      while (current) {
        textNodes.push(current as Text);
        current = walker.nextNode();
      }
      textNodes.forEach((node) => {
        const text = node.nodeValue || '';
        const lower = text.toLowerCase();
        const frag = document.createDocumentFragment();
        let cursor = 0;
        while (cursor < text.length) {
          const idx = lower.indexOf(q, cursor);
          if (idx === -1) {
            frag.appendChild(document.createTextNode(text.slice(cursor)));
            break;
          }
          if (idx > cursor) {
            frag.appendChild(document.createTextNode(text.slice(cursor, idx)));
          }
          const mark = document.createElement('mark');
          mark.setAttribute('data-pref-highlight', '');
          mark.textContent = text.slice(idx, idx + q.length);
          frag.appendChild(mark);
          cursor = idx + q.length;
        }
        node.parentNode?.replaceChild(frag, node);
      });
    };

    scrollers.forEach((scroller) => {
      reset(scroller);
      // Match both legacy card panels and flat <section data-pref-section> blocks.
      const sections = scroller.querySelectorAll<HTMLElement>(
        '[data-pref-section], div.rounded-xl.border',
      );
      sections.forEach((section) => {
        const sectionText = (section.textContent || '').toLowerCase();
        if (!sectionText.includes(query)) {
          section.setAttribute('data-pref-filtered', 'hidden');
          return;
        }
        const title = section.querySelector('h3');
        const titleMatch = title && (title.textContent || '').toLowerCase().includes(query);
        if (!titleMatch) {
          const rows = section.querySelectorAll<HTMLElement>(
            ':scope > div.flex.items-center.justify-between, :scope > div.flex.justify-between',
          );
          rows.forEach((row) => {
            const rowText = (row.textContent || '').toLowerCase();
            if (!rowText.includes(query)) {
              row.setAttribute('data-pref-filtered', 'hidden');
            }
          });
        }
      });
      // Highlight matches in everything that survived the filter.
      highlightInside(scroller, query);
    });
  }, [tabFilter, activeTab, dbSettings]);

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
  const [dbEncryptionStatus, setDbEncryptionStatus] = useState<{ configured: boolean; pending_restart: boolean; pending_action: string } | null>(null);

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

  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const systemGuidance = systemSpecs
    ? inferHardwareModelGuidance({
        ...systemSpecs,
        vram_headroom_gb: dbSettings?.vram_headroom_gb ?? 0,
        vram_headroom_percent: dbSettings?.vram_headroom_percent ?? 0,
        ram_headroom_gb: dbSettings?.ram_headroom_gb ?? 0,
        ram_headroom_percent: dbSettings?.ram_headroom_percent ?? 0,
      })
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
      const { groups } = groupModelsByFamily(
        allMerged,
        modelFamilyLabels,
        customModelFamilies,
        modelLabels,
        undefined,
        true
      );

      // We need to return the specific format PreferencesView expects: 
      // Array of { key, label, order, models: AiModel[] }
      return groups.map((g) => {
        // Convert ModelPickerOption[] back to AiModel[] by matching IDs
        const models = g.options
          .map(opt => allMerged.find(m => m.model_id === opt.value))
          .filter((m): m is AiModel => !!m);
        return {
          key: `family-${g.label.toLowerCase().replace(/\s+/g, "-")}`,
          label: g.label,
          order: 0,
          models
        };
      }).sort((a, b) => {
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
  }, [aiModels, nonEmbeddingOllamaModels, mlxModels, llamacppModels, composerMode, modelFamilyLabels, customModelFamilies, modelLabels]);

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

  // Git sync state
  const [gitSync, setGitSync] = useState<GitSyncStatus | null>(null);
  const [gitSyncUrl, setGitSyncUrl] = useState("");
  const [gitSyncing, setGitSyncing] = useState(false);
  const [gitSyncSaving, setGitSyncSaving] = useState(false);
  const isGitSyncSshUrl = gitSyncUrl.trim().startsWith("git@") || gitSyncUrl.trim().startsWith("ssh://");
  const [quickSearchShortcutDraft, setQuickSearchShortcutDraft] = useState("");
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
    settingsStore.setSummarizationModel(settings.summarization_model);
    settingsStore.setMemoryExtractionModel(settings.memory_extraction_model);
    settingsStore.setFlashcardModel(settings.flashcard_model);
    settingsStore.setGlossaryModel(settings.glossary_model);
    settingsStore.setTopicSignatureModel(settings.topic_signature_model);
    settingsStore.setGoalSuggestionModel(settings.goal_suggestion_model);
    settingsStore.setConceptHierarchyModel(settings.concept_hierarchy_model);
    settingsStore.setWorkspaceAnalysisModel(settings.workspace_analysis_model);
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
    settingsStore.setUserChatLabel(settings.user_chat_label);
    settingsStore.setAssistantChatLabel(settings.assistant_chat_label);
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

  const loadAiModels = useCallback(() => {
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
  }, []);

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

  function handleToggleRemoteOllama() {
    if (!dbSettings) { return; }
    const remoteEnabled = !dbSettings.ollama_remote_enabled;
    updateSettings({
      ollama_remote_enabled: remoteEnabled,
      auto_start_ollama: remoteEnabled ? false : dbSettings.auto_start_ollama,
    });
  }

  async function handleStartOllamaServer() {
    if (!dbSettings) { return; }
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
  }

  async function handleTestOllamaConnection() {
    if (!dbSettings) { return; }
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
  }

  function handleOllamaBaseUrlChange(value: string) {
    set("ollama_base_url", value);
    refreshOllamaModels(value, { clearResult: true });
  }

  async function handleTestMlxConnection() {
    if (!dbSettings) { return; }
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
  }

  useEffect(() => {
    fetchSplitSettings().then((s) => {
      const normalizedSettings = normalizeAppSettingsTheme(s);
      setDbSettings(normalizedSettings);
      dbSettingsRef.current = normalizedSettings;
      syncClientSettings(normalizedSettings);
    }).catch(() => { });
    loadAiModels();

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
        const s = await fetchSplitSettings();
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
  }, [setWorkspaces, loadAiModels]);

  // Tab-gated backend probes: only fire each (potentially slow) backend call
  // once, when the user first visits the tab that needs the data. This keeps
  // the initial preferences-window paint fast — especially the default "App"
  // tab, which doesn't need Ollama / system specs / MCP / git / security.
  const probedTabsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const probed = probedTabsRef.current;
    const inferenceTabs = new Set(["inference", "webai", "chat", "learning"]);
    if (inferenceTabs.has(activeTab)) {
      if (!probed.has("inference")) {
        probed.add("inference");
        loadSystemSpecs();
        const url = dbSettingsRef.current?.ollama_base_url ?? "";
        refreshOllamaModels(url, { useCache: true });
      }
    }
    if (activeTab === "security" && !probed.has("security")) {
      probed.add("security");
      api.security.getStatus().then(setSecurityStatus).catch(() => { });
      api.security.getDbEncryptionStatus().then(setDbEncryptionStatus).catch(() => { });
    }
    if (activeTab === "mcp" && !probed.has("mcp")) {
      probed.add("mcp");
      api.mcp.listServers().then(setMcpServers).catch(() => { });
    }
    if (activeTab === "sync" && !probed.has("sync")) {
      probed.add("sync");
      api.gitSync.getStatus().then((s) => { setGitSync(s); setGitSyncUrl(s.remote_url); }).catch(() => { });
    }
  }, [activeTab, dbSettings?.ollama_base_url]);

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    updateSettings({ [key]: value } as Partial<AppSettings>);
  }

  function setAppearance<K extends "theme" | "accent_color" | "font_size">(key: K, value: AppSettings[K]) {
    updateSettings({ [key]: value } as Partial<AppSettings>);
  }

  if (!dbSettings) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
        Loading preferences…
      </div>
    );
  }

  const normalizedTabFilter = tabFilter.trim().toLowerCase();
  const filteredTabs = normalizedTabFilter
    ? TABS.filter((tab) => tabMatchesFilter(tab, normalizedTabFilter))
    : TABS;

  const tabFilterInput = (
    <div className={`relative ${settingsNavLayout === "top-tabs" ? "w-48 flex-shrink-0" : "w-full mb-2"}`}>
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
      <input
        type="text"
        value={tabFilter}
        onChange={(e) => setTabFilter(e.target.value)}
        placeholder="Filter settings…"
        aria-label="Filter preferences sections"
        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] pl-7 pr-7 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-color)]"
      />
      {tabFilter && (
        <button
          onClick={() => setTabFilter("")}
          aria-label="Clear filter"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs leading-none px-1"
        >
          ×
        </button>
      )}
    </div>
  );

  const settingsTabButtons = (
    <div className={settingsNavLayout === "top-tabs" ? "flex gap-1.5 overflow-x-auto pb-0.5 flex-1 min-w-0" : "flex flex-col gap-1.5"}>
      {filteredTabs.length === 0 ? (
        <div className="text-xs text-[var(--text-muted)] px-2 py-3">No matching sections</div>
      ) : filteredTabs.map(({ id, label, Icon }) => {
        const idx = TABS.findIndex((t) => t.id === id);
        return (
        <Tooltip key={id} content={`${label} (${MOD_KEY}⇧${idx + 1})`} position={settingsNavLayout === "top-tabs" ? "bottom" : "right"}>
          <button
            onClick={() => setActiveTab(id)}
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
        </Tooltip>
        );
      })}
    </div>
  );

  const autosaveStatus = saveStatus === "saving"
    ? "Saving..."
    : saveStatus === "saved"
      ? "Saved"
      : saveStatus === "error"
        ? "Save failed"
        : "";

  const autosaveStatusClassName = saveStatus === "error"
    ? "text-red-400"
    : saveStatus === "saved"
      ? "text-emerald-400"
      : "text-[var(--text-muted)]";
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

      {(() => {
        const bgId = dbSettings.background_model as string | undefined;
        if (!bgId) {return null;}
        const bgMeta = ollamaModels.find((om) => om.name === bgId);
        const bgParams = parseModelParamsB(bgId) ?? parseModelParamsB(bgMeta?.details?.parameter_size ?? "");
        if (bgParams == null || bgParams >= STRUCTURED_OUTPUT_MIN_PARAMS_B) {return null;}
        return (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-snug text-amber-300">
            <span className="font-semibold">Background model is very small.</span>{" "}
            {resolveModelDisplayName(bgId, modelLabels, aiModels)} ({formatParams(bgParams) ?? "under 1B"}) is below the ~{STRUCTURED_OUTPUT_MIN_PARAMS_B}B floor for structured jobs (flashcards, glossary, starter prompts, memory extraction) — models this small usually emit invalid JSON, so those runs fail. Pick a {STRUCTURED_OUTPUT_MIN_PARAMS_B}B+ BG Default, or set per-job models in Inference Jobs.
          </div>
        );
      })()}

      {/* No background default at all — the more common broken state than a
          too-small one, and previously unsurfaced. */}
      {(() => {
        const bgId = dbSettings.background_model as string | undefined;
        const bgStillPresent = bgId ? aiModels.some((m) => m.model_id === bgId) : false;
        if (bgStillPresent) {return null;}
        if (aiModels.length === 0) {return null;}
        return (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-snug text-amber-300">
            <span className="font-semibold">No background default set.</span>{" "}
            {bgId
              ? `The previously selected model (${bgId}) is no longer available. `
              : ""}
            Background jobs (memory extraction, summarization, flashcards, glossary, topic signatures) have no fallback model — pick one below with <span className="font-medium">Set as default</span>, or set per-job models in Inference Jobs.
          </div>
        );
      })()}

      {aiModels.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] py-2">No models configured. Add one above to set up priority ordering.</p>
      ) : (
      <ModelsTable
        groups={localGroupedAiModels}
        aiModels={aiModels}
        ollamaModels={ollamaModels}
        modelSpeedStats={modelSpeedStats}
        modelLabels={modelLabels}
        backgroundModelId={dbSettings.background_model as string | undefined}
        recommendedMaxParamsB={systemGuidance ? systemGuidance.recommendedMaxParamsB : null}
        composerMode={composerMode}
        showFamilyHeadings={localGroupedAiModels.length > 1}
        editingModelId={editingModelId}
        editingName={editingName}
        onEditingNameChange={setEditingName}
        onStartRename={(m) => { setEditingModelId(m.id); setEditingName(m.name); }}
        onCommitRename={async (m) => {
          const nextName = editingName.trim() || m.model_id;
          await api.aiModel.update(m.id, { name: nextName });
          setEditingModelId(null);
          loadAiModels();
        }}
        onCancelRename={() => setEditingModelId(null)}
        draggedModelId={draggedModelId}
        dragOverModelId={dragOverModelId}
        draggedFamilyId={draggedFamilyId}
        dragOverFamilyId={dragOverFamilyId}
        onModelDragStart={setDraggedModelId}
        onFamilyDragStart={setDraggedFamilyId}
        onSelectBackgroundModel={(modelId) => set("background_model", modelId)}
        onToggleEnabled={async (m) => {
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
        onToggleHidden={async (m) => {
          await api.aiModel.update(m.id, { is_hidden: !m.is_hidden });
          loadAiModels();
          incrementModelRefreshCounter();
        }}
        onSaveContextSize={async (m, next) => {
          await api.aiModel.update(m.id, { context_size: next });
          loadAiModels();
        }}
        onClearContextSize={async (m) => {
          await api.aiModel.update(m.id, { context_size: null });
          loadAiModels();
        }}
      />
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

  return (
    <div ref={contentRootRef} className="flex h-full min-h-0 flex-col overflow-hidden [&_[data-pref-filtered=hidden]]:hidden">
      {settingsNavLayout === "top-tabs" ? (
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-0 border-b border-[var(--border-color)] flex-shrink-0">
          {settingsTabButtons}
          {tabFilterInput}
          <div className="mb-1 flex items-center gap-3">
            <div className={`text-xs ${autosaveStatusClassName}`}>{autosaveStatus}</div>
            <PreferencesCloseButton onClose={closePreferences} />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] flex-shrink-0">
          <div>
            <h1 className="text-sm font-semibold text-[var(--text-primary)]">Preferences</h1>
            <p className="text-[11px] text-[var(--text-muted)]">App configuration and workspace management</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`text-xs ${autosaveStatusClassName}`}>{autosaveStatus}</div>
            <PreferencesCloseButton onClose={closePreferences} />
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {settingsNavLayout === "side-tabs" && (
          <aside className="w-52 shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2.5 py-4 overflow-y-auto">
            {tabFilterInput}
            {settingsTabButtons}
          </aside>
        )}

        <div className={`flex h-full min-h-0 flex-1 overflow-hidden ${
          SPLIT_LAYOUT_TABS.includes(activeTab)
            ? "flex-row"
            : "flex-col"
        }`}>
          {SPLIT_LAYOUT_TABS.includes(activeTab) && (
            <PreferencesSplitLayout
              isLargeScreen={isLargeScreen}
              dbSettings={dbSettings}
              hoverOverrides={hoverOverrides}
            >
              <div className="space-y-5">
                  {activeTab === "app" && (
                  <AppPreferencesPanel
                    startAtLogin={dbSettings.start_at_login}
                    openInBackground={dbSettings.open_in_background}
                    keepRunningInTray={dbSettings.keep_running_in_tray}
                    hideNativeMenu={dbSettings.hide_native_menu}
                    onToggleStartAtLogin={() => {
                      const nextStartAtLogin = !dbSettings.start_at_login;
                      set("start_at_login", nextStartAtLogin);
                      if (!nextStartAtLogin && dbSettings.open_in_background) {
                        set("open_in_background", false);
                      }
                    }}
                    onToggleOpenInBackground={() => set("open_in_background", !dbSettings.open_in_background)}
                    onToggleKeepRunningInTray={() => set("keep_running_in_tray", !dbSettings.keep_running_in_tray)}
                    onToggleHideNativeMenu={() => set("hide_native_menu", !dbSettings.hide_native_menu)}
                    singleWindowMode={singleWindowMode}
                    onToggleSingleWindowMode={toggleSingleWindowMode}
                    isDemoMode={isDemoMode}
                    onExitDemo={async () => {
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
                    onStartDemo={async () => {
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
                    quickSearchShortcutDraft={quickSearchShortcutDraft}
                    onQuickSearchShortcutDraftChange={setQuickSearchShortcutDraft}
                    onCommitQuickSearchShortcut={(v) => set("quick_search_shortcut", v)}
                  />
                )}

                {/* ── Navigation ── */}
                {activeTab === "navigation" && (
                  <NavigationPreferencesPanel
                    onPreviewWorkspaceNavigation={(value) => setHoverOverrides((o) => ({ ...o, workspaceNavigation: value }))}
                    onPreviewSectionNavigation={(value) => setHoverOverrides((o) => ({ ...o, sectionNavigation: value }))}
                    onPreviewSubWorkspaceNavigation={(value) => setHoverOverrides((o) => ({ ...o, subWorkspaceNavigation: value }))}
                    onPreviewWorkspaceSortOrder={(value) => setHoverOverrides((o) => ({ ...o, workspaceSortOrder: value }))}
                    onSetSwitchWorkspaceSection={(value) => set("switch_workspace_section", value)}
                  />
                )}

                {/* ── Appearance ── */}
                {activeTab === "appearance" && (
                  <AppearancePreferencesPanel
                    dbSettings={dbSettings}
                    onSetFontSize={(value) => setAppearance("font_size", value)}
                    onPreviewFontSize={(value) => setHoverOverrides((o) => ({ ...o, fontSize: value }))}
                    onSetMenubarIconStyle={(style) => updateSettings({ menubar_icon_style: style })}
                    onSetTheme={(theme, accentColor) => updateSettings({ theme, accent_color: accentColor })}
                    onPreviewTheme={(theme, accentColor) => setHoverOverrides((o) => ({ ...o, theme, accentColor }))}
                    onSetAccentColor={(value) => setAppearance("accent_color", value)}
                    onPreviewAccentColor={(value) => setHoverOverrides((o) => ({ ...o, accentColor: value }))}
                  />
                )}

                {/* ── AI / Ollama ── */}
                {activeTab === "inference" && (
                  <InferencePreferencesPanel
                    dbSettings={dbSettings}
                    onSet={set}
                    systemSpecs={systemSpecs}
                    systemSpecsLoading={systemSpecsLoading}
                    systemSpecsError={systemSpecsError}
                    systemGuidance={systemGuidance}
                    onRefreshSystemSpecs={loadSystemSpecs}
                    ollamaTestResult={ollamaTestResult}
                    startingOllama={startingOllama}
                    testingOllama={testingOllama}
                    ollamaModelsLoading={ollamaModelsLoading}
                    hasLoadedOllamaModels={hasLoadedOllamaModels}
                    ollamaReachable={ollamaReachable}
                    ollamaModels={ollamaModels}
                    nonEmbeddingOllamaModels={nonEmbeddingOllamaModels}
                    onToggleRemoteOllama={handleToggleRemoteOllama}
                    onStartOllamaServer={handleStartOllamaServer}
                    onTestOllamaConnection={handleTestOllamaConnection}
                    onOllamaBaseUrlChange={handleOllamaBaseUrlChange}
                    testingMlx={testingMlx}
                    mlxTestResult={mlxTestResult}
                    onTestMlxConnection={handleTestMlxConnection}
                    modelsSection={ollamaModelsSection}
                  />
              )}

                {/* ── Chat ── */}
                {activeTab === "chat" && (
                  <ChatPreferencesPanel
                    dbSettings={dbSettings}
                    onSet={set}
                    onPreviewChatMessageStyle={(value) => setHoverOverrides((o) => ({ ...o, chatMessageStyle: value }))}
                    onPreviewCodeBlockContainerStyle={(value) => setHoverOverrides((o) => ({ ...o, codeBlockContainerStyle: value as CodeBlockContainerStyle | null }))}
                    onPreviewCodeBlockColorPalette={(value) => setHoverOverrides((o) => ({ ...o, codeBlockColorPalette: value as CodeBlockColorPalette | null }))}
                    onPreviewCodeBlockKeywordColor={(value) => setHoverOverrides((o) => ({ ...o, codeBlockKeywordColor: value as CodeBlockKeywordColor | null }))}
                    onPreviewComposerMode={(value) => setHoverOverrides((o) => ({ ...o, composerMode: value }))}
                  />
                )}

                {/* ── Learning ── */}
                {activeTab === "learning" && (
                  <LearningPreferencesPanel onNavigateToTab={setActiveTab} />
                )}

                {/* ── About You ── */}
                {activeTab === "about-you" && (
                  <AboutYouPreferencesPanel
                    initialAboutYou={dbSettings.about_you}
                    injectAboutYouIntoChat={dbSettings.inject_about_you_into_chat ?? true}
                    onSaveAboutYou={(val) => set("about_you", val)}
                    onSaveInject={(val) => set("inject_about_you_into_chat", val)}
                  />
                )}

                {/* ── Browser Automation ── */}



                </div>
            </PreferencesSplitLayout>
          )}

          {activeTab === "webai" && (
            <WebAiPreferencesPanel
              webSessionPreserve={dbSettings.web_session_preserve}
              onSetWebSessionPreserve={(value) => set("web_session_preserve", value)}
              aiModels={aiModels}
              webAiModels={webAiModels}
              modelLabels={modelLabels}
              onModelsChanged={() => { loadAiModels(); incrementModelRefreshCounter(); }}
            />
          )}

          {/* ── Security ── */}
          {activeTab === "security" && (
            <SecurityPreferencesPanel
              dbSettings={dbSettings}
              onSet={set}
              onPatchDbSettings={(patch) => setDbSettings((prev) => prev ? { ...prev, ...patch } : prev)}
              securityStatus={securityStatus}
              onSecurityStatusChange={setSecurityStatus}
              dbEncryptionStatus={dbEncryptionStatus}
              onDbEncryptionStatusChange={setDbEncryptionStatus}
            />
          )}

          {/* ── Sync ── */}
          {activeTab === "sync" && (
            <SyncPreferencesPanel
              dbSettings={dbSettings}
              gitSync={gitSync}
              gitSyncUrl={gitSyncUrl}
              gitSyncing={gitSyncing}
              gitSyncSaving={gitSyncSaving}
              isGitSyncSshUrl={isGitSyncSshUrl}
              onGitSyncUrlChange={setGitSyncUrl}
              onSyncIntervalChange={(value) => set("git_sync_interval_minutes", value)}
              onToggleEnabled={async () => {
                if (!gitSync) { return; }
                const next = !gitSync.enabled;
                setGitSyncSaving(true);
                try {
                  await api.gitSync.configure(gitSyncUrl, next);
                  setGitSync((s) => s ? { ...s, enabled: next } : s);

                } catch (e: unknown) {
                  setGitSync((s) => s ? { ...s, last_error: String(e) } : s);
                } finally {
                  setGitSyncSaving(false);
                }
              }}
              onSaveRemoteUrl={async () => {
                setGitSyncSaving(true);
                try {
                  await api.gitSync.configure(gitSyncUrl, gitSync?.enabled ?? false);
                  setGitSync((s) => s ? { ...s, remote_url: gitSyncUrl, last_error: "" } : s);

                } catch (e: unknown) {
                  setGitSync((s) => s ? { ...s, last_error: String(e) } : s);
                } finally {
                  setGitSyncSaving(false);
                }
              }}
              onTriggerSync={async () => {
                setGitSyncing(true);
                try {
                  const s = await api.gitSync.triggerSync();
                  setGitSync(s);

                } catch (e: unknown) {
                  setGitSync((s) => s ? { ...s, last_error: String(e) } : s);
                } finally {
                  setGitSyncing(false);
                }
              }}
            />
          )}

          {activeTab === "inference-jobs" && (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-5 py-4 space-y-4">
                <InferenceJobsCard
                  ollamaModels={ollamaModels}
                  aiModels={aiModels}
                  modelLabels={modelLabels}
                  dbSettings={dbSettings}
                  set={set}
                  systemGuidance={systemGuidance}
                />
              </div>
            </div>
          )}

          {/* ── Full-bleed tabs (workspaces, backup, import, logs, memory) ── */}
          {visitedTabs.has("workspaces") && (
            <div className={activeTab === "workspaces" ? "flex-1 min-h-0 overflow-hidden" : "hidden"}>
              <React.Suspense fallback={null}>
                <WorkspaceSettingsView />
              </React.Suspense>
            </div>
          )}

          {visitedTabs.has("data") && (
            <div className={activeTab === "data" ? "flex-1 min-h-0 overflow-hidden" : "hidden"}>
              <DataControlsPreferences />
            </div>
          )}

          {visitedTabs.has("backup") && (
            <div className={activeTab === "backup" ? "flex-1 min-h-0 overflow-hidden flex flex-col" : "hidden"}>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="space-y-8 p-5">
                  {/* Workspace backup section */}
                  <div>
                    <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Workspace Backup</h2>
                    <React.Suspense fallback={null}>
                      <BackupSettingsSection />
                    </React.Suspense>
                  </div>
                  {/* Global backup section */}
                  <div className="border-t border-[var(--border-color)] pt-8">
                    <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Global Backup</h2>
                    <React.Suspense fallback={null}>
                      <GlobalBackupSection />
                    </React.Suspense>
                  </div>
                  {/* Boom Scroll deck export section */}
                  <div className="border-t border-[var(--border-color)] pt-8">
                    <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Boom Scroll</h2>
                    <React.Suspense fallback={null}>
                      <BoomScrollExportSection />
                    </React.Suspense>
                  </div>
                </div>
              </div>
            </div>
          )}

          {visitedTabs.has("import") && (
            <div className={activeTab === "import" ? "flex-1 min-h-0 overflow-hidden" : "hidden"}>
              <React.Suspense fallback={null}>
                <ImportSettingsSection />
              </React.Suspense>
            </div>
          )}

          {visitedTabs.has("logs") && (
            <div className={activeTab === "logs" ? "flex-1 min-h-0 overflow-hidden flex flex-col" : "hidden"}>
              <div className="border-b border-[var(--border-color)] px-5 py-3 space-y-2">
                <div className="flex items-start gap-3 py-0.5">
                  <Toggle
                    on={dbSettings.log_retention_enabled}
                    onToggle={() => set("log_retention_enabled", !dbSettings.log_retention_enabled)}
                  />
                  <div>
                    <p className="text-sm text-[var(--text-secondary)]">Prune old logs</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Automatically remove in-app log entries older than the retention window.
                    </p>
                  </div>
                </div>
                <div className={`flex items-center justify-between py-0.5 ${dbSettings.log_retention_enabled ? "" : "opacity-50"}`}>
                  <p className="text-sm text-[var(--text-secondary)]">Keep logs for (days)</p>
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    disabled={!dbSettings.log_retention_enabled}
                    value={dbSettings.log_retention_days}
                    onChange={(e) => set("log_retention_days", Math.max(1, Math.min(3650, Number(e.target.value) || 30)))}
                    className="w-20 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)] disabled:cursor-not-allowed"
                  />
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <React.Suspense fallback={null}>
                  <LogsView />
                </React.Suspense>
              </div>
            </div>
          )}

          {visitedTabs.has("memory") && (
            <div className={activeTab === "memory" ? "flex-1 min-h-0 overflow-hidden" : "hidden"}>
              <React.Suspense fallback={null}>
                <GlobalMemoryView />
              </React.Suspense>
            </div>
          )}

          {activeTab === "mcp" && (
            <McpPreferencesPanel mcpServers={mcpServers} onMcpServersChange={setMcpServers} />
          )}
        </div>
      </div >
    </div >
  );
}
