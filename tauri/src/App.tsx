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

const DEFAULT_WORKSPACE_NAME = "Workspace";

export default function App() {
  const { theme, accentColor, fontSize } = useSettingsStore();
  const { setWorkspaces, setProjectsForWorkspace, setActiveWorkspaceId, activeWorkspaceId } = useWorkspaceStore();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingWorkspaceRenameId, setPendingWorkspaceRenameId] = useState<string | null>(null);
  const [pendingWorkspaceName, setPendingWorkspaceName] = useState(DEFAULT_WORKSPACE_NAME);
  const [savingWorkspaceName, setSavingWorkspaceName] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      getCurrentWindow().show().catch(console.error);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

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

  useEffect(() => {
    async function boot() {
      try {
        let workspaces = await api.workspace.list();

        if (workspaces.length === 0) {
          const defaultWorkspace = await api.workspace.create(DEFAULT_WORKSPACE_NAME);
          workspaces = [defaultWorkspace];
          setPendingWorkspaceRenameId(defaultWorkspace.id);
          setPendingWorkspaceName(defaultWorkspace.name || DEFAULT_WORKSPACE_NAME);
        }

        setWorkspaces(workspaces);
        if (workspaces.length > 0) {
          setActiveWorkspaceId(workspaces[0].id);
        }

        const settings = await api.settings.get();
        if (!settings.touch_id_enabled && !settings.pin_lock_enabled) {
          setIsAuthenticated(true);
        }
      } catch {
        setIsAuthenticated(true);
      } finally {
        setIsLoading(false);
      }
    }

    boot();
  }, [setActiveWorkspaceId, setWorkspaces]);

  useEffect(() => {
    if (!activeWorkspaceId) {return;}
    api.project.list(activeWorkspaceId).then((projects) => {
      setProjectsForWorkspace(activeWorkspaceId, projects);
    }).catch(() => {});
  }, [activeWorkspaceId, setProjectsForWorkspace]);

  async function savePendingWorkspaceRename() {
    if (!pendingWorkspaceRenameId || !pendingWorkspaceName.trim() || savingWorkspaceName) {return;}
    const trimmedName = pendingWorkspaceName.trim();
    setSavingWorkspaceName(true);
    try {
      const workspace = useWorkspaceStore.getState().workspaces.find((item) => item.id === pendingWorkspaceRenameId);
      if (!workspace) {
        setPendingWorkspaceRenameId(null);
        return;
      }

      await api.workspace.update(
        pendingWorkspaceRenameId,
        trimmedName,
        workspace.description,
        workspace.prompt_instructions
      );

      setWorkspaces(
        useWorkspaceStore.getState().workspaces.map((item) =>
          item.id === pendingWorkspaceRenameId ? { ...item, name: trimmedName } : item
        )
      );
      setPendingWorkspaceRenameId(null);
    } finally {
      setSavingWorkspaceName(false);
    }
  }

  function dismissPendingWorkspaceRename() {
    if (savingWorkspaceName) {return;}
    setPendingWorkspaceRenameId(null);
    setPendingWorkspaceName(DEFAULT_WORKSPACE_NAME);
  }

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
    <>
      <HashRouter>
        <Routes>
          <Route path="/*" element={<Layout />} />
          <Route path="/" element={<Navigate to="/chat" replace />} />
        </Routes>
      </HashRouter>

      {pendingWorkspaceRenameId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 shadow-2xl flex flex-col gap-4">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--accent-color)]">First Workspace</p>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Name your workspace</h2>
              <p className="text-sm text-[var(--text-secondary)]">
                We created a starter workspace so you can begin right away. Rename it now, or keep the default name and change it later.
              </p>
            </div>

            <input
              autoFocus
              value={pendingWorkspaceName}
              onChange={(event) => setPendingWorkspaceName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {void savePendingWorkspaceRename();}
                if (event.key === "Escape") {dismissPendingWorkspaceRename();}
              }}
              placeholder="Workspace name"
              className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />

            <div className="flex gap-2">
              <button
                onClick={dismissPendingWorkspaceRename}
                disabled={savingWorkspaceName}
                className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                Keep Default
              </button>
              <button
                onClick={() => void savePendingWorkspaceRename()}
                disabled={savingWorkspaceName || !pendingWorkspaceName.trim()}
                className="flex-1 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm hover:opacity-90 disabled:opacity-50"
              >
                {savingWorkspaceName ? "Saving…" : "Save Name"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
