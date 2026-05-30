/**
 * PreferencesView — integrated preferences hub with focused tabs for app,
 * navigation, appearance, chat, AI, security, backup, and workspace controls.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { message } from "@tauri-apps/plugin-dialog";
import { Palette, Bot, ShieldCheck, HardDrive, Trash2, Plus, LayoutGrid, Network, Globe, Pencil, RefreshCw, GitBranch, Settings as SettingsIcon, MessageSquare, FileText, FolderInput, ScrollText, Eye, EyeOff, GripVertical, Pin, Info, Brain, ChevronDown, Lock, GraduationCap, Sparkles, Columns2, ChevronLeft, ChevronRight, BarChart2, Library, History, Search, Paperclip, Send, FileEdit, ArrowUpDown } from "lucide-react";
import { api, type AppSettings, type AiModel, type MCPServerConfig, type GitSyncStatus, type SecurityStatus, type OllamaModel, type SystemSpecs, type ModelSpeedStat } from "../lib/api";
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
import { usePrefsWindowMode } from "../lib/prefsWindowMode";

const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 22;
const DEFAULT_FONT_SIZE = 16;

const TABS: { id: PreferencesSection; label: string; Icon: React.ElementType }[] = [
  { id: "app", label: "App", Icon: SettingsIcon },
  { id: "navigation", label: "Navigation", Icon: LayoutGrid },
  { id: "appearance", label: "Appearance", Icon: Palette },
  { id: "chat", label: "Chat", Icon: MessageSquare },
  { id: "learning", label: "Learning", Icon: GraduationCap },
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

// ──────────────────────────────────────────────────────────────────────────────

function LiveAppPreview({ dbSettings, overrides = {} }: {
  dbSettings: AppSettings;
  overrides?: {
    theme?: string | null;
    accentColor?: string | null;
    fontSize?: number | null;
    workspaceNavigation?: NavigationPresentation | null;
    sectionNavigation?: NavigationPresentation | null;
    workspaceSortOrder?: string | null;
    chatMessageStyle?: ChatMessageStyle | null;
    composerMode?: string | null;
  };
}) {
  const dbWorkspaceNavigation = useWorkspaceStore((s) => s.workspaceNavigation);
  const dbSectionNavigation = useWorkspaceStore((s) => s.sectionNavigation);
  const dbWorkspaceSortOrder = useWorkspaceStore((s) => s.workspaceSortOrder);
  const dbChatMessageStyle = useSettingsStore((s) => s.chatMessageStyle);
  const dbComposerMode = useSettingsStore((s) => s.composerMode);

  const workspaceNavigation = overrides.workspaceNavigation !== undefined && overrides.workspaceNavigation !== null ? overrides.workspaceNavigation : dbWorkspaceNavigation;
  const sectionNavigation = overrides.sectionNavigation !== undefined && overrides.sectionNavigation !== null ? overrides.sectionNavigation : dbSectionNavigation;
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

  const [hoveredTerm, setHoveredTerm] = useState(false);

  const showLeftSidebar = workspaceNavigation === "sidebar";
  const themeClass = `theme-${overrides.theme !== undefined && overrides.theme !== null ? overrides.theme : dbSettings.theme || "system"}`;
  const accentColor = overrides.accentColor !== undefined && overrides.accentColor !== null ? overrides.accentColor : dbSettings.accent_color || "#007AFF";
  const fontSize = overrides.fontSize !== undefined && overrides.fontSize !== null ? overrides.fontSize : dbSettings.font_size || 14;
  const scaledFontSize = Math.max(9, Math.min(20, Math.round(fontSize * 0.9)));

  const mockWorkspaces = useMemo(() => {
    const list = [
      { id: "ws-1", name: "Aetherium Docs", created: 100, updated: 300, lastMsg: 500 },
      { id: "ws-2", name: "Deep Learning", created: 200, updated: 100, lastMsg: 200 },
      { id: "ws-3", name: "Personal Notes", created: 300, updated: 200, lastMsg: 400 },
    ];
    return [...list].sort((a, b) => {
      switch (workspaceSortOrder) {
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "created-newest":
          return b.created - a.created;
        case "created-oldest":
          return a.created - b.created;
        case "updated-newest":
          return b.updated - a.updated;
        case "updated-oldest":
          return a.updated - b.updated;
        case "last-message-newest":
          return b.lastMsg - a.lastMsg;
        default:
          return 0;
      }
    });
  }, [workspaceSortOrder]);

  const activeWorkspaceName = mockWorkspaces[0]?.name || "Workspace A";

  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3 flex items-center gap-1.5 self-start">
        <span>Live App Preview</span>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
      </div>

      {/* Simulated Desktop Container */}
      <div className="w-full flex flex-col items-center justify-center bg-[var(--bg-secondary)]/35 rounded-2xl p-4 border border-[var(--border-color)]/60 shadow-inner">
        {/* Mock macOS Menubar */}
        <div className="w-full h-6 bg-[var(--bg-sidebar)]/80 text-[var(--text-muted)] text-[10px] px-3 rounded-t-xl flex justify-between items-center select-none border-t border-x border-[var(--border-color)]">
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
          className={`${themeClass} relative flex flex-col w-full h-[360px] 2xl:h-[420px] 3xl:h-[500px] rounded-b-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-2xl overflow-hidden select-none`}
          style={{
            "--accent-color": accentColor,
            "--accent-color-rgb": hexToRgb(accentColor),
            fontSize: `${scaledFontSize}px`,
          } as React.CSSProperties}
        >
          {/* Simulated Window Titlebar */}
          <div className="h-10 flex items-center justify-between px-3 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] shrink-0 select-none">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F56] opacity-80" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E] opacity-80" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#27C93F] opacity-80" />
            </div>

            <div className="flex items-center gap-2 max-w-[65%] truncate h-full">
              <div className="flex items-center gap-1 opacity-70">
                <ChevronLeft size={12} className="text-[var(--text-secondary)]" />
                <ChevronRight size={12} className="text-[var(--text-muted)]" />
              </div>

              {workspaceNavigation === "top-dropdown" ? (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[9px] text-[var(--text-primary)] font-medium">
                  <span>{activeWorkspaceName}</span>
                  <ChevronDown size={8} className="text-[var(--text-muted)]" />
                </div>
              ) : workspaceNavigation === "top-tabs" ? (
                <div className="flex gap-1 items-end relative -bottom-[1px] h-full" data-no-drag>
                  {mockWorkspaces.map((ws, index) => (
                    <div
                      key={ws.id}
                      className={`text-[8.5px] px-2 py-0.5 rounded-t-md border border-b-0 border-[var(--border-color)] select-none whitespace-nowrap cursor-pointer transition-all ${
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
                <span className="text-[10px] font-semibold text-[var(--text-primary)] truncate">{activeWorkspaceName}</span>
              )}

              {sectionNavigation === "top-dropdown" && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[9px] text-[var(--text-secondary)] font-medium">
                  <span>Chat</span>
                  <ChevronDown size={8} className="text-[var(--text-muted)]" />
                </div>
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
            </div>
          </div>

          {/* Row 2: Sub-workspace tabs for the active parent workspace (child workspaces) */}
          {(workspaceNavigation === "top-tabs" || workspaceNavigation === "top-dropdown") && (
            <div className="h-7 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/90 px-3 flex items-center justify-between shrink-0 select-none">
              <div className="flex items-center gap-1.5 h-full">
                {/* Pinned overview indicator */}
                <div className="flex h-[22px] w-5 items-center justify-center self-end rounded-t border border-b-0 border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer">
                  <svg width="4" height="4" viewBox="0 0 6 6" className="fill-current opacity-80 shrink-0"><circle cx="3" cy="3" r="3" /></svg>
                </div>
                {[
                  "React", "Frontend", "Linux", "Python", "Git", "Databases", "C", "Binary", "Rust"
                ].map((name) => {
                  const isActive = name === "Frontend";
                  return (
                    <div
                      key={name}
                      className={`relative flex h-[22px] items-center self-end rounded-t border border-b-0 px-2 text-[8px] font-medium whitespace-nowrap cursor-pointer transition-all select-none ${
                        isActive
                          ? "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-semibold"
                          : "border-transparent text-[var(--text-secondary)] opacity-60 hover:opacity-100 hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute inset-x-1.5 top-0 h-0.5 rounded-full bg-[var(--accent-color)]" />
                      )}
                      {name}
                    </div>
                  );
                })}
                <button className="h-4 w-4 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] rounded flex items-center justify-center mb-0.5">
                  <Plus size={8} />
                </button>
              </div>
            </div>
          )}

          {!showLeftSidebar && sectionNavigation === "top-tabs" && (
            <div className="h-8 flex items-center gap-2 px-3 bg-[var(--bg-sidebar)] border-b border-[var(--border-color)] shrink-0">
              <span className="text-[9px] font-semibold text-[var(--accent-color)] border-b border-[var(--accent-color)] px-1 py-0.5">Chat</span>
              <span className="text-[9px] font-semibold text-[var(--text-muted)] px-1 py-0.5">Notes</span>
              <span className="text-[9px] font-semibold text-[var(--text-muted)] px-1 py-0.5">Knowledge</span>
            </div>
          )}

          <div className="flex flex-1 min-h-0 overflow-hidden">
            {workspaceNavigation === "sidebar" && (
              <div className="w-[85px] shrink-0 bg-[var(--bg-sidebar)] border-r border-[var(--border-color)] p-1 flex flex-col gap-0.5" data-testid="single-pane-workspace-sidebar">
                <div className="text-[7px] uppercase tracking-wider text-[var(--text-muted)] font-bold px-1.5 py-0.5 opacity-60 mb-0.5">Workspaces</div>
                {mockWorkspaces.map((ws, index) => (
                  <div
                    key={ws.id}
                    className={`px-1.5 py-0.5 rounded text-[8px] truncate leading-tight select-none ${
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
                        className={`flex flex-col items-center justify-center w-full py-1 rounded-lg text-[7px] transition-colors select-none ${
                          item.active
                            ? "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)] font-semibold"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/50"
                        }`}
                      >
                        <Icon size={12} strokeWidth={1.5} className="mb-0.5" />
                        <span className="text-[6.5px] scale-[0.9] origin-center truncate w-full text-center">{item.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-col items-center gap-1 w-full px-1 pt-1.5 border-t border-[var(--border-color)]/60">
                  <div className="text-[var(--text-secondary)] text-[7px] flex items-center justify-center gap-0.5 hover:bg-[var(--bg-hover)] w-full py-0.5 rounded cursor-pointer scale-[0.85]">
                    <ChevronLeft size={8} />
                    <span>Collapse</span>
                  </div>
                  <div className="w-5 h-5 rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-primary)] cursor-pointer">
                    <SettingsIcon size={10} strokeWidth={1.5} />
                  </div>
                  <div className="w-6 h-6 rounded-lg bg-[var(--accent-color)] text-white text-[9px] font-bold flex items-center justify-center shadow-sm select-none cursor-pointer mt-0.5">
                    A
                  </div>
                </div>
              </div>
            )}

            {/* Chat Session List Pane (Sub-sidebar) */}
            <div className="w-[105px] shrink-0 bg-[var(--bg-sidebar)]/40 border-r border-[var(--border-color)] p-1.5 flex flex-col gap-1.5 select-none" data-testid="chat-sessions-list">
              <div className="flex items-center justify-between px-1">
                <span className="text-[8px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Chats</span>
                <div className="flex gap-0.5 text-[8px] text-[var(--text-muted)]">
                  <ArrowUpDown size={8} />
                  <Pencil size={8} />
                </div>
              </div>
              <div className="flex items-center gap-1 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]/60 px-1 py-0.5 text-[8px] text-[var(--text-muted)]">
                <Search size={8} className="shrink-0" />
                <span className="truncate">Search...</span>
              </div>
              <div className="flex flex-col gap-0.5 overflow-y-auto max-h-[220px]">
                {[
                  { title: "SPAs: Advantages and Challenges", active: true },
                  { title: "Flexbox CSS Basics", active: false },
                  { title: "NPM sudo permissions", active: false },
                  { title: "Inner HTML discussion", active: false },
                  { title: "React getting started", active: false },
                ].map((s, idx) => (
                  <div
                    key={idx}
                    className={`px-1.5 py-1 rounded text-[8px] truncate leading-tight select-none cursor-pointer ${
                      s.active
                        ? "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)] font-semibold border-l-2 border-[var(--accent-color)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/30"
                    }`}
                  >
                    {s.title}
                  </div>
                ))}
              </div>
              <div className="text-[7.5px] text-[var(--text-muted)] mt-auto pt-1 border-t border-[var(--border-color)]/40">
                5 sessions
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-primary)] overflow-hidden">
              {/* Chat View Pane Header */}
              <div className="h-8.5 px-3 border-b border-[var(--border-color)]/60 bg-[var(--bg-primary)] flex items-center justify-between shrink-0 select-none">
                <div className="flex flex-col min-w-0">
                  <span className="text-[6.5px] font-bold text-[var(--text-muted)] uppercase tracking-wider leading-none mb-0.5">FRONTEND</span>
                  <span className="text-[9px] font-semibold text-[var(--text-primary)] truncate">SPAs: Advantages and Challenges</span>
                </div>
                <div className="flex items-center gap-1 text-[8.5px] text-[var(--text-secondary)] font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span>7b | 8.2s</span>
                </div>
              </div>

              {/* Related link pills list below header */}
              <div className="h-6.5 px-3 bg-[var(--bg-elevated)]/25 border-b border-[var(--border-color)]/30 flex items-center gap-2 shrink-0 overflow-x-hidden text-[7.5px] select-none">
                <span className="font-bold text-[var(--text-muted)] text-[7px] uppercase tracking-wider shrink-0">RELATED</span>
                {[
                  "Inner HTML discussion", "Flexbox CSS Basics", "React getting started"
                ].map((lnk) => (
                  <span key={lnk} className="px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-color)]/40 text-[var(--text-secondary)] hover:text-[var(--accent-color)] cursor-pointer whitespace-nowrap">
                    {lnk}
                  </span>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3 flex flex-col min-h-0 justify-end relative">
                <div className={`flex flex-col gap-0.5 ${
                  chatMessageStyle === "minimal" ? "items-start" : "items-end"
                }`}>
                  {chatMessageStyle === "minimal" && (
                    <span className="text-[8px] font-semibold text-[var(--text-muted)] tracking-wide">
                      {dbSettings.user_chat_label || "You"}
                    </span>
                  )}
                  <div
                    className={`text-[11px] break-words ${
                      chatMessageStyle === "minimal"
                        ? "w-full py-0.5 text-[var(--text-primary)]"
                        : chatMessageStyle === "flat"
                          ? "w-fit max-w-[85%] rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-[var(--text-primary)]"
                          : "w-fit max-w-[85%] rounded-lg rounded-tr-sm bg-[var(--accent-color)] text-white px-2 py-1"
                    }`}
                  >
                    What are single-page applications (SPAs)?
                  </div>
                </div>

                <div className="flex flex-col gap-0.5 items-start">
                  {chatMessageStyle === "minimal" && (
                    <span className="text-[8px] font-semibold text-[var(--text-muted)] tracking-wide">
                      {dbSettings.assistant_chat_label || "Assistant"}
                    </span>
                  )}
                  <div
                    className={`text-[11px] break-words relative ${
                      chatMessageStyle === "minimal"
                        ? "w-full py-0.5 text-[var(--text-primary)]"
                        : chatMessageStyle === "flat"
                          ? "w-full rounded border-l border-[var(--accent-color)] bg-[var(--bg-elevated)]/40 px-2 py-1 text-[var(--text-primary)]"
                          : "w-full rounded-lg rounded-tl-sm bg-[var(--bg-secondary)] px-2 py-1 text-[var(--text-primary)]"
                    }`}
                  >
                    {dbSettings.hover_definition_scan_enabled ? (
                      <span>
                        Single-page applications (
                        <span
                          onMouseEnter={() => setHoveredTerm(true)}
                          onMouseLeave={() => setHoveredTerm(false)}
                          className="underline decoration-dotted decoration-[var(--accent-color)] underline-offset-2 cursor-help font-semibold"
                        >
                          SPAs
                        </span>
                        ) are a type of web application that loads a single HTML page and dynamically updates content.
                      </span>
                    ) : (
                      "Single-page applications (SPAs) are a type of web application that loads a single HTML page and dynamically updates content."
                    )}

                    {hoveredTerm && dbSettings.hover_definition_scan_enabled && (
                      <div className="absolute bottom-full left-4 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-lg p-2 shadow-xl text-[9px] max-w-[200px] z-50 mb-1.5 pointer-events-none">
                        <div className="font-semibold text-[var(--accent-color)]">Glossary: SPAs</div>
                        <p className="text-[var(--text-secondary)] mt-0.5 leading-snug">
                          Single-Page Applications. Loads assets once and updates dynamically via client-side routing.
                        </p>
                      </div>
                    )}
                  </div>

                  {showGenInfo && (
                    <div className="text-[8px] text-[var(--text-muted)] mt-0.5 flex flex-wrap items-center gap-1 select-none pl-0.5">
                      {showGenInfoModel && <span>gemma2-9b</span>}
                      {showGenInfoModel && (showGenInfoTokenCount || showGenInfoDuration || showGenInfoSpeed) && <span>•</span>}
                      {showGenInfoTokenCount && <span>120 tok</span>}
                      {showGenInfoTokenCount && (showGenInfoDuration || showGenInfoSpeed) && <span>•</span>}
                      {showGenInfoDuration && <span>2.5s</span>}
                      {showGenInfoDuration && showGenInfoSpeed && <span>•</span>}
                      {showGenInfoSpeed && <span className="text-[var(--accent-color)] font-medium">48 tok/s</span>}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-2 border-t border-[var(--border-color)] bg-[var(--bg-primary)] shrink-0 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-1 overflow-x-hidden">
                  <div className="flex gap-1 overflow-x-hidden relative items-center py-0.5 select-none">
                    {showComposerWorkspaceSuggestions && (
                      <span className="text-[7.5px] px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] whitespace-nowrap truncate max-w-[120px]">
                        {"What's the best frontend framework?"}
                      </span>
                    )}
                    {showComposerChatFollowUps && (
                      <>
                        <span className="text-[7.5px] px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] whitespace-nowrap truncate max-w-[120px]">
                          How do I create a responsive layout?
                        </span>
                        <span className="text-[7.5px] px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] whitespace-nowrap flex items-center gap-0.5 truncate max-w-[120px]">
                          What are some popular CSS frameworks... <ChevronDown size={8} />
                        </span>
                      </>
                    )}
                  </div>

                  {dbSettings.memory_enabled && (
                    <div className="flex items-center gap-0.5 text-[8px] font-medium text-[var(--accent-color)] shrink-0 bg-[var(--accent-color)]/10 px-1 rounded">
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
                  <div className="flex-1 text-[9.5px] text-[var(--text-muted)] font-normal truncate">
                    Continue this thread...
                  </div>
                  {composerMode === "family" ? (
                    <div className="flex gap-1 items-center shrink-0 pr-1">
                      <span className="text-[7.5px] text-[var(--text-muted)]">Family</span>
                      <button
                        type="button"
                        className="h-4.5 px-1.5 rounded bg-[var(--accent-color)] text-white flex items-center justify-center shadow-sm text-[8px] font-bold"
                      >
                        7b
                      </button>
                      <button
                        type="button"
                        className="h-4.5 px-1.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)] flex items-center justify-center shadow-sm text-[8px] font-bold"
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
            <div className="h-5 px-2 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between text-[8px] text-[var(--text-muted)] shrink-0 select-none">
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

// ──────────────────────────────────────────────────────────────────────────────

export default function PreferencesView() {
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

  const [hoverOverrides, setHoverOverrides] = useState<{
    theme?: string | null;
    accentColor?: string | null;
    fontSize?: number | null;
    workspaceNavigation?: NavigationPresentation | null;
    sectionNavigation?: NavigationPresentation | null;
    workspaceSortOrder?: string | null;
    chatMessageStyle?: ChatMessageStyle | null;
    composerMode?: string | null;
  }>({});

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
    api.settings.get().then((s) => {
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

  const settingsTabButtons = (
    <div className={settingsNavLayout === "top-tabs" ? "flex gap-1.5 overflow-x-auto pb-0.5" : "flex flex-col gap-1.5"}>
      {TABS.map(({ id, label, Icon }, idx) => (
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
        <div className="grid grid-cols-[minmax(0,1fr)_100px_120px_120px_60px_60px] items-center gap-3 px-4 py-2.5 bg-[var(--bg-hover)]/30 border-b border-[var(--border-color)] text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
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
                    <div className="flex flex-col gap-2 md:grid md:grid-cols-[minmax(0,1fr)_100px_120px_120px_60px_60px] md:items-start md:gap-3">
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
                            className={`flex items-center justify-center md:w-[100px] ${canBeBackgroundModel ? "cursor-pointer text-[var(--text-secondary)]" : "cursor-not-allowed text-[var(--text-muted)] opacity-60"
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
                      {!isOllamaModel && <div className="hidden md:block md:w-[100px]" />}

                      <div className="text-right text-[10px] leading-5 text-[var(--text-muted)] md:w-[120px]">
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

                      <div className="flex justify-center pt-0.5 md:w-[120px]">
                        {!isWebModel && !m.id.startsWith("transient-") && (
                          <ContextSizeInput
                            modelName={m.name}
                            savedValue={m.context_size ?? null}
                            onSave={async (next) => { await api.aiModel.update(m.id, { context_size: next }); loadAiModels(); }}
                            onClear={async () => { await api.aiModel.update(m.id, { context_size: null }); loadAiModels(); }}
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

      {(() => {
        const eligibleModels = aiModels.filter((m) => m.provider === "ollama" && m.enabled);
        const jobs: { key: keyof AppSettings; label: string; tokens: string; note: string }[] = [
          { key: "memory_extraction_model", label: "Memory Extraction", tokens: "~200–1,000 tokens input", note: "2k context OK" },
          { key: "summarization_model", label: "Summarization", tokens: "~500–5,000 tokens input", note: "≥4k context recommended" },
          { key: "flashcard_model", label: "Flashcard Generation", tokens: "~100–200 tokens input", note: "2k context OK" },
          { key: "glossary_model", label: "Workspace Glossary", tokens: "~800–2,000 tokens input", note: "≥4k context recommended" },
          { key: "topic_signature_model", label: "Topic Signatures", tokens: "~1,000–3,000 tokens input", note: "≥4k context recommended" },
          { key: "goal_suggestion_model", label: "Goal Suggestion", tokens: "~300–1,500 tokens input", note: "2k context OK" },
        ];
        const options = [
          { value: "", label: "Default (background model)" },
          ...eligibleModels.map((m) => ({
            value: m.model_id,
            label: resolveModelDisplayName(m.model_id, modelLabels, aiModels),
          })),
        ];
        return (
          <div className="rounded-lg border border-[var(--border-color)]/60 bg-[var(--bg-primary)]/40 p-3.5 space-y-3">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Background Tasks</h4>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Background tasks work best with smaller, faster models. The token ranges below show how much context each job typically needs — pick a model whose context window comfortably exceeds it. Leave a row on “Default” to fall back to BG Default → preferred model.
              </p>
            </div>
            <div className="divide-y divide-[var(--border-color)]/60">
              {jobs.map((job) => {
                const selected = (dbSettings[job.key] as string) ?? "";
                const selectedModel = selected ? eligibleModels.find((m) => m.model_id === selected) : null;
                const ollamaMeta = selectedModel ? ollamaModels.find((om) => om.name === selectedModel.model_id) : null;
                const modelParams = selectedModel
                  ? parseModelParamsB(selectedModel.model_id)
                    ?? parseModelParamsB(selectedModel.name)
                    ?? parseModelParamsB(ollamaMeta?.details?.parameter_size ?? "")
                  : null;
                const formattedParams = modelParams != null ? formatParams(modelParams) : null;
                const fit = systemGuidance
                  ? classifyModelFit(modelParams, systemGuidance.recommendedMaxParamsB)
                  : "unknown";
                const fitMeta = getModelFitMeta(fit);
                return (
                  <div key={String(job.key)} className="grid grid-cols-[minmax(0,1fr)_220px] items-center gap-3 py-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[var(--text-primary)]">{job.label}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--text-muted)]">
                        <span>{job.tokens}</span>
                        <span>•</span>
                        <span>{job.note}</span>
                        {selectedModel && (formattedParams || fitMeta.label) && (
                          <>
                            <span>•</span>
                            {formattedParams && <span>{formattedParams}</span>}
                            {formattedParams && fitMeta.label && <span>•</span>}
                            {fitMeta.label && <span className={`font-medium ${fitMeta.textClassName}`}>{fitMeta.label}</span>}
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <CompactMenuSelect
                        label={job.label}
                        value={selected}
                        options={options}
                        onChange={(value) => set(job.key, value as never)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
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

        <div className={`flex-1 min-h-0 overflow-hidden flex ${
          ["app", "navigation", "appearance", "ai", "chat", "learning", "webai", "security", "sync"].includes(activeTab)
            ? "flex-row"
            : "flex-col"
        }`}>
          {["app", "navigation", "appearance", "ai", "chat", "learning", "webai", "security", "sync"].includes(activeTab) && (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                <div className="max-w-5xl space-y-5">
                  {activeTab === "app" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                    <div className="space-y-4">
                      {/* Startup & background */}
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

                        <div className="flex items-center justify-between py-0.5">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm text-[var(--text-secondary)]">Single window mode</p>
                              <Pin size={12} className={singleWindowMode ? "text-[var(--accent-color)]" : "text-[var(--text-muted)]"} />
                            </div>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              Prevent multiple preferences windows from opening simultaneously.
                            </p>
                          </div>
                          <Toggle
                            on={singleWindowMode}
                            onToggle={toggleSingleWindowMode}
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

                      {/* Features */}
                      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-3">
                        <div>
                          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Features</h3>
                          <p className="text-xs text-[var(--text-muted)] mt-1">
                            Enable or disable optional features across Aetherium.
                          </p>
                        </div>

                        <div className="flex items-center justify-between py-0.5">
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Memory</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              Store and use persistent facts and preferences across conversations
                            </p>
                          </div>
                          <Toggle
                            on={dbSettings.memory_enabled}
                            onToggle={() => set("memory_enabled", !dbSettings.memory_enabled)}
                          />
                        </div>
                      </div>

                      {/* Shortcut */}
                      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-3">
                        <div>
                          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Shortcut</h3>
                          <p className="text-xs text-[var(--text-muted)] mt-1">
                            Set the global accelerator used to open quick search from anywhere.
                          </p>
                        </div>
                        <ShortcutRecorder
                          value={quickSearchShortcutDraft}
                          onChange={setQuickSearchShortcutDraft}
                          onCommit={(v) => set("quick_search_shortcut", v)}
                          placeholder={isMac ? "Cmd+Shift+K" : "Ctrl+Shift+K"}
                        />
                      </div>
                    </div>

                    {/* Background Jobs */}
                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Background Jobs</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Configure automatic background processing tasks like memory extraction and summarization.
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Enable background inference</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Run memory extraction, summarization, and glossary jobs automatically. Disable to reduce GPU/RAM usage when the app is idle.
                          </p>
                        </div>
                        <Toggle
                          on={dbSettings.background_inference_enabled}
                          onToggle={() => set("background_inference_enabled", !dbSettings.background_inference_enabled)}
                        />
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
                          min={4}
                          max={100}
                          value={dbSettings.summarization_min_messages}
                          onChange={(e) => set("summarization_min_messages", Math.max(4, Math.min(100, Number(e.target.value) || 10)))}
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
                      <div className="flex items-center justify-between py-0.5">
                        <div>
                          <p className="text-sm text-[var(--text-secondary)]">Chat definition scan</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Scan assistant replies for unresolved workspace terminology after glossary refresh
                          </p>
                        </div>
                        <Toggle
                          on={dbSettings.hover_definition_scan_enabled}
                          onToggle={() => set("hover_definition_scan_enabled", !dbSettings.hover_definition_scan_enabled)}
                        />
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

                      <div className="border-t border-[var(--border-color)] pt-3">
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
                    </div>
                  </div>
                )}

                {/* ── Navigation ── */}
                {activeTab === "navigation" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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
                    </div>
                  </div>
                )}

                {/* ── Appearance ── */}
                {activeTab === "appearance" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                    {/* Theme & Accent Card */}
                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Theme & Accent</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Personalize the color scheme and main highlights of the interface.
                        </p>
                      </div>

                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">Theme</label>
                        <div className="flex flex-wrap gap-2">
                          {THEMES.map((t) => (
                            <button
                              key={t}
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
                    </div>

                    {/* Typography & Interface Card */}
                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Typography & Interface</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
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
                    </div>
                  </div>
                )}

                {/* ── AI / Ollama ── */}
                {activeTab === "ai" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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
                              <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">
                                {systemSpecs.os_name.toLowerCase().includes("mac") && ["aarch64", "arm64"].includes(systemSpecs.cpu_arch.toLowerCase())
                                  ? "Tell Aetherium how much of the unified memory pool the desktop and other apps already hold so model-fit suggestions reflect what is actually usable."
                                  : "Tell Aetherium how much VRAM and RAM the desktop and other apps already hold so model-fit suggestions reflect what is actually usable. The larger of GB and % is applied per pool."}
                              </p>
                              <p className="mt-1 text-[10px] text-[var(--text-secondary)]">
                                Check current usage: macOS — Activity Monitor (Memory / GPU History) · Linux NVIDIA — <code>nvidia-smi</code> or <code>nvtop</code> · Linux AMD — <code>radeontop</code>, <code>rocm-smi</code>, or Mission Center · Linux Intel — <code>intel_gpu_top</code> · Windows — Task Manager → Performance → GPU.
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

                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Local inference providers</h3>
                          <p className="text-xs text-[var(--text-muted)] mt-1">
                            Configure your local inference engines. Use the default local server for a standard experience, or enable MLX and llama.cpp for optimized hardware performance.
                          </p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Auto-start Ollama</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              Automatically start the Ollama server when the app launches.
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

                  </div>
                  {ollamaModelsSection}
                </div>
              )}

                {/* ── Chat ── */}
                {activeTab === "chat" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                    {/* Card 1: Chat Layout & Preview */}
                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Chat Layout & Preview</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
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

                        {/* Live preview */}
                        <div className="mt-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 space-y-3 overflow-hidden">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Preview</p>
                          {/* User message */}
                          <div className={`flex flex-col gap-0.5 ${
                            chatMessageStyle === "minimal" ? "items-start" : "items-end"
                          }`}>
                            {chatMessageStyle === "minimal" && (
                              <span className="text-[10px] font-semibold text-[var(--text-muted)] tracking-wide">{dbSettings.user_chat_label || "You"}</span>
                            )}
                            <div className={`text-xs ${
                              chatMessageStyle === "minimal"
                                ? "w-full py-1 text-[var(--text-primary)]"
                                : chatMessageStyle === "flat"
                                  ? "w-fit rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[var(--text-primary)]"
                                  : "w-fit rounded-2xl rounded-tr-sm message-user px-3 py-1.5"
                            }`}>
                              What is the speed of light?
                            </div>
                          </div>
                          {/* Assistant message */}
                          <div className={`flex flex-col gap-0.5 ${
                            chatMessageStyle === "minimal" ? "items-start" : "items-start"
                          }`}>
                            {chatMessageStyle === "minimal" && (
                              <span className="text-[10px] font-semibold text-[var(--text-muted)] tracking-wide">{dbSettings.assistant_chat_label || "Assistant"}</span>
                            )}
                            <div className={`text-xs ${
                              chatMessageStyle === "minimal"
                                ? "w-full py-1 text-[var(--text-primary)]"
                                : chatMessageStyle === "flat"
                                  ? "w-full rounded border-l-2 border-[var(--accent-color)]/40 bg-transparent px-3 py-1.5 text-[var(--text-primary)]"
                                  : "w-full rounded-2xl rounded-tl-sm message-assistant px-3 py-1.5"
                            }`}>
                              The speed of light in a vacuum is approximately 299,792,458 meters per second.
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-[var(--border-color)] pt-3 space-y-3">
                        <div className="flex items-center justify-between py-0.5">
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Expand Chat Container</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">Remove the maximum width constraint on the chat area</p>
                          </div>
                          <Toggle on={expandChatToWindowWidth} onToggle={() => setExpandChatToWindowWidth(!expandChatToWindowWidth)} />
                        </div>

                        <div className="flex items-center justify-between py-0.5">
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Scroll Message to Top</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">After sending, scroll so your message appears at the top of the view</p>
                          </div>
                          <Toggle on={scrollToTopOnSend} onToggle={() => setScrollToTopOnSend(!scrollToTopOnSend)} />
                        </div>
                      </div>
                    </div>

                    {/* Card 2: Composer & Input */}
                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Composer & Input</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
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
                      <div className="border-t border-[var(--border-color)] pt-3">
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">Composer Suggestions</label>
                        <div className="flex flex-col gap-2">
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
                      <div className="border-t border-[var(--border-color)] pt-3">
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
                    </div>

                    {/* Card 3: Metadata & Behavior */}
                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Metadata & Diagnostics</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Configure auto-generated content and performance overlays.
                        </p>
                      </div>

                      {/* Chat Title Auto-Generation */}
                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium font-semibold">Chat Title Auto-Generation</label>
                        <div className="flex flex-col gap-2">
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
                      <div className="border-t border-[var(--border-color)] pt-3 space-y-2">
                        <div className="flex items-center justify-between py-0.5">
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Show Gen Info</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">Display token count, duration, and speed (tok/s) below assistant messages.</p>
                          </div>
                          <Toggle on={showGenInfo} onToggle={() => setShowGenInfo(!showGenInfo)} />
                        </div>
                        {showGenInfo && (
                          <div className="flex flex-col gap-2 ml-4 border-l border-[var(--border-color)] pl-4 py-1">
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
                      <div className="border-t border-[var(--border-color)] pt-3">
                        <div className="flex items-center justify-between py-0.5">
                          <div>
                            <p className="text-sm text-[var(--text-secondary)]">Show Status Bar</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">Display the system status bar (CPU, RAM, active jobs) at the bottom of the window</p>
                          </div>
                          <Toggle on={showStatusBar} onToggle={() => setShowStatusBar(!showStatusBar)} />
                        </div>
                      </div>
                    </div>

                    {/* Card 4: Safety & Deletion */}
                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Safety & Deletion</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Configure safety prompts and permanent deletion options.
                        </p>
                      </div>

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
                    </div>
                  </div>
                )}

                {/* ── Learning ── */}
                {activeTab === "learning" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                            <Sparkles size={14} /> Flashcards
                          </h3>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
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
                      <div className="flex items-center justify-between gap-3 pt-2 border-t border-[var(--border-color)]">
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
                    </div>

                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                          <Brain size={14} /> Knowledge
                        </h3>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          A roadmap of concepts Aetherium has extracted from your workspace. Use it to navigate what you&apos;ve learned and spot gaps.
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3 pt-2 border-t border-[var(--border-color)]">
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
                    </div>
                  </div>
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

                  </>
                )}

                {/* ── Security ── */}
                {activeTab === "security" && (
                  <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                    {/* Left Column: Enable & Unlock Options */}
                    <div className="space-y-4">
                      {/* ── Require PIN on launch ── */}
                      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 py-3.5">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">Require PIN on launch</p>
                            <p className="text-xs text-[var(--text-muted)] mt-1">
                              {dbSettings.pin_lock_enabled
                                ? "The app will prompt for your PIN (or biometrics) at startup."
                                : "Lock the app with a PIN passcode each time it starts."}
                            </p>
                          </div>
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
                        </div>
                      </div>

                      {/* ── Biometric ── */}
                      {dbSettings.pin_lock_enabled && biometricAvailable && (
                        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 py-3.5">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-semibold text-[var(--text-primary)]">{biometricLabel}</p>
                              <p className="text-xs text-[var(--text-muted)] mt-1">
                                Use {biometricLabel} as a quick unlock. PIN is always available as a fallback.
                              </p>
                            </div>
                            <Toggle
                              on={dbSettings.touch_id_enabled}
                              onToggle={() => set("touch_id_enabled", !dbSettings.touch_id_enabled)}
                            />
                          </div>
                        </div>
                      )}

                      {/* ── Auto-lock ── */}
                      {dbSettings.pin_lock_enabled && (
                        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 py-3.5 space-y-3">
                          <div>
                            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Auto-lock</h3>
                            <p className="text-xs text-[var(--text-muted)] mt-1">Automatically lock the app after a period of inactivity.</p>
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
                        </div>
                      )}
                    </div>

                    {/* Right Column: PIN Management */}
                    <div className="space-y-4">
                      {dbSettings.pin_lock_enabled && (
                        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-3">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-semibold text-[var(--text-primary)]">PIN passcode</p>
                              <p className="text-xs text-[var(--text-muted)] mt-1 max-w-sm">
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
                        </div>
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
                  <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Multi-device Sync</h3>
                      <p className="text-xs text-[var(--text-muted)] mt-1">
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
                  </div>
                )}

                </div>
              </div>

              {/* Right Column: Live App Preview */}
              <div className="hidden xl:flex xl:w-[580px] 2xl:w-[760px] shrink-0 min-h-0 border-l border-[var(--border-color)] bg-[var(--bg-secondary)]/10 flex-col items-center justify-center p-6 select-none overflow-hidden">
                <LiveAppPreview dbSettings={dbSettings} overrides={hoverOverrides} />
              </div>
            </>
          )}

          {/* ── Full-bleed tabs (workspaces, backup, import) ── */}
          {activeTab === "workspaces" && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <React.Suspense fallback={null}>
                <WorkspaceSettingsView />
              </React.Suspense>
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
            <div className="flex-1 overflow-y-auto py-6">
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
