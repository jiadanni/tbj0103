import { useEffect, useState } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useChatStore, type ChatSession } from "../stores/chatStore";
import { useNavigate, useLocation } from "react-router-dom";
import {
  SquarePen, LayoutGrid, BarChart2, Folder, Settings,
  MessageSquare, ChevronRight, ChevronDown
} from "lucide-react";
import { api } from "../lib/api";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

interface SidebarProps {
  onOpenCommandPalette: () => void;
}

export default function Sidebar({ onOpenCommandPalette }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeProjectId, activeWorkspaceId, projects } = useWorkspaceStore();
  const { sessions, setSessions } = useChatStore();

  const activeSegment = "/" + location.pathname.split("/")[1];
  const activeChatId = location.pathname.startsWith("/chat/") ? location.pathname.split("/")[2] : null;

  // Load ALL workspace sessions for sidebar (unfiltered by project)
  const [allSessions, setAllSessions] = useState<ChatSession[]>([]);
  useEffect(() => {
    if (!activeWorkspaceId) return;
    api.chat.listSessions(activeWorkspaceId, null).then(setAllSessions).catch(() => {});
  }, [activeWorkspaceId, sessions]); // re-fetch when sessions change (new chat, rename, etc.)

  // Build project groups from all sessions
  const byProject: Record<string, ChatSession[]> = {};
  const ungrouped: ChatSession[] = [];
  allSessions.forEach((s) => {
    if (s.project_id) {
      (byProject[s.project_id] ??= []).push(s);
    } else {
      ungrouped.push(s);
    }
  });

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  async function handleNewThread() {
    try {
      const s = await api.chat.createSession(activeProjectId || "");
      navigate(`/chat/${s.id}`);
    } catch (e) {
      console.error(e);
    }
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function renderThreadItem(s: ChatSession) {
    const msgCount = s.message_count_at_title_gen ?? 0;
    return (
      <button
        key={s.id}
        onClick={() => navigate(`/chat/${s.id}`)}
        className={`w-full flex items-center justify-between pl-7 pr-2 py-1.5 rounded-lg text-xs transition-colors group ${
          activeChatId === s.id
            ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        }`}
      >
        <span className="truncate pr-2 flex-1 text-left">{s.title || "New Chat"}</span>
        <span className="flex items-center gap-1.5 flex-shrink-0 text-[10px] text-[var(--text-muted)]">
          {msgCount > 0 && <span>{msgCount}</span>}
          <ChevronRight size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
          <span>{timeAgo(s.updated_at)}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col h-full bg-transparent text-sm select-none pt-8">
      {/* Top Primary Actions */}
      <div className="px-3 pb-4 space-y-1">
        <button
          onClick={handleNewThread}
          className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <SquarePen size={14} className="text-[var(--text-muted)]" />
          New thread
        </button>

        <button
          onClick={() => navigate("/settings")}
          className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
            activeSegment === "/settings" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          }`}
        >
          <LayoutGrid size={14} className="text-[var(--text-muted)]" />
          Skills
        </button>

        <button
          onClick={() => navigate("/project")}
          className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors ${
            activeSegment === "/project" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <BarChart2 size={14} className="text-[var(--text-muted)]" />
            Usage
          </div>
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            2x Tokens Live
          </span>
        </button>
      </div>

      {/* Threads Section */}
      <div className="flex-1 overflow-y-auto px-3 space-y-0.5">
        <div className="flex items-center justify-between text-[10px] font-semibold tracking-wider text-[var(--text-muted)] px-2 mb-2 uppercase">
          <span>Threads</span>
          <Folder size={12} className="opacity-50" />
        </div>

        {/* Project folders */}
        {projects.map((p) => {
          const threads = byProject[p.id] ?? [];
          const isOpen = expanded[p.id] ?? true; // default open
          const visibleThreads = isOpen ? threads.slice(0, expanded[`${p.id}_all`] ? undefined : 5) : [];
          const hasMore = threads.length > 5 && !expanded[`${p.id}_all`];

          return (
            <div key={p.id} className="mb-1">
              {/* Project folder header */}
              <button
                onClick={() => toggleExpand(p.id)}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                  activeProjectId === p.id
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Folder size={14} className="text-[var(--text-muted)] flex-shrink-0" />
                <span className="truncate">{p.name}</span>
              </button>

              {/* Threads under this project */}
              {isOpen && visibleThreads.map(renderThreadItem)}

              {isOpen && hasMore && (
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [`${p.id}_all`]: true }))}
                  className="w-full pl-7 pr-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-color)] text-left transition-colors"
                >
                  Show more
                </button>
              )}
              {isOpen && threads.length > 5 && expanded[`${p.id}_all`] && (
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [`${p.id}_all`]: false }))}
                  className="w-full pl-7 pr-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-color)] text-left transition-colors"
                >
                  Show less
                </button>
              )}
            </div>
          );
        })}

        {/* Ungrouped threads (no project) */}
        {ungrouped.length > 0 && (
          <div className="mb-1">
            {projects.length > 0 && (
              <div className="px-2 py-1.5 text-[13px] font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
                <Folder size={14} className="text-[var(--text-muted)] flex-shrink-0" />
                <span>Ungrouped</span>
              </div>
            )}
            {ungrouped.slice(0, expanded["__ungrouped_all"] ? undefined : 5).map(renderThreadItem)}
            {ungrouped.length > 5 && !expanded["__ungrouped_all"] && (
              <button
                onClick={() => setExpanded((prev) => ({ ...prev, ["__ungrouped_all"]: true }))}
                className="w-full pl-7 pr-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-color)] text-left transition-colors"
              >
                Show more
              </button>
            )}
            {ungrouped.length > 5 && expanded["__ungrouped_all"] && (
              <button
                onClick={() => setExpanded((prev) => ({ ...prev, ["__ungrouped_all"]: false }))}
                className="w-full pl-7 pr-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-color)] text-left transition-colors"
              >
                Show less
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bottom Actions */}
      <div className="p-3">
        <button
          onClick={() => navigate("/settings")}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors border border-transparent ${
            activeSegment === "/settings"
              ? "bg-[var(--bg-elevated)] border-[var(--border-color)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:border-[var(--border-color)] hover:text-[var(--text-primary)]"
          }`}
        >
          <div className="flex items-center gap-2">
            <Settings size={14} />
            Settings
          </div>
          <ChevronRight size={14} className="text-[var(--text-muted)]" />
        </button>
      </div>
    </div>
  );
}
