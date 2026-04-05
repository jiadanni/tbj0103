import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useChatStore, type ChatSession } from "../stores/chatStore";
import type { ChatSubView, NotesSubView, GraphSubView, PreferencesSection } from "./navigationItems";

interface Props {
  workspaceId: string;
  onClose: () => void;
  onNavigate?: (path: string) => void; // Optional if we want to bypass default navigate
}

interface CommandItem {
  label: string;
  value: string;
  path: string;
  state?: unknown;
}

function formatRelativeTime(dateStr: string | undefined): string {
  if (!dateStr) { return ""; }
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 0) { return "just now"; }
    if (diffInSeconds < 60) { return `${diffInSeconds}s ago`; }
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) { return `${diffInMinutes}m ago`; }
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) { return `${diffInHours}h ago`; }
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) { return `${diffInDays}d ago`; }
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
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
  { label: "Chat with Documents",      value: "grounded",       path: "/chat",         state: { subView: "grounded" } },
  { label: "Backlinks",                value: "backlinks",      path: "/graph",        state: { subView: "backlinks" as GraphSubView } },
  { label: "Concept Deduplication",    value: "dedup",          path: "/graph",        state: { subView: "dedup" as GraphSubView } },
  { label: "Manage Workspaces",        value: "workspaces",     path: "/preferences",  state: { settingsTab: "workspaces" as PreferencesSection } },
  { label: "Go to Backups",            value: "backup",         path: "/preferences",  state: { settingsTab: "backup" as PreferencesSection } },
  { label: "Go to Imports",            value: "import",         path: "/preferences",  state: { settingsTab: "import" as PreferencesSection } },
  { label: "Open Preferences",         value: "settings",       path: "/preferences"   },
];

export default function CommandPalette({ workspaceId, onClose }: Props) {
  const navigate = useNavigate();
  const [recentSessions, setRecentSessions] = useState<ChatSession[]>([]);
  const setActiveChatId = useChatStore((state) => state.setActiveChatId);

  useEffect(() => {
    if (!workspaceId) { return; }
    api.chat.getRecentSessions(workspaceId, 8)
      .then(setRecentSessions)
      .catch(console.error);
  }, [workspaceId]);

  const handleSelectCommand = (cmd: CommandItem) => {
    navigate(cmd.path, { state: cmd.state });
    onClose();
  };

  const handleSelectSession = (session: ChatSession) => {
    setActiveChatId(session.id);
    navigate(`/chat/${session.id}`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) { onClose(); } }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <Command
        className="relative z-10 w-full max-w-[560px] mx-4 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden"
        onKeyDown={(e) => { if (e.key === "Escape") { onClose(); } }}
      >
        <Command.Input
          autoFocus
          placeholder="Search commands or recent chats…"
          className="w-full px-4 py-3.5 text-sm text-[var(--text-primary)] bg-transparent border-b border-[var(--border-color)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <Command.List className="max-h-[380px] overflow-y-auto p-1.5">
          <Command.Empty className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
            No results found.
          </Command.Empty>

          {recentSessions.length > 0 && (
            <Command.Group heading="Recent Chats" className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--text-muted)] [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
              {recentSessions.map((session) => (
                <Command.Item
                  key={session.id}
                  value={`chat ${session.title} ${session.id}`}
                  onSelect={() => handleSelectSession(session)}
                  className="flex items-center justify-between px-3 py-2.5 text-sm rounded-lg cursor-default text-[var(--text-primary)] aria-selected:bg-[var(--accent-color)]/20 aria-selected:text-[var(--accent-color)] transition-colors"
                >
                  <span className="truncate mr-4">{session.title || "Untitled Chat"}</span>
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                    {formatRelativeTime(session.last_accessed_at)}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group heading="Navigate" className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--text-muted)] [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            {COMMANDS.map((cmd) => (
              <Command.Item
                key={cmd.value}
                value={cmd.value}
                onSelect={() => handleSelectCommand(cmd)}
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
