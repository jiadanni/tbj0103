/**
 * SettingsView — tabbed sections: Appearance, AI, Security, Backup.
 * Mirrors SettingsView.swift.
 */
import { useEffect, useState } from "react";
import { Save, Palette, Bot, ShieldCheck, HardDrive } from "lucide-react";
import { api, type AppSettings } from "../lib/api";
import { useSettingsStore } from "../stores/settingsStore";

const THEMES = ["system", "light", "dark", "oled", "sepia", "hacker"] as const;
const ACCENT_COLORS = [
  { label: "Blue",   value: "#3b82f6" },
  { label: "Purple", value: "#8b5cf6" },
  { label: "Green",  value: "#10b981" },
  { label: "Orange", value: "#f97316" },
  { label: "Pink",   value: "#ec4899" },
  { label: "Cyan",   value: "#06b6d4" },
];

type Tab = "appearance" | "ai" | "security" | "backup";

const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
  { id: "appearance", label: "Appearance", Icon: Palette },
  { id: "ai",         label: "AI",         Icon: Bot },
  { id: "security",   label: "Security",   Icon: ShieldCheck },
  { id: "backup",     label: "Backup",     Icon: HardDrive },
];

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer flex-shrink-0 ${on ? "bg-[var(--accent-color)]" : "bg-[var(--bg-hover)]"}`}
    >
      <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0"}`} />
    </div>
  );
}

export default function SettingsView() {
  const zustandSettings = useSettingsStore();
  const [models, setModels] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("appearance");

  const [dbSettings, setDbSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    api.settings.get().then(setDbSettings).catch(() => {});
    api.ollama.listModels().then((m) => setModels(m.map((x) => x.name))).catch(() => {});
  }, []);

  async function save() {
    if (!dbSettings) return;
    await api.settings.update(dbSettings);
    zustandSettings.setTheme(dbSettings.theme as any);
    zustandSettings.setAccentColor(dbSettings.accent_color);
    zustandSettings.setFontSize(dbSettings.font_size);
    zustandSettings.setPreferredModel(dbSettings.preferred_model);
    zustandSettings.setOllamaUrl(dbSettings.ollama_base_url);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDbSettings((prev) => prev ? { ...prev, [key]: value } : prev);
  }

  function setAppearance<K extends "theme" | "accent_color" | "font_size">(key: K, value: AppSettings[K]) {
    setDbSettings((prev) => prev ? { ...prev, [key]: value } : prev);
    if (key === "theme") zustandSettings.setTheme(value as any);
    if (key === "accent_color") zustandSettings.setAccentColor(value as string);
    if (key === "font_size") zustandSettings.setFontSize(value as number);
  }

  if (!dbSettings) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] flex-shrink-0">
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">Settings</h1>
        <button
          onClick={save}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-color)] text-white text-xs hover:opacity-90"
        >
          <Save size={12} /> {saved ? "Saved!" : "Save"}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-4 pt-3 pb-0 border-b border-[var(--border-color)] flex-shrink-0">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-t-lg border-b-2 transition-colors ${
              activeTab === id
                ? "border-[var(--accent-color)] text-[var(--accent-color)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-lg space-y-5">

          {/* ── Appearance ── */}
          {activeTab === "appearance" && (
            <>
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-2 block">Theme</label>
                <div className="flex flex-wrap gap-2">
                  {THEMES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setAppearance("theme", t)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize ${
                        dbSettings.theme === t
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
                <label className="text-xs text-[var(--text-secondary)] mb-2 block">Accent Color</label>
                <div className="flex gap-2">
                  {ACCENT_COLORS.map(({ label, value }) => (
                    <button
                      key={value}
                      onClick={() => setAppearance("accent_color", value)}
                      title={label}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        dbSettings.accent_color === value ? "border-white scale-110" : "border-transparent"
                      }`}
                      style={{ backgroundColor: value }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-2 block">
                  Font Size: {dbSettings.font_size}px
                </label>
                <input
                  type="range" min={12} max={16} step={1}
                  value={dbSettings.font_size}
                  onChange={(e) => setAppearance("font_size", Number(e.target.value))}
                  className="w-48 accent-[var(--accent-color)]"
                />
              </div>
            </>
          )}

          {/* ── AI / Ollama ── */}
          {activeTab === "ai" && (
            <>
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-1 block">Ollama URL</label>
                <input
                  value={dbSettings.ollama_base_url}
                  onChange={(e) => set("ollama_base_url", e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                />
              </div>

              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-1 block">Preferred Model</label>
                <select
                  value={dbSettings.preferred_model}
                  onChange={(e) => set("preferred_model", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-secondary)] outline-none"
                >
                  {models.length > 0
                    ? models.map((m) => <option key={m} value={m}>{m}</option>)
                    : <option value={dbSettings.preferred_model}>{dbSettings.preferred_model}</option>
                  }
                </select>
              </div>

              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-1 block">Embedding Model</label>
                <input
                  value={dbSettings.embedding_model}
                  onChange={(e) => set("embedding_model", e.target.value)}
                  placeholder="nomic-embed-text"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                />
              </div>
            </>
          )}

          {/* ── Security ── */}
          {activeTab === "security" && (
            <>
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm text-[var(--text-secondary)]">Require authentication on launch</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Use Touch ID or password when opening the app</p>
                </div>
                <Toggle on={dbSettings.touch_id_enabled} onToggle={() => set("touch_id_enabled", !dbSettings.touch_id_enabled)} />
              </div>

              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-2 block">
                  Auto-lock after {dbSettings.auto_lock_minutes} {dbSettings.auto_lock_minutes === 1 ? "minute" : "minutes"}
                </label>
                <input
                  type="range" min={1} max={60} step={1}
                  value={dbSettings.auto_lock_minutes}
                  onChange={(e) => set("auto_lock_minutes", Number(e.target.value))}
                  className="w-48 accent-[var(--accent-color)]"
                />
                <div className="flex justify-between text-xs text-[var(--text-muted)] w-48 mt-1">
                  <span>1 min</span><span>60 min</span>
                </div>
              </div>
            </>
          )}

          {/* ── Backup ── */}
          {activeTab === "backup" && (
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm text-[var(--text-secondary)]">Automatic backups</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Periodically snapshot your data for restore</p>
              </div>
              <Toggle on={dbSettings.backup_enabled} onToggle={() => set("backup_enabled", !dbSettings.backup_enabled)} />
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
