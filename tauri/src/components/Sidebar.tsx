import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useNavigate, useLocation } from "react-router-dom";
import {
  ExternalLink,
  Zap,
  Settings as SettingsIcon,
} from "lucide-react";
import { PRIMARY_NAV_ITEMS } from "./navigationItems";
import type { NavigationItem } from "./navigationItems";

interface SidebarProps {
  onOpenCommandPalette: () => void;
  iconOnly?: boolean;
}

export default function Sidebar({ onOpenCommandPalette, iconOnly = false }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const sectionNavigation = useWorkspaceStore((state) => state.sectionNavigation);
  const activeSegment = "/" + location.pathname.split("/")[1];
  const [contextMenu, setContextMenu] = useState<{ item: NavigationItem; x: number; y: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ label: string; top: number; left: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  function showTooltip(label: string, element: HTMLElement) {
    if (!iconOnly) {return;}
    const rect = element.getBoundingClientRect();
    setTooltip({
      label,
      top: rect.top + rect.height / 2,
      left: rect.right + 12,
    });
  }

  function hideTooltip() {
    setTooltip(null);
  }

  useEffect(() => {
    if (!contextMenu) {return;}

    function handlePointerDown(event: MouseEvent) {
      if (contextMenuRef.current?.contains(event.target as Node)) {return;}
      setContextMenu(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("contextmenu", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("contextmenu", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!tooltip) {return;}

    function handleViewportChange() {
      setTooltip(null);
    }

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [tooltip]);

  useEffect(() => {
    setTooltip(null);
  }, [location.pathname, iconOnly]);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) {return;}
    const el = contextMenuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = contextMenu.x;
    let y = contextMenu.y;
    if (rect.right > window.innerWidth - pad) { x = window.innerWidth - rect.width - pad; }
    if (rect.bottom > window.innerHeight - pad) { y = window.innerHeight - rect.height - pad; }
    if (x < pad) { x = pad; }
    if (y < pad) { y = pad; }
    if (x !== contextMenu.x || y !== contextMenu.y) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }, [contextMenu]);

  if (sectionNavigation !== "sidebar" && sectionNavigation !== "icon-bar") {
    return null;
  }

  return (
    <div className={`flex h-full flex-col bg-[var(--bg-sidebar)] ${iconOnly ? "items-center" : ""}`}>
      {/* Scrollable nav section */}
      <div className={`flex-1 overflow-y-auto py-4 ${iconOnly ? "w-full" : ""}`}>
        <nav className={iconOnly ? "flex flex-col items-center gap-1 px-1.5" : "px-3 space-y-1"}>
          {PRIMARY_NAV_ITEMS.map((item) => {
            const isActive = activeSegment === item.path;
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => {
                  navigate(item.path);
                  setContextMenu(null);
                  setTooltip(null);
                }}
                onMouseEnter={(event) => showTooltip(item.label, event.currentTarget)}
                onMouseLeave={hideTooltip}
                onFocus={(event) => showTooltip(item.label, event.currentTarget)}
                onBlur={hideTooltip}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setTooltip(null);
                  setContextMenu({ item, x: event.clientX, y: event.clientY });
                }}
                aria-label={iconOnly ? item.label : undefined}
                className={
                  iconOnly
                    ? `flex items-center justify-center w-10 h-10 rounded-xl transition-colors select-none ${
                        isActive
                          ? "bg-[var(--accent-color)] text-white shadow-sm"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      }`
                    : `w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors select-none ${
                        isActive
                          ? "bg-[var(--accent-color)] text-white shadow-sm"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      }`
                }
              >
                <Icon size={iconOnly ? 20 : 18} />
                {!iconOnly && <span className="flex-1 text-left">{item.label}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Fixed bottom actions */}
      <div className={`border-t border-[var(--border-color)] ${iconOnly ? "p-2 flex flex-col items-center gap-1" : "p-4 space-y-2"}`}>
        <button
          onClick={() => {
            setTooltip(null);
            navigate("/preferences");
          }}
          onMouseEnter={(event) => showTooltip("Preferences", event.currentTarget)}
          onMouseLeave={hideTooltip}
          onFocus={(event) => showTooltip("Preferences", event.currentTarget)}
          onBlur={hideTooltip}
          aria-label={iconOnly ? "Preferences" : undefined}
          className={
            iconOnly
              ? `flex items-center justify-center w-10 h-10 rounded-xl transition-colors ${
                  activeSegment === "/preferences"
                    ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`
              : `w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors ${
                  activeSegment === "/preferences"
                    ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`
          }
        >
          <SettingsIcon size={iconOnly ? 20 : 18} />
          {!iconOnly && <span className="flex-1 text-left">Preferences</span>}
        </button>

        <button
          onClick={() => {
            setTooltip(null);
            onOpenCommandPalette();
          }}
          onMouseEnter={(event) => showTooltip("Command Palette (⌘K)", event.currentTarget)}
          onMouseLeave={hideTooltip}
          onFocus={(event) => showTooltip("Command Palette (⌘K)", event.currentTarget)}
          onBlur={hideTooltip}
          aria-label={iconOnly ? "Command Palette (⌘K)" : undefined}
          className={
            iconOnly
              ? "flex items-center justify-center w-10 h-10 rounded-xl text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
              : "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
          }
        >
          <Zap size={iconOnly ? 20 : 18} />
          {!iconOnly && (
            <>
              <span className="flex-1 text-left">Command Palette</span>
              <kbd className="text-[10px] px-1 py-0.5 bg-[var(--bg-hover)] rounded font-mono">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      {iconOnly && tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-40 -translate-y-1/2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] shadow-lg"
          style={{ top: tooltip.top, left: tooltip.left }}
        >
          {tooltip.label}
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          data-sidebar-section-context-menu
          className="fixed z-50 min-w-[190px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] backdrop-blur-xl py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              navigate(contextMenu.item.path);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <ExternalLink size={11} /> Open section
          </button>
          <button
            onClick={() => {
              navigate("/preferences", { state: { settingsTab: "appearance" } });
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <SettingsIcon size={11} /> Customize navigation
          </button>
        </div>
      )}
    </div>
  );
}
