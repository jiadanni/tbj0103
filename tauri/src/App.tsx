import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "./stores/settingsStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { api, type QuickSearchResult } from "./lib/api";
import { normalizeTheme } from "./lib/theme";
import { getPrefsWindowSingleInstance } from "./lib/prefsWindowMode";
import Layout from "./components/Layout";
import AuthenticationView from "./views/AuthenticationView";

/** Listens for native menu-bar events and translates them into navigation/actions. */
function MenuEventHandler() {
  const navigate = useNavigate();
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);
  // Keep a stable ref to avoid re-subscribing on every render
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);

  useEffect(() => {
    api.quickSearch.markMainWindowReady().catch(() => {});
  }, []);

  useEffect(() => {
    const unlistenNav = listen<string>("menu-navigate", (event) => {
      navigateRef.current(event.payload);
    });

    const unlistenAction = listen<string>("menu-action", (event) => {
      switch (event.payload) {
        case "new-chat":
          navigateRef.current("/chat", { state: { createNewChat: true } });
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

    const unlistenQuickSearch = listen<QuickSearchResult>("app:navigate-target", (event) => {
      const target = event.payload;
      if (target.workspace_id) {
        setActiveWorkspaceId(target.workspace_id);
      }

      switch (target.kind) {
        case "artifact":
          if (target.session_id) {
            navigateRef.current(`/chat/${target.session_id}`);
          } else {
            navigateRef.current("/chat");
          }
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent("aetherium:open-artifact", {
              detail: { artifactId: target.target_id },
            }));
          }, 0);
          break;
        case "memory":
          if (target.source_session_id) {
            navigateRef.current(`/chat/${target.source_session_id}`);
          } else {
            navigateRef.current("/memory");
          }
          break;
        case "message":
        case "summary":
          if (target.session_id) {
            navigateRef.current(`/chat/${target.session_id}`);
          } else {
            navigateRef.current("/chat");
          }
          break;
        case "conversation":
        default:
          if (target.session_id ?? target.target_id) {
            navigateRef.current(`/chat/${target.session_id ?? target.target_id}`);
          } else {
            navigateRef.current("/chat");
          }
          break;
      }
    });

    return () => {
      unlistenNav.then((fn) => fn());
      unlistenAction.then((fn) => fn());
      unlistenQuickSearch.then((fn) => fn());
    };
  }, [setActiveWorkspaceId]);

  return null;
}

export default function App() {
  const theme = useSettingsStore((state) => state.theme);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const fontSize = useSettingsStore((state) => state.fontSize);
  const setWorkspaces = useWorkspaceStore((state) => state.setWorkspaces);
  const setProjectsForWorkspace = useWorkspaceStore((state) => state.setProjectsForWorkspace);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Loading…");

  // Apply theme class to <html> element — also applies font-size and accent-color reactively
  useEffect(() => {
    const root = document.documentElement;
    const normalizedTheme = normalizeTheme(theme);
    root.classList.forEach((cls) => {
      if (cls.startsWith("theme-")) {root.classList.remove(cls);}
    });
    root.classList.add(`theme-${normalizedTheme}`);
    if (accentColor) {root.style.setProperty("--accent-color", accentColor);}
    root.style.setProperty("--font-size-base", `${fontSize}px`);
    root.style.fontSize = `${fontSize}px`;
  }, [theme, accentColor, fontSize]);

  // F12 to toggle devtools; Ctrl+Shift+, to open Preferences in a separate window
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F12") {
        e.preventDefault();
        api.system.toggleDevtools().catch(() => {});
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === ",") {
        e.preventDefault();
        api.system.openPreferencesWindow(getPrefsWindowSingleInstance()).catch(() => {});
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Boot: load settings + workspaces
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        setLoadingMessage("Loading workspace…");
        const [workspaces, settings] = await Promise.all([
          api.workspace.list(),
          api.settings.get(),
        ]);
        if (cancelled) {return;}

        // Auto-activate demo on first start (no workspaces + not previously dismissed)
        let finalWorkspaces = workspaces;
        if (workspaces.length === 0 && !settings.demo_dismissed) {
          setLoadingMessage("Preparing demo workspace…");
          const demoWorkspaceId = await api.demo.activate();
          useWorkspaceStore.getState().setDemo(true, demoWorkspaceId);
          // Re-fetch workspaces to include the newly created demo workspace
          finalWorkspaces = await api.workspace.list();
          if (cancelled) {return;}
        }

        // Detect if we are in demo mode from existing workspaces
        const demoWs = finalWorkspaces.find(ws => ws.id.startsWith("demo-"));
        if (demoWs) {
          useWorkspaceStore.getState().setDemo(true, demoWs.id);
        }

        setWorkspaces(finalWorkspaces);

        if (settings.auto_start_ollama) {
          setLoadingMessage("Starting local Ollama…");
          await api.ollama.ensureRunning(settings.ollama_base_url || undefined).catch(() => null);
          if (cancelled) {return;}
        }

        // Auto-authenticate if neither lock method is active
        if (!settings.touch_id_enabled && !settings.pin_lock_enabled) {setIsAuthenticated(true);}
      } catch {
        // First run or Ollama not available — still OK
        setIsAuthenticated(true);
      } finally {
        if (!cancelled) {
          setLoadingMessage("Loading…");
          setIsLoading(false);
        }
      }
    }
    boot();

    return () => {
      cancelled = true;
    };
  }, [setWorkspaces]);

  // Reload projects for all visible workspaces so split panes don't retain stale folder filters.
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const splitMode = useWorkspaceStore((s) => s.splitMode);
  const primaryWorkspaceId = useWorkspaceStore((s) => s.panes.primary.workspaceId);
  const secondaryWorkspaceId = useWorkspaceStore((s) => s.panes.secondary.workspaceId);
  useEffect(() => {
    const workspaceIds = new Set<string>();
    if (activeWorkspaceId) {
      workspaceIds.add(activeWorkspaceId);
    }
    if (splitMode) {
      if (primaryWorkspaceId) {
        workspaceIds.add(primaryWorkspaceId);
      }
      if (secondaryWorkspaceId) {
        workspaceIds.add(secondaryWorkspaceId);
      }
    }
    if (workspaceIds.size === 0) {return;}

    let cancelled = false;
    Promise.all(
      [...workspaceIds].map(async (workspaceId) => [workspaceId, await api.project.list(workspaceId)] as const)
    )
      .then((entries) => {
        if (cancelled) {return;}
        entries.forEach(([workspaceId, projects]) => {
          setProjectsForWorkspace(workspaceId, projects);
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, primaryWorkspaceId, secondaryWorkspaceId, setProjectsForWorkspace, splitMode]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <div className="text-sm opacity-50">{loadingMessage}</div>
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
        <Route path="/" element={<Navigate to="/project" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
