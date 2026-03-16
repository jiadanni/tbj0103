/**
 * SettingsView — theme, model, Ollama URL, security, etc.
 * Mirrors SettingsView.swift.
 */
import { useEffect, useState } from "react";
import { Save, RefreshCw } from "lucide-react";
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
const FONT_SIZES = [12, 13, 14, 15, 16] as const;

export default function SettingsView() {
  const zustandSettings = useSettingsStore();
  const [models, setModels] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  // Local editable state mirrors the DB settings
  const [dbSettings, setDbSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    api.settings.get().then(setDbSettings).catch(() => {});
    api.ollama.listModels().then((m) => setModels(m.map((x) => x.name))).catch(() => {});
  }, []);

  async function save() {
    if (!dbSettings) return;
    await api.settings.update(dbSettings);
    // Sync to Zustand store as well
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

  if (!dbSettings) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">Settings</h1>
        <button
          onClick={save}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-color)] text-white text-xs hover:opacity-90"
        >
          <Save size={12} /> {saved ? "Saved!" : "Save"}
        </button>
      </div>

      <div className="px-6 py-5 space-y-8 max-w-xl">
        {/* Appearance */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Appearance</h2>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-2 block">Theme</label>
              <div className="flex flex-wrap gap-2">
                {THEMES.map((t) => (
                  <button
                    key={t}
                    onClick={() => set("theme", t)}
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
                    onClick={() => set("accent_color", value)}
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
                onChange={(e) => set("font_size", Number(e.target.value))}
                className="w-48 accent-[var(--accent-color)]"
              />
            </div>
          </div>
        </section>

        {/* AI / Ollama */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">AI / Ollama</h2>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Ollama URL</label>
              <input
                value={dbSettings.ollama_base_url}
                onChange={(e) => set("ollama_base_url", e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full max-w-sm px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
              />
            </div>

            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Preferred Model</label>
              <select
                value={dbSettings.preferred_model}
                onChange={(e) => set("preferred_model", e.target.value)}
                className="w-full max-w-sm px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-secondary)] outline-none"
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
                className="w-full max-w-sm px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
              />
            </div>
          </div>
        </section>

        {/* Security */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Security</h2>
          <div className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-[var(--text-secondary)]">Require authentication on launch</span>
              <div
                onClick={() => set("touch_id_enabled", !dbSettings.touch_id_enabled)}
                className={`w-10 h-5.5 rounded-full transition-colors relative ${dbSettings.touch_id_enabled ? "bg-[var(--accent-color)]" : "bg-[var(--bg-hover)]"}`}
              >
                <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${dbSettings.touch_id_enabled ? "translate-x-4.5" : "translate-x-0.5"}`} />
              </div>
            </label>

            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">
                Auto-lock after {dbSettings.auto_lock_minutes} minutes
              </label>
              <input
                type="range" min={1} max={60} step={1}
                value={dbSettings.auto_lock_minutes}
                onChange={(e) => set("auto_lock_minutes", Number(e.target.value))}
                className="w-48 accent-[var(--accent-color)]"
              />
            </div>
          </div>
        </section>

        {/* Backup */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Backup</h2>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-[var(--text-secondary)]">Enable automatic backups</span>
            <div
              onClick={() => set("backup_enabled", !dbSettings.backup_enabled)}
              className={`w-10 h-5.5 rounded-full transition-colors relative ${dbSettings.backup_enabled ? "bg-[var(--accent-color)]" : "bg-[var(--bg-hover)]"}`}
            >
              <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${dbSettings.backup_enabled ? "translate-x-4.5" : "translate-x-0.5"}`} />
            </div>
          </label>
        </section>
      </div>
    </div>
  );
}
