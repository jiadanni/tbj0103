export const THEMES = ["system", "light", "noir", "sepia", "hacker"] as const;
export type Theme = typeof THEMES[number];

const LEGACY_THEME_ALIASES: Record<string, Theme> = {
  dark: "noir",
  glasscode: "noir",
  oled: "noir",
};

export function normalizeTheme(theme: string): Theme {
  if ((THEMES as readonly string[]).includes(theme)) {
    return theme as Theme;
  }

  return LEGACY_THEME_ALIASES[theme] ?? "system";
}

export const ACCENT_COLORS = [
  { label: "Aether Blue", value: "#007AFF" },
  { label: "Sky Blue", value: "#3B82F6" },
  { label: "Cobalt", value: "#1D4ED8" },
  { label: "Teal", value: "#14B8A6" },
  { label: "Cyan", value: "#06B6D4" },
  { label: "Ocean", value: "#0891B2" },
  { label: "Mint", value: "#A7F3D0" },
  { label: "Sage", value: "#86EFAC" },
  { label: "Emerald", value: "#10B981" },
  { label: "Forest", value: "#15803D" },
  { label: "Lime", value: "#84CC16" },
  { label: "Olive", value: "#4D7C0F" },
  { label: "Gold", value: "#CA8A04" },
  { label: "Amber", value: "#F59E0B" },
  { label: "Orange", value: "#F97316" },
  { label: "Bronze", value: "#AD7A30" },
  { label: "Copper", value: "#B45309" },
  { label: "Terracotta", value: "#C2410C" },
  { label: "Rust", value: "#9A3412" },
  { label: "Crimson", value: "#E11D48" },
  { label: "Ruby", value: "#BE123C" },
  { label: "Rose", value: "#EC4899" },
  { label: "Sakura", value: "#FDA4AF" },
  { label: "Peach", value: "#FED7AA" },
  { label: "Magenta", value: "#D946EF" },
  { label: "Plum", value: "#86198F" },
  { label: "Deep Purple", value: "#7E22CE" },
  { label: "Violet", value: "#8B5CF6" },
  { label: "Lavender", value: "#C084FC" },
  { label: "Orchid", value: "#D8B4FE" },
  { label: "Wisteria", value: "#A78BFA" },
  { label: "Indigo", value: "#6366F1" },
  { label: "Midnight", value: "#0F172A" },
  { label: "Charcoal", value: "#475569" },
  { label: "Slate", value: "#64748B" },
  { label: "Steel", value: "#4B5563" },
  { label: "Silver", value: "#94A3B8" },
  { label: "Platinum", value: "#CBD5E1" },
  { label: "Taupe", value: "#8D7B68" },
  { label: "Sand", value: "#D6D3D1" },
] as const;

export const THEME_DEFAULT_ACCENTS: Record<Theme, string> = {
  system:  "#007AFF",
  light:   "#007AFF",
  noir:    "#6366f1",
  sepia:   "#f59e0b",
  hacker:  "#00ff41",
};

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
