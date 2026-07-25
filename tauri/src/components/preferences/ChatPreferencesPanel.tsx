import { Toggle } from "../Toggle";
import { Tooltip } from "../Tooltip";
import {
  CODE_BLOCK_CONTAINER_STYLES,
  CODE_BLOCK_COLOR_PALETTES,
  CODE_BLOCK_KEYWORD_COLORS,
  getCodeBlockColorPaletteColors,
} from "../../lib/codeBlockHighlight";
import { useSettingsStore, type ChatMessageStyle } from "../../stores/settingsStore";
import { type AppSettings } from "../../lib/api";

interface ChatPreferencesPanelProps {
  dbSettings: AppSettings;
  onSet: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onPreviewChatMessageStyle: (value: ChatMessageStyle | null) => void;
  onPreviewCodeBlockContainerStyle: (value: string | null) => void;
  onPreviewCodeBlockColorPalette: (value: string | null) => void;
  onPreviewCodeBlockKeywordColor: (value: string | null) => void;
  onPreviewComposerMode: (value: string | null) => void;
}

export function ChatPreferencesPanel({
  dbSettings,
  onSet,
  onPreviewChatMessageStyle,
  onPreviewCodeBlockContainerStyle,
  onPreviewCodeBlockColorPalette,
  onPreviewCodeBlockKeywordColor,
  onPreviewComposerMode,
}: ChatPreferencesPanelProps) {
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
  const codeBlockContainerStyle = useSettingsStore((state) => state.codeBlockContainerStyle);
  const setCodeBlockContainerStyle = useSettingsStore((state) => state.setCodeBlockContainerStyle);
  const codeBlockColorPalette = useSettingsStore((state) => state.codeBlockColorPalette);
  const setCodeBlockColorPalette = useSettingsStore((state) => state.setCodeBlockColorPalette);
  const codeBlockKeywordColor = useSettingsStore((state) => state.codeBlockKeywordColor);
  const setCodeBlockKeywordColor = useSettingsStore((state) => state.setCodeBlockKeywordColor);
  const composerMode = useSettingsStore((state) => state.composerMode);
  const setComposerMode = useSettingsStore((state) => state.setComposerMode);
  const showComposerWorkspaceSuggestions = useSettingsStore((state) => state.showComposerWorkspaceSuggestions);
  const setShowComposerWorkspaceSuggestions = useSettingsStore((state) => state.setShowComposerWorkspaceSuggestions);
  const showComposerChatFollowUps = useSettingsStore((state) => state.showComposerChatFollowUps);
  const setShowComposerChatFollowUps = useSettingsStore((state) => state.setShowComposerChatFollowUps);
  const showStatusBar = useSettingsStore((state) => state.showStatusBar);
  const setShowStatusBar = useSettingsStore((state) => state.setShowStatusBar);

  return (
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
                onMouseEnter={() => onPreviewChatMessageStyle(style)}
                onMouseLeave={() => onPreviewChatMessageStyle(null)}
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
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">Code Block Container</label>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              {CODE_BLOCK_CONTAINER_STYLES.map(({ id, label, description }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCodeBlockContainerStyle(id)}
                  onMouseEnter={() => onPreviewCodeBlockContainerStyle(id)}
                  onMouseLeave={() => onPreviewCodeBlockContainerStyle(null)}
                  className={`rounded-lg border p-2 text-left transition-colors ${
                    codeBlockContainerStyle === id
                      ? "border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--text-primary)]"
                      : "border-[var(--border-color)] bg-[var(--bg-elevated)]/50 text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <div className={`mb-2 rounded-md bg-[#1f1f1f] p-1.5 ${
                    id === "roundedExpanded" ? "h-14 w-full" : id === "rounded" ? "h-10 w-4/5" : "h-11 w-full"
                  }`}>
                    <div className={`${id === "utilityHeader" ? "h-2 rounded-sm bg-white/15" : "mb-1 flex items-center justify-between"}`}>
                      {id !== "utilityHeader" && (
                        <>
                          <span className="h-1.5 w-8 rounded-sm bg-white/40" />
                          <span className="h-1.5 w-4 rounded-sm bg-white/25" />
                        </>
                      )}
                    </div>
                    <div className={`mt-1 space-y-1 ${id === "roundedExpanded" ? "pt-1" : ""}`}>
                      <span className="block h-1 w-16 rounded-sm bg-violet-300/70" />
                      <span className="block h-1 w-12 rounded-sm bg-emerald-300/70" />
                      <span className="block h-1 w-20 rounded-sm bg-white/25" />
                      {id === "roundedExpanded" && <span className="block h-1 w-14 rounded-sm bg-white/20" />}
                    </div>
                  </div>
                  <div className="text-xs font-medium">{label}</div>
                  <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{description}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">Syntax Color Preset</label>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              {CODE_BLOCK_COLOR_PALETTES.map(({ id, label, colors }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCodeBlockColorPalette(id)}
                  onMouseEnter={() => onPreviewCodeBlockColorPalette(id)}
                  onMouseLeave={() => onPreviewCodeBlockColorPalette(null)}
                  className={`rounded-lg border p-2 text-left transition-colors ${
                    codeBlockColorPalette === id
                      ? "border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--text-primary)]"
                      : "border-[var(--border-color)] bg-[var(--bg-elevated)]/50 text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <div className="mb-2 flex h-8 items-center gap-1 rounded-md bg-[#1f1f1f] px-2">
                    {(["keyword", "function", "string", "number", "comment"] as const).map((kind) => (
                      <span
                        key={kind}
                        className="h-2 flex-1 rounded-full"
                        style={{ backgroundColor: colors[kind] }}
                      />
                    ))}
                  </div>
                  <div className="text-xs font-medium">{label}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">Keyword Color Override</label>
            <div className="flex flex-wrap gap-2">
              {CODE_BLOCK_KEYWORD_COLORS.map(({ id, label, value }) => {
                const swatchColor = value ?? getCodeBlockColorPaletteColors(codeBlockColorPalette).keyword;
                return (
                  <Tooltip key={id} content={label}>
                    <button
                      type="button"
                      onClick={() => setCodeBlockKeywordColor(id)}
                      onMouseEnter={() => onPreviewCodeBlockKeywordColor(id)}
                      onMouseLeave={() => onPreviewCodeBlockKeywordColor(null)}
                      aria-label={`Use ${label} keyword color`}
                      className={`relative h-7 w-7 rounded-full border-2 border-white transition-all ${
                        codeBlockKeywordColor === id
                          ? "scale-110 shadow-sm ring-2 ring-white ring-offset-2 ring-offset-[var(--bg-elevated)]"
                          : "opacity-80 hover:scale-105 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: swatchColor }}
                    >
                      {id === "preset" && <span className="absolute inset-[5px] rounded-full border border-white/70" />}
                      <span className="sr-only">{label}</span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>

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
                onMouseEnter={() => onPreviewComposerMode(mode)}
                onMouseLeave={() => onPreviewComposerMode(null)}
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
                onChange={(e) => onSet("user_chat_label", e.target.value)}
                placeholder="You"
                className="w-full text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-[var(--text-secondary)]">Assistant Identifier</label>
              <input
                type="text"
                value={dbSettings.assistant_chat_label}
                onChange={(e) => onSet("assistant_chat_label", e.target.value)}
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
                onChange={() => onSet("chat_title_auto_refresh", "disabled")}
                className="accent-[var(--accent-color)]"
              />
              <span className="text-[var(--text-secondary)]">Disabled</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="chat_title_refresh"
                checked={dbSettings.chat_title_auto_refresh === "initial_only"}
                onChange={() => onSet("chat_title_auto_refresh", "initial_only")}
                className="accent-[var(--accent-color)]"
              />
              <span className="text-[var(--text-secondary)]">Initial title only</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer flex-wrap">
              <input
                type="radio"
                name="chat_title_refresh"
                checked={dbSettings.chat_title_auto_refresh === "periodic"}
                onChange={() => onSet("chat_title_auto_refresh", "periodic")}
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
                    onChange={(e) => onSet("chat_title_refresh_interval", Number(e.target.value))}
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
          <Toggle on={dbSettings.immediate_delete} onToggle={() => onSet("immediate_delete", !dbSettings.immediate_delete)} />
          <div>
            <p className="text-sm text-[var(--text-secondary)]">Immediate Delete</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Bypass recycle bin and delete chats immediately with confirmation</p>
          </div>
        </div>

        {!dbSettings.immediate_delete && (
          <div className="flex items-start gap-3 py-0.5">
            <Toggle on={dbSettings.confirm_move_to_trash} onToggle={() => onSet("confirm_move_to_trash", !dbSettings.confirm_move_to_trash)} />
            <div>
              <p className="text-sm text-[var(--text-secondary)]">Confirm Move to Trash</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Prompt for confirmation before moving chats to the recycle bin</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
