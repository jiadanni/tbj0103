import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { confirm } from "@tauri-apps/plugin-dialog";
import { message } from "@tauri-apps/plugin-dialog";
import { MessageSquare, Trash2, RefreshCcw, Trash, Search, ChevronLeft } from "lucide-react";
import { api } from "../lib/api";
import { useChatStore, type ChatSession } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useScopedWorkspace, useBubbleUpFlag } from "../lib/workspacePane";
import { Tooltip } from "../components/Tooltip";

export default function RecycleBinView() {
  const navigate = useNavigate();
  const { activeWorkspaceId, isSplitPane } = useScopedWorkspace();
  const includeDescendants = useBubbleUpFlag();
  const setSessions = useChatStore((s) => s.setSessions);
  const modelLabels = useSettingsStore((s) => s.modelLabels);
  const isDemoMode = useWorkspaceStore((s) => s.isDemoMode);
  const [deletedSessions, setDeletedSessions] = useState<ChatSession[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDeletedSessions() {
      if (!activeWorkspaceId) {return;}
      setLoading(true);
      try {
        const sessions = await api.chat.listDeletedSessions(activeWorkspaceId, { includeDescendants });
        setDeletedSessions(sessions);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    loadDeletedSessions();
  }, [activeWorkspaceId, includeDescendants]);

  async function restoreSession(id: string) {
    if (!activeWorkspaceId) {return;}
    try {
      await api.chat.restoreSession(activeWorkspaceId, id);
      setDeletedSessions(prev => prev.filter(s => s.id !== id));
      // Refresh the main sessions list in the store
      const refreshed = await api.chat.listSessions(activeWorkspaceId, null, { limit: 200, offset: 0, includeDescendants });
      setSessions(refreshed);
    } catch (e) {
      console.error(e);
    }
  }

  async function hardDeleteSession(id: string) {
    if (isDemoMode) {
      await message("Permanent deletion is not available in Demo Mode.", { title: "Demo Mode" });
      return;
    }
    if (!activeWorkspaceId || !await confirm("Permanently delete this chat? This cannot be undone.", {
      title: "Delete chat permanently?",
      kind: "warning",
    })) {return;}
    try {
      await api.chat.hardDeleteSession(activeWorkspaceId, id);
      setDeletedSessions(prev => prev.filter(s => s.id !== id));
    } catch (e) {
      console.error(e);
    }
  }

  async function emptyRecycleBin() {
    if (!activeWorkspaceId || !await confirm("Permanently delete all chats in the recycle bin?", {
      title: "Empty recycle bin?",
      kind: "warning",
    })) {return;}
    try {
      await api.chat.emptyRecycleBin(activeWorkspaceId);
      setDeletedSessions([]);
    } catch (e) {
      console.error(e);
    }
  }

  const filtered = deletedSessions.filter(
    (s) =>
      s.title.toLowerCase().includes(query.toLowerCase()) ||
      s.model_name.toLowerCase().includes(query.toLowerCase())
  );

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => { if (!isSplitPane) {navigate(-1);} }} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] disabled:opacity-40" disabled={isSplitPane}>
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-sm font-semibold text-[var(--text-primary)]">Recycle Bin</h1>
            <p className="text-[11px] text-[var(--text-muted)]">Deleted chat sessions</p>
          </div>
        </div>
        {deletedSessions.length > 0 && (
          <button
            onClick={emptyRecycleBin}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            <Trash size={12} /> Empty Trash
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-[var(--border-color)] shrink-0">
        <div className="flex items-center gap-2 bg-[var(--bg-elevated)] rounded-lg px-3 py-1.5">
          <Search size={12} className="text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search deleted sessions…"
            className="flex-1 text-xs bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-xs">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)]">
            <Trash2 size={32} className="opacity-30" />
            <p className="text-sm">{query ? "No matches found" : "Recycle bin is empty"}</p>
          </div>
        ) : (
          filtered.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] group">
              <MessageSquare size={14} className="text-[var(--text-muted)] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[var(--text-primary)] truncate">{s.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-[var(--text-muted)]">{modelLabels[s.model_name] || s.model_name}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">·</span>
                  <span className="text-[10px] text-[var(--text-muted)]">Deleted {s.deleted_at ? formatDate(s.deleted_at) : formatDate(s.updated_at)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Tooltip content="Restore" position="top">
                  <button
                    onClick={() => restoreSession(s.id)}
                    className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-color)] hover:bg-[var(--bg-hover)] rounded"
                  >
                    <RefreshCcw size={14} />
                  </button>
                </Tooltip>
                <Tooltip content="Delete permanently" position="top">
                  <button
                    onClick={() => hardDeleteSession(s.id)}
                    className="p-1.5 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 rounded"
                  >
                    <Trash size={14} />
                  </button>
                </Tooltip>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
