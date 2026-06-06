import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { useNavigate, useLocation, type NavigateOptions } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Settings as SettingsIcon,
  Zap,
} from "lucide-react";
import { PRIMARY_NAV_ITEMS } from "./navigationItems";
import type { NavigationItem } from "./navigationItems";
import { api } from "../lib/api";
import { useChatStore } from "../stores/chatStore";

const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 22;

interface SidebarProps {
  onOpenCommandPalette: () => void;
  showPreferencesButton?: boolean;
  presentation?: "sidebar" | "icon-bar";
}

export default function Sidebar({
  onOpenCommandPalette,
  showPreferencesButton = false,
  presentation = "sidebar",
}: SidebarProps) {
  const navigate = useNavigate();
  const [, startNavTransition] = useTransition();
  const goTo = (to: string, options?: NavigateOptions) =>
    startNavTransition(() => { navigate(to, options); });
  const location = useLocation();
  const activeSegment = "/" + location.pathname.split("/")[1];
  const fontSize = useSettingsStore((s) => s.fontSize);
  const [labelsVisible, setLabelsVisible] = useState(presentation !== "icon-bar");
  const [contextMenu, setContextMenu] = useState<{ item: NavigationItem; x: number; y: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ label: string; top: number; left: number; path: string } | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  function showTooltip(label: string, element: HTMLElement) {
    if (labelsVisible) {return;}
    const rect = element.getBoundingClientRect();
    setTooltip({ label, top: rect.top + rect.height / 2, left: rect.right + 12, path: location.pathname });
  }

  function hideTooltip() {
    setTooltip(null);
  }

  useEffect(() => {
    setLabelsVisible(presentation !== "icon-bar");
  }, [presentation]);

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

    // Use { once: true } so the listener auto-removes after the first scroll
    // event instead of firing on every subsequent scroll pixel.
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, { capture: true, once: true });

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
    api.settings.updateOne("font_size", next).catch(() => {});
  }

  function goToSection(path: string) {
    if (path === "/chat") {
      useChatStore.getState().setActiveChatId(null);
    }
    goTo(path);
  }

  const visibleTooltip = tooltip && tooltip.path === location.pathname ? tooltip : null;
  const isPreferencesActive = activeSegment === "/preferences";
  const activeNavClassName = "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)]";
  const inactiveNavClassName = "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";

  return (
    <div className={`flex h-full flex-col bg-[var(--bg-sidebar)] border-r border-[var(--border-color)] shrink-0 transition-[width] duration-200 ${labelsVisible ? "w-44" : "w-14 items-center"}`}>
      {/* Scrollable nav section */}
      <div className="flex-1 overflow-y-auto py-4 w-full">
        <nav className={labelsVisible ? "px-2.5 space-y-1" : "flex flex-col items-center gap-1 px-1.5"}>
          {PRIMARY_NAV_ITEMS.map((item) => {
            const isActive = activeSegment === item.path;
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => {
                  goToSection(item.path);
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
                aria-label={!labelsVisible ? item.label : undefined}
                aria-current={isActive ? "page" : undefined}
                className={
                  !labelsVisible
                    ? `flex items-center justify-center w-10 h-10 rounded-xl transition-colors select-none ${
                        isActive
                          ? activeNavClassName
                          : inactiveNavClassName
                      }`
                    : `w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-sm transition-colors select-none ${
                        isActive
                          ? activeNavClassName
                          : inactiveNavClassName
                      }`
                }
              >
                <Icon size={!labelsVisible ? 20 : 18} strokeWidth={1.5} />
                {labelsVisible && <span className="flex-1 text-left">{item.label}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Fixed bottom controls */}
      <div className={`relative border-t border-[var(--border-color)] ${!labelsVisible ? "p-2 flex flex-col items-center" : "p-3"}`}>
        {/* Collapse / expand toggle */}
        {presentation === "sidebar" && (
          <button
            onClick={() => { setTooltip(null); setLabelsVisible((v) => !v); }}
            onMouseEnter={(event) => showTooltip(labelsVisible ? "Collapse" : "Expand", event.currentTarget)}
            onMouseLeave={hideTooltip}
            aria-label={labelsVisible ? "Collapse sidebar" : "Expand sidebar"}
            className={
              !labelsVisible
                ? "mb-2 flex h-10 w-10 items-center justify-center rounded-xl text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                : "mb-2 flex w-full items-center gap-2 px-2.5 py-2 rounded-xl text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            }
          >
            {labelsVisible ? <ChevronLeft size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
            {labelsVisible && <span className="flex-1 text-left">Collapse</span>}
          </button>
        )}

        {showPreferencesButton && (
          <div className={!labelsVisible ? "mb-2" : "mb-3 flex items-center gap-1"}>
            <button
              onClick={() => {
                setTooltip(null);
                setPopoverOpen(false);
                goTo("/preferences");
              }}
              onMouseEnter={(event) => showTooltip("Preferences", event.currentTarget)}
              onMouseLeave={hideTooltip}
              onFocus={(event) => showTooltip("Preferences", event.currentTarget)}
              onBlur={hideTooltip}
              aria-label="Preferences"
              aria-current={isPreferencesActive ? "page" : undefined}
              className={
                !labelsVisible
                  ? `flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                      isPreferencesActive
                        ? activeNavClassName
                        : "border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm hover:border-[var(--accent-color)]"
                    }`
                  : `flex flex-1 items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors ${
                      isPreferencesActive
                        ? activeNavClassName
                        : "border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm hover:border-[var(--accent-color)]"
                    }`
              }
            >
              <SettingsIcon size={16} strokeWidth={1.5} />
              {labelsVisible && <span className="flex-1 text-left">Preferences</span>}
            </button>
          </div>
        )}

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
            !labelsVisible
              ? `flex items-center justify-center w-10 h-10 rounded-xl transition-colors ${
                  popoverOpen
                    ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`
              : `w-full min-w-0 flex items-center gap-2 px-2.5 py-2 rounded-xl text-sm transition-colors ${
                  popoverOpen
                    ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`
          }
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-color)] text-white text-xs font-bold">
            A
          </div>
          {labelsVisible && (
            <>
              <span className="min-w-0 flex-1 truncate text-left font-medium">Aetherium</span>
              <ChevronUp size={14} strokeWidth={1.5} className={`shrink-0 transition-transform ${popoverOpen ? "" : "rotate-180"}`} />
            </>
          )}
        </button>

        {/* Popover menu */}
        {popoverOpen && (
          <div
            ref={popoverRef}
            className="absolute bottom-full left-2 right-2 mb-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1.5 shadow-xl z-[60]"
            style={!labelsVisible ? { left: 0, right: "auto", minWidth: 200 } : undefined}
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

            {/* Command Palette */}
            <button
              onClick={() => {
                setPopoverOpen(false);
                onOpenCommandPalette();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Zap size={16} strokeWidth={1.5} />
              <span className="flex-1">Command Palette</span>
              <kbd className="text-[10px] px-1 py-0.5 bg-[var(--bg-hover)] rounded font-mono text-[var(--text-muted)]">⌘K</kbd>
            </button>
          </div>
        )}
      </div>

      {visibleTooltip && (
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
          className="fixed z-50 min-w-[190px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              goToSection(contextMenu.item.path);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <ExternalLink size={11} strokeWidth={1.5} /> Open section
          </button>
          <button
            onClick={() => {
              goTo("/preferences", { state: { settingsTab: "appearance" } });
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <SettingsIcon size={11} strokeWidth={1.5} /> Customize navigation
          </button>
        </div>
      )}
    </div>
  );
}
