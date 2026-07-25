import { Tooltip } from "../Tooltip";
import { ACCENT_COLORS, THEMES, THEME_DEFAULT_ACCENTS } from "../../lib/theme";
import { isMac } from "../../lib/platform";
import type { AppSettings } from "../../lib/api";

const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 22;
const DEFAULT_FONT_SIZE = 16;

interface AppearancePreferencesPanelProps {
  dbSettings: AppSettings;
  onSetFontSize: (value: number) => void;
  onPreviewFontSize: (value: number | null) => void;
  onSetMenubarIconStyle: (style: "monochrome" | "white" | "black") => void;
  onSetTheme: (theme: AppSettings["theme"], accentColor: string) => void;
  onPreviewTheme: (theme: string | null, accentColor: string | null) => void;
  onSetAccentColor: (value: string) => void;
  onPreviewAccentColor: (value: string | null) => void;
}

export function AppearancePreferencesPanel({
  dbSettings,
  onSetFontSize,
  onPreviewFontSize,
  onSetMenubarIconStyle,
  onSetTheme,
  onPreviewTheme,
  onSetAccentColor,
  onPreviewAccentColor,
}: AppearancePreferencesPanelProps) {
  return (
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
              onClick={() => onSetFontSize(Math.max(MIN_FONT_SIZE, dbSettings.font_size - 1))}
              onMouseEnter={() => onPreviewFontSize(Math.max(MIN_FONT_SIZE, dbSettings.font_size - 1))}
              onMouseLeave={() => onPreviewFontSize(null)}
              disabled={dbSettings.font_size <= MIN_FONT_SIZE}
              className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              A-
            </button>
            <button
              type="button"
              onClick={() => onSetFontSize(Math.min(MAX_FONT_SIZE, dbSettings.font_size + 1))}
              onMouseEnter={() => onPreviewFontSize(Math.min(MAX_FONT_SIZE, dbSettings.font_size + 1))}
              onMouseLeave={() => onPreviewFontSize(null)}
              disabled={dbSettings.font_size >= MAX_FONT_SIZE}
              className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              A+
            </button>
            <button
              type="button"
              onClick={() => onSetFontSize(DEFAULT_FONT_SIZE)}
              onMouseEnter={() => onPreviewFontSize(DEFAULT_FONT_SIZE)}
              onMouseLeave={() => onPreviewFontSize(null)}
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
                  onClick={() => onSetMenubarIconStyle(style as "monochrome" | "white" | "black")}
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
                onClick={() => onSetTheme(t, THEME_DEFAULT_ACCENTS[t])}
                onMouseEnter={() => onPreviewTheme(t, THEME_DEFAULT_ACCENTS[t])}
                onMouseLeave={() => onPreviewTheme(null, null)}
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
                  onClick={() => onSetAccentColor(value)}
                  onMouseEnter={() => onPreviewAccentColor(value)}
                  onMouseLeave={() => onPreviewAccentColor(null)}
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
  );
}
