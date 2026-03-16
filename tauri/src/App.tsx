import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSettingsStore } from "./stores/settingsStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { api } from "./lib/api";
import Layout from "./components/Layout";
import AuthenticationView from "./views/AuthenticationView";

export default function App() {
  const { theme, accentColor } = useSettingsStore();
  const { setWorkspaces, setProjects, isDemoMode, setDemo } = useWorkspaceStore();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Apply theme class to <html> element
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    if (accentColor) root.style.setProperty("--accent-color", accentColor);
  }, [theme, accentColor]);

  // Boot: load settings + workspaces
  useEffect(() => {
    async function boot() {
      try {
        const workspaces = await api.workspace.list();
        setWorkspaces(workspaces);
        // Auto-authenticate if no touch ID required (settings check)
        const settings = await api.settings.get();
        if (!settings.touch_id_enabled) setIsAuthenticated(true);
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
    if (!activeWorkspaceId) return;
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
      <Routes>
        <Route path="/*" element={<Layout />} />
        <Route path="/" element={<Navigate to="/chat" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
