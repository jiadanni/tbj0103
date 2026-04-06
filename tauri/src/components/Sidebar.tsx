import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useNavigate, useLocation } from "react-router-dom";
import {
  ExternalLink,
  Zap,
  Settings as SettingsIcon,
  ChevronUp,
} from "lucide-react";
import { PRIMARY_NAV_ITEMS } from "./navigationItems";
import type { NavigationItem } from "./navigationItems";
import { api } from "../lib/api";

const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 22;

interface SidebarProps {
  onOpenCommandPalette: () => void;
  iconOnly?: boolean;
}

export default function Sidebar({ onOpenCommandPalette, iconOnly = false }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const sectionNavigation = useWorkspaceStore((state) => state.sectionNavigation);
  const activeSegment = "/" + location.pathname.split("/")[1];
  const fontSize = useSettingsStore((s) => s.fontSize);
  const [contextMenu, setContextMenu] = useState<{ item: NavigationItem; x: number; y: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ label: string; top: number; left: number; path: string; iconOnly: boolean } | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  function showTooltip(label: string, element: HTMLElement) {
    if (!iconOnly) {return;}
    const rect = element.getBoundingClientRect();
    setTooltip({
      label,
      top: rect.top + rect.height / 2,
      left: rect.right + 12,
      path: location.pathname,
      iconOnly,
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
    if (!popoverOpen) {return;}

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) {return;}
      setPopoverOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") { setPopoverOpen(false); }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [popoverOpen]);

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

  function changeFontSize(delta: number) {
    const next = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, fontSize + delta));
    if (next === fontSize) {return;}
    useSettingsStore.getState().setFontSize(next);
    api.settings.get().then((s) => {
      api.settings.update({ ...s, font_size: next }).catch(() => {});
    }).catch(() => {});
  }

  if (sectionNavigation !== "sidebar" && sectionNavigation !== "icon-bar") {
    return null;
  }

  const visibleTooltip = tooltip && tooltip.path === location.pathname && tooltip.iconOnly === iconOnly
    ? tooltip
    : null;

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

      {/* Fixed bottom trigger */}
      <div className={`relative border-t border-[var(--border-color)] ${iconOnly ? "p-2 flex flex-col items-center" : "p-3"}`}>
        <button
          ref={triggerRef}
          onClick={() => {
            setTooltip(null);
            setPopoverOpen((prev) => !prev);
          }}
          onMouseEnter={(event) => showTooltip("Menu", event.currentTarget)}
          onMouseLeave={hideTooltip}
          aria-label="Menu"
          className={
            iconOnly
              ? `flex items-center justify-center w-10 h-10 rounded-xl transition-colors ${
                  popoverOpen
                    ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`
              : `w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors ${
                  popoverOpen
                    ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`
          }
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--accent-color)] text-white text-xs font-bold">
            A
          </div>
          {!iconOnly && (
            <>
              <span className="flex-1 text-left font-medium">Aetherium</span>
              <ChevronUp size={14} className={`transition-transform ${popoverOpen ? "" : "rotate-180"}`} />
            </>
          )}
        </button>

        {/* Popover menu */}
        {popoverOpen && (
          <div
            ref={popoverRef}
            className="absolute bottom-full left-2 right-2 mb-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] backdrop-blur-xl py-1.5 shadow-xl z-50"
            style={iconOnly ? { left: 0, right: "auto", minWidth: 200 } : undefined}
          >
            {/* Font size controls */}
            <div className="px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Font Size</div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => changeFontSize(-1)}
                  disabled={fontSize <= MIN_FONT_SIZE}
                  className="rounded-lg border border-[var(--border-color)] px-2.5 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  A-
                </button>
                <span className="text-xs font-medium text-[var(--text-muted)] w-7 text-center bg-[var(--bg-hover)] px-1.5 py-1 rounded-md">
                  {fontSize}
                </span>
                <button
                  onClick={() => changeFontSize(1)}
                  disabled={fontSize >= MAX_FONT_SIZE}
                  className="rounded-lg border border-[var(--border-color)] px-2.5 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  A+
                </button>
              </div>
            </div>

            <div className="mx-2 border-t border-[var(--border-color)]" />

            {/* Preferences */}
            <button
              onClick={() => {
                setPopoverOpen(false);
                navigate("/preferences");
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <SettingsIcon size={16} />
              <span>Preferences</span>
            </button>

            {/* Command Palette */}
            <button
              onClick={() => {
                setPopoverOpen(false);
                onOpenCommandPalette();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Zap size={16} />
              <span className="flex-1">Command Palette</span>
              <kbd className="text-[10px] px-1 py-0.5 bg-[var(--bg-hover)] rounded font-mono text-[var(--text-muted)]">⌘K</kbd>
            </button>
          </div>
        )}
      </div>

      {iconOnly && visibleTooltip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-40 -translate-y-1/2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] shadow-lg"
          style={{ top: visibleTooltip.top, left: visibleTooltip.left }}
        >
          {visibleTooltip.label}
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
