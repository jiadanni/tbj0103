import { useRef, useState } from "react";
import { Pin } from "lucide-react";
import { Toggle } from "../Toggle";
import { Tooltip } from "../Tooltip";
import { isLinux, isMac } from "../../lib/platform";

interface AppPreferencesPanelProps {
  startAtLogin: boolean;
  openInBackground: boolean;
  keepRunningInTray: boolean;
  hideNativeMenu: boolean;
  onToggleStartAtLogin: () => void;
  onToggleOpenInBackground: () => void;
  onToggleKeepRunningInTray: () => void;
  onToggleHideNativeMenu: () => void;
  singleWindowMode: boolean;
  onToggleSingleWindowMode: () => void;
  isDemoMode: boolean;
  onExitDemo: () => void;
  onStartDemo: () => void;
  quickSearchShortcutDraft: string;
  onQuickSearchShortcutDraftChange: (value: string) => void;
  onCommitQuickSearchShortcut: (value: string) => void;
}

export function AppPreferencesPanel({
  startAtLogin,
  openInBackground,
  keepRunningInTray,
  hideNativeMenu,
  onToggleStartAtLogin,
  onToggleOpenInBackground,
  onToggleKeepRunningInTray,
  onToggleHideNativeMenu,
  singleWindowMode,
  onToggleSingleWindowMode,
  isDemoMode,
  onExitDemo,
  onStartDemo,
  quickSearchShortcutDraft,
  onQuickSearchShortcutDraftChange,
  onCommitQuickSearchShortcut,
}: AppPreferencesPanelProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-8">
        {/* Startup & background */}
        <section className="space-y-3" data-pref-section>
          <div className="pb-1.5 border-b border-[var(--border-color)]">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Startup & background</h3>
          </div>

          <div className="flex items-start gap-3 py-0.5">
            <Toggle on={startAtLogin} onToggle={onToggleStartAtLogin} />
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
              on={openInBackground}
              disabled={!startAtLogin}
              onToggle={onToggleOpenInBackground}
              />
            <div>
              <p className={`text-sm ${startAtLogin ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}`}>Open in background</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {startAtLogin
                  ? "Launch without bringing window to front"
                  : "Available only when Start at login is enabled"}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 py-0.5">
            <Toggle
              on={keepRunningInTray}
              onToggle={onToggleKeepRunningInTray}
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
              on={hideNativeMenu}
              onToggle={onToggleHideNativeMenu}
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
              onToggle={onToggleSingleWindowMode}
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
                onClick={onExitDemo}
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
                onClick={onStartDemo}
                className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--accent-color)]"
              >
                Start Demo
              </button>
            </div>
          )}
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
            onChange={onQuickSearchShortcutDraftChange}
            onCommit={onCommitQuickSearchShortcut}
            placeholder={isMac ? "Cmd+Shift+K" : "Ctrl+Shift+K"}
          />
        </section>
      </div>
    </div>
  );
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
