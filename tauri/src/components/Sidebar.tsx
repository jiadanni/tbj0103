import { useWorkspaceStore } from "../stores/workspaceStore";
import { useNavigate, useLocation } from "react-router-dom";
import {
  MessageSquare, Network, BookOpen, Calendar, CreditCard,
  FolderOpen, FileText, Map, Settings, Archive, Zap, Link2,
  BarChart2, PuzzleIcon, SplitSquareHorizontal,
  Globe, GitMerge, LayoutGrid, FileEdit, MessagesSquare,
} from "lucide-react";

interface SidebarProps {
  onOpenCommandPalette: () => void;
}

// Primary nav matches Swift NavigationView enum order exactly
const NAV_ITEMS = [
  { path: "/project",       icon: BarChart2,             label: "Dashboard"        },
  { path: "/chat",          icon: MessageSquare,          label: "Chat"             },
  { path: "/chat-sessions", icon: MessagesSquare,         label: "Chat Sessions"    },
  { path: "/notes",         icon: FileEdit,               label: "Notes"            },
  { path: "/daily",         icon: Calendar,               label: "Daily Notes"      },
  { path: "/documents",     icon: FileText,               label: "Documents"        },
  { path: "/webcapture",    icon: Globe,                  label: "Web Captures"     },
  { path: "/graph",         icon: Network,                label: "Knowledge Graph"  },
  { path: "/flashcards",    icon: CreditCard,             label: "Flashcards"       },
  { path: "/learning",      icon: Map,                    label: "Learning Paths"   },
  { path: "/plugins",       icon: PuzzleIcon,             label: "Plugins"          },
  { path: "/compare",       icon: SplitSquareHorizontal,  label: "Compare Models"   },
  { path: "/backup",        icon: Archive,                label: "Backups"          },
];

// Secondary nav
const SECONDARY_ITEMS = [
  { path: "/grounded",   icon: BookOpen,    label: "Grounded Chat"  },
  { path: "/backlinks",  icon: Link2,       label: "Backlinks"      },
  { path: "/dedup",      icon: GitMerge,    label: "Deduplication"  },
  { path: "/workspaces", icon: LayoutGrid,  label: "Workspaces"     },
  { path: "/settings",   icon: Settings,    label: "Settings"       },
];

export default function Sidebar({ onOpenCommandPalette }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    projects, activeProjectId, setActiveProjectId, isDemoMode,
  } = useWorkspaceStore();

  function selectProject(id: string) {
    setActiveProjectId(id);
    navigate("/project");
  }

  const activeSegment = "/" + location.pathname.split("/")[1];

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
                onClick={() => selectProject(p.id)}
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

        {/* Secondary items */}
        <div className="pt-2 mt-2 border-t border-[var(--border-color)]">
          {SECONDARY_ITEMS.map(({ path, icon: Icon, label }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`w-full flex items-center gap-2.5 px-2 py-2 rounded text-xs transition-colors ${
                activeSegment === path
                  ? "bg-[var(--accent-color)]/20 text-[var(--accent-color)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
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
