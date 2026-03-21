/**
 * PluginManagerView — mirrors PluginManagerView.swift.
 * Shows built-in plugins with load/unload toggle.
 * The Tauri runtime has no dynamic plugin loader; enable/disable state is
 * persisted in component state only (same as a feature-flag toggle).
 */
import React, { useState } from "react";
import { PuzzleIcon, RefreshCw, FileText, FolderOpen, Youtube, BookOpen, CalendarDays, ArrowDownCircle, StopCircle, PlayCircle } from "lucide-react";

type PluginType = "exporter" | "importer" | "automation";

interface PluginMeta {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  type: PluginType;
  permissions: string[];
}

const BUILT_IN_PLUGINS: PluginMeta[] = [
  {
    id: "com.aetherium.markdown-exporter",
    name: "Markdown Exporter",
    description: "Export projects as Markdown files with full concept and note content.",
    version: "1.0.0",
    author: "Aetherium",
    type: "exporter",
    permissions: [],
  },
  {
    id: "com.aetherium.obsidian-exporter",
    name: "Obsidian Vault Exporter",
    description: "Export projects as an Obsidian-compatible vault with wiki-links.",
    version: "1.0.0",
    author: "Aetherium",
    type: "exporter",
    permissions: ["fileSystem"],
  },
  {
    id: "com.aetherium.youtube-importer",
    name: "YouTube Transcript Importer",
    description: "Import YouTube video transcripts as project notes.",
    version: "1.0.0",
    author: "Aetherium",
    type: "importer",
    permissions: ["network"],
  },
  {
    id: "com.aetherium.anki-exporter",
    name: "Anki Deck Exporter",
    description: "Export flashcards as an Anki-compatible .apkg deck.",
    version: "1.0.0",
    author: "Aetherium",
    type: "exporter",
    permissions: [],
  },
  {
    id: "com.aetherium.daily-summary",
    name: "Daily Summary",
    description: "Automatically generate a daily summary of notes and concepts using AI.",
    version: "1.0.0",
    author: "Aetherium",
    type: "automation",
    permissions: [],
  },
];

const TYPE_LABEL: Record<PluginType, string> = {
  exporter: "Exporter",
  importer: "Importer",
  automation: "Automation",
};

const TYPE_COLOR: Record<PluginType, string> = {
  exporter: "#3b82f6",
  importer: "#10b981",
  automation: "#f97316",
};

const TYPE_ICON: Record<PluginType, React.ElementType> = {
  exporter: FileText,
  importer: ArrowDownCircle,
  automation: CalendarDays,
};

type FilterTab = "installed" | "all";

export default function PluginManagerView() {
  const [activeTab, setActiveTab] = useState<FilterTab>("installed");
  const [loaded, setLoaded] = useState<Set<string>>(
    () => new Set(BUILT_IN_PLUGINS.map((p) => p.id))
  );
  const [selected, setSelected] = useState<PluginMeta | null>(BUILT_IN_PLUGINS[0]);

  const displayed =
    activeTab === "installed"
      ? BUILT_IN_PLUGINS.filter((p) => loaded.has(p.id))
      : BUILT_IN_PLUGINS;

  function toggle(id: string) {
    setLoaded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {next.delete(id);}
      else {next.add(id);}
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] flex-shrink-0">
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">Plugins</h1>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="w-72 flex-shrink-0 border-r border-[var(--border-color)] flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-[var(--border-color)] px-2 pt-2">
            {(["installed", "all"] as FilterTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-xs rounded-t capitalize transition-colors border-b-2 ${
                  activeTab === tab
                    ? "border-[var(--accent-color)] text-[var(--accent-color)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {tab === "installed" ? "Installed" : "All Plugins"}
              </button>
            ))}
          </div>

          {/* Plugin list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {displayed.map((plugin) => {
              const Icon = TYPE_ICON[plugin.type];
              const color = TYPE_COLOR[plugin.type];
              const isLoaded = loaded.has(plugin.id);
              const isSelected = selected?.id === plugin.id;
              return (
                <button
                  key={plugin.id}
                  onClick={() => setSelected(plugin)}
                  className={`w-full text-left p-2.5 rounded-lg flex items-start gap-3 transition-colors ${
                    isSelected
                      ? "bg-[var(--accent-color)]/15"
                      : "hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: color + "22" }}
                  >
                    <Icon size={16} style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-[var(--text-primary)] truncate">{plugin.name}</span>
                      {isLoaded && (
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                      )}
                    </div>
                    <span
                      className="text-[10px] mt-0.5 block"
                      style={{ color }}
                    >
                      {TYPE_LABEL[plugin.type]}
                    </span>
                  </div>
                </button>
              );
            })}

            {displayed.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
                <PuzzleIcon size={32} className="mb-2 opacity-40" />
                <p className="text-xs">No plugins installed</p>
              </div>
            )}
          </div>
        </div>

        {/* Right detail panel */}
        {selected ? (
          <div className="flex-1 overflow-y-auto p-6">
            <PluginDetail
              plugin={selected}
              isLoaded={loaded.has(selected.id)}
              onToggle={() => toggle(selected.id)}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
            <PuzzleIcon size={40} className="opacity-30" />
            <p className="text-sm">Select a plugin to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PluginDetail({
  plugin,
  isLoaded,
  onToggle,
}: {
  plugin: PluginMeta;
  isLoaded: boolean;
  onToggle: () => void;
}) {
  const Icon = TYPE_ICON[plugin.type];
  const color = TYPE_COLOR[plugin.type];

  return (
    <div className="max-w-lg space-y-5">
      {/* Hero row */}
      <div className="flex items-start gap-4">
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: color + "22" }}
        >
          <Icon size={28} style={{ color }} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{plugin.name}</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            v{plugin.version} · by {plugin.author}
          </p>
          <span
            className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: color + "22", color }}
          >
            {TYPE_LABEL[plugin.type]}
          </span>
        </div>
      </div>

      <p className="text-sm text-[var(--text-secondary)]">{plugin.description}</p>

      {plugin.permissions.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Required Permissions
          </h3>
          <div className="space-y-1">
            {plugin.permissions.map((p) => (
              <div key={p} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                {p}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pt-2">
        {isLoaded ? (
          <button
            onClick={onToggle}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <StopCircle size={14} /> Unload Plugin
          </button>
        ) : (
          <button
            onClick={onToggle}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: color }}
          >
            <PlayCircle size={14} /> Load Plugin
          </button>
        )}
      </div>
    </div>
  );
}
