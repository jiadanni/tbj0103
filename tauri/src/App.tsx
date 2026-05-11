import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "./stores/settingsStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { api, type QuickSearchResult } from "./lib/api";
import { normalizeTheme } from "./lib/theme";
import { getPrefsWindowSingleInstance } from "./lib/prefsWindowMode";
import Layout from "./components/Layout";
import ZoomIndicator from "./components/ZoomIndicator";
import AuthenticationView from "./views/AuthenticationView";
import { useNavigationHistory } from "./hooks/useNavigationHistory";
import { useNavigationHotkeys } from "./hooks/useNavigationHotkeys";

/** Manages browser-like navigation with back/forward support via keyboard and gestures. */
function NavigationManager() {
  const { goBack, goForward, canGoBack, canGoForward } = useNavigationHistory();

  useNavigationHotkeys({
    onBack: goBack,
    onForward: goForward,
    canGoBack,
    canGoForward,
  });

  return null;
}

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
            navigateRef.current("/preferences", { state: { settingsTab: "memory" } });
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
  const setFontSize = useSettingsStore((state) => state.setFontSize);
  const setWorkspaces = useWorkspaceStore((state) => state.setWorkspaces);
  const setProjectsForWorkspace = useWorkspaceStore((state) => state.setProjectsForWorkspace);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Loading…");
  const [zoomVisible, setZoomVisible] = useState(false);
  const zoomTimeoutRef = useRef<number | null>(null);

  const triggerZoomIndicator = () => {
    setZoomVisible(true);
    if (zoomTimeoutRef.current) {
      window.clearTimeout(zoomTimeoutRef.current);
    }
    zoomTimeoutRef.current = window.setTimeout(() => {
      setZoomVisible(false);
      zoomTimeoutRef.current = null;
    }, 1500);
  };

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

  // Zoom: Ctrl/Cmd + Scroll; Keyboard shortcuts (Ctrl/Cmd + + / - / 0); F12 for DevTools
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlCmd = e.ctrlKey || e.metaKey;

      if (e.key === "F12") {
        e.preventDefault();
        api.system.toggleDevtools().catch(() => {});
      }
      if (isCtrlCmd && e.shiftKey && e.key === ",") {
        e.preventDefault();
        api.system.openPreferencesWindow(getPrefsWindowSingleInstance()).catch(() => {});
      }

      // Zoom keyboard shortcuts
      if (isCtrlCmd) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          const current = useSettingsStore.getState().fontSize;
          setFontSize(Math.min(current + 2, 48));
          triggerZoomIndicator();
        } else if (e.key === "-") {
          e.preventDefault();
          const current = useSettingsStore.getState().fontSize;
          setFontSize(Math.max(current - 2, 10));
          triggerZoomIndicator();
        } else if (e.key === "0") {
          e.preventDefault();
          setFontSize(16);
          triggerZoomIndicator();
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        const current = useSettingsStore.getState().fontSize;
        const next = Math.min(Math.max(current + delta, 10), 48);
        setFontSize(next);
        triggerZoomIndicator();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", handleWheel);
    };
  }, [setFontSize]);

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
        if (!settings.touch_id_enabled && !settings.pin_lock_enabled) {
          await api.security.unlockApp();
          setIsAuthenticated(true);
        }
      } catch {
        // First run or Ollama not available — still OK
        await api.security.unlockApp().catch(() => {});
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

  // Listen for workspace changes from other windows
  useEffect(() => {
    const unlisten = listen("workspaces-changed", async () => {
      try {
        const workspaces = await api.workspace.list();
        setWorkspaces(workspaces);
      } catch (err) {
        console.error("Failed to re-fetch workspaces after change:", err);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, [setWorkspaces]);

  // Listen for settings changes from other windows
  useEffect(() => {
    const unlisten = listen("settings-changed", async () => {
      try {
        const settings = await api.settings.get();
        const store = useSettingsStore.getState();
        store.setTheme(normalizeTheme(settings.theme));
        store.setAccentColor(settings.accent_color);
        store.setFontSize(settings.font_size);
        store.setPreferredModel(settings.preferred_model);
        store.setBackgroundModel(settings.background_model);
        store.setQuickSearchWorkspaceScope(settings.quick_search_workspace_scope);
        store.setQuickSearchTypeFilters(settings.quick_search_type_filters);
        store.setOllamaUrl(settings.ollama_base_url);
        store.setMlxUrl(settings.mlx_base_url);
        store.setLlamacppModelPaths(settings.llamacpp_model_paths);
        store.setDualModelEnabled(settings.dual_model_enabled);
        store.setDraftModel(settings.draft_model);
        store.setDualModelExecutionMode(settings.dual_model_execution_mode as "serial" | "parallel");
        store.setCompareModelA(settings.compare_model_a);
        store.setCompareModelB(settings.compare_model_b);
        store.setImmediateDelete(settings.immediate_delete);
        store.setConfirmMoveToTrash(settings.confirm_move_to_trash);
        store.setPromptInstructions(settings.prompt_instructions);
        store.setSwitchWorkspaceSection(settings.switch_workspace_section);
        store.setHideNativeMenu(settings.hide_native_menu);
        store.setShowGenInfo(settings.show_gen_info);
        store.setShowGenInfoTokenCount(settings.show_gen_info_token_count);
        store.setShowGenInfoDuration(settings.show_gen_info_duration);
        store.setShowGenInfoSpeed(settings.show_gen_info_speed);
        store.setShowGenInfoModel(settings.show_gen_info_model);
        store.setQuickSearchShortcut(settings.quick_search_shortcut);
      } catch (err) {
        console.error("Failed to re-fetch settings after change:", err);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

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
      <NavigationManager />
      <MenuEventHandler />
      <ZoomIndicator fontSize={fontSize} visible={zoomVisible} />
      <Routes>
        <Route path="/*" element={<Layout />} />
        <Route path="/" element={<Navigate to="/project" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
