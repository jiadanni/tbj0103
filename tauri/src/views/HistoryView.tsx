import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { useNavigate } from "react-router-dom";
import { Search, Trash2, MessageSquare, Download, Pin } from "lucide-react";
import { message } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import type { ChatSession } from "../stores/chatStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { focusWorkspaceForTarget, useBubbleUpFlag } from "../lib/workspacePane";
import { Tooltip } from "../components/Tooltip";

interface DateGroup {
  label: string;
  sessions: ChatSession[];
}

type HistoryRow =
  | { type: "group"; label: string }
  | { type: "session"; session: ChatSession };

function groupSessionsByDate(sessions: ChatSession[]): DateGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const last7Start = new Date(todayStart.getTime() - 6 * 86400000);
  const last30Start = new Date(todayStart.getTime() - 29 * 86400000);

  const buckets: Record<string, ChatSession[]> = {
    "Today": [],
    "Yesterday": [],
    "Last 7 Days": [],
    "Last 30 Days": [],
    "Older": [],
  };

  for (const session of sessions) {
    const d = new Date(session.updated_at);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (dayStart >= todayStart) {
      buckets["Today"].push(session);
    } else if (dayStart >= yesterdayStart) {
      buckets["Yesterday"].push(session);
    } else if (dayStart >= last7Start) {
      buckets["Last 7 Days"].push(session);
    } else if (dayStart >= last30Start) {
      buckets["Last 30 Days"].push(session);
    } else {
      buckets["Older"].push(session);
    }
  }

  return Object.entries(buckets)
    .filter(([, s]) => s.length > 0)
    .map(([label, s]) => ({ label, sessions: s }));
}

export default function HistoryView() {
  const navigate = useNavigate();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const isDemoMode = useWorkspaceStore((s) => s.isDemoMode);
  const includeDescendants = useBubbleUpFlag();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("all");
  const [filterType, setFilterType] = useState<"all" | "imported" | "pinned">("all");

  const workspaceMap = useMemo(() => {
    return new Map(workspaces.map((w) => [w.id, w.name]));
  }, [workspaces]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      // One query across workspaces; the pinned/imported filters run in SQL so they
      // cover the full history instead of a per-workspace capped page.
      const allWorkspaces = workspaceFilter === "all";
      const results = await api.chat.listHistorySessions({
        workspaceId: allWorkspaces ? null : workspaceFilter,
        query: query.trim(),
        filter: filterType,
        includeDescendants: allWorkspaces ? false : includeDescendants,
      });
      setSessions(results);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceFilter, query, filterType, includeDescendants]);

  useEffect(() => {
    const timer = setTimeout(loadSessions, query ? 150 : 0);
    return () => clearTimeout(timer);
  }, [loadSessions, query]);

  async function handleDelete(session: ChatSession, e: React.MouseEvent) {
    e.stopPropagation();
    if (isDemoMode) {
      await message("Chat deletion is not available in Demo Mode.", { title: "Demo Mode" });
      return;
    }
    await api.chat.deleteSession(session.workspace_id, session.id);
    setSessions((prev) => prev.filter((s) => s.id !== session.id));
  }

  function handleOpenSession(session: ChatSession) {
    if (session.workspace_id) {
      focusWorkspaceForTarget(session.workspace_id, { folderId: session.folder_id, chatSessionId: session.id });
    }
    navigate(`/chat/${session.id}`);
  }

  const groups = groupSessionsByDate(sessions);
  const rows: HistoryRow[] = groups.flatMap((group) => [
    { type: "group" as const, label: group.label },
    ...group.sessions.map((session) => ({ type: "session" as const, session })),
  ]);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-[var(--border-color)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">History</h1>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Browse, search, and jump to past conversations across your workspaces.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={workspaceFilter}
              onChange={(e) => setWorkspaceFilter(e.target.value)}
              className="h-8 px-2.5 text-xs rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)] transition-colors"
              title="Filter by workspace"
            >
              <option value="all">All Workspaces</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1 max-w-lg">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search history…"
              className="w-full pl-9 pr-4 py-1.5 text-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] transition-colors"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilterType("all")}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                filterType === "all"
                  ? "bg-[var(--accent-color)] text-white"
                  : "bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilterType("imported")}
              className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                filterType === "imported"
                  ? "bg-[var(--accent-color)] text-white"
                  : "bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
              }`}
            >
              <Download size={12} />
              Imported
            </button>
            <button
              type="button"
              onClick={() => setFilterType("pinned")}
              className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                filterType === "pinned"
                  ? "bg-[var(--accent-color)] text-white"
                  : "bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
              }`}
            >
              <Pin size={12} />
              Pinned
            </button>
          </div>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 min-h-0 px-6 py-4">
        {loading && sessions.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)] text-center py-12">Loading…</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)] text-center py-12">
            {query
              ? "No results found."
              : filterType === "imported"
                ? "No imported chat history found. When you import chats from Claude, ChatGPT, or LM Studio, they will appear here."
                : "No chat history yet."}
          </div>
        ) : (
          <Virtuoso
            className="h-full"
            data={rows}
            initialItemCount={Math.min(rows.length, 20)}
            computeItemKey={(_, row) => row.type === "group" ? `group-${row.label}` : row.session.id}
            itemContent={(_, row) => {
              if (row.type === "group") {
                return (
                  <div className="mb-2 mt-4 px-3 first:mt-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      {row.label}
                    </div>
                  </div>
                );
              }

              const { session } = row;
              const wsName = workspaceMap.get(session.workspace_id);

              return (
                <div className="pb-0.5">
                  <div
                    onClick={() => handleOpenSession(session)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-[var(--bg-hover)] transition-colors group cursor-pointer"
                  >
                    <MessageSquare size={15} className="shrink-0 text-[var(--text-muted)]" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--text-primary)] truncate flex items-center gap-1.5">
                        {session.is_unread && (
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] shrink-0"
                            title="Unread"
                          />
                        )}
                        <span className={`truncate ${session.is_unread ? "font-semibold" : ""}`}>{session.title || "Untitled"}</span>
                        {session.is_imported && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                            <Download size={10} /> Imported
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] flex items-center gap-2 mt-0.5">
                        <span>
                          {new Date(session.updated_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {wsName && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[10px] text-[var(--text-secondary)] truncate max-w-[160px]">
                            {wsName}
                          </span>
                        )}
                        {session.model_name && (
                          <span className="truncate opacity-70">{session.model_name}</span>
                        )}
                      </div>
                    </div>
                    <Tooltip content="Delete" position="top">
                      <button
                        onClick={(e) => { void handleDelete(session, e); }}
                        className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-red-400 transition-all"
                      >
                        <Trash2 size={13} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}

