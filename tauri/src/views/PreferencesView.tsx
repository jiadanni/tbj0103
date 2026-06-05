/**
 * PreferencesView — integrated preferences hub with focused tabs for app,
 * navigation, appearance, chat, AI, security, backup, and workspace controls.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { message } from "@tauri-apps/plugin-dialog";
import { Palette, Bot, ShieldCheck, HardDrive, Trash2, Plus, LayoutGrid, Network, Globe, Pencil, RefreshCw, GitBranch, Settings as SettingsIcon, MessageSquare, FileText, FolderInput, ScrollText, Eye, EyeOff, GripVertical, Pin, Info, Brain, ChevronDown, Lock, GraduationCap, Sparkles, Columns2, ChevronLeft, ChevronRight, BarChart2, Library, History, Search, Paperclip, Send, FileEdit, ArrowUpDown, UserCircle, SlidersHorizontal, RotateCcw, Loader2, X } from "lucide-react";
import { api, type AppSettings, type AiModel, type MCPServerConfig, type GitSyncStatus, type SecurityStatus, type OllamaModel, type SystemSpecs, type ModelSpeedStat, type CoreSettings, type AiSettings, type AdvancedSettings, type KnowledgeResetOptions, type KnowledgeResetResult, type ScheduledJobSetting, type BackgroundJobRunMode } from "../lib/api";
import { resolveModelDisplayName, resolveModelSecondaryDisplayName } from "../lib/modelDisplayName";
import { getModelGroupMeta } from "../lib/modelGroups";
import { groupModelsByFamily } from "../lib/modelFamilyGrouping";
import { applyHeadroom, classifyModelFit, formatBytes, formatParams, inferHardwareModelGuidance, parseModelParamsB, type ModelFit } from "../lib/modelSizing";
import { ACCENT_COLORS, THEMES, THEME_DEFAULT_ACCENTS, normalizeTheme } from "../lib/theme";
import { useSettingsStore, type ChatMessageStyle } from "../stores/settingsStore";
import { type NavigationPresentation, useWorkspaceStore } from "../stores/workspaceStore";
// Heavy tab-specific subviews are lazy-loaded so opening the standalone
// preferences window doesn't have to parse/initialize them up-front.
const WorkspaceSettingsView = React.lazy(() => import("./WorkspaceSettingsView"));
const BackupSettingsSection = React.lazy(() => import("./BackupSettingsSection"));
const GlobalBackupSection = React.lazy(() => import("./GlobalBackupSection"));
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
import { parseAboutYou, serializeAboutYou, EMPTY_ABOUT_YOU, type AboutYouProfile } from "../lib/aboutYou";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import ChatMessageBubble from "../components/ChatMessageBubble";
import SuccessDialog from "../components/SuccessDialog";
import type { Message } from "../stores/chatStore";


const NOOP = () => undefined;
const PREVIEW_MARKDOWN_COMPONENTS: Record<string, React.ElementType> = {};
const PREVIEW_PARENT_WORKSPACES: Array<{ id: string; name: string; index: number }> = [
  { id: "preview-ws-1", name: "General", index: 1 },
  { id: "preview-ws-2", name: "Learning", index: 2 },
  { id: "preview-ws-3", name: "Projects", index: 3 },
  { id: "preview-ws-4", name: "Reading", index: 4 },
  { id: "preview-ws-5", name: "Research", index: 5 },
];
const PREVIEW_CHILD_WORKSPACES: Array<{ id: string; name: string }> = [
  { id: "preview-child-1", name: "Overview" },
  { id: "preview-child-2", name: "Notes" },
  { id: "preview-child-3", name: "Resources" },
  { id: "preview-child-4", name: "Tasks" },
];
const PREVIEW_CHAT_TITLES: Array<{ title: string; active: boolean }> = [
  { title: "Speed of light", active: true },
  { title: "Why is the sky blue?", active: false },
  { title: "Photosynthesis basics", active: false },
  { title: "Newton's laws", active: false },
  { title: "Gravity explained", active: false },
];
const PREVIEW_RELATED_LINKS: string[] = [
  "Wave-particle duality",
  "Refraction basics",
  "Photons explained",
];
const PREVIEW_COMPOSER_SUGGESTION = "How does light travel through glass?";
const PREVIEW_COMPOSER_FOLLOWUPS: string[] = [
  "What causes a rainbow?",
  "Is the speed of light constant in all media?",
];
const PREVIEW_USER_MESSAGE: Message = {
  id: "preview-user",
  session_id: "preview",
  role: "user",
  content: "What is the speed of light?",
  created_at: "2026-01-01T00:00:00Z",
};
const PREVIEW_ASSISTANT_MESSAGE: Message = {
  id: "preview-assistant",
  session_id: "preview",
  role: "assistant",
  content: "The speed of light in a vacuum is approximately 299,792,458 meters per second.",
  model_name: "gemma2-9b",
  tokens_used: 120,
  duration_ms: 2500,
  created_at: "2026-01-01T00:00:01Z",
};

const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 22;
const DEFAULT_FONT_SIZE = 16;

const TABS: { id: PreferencesSection; label: string; Icon: React.ElementType }[] = [
  { id: "app", label: "App", Icon: SettingsIcon },
  { id: "navigation", label: "Navigation", Icon: LayoutGrid },
  { id: "appearance", label: "Appearance", Icon: Palette },
  { id: "chat", label: "Chat", Icon: MessageSquare },
  { id: "learning", label: "Learning", Icon: GraduationCap },
  { id: "about-you", label: "About You", Icon: UserCircle },
  { id: "ai", label: "AI", Icon: Bot },
  { id: "scheduled-tasks", label: "Scheduled Tasks", Icon: RefreshCw },
  { id: "webai", label: "Browser Automation", Icon: Globe },
  { id: "security", label: "Security", Icon: ShieldCheck },
  { id: "workspaces", label: "Workspaces", Icon: LayoutGrid },
  { id: "data", label: "Data Controls", Icon: SlidersHorizontal },
  { id: "backup", label: "Backup", Icon: HardDrive },
  { id: "import", label: "Import", Icon: FolderInput },
  { id: "mcp", label: "MCP", Icon: Network },
  { id: "sync", label: "Sync", Icon: GitBranch },
  { id: "memory", label: "Memory", Icon: Brain },
  { id: "logs", label: "Logs", Icon: ScrollText },
];

// Static keyword index per tab. Used to filter the tab navigation by option
// text — only the active tab is mounted, so we can't enumerate options at
// runtime across all tabs. Keep in sync when adding visible options.
const TAB_KEYWORDS: Record<string, string[]> = {
  app: [
    "Startup", "background", "Start at login", "desktop session", "Open in background",
    "Keep running in tray", "Hide native menu", "Single window mode", "Demo Mode",
    "Features", "Memory", "Memory extraction threshold", "Background Jobs",
    "Enable background inference", "Shortcut", "Quick search", "Git Sync",
    "Topic Analysis", "Summarization", "Min messages before summarizing",
    "Sessions per tick", "Workspace Glossary", "Chat definition scan",
    "Sessions per scan tick", "Confirm Move to Trash", "Immediate Delete",
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
  ai: [
    "Local inference providers", "Ollama", "Server URL", "Remote Ollama", "Auto-start Ollama",
    "MLX", "llama.cpp", "Embedding model", "Dual-model execution",
    "Activity Monitor", "VRAM headroom", "Memory headroom", "Detected hardware",
    "Models", "Background model", "Draft model", "Compare models",
  ],
  "scheduled-tasks": [
    "Scheduled Tasks", "Background Tasks", "Background Jobs", "Run mode",
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
  backup: ["Workspace Backup", "Global Backup", "Backup directory", "Schedule"],
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
  return TABS.some((tab) => tab.id === section) ? section as PreferencesSection : null;
}

const IMMEDIATE_SAVE_EXCEPTIONS = new Set<keyof AppSettings>([]);
const SPLIT_LAYOUT_TABS: PreferencesSection[] = [
  "app",
  "navigation",
  "appearance",
  "ai",
  "chat",
  "learning",
  "about-you",
  "webai",
  "security",
  "sync",
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

function Toggle({ on, onToggle, disabled = false }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) {
          onToggle();
        }
      }}
      role="checkbox"
      aria-checked={on}
      aria-disabled={disabled}
      disabled={disabled}
      className={`w-[18px] h-[18px] rounded-[4px] border transition-colors flex items-center justify-center flex-shrink-0 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${
        on
          ? "bg-[var(--accent-color)] border-[var(--accent-color)]"
          : "bg-transparent border-[var(--border-color)] hover:border-[var(--text-muted)]"
      }`}
    >
      {on && (
        <svg viewBox="0 0 16 16" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 8 7 12 13 4" />
        </svg>
      )}
    </button>
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
  ai: AiSettings,
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
    // ai
    preferred_model: ai.preferred_model,
    background_model: ai.background_model,
    summarization_model: ai.summarization_model,
    memory_extraction_model: ai.memory_extraction_model,
    flashcard_model: ai.flashcard_model,
    glossary_model: ai.glossary_model,
    topic_signature_model: ai.topic_signature_model,
    goal_suggestion_model: ai.goal_suggestion_model,
    concept_hierarchy_model: ai.concept_hierarchy_model,
    embedding_model: ai.embedding_model,
    draft_model: ai.draft_model,
    compare_model_a: ai.compare_model_a,
    compare_model_b: ai.compare_model_b,
    ollama_base_url: ai.ollama_base_url,
    ollama_remote_enabled: ai.ollama_remote_enabled,
    auto_start_ollama: ai.auto_start_ollama,
    mlx_base_url: ai.mlx_base_url,
    llamacpp_model_paths: ai.llamacpp_model_paths,
    dual_model_enabled: ai.dual_model_enabled,
    dual_model_execution_mode: ai.dual_model_execution_mode,
    chat_json_storage: ai.chat_json_storage,
    chat_encryption_enabled: ai.chat_encryption_enabled,
    show_gen_info: ai.show_gen_info,
    show_gen_info_token_count: ai.show_gen_info_token_count,
    show_gen_info_duration: ai.show_gen_info_duration,
    show_gen_info_speed: ai.show_gen_info_speed,
    show_gen_info_model: ai.show_gen_info_model,
    background_inference_enabled: ai.background_inference_enabled,
    // advanced
    quick_search_models: advanced.quick_search_models,
    quick_search_shortcut: advanced.quick_search_shortcut,
    quick_search_workspace_scope: advanced.quick_search_workspace_scope,
    quick_search_type_filters: advanced.quick_search_type_filters,
    backup_enabled: advanced.backup_enabled,
    touch_id_enabled: advanced.touch_id_enabled,
    pin_lock_enabled: advanced.pin_lock_enabled,
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
    workspace_glossary_refresh_interval_minutes: advanced.workspace_glossary_refresh_interval_minutes,
    git_sync_interval_minutes: advanced.git_sync_interval_minutes,
    vram_headroom_gb: advanced.vram_headroom_gb,
    vram_headroom_percent: advanced.vram_headroom_percent,
    ram_headroom_gb: advanced.ram_headroom_gb,
    ram_headroom_percent: advanced.ram_headroom_percent,
  };
}

async function fetchSplitSettings(): Promise<AppSettings> {
  const [core, ai, advanced] = await Promise.all([
    api.settings.getCore(),
    api.settings.getAi(),
    api.settings.getAdvanced(),
  ]);
  return mergeSplitSettings(core, ai, advanced);
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

// ── Keyboard shortcut recorder widget ─────────────────────────────────────

/**
 * Parse a Tauri accelerator string (e.g. "Ctrl+Shift+K") into display tokens.
 * Returns an array like ["Ctrl", "Shift", "K"].
 */
function parseAccelerator(raw: string): string[] {
  return raw
    .split("+")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Build a Tauri accelerator string from a live keydown event.
 * Returns null if the key is a lone modifier (no "main" key yet).
 */
function buildAcceleratorFromEvent(e: KeyboardEvent): string | null {
  const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta", "Super"]);
  if (MODIFIERS.has(e.key)) { return null; }

  const parts: string[] = [];
  if (e.ctrlKey)  { parts.push("Ctrl"); }
  if (e.shiftKey) { parts.push("Shift"); }
  if (e.altKey)   { parts.push("Alt"); }
  if (e.metaKey)  { parts.push("Super"); }

  // Normalise the main key
  let key = e.key;
  if (key === " ") { key = "Space"; }
  else if (key.length === 1) { key = key.toUpperCase(); }
  // e.g. "ArrowUp" → keep as-is; "F1" → keep as-is
  parts.push(key);

  return parts.join("+");
}

function ShortcutRecorder({
  value,
  onChange,
  onCommit,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  placeholder: string;
}) {
  const [recording, setRecording] = useState(false);
  const [recordingDraft, setRecordingDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const containerRef = useRef<HTMLButtonElement>(null);

  const tokens = value ? parseAccelerator(value) : [];
  const hasValue = tokens.length > 0;

  function commitAndStop(next: string) {
    setRecording(false);
    setRecordingDraft(null);
    setInvalid(false);
    const trimmed = next.trim();
    onChange(trimmed);
    onCommit(trimmed);
  }

  function startRecording() {
    setRecording(true);
    setRecordingDraft(null);
    setInvalid(false);
    containerRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!recording) { return; }
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      // Escape cancels — restore original value
      setRecording(false);
      setRecordingDraft(null);
      setInvalid(false);
      return;
    }

    const built = buildAcceleratorFromEvent(e.nativeEvent);
    if (built === null) {
      // Only a modifier held so far — show partial
      const parts: string[] = [];
      if (e.ctrlKey)  { parts.push("Ctrl"); }
      if (e.shiftKey) { parts.push("Shift"); }
      if (e.altKey)   { parts.push("Alt"); }
      if (e.metaKey)  { parts.push("Super"); }
      setRecordingDraft(parts.join("+") || null);
      return;
    }

    // We have a complete combo
    if (e.key === "Enter") {
      // Enter commits whatever we currently have
      commitAndStop(value);
      return;
    }

    setInvalid(false);
    commitAndStop(built);
  }

  function handleBlur() {
    if (recording) {
      setRecording(false);
      setRecordingDraft(null);
    }
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange("");
    onCommit("");
    setRecording(false);
    setInvalid(false);
  }

  const displayTokens: string[] = recording && recordingDraft
    ? parseAccelerator(recordingDraft)
    : tokens;

  return (
    <div className="flex items-center gap-2">
      {/* Capture zone */}
      <button
        ref={containerRef}
        type="button"
        tabIndex={0}
        onClick={startRecording}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={[
          "relative flex min-h-[44px] flex-1 items-center gap-1.5 rounded-xl border px-3 py-2 text-left transition-all outline-none",
          recording
            ? "border-[var(--accent-color)] ring-2 ring-[var(--accent-color)]/25 bg-[var(--accent-color)]/5"
            : "border-[var(--border-color)] bg-[var(--bg-elevated)] hover:border-[var(--accent-color)]/60",
        ].join(" ")}
        aria-label={recording ? "Press a key combination" : "Click to record shortcut"}
      >
        {recording && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-[var(--accent-color)] animate-pulse select-none">
            Esc to cancel
          </span>
        )}

        {displayTokens.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1">
            {displayTokens.map((token, i) => (
              <span key={i} className="flex items-center gap-1">
                <kbd className={[
                  "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs font-semibold shadow-sm transition-colors select-none",
                  recording
                    ? "border-[var(--accent-color)]/50 bg-[var(--accent-color)]/10 text-[var(--accent-color)]"
                    : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]",
                ].join(" ")}>
                  {token}
                </kbd>
                {i < displayTokens.length - 1 && (
                  <span className="text-[10px] text-[var(--text-muted)]">+</span>
                )}
              </span>
            ))}
            {invalid && (
              <span className="ml-1 rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                invalid
              </span>
            )}
          </span>
        ) : (
          <span className="text-sm text-[var(--text-muted)]">
            {recording ? "Press a key combination…" : placeholder}
          </span>
        )}
      </button>

      {/* Clear button — only when a shortcut is set and not recording */}
      {hasValue && !recording && (
        <Tooltip content="Clear shortcut" position="top">
          <button
            type="button"
            onClick={handleClear}
            className="shrink-0 rounded-lg border border-[var(--border-color)] p-2.5 text-[var(--text-muted)] transition-colors hover:border-red-400/50 hover:bg-red-400/10 hover:text-red-400"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function ContextSizeInput({ modelName, savedValue, onSave, onClear }: {
  modelName: string;
  savedValue: number | null;
  onSave: (value: number | null) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [draft, setDraft] = React.useState<string>(savedValue !== null ? String(savedValue) : "");

  React.useEffect(() => {
    setDraft(savedValue !== null ? String(savedValue) : "");
  }, [savedValue]);

  async function commit() {
    const raw = draft.trim();
    const parsed = raw === "" ? null : Number.parseInt(raw, 10);
    const next = parsed === null ? null : Number.isFinite(parsed) && parsed > 0 ? Math.max(512, parsed) : null;
    if ((savedValue ?? null) !== next) {
      await onSave(next);
    }
    setDraft(next !== null ? String(next) : "");
  }

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-1.5">
        <Tooltip
          content={
            <div className="flex flex-col gap-1.5 w-48">
              <div className="font-semibold text-xs">Context Window Size</div>
              <div className="text-[11px] flex flex-col gap-0.5">
                {savedValue !== null && (
                  <div>Current: <span className="font-mono text-[var(--accent-color)]">{savedValue}</span> tok</div>
                )}
                <div>Default: <span className="font-mono">8192</span> tok</div>
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-muted)] leading-snug">
                Higher values allow the model to remember more context, but use significantly more memory and slow down generation. Recommended to use powers of 2 (e.g., 4096, 8192, 16384).
              </div>
            </div>
          }
        >
          <input
            type="number"
            min={512}
            step={512}
            value={draft}
            placeholder="8192"
            className="w-[72px] rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-center text-[10px] tabular-nums text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            aria-label={`Context window for ${modelName}`}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
          />
        </Tooltip>
        <span className="text-[9px] text-[var(--text-muted)] shrink-0">tok</span>
        {savedValue !== null && (
          <Tooltip content="Clear override — revert to Ollama's default context size for this model">
            <button
              onClick={async () => { await onClear(); setDraft(""); }}
              className="text-[var(--text-muted)] hover:text-[var(--accent-color)] transition-colors shrink-0"
            >
              <RefreshCw size={10} />
            </button>
          </Tooltip>
        )}
      </div>
      {savedValue !== null && (
        <div className="text-[9px] text-[var(--text-muted)] mt-1">
          default: 8192
        </div>
      )}
    </div>
  );
}

interface AboutYouPreferencesPanelProps {
  initialAboutYou: string | null | undefined;
  injectAboutYouIntoChat: boolean;
  onSaveAboutYou: (val: string) => void;
  onSaveInject: (val: boolean) => void;
}

function AboutYouPreferencesPanel({
  initialAboutYou,
  injectAboutYouIntoChat,
  onSaveAboutYou,
  onSaveInject,
}: AboutYouPreferencesPanelProps) {
  const [profile, setProfile] = useState<AboutYouProfile>(() => {
    return parseAboutYou(initialAboutYou) ?? { ...EMPTY_ABOUT_YOU };
  });

  // Re-sync local profile state when the parent's stored value changes from
  // an external source (cross-window save, blob refetch). Safe to call
  // setState here because initialAboutYou only changes between renders, not
  // every render — so this does not cascade.
  useEffect(() => {
    const parsed = parseAboutYou(initialAboutYou) ?? { ...EMPTY_ABOUT_YOU };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfile(parsed);
  }, [initialAboutYou]);

  const updateField = (key: keyof AboutYouProfile, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const commitField = (key: keyof AboutYouProfile, value: string) => {
    const updatedProfile = { ...profile, [key]: value };
    onSaveAboutYou(serializeAboutYou(updatedProfile));
  };

  const inputCls = "w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-color)]";

  return (
    <div className="space-y-8">
      <section className="space-y-3" data-pref-section>
        <div className="pb-1.5 border-b border-[var(--border-color)]">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] flex items-center gap-1.5">
            <UserCircle size={11} /> About You
          </h3>
          <p className="text-xs text-[var(--text-muted)]/80 mt-1">
            Tell Aetherium about yourself. This context is shared with the AI when generating learning goals, workspace prompts, and chat responses (toggle below) so it can tailor answers to your background.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Display name</span>
            <input
              type="text"
              value={profile.display_name}
              onChange={(e) => updateField("display_name", e.target.value)}
              onBlur={(e) => commitField("display_name", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
              placeholder="e.g. Alex"
              className={inputCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Profession / role</span>
            <input
              type="text"
              value={profile.profession}
              onChange={(e) => updateField("profession", e.target.value)}
              onBlur={(e) => commitField("profession", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
              placeholder="e.g. Backend engineer"
              className={inputCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Education level</span>
            <CompactMenuSelect
              label="Education level"
              value={profile.education_level}
              onChange={(v) => {
                updateField("education_level", v);
                const updatedProfile = { ...profile, education_level: v };
                onSaveAboutYou(serializeAboutYou(updatedProfile));
              }}
              options={[
                { value: "", label: "—" },
                { value: "high-school", label: "High school" },
                { value: "undergraduate", label: "Undergraduate" },
                { value: "graduate", label: "Graduate" },
                { value: "postgraduate", label: "Postgraduate" },
                { value: "self-taught", label: "Self-taught" },
                { value: "other", label: "Other" },
              ]}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Field of study / expertise</span>
            <input
              type="text"
              value={profile.field_of_study}
              onChange={(e) => updateField("field_of_study", e.target.value)}
              onBlur={(e) => commitField("field_of_study", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
              placeholder="e.g. Distributed systems"
              className={inputCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Preferred language</span>
            <input
              type="text"
              value={profile.preferred_language}
              onChange={(e) => updateField("preferred_language", e.target.value)}
              onBlur={(e) => commitField("preferred_language", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
              placeholder="e.g. English"
              className={inputCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Default learning approach</span>
            <CompactMenuSelect
              label="Default learning approach"
              value={profile.default_approach}
              onChange={(v) => {
                updateField("default_approach", v);
                const updatedProfile = { ...profile, default_approach: v };
                onSaveAboutYou(serializeAboutYou(updatedProfile));
              }}
              options={[
                { value: "", label: "—" },
                { value: "theory-first", label: "Theory first" },
                { value: "hands-on", label: "Hands-on / examples" },
                { value: "balanced", label: "Balanced" },
              ]}
            />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Interests</span>
          <textarea
            value={profile.interests}
            onChange={(e) => updateField("interests", e.target.value)}
            onBlur={(e) => commitField("interests", e.target.value)}
            placeholder="Topics you like to learn about"
            rows={2}
            className={inputCls}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Bio</span>
          <textarea
            value={profile.bio}
            onChange={(e) => updateField("bio", e.target.value)}
            onBlur={(e) => commitField("bio", e.target.value)}
            placeholder="Anything else the AI should know about you"
            rows={4}
            className={inputCls}
          />
        </label>
      </section>

      <section className="space-y-3" data-pref-section>
        <div className="pb-1.5 border-b border-[var(--border-color)]">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Chat prompt</h3>
        </div>
        <div className="flex items-center justify-between gap-3 py-0.5">
          <div>
            <p className="text-sm text-[var(--text-secondary)]">Inject About You into chat system prompt</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              When on, your profile is prepended to the chat system prompt so the assistant can adapt its answers. Goal and workspace prompt generation always use it.
            </p>
          </div>
          <Toggle
            on={injectAboutYouIntoChat}
            onToggle={() => onSaveInject(!injectAboutYouIntoChat)}
          />
        </div>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

function LiveAppPreview({ dbSettings, overrides = {} }: {
  dbSettings: AppSettings;
  overrides?: {
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
}) {
  const dbWorkspaceNavigation = useWorkspaceStore((s) => s.workspaceNavigation);
  const dbSectionNavigation = useWorkspaceStore((s) => s.sectionNavigation);
  const dbSubWorkspaceNavigation = useWorkspaceStore((s) => s.subWorkspaceNavigation);
  const combineWorkspaceDropdown = useWorkspaceStore((s) => s.combineWorkspaceDropdown);
  const combineSubWorkspaceDropdown = useWorkspaceStore((s) => s.combineSubWorkspaceDropdown);
  const combineSectionDropdown = useWorkspaceStore((s) => s.combineSectionDropdown);
  const dbWorkspaceSortOrder = useWorkspaceStore((s) => s.workspaceSortOrder);
  const dbChatMessageStyle = useSettingsStore((s) => s.chatMessageStyle);
  const dbComposerMode = useSettingsStore((s) => s.composerMode);

  const workspaceNavigation = overrides.workspaceNavigation !== undefined && overrides.workspaceNavigation !== null ? overrides.workspaceNavigation : dbWorkspaceNavigation;
  const sectionNavigation = overrides.sectionNavigation !== undefined && overrides.sectionNavigation !== null ? overrides.sectionNavigation : dbSectionNavigation;
  const subWorkspaceNavigation = overrides.subWorkspaceNavigation !== undefined && overrides.subWorkspaceNavigation !== null ? overrides.subWorkspaceNavigation : dbSubWorkspaceNavigation;
  const workspaceSortOrder = overrides.workspaceSortOrder !== undefined && overrides.workspaceSortOrder !== null ? overrides.workspaceSortOrder : dbWorkspaceSortOrder;
  const showGenInfo = useSettingsStore((s) => s.showGenInfo);
  const showGenInfoTokenCount = useSettingsStore((s) => s.showGenInfoTokenCount);
  const showGenInfoDuration = useSettingsStore((s) => s.showGenInfoDuration);
  const showGenInfoSpeed = useSettingsStore((s) => s.showGenInfoSpeed);
  const showGenInfoModel = useSettingsStore((s) => s.showGenInfoModel);
  const showStatusBar = useSettingsStore((s) => s.showStatusBar);
  const showComposerWorkspaceSuggestions = useSettingsStore((s) => s.showComposerWorkspaceSuggestions);
  const showComposerChatFollowUps = useSettingsStore((s) => s.showComposerChatFollowUps);
  const chatMessageStyle = overrides.chatMessageStyle !== undefined && overrides.chatMessageStyle !== null ? overrides.chatMessageStyle : dbChatMessageStyle;
  const composerMode = overrides.composerMode !== undefined && overrides.composerMode !== null ? overrides.composerMode : dbComposerMode;
  const [singleWindowMode] = usePrefsWindowMode();

  const showLeftSidebar = workspaceNavigation === "sidebar";
  const themeClass = `theme-${overrides.theme !== undefined && overrides.theme !== null ? overrides.theme : dbSettings.theme || "system"}`;
  const accentColor = overrides.accentColor !== undefined && overrides.accentColor !== null ? overrides.accentColor : dbSettings.accent_color || "#007AFF";
  const fontSize = overrides.fontSize !== undefined && overrides.fontSize !== null ? overrides.fontSize : dbSettings.font_size || 14;
  const scaledFontSize = Math.max(9, Math.min(20, Math.round(fontSize * 0.9)));

  const activeWorkspaceChildren = PREVIEW_CHILD_WORKSPACES;

  // Combine-into-titlebar crumbs (preview is single-pane). A dropdown axis joins
  // the titlebar line when its combine switch is on; otherwise it keeps its row.
  const subCombinedCrumb = subWorkspaceNavigation === "top-dropdown" && combineSubWorkspaceDropdown && activeWorkspaceChildren.length > 0;
  const sectionCombinedCrumb = sectionNavigation === "top-dropdown" && combineSectionDropdown;
  // combineWorkspaceDropdown only affects grouping; the workspace dropdown is
  // already shown in the titlebar, so it reads as the leading crumb either way.
  void combineWorkspaceDropdown;

  const parentWorkspaces = useMemo(() => {
    const list = PREVIEW_PARENT_WORKSPACES.map((w) => ({ ...w }));

    if (workspaceSortOrder === "name-asc") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (workspaceSortOrder === "name-desc") {
      list.sort((a, b) => b.name.localeCompare(a.name));
    } else if (workspaceSortOrder === "created-newest") {
      list.sort((a, b) => b.index - a.index);
    } else if (workspaceSortOrder === "created-oldest") {
      list.sort((a, b) => a.index - b.index);
    } else if (workspaceSortOrder === "updated-newest" || workspaceSortOrder === "last-message-newest") {
      list.sort((a, b) => a.index - b.index);
    } else if (workspaceSortOrder === "updated-oldest") {
      list.sort((a, b) => b.index - a.index);
    }

    return list.map((w) => ({ id: w.id, name: w.name }));
  }, [workspaceSortOrder]);

  const activeWorkspaceName = parentWorkspaces[0]?.name || "General";

  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3 flex items-center gap-1.5 self-start">
        <span>Live App Preview</span>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
      </div>

      {/* Simulated Desktop Container */}
      <div className="w-full flex flex-col items-center justify-center bg-[var(--bg-secondary)]/35 rounded-2xl p-4 border border-[var(--border-color)]/60 shadow-inner">
        {/* Mock macOS Menubar */}
        <div className="w-full h-6 bg-[var(--bg-sidebar)]/80 text-[var(--text-muted)] text-[0.7em] px-3 rounded-t-xl flex justify-between items-center select-none border-t border-x border-[var(--border-color)]">
          <div className="flex gap-2.5 items-center">
            <span className="font-semibold text-[var(--text-primary)]"></span>
            <span className="font-medium text-[var(--text-secondary)]">Aetherium</span>
            {!dbSettings.hide_native_menu && (
              <div className="flex gap-2.5 opacity-60">
                <span>File</span>
                <span>Edit</span>
                <span>View</span>
                <span>Workspace</span>
              </div>
            )}
          </div>
          <div className="flex gap-2.5 items-center">
            <span>Jobs: {dbSettings.background_inference_enabled ? "Active" : "Disabled"}</span>
            <span>100%</span>
            <div className="flex items-center">
              {dbSettings.menubar_icon_style === "white" ? (
                <span className="w-3.5 h-3.5 rounded bg-white flex items-center justify-center text-black font-extrabold text-[8px]">A</span>
              ) : dbSettings.menubar_icon_style === "black" ? (
                <span className="w-3.5 h-3.5 rounded bg-black text-white flex items-center justify-center font-extrabold text-[8px] border border-white/20">A</span>
              ) : (
                /* monochrome (adapts to text color) */
                <span className="w-3.5 h-3.5 rounded bg-[var(--text-secondary)]/20 text-[var(--text-secondary)] flex items-center justify-center font-extrabold text-[8px]">A</span>
              )}
            </div>
          </div>
        </div>

        {/* Mock App Window */}
        <div
          className={`${themeClass} relative flex flex-col w-full aspect-[16/10.5] rounded-b-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-2xl overflow-hidden select-none`}
          style={{
            "--accent-color": accentColor,
            "--accent-color-rgb": hexToRgb(accentColor),
            fontSize: `${scaledFontSize}px`,
          } as React.CSSProperties}
        >
          {/* Simulated Window Titlebar */}
          <div className="h-10 flex items-center justify-between px-3 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] shrink-0 select-none relative">
            {isMac ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F56] opacity-80" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E] opacity-80" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#27C93F] opacity-80" />
              </div>
            ) : (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="w-3.5 h-3.5 rounded bg-[var(--accent-color)] text-white flex items-center justify-center font-extrabold text-[0.55em]">A</span>
              </div>
            )}

            <div className="flex items-center gap-2 max-w-[60%] truncate h-full">
              <div className="flex items-center gap-1 opacity-70">
                <ChevronLeft size={12} className="text-[var(--text-secondary)]" />
                <ChevronRight size={12} className="text-[var(--text-muted)]" />
              </div>

              {workspaceNavigation === "top-dropdown" ? (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[0.65em] text-[var(--text-primary)] font-medium">
                  <span>{activeWorkspaceName}</span>
                  <ChevronDown size={8} className="text-[var(--text-muted)]" />
                </div>
              ) : workspaceNavigation === "top-tabs" ? (
                <div className="flex gap-1 items-end relative -bottom-[1px] h-full" data-no-drag>
                  {parentWorkspaces.map((ws, index) => (
                    <div
                      key={ws.id}
                      className={`text-[0.65em] px-2 py-0.5 rounded-t-md border border-b-0 border-[var(--border-color)] select-none whitespace-nowrap cursor-pointer transition-all ${
                        index === 0
                          ? "font-semibold text-[var(--accent-color)] bg-[var(--bg-primary)] border-t-2 border-t-[var(--accent-color)] shadow-sm"
                          : "text-[var(--text-muted)] bg-[var(--bg-sidebar)]/50 hover:bg-[var(--bg-hover)]/40"
                      }`}
                      style={index === 0 ? { borderTopColor: "var(--accent-color)" } : {}}
                    >
                      {ws.name}
                    </div>
                  ))}
                  <button className="h-5 w-5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded flex items-center justify-center mb-0.5">
                    <Plus size={10} />
                  </button>
                </div>
              ) : (
                <span className="text-[0.7em] font-semibold text-[var(--text-primary)] truncate">{activeWorkspaceName}</span>
              )}

              {subCombinedCrumb && (
                <>
                  {workspaceNavigation === "top-dropdown" && <span className="text-[0.6em] text-[var(--text-muted)] opacity-60">/</span>}
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[0.65em] text-[var(--text-primary)] font-medium">
                    <span>{activeWorkspaceChildren[0]?.name ?? "Overview"}</span>
                    <ChevronDown size={8} className="text-[var(--text-muted)]" />
                  </div>
                </>
              )}

              {sectionCombinedCrumb && (
                <>
                  {(workspaceNavigation === "top-dropdown" || subCombinedCrumb) && <span className="text-[0.6em] text-[var(--text-muted)] opacity-60">/</span>}
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[0.65em] text-[var(--text-secondary)] font-medium">
                    <span>Chat</span>
                    <ChevronDown size={8} className="text-[var(--text-muted)]" />
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {singleWindowMode && (
                <Tooltip content="Single Window Mode Active" position="bottom">
                  <div className="text-[var(--accent-color)] flex items-center shrink-0">
                    <Pin size={10} className="rotate-45" />
                  </div>
                </Tooltip>
              )}
              <div className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-secondary)]">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
              </div>
              <div className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)]">
                <Columns2 size={10} />
              </div>
              {!isMac && (
                <div className="flex items-center gap-2 ml-1 text-[var(--text-secondary)] select-none">
                  <span className="w-3 h-3 flex items-center justify-center hover:bg-[var(--bg-hover)] cursor-pointer text-[0.7em]">—</span>
                  <span className="w-3 h-3 flex items-center justify-center hover:bg-[var(--bg-hover)] cursor-pointer text-[0.7em]">☐</span>
                  <span className="w-3 h-3 flex items-center justify-center hover:bg-red-500 hover:text-white cursor-pointer text-[0.7em]">✕</span>
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Sub-workspace tabs for the active parent workspace (child workspaces) */}
          {subWorkspaceNavigation === "top-tabs" && activeWorkspaceChildren.length > 0 && (
            <div className="h-7 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/90 px-3 flex items-center justify-between shrink-0 select-none">
              <div className="flex items-center gap-1.5 h-full">
                {/* Pinned overview indicator */}
                <div className="flex h-[22px] w-5 items-center justify-center self-end rounded-t border border-b-0 border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer">
                  <svg width="4" height="4" viewBox="0 0 6 6" className="fill-current opacity-80 shrink-0"><circle cx="3" cy="3" r="3" /></svg>
                </div>
                {activeWorkspaceChildren.map((child, index) => {
                  const isActive = index === 0;
                  return (
                    <div
                      key={child.id}
                      className={`relative flex h-[22px] items-center self-end rounded-t border border-b-0 px-2 text-[0.6em] font-medium whitespace-nowrap cursor-pointer transition-all select-none ${
                        isActive
                          ? "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-semibold"
                          : "border-transparent text-[var(--text-secondary)] opacity-60 hover:opacity-100 hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute inset-x-1.5 top-0 h-0.5 rounded-full bg-[var(--accent-color)]" />
                      )}
                      {child.name}
                    </div>
                  );
                })}
                <button className="h-4 w-4 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] rounded flex items-center justify-center mb-0.5">
                  <Plus size={8} />
                </button>
              </div>
            </div>
          )}

          {/* Row 2 (dropdown variant): compact sub-workspace picker */}
          {subWorkspaceNavigation === "top-dropdown" && !combineSubWorkspaceDropdown && activeWorkspaceChildren.length > 0 && (
            <div className="h-7 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/90 px-3 flex items-center gap-2 shrink-0 select-none">
              <span className="text-[0.5em] font-bold uppercase tracking-wider text-[var(--text-muted)]">Sub</span>
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[0.6em] text-[var(--text-primary)] font-medium">
                <span>{activeWorkspaceChildren[0]?.name ?? "Overview"}</span>
                <ChevronDown size={8} className="text-[var(--text-muted)]" />
              </div>
              <button className="h-4 w-4 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] rounded flex items-center justify-center">
                <Plus size={8} />
              </button>
            </div>
          )}

          {!showLeftSidebar && sectionNavigation === "top-tabs" && (
            <div className="h-8 flex items-center gap-2 px-3 bg-[var(--bg-sidebar)] border-b border-[var(--border-color)] shrink-0">
              <span className="text-[0.65em] font-semibold text-[var(--accent-color)] border-b border-[var(--accent-color)] px-1 py-0.5">Chat</span>
              <span className="text-[0.65em] font-semibold text-[var(--text-muted)] px-1 py-0.5">Notes</span>
              <span className="text-[0.65em] font-semibold text-[var(--text-muted)] px-1 py-0.5">Knowledge</span>
            </div>
          )}

          {/* Section dropdown on its own row (when not combined into the titlebar) */}
          {sectionNavigation === "top-dropdown" && !combineSectionDropdown && (
            <div className="h-7 flex items-center gap-2 px-3 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] shrink-0 select-none">
              <span className="text-[0.5em] font-bold uppercase tracking-wider text-[var(--text-muted)]">Section</span>
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[0.6em] text-[var(--text-secondary)] font-medium">
                <span>Chat</span>
                <ChevronDown size={8} className="text-[var(--text-muted)]" />
              </div>
            </div>
          )}

          <div className="flex flex-1 min-h-0 overflow-hidden">
            {workspaceNavigation === "sidebar" && (
              <div className="w-[85px] shrink-0 bg-[var(--bg-sidebar)] border-r border-[var(--border-color)] p-1 flex flex-col gap-0.5" data-testid="single-pane-workspace-sidebar">
                <div className="text-[0.55em] uppercase tracking-wider text-[var(--text-muted)] font-bold px-1.5 py-0.5 opacity-60 mb-0.5">Workspaces</div>
                {parentWorkspaces.map((ws, index) => (
                  <div
                    key={ws.id}
                    className={`px-1.5 py-0.5 rounded text-[0.6em] truncate leading-tight select-none ${
                      index === 0
                        ? "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)] font-semibold border-l-2 border-[var(--accent-color)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/40"
                    }`}
                  >
                    {ws.name}
                  </div>
                ))}
              </div>
            )}

            {subWorkspaceNavigation === "sidebar" && activeWorkspaceChildren.length > 0 && (
              <div className="w-[85px] shrink-0 bg-[var(--bg-sidebar)] border-r border-[var(--border-color)] p-1 flex flex-col gap-0.5" data-testid="single-pane-subworkspace-sidebar">
                <div className="text-[0.55em] uppercase tracking-wider text-[var(--text-muted)] font-bold px-1.5 py-0.5 opacity-60 mb-0.5">Sub-spaces</div>
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.6em] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/40 truncate leading-tight select-none">
                  <svg width="4" height="4" viewBox="0 0 6 6" className="fill-current opacity-80 shrink-0"><circle cx="3" cy="3" r="3" /></svg>
                  <span className="truncate">Overview</span>
                </div>
                {activeWorkspaceChildren.map((child, index) => (
                  <div
                    key={child.id}
                    className={`px-1.5 py-0.5 rounded text-[0.6em] truncate leading-tight select-none ${
                      index === 0
                        ? "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)] font-semibold border-l-2 border-[var(--accent-color)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/40"
                    }`}
                  >
                    {child.name}
                  </div>
                ))}
              </div>
            )}

            {sectionNavigation === "sidebar" && (
              <div className="w-14 shrink-0 bg-[var(--bg-sidebar)] border-r border-[var(--border-color)] py-1.5 flex flex-col justify-between items-center select-none" data-testid="sidebar">
                <div className="flex flex-col gap-0.5 px-1 w-full">
                  {[
                    { label: "Dashboard", icon: BarChart2, active: false },
                    { label: "Chat", icon: MessageSquare, active: true },
                    { label: "Notes", icon: FileEdit, active: false },
                    { label: "Sources", icon: Library, active: false },
                    { label: "Learning", icon: GraduationCap, active: false },
                    { label: "History", icon: History, active: false },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.label}
                        className={`flex flex-col items-center justify-center w-full py-1 rounded-lg text-[0.55em] transition-colors select-none ${
                          item.active
                            ? "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)] font-semibold"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/50"
                        }`}
                      >
                        <Icon size={12} strokeWidth={1.5} className="mb-0.5" />
                        <span className="scale-[0.9] origin-center truncate w-full text-center">{item.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-col items-center gap-1 w-full px-1 pt-1.5 border-t border-[var(--border-color)]/60">
                  <div className="text-[var(--text-secondary)] text-[0.5em] flex items-center justify-center gap-0.5 hover:bg-[var(--bg-hover)] w-full py-0.5 rounded cursor-pointer scale-[0.85]">
                    <ChevronLeft size={8} />
                    <span>Collapse</span>
                  </div>
                  <div className="w-5 h-5 rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-primary)] cursor-pointer">
                    <SettingsIcon size={10} strokeWidth={1.5} />
                  </div>
                  <div className="w-6 h-6 rounded-lg bg-[var(--accent-color)] text-white text-[0.65em] font-bold flex items-center justify-center shadow-sm select-none cursor-pointer mt-0.5">
                    A
                  </div>
                </div>
              </div>
            )}

            {/* Chat Session List Pane (Sub-sidebar) */}
            <div className="w-[105px] shrink-0 bg-[var(--bg-sidebar)]/40 border-r border-[var(--border-color)] p-1.5 flex flex-col gap-1.5 select-none" data-testid="chat-sessions-list">
              <div className="flex items-center justify-between px-1">
                <span className="text-[0.6em] font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Chats</span>
                <div className="flex gap-0.5 text-[0.6em] text-[var(--text-muted)]">
                  <ArrowUpDown size={8} />
                  <Pencil size={8} />
                </div>
              </div>
              <div className="flex items-center gap-1 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]/60 px-1 py-0.5 text-[0.6em] text-[var(--text-muted)]">
                <Search size={8} className="shrink-0" />
                <span className="truncate">Search...</span>
              </div>
              <div className="flex flex-col gap-0.5 overflow-y-auto max-h-[220px]">
                {PREVIEW_CHAT_TITLES.map((s, idx) => (
                  <div
                    key={idx}
                    className={`px-1.5 py-1 rounded text-[0.6em] truncate leading-tight select-none cursor-pointer ${
                      s.active
                        ? "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)] font-semibold border-l-2 border-[var(--accent-color)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/30"
                    }`}
                  >
                    {s.title}
                  </div>
                ))}
              </div>
              <div className="text-[0.55em] text-[var(--text-muted)] mt-auto pt-1 border-t border-[var(--border-color)]/40">
                5 sessions
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-primary)] overflow-hidden">
              {/* Chat View Pane Header */}
              <div className="h-8.5 px-3 border-b border-[var(--border-color)]/60 bg-[var(--bg-primary)] flex items-center justify-between shrink-0 select-none">
                <div className="flex flex-col min-w-0">
                  <span className="text-[0.5em] font-bold text-[var(--text-muted)] uppercase tracking-wider leading-none mb-0.5">{activeWorkspaceName.toUpperCase()}</span>
                  <span className="text-[0.7em] font-semibold text-[var(--text-primary)] truncate">{PREVIEW_CHAT_TITLES[0].title}</span>
                </div>
                <div className="flex items-center gap-1 text-[0.65em] text-[var(--text-secondary)] font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span>7b | 8.2s</span>
                </div>
              </div>

              {/* Related link pills list below header */}
              <div className="h-6.5 px-3 bg-[var(--bg-elevated)]/25 border-b border-[var(--border-color)]/30 flex items-center gap-2 shrink-0 overflow-x-hidden text-[0.55em] select-none">
                <span className="font-bold text-[var(--text-muted)] text-[0.5em] uppercase tracking-wider shrink-0">RELATED</span>
                {PREVIEW_RELATED_LINKS.map((lnk) => (
                  <span key={lnk} className="px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-color)]/40 text-[var(--text-secondary)] hover:text-[var(--accent-color)] cursor-pointer whitespace-nowrap">
                    {lnk}
                  </span>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3 flex flex-col min-h-0 justify-end relative">
                <div className="text-[0.8em]">
                  <ChatMessageBubble
                    msg={PREVIEW_USER_MESSAGE}
                    isLastMessage={false}
                    isStreaming={false}
                    chatMessageStyle={chatMessageStyle}
                    expandChatToWindowWidth={false}
                    showGenInfo={false}
                    isEditing={false}
                    editValue=""
                    isCopied={false}
                    isThoughtExpanded={false}
                    sources={undefined}
                    isSourcesExpanded={false}
                    contextSources={null}
                    markdownComponents={PREVIEW_MARKDOWN_COMPONENTS}
                    onCopy={NOOP}
                    onStartEdit={NOOP}
                    onSubmitEdit={NOOP}
                    onSetEditContent={NOOP}
                    onCancelEdit={NOOP}
                    onToggleThought={NOOP}
                    onToggleSources={NOOP}
                  />
                  <ChatMessageBubble
                    msg={PREVIEW_ASSISTANT_MESSAGE}
                    isLastMessage={true}
                    isStreaming={false}
                    chatMessageStyle={chatMessageStyle}
                    expandChatToWindowWidth={false}
                    showGenInfo={showGenInfo}
                    showGenInfoModel={showGenInfoModel}
                    showGenInfoTokenCount={showGenInfoTokenCount}
                    showGenInfoDuration={showGenInfoDuration}
                    showGenInfoSpeed={showGenInfoSpeed}
                    isEditing={false}
                    editValue=""
                    isCopied={false}
                    isThoughtExpanded={false}
                    sources={undefined}
                    isSourcesExpanded={false}
                    contextSources={null}
                    markdownComponents={PREVIEW_MARKDOWN_COMPONENTS}
                    onCopy={NOOP}
                    onStartEdit={NOOP}
                    onSubmitEdit={NOOP}
                    onSetEditContent={NOOP}
                    onCancelEdit={NOOP}
                    onToggleThought={NOOP}
                    onToggleSources={NOOP}
                  />
                </div>
              </div>

              <div className="p-2 border-t border-[var(--border-color)] bg-[var(--bg-primary)] shrink-0 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-1 overflow-x-hidden">
                  <div className="flex gap-1 overflow-x-hidden relative items-center py-0.5 select-none">
                    {showComposerWorkspaceSuggestions && (
                      <span className="text-[0.55em] px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] whitespace-nowrap truncate max-w-[120px]">
                        {PREVIEW_COMPOSER_SUGGESTION}
                      </span>
                    )}
                    {showComposerChatFollowUps && (
                      <>
                        <span className="text-[0.55em] px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] whitespace-nowrap truncate max-w-[120px]">
                          {PREVIEW_COMPOSER_FOLLOWUPS[0]}
                        </span>
                        <span className="text-[0.55em] px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] whitespace-nowrap flex items-center gap-0.5 truncate max-w-[120px]">
                          {PREVIEW_COMPOSER_FOLLOWUPS[1]} <ChevronDown size={8} />
                        </span>
                      </>
                    )}
                  </div>

                  {dbSettings.memory_enabled && (
                    <div className="flex items-center gap-0.5 text-[0.55em] font-medium text-[var(--accent-color)] shrink-0 bg-[var(--accent-color)]/10 px-1 rounded">
                      <Brain size={8} />
                      <span>Memory</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1">
                  <div className="flex items-center gap-1 text-[var(--text-muted)] px-1 scale-90">
                    <Paperclip size={10} className="hover:text-[var(--text-secondary)] cursor-pointer" />
                    <Search size={10} className="hover:text-[var(--text-secondary)] cursor-pointer" />
                    <Pencil size={10} className="hover:text-[var(--text-secondary)] cursor-pointer" />
                  </div>
                  <div className="flex-1 text-[0.7em] text-[var(--text-muted)] font-normal truncate">
                    Continue this thread...
                  </div>
                  {composerMode === "family" ? (
                    <div className="flex gap-1 items-center shrink-0 pr-1">
                      <span className="text-[0.55em] text-[var(--text-muted)]">Family</span>
                      <button
                        type="button"
                        className="h-4.5 px-1.5 rounded bg-[var(--accent-color)] text-white flex items-center justify-center shadow-sm text-[0.55em] font-bold"
                      >
                        7b
                      </button>
                      <button
                        type="button"
                        className="h-4.5 px-1.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)] flex items-center justify-center shadow-sm text-[0.55em] font-bold"
                      >
                        14b
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="w-5 h-5 rounded bg-[var(--accent-color)] text-white flex items-center justify-center shadow-sm shrink-0"
                    >
                      <Send size={8} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {showStatusBar && (
            <div className="h-5 px-2 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between text-[0.55em] text-[var(--text-muted)] shrink-0 select-none">
              <div className="flex items-center gap-1">
                <span>CPU: 20%</span>
                <span>•</span>
                <span>RAM: 22.0 GB / 31.3 GB</span>
              </div>
              <div className="flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${dbSettings.background_inference_enabled ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
                <span>Jobs: {dbSettings.background_inference_enabled ? "Running Summaries" : "Idle (Paused)"}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const MemoizedLiveAppPreview = React.memo(LiveAppPreview);

function hexToRgb(hex: string): string {
  const cleanHex = (hex || "").replace("#", "");
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex.substring(0, 1).repeat(2), 16);
    const g = parseInt(cleanHex.substring(1, 2).repeat(2), 16);
    const b = parseInt(cleanHex.substring(2, 3).repeat(2), 16);
    return `${r}, ${g}, ${b}`;
  } else if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return `${r}, ${g}, ${b}`;
  }
  return "0, 122, 255";
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

const DEFAULT_DATA_RESET_OPTIONS: KnowledgeResetOptions = {
  clear_graph: true,
  clear_topic_signatures: true,
  clear_prompt_bank: true,
  clear_analysis_jobs: true,
  clear_legacy_topics: true,
  delete_generated_cards: true,
};

function totalKnowledgeResetRows(result: KnowledgeResetResult | null): number {
  if (!result) {
    return 0;
  }
  return result.concept_nodes
    + result.concept_links
    + result.concept_mentions
    + result.graph_statistics
    + result.analyze_jobs
    + result.analyze_job_chunks
    + result.change_proposals
    + result.flashcard_topics
    + result.generated_cards_deleted
    + result.generated_cards_detached
    + result.learning_goals_detached
    + result.topic_signatures_cleared
    + result.prompt_bank_prompts
    + result.prompt_bank_jobs;
}

function formatKnowledgeResetResult(result: KnowledgeResetResult): string {
  const rows = totalKnowledgeResetRows(result);
  return `${rows} AI-inferred row${rows === 1 ? "" : "s"} reset across ${result.workspace_count} workspace${result.workspace_count === 1 ? "" : "s"}. Source material was preserved.`;
}

function KnowledgeResetCountGrid({ result }: { result: KnowledgeResetResult }) {
  const items = [
    ["Workspaces", result.workspace_count],
    ["Concepts", result.concept_nodes],
    ["Links", result.concept_links],
    ["Mentions", result.concept_mentions],
    ["Analysis jobs", result.analyze_jobs + result.analyze_job_chunks],
    ["Proposals", result.change_proposals],
    ["Legacy topics", result.flashcard_topics],
    ["Cards deleted", result.generated_cards_deleted],
    ["Cards detached", result.generated_cards_detached],
    ["Goals detached", result.learning_goals_detached],
    ["Topic signatures", result.topic_signatures_cleared],
    ["Prompt bank", result.prompt_bank_prompts + result.prompt_bank_jobs],
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
          <div className="text-sm font-semibold text-[var(--text-primary)]">{value}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
        </div>
      ))}
    </div>
  );
}

function DataControlsPreferences() {
  const [options, setOptions] = useState<KnowledgeResetOptions>({ ...DEFAULT_DATA_RESET_OPTIONS });
  const [preview, setPreview] = useState<KnowledgeResetResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [successDialog, setSuccessDialog] = useState<{ title: string; description: string } | null>(null);

  const optionGroups: Array<{
    title: string;
    rows: Array<{ key: keyof KnowledgeResetOptions; label: string; description: string }>;
  }> = [
    {
      title: "Knowledge",
      rows: [
        { key: "clear_graph", label: "Graph and roadmap", description: "Concepts, links, mentions, graph statistics, and concept proposals." },
        { key: "clear_topic_signatures", label: "Topic signatures", description: "Workspace topic fingerprints that can re-seed old concepts." },
        { key: "clear_analysis_jobs", label: "Analysis jobs", description: "Analyze Workspace job and chunk history." },
      ],
    },
    {
      title: "Chat",
      rows: [
        { key: "clear_prompt_bank", label: "Prompt bank", description: "Stored starter prompts and prompt-bank jobs." },
      ],
    },
    {
      title: "Learning",
      rows: [
        { key: "clear_legacy_topics", label: "Legacy topics", description: "Flashcard topic rows from older topic systems." },
        { key: "delete_generated_cards", label: "Generated concept/topic cards", description: "If disabled, cards are kept but stale concept/topic links are detached." },
      ],
    },
  ];

  async function loadPreview(nextOptions: KnowledgeResetOptions) {
    setLoadingPreview(true);
    setError(null);
    try {
      const result = await api.graph.resetKnowledgeState({
        scope: "all_workspaces",
        options: nextOptions,
        dryRun: true,
      });
      setPreview(result);
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function openResetDialog() {
    setDialogOpen(true);
    setSuccess(null);
    await loadPreview(options);
  }

  async function updateOption(key: keyof KnowledgeResetOptions, value: boolean) {
    const next = { ...options, [key]: value };
    setOptions(next);
    if (dialogOpen) {
      await loadPreview(next);
    }
  }

  async function confirmReset() {
    setRunning(true);
    setError(null);
    try {
      const result = await api.graph.resetKnowledgeState({
        scope: "all_workspaces",
        options,
        dryRun: false,
      });
      setPreview(result);
      setDialogOpen(false);
      setSuccess(formatKnowledgeResetResult(result));
      setSuccessDialog({
        title: "AI-Inferred Data Reset Complete",
        description: formatKnowledgeResetResult(result),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const busy = loadingPreview || running;
  const totalRows = totalKnowledgeResetRows(preview);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain px-5 py-4">
      <div className="max-w-3xl space-y-6">
        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">Data Controls</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
              Global maintenance actions that can affect every workspace. Source chats, notes, files, and workspace records are preserved.
            </p>
          </div>

          {success && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {success}
            </div>
          )}

          <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-[var(--text-primary)]">Reset AI-Inferred Workspace Data</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                  Clear generated graph, topic, prompt-bank, and analysis state across all workspaces after major concept iteration.
                </p>
              </div>
              <button
                type="button"
                onClick={openResetDialog}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                <RotateCcw size={15} />
                Reset AI-Inferred Workspace Data
              </button>
            </div>
          </div>
        </section>
      </div>

      {dialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm"
          onClick={() => {
            if (!busy) {
              setDialogOpen(false);
            }
          }}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-red-500/25 bg-[var(--bg-elevated)] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-[var(--border-color)] px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/12 text-red-400">
                  <RotateCcw size={18} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">Reset AI-Inferred Workspace Data</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                    Clear selected AI-inferred data for every workspace. This is for global cleanup, not a single workspace repair.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs leading-5 text-red-200">
                This cannot be undone. Source material is preserved, but selected AI-inferred data will be cleared.
              </div>

              {loadingPreview ? (
                <div className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                  <Loader2 size={14} className="animate-spin" />
                  Calculating affected data...
                </div>
              ) : preview ? (
                <KnowledgeResetCountGrid result={preview} />
              ) : null}

              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Advanced options</div>
                <div className="space-y-4">
                  {optionGroups.map((group) => (
                    <div key={group.title} className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{group.title}</div>
                      <div className="space-y-2">
                        {group.rows.map((option) => {
                          const checked = options[option.key] ?? true;
                          return (
                            <label
                              key={option.key}
                              className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={busy}
                                onChange={(event) => { void updateOption(option.key, event.target.checked); }}
                                className="mt-1 h-4 w-4 accent-[var(--accent-color)]"
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-[var(--text-primary)]">{option.label}</span>
                                <span className="block text-xs leading-5 text-[var(--text-muted)]">{option.description}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {options.delete_generated_cards === false && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-200">
                  Generated cards will be kept as manual cards, but their concept and legacy topic links will be removed.
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs leading-5 text-red-200">
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[var(--border-color)] px-5 py-4">
              <div className="text-xs text-[var(--text-muted)]">
                {preview && !loadingPreview ? `${totalRows} affected derived row${totalRows === 1 ? "" : "s"}` : ""}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  disabled={busy}
                  className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmReset}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {running && <Loader2 size={14} className="animate-spin" />}
                  Reset AI-Inferred Data
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {successDialog && (
        <SuccessDialog
          title={successDialog.title}
          description={successDialog.description}
          onConfirm={() => setSuccessDialog(null)}
        />
      )}
    </div>
  );
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
          <MemoizedLiveAppPreview dbSettings={dbSettings} overrides={hoverOverrides} />
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
          <MemoizedLiveAppPreview dbSettings={dbSettings} overrides={hoverOverrides} />
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

/**
 * Job catalog. `job_key` is the scheduler's task_type (used for run-mode /
 * heavy-model settings, status-bar events, cancel/confirm). `model_setting`
 * is the AppSettings key that holds the small (default) model — already wired
 * through Rust's `get_model_for_job`. `tokens`/`note` are sizing hints.
 */
const SCHEDULED_JOBS_CATALOG: {
  job_key: string;
  model_setting: keyof AppSettings;
  label: string;
  description: string;
  tokens: string;
  note: string;
}[] = [
  { job_key: "memory_extraction", model_setting: "memory_extraction_model", label: "Memory Extraction", description: "Extract durable facts from finished chats", tokens: "~200–1,000 tokens input", note: "2k context OK" },
  { job_key: "summarization", model_setting: "summarization_model", label: "Summarization", description: "Roll up long chat sessions", tokens: "~500–5,000 tokens input", note: "≥4k context recommended" },
  { job_key: "flashcard_generation", model_setting: "flashcard_model", label: "Flashcard Generation", description: "Generate spaced-repetition cards from topics", tokens: "~100–200 tokens input", note: "2k context OK" },
  { job_key: "workspace_glossary", model_setting: "glossary_model", label: "Workspace Glossary", description: "Refresh per-workspace term definitions", tokens: "~800–2,000 tokens input", note: "≥4k context recommended" },
  { job_key: "hover_definition_scan", model_setting: "glossary_model", label: "Hover Definitions", description: "Find undefined terms in recent chats", tokens: "~400–1,500 tokens input", note: "2k context OK" },
  { job_key: "workspace_prompt_bank", model_setting: "topic_signature_model", label: "Starter Prompts / Topic Signatures", description: "Refresh per-workspace prompt suggestions", tokens: "~1,000–3,000 tokens input", note: "≥4k context recommended" },
  { job_key: "concept_hierarchy", model_setting: "concept_hierarchy_model", label: "Topic Hierarchy", description: "LLM-assisted concept parent linking", tokens: "~200–800 tokens input", note: "2k context OK" },
];

const RUN_MODE_OPTIONS: { value: BackgroundJobRunMode; label: string; description: string }[] = [
  { value: "auto", label: "Auto", description: "Run on schedule with the small model" },
  { value: "confirm_only", label: "Ask first", description: "Only run when the play-button is clicked; skip on timeout" },
  { value: "dual_model", label: "Ask for heavy, fallback small", description: "Run small on timeout; heavy on confirm" },
];

function ScheduledTasksCard({
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
  const [scheduled, setScheduled] = useState<Record<string, ScheduledJobSetting>>({});
  const [timeoutSeconds, setTimeoutSec] = useState<number>(20);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    api.backgroundJobs.getScheduledTaskSettings().then((s) => {
      if (cancelled) { return; }
      const byKey: Record<string, ScheduledJobSetting> = {};
      for (const j of s.jobs) { byKey[j.job_key] = j; }
      setScheduled(byKey);
      setTimeoutSec(s.confirm_timeout_seconds);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) { setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  const eligibleModels = aiModels.filter((m) => m.provider === "ollama" && m.enabled);
  const smallModelOptions = useMemo(
    () => [
      { value: "", label: "Default (background model)" },
      ...eligibleModels.map((m) => ({
        value: m.model_id,
        label: resolveModelDisplayName(m.model_id, modelLabels, aiModels),
      })),
    ],
    [eligibleModels, modelLabels, aiModels],
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
  const modeOptions = RUN_MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

  const updateRunMode = (jobKey: string, mode: BackgroundJobRunMode) => {
    setScheduled((prev) => ({
      ...prev,
      [jobKey]: { ...(prev[jobKey] ?? { job_key: jobKey, run_mode: mode, heavy_model: "" }), run_mode: mode },
    }));
    void api.backgroundJobs.setScheduledTaskSetting(`${jobKey}_run_mode`, mode);
  };

  const updateHeavyModel = (jobKey: string, modelId: string) => {
    setScheduled((prev) => ({
      ...prev,
      [jobKey]: { ...(prev[jobKey] ?? { job_key: jobKey, run_mode: "auto", heavy_model: modelId }), heavy_model: modelId },
    }));
    void api.backgroundJobs.setScheduledTaskSetting(`${jobKey}_heavy_model`, modelId);
  };

  const updateTimeout = (value: number) => {
    const clamped = Math.max(5, Math.min(120, value || 20));
    setTimeoutSec(clamped);
    void api.backgroundJobs.setScheduledTaskSetting(
      "background_confirm_timeout_seconds",
      String(clamped),
    );
  };

  return (
    <section className="space-y-3" data-pref-section>
      <div className="pb-1.5 border-b border-[var(--border-color)]">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          Scheduled Tasks
        </h3>
        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
          Each AI-inferred background job has a small (default) model that runs on schedule and an optional heavy model you can opt into per-tick via the status bar. Run-mode controls whether the job runs automatically, only with confirmation, or both.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--border-color)]/60 bg-[var(--bg-primary)]/40 p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-[var(--text-secondary)]">Confirmation timeout</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              How long the play-button stays in the status bar before it&apos;s dismissed.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={5}
              max={120}
              value={timeoutSeconds}
              onChange={(e) => updateTimeout(Number(e.target.value))}
              className="w-16 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
            />
            <span className="text-xs text-[var(--text-muted)]">seconds</span>
          </div>
        </div>

        {loading && (
          <div className="py-3 text-xs text-[var(--text-muted)]">Loading…</div>
        )}

        {!loading && (
          <div className="divide-y divide-[var(--border-color)]/60">
            {SCHEDULED_JOBS_CATALOG.map((job) => {
              const entry = scheduled[job.job_key];
              const runMode = (entry?.run_mode ?? "auto") as BackgroundJobRunMode;
              const heavyModel = entry?.heavy_model ?? "";
              const smallModel = (dbSettings[job.model_setting] as string) ?? "";

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

              return (
                <div
                  key={job.job_key}
                  className="grid grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[var(--text-primary)]">{job.label}</div>
                    <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{job.description}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--text-muted)]/80">
                      <span>{job.tokens}</span>
                      <span>•</span>
                      <span>{job.note}</span>
                    </div>
                  </div>

                  <div>
                    <CompactMenuSelect
                      label="Run mode"
                      value={runMode}
                      options={modeOptions}
                      onChange={(value) => updateRunMode(job.job_key, value as BackgroundJobRunMode)}
                    />
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Small (default)</div>
                    <CompactMenuSelect
                      label="Small model"
                      value={smallModel}
                      options={smallModelOptions}
                      onChange={(value) => set(job.model_setting, value as never)}
                    />
                    {smallSelected && (smallParamsLabel || smallFitMeta.label) && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] text-[var(--text-muted)]">
                        {smallParamsLabel && <span>{smallParamsLabel}</span>}
                        {smallParamsLabel && smallFitMeta.label && <span>•</span>}
                        {smallFitMeta.label && <span className={`font-medium ${smallFitMeta.textClassName}`}>{smallFitMeta.label}</span>}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Heavy (opt-in)</div>
                    <CompactMenuSelect
                      label="Heavy model"
                      value={heavyModel}
                      options={heavyModelOptions}
                      onChange={(value) => updateHeavyModel(job.job_key, value)}
                    />
                    {heavyParamsLabel && (
                      <div className="mt-1 text-[10px] text-[var(--text-muted)]">{heavyParamsLabel}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export default function PreferencesView() {
  const isLargeScreen = useIsLargeScreen();
  const settingsNavLayout = useSettingsStore((state) => state.settingsNavLayout);
  const setSettingsNavLayout = useSettingsStore((state) => state.setSettingsNavLayout);
  const autoGenerateFlashcards = useSettingsStore((state) => state.autoGenerateFlashcards);
  const setAutoGenerateFlashcards = useSettingsStore((state) => state.setAutoGenerateFlashcards);
  const flashcardModel = useSettingsStore((state) => state.flashcardModel);
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
  const [singleWindowMode, toggleSingleWindowMode] = usePrefsWindowMode();
  const switchWorkspaceSection = useSettingsStore((state) => state.switchWorkspaceSection);
  const showComposerWorkspaceSuggestions = useSettingsStore((state) => state.showComposerWorkspaceSuggestions);
  const setShowComposerWorkspaceSuggestions = useSettingsStore((state) => state.setShowComposerWorkspaceSuggestions);
  const showComposerChatFollowUps = useSettingsStore((state) => state.showComposerChatFollowUps);
  const setShowComposerChatFollowUps = useSettingsStore((state) => state.setShowComposerChatFollowUps);
  const showStatusBar = useSettingsStore((state) => state.showStatusBar);
  const setShowStatusBar = useSettingsStore((state) => state.setShowStatusBar);
  const composerMode = useSettingsStore((state) => state.composerMode);
  const setComposerMode = useSettingsStore((state) => state.setComposerMode);
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
  const workspaceNavigation = useWorkspaceStore((state) => state.workspaceNavigation);
  const sectionNavigation = useWorkspaceStore((state) => state.sectionNavigation);
  const subWorkspaceNavigation = useWorkspaceStore((state) => state.subWorkspaceNavigation);
  const workspaceSortOrder = useWorkspaceStore((state) => state.workspaceSortOrder);
  const setWorkspaceNavigation = useWorkspaceStore((state) => state.setWorkspaceNavigation);
  const setSectionNavigation = useWorkspaceStore((state) => state.setSectionNavigation);
  const setSubWorkspaceNavigation = useWorkspaceStore((state) => state.setSubWorkspaceNavigation);
  const combineWorkspaceDropdown = useWorkspaceStore((state) => state.combineWorkspaceDropdown);
  const combineSubWorkspaceDropdown = useWorkspaceStore((state) => state.combineSubWorkspaceDropdown);
  const combineSectionDropdown = useWorkspaceStore((state) => state.combineSectionDropdown);
  const setCombineWorkspaceDropdown = useWorkspaceStore((state) => state.setCombineWorkspaceDropdown);
  const setCombineSubWorkspaceDropdown = useWorkspaceStore((state) => state.setCombineSubWorkspaceDropdown);
  const setCombineSectionDropdown = useWorkspaceStore((state) => state.setCombineSectionDropdown);
  const incrementModelRefreshCounter = useSettingsStore((state) => state.incrementModelRefreshCounter);
  const setWorkspaceSortOrder = useWorkspaceStore((state) => state.setWorkspaceSortOrder);
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
  }>({});

  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [activeTab, setActiveTab] = useState<PreferencesSection>(() => (window.localStorage.getItem("preferencesActiveTab") as PreferencesSection) || "app");
  const [tabFilter, setTabFilter] = useState("");
  const contentRootRef = useRef<HTMLDivElement | null>(null);

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
  const [showPinSetupModal, setShowPinSetupModal] = useState(false);
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
  }, [setWorkspaces]);

  // Tab-gated backend probes: only fire each (potentially slow) backend call
  // once, when the user first visits the tab that needs the data. This keeps
  // the initial preferences-window paint fast — especially the default "App"
  // tab, which doesn't need Ollama / system specs / MCP / git / security.
  const probedTabsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const probed = probedTabsRef.current;
    const aiTabs = new Set(["ai", "webai", "chat", "learning"]);
    if (aiTabs.has(activeTab)) {
      if (!probed.has("ai")) {
        probed.add("ai");
        loadSystemSpecs();
        const url = dbSettingsRef.current?.ollama_base_url ?? "";
        refreshOllamaModels(url, { useCache: true });
      }
    }
    if (activeTab === "security" && !probed.has("security")) {
      probed.add("security");
      api.security.getStatus().then(setSecurityStatus).catch(() => { });
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

  async function handleSetPinFromModal() {
    if (!dbSettings) { return; }
    setPinMessage(null);

    if (!/^\d{4,8}$/.test(newPin)) {
      setPinMessage({ type: "error", text: "PIN must be 4 to 8 digits." });
      return;
    }
    if (newPin !== confirmPin) {
      setPinMessage({ type: "error", text: "PINs do not match." });
      return;
    }

    setPinSaving(true);
    try {
      await api.security.setPin(newPin, undefined);
      const refreshedStatus = await api.security.getStatus();
      setSecurityStatus(refreshedStatus);
      set("pin_lock_enabled", true);
      resetPinForm();
      setPinMessage(null);
      setShowPinSetupModal(false);
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

      {aiModels.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] py-2">No models configured. Add one above to set up priority ordering.</p>
      ) : (
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] overflow-hidden">
        <div className="grid grid-cols-[minmax(160px,1.6fr)_70px_100px_100px_48px_48px] items-center gap-2 px-4 py-2.5 bg-[var(--bg-hover)]/30 border-b border-[var(--border-color)] text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
          <span>Ollama Models</span>
          <Tooltip content="BG Default: fallback model for background AI tasks (memory extraction, summarization, flashcards, glossary, topic signatures) when no per-job model is set below. Per-job overrides take precedence." position="top">
            <span className="text-center inline-flex items-center justify-center gap-1">
              BG Default
              <span className="text-[8px] opacity-60 normal-case tracking-normal font-normal">ⓘ</span>
            </span>
          </Tooltip>
          <Tooltip content="Speed: measured in tokens per second during the last generation. Higher is faster. This is benchmarked live as you use the model and updates over time." position="top">
            <span className="text-right inline-flex items-center justify-end gap-1">
              Speed
              <span className="text-[8px] opacity-60 normal-case tracking-normal font-normal">ⓘ</span>
            </span>
          </Tooltip>
          <Tooltip content="Context window (tokens): the maximum number of tokens the model holds in memory at once. A larger value lets the model remember more conversation history but uses more VRAM. Leave blank to use Ollama's default for this model." position="top">
            <span className="text-center inline-flex items-center justify-center gap-1">
              Context
              <span className="text-[8px] opacity-60 normal-case tracking-normal font-normal">ⓘ</span>
            </span>
          </Tooltip>
          <Tooltip content="Active: enables or disables this model app-wide. Inactive models are never used for chat or background tasks, even if selected elsewhere." position="top">
            <span className="text-center inline-flex items-center justify-center gap-1">
              Active
              <span className="text-[8px] opacity-60 normal-case tracking-normal font-normal">ⓘ</span>
            </span>
          </Tooltip>
          <Tooltip content="Visible: controls whether this model appears in the chat model picker. Hide models you want active in the background but don't want cluttering the selector." position="top">
            <span className="text-center inline-flex items-center justify-center gap-1">
              Visible
              <span className="text-[8px] opacity-60 normal-case tracking-normal font-normal">ⓘ</span>
            </span>
          </Tooltip>
        </div>

          <div className="divide-y divide-[var(--border-color)]">

          {localGroupedAiModels.map((group) => (
            <React.Fragment key={group.key}>
              {localGroupedAiModels.length > 1 && (
              <div
                data-family-key={group.key}
                onPointerDown={(e) => {
                  if (composerMode !== "family") {return;}
                  // Only start family drag from primary button
                  if (e.button !== 0) {return;}
                  e.preventDefault();
                  setDraggedFamilyId(group.key);
                }}
                className={`relative pl-4 pr-4 py-1 transition-colors select-none ${draggedFamilyId === group.key ? "opacity-50" : ""} ${
                  dragOverFamilyId === group.key && !dragOverModelId
                    ? (draggedFamilyId
                        ? "bg-[var(--accent-color)]/5 before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-[var(--accent-color)] before:z-10"
                        : "bg-[var(--accent-color)]/20")
                    : ""
                } text-[9px] font-semibold tracking-[0.14em] uppercase text-[var(--text-muted)] border-t border-[var(--border-color)]/40 ${composerMode === "family" ? "cursor-grab active:cursor-grabbing" : ""}`}
              >
                {group.label}
              </div>
              )}

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

                const isDragOver = dragOverModelId === m.id;
                let dropIndicatorClass = "";
                if (isDragOver && draggedModelId) {
                  const draggedModel = aiModels.find(x => x.id === draggedModelId);
                  if (draggedModel) {
                    if (draggedModel.priority < m.priority) {
                      dropIndicatorClass = "before:absolute before:inset-x-0 before:bottom-0 before:h-0.5 before:bg-[var(--accent-color)] before:z-10";
                    } else {
                      dropIndicatorClass = "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-[var(--accent-color)] before:z-10";
                    }
                  }
                }

                return (
                  <div
                    key={m.id}
                    data-model-id={m.id}
                    data-family-key={group.key}
                    className={`relative transition-colors select-none ${draggedModelId === m.id || draggedFamilyId === group.key ? "opacity-50" : ""} ${isDragOver ? `bg-[var(--accent-color)]/5 ${dropIndicatorClass}` : "hover:bg-[var(--bg-hover)]/5"} px-4 py-3`}
                  >
                    <div className="flex flex-col gap-2 md:grid md:grid-cols-[minmax(160px,1.6fr)_70px_100px_100px_48px_48px] md:items-start md:gap-2">
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
                                <Tooltip content={fitMeta.title}>
                                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${fitMeta.dotClassName}`} />
                                </Tooltip>
                                <span className="truncate text-sm font-medium text-[var(--text-primary)]">{displayName}</span>
                                {!m.id.startsWith("transient-") && (
                                  <Tooltip content="Rename model">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingModelId(m.id);
                                        setEditingName(m.name);
                                      }}
                                      className="shrink-0 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--text-primary)]"
                                      aria-label={`Rename ${displayName}`}
                                    >
                                      <Pencil size={10} />
                                    </button>
                                  </Tooltip>
                                )}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-[var(--text-secondary)]">
                                {!isOllamaModel && (
                                  <span className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                                    {providerMeta.label}
                                  </span>
                                )}
                                <span className="truncate">{secondaryDisplayName}</span>
                                  {capabilityBadges.length > 0 && (
                                    <Tooltip content={`Capabilities: ${capabilityBadges.map(formatCapabilityLabel).join(", ")}`}>
                                      <div
                                        className="ml-1 shrink-0 cursor-help text-[var(--text-muted)] transition-colors hover:text-[var(--accent-color)]"
                                      >
                                        <Info size={12} />
                                      </div>
                                    </Tooltip>
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
                        <Tooltip content={canBeBackgroundModel ? "Use for background tasks" : "Enable this model to make it selectable for background tasks"}>
                          <label
                            className={`flex items-center justify-center md:w-[70px] ${canBeBackgroundModel ? "cursor-pointer text-[var(--text-secondary)]" : "cursor-not-allowed text-[var(--text-muted)] opacity-60"
                              }`}
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
                        </Tooltip>
                      )}
                      {!isOllamaModel && <div className="hidden md:block md:w-[70px]" />}

                      <div className="text-right text-[10px] leading-5 text-[var(--text-muted)] md:w-[100px]">
                        {m.is_paid && (
                          <div className="font-medium uppercase tracking-wide text-amber-400">Paid</div>
                        )}
                        {speedLabels && !isWebModel && (
                          <Tooltip content={`Average generation speed across ${speedStat.chat_count} chats`}>
                            <div className="tabular-nums whitespace-nowrap text-[var(--text-secondary)]">
                              {speedLabels.chatAverage} avg
                            </div>
                          </Tooltip>
                        )}
                        {speedLabels && !isWebModel && (
                          <Tooltip content="Weighted overall generation speed across all recorded assistant messages">
                            <div className="tabular-nums whitespace-nowrap text-[var(--text-secondary)]">
                              {speedLabels.weighted} weighted
                            </div>
                          </Tooltip>
                        )}
                        {!isWebModel && (
                          <Tooltip content={`${m.tokens_used_total.toLocaleString()} total tokens recorded`}>
                            <div className="tabular-nums whitespace-nowrap">
                              {m.tokens_used_total.toLocaleString()} tok total
                            </div>
                          </Tooltip>
                        )}
                      </div>

                      <div className="flex justify-center pt-0.5 md:w-[100px]">
                        {!isWebModel && !m.id.startsWith("transient-") && (
                          <ContextSizeInput
                            modelName={m.name}
                            savedValue={m.context_size ?? null}
                            onSave={async (next) => { await api.aiModel.update(m.id, { context_size: next }); loadAiModels(); }}
                            onClear={async () => { await api.aiModel.update(m.id, { context_size: null }); loadAiModels(); }}
                          />
                        )}
                      </div>

                      <div className="flex justify-center pt-0.5 md:w-[48px]">
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

                      <div className="flex justify-center pt-1 md:w-[48px]">
                        <Tooltip content={m.is_hidden ? "Show in Chat" : "Hide from Chat"}>
                          <button
                            onClick={async () => {
                              await api.aiModel.update(m.id, { is_hidden: !m.is_hidden });
                              loadAiModels();
                              incrementModelRefreshCounter();
                            }}
                            className={`p-1 transition-colors ${m.is_hidden ? "text-[var(--text-muted)] hover:text-[var(--text-primary)]" : "text-[var(--accent-color)] hover:opacity-80"}`}
                          >
                            {m.is_hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </Tooltip>
                      </div>

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

  // Dedicated thumbnail for the sub-workspace navigation picker. Sub-workspaces
  // are children of the active parent, so the frame always shows a parent
  // workspace tab row, then the chosen sub-workspace presentation.
  const SubNavPreview = ({ subNav }: { subNav: NavigationPresentation }) => (
    <div className="mb-2 rounded overflow-hidden border border-[var(--border-color)] opacity-70 flex flex-col" style={{ height: 56 }}>
      {/* Parent workspace top bar (constant) */}
      <div className="flex items-center gap-1 px-1.5 py-1 bg-[var(--bg-secondary)] shrink-0">
        <div className="h-2 w-6 rounded-full bg-[var(--accent-color)] opacity-80" />
        <div className="h-2 w-4 rounded-full bg-[var(--text-muted)] opacity-40" />
      </div>
      {/* Sub-workspace tab row */}
      {subNav === "top-tabs" && (
        <div className="flex items-center gap-1 px-1.5 py-0.5 bg-[var(--bg-secondary)]/70 shrink-0">
          <div className="h-1.5 w-1.5 rounded-full bg-[var(--text-muted)] opacity-40" />
          <div className="h-1.5 w-4 rounded-full bg-[var(--accent-color)] opacity-70" />
          <div className="h-1.5 w-3 rounded-full bg-[var(--text-muted)] opacity-35" />
        </div>
      )}
      {/* Sub-workspace dropdown row */}
      {subNav === "top-dropdown" && (
        <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-[var(--bg-secondary)]/70 shrink-0">
          <div className="h-1.5 w-6 rounded-full bg-[var(--accent-color)] opacity-70" />
          <div className="h-1 w-1 bg-[var(--text-muted)] opacity-35" style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
        </div>
      )}
      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Sub-workspace sidebar rail */}
        {subNav === "sidebar" && (
          <div className="flex flex-col gap-1 px-1 pt-1 bg-[var(--bg-secondary)]/60 w-7 shrink-0">
            <div className="h-1.5 w-3 rounded-sm bg-[var(--text-muted)] opacity-35" />
            <div className="h-1.5 w-4 rounded-sm bg-[var(--accent-color)] opacity-70" />
            <div className="h-1.5 w-3 rounded-sm bg-[var(--text-muted)] opacity-35" />
          </div>
        )}
        <div className="flex-1 px-1.5 pt-1 flex flex-col gap-1 bg-[var(--bg-primary)]">
          <div className="h-1.5 w-8 rounded-sm bg-[var(--text-muted)] opacity-25" />
          <div className="h-1.5 w-6 rounded-sm bg-[var(--text-muted)] opacity-15" />
        </div>
      </div>
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
                  <div className="flex flex-col gap-8">
                    <div className="space-y-8">
                      {/* Startup & background */}
                      <section className="space-y-3" data-pref-section>
                        <div className="pb-1.5 border-b border-[var(--border-color)]">
                          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Startup & background</h3>
                          <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                            Control how Aetherium launches and whether it stays available after the main window closes.
                          </p>
                        </div>

                        <div className="flex items-start gap-3 py-0.5">
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
                        </div>

                        <div className="flex items-start gap-3 py-0.5">
                          <Toggle
                            on={dbSettings.open_in_background}
                            disabled={!dbSettings.start_at_login}
                            onToggle={() => set("open_in_background", !dbSettings.open_in_background)}
                            />
                          <div>
                            <p className={`text-sm ${dbSettings.start_at_login ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}`}>Open in background</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              {dbSettings.start_at_login
                                ? "Launch without bringing window to front"
                                : "Available only when Start at login is enabled"}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start gap-3 py-0.5">
                          <Toggle
                            on={dbSettings.keep_running_in_tray}
                            onToggle={() => set("keep_running_in_tray", !dbSettings.keep_running_in_tray)}
                            />
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Keep running in tray</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              Closing the main window keeps the menu bar or tray app alive so quick search still works.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start gap-3 py-0.5">
                          <Toggle
                            on={dbSettings.hide_native_menu}
                            onToggle={() => set("hide_native_menu", !dbSettings.hide_native_menu)}
                            />
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Hide native menu</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              Removes the standard application menu bar (macOS only).
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start gap-3 py-0.5">
                          <Toggle
                            on={singleWindowMode}
                            onToggle={toggleSingleWindowMode}
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm text-[var(--text-secondary)]">Single window mode</p>
                              <Pin size={12} className={singleWindowMode ? "text-[var(--accent-color)]" : "text-[var(--text-muted)]"} />
                            </div>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              Prevent multiple preferences windows from opening simultaneously.
                            </p>
                          </div>
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
                      </section>

                      {/* Features */}
                      <section className="space-y-3" data-pref-section>
                        <div className="pb-1.5 border-b border-[var(--border-color)]">
                          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Features</h3>
                          <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                            Enable or disable optional features across Aetherium.
                          </p>
                        </div>

                        <div className="flex items-start gap-3 py-0.5">
                          <Toggle
                            on={dbSettings.memory_enabled}
                            onToggle={() => set("memory_enabled", !dbSettings.memory_enabled)}
                            />
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Memory</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              Store and use persistent facts and preferences across conversations
                            </p>
                          </div>
                        </div>
                      </section>

                      {/* Shortcut */}
                      <section className="space-y-3" data-pref-section>
                        <div className="pb-1.5 border-b border-[var(--border-color)]">
                          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Shortcut</h3>
                          <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                            Set the global accelerator used to open quick search from anywhere.
                          </p>
                        </div>
                        <ShortcutRecorder
                          value={quickSearchShortcutDraft}
                          onChange={setQuickSearchShortcutDraft}
                          onCommit={(v) => set("quick_search_shortcut", v)}
                          placeholder={isMac ? "Cmd+Shift+K" : "Ctrl+Shift+K"}
                        />
                      </section>
                    </div>

                    {/* Background Jobs */}
                    <section className="space-y-3" data-pref-section>
                      <div className="pb-1.5 border-b border-[var(--border-color)]">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Background Jobs</h3>
                        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                          Configure automatic background processing tasks like memory extraction and summarization.
                        </p>
                      </div>

                      <div className="flex items-start gap-3">
                        <Toggle
                          on={dbSettings.background_inference_enabled}
                          onToggle={() => set("background_inference_enabled", !dbSettings.background_inference_enabled)}
                        />
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Enable background inference</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Run memory extraction, summarization, and glossary jobs automatically. Disable to reduce GPU/RAM usage when the app is idle.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between py-0.5">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Memory extraction threshold</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Minimum messages in a session before memories are auto-extracted
                          </p>
                        </div>
                        <input
                          type="number"
                          min={2}
                          max={50}
                          value={dbSettings.memory_extraction_threshold}
                          onChange={(e) => set("memory_extraction_threshold", Math.max(2, Math.min(50, Number(e.target.value) || 5)))}
                          className="w-16 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                        />
                      </div>
                      <div className="flex items-center justify-between py-0.5">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Idle window (minutes)</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            How long after the last chat activity before extraction runs
                          </p>
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={dbSettings.memory_extraction_idle_minutes}
                          onChange={(e) => set("memory_extraction_idle_minutes", Math.max(1, Math.min(60, Number(e.target.value) || 5)))}
                          className="w-16 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                        />
                      </div>

                      <div className="border-t border-[var(--border-color)] pt-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Summarization</p>
                      </div>
                      <div className="flex items-center justify-between py-0.5">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Min messages before summarizing</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Sessions need at least this many messages before a rolling summary is generated
                          </p>
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={dbSettings.summarization_min_messages}
                          onChange={(e) => set("summarization_min_messages", Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                          className="w-16 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                        />
                      </div>
                      <div className="flex items-center justify-between py-0.5">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Sessions per tick</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Max number of sessions summarized per scheduler cycle
                          </p>
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={dbSettings.summarization_max_sessions}
                          onChange={(e) => set("summarization_max_sessions", Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
                          className="w-16 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                        />
                      </div>

                      <div className="border-t border-[var(--border-color)] pt-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Topic Analysis</p>
                      </div>
                      <div className="flex items-center justify-between py-0.5">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Recompute interval (minutes)</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            How often workspace topic signatures are refreshed in the background
                          </p>
                        </div>
                        <input
                          type="number"
                          min={5}
                          max={120}
                          value={dbSettings.topic_analysis_interval_minutes}
                          onChange={(e) => set("topic_analysis_interval_minutes", Math.max(5, Math.min(120, Number(e.target.value) || 30)))}
                          className="w-16 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                        />
                      </div>

                      <div className="border-t border-[var(--border-color)] pt-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Workspace Glossary</p>
                      </div>
                      <div className="flex items-center justify-between py-0.5">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Glossary refresh interval (minutes)</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            How often the workspace glossary refresh runs before residual chat scanning
                          </p>
                        </div>
                        <input
                          type="number"
                          min={5}
                          max={240}
                          value={dbSettings.workspace_glossary_refresh_interval_minutes}
                          onChange={(e) => set("workspace_glossary_refresh_interval_minutes", Math.max(5, Math.min(240, Number(e.target.value) || 60)))}
                          className="w-16 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                        />
                      </div>
                      <div className="flex items-start gap-3 py-0.5">
                        <Toggle
                          on={dbSettings.hover_definition_scan_enabled}
                          onToggle={() => set("hover_definition_scan_enabled", !dbSettings.hover_definition_scan_enabled)}
                          />
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Chat definition scan</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Scan assistant replies for unresolved workspace terminology after glossary refresh
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between py-0.5">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Sessions per scan tick</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Max number of recent sessions scanned for missing definitions each scheduler cycle
                          </p>
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={dbSettings.hover_definition_scan_max_sessions}
                          onChange={(e) => set("hover_definition_scan_max_sessions", Math.max(1, Math.min(20, Number(e.target.value) || 3)))}
                          className="w-16 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                        />
                      </div>

                      <div className="pt-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Git Sync</p>
                      </div>
                      <div className="flex items-center justify-between py-0.5">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Sync interval (minutes)</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            How often the background git sync runs when enabled
                          </p>
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={dbSettings.git_sync_interval_minutes}
                          onChange={(e) => set("git_sync_interval_minutes", Math.max(1, Math.min(60, Number(e.target.value) || 5)))}
                          className="w-16 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                        />
                      </div>
                    </section>
                  </div>
                )}

                {/* ── Navigation ── */}
                {activeTab === "navigation" && (
                  <div className="flex flex-col gap-8">
                    <section className="space-y-3" data-pref-section>
                      <div className="pb-1.5 border-b border-[var(--border-color)]">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Main layout</h3>
                        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
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
                              onMouseEnter={() => setHoverOverrides((o) => ({ ...o, workspaceNavigation: option.id as NavigationPresentation }))}
                              onMouseLeave={() => setHoverOverrides((o) => ({ ...o, workspaceNavigation: null }))}
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
                              onMouseEnter={() => setHoverOverrides((o) => ({ ...o, sectionNavigation: option.id as NavigationPresentation }))}
                              onMouseLeave={() => setHoverOverrides((o) => ({ ...o, sectionNavigation: null }))}
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

                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block">Sub-Workspace Navigation</label>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {[
                            { id: "sidebar", label: "Sidebar", description: "List sub-workspaces in a left rail beside the main content." },
                            { id: "top-tabs", label: "Top Tabs", description: "Show sub-workspaces as a tab row beneath the titlebar." },
                            { id: "top-dropdown", label: "Top Dropdown", description: "Use a compact sub-workspace picker beneath the titlebar." },
                          ].map((option) => (
                            <button
                              key={option.id}
                              onClick={() => setSubWorkspaceNavigation(option.id as NavigationPresentation)}
                              onMouseEnter={() => setHoverOverrides((o) => ({ ...o, subWorkspaceNavigation: option.id as NavigationPresentation }))}
                              onMouseLeave={() => setHoverOverrides((o) => ({ ...o, subWorkspaceNavigation: null }))}
                              className={`rounded-lg border px-3 py-2 text-left transition-colors ${subWorkspaceNavigation === option.id
                                ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                                : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                }`}
                            >
                              <SubNavPreview subNav={option.id as NavigationPresentation} />
                              <div className="text-xs font-medium">{option.label}</div>
                              <div className="mt-1 text-[11px] opacity-75">{option.description}</div>
                            </button>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] text-[var(--text-muted)]/80">
                          Applies when the active workspace has sub-workspaces. Independent of the workspace and section choices above.
                        </p>
                      </div>

                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block">Combine dropdowns into titlebar line</label>
                        <p className="text-[11px] text-[var(--text-muted)]/80 mb-2.5">
                          For each axis set to Top Dropdown, place its picker on a single titlebar line (Workspace / Sub-workspace / Section) instead of its own row. Only applies to axes using Top Dropdown.
                        </p>
                        <div className="space-y-2.5">
                          {[
                            { id: "workspace", label: "Workspace", on: combineWorkspaceDropdown, toggle: () => setCombineWorkspaceDropdown(!combineWorkspaceDropdown), enabled: workspaceNavigation === "top-dropdown" },
                            { id: "subworkspace", label: "Sub-workspace", on: combineSubWorkspaceDropdown, toggle: () => setCombineSubWorkspaceDropdown(!combineSubWorkspaceDropdown), enabled: subWorkspaceNavigation === "top-dropdown" },
                            { id: "section", label: "Section", on: combineSectionDropdown, toggle: () => setCombineSectionDropdown(!combineSectionDropdown), enabled: sectionNavigation === "top-dropdown" },
                          ].map((row) => (
                            <div key={row.id} className={`flex items-start gap-3 py-0.5 ${row.enabled ? "" : "opacity-50"}`}>
                              <Toggle on={row.on} onToggle={row.toggle} disabled={!row.enabled} />
                              <div>
                                <p className="text-sm text-[var(--text-secondary)]">{row.label}</p>
                                {!row.enabled && (
                                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Set {row.label} navigation to Top Dropdown to combine it.</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>


                    <section className="space-y-3" data-pref-section>
                      <div className="pb-1.5 border-b border-[var(--border-color)]">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Workspace behavior</h3>
                        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
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
                              onMouseEnter={() => setHoverOverrides((o) => ({ ...o, workspaceSortOrder: option.id }))}
                              onMouseLeave={() => setHoverOverrides((o) => ({ ...o, workspaceSortOrder: null }))}
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
                        <div className="relative">
                          <select
                            value={switchWorkspaceSection}
                            onChange={(e) => set("switch_workspace_section", e.target.value)}
                            className="appearance-none cursor-pointer text-sm bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg pl-2 pr-7 py-1 text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                          >
                            <option value="">Stay on current</option>
                            <option value="/folder">Dashboard</option>
                            <option value="/chat">Chat</option>
                            <option value="/notes">Notes</option>
                            <option value="/sources">Sources</option>
                            <option value="/graph">Knowledge</option>
                            <option value="/history">History</option>
                          </select>
                          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
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
                    </section>
                  </div>
                )}

                {/* ── Appearance ── */}
                {activeTab === "appearance" && (
                  <div className="flex flex-col gap-8">
                    {/* Typography & Interface */}
                    <section className="space-y-3" data-pref-section>
                      <div className="pb-1.5 border-b border-[var(--border-color)]">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Typography & Interface</h3>
                        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                          Adjust text sizes and platform-specific window decorations.
                        </p>
                      </div>

                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">Text Size</label>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setAppearance("font_size", Math.max(MIN_FONT_SIZE, dbSettings.font_size - 1))}
                            onMouseEnter={() => setHoverOverrides((o) => ({ ...o, fontSize: Math.max(MIN_FONT_SIZE, dbSettings.font_size - 1) }))}
                            onMouseLeave={() => setHoverOverrides((o) => ({ ...o, fontSize: null }))}
                            disabled={dbSettings.font_size <= MIN_FONT_SIZE}
                            className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            A-
                          </button>
                          <button
                            type="button"
                            onClick={() => setAppearance("font_size", Math.min(MAX_FONT_SIZE, dbSettings.font_size + 1))}
                            onMouseEnter={() => setHoverOverrides((o) => ({ ...o, fontSize: Math.min(MAX_FONT_SIZE, dbSettings.font_size + 1) }))}
                            onMouseLeave={() => setHoverOverrides((o) => ({ ...o, fontSize: null }))}
                            disabled={dbSettings.font_size >= MAX_FONT_SIZE}
                            className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            A+
                          </button>
                          <button
                            type="button"
                            onClick={() => setAppearance("font_size", DEFAULT_FONT_SIZE)}
                            onMouseEnter={() => setHoverOverrides((o) => ({ ...o, fontSize: DEFAULT_FONT_SIZE }))}
                            onMouseLeave={() => setHoverOverrides((o) => ({ ...o, fontSize: null }))}
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
                          <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">Menubar Icon Style</label>
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
                    </section>

                    {/* Theme & Accent */}
                    <section className="space-y-3" data-pref-section>
                      <div className="pb-1.5 border-b border-[var(--border-color)]">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Theme & Accent</h3>
                        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                          Personalize the color scheme and main highlights of the interface.
                        </p>
                      </div>

                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">Theme</label>
                        <div className="flex flex-wrap gap-2">
                          {THEMES.map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => updateSettings({ theme: t, accent_color: THEME_DEFAULT_ACCENTS[t] })}
                              onMouseEnter={() => setHoverOverrides((o) => ({ ...o, theme: t, accentColor: THEME_DEFAULT_ACCENTS[t] }))}
                              onMouseLeave={() => setHoverOverrides((o) => ({ ...o, theme: null, accentColor: null }))}
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
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">Accent Color</label>
                        <div className="grid grid-cols-8 gap-2 w-fit">
                          {ACCENT_COLORS.map(({ label, value }) => (
                            <Tooltip key={value} content={label}>
                              <button
                                onClick={() => setAppearance("accent_color", value)}
                                onMouseEnter={() => setHoverOverrides((o) => ({ ...o, accentColor: value }))}
                                onMouseLeave={() => setHoverOverrides((o) => ({ ...o, accentColor: null }))}
                                aria-label={`Use ${label} accent`}
                                className={`relative h-8 w-8 rounded-full border-2 border-white transition-all ${dbSettings.accent_color === value ? "scale-110 shadow-sm ring-2 ring-white ring-offset-2 ring-offset-[var(--bg-elevated)] z-10" : "opacity-80 hover:opacity-100 hover:scale-105"
                                  }`}
                                style={{ backgroundColor: value }}
                              >
                                <span className="sr-only">{label}</span>
                              </button>
                            </Tooltip>
                          ))}
                        </div>
                      </div>
                    </section>
                  </div>
                )}

                {/* ── AI / Ollama ── */}
                {activeTab === "ai" && (
                  <div className="space-y-8">
                    <div className="flex flex-col gap-8">
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

                          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 space-y-3">
                            <div>
                              <p className="text-[11px] font-semibold text-[var(--text-primary)]">Memory headroom</p>
                              <p className="mt-1 text-[10px] text-[var(--text-secondary)] leading-relaxed">
                                {(() => {
                                  const osLower = systemSpecs.os_name.toLowerCase();
                                  const isMac = osLower.includes("mac") || osLower.includes("darwin");
                                  const isWindows = (osLower.includes("windows") || osLower.includes("win32") || osLower.includes("win64") || osLower.includes("microsoft")) && !osLower.includes("darwin") && !osLower.includes("mac");
                                  const isLinux = osLower.includes("linux");

                                  const isMacUnified = isMac && ["aarch64", "arm64"].includes(systemSpecs.cpu_arch.toLowerCase());
                                  const hasGpu = (systemSpecs.gpu_memory_bytes ?? 0) > 0;
                                  const gpuNameLower = (systemSpecs.gpu_name || "").toLowerCase();

                                  const isNvidia = gpuNameLower.includes("nvidia") || gpuNameLower.includes("geforce") || gpuNameLower.includes("rtx");
                                  const isAmd = gpuNameLower.includes("amd") || gpuNameLower.includes("radeon") || gpuNameLower.includes("navi");
                                  const isIntel = gpuNameLower.includes("intel");

                                  if (isMacUnified) {
                                    return (
                                      <>
                                        Unified memory reserved for system and other apps. Check usage in macOS <strong>Activity Monitor</strong> (Memory tab).
                                      </>
                                    );
                                  }

                                  const reserveText = hasGpu
                                    ? "RAM and VRAM reserved for system and other apps (larger of GB or % applies per pool)."
                                    : "RAM reserved for system and other apps (larger of GB or % applies).";

                                  const checkText = (() => {
                                    if (isMac) {
                                      return hasGpu
                                        ? "Check usage in macOS Activity Monitor (Memory/GPU History)."
                                        : "Check usage in macOS Activity Monitor (Memory tab).";
                                    }
                                    if (isWindows) {
                                      return hasGpu
                                        ? "Check usage in Task Manager (Performance → Memory/GPU)."
                                        : "Check usage in Task Manager (Performance → Memory).";
                                    }
                                    if (isLinux) {
                                      if (hasGpu) {
                                        if (isNvidia) { return <>Check VRAM via <code>nvidia-smi</code> or <code>nvtop</code>, RAM via <code>free -h</code>.</>; }
                                        if (isAmd) { return <>Check VRAM via <code>radeontop</code> or <code>rocm-smi</code>, RAM via <code>free -h</code>.</>; }
                                        if (isIntel) { return <>Check VRAM via <code>intel_gpu_top</code>, RAM via <code>free -h</code>.</>; }
                                        return <>Check GPU usage via diagnostics, RAM via <code>free -h</code>.</>;
                                      }
                                      return <>Check usage via <code>free -h</code> or <code>htop</code>.</>;
                                    }
                                    return <>Check usage in your system&apos;s activity monitor.</>;
                                  })();

                                  return (
                                    <>
                                      {reserveText} {checkText}
                                    </>
                                  );
                                })()}
                              </p>
                            </div>

                            {(systemSpecs.gpu_memory_bytes ?? 0) > 0 && (
                              <div className="space-y-1">
                                <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">VRAM headroom</p>
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                                    <input
                                      type="number"
                                      min={0}
                                      max={1024}
                                      step={0.1}
                                      value={dbSettings.vram_headroom_gb}
                                      onChange={(e) => set("vram_headroom_gb", Math.max(0, Number(e.target.value) || 0))}
                                      className="w-20 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
                                    />
                                    GB
                                  </label>
                                  <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                                    <input
                                      type="number"
                                      min={0}
                                      max={90}
                                      step={1}
                                      value={dbSettings.vram_headroom_percent}
                                      onChange={(e) => set("vram_headroom_percent", Math.min(90, Math.max(0, Math.round(Number(e.target.value) || 0))))}
                                      className="w-16 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
                                    />
                                    %
                                  </label>
                                  <span className="text-[10px] text-[var(--text-secondary)]">
                                    {(() => {
                                      const r = applyHeadroom(
                                        systemSpecs.gpu_memory_bytes ?? 0,
                                        dbSettings.vram_headroom_gb,
                                        dbSettings.vram_headroom_percent,
                                      );
                                      return `Effective: ${formatBytes(r.effectiveBytes)} of ${formatBytes(systemSpecs.gpu_memory_bytes ?? 0)}${r.reservedBytes > 0 ? ` (${formatBytes(r.reservedBytes)} reserved)` : ""}`;
                                    })()}
                                  </span>
                                </div>
                              </div>
                            )}

                            <div className="space-y-1">
                              <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                                {systemSpecs.os_name.toLowerCase().includes("mac") && ["aarch64", "arm64"].includes(systemSpecs.cpu_arch.toLowerCase())
                                  ? "Memory headroom (unified)"
                                  : "RAM headroom"}
                              </p>
                              <div className="flex flex-wrap items-center gap-2">
                                <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                                  <input
                                    type="number"
                                    min={0}
                                    max={1024}
                                    step={0.1}
                                    value={dbSettings.ram_headroom_gb}
                                    onChange={(e) => set("ram_headroom_gb", Math.max(0, Number(e.target.value) || 0))}
                                    className="w-20 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
                                  />
                                  GB
                                </label>
                                <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                                  <input
                                    type="number"
                                    min={0}
                                    max={90}
                                    step={1}
                                    value={dbSettings.ram_headroom_percent}
                                    onChange={(e) => set("ram_headroom_percent", Math.min(90, Math.max(0, Math.round(Number(e.target.value) || 0))))}
                                    className="w-16 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
                                  />
                                  %
                                </label>
                                <span className="text-[10px] text-[var(--text-secondary)]">
                                  {(() => {
                                    const r = applyHeadroom(
                                      systemSpecs.total_memory_bytes,
                                      dbSettings.ram_headroom_gb,
                                      dbSettings.ram_headroom_percent,
                                    );
                                    return `Effective: ${formatBytes(r.effectiveBytes)} of ${formatBytes(systemSpecs.total_memory_bytes)}${r.reservedBytes > 0 ? ` (${formatBytes(r.reservedBytes)} reserved)` : ""}`;
                                  })()}
                                </span>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="text-[11px] text-[var(--text-secondary)]">
                          {systemSpecsLoading ? "Reading local system specs..." : (systemSpecsError || "System specs are not available yet.")}
                        </p>
                      )}
                    </div>

                    <section className="space-y-3" data-pref-section>
                      <div className="pb-1.5 border-b border-[var(--border-color)]">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Local inference providers</h3>
                        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                          Configure your local inference engines. Use the default local server for a standard experience, or enable MLX and llama.cpp for optimized hardware performance.
                        </p>
                      </div>

                      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 space-y-4">
                        <div className="flex items-start gap-3">
                          <Toggle
                            on={dbSettings.ollama_remote_enabled}
                            onToggle={() => {
                              const remoteEnabled = !dbSettings.ollama_remote_enabled;
                              updateSettings({
                                ollama_remote_enabled: remoteEnabled,
                                auto_start_ollama: remoteEnabled ? false : dbSettings.auto_start_ollama,
                              });
                            }}
                          />
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Remote Ollama</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              Send Ollama requests to another machine on your network.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start gap-3">
                          <Toggle
                            on={dbSettings.auto_start_ollama}
                            disabled={dbSettings.ollama_remote_enabled}
                            onToggle={() => set("auto_start_ollama", !dbSettings.auto_start_ollama)}
                          />
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Auto-start Ollama</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              {dbSettings.ollama_remote_enabled
                                ? "Disabled in remote mode because the server runs on another machine."
                                : "Automatically start the Ollama server when the app launches."}
                            </p>
                          </div>
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
                                disabled={dbSettings.ollama_remote_enabled || startingOllama || testingOllama}
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
                            placeholder={dbSettings.ollama_remote_enabled ? "http://macbook.local:11434" : "http://localhost:11434"}
                            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                          />
                          <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
                            {dbSettings.ollama_remote_enabled
                              ? "Use a LAN address such as http://macbook.local:11434 or a reserved 192.168.x.x address."
                              : "Enable auto-start to try to start the server on launch when you use the default local address."}
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
                                <Tooltip content={path}>
                                  <span className="text-[11px] text-[var(--text-primary)] truncate">
                                    {path.split("/").pop()}
                                  </span>
                                </Tooltip>
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
                    </section>

                    <section className="space-y-3" data-pref-section>
                      <div className="pb-1.5 border-b border-[var(--border-color)]">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Dual-model execution</h3>
                        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
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
                    </section>

                    <section className="space-y-3" data-pref-section>
                      <div className="pb-1.5 border-b border-[var(--border-color)]">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Embedding model</h3>
                        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
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
                    </section>

                  </div>
                  {ollamaModelsSection}
                </div>
              )}

                {/* ── Chat ── */}
                {activeTab === "chat" && (
                  <div className="flex flex-col gap-8">
                    {/* Section: Chat Layout & Preview */}
                    <section className="space-y-3" data-pref-section>
                      <div className="pb-1.5 border-b border-[var(--border-color)]">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Chat Layout & Preview</h3>
                        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                          Configure chat message appearance, size limits, and scroll behavior.
                        </p>
                      </div>

                      {/* Chat messages style selector */}
                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">Chat Messages Style</label>
                        <div className="flex flex-row flex-wrap gap-x-6 gap-y-2">
                          {(["bubble", "flat", "minimal"] as ChatMessageStyle[]).map((style) => (
                            <label
                              key={style}
                              className="flex items-center gap-2 text-sm cursor-pointer"
                              onMouseEnter={() => setHoverOverrides((o) => ({ ...o, chatMessageStyle: style }))}
                              onMouseLeave={() => setHoverOverrides((o) => ({ ...o, chatMessageStyle: null }))}
                            >
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
                        <p className="text-[11px] text-[var(--text-muted)] mt-2">
                          <strong>Bubble:</strong> colored rounded message bubbles. <strong>Flat:</strong> borderless document-style layout. <strong>Minimal:</strong> full-width, no bubbles, with role labels.
                        </p>
                      </div>

                      <div className="space-y-2 pt-1">
                        <div className="flex items-start gap-3 py-0.5">
                          <Toggle on={expandChatToWindowWidth} onToggle={() => setExpandChatToWindowWidth(!expandChatToWindowWidth)} />
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Expand Chat Container</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">Remove the maximum width constraint on the chat area</p>
                          </div>
                        </div>

                        <div className="flex items-start gap-3 py-0.5">
                          <Toggle on={scrollToTopOnSend} onToggle={() => setScrollToTopOnSend(!scrollToTopOnSend)} />
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Scroll Message to Top</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">After sending, scroll so your message appears at the top of the view</p>
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* Section: Composer & Input */}
                    <section className="space-y-3" data-pref-section>
                      <div className="pb-1.5 border-b border-[var(--border-color)]">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Composer & Input</h3>
                        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                          Configure layout buttons, chips, and identification labels.
                        </p>
                      </div>

                      {/* Composer Mode */}
                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">Composer Mode</label>
                        <div className="flex flex-row items-center gap-x-6">
                          {(["normal", "family"] as const).map((mode) => (
                            <label
                              key={mode}
                              className="flex items-center gap-2 text-sm cursor-pointer"
                              onMouseEnter={() => setHoverOverrides((o) => ({ ...o, composerMode: mode }))}
                              onMouseLeave={() => setHoverOverrides((o) => ({ ...o, composerMode: null }))}
                            >
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
                        <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                          Normal: one send button per message. Family: send buttons grouped by model family.
                        </p>
                      </div>

                      {/* Composer Suggestions */}
                      <div className="pt-3">
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">Composer Suggestions</label>
                        <div className="flex flex-row flex-wrap gap-x-5 gap-y-2">
                          <label className="flex items-center gap-2 text-sm cursor-pointer font-normal">
                            <Toggle on={showComposerWorkspaceSuggestions} onToggle={() => setShowComposerWorkspaceSuggestions(!showComposerWorkspaceSuggestions)} />
                            <span className="text-[var(--text-secondary)]">Workspace suggestions</span>
                          </label>
                          <label className="flex items-center gap-2 text-sm cursor-pointer font-normal">
                            <Toggle on={showComposerChatFollowUps} onToggle={() => setShowComposerChatFollowUps(!showComposerChatFollowUps)} />
                            <span className="text-[var(--text-secondary)]">Follow-up suggestions</span>
                          </label>
                        </div>
                      </div>

                      {/* Chat Identifiers */}
                      <div className="pt-3">
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">Chat Identifiers</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-xs text-[var(--text-secondary)]">User Identifier</label>
                            <input
                              type="text"
                              value={dbSettings.user_chat_label}
                              onChange={(e) => set("user_chat_label", e.target.value)}
                              placeholder="You"
                              className="w-full text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs text-[var(--text-secondary)]">Assistant Identifier</label>
                            <input
                              type="text"
                              value={dbSettings.assistant_chat_label}
                              onChange={(e) => set("assistant_chat_label", e.target.value)}
                              placeholder="Assistant"
                              className="w-full text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                            />
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* Section: Metadata & Diagnostics */}
                    <section className="space-y-3" data-pref-section>
                      <div className="pb-1.5 border-b border-[var(--border-color)]">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Metadata & Diagnostics</h3>
                        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                          Configure auto-generated content and performance overlays.
                        </p>
                      </div>

                      {/* Chat Title Auto-Generation */}
                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium font-semibold">Chat Title Auto-Generation</label>
                        <div className="flex flex-row flex-wrap gap-x-5 gap-y-2">
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
                          <label className="flex items-center gap-2 text-sm cursor-pointer flex-wrap">
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
                      </div>

                      {/* Show Gen Info */}
                      <div className="pt-3 space-y-2">
                        <div className="flex items-start gap-3 py-0.5">
                          <Toggle on={showGenInfo} onToggle={() => setShowGenInfo(!showGenInfo)} />
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Show Gen Info</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">Display token count, duration, and speed (tok/s) below assistant messages.</p>
                          </div>
                        </div>
                        {showGenInfo && (
                          <div className="flex flex-row flex-wrap gap-x-5 gap-y-2 ml-4 border-l border-[var(--border-color)] pl-4 py-1">
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

                      {/* Status Bar */}
                      <div className="pt-3">
                        <div className="flex items-start gap-3 py-0.5">
                          <Toggle on={showStatusBar} onToggle={() => setShowStatusBar(!showStatusBar)} />
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Show Status Bar</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">Display the system status bar (CPU, RAM, active jobs) at the bottom of the window</p>
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* Section: Safety & Deletion */}
                    <section className="space-y-3" data-pref-section>
                      <div className="pb-1.5 border-b border-[var(--border-color)]">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Safety & Deletion</h3>
                        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                          Configure safety prompts and permanent deletion options.
                        </p>
                      </div>

                      <div className="flex items-start gap-3 py-0.5">
                        <Toggle on={dbSettings.immediate_delete} onToggle={() => set("immediate_delete", !dbSettings.immediate_delete)} />
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Immediate Delete</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">Bypass recycle bin and delete chats immediately with confirmation</p>
                        </div>
                      </div>

                      {!dbSettings.immediate_delete && (
                        <div className="flex items-start gap-3 py-0.5">
                          <Toggle on={dbSettings.confirm_move_to_trash} onToggle={() => set("confirm_move_to_trash", !dbSettings.confirm_move_to_trash)} />
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Confirm Move to Trash</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">Prompt for confirmation before moving chats to the recycle bin</p>
                          </div>
                        </div>
                      )}
                    </section>
                  </div>
                )}

                {/* ── Learning ── */}
                {activeTab === "learning" && (
                  <div className="flex flex-col gap-8">
                    <section className="space-y-3" data-pref-section>
                      <div className="pb-1.5 border-b border-[var(--border-color)] flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] flex items-center gap-1.5">
                            <Sparkles size={11} /> Flashcards
                          </h3>
                          <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                            Aetherium can extract flashcards from your chats so you can review them later.
                          </p>
                        </div>
                        <label className="flex items-center gap-2 text-xs cursor-pointer whitespace-nowrap">
                          <Toggle
                            on={autoGenerateFlashcards}
                            onToggle={() => setAutoGenerateFlashcards(!autoGenerateFlashcards)}
                          />
                          <span className="text-[var(--text-secondary)]">Auto-generate from chats</span>
                        </label>
                      </div>
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Generation model</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {flashcardModel
                              ? `Using ${flashcardModel}`
                              : "Uses the background-job default model."}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveTab("ai")}
                          className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
                        >
                          Configure in AI →
                        </button>
                      </div>
                    </section>

                    <section className="space-y-3" data-pref-section>
                      <div className="pb-1.5 border-b border-[var(--border-color)]">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] flex items-center gap-1.5">
                          <Brain size={11} /> Knowledge
                        </h3>
                        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                          A roadmap of concepts Aetherium has extracted from your workspace. Use it to navigate what you&apos;ve learned and spot gaps.
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <p className="text-xs text-[var(--text-muted)]">
                          The roadmap rebuilds itself as you chat, take notes, and capture sources in the active workspace.
                        </p>
                        <button
                          type="button"
                          onClick={() => navigate("/graph")}
                          className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
                        >
                          Open Knowledge Graph →
                        </button>
                      </div>
                    </section>
                  </div>
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
                {activeTab === "webai" && (
                  <section data-pref-section>
                    <div className="pb-1.5 mb-3 border-b border-[var(--border-color)] flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Manual Browser Targets</h3>
                        <p className="text-xs text-[var(--text-muted)]/80 mt-1">
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
                        <div className="grid grid-cols-[minmax(0,1fr)_60px_60px] items-center gap-3 px-4 py-2.5 bg-[var(--bg-hover)]/30 border-b border-[var(--border-color)] text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                          <span>Model</span>
                          <span className="text-center">Active</span>
                          <span className="text-center">Visible</span>
                        </div>
                        <div className="divide-y divide-[var(--border-color)]">
                          {webAiModels.map((m) => {
                            const displayName = resolveModelDisplayName(m.model_id, modelLabels, aiModels);
                            const secondaryDisplayName = resolveModelSecondaryDisplayName(m.model_id, m.provider);
                            return (
                              <div key={m.id} className="px-4 py-3 hover:bg-[var(--bg-hover)]/5 transition-colors">
                                <div className="grid grid-cols-[minmax(0,1fr)_60px_60px] items-center gap-3">
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
                                    <Tooltip content={m.is_hidden ? "Show in Chat" : "Hide from Chat"}>
                                      <button
                                        onClick={async () => {
                                          await api.aiModel.update(m.id, { is_hidden: !m.is_hidden });
                                          loadAiModels();
                                          incrementModelRefreshCounter();
                                        }}
                                        className={`p-1 transition-colors ${m.is_hidden ? "text-[var(--text-muted)] hover:text-[var(--text-primary)]" : "text-[var(--accent-color)] hover:opacity-80"}`}
                                      >
                                        {m.is_hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                                      </button>
                                    </Tooltip>
                                  </div>
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

                  </section>
                )}

                {/* ── Security ── */}
                {activeTab === "security" && (
                  <>
                    <div className="flex flex-col gap-8">
                    {/* Left Column: Enable & Unlock Options */}
                    <div className="space-y-8">
                      {/* ── Require PIN on launch ── */}
                      <section className="space-y-3" data-pref-section>
                        <div className="pb-1.5 border-b border-[var(--border-color)]">
                          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">App lock</h3>
                        </div>
                        <div className="flex items-start gap-3 py-0.5">
                          <Toggle
                            on={dbSettings.pin_lock_enabled}
                            onToggle={() => {
                            if (!dbSettings.pin_lock_enabled) {
                            // Enabling — if no PIN exists, show the setup modal
                            if (!pinConfigured) {
                            resetPinForm();
                            setPinMessage(null);
                            setShowPinSetupModal(true);
                            } else {
                            set("pin_lock_enabled", true);
                            }
                            } else {
                            // Disabling
                            set("pin_lock_enabled", false);
                            if (dbSettings.touch_id_enabled) {
                            set("touch_id_enabled", false);
                            }
                            }
                            }}
                            />
                          <div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">Require PIN on launch</p>
                            <p className="text-xs text-[var(--text-muted)] mt-1">
                              {dbSettings.pin_lock_enabled
                                ? "The app will prompt for your PIN (or biometrics) at startup."
                                : "Lock the app with a PIN passcode each time it starts."}
                            </p>
                          </div>
                        </div>

                        {/* ── Biometric ── */}
                        {dbSettings.pin_lock_enabled && biometricAvailable && (
                          <div className="flex items-start gap-3 py-0.5">
                            <Toggle
                              on={dbSettings.touch_id_enabled}
                              onToggle={() => set("touch_id_enabled", !dbSettings.touch_id_enabled)}
                              />
                            <div>
                              <p className="text-sm font-semibold text-[var(--text-primary)]">{biometricLabel}</p>
                              <p className="text-xs text-[var(--text-muted)] mt-1">
                                Use {biometricLabel} as a quick unlock. PIN is always available as a fallback.
                              </p>
                            </div>
                          </div>
                        )}
                      </section>

                      {/* ── Auto-lock ── */}
                      {dbSettings.pin_lock_enabled && (
                        <section className="space-y-3" data-pref-section>
                          <div className="pb-1.5 border-b border-[var(--border-color)]">
                            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Auto-lock</h3>
                            <p className="text-xs text-[var(--text-muted)]/80 mt-1">Automatically lock the app after a period of inactivity.</p>
                          </div>
                          <div className="flex flex-row flex-wrap gap-x-6 gap-y-2 pt-1 font-normal">
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                              <input
                                type="radio"
                                name="auto_lock"
                                checked={dbSettings.auto_lock_minutes === 0}
                                onChange={() => set("auto_lock_minutes", 0)}
                                className="accent-[var(--accent-color)]"
                              />
                              <span className="text-[var(--text-secondary)] font-normal">Off</span>
                            </label>
                            <label className="flex items-center gap-2 text-sm cursor-pointer whitespace-nowrap">
                              <input
                                type="radio"
                                name="auto_lock"
                                checked={dbSettings.auto_lock_minutes > 0}
                                onChange={() => set("auto_lock_minutes", dbSettings.auto_lock_minutes > 0 ? dbSettings.auto_lock_minutes : 5)}
                                className="accent-[var(--accent-color)]"
                              />
                              <span className="text-[var(--text-secondary)] font-normal">Lock after</span>
                              {dbSettings.auto_lock_minutes > 0 && (
                                <span className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    min={1}
                                    max={1440}
                                    value={dbSettings.auto_lock_minutes}
                                    onChange={(e) => {
                                      const val = Number(e.target.value);
                                      if (val > 0) { set("auto_lock_minutes", val); }
                                    }}
                                    className="w-20 px-2 py-1 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                                  />
                                  <span className="text-xs text-[var(--text-secondary)] font-normal">minutes</span>
                                </span>
                              )}
                            </label>
                          </div>
                        </section>
                      )}
                    </div>

                    {/* Right Column: PIN Management */}
                    <div className="space-y-8">
                      {dbSettings.pin_lock_enabled && (
                        <section className="space-y-3" data-pref-section>
                          <div className="pb-1.5 border-b border-[var(--border-color)] flex items-start justify-between gap-4">
                            <div>
                              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">PIN passcode</h3>
                              <p className="text-xs text-[var(--text-muted)]/80 mt-1 max-w-sm">
                                4 to 8 digits. Stored as a hash, never plaintext.
                              </p>
                            </div>
                            <span className="text-[11px] px-2 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                              Active
                            </span>
                          </div>

                          <div>
                            <label className="text-xs text-[var(--text-secondary)] mb-1.5 block font-medium">Current PIN</label>
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

                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label className="text-xs text-[var(--text-secondary)] mb-1.5 block font-medium">New PIN</label>
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
                              <label className="text-xs text-[var(--text-secondary)] mb-1.5 block font-medium">Confirm PIN</label>
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
                            <p className={`text-xs ${pinMessage.type === "success" ? "text-emerald-400" : "text-red-400"}`}>
                              {pinMessage.text}
                            </p>
                          )}

                          <div className="flex flex-wrap gap-2 pt-1">
                            <button
                              onClick={handleSetPin}
                              disabled={pinSaving}
                              className="px-3.5 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-60"
                            >
                              {pinSaving ? "Saving..." : "Update PIN"}
                            </button>
                            <button
                              onClick={handleRemovePin}
                              disabled={pinSaving}
                              className="px-3.5 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
                            >
                              Remove PIN
                            </button>
                          </div>
                        </section>
                      )}
                    </div>
                  </div>

                    {/* ── PIN Setup Modal ── */}
                    {showPinSetupModal && (
                      <div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
                        onClick={() => { setShowPinSetupModal(false); resetPinForm(); setPinMessage(null); }}
                      >
                        <div
                          className="mx-4 flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex flex-col items-center gap-1">
                            <div className="w-10 h-10 rounded-xl bg-[var(--accent-color)]/20 flex items-center justify-center mb-1">
                              <Lock size={18} className="text-[var(--accent-color)]" />
                            </div>
                            <h2 className="text-base font-semibold text-[var(--text-primary)]">Set a PIN</h2>
                            <p className="text-xs text-[var(--text-muted)] text-center">
                              Create a 4–8 digit PIN to lock the app on launch.
                            </p>
                          </div>

                          <div className="space-y-3">
                            <div>
                              <label className="text-xs text-[var(--text-secondary)] mb-1 block">PIN</label>
                              <input
                                type="password"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                value={newPin}
                                onChange={(e) => { setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setPinMessage(null); }}
                                placeholder="4 to 8 digits"
                                autoFocus
                                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Confirm PIN</label>
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
                            <p className={`text-xs ${pinMessage.type === "success" ? "text-emerald-400" : "text-red-400"}`}>
                              {pinMessage.text}
                            </p>
                          )}

                          <div className="flex gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => { setShowPinSetupModal(false); resetPinForm(); setPinMessage(null); }}
                              disabled={pinSaving}
                              className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleSetPinFromModal}
                              disabled={pinSaving}
                              className="flex-1 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-60"
                            >
                              {pinSaving ? "Saving..." : "Enable Lock"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ── Sync ── */}
                {activeTab === "sync" && (
                  <section className="space-y-3" data-pref-section>
                    <div className="pb-1.5 border-b border-[var(--border-color)]">
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Multi-device Sync</h3>
                      <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                        Sync your chats, memories, and settings across devices using a private Git remote.
                        Requires a private repository (GitHub, GitLab, or any SSH-accessible bare repo) and
                        Git installed on this machine.
                      </p>
                    </div>

                    <div className="flex items-center justify-between py-1 border-t border-[var(--border-color)] pt-4">
                      <div>
                        <p className="text-sm font-semibold text-[var(--text-secondary)]">Enable sync</p>
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

                          } catch (e: unknown) {
                            setGitSync((s) => s ? { ...s, last_error: String(e) } : s);
                          } finally {
                            setGitSyncSaving(false);
                          }
                        }}
                      />
                    </div>

                    <div className="border-t border-[var(--border-color)] pt-4 space-y-2">
                      <label className="text-xs text-[var(--text-secondary)] block font-medium">Remote URL</label>
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

                            } catch (e: unknown) {
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
                      <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                        SSH remote required. Use `git@...` or `ssh://...` and ensure your key is loaded in `ssh-agent`.
                      </p>
                      {gitSyncUrl.trim() && !isGitSyncSshUrl && (
                        <p className="text-[11px] text-amber-400 mt-1">
                          Git sync only accepts SSH remotes.
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between py-1 border-t border-[var(--border-color)] pt-4">
                      <div>
                        <p className="text-xs text-[var(--text-muted)]">Last synced</p>
                        <p className="text-sm font-semibold text-[var(--text-secondary)] mt-0.5">
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

                          } catch (e: unknown) {
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
                  </section>
                )}

                </div>
            </PreferencesSplitLayout>
          )}

          {activeTab === "scheduled-tasks" && (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="max-w-4xl px-5 py-4">
                <ScheduledTasksCard
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

          {/* ── Full-bleed tabs (workspaces, backup, import) ── */}
          {activeTab === "workspaces" && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <React.Suspense fallback={null}>
                <WorkspaceSettingsView />
              </React.Suspense>
            </div>
          )}

          {activeTab === "data" && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <DataControlsPreferences />
            </div>
          )}

          {activeTab === "backup" && (
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
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
                </div>
              </div>
            </div>
          )}

          {activeTab === "import" && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <React.Suspense fallback={null}>
                <ImportSettingsSection />
              </React.Suspense>
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
              <React.Suspense fallback={null}>
                <GlobalMemoryView />
              </React.Suspense>
            </div>
          )}

          {activeTab === "mcp" && (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-6">
              <div className="app-container">
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
