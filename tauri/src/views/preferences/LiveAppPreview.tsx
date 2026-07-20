/**
 * LiveAppPreview — miniature mock of the app window rendered in Preferences.
 * Mirrors the real chrome (Layout.tsx titlebar, Sidebar.tsx, StatusBar.tsx,
 * WindowControls.tsx); when those surfaces change, update this mock to match.
 */
import React, { useMemo } from "react";
import {
  ArrowUpDown,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Code2,
  Columns2,
  Copy,
  Download,
  History as HistoryIcon,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Search,
  Send,
  Settings as SettingsIcon,
} from "lucide-react";
import type { AppSettings } from "../../lib/api";
import {
  getCodeBlockColorPaletteColors,
  getCodeBlockKeywordColorValue,
  tokenizeCode,
} from "../../lib/codeBlockHighlight";
import {
  useSettingsStore,
  type ChatMessageStyle,
  type CodeBlockColorPalette,
  type CodeBlockContainerStyle,
  type CodeBlockKeywordColor,
} from "../../stores/settingsStore";
import { type NavigationPresentation, useWorkspaceStore } from "../../stores/workspaceStore";
import { Tooltip } from "../../components/Tooltip";
import { isMac } from "../../lib/platform";
import { usePrefsWindowMode } from "../../lib/prefsWindowMode";
import { PRIMARY_NAV_ITEMS } from "../../components/navigationItems";
import { SectionNavTopTabs } from "../../components/chrome/SectionNavTopTabs";
import { SectionNavDropdownSelect } from "../../components/chrome/SectionNavDropdownSelect";
import { SectionNavSidebar } from "../../components/chrome/SectionNavSidebar";
import { McMenubarMock } from "../../components/chrome/McMenubarMock";
import { SinglePaneWorkspaceSidebar } from "../../components/chrome/SinglePaneWorkspaceSidebar";
import { WorkspaceNavDropdownSelect } from "../../components/chrome/WorkspaceNavDropdownSelect";
import ChatMessageBubble from "../../components/ChatMessageBubble";
import type { Message } from "../../stores/chatStore";

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
const PREVIEW_ASSISTANT_MESSAGE_INTRO: Message = {
  id: "preview-assistant-intro",
  session_id: "preview",
  role: "assistant",
  content: "Light in a vacuum travels at a constant ~299,792 km/s — fast enough to circle the Earth about 7.5 times in a single second. In denser media like glass or water it slows down, and that change in speed is what bends a beam at the boundary (refraction).",
  model_name: "local-7b",
  tokens_used: 64,
  duration_ms: 1400,
  created_at: "2026-01-01T00:00:01Z",
};
const PREVIEW_ASSISTANT_MESSAGE: Message = {
  id: "preview-assistant",
  session_id: "preview",
  role: "assistant",
  content: "If you want to play with it, here's a tiny helper that converts a distance to its light-travel time:\n\n```python\nC_MPS = 299_792_458  # speed of light in vacuum, m/s\n\ndef light_travel_seconds(distance_m: float) -> float:\n    return distance_m / C_MPS\n```",
  model_name: "local-7b",
  tokens_used: 120,
  duration_ms: 2500,
  created_at: "2026-01-01T00:00:02Z",
};

// Mirror StatusBar.tsx ZoomSlider bounds (font_size range).
const ZOOM_MIN = 11;
const ZOOM_MAX = 22;

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

function PreviewCodeBlock({
  content,
  lang,
  containerStyle,
  colorPalette,
  keywordColor,
}: {
  content: string;
  lang: string;
  containerStyle: CodeBlockContainerStyle;
  colorPalette: CodeBlockColorPalette;
  keywordColor: CodeBlockKeywordColor;
}) {
  const paletteColors = getCodeBlockColorPaletteColors(colorPalette);
  const keywordColorValue = getCodeBlockKeywordColorValue(keywordColor, colorPalette);
  const tokens = tokenizeCode(content, lang);
  const codeContent = (
    <code style={{ color: paletteColors.plain }}>
      {tokens.map((token, index) => (
        token.kind === "keyword"
          ? <span key={index} style={{ color: keywordColorValue, fontWeight: 600 }}>{token.text}</span>
          : token.kind === "plain"
            ? <React.Fragment key={index}>{token.text}</React.Fragment>
            : <span key={index} style={{ color: paletteColors[token.kind] }}>{token.text}</span>
      ))}
    </code>
  );
  const languageLabel = lang || "text";

  if (containerStyle === "utilityHeader") {
    return (
      <div className="my-2 max-w-full overflow-hidden rounded-lg bg-[#1f1f1f] text-white shadow-sm">
        <div className="flex items-center justify-between bg-[#303134] px-3 py-1.5 text-[0.68em] text-white/80">
          <span className="font-medium lowercase">{languageLabel}</span>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><Copy size={9} />Copy</span>
            <span className="inline-flex items-center gap-1"><Download size={9} />Download</span>
          </div>
        </div>
        <pre className="m-0 max-h-[155px] overflow-auto px-3 py-2 text-[0.66em] leading-5">
          {codeContent}
        </pre>
      </div>
    );
  }

  if (containerStyle === "compactHeader") {
    return (
      <div className="my-2 max-w-full overflow-hidden rounded-2xl bg-[#1f1f1f] text-white shadow-sm">
        <div className="flex items-center justify-between px-3 py-2 text-[0.68em] font-medium text-white/90">
          <span className="inline-flex items-center gap-1.5"><Code2 size={9} />{languageLabel}</span>
          <Copy size={10} />
        </div>
        <pre className="m-0 max-h-[150px] overflow-auto px-3 pb-3 text-[0.64em] leading-5">
          {codeContent}
        </pre>
      </div>
    );
  }

  const roomy = containerStyle === "roundedExpanded";
  return (
    <div className={`my-2 overflow-hidden bg-[#1f1f1f] text-white shadow-sm ${
      roomy
        ? "w-full min-h-[215px] rounded-[24px]"
        : "w-fit max-w-full rounded-[18px]"
    }`}>
      <div className={`flex items-center justify-between ${roomy ? "px-4 py-4" : "px-3 py-2.5"} text-[0.72em] font-semibold`}>
        <span>{languageLabel}</span>
        <div className="flex items-center gap-2">
          <Download size={11} />
          <Copy size={11} />
        </div>
      </div>
      <pre className={`m-0 max-h-[175px] overflow-auto ${roomy ? "px-4 pb-6 text-[0.68em] leading-6" : "px-3 pb-3 text-[0.62em] leading-5"}`}>
        {codeContent}
      </pre>
    </div>
  );
}

/** Miniature of StatusBar.tsx's MiniBar: "Label: [bar] value". */
function MiniBarMock({ label, percent, sublabel }: { label: string; percent: number; sublabel?: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="font-medium text-[var(--text-secondary)]">{label}:</span>
      <span className="relative h-1 w-6 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--border-color),transparent_50%)]">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-[rgba(var(--accent-color-rgb),0.6)]"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="tabular-nums">{sublabel ?? `${percent}%`}</span>
    </div>
  );
}

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
    codeBlockContainerStyle?: CodeBlockContainerStyle | null;
    codeBlockColorPalette?: CodeBlockColorPalette | null;
    codeBlockKeywordColor?: CodeBlockKeywordColor | null;
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
  const dbCodeBlockContainerStyle = useSettingsStore((s) => s.codeBlockContainerStyle);
  const dbCodeBlockColorPalette = useSettingsStore((s) => s.codeBlockColorPalette);
  const dbCodeBlockKeywordColor = useSettingsStore((s) => s.codeBlockKeywordColor);

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
  const codeBlockContainerStyle = overrides.codeBlockContainerStyle !== undefined && overrides.codeBlockContainerStyle !== null ? overrides.codeBlockContainerStyle : dbCodeBlockContainerStyle;
  const codeBlockColorPalette = overrides.codeBlockColorPalette !== undefined && overrides.codeBlockColorPalette !== null ? overrides.codeBlockColorPalette : dbCodeBlockColorPalette;
  const codeBlockKeywordColor = overrides.codeBlockKeywordColor !== undefined && overrides.codeBlockKeywordColor !== null ? overrides.codeBlockKeywordColor : dbCodeBlockKeywordColor;
  const [singleWindowMode] = usePrefsWindowMode();

  const showLeftSidebar = workspaceNavigation === "sidebar";
  const themeClass = `theme-${overrides.theme !== undefined && overrides.theme !== null ? overrides.theme : dbSettings.theme || "system"}`;
  const accentColor = overrides.accentColor !== undefined && overrides.accentColor !== null ? overrides.accentColor : dbSettings.accent_color || "#007AFF";
  const fontSize = overrides.fontSize !== undefined && overrides.fontSize !== null ? overrides.fontSize : dbSettings.font_size || 14;
  const scaledFontSize = Math.max(9, Math.min(20, Math.round(fontSize * 0.9)));
  const zoomValue = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(fontSize)));
  const zoomPercent = Math.round(((zoomValue - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100);

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
  const previewMarkdownComponents = useMemo(() => ({
    pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    code: ({ inline, className, children }: { inline?: boolean; className?: string; children?: React.ReactNode }) => {
      if (inline) {
        return <code>{children}</code>;
      }
      const match = /language-(\w+)/.exec(className || "");
      const lang = match ? match[1] : "";
      return (
        <PreviewCodeBlock
          content={String(children).replace(/\n$/, "")}
          lang={lang}
          containerStyle={codeBlockContainerStyle}
          colorPalette={codeBlockColorPalette}
          keywordColor={codeBlockKeywordColor}
        />
      );
    },
  }), [codeBlockColorPalette, codeBlockContainerStyle, codeBlockKeywordColor]);

  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3 flex items-center gap-1.5 self-start">
        <span>Live App Preview</span>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
      </div>

      {/* Simulated Desktop Container */}
      <div className="w-full flex flex-col items-center justify-center bg-[var(--bg-secondary)]/35 rounded-2xl p-4 border border-[var(--border-color)]/60 shadow-inner">
        {/* Mock macOS Menubar — a system surface that only exists on macOS */}
        {isMac && (
          <McMenubarMock
            showAppMenu={!dbSettings.hide_native_menu}
            backgroundInferenceEnabled={dbSettings.background_inference_enabled}
            iconStyle={dbSettings.menubar_icon_style as "monochrome" | "white" | "black"}
          />
        )}

        {/* Mock App Window */}
        <div
          className={`${themeClass} relative flex flex-col w-full aspect-[16/10.5] ${isMac ? "rounded-b-xl" : "rounded-xl"} border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-2xl overflow-hidden select-none`}
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
              // Non-mac: real app renders AppHeaderMenu (a hamburger dropdown) here.
              // Show a minimal stylized representation rather than a duplicate "A"
              // badge — the real "A" lives in the sidebar footer (see Sidebar.tsx).
              <div className="flex items-center shrink-0 text-[var(--text-secondary)]" aria-hidden="true">
                <div className="flex flex-col gap-[2px]">
                  <span className="block h-[1.5px] w-3 rounded-full bg-current opacity-60" />
                  <span className="block h-[1.5px] w-3 rounded-full bg-current opacity-60" />
                  <span className="block h-[1.5px] w-3 rounded-full bg-current opacity-60" />
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 max-w-[60%] truncate h-full">
              {workspaceNavigation === "top-dropdown" ? (
                <WorkspaceNavDropdownSelect
                  density="compact"
                  label="Workspace"
                  value=""
                  options={[]}
                  displayLabel={activeWorkspaceName}
                />
              ) : workspaceNavigation === "top-tabs" ? (
                <div className="flex gap-1 items-end relative -bottom-[1px] h-full" data-no-drag>
                  {parentWorkspaces.map((ws, index) => {
                    const isActive = index === 0;
                    return (
                      <div
                        key={ws.id}
                        className={`relative text-[0.65em] px-2 py-0.5 rounded-t-md border border-b-0 select-none whitespace-nowrap cursor-pointer transition-all ${
                          isActive
                            ? "font-semibold text-[var(--text-primary)] bg-[var(--bg-primary)] border-[var(--border-color)]"
                            : "text-[var(--text-muted)] bg-[var(--bg-sidebar)]/50 border-transparent"
                        }`}
                      >
                        {isActive && (
                          <span className="absolute inset-x-1.5 top-0 h-0.5 rounded-full bg-[var(--accent-color)]" />
                        )}
                        {ws.name}
                      </div>
                    );
                  })}
                  <button className="h-5 w-5 text-[var(--text-secondary)] rounded flex items-center justify-center mb-0.5">
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

            <div className="flex items-center gap-1">
              {singleWindowMode && (
                <Tooltip content="Single Window Mode Active" position="bottom">
                  <div className="text-[var(--accent-color)] flex items-center shrink-0 mr-1">
                    <Pin size={10} className="rotate-45" />
                  </div>
                </Tooltip>
              )}
              {/* BackForwardNavigation — mirrors Layout.tsx (ChevronLeft/Right in
                  bordered 8x8 buttons, on the right of the titlebar). */}
              <div className="h-5 w-5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] flex items-center justify-center text-[var(--text-secondary)]">
                <ChevronLeft size={10} />
              </div>
              <div className="h-5 w-5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] flex items-center justify-center text-[var(--text-secondary)]">
                <ChevronRight size={10} />
              </div>
              {/* TitlebarSortMenu */}
              <div className="h-5 w-5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] flex items-center justify-center text-[var(--text-secondary)]">
                <ArrowUpDown size={10} />
              </div>
              {/* TitlebarHistoryMenu */}
              <div className="h-5 w-5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] flex items-center justify-center text-[var(--text-secondary)]">
                <HistoryIcon size={10} />
              </div>
              {/* Preferences */}
              <div className="h-5 w-5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] flex items-center justify-center text-[var(--text-secondary)]">
                <SettingsIcon size={10} />
              </div>
              {/* Split toggle */}
              <div className="h-5 w-5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] flex items-center justify-center text-[var(--text-secondary)]">
                <Columns2 size={10} />
              </div>
              {!isMac && (
                // Mirrors WindowControls.tsx SVGs (minimise line, maximise square, close X)
                <div className="flex items-center gap-2 ml-1 text-[var(--text-secondary)] select-none" aria-hidden="true">
                  <svg width="7" height="7" viewBox="0 0 10 10" className="shrink-0">
                    <rect fill="currentColor" y="4.5" width="10" height="1" />
                  </svg>
                  <svg width="7" height="7" viewBox="0 0 9 9" fill="none" className="shrink-0">
                    <rect x="0.5" y="0.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
                  </svg>
                  <svg width="7" height="7" viewBox="0 0 10 10" className="shrink-0">
                    <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Sub-workspace tabs for the active parent workspace (child workspaces) */}
          {subWorkspaceNavigation === "top-tabs" && activeWorkspaceChildren.length > 0 && (
            <div className="h-7 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/90 px-3 flex items-center justify-between shrink-0 select-none">
              <div className="flex items-center gap-1.5 h-full">
                {/* Pinned overview indicator */}
                <div className="flex h-[22px] w-5 items-center justify-center self-end rounded-t border border-b-0 border-transparent text-[var(--text-secondary)] cursor-pointer">
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
                          : "border-transparent text-[var(--text-secondary)] opacity-60"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute inset-x-1.5 top-0 h-0.5 rounded-full bg-[var(--accent-color)]" />
                      )}
                      {child.name}
                    </div>
                  );
                })}
                <button className="h-4 w-4 text-[var(--text-muted)] rounded flex items-center justify-center mb-0.5">
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
              <button className="h-4 w-4 text-[var(--text-muted)] rounded flex items-center justify-center">
                <Plus size={8} />
              </button>
            </div>
          )}

          {!showLeftSidebar && sectionNavigation === "top-tabs" && (
            <SectionNavTopTabs
              items={PRIMARY_NAV_ITEMS.map((item) => ({
                id: item.path,
                label: item.label,
                icon: item.icon,
              }))}
              activeId="/chat"
              onSelect={() => {}}
              density="compact"
            />
          )}

          {/* Section dropdown on its own row (when not combined into the titlebar) */}
          {sectionNavigation === "top-dropdown" && !combineSectionDropdown && (
            <SectionNavDropdownSelect
              density="compact"
              showRow={true}
              options={PRIMARY_NAV_ITEMS.map((item) => ({
                label: item.label,
                value: item.path,
                icon: item.icon,
              }))}
              value="/chat"
            />
          )}

          <div className="flex flex-1 min-h-0 overflow-hidden">
            {workspaceNavigation === "sidebar" && (
              <SinglePaneWorkspaceSidebar
                density="compact"
                headerLabel="Workspaces"
                testId="single-pane-workspace-sidebar"
                items={parentWorkspaces.map((ws, index) => ({
                  id: ws.id,
                  name: ws.name,
                  isActive: index === 0,
                }))}
              />
            )}

            {subWorkspaceNavigation === "sidebar" && activeWorkspaceChildren.length > 0 && (
              <SinglePaneWorkspaceSidebar
                density="compact"
                headerLabel="Sub-spaces"
                testId="single-pane-subworkspace-sidebar"
                overview={{ label: "Overview" }}
                items={activeWorkspaceChildren.map((child, index) => ({
                  id: child.id,
                  name: child.name,
                  isActive: index === 0,
                }))}
              />
            )}

            {sectionNavigation === "sidebar" && (
              <div className="w-14 shrink-0 bg-[var(--bg-sidebar)] border-r border-[var(--border-color)] py-1.5 flex flex-col justify-between items-center select-none" data-testid="sidebar">
                <SectionNavSidebar
                  density="compact"
                  items={PRIMARY_NAV_ITEMS.map((item, index) => ({
                    id: item.path,
                    label: item.label,
                    icon: item.icon,
                    isActive: index === 2,
                  }))}
                />
                {/* Footer mirrors Sidebar.tsx: Collapse / Preferences / Aetherium menu */}
                <div className="flex flex-col items-center gap-0.5 w-full px-1 pt-1.5 border-t border-[var(--border-color)]/60">
                  <div className="text-[var(--text-secondary)] text-[0.5em] flex items-center justify-center gap-0.5 w-full py-0.5 rounded cursor-pointer scale-[0.85]">
                    <ChevronLeft size={8} />
                    <span>Collapse</span>
                  </div>
                  <div className="text-[var(--text-secondary)] text-[0.5em] flex items-center justify-center gap-0.5 w-full py-0.5 rounded cursor-pointer scale-[0.85]">
                    <SettingsIcon size={8} strokeWidth={1.5} />
                    <span>Preferences</span>
                  </div>
                  <div className="flex items-center justify-center gap-0.5 w-full py-0.5 rounded cursor-pointer">
                    <span className="w-4 h-4 rounded bg-[var(--accent-color)] text-white text-[0.55em] font-bold flex items-center justify-center shadow-sm select-none shrink-0">
                      A
                    </span>
                    <span className="text-[0.5em] font-medium text-[var(--text-secondary)] truncate">Aetherium</span>
                    <ChevronUp size={7} className="text-[var(--text-secondary)] rotate-180 shrink-0" />
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
              <div className="flex items-center gap-1 rounded bg-[var(--bg-elevated)] px-1 py-0.5 text-[0.6em] text-[var(--text-muted)]">
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
                        : "text-[var(--text-secondary)]"
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
                  <span key={lnk} className="px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)] cursor-pointer whitespace-nowrap">
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
                    msg={PREVIEW_ASSISTANT_MESSAGE_INTRO}
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
                    markdownComponents={previewMarkdownComponents}
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
                      <span className="text-[0.55em] px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)] whitespace-nowrap truncate max-w-[120px]">
                        {PREVIEW_COMPOSER_SUGGESTION}
                      </span>
                    )}
                    {showComposerChatFollowUps && (
                      <>
                        <span className="text-[0.55em] px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)] whitespace-nowrap truncate max-w-[120px]">
                          {PREVIEW_COMPOSER_FOLLOWUPS[0]}
                        </span>
                        <span className="text-[0.55em] px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)] flex items-center gap-0.5 whitespace-nowrap truncate max-w-[120px]">
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
                    <Paperclip size={10} className="cursor-pointer" />
                    <Search size={10} className="cursor-pointer" />
                    <Pencil size={10} className="cursor-pointer" />
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
            <div className="h-5 px-2 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between gap-2 text-[0.55em] text-[var(--text-muted)] shrink-0 select-none overflow-hidden">
              {/* Left: Active workspace + Jobs trigger + running job pills (mirrors StatusBar.tsx) */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-1 font-medium text-[var(--text-primary)]">
                  <span className="text-[var(--accent-color)]">📁</span>
                  <span className="font-semibold truncate max-w-[80px]">Workspace</span>
                </div>
                <span className="h-2 w-px bg-[var(--border-color)]" />
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]" />
                  <span className="font-medium text-[var(--text-secondary)]">Jobs</span>
                </div>
                {dbSettings.background_inference_enabled && (
                  <div className="flex items-center gap-1">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                    </span>
                    <span className="font-medium text-emerald-400">Summaries</span>
                  </div>
                )}
              </div>
              {/* Right: Zoom · CPU · RAM · VRAM meters (mirrors StatusBar.tsx) */}
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="font-medium text-[var(--text-secondary)]">Zoom:</span>
                  <span className="relative h-1 w-8 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--border-color),transparent_50%)]">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-[rgba(var(--accent-color-rgb),0.6)]"
                      style={{ width: `${zoomPercent}%` }}
                    />
                  </span>
                  <span className="tabular-nums">{zoomValue}</span>
                </div>
                <span className="h-2 w-px bg-[var(--border-color)]" />
                <MiniBarMock label="CPU" percent={20} />
                <span className="h-2 w-px bg-[var(--border-color)]" />
                <MiniBarMock label="RAM" percent={70} sublabel="22.0 GB / 31.3 GB" />
                <span className="h-2 w-px bg-[var(--border-color)]" />
                <MiniBarMock label="VRAM" percent={74} sublabel="5.9 GB / 8.0 GB" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(LiveAppPreview);
