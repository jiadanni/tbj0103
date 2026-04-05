export const THEMES = ["system", "light", "dark", "sepia", "hacker", "glasscode"] as const;
export type Theme = typeof THEMES[number];

const LEGACY_THEME_ALIASES: Record<string, Theme> = {
  oled: "dark",
};

export function normalizeTheme(theme: string): Theme {
  if ((THEMES as readonly string[]).includes(theme)) {
    return theme as Theme;
  }

  return LEGACY_THEME_ALIASES[theme] ?? "system";
}

export const ACCENT_COLORS = [
  { label: "Aether Blue", value: "#007AFF" },
  { label: "Sky", value: "#3b82f6" },
  { label: "Indigo", value: "#6366f1" },
  { label: "Violet", value: "#8b5cf6" },
  { label: "Magenta", value: "#d946ef" },
  { label: "Rose", value: "#ec4899" },
  { label: "Coral", value: "#f43f5e" },
  { label: "Orange", value: "#f97316" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Lime", value: "#84cc16" },
  { label: "Emerald", value: "#10b981" },
  { label: "Teal", value: "#14b8a6" },
  { label: "Cyan", value: "#06b6d4" },
  { label: "Slate", value: "#64748b" },
] as const;

export function hexToRgbChannels(hex: string): string {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return "0, 122, 255";
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `${red}, ${green}, ${blue}`;
}
