/**
 * ChatSessionListView — browse, rename, pin and delete chat sessions.
 * Mirrors ChatSessionListView.swift: table of sessions with actions.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Pin, PinOff, Trash2, Plus, Search, ExternalLink } from "lucide-react";
import { api } from "../lib/api";
import { useChatStore, findUnusedSession } from "../stores/chatStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { ChatSession } from "../stores/chatStore";

export default function ChatSessionListView() {
  const navigate = useNavigate();
  const { activeProjectId, projects, activeWorkspaceId } = useWorkspaceStore();
  const { sessions, setSessions, setActiveChatId, messages, removeSession } = useChatStore();
  const { modelLabels } = useSettingsStore();
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  useEffect(() => {
    if (!activeWorkspaceId) {return;}
    api.chat.listSessions(activeWorkspaceId, activeProjectId).then(setSessions).catch(() => {});
  }, [activeWorkspaceId, activeProjectId]);

  const filtered = sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(query.toLowerCase()) ||
      s.model_name.toLowerCase().includes(query.toLowerCase())
  );

  const pinned = filtered.filter((s) => s.is_pinned);
  const unpinned = filtered.filter((s) => !s.is_pinned);

  async function openSession(session: ChatSession) {
    setActiveChatId(session.id);
    navigate(`/chat/${session.id}`);
  }

  async function togglePin(session: ChatSession) {
    if (!activeWorkspaceId) {return;}
    await api.chat.updateSession(activeWorkspaceId, session.id, { is_pinned: !session.is_pinned });
    setSessions(
      sessions.map((s) =>
        s.id === session.id ? { ...s, is_pinned: !s.is_pinned } : s
      )
    );
  }

  async function deleteSession(id: string) {
    if (!activeWorkspaceId) {return;}
    const settings = useSettingsStore.getState();
    const isImmediate = settings.immediateDelete;
    const skipConfirm = !isImmediate && !settings.confirmMoveToTrash;

    if (!skipConfirm) {
      const confirmMsg = isImmediate 
        ? "Permanently delete this chat session and all its messages? This cannot be undone."
        : "Move this chat to the recycle bin?";

      if (!window.confirm(confirmMsg)) {return;}
    }

    await api.chat.deleteSession(activeWorkspaceId, id);
    removeSession(id);
    if (setActiveChatId) {
      const currentActive = useChatStore.getState().activeChatId;
      if (currentActive === id) {setActiveChatId(null);}
    }
  }

  async function renameSession(id: string) {
    if (!editTitle.trim() || !activeWorkspaceId) { setEditingId(null); return; }
    await api.chat.updateSession(activeWorkspaceId, id, { title: editTitle });
    setSessions(sessions.map((s) => s.id === id ? { ...s, title: editTitle } : s));
    setEditingId(null);
  }

  async function createSession() {
    if (!activeWorkspaceId) {return;}
    
    // Look for an unused session first
    const unusedSession = findUnusedSession(sessions, messages, activeProjectId, {
      isIncognito: false,
      excludeFromAnalytics: false,
    });
    if (unusedSession) {
      setActiveChatId(unusedSession.id);
      navigate(`/chat/${unusedSession.id}`);
      return;
    }

    const session = await api.chat.createSession(activeWorkspaceId, activeProjectId);
    setSessions([session, ...sessions]);
    setActiveChatId(session.id);
    navigate(`/chat/${session.id}`);
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  const projectName = projects.find((p) => p.id === activeProjectId)?.name;

  function SessionRow({ session }: { session: ChatSession }) {
    const isEditing = editingId === session.id;
    return (
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] group">
        <MessageSquare size={14} className="text-[var(--text-muted)] shrink-0" />
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {renameSession(session.id);}
                if (e.key === "Escape") {setEditingId(null);}
              }}
              onBlur={() => renameSession(session.id)}
              className="w-full text-xs font-medium bg-[var(--bg-elevated)] border border-[var(--accent-color)] rounded px-2 py-0.5 text-[var(--text-primary)] outline-none"
            />
          ) : (
            <button
              onClick={() => openSession(session)}
              className="text-xs font-medium text-left text-[var(--text-primary)] hover:text-[var(--accent-color)] truncate w-full"
            >
              {session.title}
            </button>
          )}
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-[var(--text-muted)]">{modelLabels[session.model_name] || session.model_name}</span>
            <span className="text-[10px] text-[var(--text-muted)]">·</span>
            <span className="text-[10px] text-[var(--text-muted)]">{formatDate(session.updated_at)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => { setEditingId(session.id); setEditTitle(session.title); }}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-[10px]"
            title="Rename"
          >
            ✎
          </button>
          <button
            onClick={() => togglePin(session)}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-color)]"
            title={session.is_pinned ? "Unpin" : "Pin"}
          >
            {session.is_pinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
          <button
            onClick={() => openSession(session)}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-color)]"
            title="Open"
          >
            <ExternalLink size={12} />
          </button>
          <button
            onClick={() => deleteSession(session.id)}
            className="p-1 text-[var(--text-muted)] hover:text-red-400"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">Chat Sessions</h1>
          {projectName && (
            <p className="text-[11px] text-[var(--text-muted)]">{projectName}</p>
          )}
        </div>
        <button
          onClick={createSession}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90"
        >
          <Plus size={12} /> New Chat
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-[var(--border-color)] shrink-0">
        <div className="flex items-center gap-2 bg-[var(--bg-elevated)] rounded-lg px-3 py-1.5">
          <Search size={12} className="text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions…"
            className="flex-1 text-xs bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)]">
            <MessageSquare size={32} className="opacity-30" />
            <p className="text-sm">No chat sessions yet</p>
            <button onClick={createSession} className="text-xs text-[var(--accent-color)] hover:underline">
              + Start a new chat
            </button>
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-sidebar)]">
                  Pinned
                </div>
                {pinned.map((s) => <SessionRow key={s.id} session={s} />)}
              </>
            )}
            {unpinned.length > 0 && (
              <>
                {pinned.length > 0 && (
                  <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-sidebar)]">
                    All Sessions
                  </div>
                )}
                {unpinned.map((s) => <SessionRow key={s.id} session={s} />)}
              </>
            )}
          </>
        )}
      </div>

      {/* Footer stats */}
      {sessions.length > 0 && (
        <div className="px-5 py-2 border-t border-[var(--border-color)] shrink-0">
          <p className="text-[11px] text-[var(--text-muted)]">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""} · {pinned.length} pinned
          </p>
        </div>
      )}
    </div>
  );
}
