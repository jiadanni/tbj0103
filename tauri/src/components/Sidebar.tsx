import { useWorkspaceStore } from "../stores/workspaceStore";
import { api } from "../lib/api";
import { useNavigate, useLocation } from "react-router-dom";
import {
  MessageSquare, Network, BookOpen, Calendar, CreditCard,
  FolderOpen, FileText, Map, Settings, Archive, Plus, Zap, Link2,
} from "lucide-react";
import { useState } from "react";

interface SidebarProps {
  onOpenCommandPalette: () => void;
}

const NAV_ITEMS = [
  { path: "/chat",      icon: MessageSquare, label: "Chat"           },
  { path: "/grounded",  icon: BookOpen,      label: "Grounded Chat"  },
  { path: "/daily",     icon: Calendar,      label: "Daily Notes"    },
  { path: "/graph",     icon: Network,       label: "Knowledge Graph"},
  { path: "/backlinks", icon: Link2,         label: "Backlinks"      },
  { path: "/flashcards",icon: CreditCard,    label: "Flashcards"     },
  { path: "/project",   icon: FolderOpen,    label: "Projects"       },
  { path: "/documents", icon: FileText,      label: "Documents"      },
  { path: "/learning",  icon: Map,           label: "Learning Paths" },
  { path: "/backup",    icon: Archive,       label: "Backups"        },
  { path: "/settings",  icon: Settings,      label: "Settings"       },
];

export default function Sidebar({ onOpenCommandPalette }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    workspaces, activeWorkspaceId, setActiveWorkspaceId,
    projects, activeProjectId, setActiveProjectId, isDemoMode,
  } = useWorkspaceStore();
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [newWsName, setNewWsName] = useState("");

  const activeSegment = "/" + location.pathname.split("/")[1];

  async function createWorkspace() {
    if (!newWsName.trim()) return;
    const ws = await api.workspace.create(newWsName.trim());
    useWorkspaceStore.getState().addWorkspace(ws);
    setActiveWorkspaceId(ws.id);
    setNewWsName("");
    setCreatingWorkspace(false);
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-sidebar)] text-sm select-none">
      {/* App title + demo badge */}
      <div className="px-3 py-3 flex items-center gap-2 border-b border-[var(--border-color)]">
        <Zap size={16} className="text-[var(--accent-color)]" />
        <span className="font-semibold text-[var(--text-primary)]">Aetherium</span>
        {isDemoMode && (
          <span className="ml-auto text-[10px] px-1.5 py-0.5 bg-amber-400/30 text-amber-400 rounded font-mono">
            DEMO
          </span>
        )}
      </div>

      {/* Workspace selector */}
      <div className="px-2 pt-2 pb-1">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] px-1 mb-1">
          Workspaces
        </div>
        <div className="space-y-0.5 max-h-32 overflow-y-auto">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => setActiveWorkspaceId(ws.id)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs truncate transition-colors ${
                activeWorkspaceId === ws.id
                  ? "bg-[var(--accent-color)]/20 text-[var(--accent-color)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {ws.name}
            </button>
          ))}
        </div>
        {creatingWorkspace ? (
          <div className="flex gap-1 mt-1">
            <input
              autoFocus
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createWorkspace(); if (e.key === "Escape") setCreatingWorkspace(false); }}
              placeholder="Workspace name"
              className="flex-1 text-xs px-2 py-1 rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
            <button onClick={createWorkspace} className="px-2 py-1 text-xs bg-[var(--accent-color)] text-white rounded">
              Add
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreatingWorkspace(true)}
            className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] px-1 mt-1"
          >
            <Plus size={12} /> New
          </button>
        )}
      </div>

      {/* Project list */}
      {projects.length > 0 && (
        <div className="px-2 pb-1">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] px-1 mb-1">
            Projects
          </div>
          <div className="space-y-0.5 max-h-36 overflow-y-auto">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveProjectId(p.id)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs truncate flex items-center gap-2 transition-colors ${
                  activeProjectId === p.id
                    ? "bg-[var(--accent-color)]/20 text-[var(--accent-color)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {p.icon && <span>{p.icon}</span>}
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 pt-2 space-y-0.5 overflow-y-auto">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] px-1 mb-1">
          Navigation
        </div>
        {NAV_ITEMS.map(({ path, icon: Icon, label }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className={`w-full flex items-center gap-2.5 px-2 py-2 rounded text-xs transition-colors ${
              activeSegment === path
                ? "bg-[var(--accent-color)]/20 text-[var(--accent-color)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </nav>

      {/* Bottom: cmd+K hint */}
      <div className="px-3 py-2 border-t border-[var(--border-color)]">
        <button
          onClick={onOpenCommandPalette}
          className="flex w-full items-center gap-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          <span className="flex-1 text-left">Command Palette</span>
          <kbd className="text-[10px] px-1 py-0.5 bg-[var(--bg-hover)] rounded font-mono">⌘K</kbd>
        </button>
      </div>
    </div>
  );
}
