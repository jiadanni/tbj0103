import React, { useMemo, useState } from "react";
import {
  ArrowUpDown,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns2,
  FileEdit,
  GraduationCap,
  History,
  Library,
  MessageSquare,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Search,
  Send,
  Settings as SettingsIcon,
  BarChart2,
} from "lucide-react";
import type { AppSettings } from "../../lib/api";
import { useSettingsStore, type ChatMessageStyle } from "../../stores/settingsStore";
import { type NavigationPresentation, useWorkspaceStore } from "../../stores/workspaceStore";
import { Tooltip } from "../../components/Tooltip";
import { isMac } from "../../lib/platform";
import { usePrefsWindowMode } from "../../lib/prefsWindowMode";

const PREVIEW_PLACEHOLDER_NAMES = [
  "Physics", "Chemistry", "Biology", "Astronomy", "Calculus",
  "Geology", "Optics", "Robotics", "Ecology",
];

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

interface LiveAppPreviewProps {
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
}

function LiveAppPreviewBase({ dbSettings, overrides = {} }: LiveAppPreviewProps) {
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

  const rawWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const storeWorkspaces = useMemo(() => rawWorkspaces || [], [rawWorkspaces]);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId) || null;

  const activeWorkspaceChildren = useMemo(() => {
    if (storeWorkspaces.length === 0) {
      return [];
    }
    return storeWorkspaces.filter((w) => w.parent_workspace_id === activeWorkspaceId);
  }, [storeWorkspaces, activeWorkspaceId]);

  const placeholderNames = PREVIEW_PLACEHOLDER_NAMES;

  const parentWorkspaces = useMemo(() => {
    let list = storeWorkspaces.filter((w) => !w.parent_workspace_id).map((w, i) => ({
      id: w.id,
      name: placeholderNames[i % placeholderNames.length],
      created_at: w.created_at,
      updated_at: w.updated_at,
      index: 0,
    }));

    if (list.length === 0) {
      list = placeholderNames.map((name, i) => ({
        id: `ws-${i + 1}`,
        name,
        created_at: `2026-01-0${i + 1}`,
        updated_at: `2026-05-${30 - i}`,
        index: i + 1,
      }));
    }

    if (workspaceSortOrder === "name-asc") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (workspaceSortOrder === "name-desc") {
      list.sort((a, b) => b.name.localeCompare(a.name));
    } else if (workspaceSortOrder === "created-newest") {
      list.sort((a, b) => (a.index && b.index) ? b.index - a.index : new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    } else if (workspaceSortOrder === "created-oldest") {
      list.sort((a, b) => (a.index && b.index) ? a.index - b.index : new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
    } else if (workspaceSortOrder === "updated-newest" || workspaceSortOrder === "last-message-newest") {
      list.sort((a, b) => (a.index && b.index) ? a.index - b.index : new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
    } else if (workspaceSortOrder === "updated-oldest") {
      list.sort((a, b) => (a.index && b.index) ? b.index - a.index : new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime());
    }

    return list.map((w) => ({ id: w.id, name: w.name }));
  }, [storeWorkspaces, workspaceSortOrder, placeholderNames]);

  const activeWorkspace = useMemo(() => {
    return storeWorkspaces.find((w) => w.id === activeWorkspaceId);
  }, [storeWorkspaces, activeWorkspaceId]);

  const activeWorkspaceName = activeWorkspace?.name || parentWorkspaces[0]?.name || "Physics";

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
          <div className={`h-10 flex items-center justify-between px-3 ${workspaceNavigation === "top-tabs" ? "" : "border-b border-[var(--border-color)]"} bg-[var(--bg-sidebar)] shrink-0 select-none relative`}>
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

              {sectionNavigation === "top-dropdown" && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[0.65em] text-[var(--text-secondary)] font-medium">
                  <span>Chat</span>
                  <ChevronDown size={8} className="text-[var(--text-muted)]" />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                <div className="w-4 h-4 rounded border border-[var(--border-color)] flex items-center justify-center text-[var(--text-secondary)]">
                  <ChevronLeft size={10} />
                </div>
                <div className="w-4 h-4 rounded border border-[var(--border-color)] flex items-center justify-center text-[var(--text-secondary)]">
                  <ChevronRight size={10} />
                </div>
              </div>
              {singleWindowMode && (
                <Tooltip content="Single Window Mode Active" position="bottom">
                  <div className="text-[var(--accent-color)] flex items-center shrink-0">
                    <Pin size={10} className="rotate-45" />
                  </div>
                </Tooltip>
              )}
              <div className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                <ArrowUpDown size={10} />
              </div>
              <div className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                <History size={10} />
              </div>
              <div className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                <SettingsIcon size={10} strokeWidth={1.5} />
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
          {(workspaceNavigation === "top-tabs" || workspaceNavigation === "top-dropdown") && activeWorkspaceChildren.length > 0 && (
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

          {!showLeftSidebar && sectionNavigation === "top-tabs" && (
            <div className="h-8 flex items-center gap-2 px-3 bg-[var(--bg-sidebar)] border-b border-[var(--border-color)] shrink-0">
              <span className="text-[0.65em] font-semibold text-[var(--accent-color)] border-b border-[var(--accent-color)] px-1 py-0.5">Chat</span>
              <span className="text-[0.65em] font-semibold text-[var(--text-muted)] px-1 py-0.5">Notes</span>
              <span className="text-[0.65em] font-semibold text-[var(--text-muted)] px-1 py-0.5">Knowledge</span>
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
                  <div className="w-full flex items-center gap-1 px-1 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)] cursor-pointer">
                    <SettingsIcon size={10} strokeWidth={1.5} className="shrink-0" />
                    <span className="text-[0.6em] font-medium truncate flex-1 text-left">Preferences</span>
                  </div>
                  <div className="w-full flex items-center gap-1 px-1 py-0.5 rounded hover:bg-[var(--bg-hover)] cursor-pointer mt-0.5">
                    <span className="w-4 h-4 rounded bg-[var(--accent-color)] text-white flex items-center justify-center font-bold text-[0.55em] shrink-0">A</span>
                    <span className="text-[0.6em] font-medium text-[var(--text-secondary)] truncate flex-1">Aetherium</span>
                    <ChevronUp size={8} className="text-[var(--text-muted)] shrink-0" />
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
                {[
                  { title: "Speed of Light Explained", active: true },
                  { title: "Quantum Entanglement", active: false },
                  { title: "General Relativity", active: false },
                  { title: "Wave-Particle Duality", active: false },
                  { title: "Thermodynamics Laws", active: false },
                ].map((s, idx) => (
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
                  <span className="text-[0.5em] font-bold text-[var(--text-muted)] uppercase tracking-wider leading-none mb-0.5">PHYSICS</span>
                  <span className="text-[0.7em] font-semibold text-[var(--text-primary)] truncate">Speed of Light Explained</span>
                </div>
                <div className="flex items-center gap-1 text-[0.65em] text-[var(--text-secondary)] font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span>7b | 8.2s</span>
                </div>
              </div>

              {/* Related link pills list below header */}
              <div className="h-6.5 px-3 bg-[var(--bg-elevated)]/25 border-b border-[var(--border-color)]/30 flex items-center gap-2 shrink-0 overflow-x-hidden text-[0.55em] select-none">
                <span className="font-bold text-[var(--text-muted)] text-[0.5em] uppercase tracking-wider shrink-0">RELATED</span>
                {[
                  "Quantum Entanglement", "General Relativity", "Wave-Particle Duality",
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
                    <span className="text-[0.55em] font-semibold text-[var(--text-muted)] tracking-wide">
                      {dbSettings.user_chat_label || "You"}
                    </span>
                  )}
                  <div
                    className={`text-[0.8em] break-words ${
                      chatMessageStyle === "minimal"
                        ? "w-full py-0.5 text-[var(--text-primary)]"
                        : chatMessageStyle === "flat"
                          ? "w-fit max-w-[85%] rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-[var(--text-primary)]"
                          : "w-fit max-w-[85%] rounded-lg rounded-tr-sm bg-[var(--accent-color)] text-white px-2 py-1"
                    }`}
                  >
                    What is the speed of light?
                  </div>
                </div>

                <div className="flex flex-col gap-0.5 items-start">
                  {chatMessageStyle === "minimal" && (
                    <span className="text-[0.55em] font-semibold text-[var(--text-muted)] tracking-wide">
                      {dbSettings.assistant_chat_label || "Assistant"}
                    </span>
                  )}
                  <div
                    className={`text-[0.8em] break-words relative ${
                      chatMessageStyle === "minimal"
                        ? "w-full py-0.5 text-[var(--text-primary)]"
                        : chatMessageStyle === "flat"
                          ? "w-full rounded border-l border-[var(--accent-color)] bg-[var(--bg-elevated)]/40 px-2 py-1 text-[var(--text-primary)]"
                          : "w-full rounded-lg rounded-tl-sm bg-[var(--bg-secondary)] px-2 py-1 text-[var(--text-primary)]"
                    }`}
                  >
                    {dbSettings.hover_definition_scan_enabled ? (
                      <span>
                        The{" "}
                        <span
                          onMouseEnter={() => setHoveredTerm(true)}
                          onMouseLeave={() => setHoveredTerm(false)}
                          className="underline decoration-dotted decoration-[var(--accent-color)] underline-offset-2 cursor-help font-semibold"
                        >
                          speed of light
                        </span>{" "}
                        in a vacuum is approximately 299,792,458 meters per second.
                      </span>
                    ) : (
                      "The speed of light in a vacuum is approximately 299,792,458 meters per second."
                    )}

                    {hoveredTerm && dbSettings.hover_definition_scan_enabled && (
                      <div className="absolute bottom-full left-4 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-lg p-2 shadow-xl text-[0.65em] max-w-[200px] z-50 mb-1.5 pointer-events-none">
                        <div className="font-semibold text-[var(--accent-color)]">Glossary: Speed of Light</div>
                        <p className="text-[var(--text-secondary)] mt-0.5 leading-snug">
                          A fundamental physical constant. The maximum speed at which all conventional matter and information in the universe can travel.
                        </p>
                      </div>
                    )}
                  </div>

                  {showGenInfo && (
                    <div className="text-[0.55em] text-[var(--text-muted)] mt-0.5 flex flex-wrap items-center gap-1 select-none pl-0.5">
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
                      <span className="text-[0.55em] px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] whitespace-nowrap truncate max-w-[120px]">
                        {"What's the best frontend framework?"}
                      </span>
                    )}
                    {showComposerChatFollowUps && (
                      <>
                        <span className="text-[0.55em] px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] whitespace-nowrap truncate max-w-[120px]">
                          How do I create a responsive layout?
                        </span>
                        <span className="text-[0.55em] px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] whitespace-nowrap flex items-center gap-0.5 truncate max-w-[120px]">
                          What are some popular CSS frameworks... <ChevronDown size={8} />
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

const LiveAppPreview = React.memo(LiveAppPreviewBase);
export default LiveAppPreview;
