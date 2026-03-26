import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "./stores/settingsStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { api } from "./lib/api";
import Layout from "./components/Layout";
import AuthenticationView from "./views/AuthenticationView";

/** Listens for native menu-bar events and translates them into navigation/actions. */
function MenuEventHandler() {
  const navigate = useNavigate();
  // Keep a stable ref to avoid re-subscribing on every render
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);

  useEffect(() => {
    const unlistenNav = listen<string>("menu-navigate", (event) => {
      navigateRef.current(event.payload);
    });

    const unlistenAction = listen<string>("menu-action", (event) => {
      switch (event.payload) {
        case "new-chat":
          navigateRef.current("/chat");
          // Dispatch a custom DOM event so ChatView can open a new session
          window.dispatchEvent(new CustomEvent("aetherium:new-chat"));
          break;
        case "new-note":
          navigateRef.current("/notes");
          window.dispatchEvent(new CustomEvent("aetherium:new-note"));
          break;
        case "cmd-palette":
          window.dispatchEvent(new CustomEvent("aetherium:open-command-palette"));
          break;
      }
    });

    return () => {
      unlistenNav.then((fn) => fn());
      unlistenAction.then((fn) => fn());
    };
  }, []);

  return null;
}

export default function App() {
  const theme = useSettingsStore((state) => state.theme);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const fontSize = useSettingsStore((state) => state.fontSize);
  const setWorkspaces = useWorkspaceStore((state) => state.setWorkspaces);
  const setProjects = useWorkspaceStore((state) => state.setProjects);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Apply theme class to <html> element — also applies font-size and accent-color reactively
  useEffect(() => {
    const root = document.documentElement;
    root.classList.forEach((cls) => {
      if (cls.startsWith("theme-")) {root.classList.remove(cls);}
    });
    root.classList.add(`theme-${theme}`);
    if (accentColor) {root.style.setProperty("--accent-color", accentColor);}
    root.style.setProperty("--font-size-base", `${fontSize}px`);
    root.style.fontSize = `${fontSize}px`;
  }, [theme, accentColor, fontSize]);

  // Boot: load settings + workspaces
  useEffect(() => {
    async function boot() {
      try {
        const workspaces = await api.workspace.list();
        setWorkspaces(workspaces);
        // Auto-authenticate if neither lock method is active
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
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  useEffect(() => {
    if (!activeWorkspaceId) {return;}
    api.project.list(activeWorkspaceId).then(setProjects).catch(() => {});
  }, [activeWorkspaceId, setProjects]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
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
    <BrowserRouter>
      <MenuEventHandler />
      <Routes>
        <Route path="/*" element={<Layout />} />
        <Route path="/" element={<Navigate to="/chat" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
