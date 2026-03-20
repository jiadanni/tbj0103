import { useWorkspaceStore } from "../stores/workspaceStore";
import { useChatStore } from "../stores/chatStore";
import { useNavigate, useLocation } from "react-router-dom";
import {
  SquarePen, LayoutGrid, BarChart2, Folder, Settings,
  MessageSquare, ChevronRight
} from "lucide-react";
import { api } from "../lib/api";

interface SidebarProps {
  onOpenCommandPalette: () => void;
}

export default function Sidebar({ onOpenCommandPalette }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeProjectId } = useWorkspaceStore();
  const { sessions } = useChatStore();

  const activeSegment = "/" + location.pathname.split("/")[1];
  const activeChatId = location.pathname.startsWith("/chat/") ? location.pathname.split("/")[2] : null;

  async function handleNewThread() {
    try {
      const s = await api.chat.createSession(activeProjectId || "");
      navigate(`/chat/${s.id}`);
    } catch (e) {
      console.error(e);
    }
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
          onClick={() => navigate("/settings")} // Assuming Skills might be in settings for now
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
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
            Tokens Live
          </span>
        </button>
      </div>

      {/* Threads Section */}
      <div className="flex-1 overflow-y-auto px-3 space-y-1">
        <div className="flex items-center justify-between text-[10px] font-semibold tracking-wider text-[var(--text-muted)] px-2 mb-2 uppercase">
          <span>Threads</span>
          <Folder size={12} className="opacity-50" />
        </div>

        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => navigate(`/chat/${s.id}`)}
            className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors group ${
              activeChatId === s.id
                ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            }`}
          >
            <span className="truncate pr-2 flex-1 text-left">{s.title || "New Chat"}</span>
            <span className="text-[10px] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <ChevronRight size={12} />
            </span>
          </button>
        ))}
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
