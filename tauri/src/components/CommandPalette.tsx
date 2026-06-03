import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, type QuickSearchResult } from "../lib/api";
import { useChatStore, type ChatSession } from "../stores/chatStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { Search, Clock, MessageSquare, FileText, Brain, Sparkles, RefreshCw } from "lucide-react";
import type { ChatSubView, NotesSubView, PreferencesSection } from "./navigationItems";

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

const RELATIVE_FALLBACK_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

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
    return RELATIVE_FALLBACK_FORMATTER.format(date);
  } catch {
    return "";
  }
}

const COMMANDS: CommandItem[] = [
  { label: "Go to Dashboard",          value: "dashboard",      path: "/folder"       },
  { label: "Go to Practice",           value: "practice",       path: "/practice"     },
  { label: "Go to Chat",               value: "chat",           path: "/chat"          },
  { label: "Chat Sessions",            value: "chat-sessions",  path: "/chat",         state: { subView: "sessions" as ChatSubView } },
  { label: "Go to Notes",              value: "notes",          path: "/notes"         },
  { label: "Daily Notes",              value: "daily",          path: "/notes",        state: { subView: "daily" as NotesSubView } },
  { label: "Go to Documents",          value: "documents",      path: "/sources"       },
  { label: "Go to Sources",            value: "sources",        path: "/sources"       },
  { label: "Go to Knowledge",          value: "graph",          path: "/graph"         },
  { label: "Chat with Documents",      value: "grounded",       path: "/chat",         state: { subView: "grounded" } },
  { label: "Manage Workspaces",        value: "workspaces",     path: "/preferences",  state: { settingsTab: "workspaces" as PreferencesSection } },
  { label: "Go to Backups",            value: "backup",         path: "/preferences",  state: { settingsTab: "backup" as PreferencesSection } },
  { label: "Go to Imports",            value: "import",         path: "/preferences",  state: { settingsTab: "import" as PreferencesSection } },
  { label: "Open Preferences",         value: "settings",       path: "/preferences"   },
];

export default function CommandPalette({ workspaceId, onClose }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [recentSessions, setRecentSessions] = useState<ChatSession[]>([]);
  const [searchResults, setSearchResults] = useState<QuickSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const setActiveChatId = useChatStore((state) => state.setActiveChatId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const includeDescendants = workspaces.find((w) => w.id === workspaceId)?.parent_workspace_id == null;

  useEffect(() => {
    if (!workspaceId) { return; }
    api.chat.getRecentSessions(workspaceId, 8, { includeDescendants })
      .then(setRecentSessions)
      .catch(console.error);
  }, [workspaceId, includeDescendants]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      const t = setTimeout(() => {
        setSearchResults((prev) => (prev.length ? [] : prev));
        setIsLoading((prev) => (prev ? false : prev));
      }, 0);
      return () => clearTimeout(t);
    }

    const timer = setTimeout(() => {
      setIsLoading(true);
      api.quickSearch.query(trimmed, {
        limit: 5,
        workspaceId: workspaceId || null,
        includeDescendants,
      })
        .then((results) => {
          // Filter out recent sessions that are already shown in the 'Recent' group
          // to avoid duplication if possible, or just show all for simplicity.
          setSearchResults(results);
        })
        .catch(() => setSearchResults([]))
        .finally(() => setIsLoading(false));
    }, 120);

    return () => clearTimeout(timer);
  }, [query, workspaceId, includeDescendants]);

  const handleSelectCommand = (cmd: CommandItem) => {
    navigate(cmd.path, { state: cmd.state });
    onClose();
  };

  const handleSelectSession = (session: ChatSession) => {
    setActiveChatId(session.id);
    navigate(`/chat/${session.id}`);
    onClose();
  };

  const handleSelectResult = (result: QuickSearchResult) => {
    if (result.kind === "conversation" || result.kind === "message") {
      if (result.session_id) {
        setActiveChatId(result.session_id);
        navigate(`/chat/${result.session_id}`);
      }
    } else if (result.kind === "artifact") {
      // Artifacts are usually opened in the artifact panel or chat
      if (result.session_id) {
        setActiveChatId(result.session_id);
        navigate(`/chat/${result.session_id}`);
      }
    } else {
      // Default fallback
      if (result.session_id) {
        navigate(`/chat/${result.session_id}`);
      }
    }
    onClose();
  };

  const filteredCommands = COMMANDS.filter(cmd =>
    cmd.label.toLowerCase().includes(query.toLowerCase()) ||
    cmd.value.toLowerCase().includes(query.toLowerCase())
  );

  const filteredRecent = recentSessions.filter(s =>
    (s.title || "Untitled Chat").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) { onClose(); } }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <Command
        shouldFilter={false}
        className="relative z-10 w-full max-w-[560px] mx-4 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden"
        onKeyDown={(e) => { if (e.key === "Escape") { onClose(); } }}
      >
        <div className="flex items-center border-b border-[var(--border-color)] px-4">
          <Search size={16} className="text-[var(--text-muted)] mr-3" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search commands, chats, or content…"
            className="w-full py-3.5 text-sm text-[var(--text-primary)] bg-transparent outline-none placeholder:text-[var(--text-muted)]"
          />
          {isLoading && (
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              <RefreshCw size={10} className="animate-spin" />
              Searching
            </div>
          )}
        </div>
        <Command.List className="max-h-[380px] overflow-y-auto p-1.5">
          <Command.Empty className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
            No results found.
          </Command.Empty>

          {searchResults.length > 0 && (
            <Command.Group heading="Search Results" className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--text-muted)] [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
              {searchResults.map((result) => (
                <Command.Item
                  key={result.doc_id}
                  value={result.doc_id}
                  onSelect={() => handleSelectResult(result)}
                  className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg cursor-default text-[var(--text-primary)] aria-selected:bg-[var(--accent-color)]/20 aria-selected:text-[var(--accent-color)] transition-colors"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--bg-primary)] text-[var(--accent-color)]">
                    {result.kind === "message" ? <MessageSquare size={13} /> :
                     result.kind === "artifact" ? <FileText size={13} /> :
                     result.kind === "memory" ? <Brain size={13} /> :
                     result.kind === "summary" ? <Sparkles size={13} /> :
                     <MessageSquare size={13} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{result.title || "Untitled"}</div>
                    {result.excerpt && (
                      <div className="truncate text-[11px] text-[var(--text-muted)] mt-0.5">
                        {result.excerpt}
                      </div>
                    )}
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {filteredRecent.length > 0 && (
            <Command.Group heading="Recent Chats" className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--text-muted)] [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
              {filteredRecent.map((session) => (
                <Command.Item
                  key={session.id}
                  value={`chat ${session.title} ${session.id}`}
                  onSelect={() => handleSelectSession(session)}
                  className="flex items-center justify-between px-3 py-2.5 text-sm rounded-lg cursor-default text-[var(--text-primary)] aria-selected:bg-[var(--accent-color)]/20 aria-selected:text-[var(--accent-color)] transition-colors"
                >
                  <div className="flex items-center gap-3 truncate">
                    <Clock size={13} className="text-[var(--text-muted)] shrink-0" />
                    <span className="truncate">{session.title || "Untitled Chat"}</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0 ml-4">
                    {formatRelativeTime(session.last_accessed_at)}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {filteredCommands.length > 0 && (
            <Command.Group heading="Navigate" className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--text-muted)] [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
              {filteredCommands.map((cmd) => (
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
          )}
        </Command.List>
      </Command>
    </div>
  );
}
