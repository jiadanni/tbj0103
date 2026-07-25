/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useLocation, type NavigateOptions } from "react-router-dom";
import { Settings as SettingsIcon, ExternalLink } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { PRIMARY_NAV_ITEMS } from "../navigationItems";
import type { NavigationItem } from "../navigationItems";
import { SectionNavTopTabs } from "../chrome/SectionNavTopTabs";
import { SectionNavDropdownSelect } from "../chrome/SectionNavDropdownSelect";

function TopTabsNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const [, startNavTransition] = React.useTransition();
  const goTo = (to: string, options?: NavigateOptions) => {
    if (to === "/chat") {
      useChatStore.getState().setActiveChatId(null);
    }
    startNavTransition(() => { navigate(to, options); });
  };
  const activeSegment = "/" + location.pathname.split("/")[1];
  // Surface Preferences as a transient tab only while it's open (it isn't a
  // primary section), so the active indicator stays honest instead of leaving
  // no tab highlighted.
  const onPreferences = location.pathname.startsWith("/preferences");
  const navItems = onPreferences
    ? [...PRIMARY_NAV_ITEMS, { path: "/preferences", icon: SettingsIcon, label: "Preferences" }]
    : PRIMARY_NAV_ITEMS;
  const [contextMenu, setContextMenu] = useState<{ item: NavigationItem; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

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

  const tabItems = navItems.map((item) => ({
    id: item.path,
    label: item.label,
    icon: item.icon,
  }));

  return (
    <div className="relative">
      <SectionNavTopTabs
        items={tabItems}
        activeId={activeSegment}
        onSelect={(path) => {
          goTo(path);
          setContextMenu(null);
        }}
        onContextMenu={(id, x, y) => {
          const item = navItems.find((nav) => nav.path === id);
          if (item) {
            setContextMenu({ item, x, y });
          }
        }}
        density="comfortable"
      />

      {contextMenu && (
        <div
          ref={contextMenuRef}
          data-section-context-menu
          className="fixed z-50 min-w-[190px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              goTo(contextMenu.item.path);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <ExternalLink size={11} /> Open section
          </button>
          <button
            onClick={() => {
              goTo("/preferences", { state: { settingsTab: "appearance" } });
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

/**
 * The section (route) picker control on its own. Carries its own routing, so it
 * can be dropped into the standalone bar or the combined titlebar line.
 */
function useSectionDropdownData() {
  const navigate = useNavigate();
  const location = useLocation();
  const [, startNavTransition] = React.useTransition();
  const activeSegment = "/" + location.pathname.split("/")[1];
  // Preferences is a routed screen, not a primary section. Surface it as a
  // transient option only while it's open, so the selector reflects the truth
  // instead of falling back to the first section ("Dashboard").
  const onPreferences = location.pathname.startsWith("/preferences");
  const sectionOptions = [
    ...PRIMARY_NAV_ITEMS.map((item) => ({
      label: item.label,
      value: item.path,
      icon: item.icon,
    })),
    ...(onPreferences ? [{ label: "Preferences", value: "/preferences", icon: SettingsIcon }] : []),
  ];

  const selectedPath = sectionOptions.some((item) => item.value === activeSegment)
    ? activeSegment
    : sectionOptions[0]?.value ?? "/folder";

  const handleChange = (value: string) => {
    if (value === "/chat") {
      useChatStore.getState().setActiveChatId(null);
    }
    startNavTransition(() => { navigate(value); });
  };

  return { sectionOptions, selectedPath, handleChange };
}

function SectionDropdownSelect() {
  const { sectionOptions, selectedPath, handleChange } = useSectionDropdownData();
  return (
    <SectionNavDropdownSelect
      density="comfortable"
      showRow={false}
      options={sectionOptions}
      value={selectedPath}
      onChange={handleChange}
    />
  );
}

function CompactSectionNavigation() {
  const { sectionOptions, selectedPath, handleChange } = useSectionDropdownData();
  return (
    <SectionNavDropdownSelect
      density="comfortable"
      showRow={true}
      options={sectionOptions}
      value={selectedPath}
      onChange={handleChange}
    />
  );
}

export { TopTabsNavigation, useSectionDropdownData, SectionDropdownSelect, CompactSectionNavigation };
