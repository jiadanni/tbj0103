import { Command } from "cmdk";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { MOD_KEY } from "../lib/platform";

interface Props {
  onClose: () => void;
  onNavigate: (path: string) => void;
}

const COMMANDS = [
  { label: "Go to Dashboard",          value: "dashboard",      path: "/project",    shortcut: `${MOD_KEY}⇧D` },
  { label: "Go to Chat",               value: "chat",           path: "/chat",       shortcut: `${MOD_KEY}⇧C` },
  { label: "Go to Notes",              value: "notes",          path: "/notes",      shortcut: `${MOD_KEY}⇧N` },
  { label: "Go to Documents",          value: "documents",      path: "/documents",  shortcut: `${MOD_KEY}⇧O` },
  { label: "Web Captures",             value: "webcapture",     path: "/webcapture", shortcut: `${MOD_KEY}⇧W` },
  { label: "Go to Knowledge Graph",    value: "graph",          path: "/graph",      shortcut: `${MOD_KEY}⇧G` },
  { label: "Analyze Workspace (AI)",    value: "analyze",        path: "/graph"                            },
  { label: "Go to Flashcards",         value: "flashcards",     path: "/flashcards", shortcut: `${MOD_KEY}⇧F` },
  { label: "Manage Workspaces",        value: "workspaces",     path: "/settings",   shortcut: `${MOD_KEY}⇧5` },
  { label: "Go to Backups",            value: "backup",         path: "/settings",   shortcut: `${MOD_KEY}⇧6` },
  { label: "Plugins",                  value: "plugins",        path: "/settings",   shortcut: `${MOD_KEY}⇧7` },
  { label: "Open Settings",            value: "settings",       path: "/settings",   shortcut: `${MOD_KEY},`  },
];

export default function CommandPalette({ onClose, onNavigate }: Props) {
  // Close on backdrop click
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) {onClose();} }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <Command
        className="relative z-10 w-full max-w-[560px] mx-4 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden"
        onKeyDown={(e) => { if (e.key === "Escape") {onClose();} }}
      >
        <Command.Input
          autoFocus
          placeholder="Search commands…"
          className="w-full px-4 py-3.5 text-sm text-[var(--text-primary)] bg-transparent border-b border-[var(--border-color)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <Command.List className="max-h-[320px] overflow-y-auto p-1.5">
          <Command.Empty className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
            No commands found.
          </Command.Empty>
          <Command.Group heading="Navigate" className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--text-muted)] [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            {COMMANDS.map((cmd) => (
              <Command.Item
                key={cmd.value}
                value={cmd.value}
                onSelect={() => onNavigate(cmd.path)}
                className="flex items-center justify-between px-3 py-2.5 text-sm rounded-lg cursor-default text-[var(--text-primary)] aria-selected:bg-[var(--accent-color)]/20 aria-selected:text-[var(--accent-color)] transition-colors group"
              >
                <span>{cmd.label}</span>
                {cmd.shortcut && (
                  <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-[var(--border-color)] bg-[var(--bg-sidebar)] px-1.5 font-mono text-[10px] font-medium text-[var(--text-muted)] group-aria-selected:border-[var(--accent-color)] group-aria-selected:text-[var(--accent-color)] opacity-80">
                    {cmd.shortcut}
                  </kbd>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
