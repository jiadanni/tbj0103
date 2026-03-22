import { useEffect, useState } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hexToRgbChannels } from "./lib/theme";
import { useSettingsStore } from "./stores/settingsStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { api } from "./lib/api";
import Layout from "./components/Layout";
import AuthenticationView from "./views/AuthenticationView";
import WindowControls, { onDragRegionMouseDown } from "./components/WindowControls";

export default function App() {
  const { theme, accentColor, fontSize } = useSettingsStore();
  const { setWorkspaces, setProjects, setActiveWorkspaceId, activeWorkspaceId, isDemoMode, setDemo } = useWorkspaceStore();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Show window after a delay to avoid focus stealing during build/restart
  useEffect(() => {
    const timer = setTimeout(() => {
      getCurrentWindow().show().catch(console.error);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  // Apply theme class to <html> element — also applies font-size and accent-color reactively
  useEffect(() => {
    const root = document.documentElement;
    root.classList.forEach((cls) => {
      if (cls.startsWith("theme-")) {root.classList.remove(cls);}
    });
    root.classList.add(`theme-${theme}`);
    if (accentColor) {
      root.style.setProperty("--accent-color", accentColor);
      root.style.setProperty("--accent-color-rgb", hexToRgbChannels(accentColor));
    }
    root.style.setProperty("--font-size-base", `${fontSize}px`);
    root.style.fontSize = `${fontSize}px`;
  }, [theme, accentColor, fontSize]);

  // Boot: load settings + workspaces
  useEffect(() => {
    async function boot() {
      try {
        const workspaces = await api.workspace.list();
        setWorkspaces(workspaces);
        if (workspaces.length > 0) {setActiveWorkspaceId(workspaces[0].id);}
        // Auto-authenticate only when no app lock is configured.
        const settings = await api.settings.get();
        if (!settings.touch_id_enabled && !settings.pin_lock_enabled) {setIsAuthenticated(true);}
      } catch {
        // First run or Ollama not available — still OK
        setIsAuthenticated(true);
      } finally {
        setIsLoading(false);
      }
    }
    boot();
  }, [setWorkspaces]);

  // Reload projects whenever active workspace changes
  useEffect(() => {
    if (!activeWorkspaceId) {return;}
    api.project.list(activeWorkspaceId).then(setProjects).catch(() => {});
  }, [activeWorkspaceId, setProjects]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <div data-tauri-drag-region onMouseDown={onDragRegionMouseDown} className="fixed top-0 left-0 right-0 h-9 flex items-center justify-end pr-2">
          <WindowControls />
        </div>
        <div className="text-sm opacity-50">Loading…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthenticationView onAuthenticated={() => setIsAuthenticated(true)} />
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/*" element={<Layout />} />
        <Route path="/" element={<Navigate to="/chat" replace />} />
      </Routes>
    </HashRouter>
  );
}
