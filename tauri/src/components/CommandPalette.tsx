import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import type { ChatSubView, NotesSubView, GraphSubView, PreferencesSection } from "./navigationItems";

interface Props {
  onClose: () => void;
  onNavigate?: (path: string) => void; // Optional if we want to bypass default navigate
}

interface CommandItem {
  label: string;
  value: string;
  path: string;
  state?: unknown;
}


const COMMANDS: CommandItem[] = [
  { label: "Go to Dashboard",          value: "dashboard",      path: "/project"       },
  { label: "Go to Chat",               value: "chat",           path: "/chat"          },
  { label: "Chat Sessions",            value: "chat-sessions",  path: "/chat",         state: { subView: "sessions" as ChatSubView } },
  { label: "Go to Notes",              value: "notes",          path: "/notes"         },
  { label: "Daily Notes",              value: "daily",          path: "/notes",        state: { subView: "daily" as NotesSubView } },
  { label: "Go to Documents",          value: "documents",      path: "/documents"     },
  { label: "Web Captures",             value: "webcapture",     path: "/webcapture"    },
  { label: "Go to Knowledge Graph",    value: "graph",          path: "/graph"         },
  { label: "Flashcards",               value: "flashcards",     path: "/graph",        state: { subView: "flashcards" as GraphSubView } },
  { label: "Learning Paths",           value: "learning",       path: "/graph",        state: { subView: "learning" as GraphSubView } },
  { label: "Compare Models",           value: "compare",        path: "/chat",         state: { subView: "compare" as ChatSubView } },
  { label: "Grounded Chat",            value: "grounded",       path: "/chat",         state: { subView: "grounded" as ChatSubView } },
  { label: "Backlinks",                value: "backlinks",      path: "/graph",        state: { subView: "backlinks" as GraphSubView } },
  { label: "Concept Deduplication",    value: "dedup",          path: "/graph",        state: { subView: "dedup" as GraphSubView } },
  { label: "Manage Workspaces",        value: "workspaces",     path: "/preferences",  state: { settingsTab: "workspaces" as PreferencesSection } },
  { label: "Go to Backups",            value: "backup",         path: "/preferences",  state: { settingsTab: "backup" as PreferencesSection } },
  { label: "Plugins",                  value: "plugins",        path: "/preferences",  state: { settingsTab: "plugins" as PreferencesSection } },
  { label: "Open Preferences",         value: "settings",       path: "/preferences"   },
];

export default function CommandPalette({ onClose }: Props) {
  const navigate = useNavigate();

  const handleSelect = (cmd: CommandItem) => {
    navigate(cmd.path, { state: cmd.state });
    onClose();
  };

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
                onSelect={() => handleSelect(cmd)}
                className="flex items-center px-3 py-2.5 text-sm rounded-lg cursor-default text-[var(--text-primary)] aria-selected:bg-[var(--accent-color)]/20 aria-selected:text-[var(--accent-color)] transition-colors"
              >
                {cmd.label}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
