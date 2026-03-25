import { useWorkspaceStore } from "../stores/workspaceStore";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Zap,
  Settings as SettingsIcon,
} from "lucide-react";
import { PRIMARY_NAV_ITEMS } from "./navigationItems";

interface SidebarProps {
  onOpenCommandPalette: () => void;
}

export default function Sidebar({ onOpenCommandPalette }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceNavigation } = useWorkspaceStore();
  const activeSegment = "/" + location.pathname.split("/")[1];

  if (workspaceNavigation !== "sidebar") {
    return null;
  }

  return (
    <div className="flex h-full flex-col bg-[var(--bg-sidebar)]">
      {/* Scrollable nav section */}
      <div className="flex-1 overflow-y-auto py-4">
        <nav className="px-3 space-y-1">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const isActive = activeSegment === item.path;
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors ${
                  isActive
                    ? "bg-[var(--accent-color)] text-white shadow-sm"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon size={18} />
                <span className="flex-1 text-left">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Fixed bottom actions */}
      <div className="p-4 border-t border-[var(--border-color)] space-y-2">
        <button
          onClick={() => navigate("/preferences")}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors ${
            activeSegment === "/preferences"
              ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          }`}
        >
          <SettingsIcon size={18} />
          <span className="flex-1 text-left">Preferences</span>
        </button>

        <button
          onClick={onOpenCommandPalette}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
        >
          <Zap size={18} />
          <span className="flex-1 text-left">Command Palette</span>
          <kbd className="text-[10px] px-1 py-0.5 bg-[var(--bg-hover)] rounded font-mono">⌘K</kbd>
        </button>
      </div>
    </div>
  );
}
