import React, { useEffect, useState, useCallback } from "react";
import { Virtuoso } from "react-virtuoso";
import { useNavigate } from "react-router-dom";
import { Search, Trash2, MessageSquare } from "lucide-react";
import { message } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import type { ChatSession } from "../stores/chatStore";
import { useWorkspaceStore } from "../stores/workspaceStore";

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
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const isDemoMode = useWorkspaceStore((s) => s.isDemoMode);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!activeWorkspaceId) { return; }
    setLoading(true);
    try {
      const results = query.trim()
        ? await api.chat.searchSessions(activeWorkspaceId, query)
        : await api.chat.listSessions(activeWorkspaceId);
      setSessions(results.filter((s) => !s.is_deleted));
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, query]);

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

  const groups = groupSessionsByDate(sessions);
  const rows: HistoryRow[] = groups.flatMap((group) => [
    { type: "group" as const, label: group.label },
    ...group.sessions.map((session) => ({ type: "session" as const, session })),
  ]);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-[var(--border-color)]">
        <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-4">History</h1>
        <div className="relative max-w-lg">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search history…"
            className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] transition-colors"
          />
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 min-h-0 px-6 py-4">
        {loading && sessions.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)] text-center py-12">Loading…</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)] text-center py-12">
            {query ? "No results found." : "No chat history yet."}
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
              return (
                <div className="pb-0.5">
                  <div
                    onClick={() => navigate(`/chat/${session.id}`)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-[var(--bg-hover)] transition-colors group cursor-pointer"
                  >
                    <MessageSquare size={15} className="shrink-0 text-[var(--text-muted)]" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {session.title || "Untitled"}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] flex items-center gap-2 mt-0.5">
                        <span>
                          {new Date(session.updated_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {session.model_name && (
                          <span className="truncate opacity-70">{session.model_name}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { void handleDelete(session, e); }}
                      className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-red-400 transition-all"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
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
