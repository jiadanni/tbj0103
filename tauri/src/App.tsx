import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "./stores/settingsStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { api, type QuickSearchResult, type WorkspaceAnalysisProgress } from "./lib/api";
import { useBackgroundJobsStore } from "./stores/backgroundJobs";
import { hexToRgbChannels, normalizeTheme } from "./lib/theme";
import { getPrefsWindowSingleInstance } from "./lib/prefsWindowMode";
import Layout from "./components/Layout";
import ZoomIndicator from "./components/ZoomIndicator";
import AuthenticationView from "./views/AuthenticationView";
import BootUnlockView from "./views/BootUnlockView";
import type { BootStatus } from "./lib/api";
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
  const setFoldersForWorkspace = useWorkspaceStore((state) => state.setFoldersForWorkspace);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Loading…");
  // null = still checking; { unlock_required: true } gates the rest of boot
  // behind the BootUnlockView. Once the user enters their PIN successfully,
  // boot_unlock opens the DB pool and we re-check; the rest of the app boots
  // normally from there.
  const [bootGate, setBootGate] = useState<BootStatus | null>(null);
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
    if (accentColor) {
      root.style.setProperty("--accent-color", accentColor);
      root.style.setProperty("--accent-color-rgb", hexToRgbChannels(accentColor));
    }
    // Clamp to the supported zoom range (11–22). An earlier build allowed
    // Ctrl+scroll to drive font-size up to 48px, and that value still lives
    // in some users' localStorage/DB.
    const safeFontSize = Math.max(11, Math.min(22, fontSize || 16));
    if (safeFontSize !== fontSize) {
      setFontSize(safeFontSize);
      api.settings.updateOne("font_size", safeFontSize).catch(() => {});
    }
    root.style.setProperty("--font-size-base", `${safeFontSize}px`);
    root.style.fontSize = `${safeFontSize}px`;
  }, [theme, accentColor, fontSize, setFontSize]);

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

      // Zoom keyboard shortcuts — range must match Sidebar/Preferences (11–22)
      // so accidental Ctrl+scroll can't blow the UI up to 40px+.
      if (isCtrlCmd) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          const current = useSettingsStore.getState().fontSize;
          const next = Math.min(current + 1, 22);
          setFontSize(next);
          api.settings.updateOne("font_size", next).catch(() => {});
          triggerZoomIndicator();
        } else if (e.key === "-") {
          e.preventDefault();
          const current = useSettingsStore.getState().fontSize;
          const next = Math.max(current - 1, 11);
          setFontSize(next);
          api.settings.updateOne("font_size", next).catch(() => {});
          triggerZoomIndicator();
        } else if (e.key === "0") {
          e.preventDefault();
          setFontSize(16);
          api.settings.updateOne("font_size", 16).catch(() => {});
          triggerZoomIndicator();
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        const current = useSettingsStore.getState().fontSize;
        const next = Math.min(Math.max(current + delta, 11), 22);
        if (next === current) {return;}
        setFontSize(next);
        api.settings.updateOne("font_size", next).catch(() => {});
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

  // Remove the pre-React boot overlay from main.tsx as soon as React commits.
  // If this never runs, the overlay stays up — which is exactly the signal we
  // want: it proves React did not reach a commit.
  useEffect(() => {
    const overlay = document.getElementById("aetherium-boot-overlay");
    if (!overlay) { return; }
    overlay.style.opacity = "0";
    const timer = window.setTimeout(() => overlay.remove(), 140);
    return () => window.clearTimeout(timer);
  }, []);

  // Hydrate background jobs store on mount and listen for events
  useEffect(() => {
    // Hydrate initially
    useBackgroundJobsStore.getState().hydrate().catch((err) => {
      console.error("Failed to hydrate background jobs:", err);
    });

    let unlistenTask: (() => void) | null = null;
    let unlistenWorkspace: (() => void) | null = null;

    async function setupListeners() {
      unlistenTask = await api.listenBackgroundTask((payload) => {
        useBackgroundJobsStore.getState().applyEvent(payload);
      });

      unlistenWorkspace = await api.knowledge.listenWorkspaceProgress((payload: WorkspaceAnalysisProgress) => {
        // Map WorkspaceAnalysisProgress event into the store as workspace_analysis task.
        const store = useBackgroundJobsStore.getState();
        if (payload.status === "started") {
          // Workspace analysis preempts prompt-bank display in the StatusBar
          // (they share the global job semaphore). Clear directly rather than
          // emitting a fake "failed" event, which would otherwise leak into
          // any listener watching for real failures.
          store.removeJob("workspace_prompt_bank");
          store.applyEvent({
            task_type: "workspace_analysis",
            status: "started",
            message: payload.label,
            model: payload.model,
            workspace_id: payload.workspace_id,
          });
        } else {
          store.removeJob("workspace_analysis");
        }
      });
    }

    void setupListeners();

    // Rehydrate on return to visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        useBackgroundJobsStore.getState().hydrate().catch((err) => {
          console.error("Failed to rehydrate background jobs on visibility change:", err);
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      unlistenTask?.();
      unlistenWorkspace?.();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Boot gate: check whether the DB needs to be unlocked before we run the
  // main settings/workspaces fetch (which would fail without an open pool).
  useEffect(() => {
    let cancelled = false;
    api.boot.checkState().then((status) => {
      if (cancelled) {return;}
      setBootGate(status);
    }).catch(() => {
      if (cancelled) {return;}
      // If the boot probe itself fails, assume no encryption and continue —
      // the main boot effect will surface any real errors.
      setBootGate({ unlock_required: false, pending_action: "" });
    });
    return () => { cancelled = true; };
  }, []);

  // Boot: load settings + workspaces
  useEffect(() => {
    if (!bootGate || bootGate.unlock_required) {return;}
    let cancelled = false;

    async function boot() {
      try {
        setLoadingMessage("Loading workspace…");
        const [workspaces, core, ai, advanced] = await Promise.all([
          api.workspace.list(),
          api.settings.getCore(),
          api.settings.getInference(),
          api.settings.getAdvanced(),
        ]);
        if (cancelled) {return;}

        const bootStore = useSettingsStore.getState();
        bootStore.setWebSessionPreserve(core.web_session_preserve);
        bootStore.setChatTitleAutoRefresh(core.chat_title_auto_refresh);
        bootStore.setChatTitleRefreshInterval(core.chat_title_refresh_interval);
        bootStore.setAboutYou(core.about_you ?? "");

        // Auto-activate demo on first start (no workspaces + not previously dismissed)
        let finalWorkspaces = workspaces;
        if (workspaces.length === 0 && !core.demo_dismissed) {
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

        // Auto-authenticate if neither lock method is active
        if (!advanced.touch_id_enabled && !advanced.pin_lock_enabled) {
          await api.security.unlockApp();
          setIsAuthenticated(true);
        }

        // Kick off Ollama warmup in the background — must not block first paint.
        // Cold boots spend several seconds on the /api/show capability sweep
        // (one request per installed model) and on slow networks the connect
        // alone can take 60s+, which used to leave the boot overlay visible
        // long enough to feel like a hang. Features that need Ollama handle
        // "not yet running" via their own loading states.
        if (ai.auto_start_ollama && !ai.ollama_remote_enabled) {
          void api.ollama.ensureRunning(ai.ollama_base_url || undefined).catch(() => null);
        }
      } catch {
        // First run or Ollama not available — still OK
        await api.security.unlockApp().catch(() => {});
        setIsAuthenticated(true);
        // The failure may have come from a settings call in the Promise.all
        // above, which would otherwise leave the workspace list empty and the
        // workspace/sub-workspace selectors blank until restart. Best-effort
        // recover the workspaces on their own so navigation stays usable.
        try {
          const recovered = await api.workspace.list();
          if (!cancelled && recovered.length > 0) {
            setWorkspaces(recovered);
          }
        } catch {
          // workspace list itself is unavailable — nothing more to do here
        }
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
  }, [setWorkspaces, bootGate]);

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
        const [core, ai, advanced] = await Promise.all([
          api.settings.getCore(),
          api.settings.getInference(),
          api.settings.getAdvanced(),
        ]);
        const store = useSettingsStore.getState();
        store.setTheme(normalizeTheme(core.theme));
        store.setAccentColor(core.accent_color);
        store.setFontSize(core.font_size);
        store.setPreferredModel(ai.preferred_model);
        store.setBackgroundModel(ai.background_model);
        store.setQuickSearchWorkspaceScope(advanced.quick_search_workspace_scope);
        store.setQuickSearchTypeFilters(advanced.quick_search_type_filters);
        store.setOllamaUrl(ai.ollama_base_url);
        store.setMlxUrl(ai.mlx_base_url);
        store.setLlamacppModelPaths(ai.llamacpp_model_paths);
        store.setDualModelEnabled(ai.dual_model_enabled);
        store.setDraftModel(ai.draft_model);
        store.setDualModelExecutionMode(ai.dual_model_execution_mode as "serial" | "parallel");
        store.setCompareModelA(ai.compare_model_a);
        store.setCompareModelB(ai.compare_model_b);
        store.setImmediateDelete(advanced.immediate_delete);
        store.setConfirmMoveToTrash(advanced.confirm_move_to_trash);
        store.setPromptInstructions(core.prompt_instructions);
        store.setSwitchWorkspaceSection(core.switch_workspace_section);
        store.setHideNativeMenu(core.hide_native_menu);
        store.setShowGenInfo(ai.show_gen_info);
        store.setShowGenInfoTokenCount(ai.show_gen_info_token_count);
        store.setShowGenInfoDuration(ai.show_gen_info_duration);
        store.setShowGenInfoSpeed(ai.show_gen_info_speed);
        store.setShowGenInfoModel(ai.show_gen_info_model);
        store.setQuickSearchShortcut(advanced.quick_search_shortcut);
        store.setWebSessionPreserve(core.web_session_preserve);
        store.setChatTitleAutoRefresh(core.chat_title_auto_refresh);
        store.setChatTitleRefreshInterval(core.chat_title_refresh_interval);
        store.setAboutYou(core.about_you ?? "");
      } catch (err) {
        console.error("Failed to re-fetch settings after change:", err);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Reload folders for all visible workspaces so split panes don't retain stale folder filters.
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
      [...workspaceIds].map(async (workspaceId) => [workspaceId, await api.folder.list(workspaceId)] as const)
    )
      .then((entries) => {
        if (cancelled) {return;}
        entries.forEach(([workspaceId, folders]) => {
          setFoldersForWorkspace(workspaceId, folders);
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, primaryWorkspaceId, secondaryWorkspaceId, setFoldersForWorkspace, splitMode]);

  // Show the boot unlock screen when the DB is encrypted and the pool has
  // not yet been opened. The successful unlock command triggers the boot
  // gate to be re-checked, which lets the main boot effect run.
  if (bootGate?.unlock_required) {
    return (
      <BootUnlockView
        status={bootGate}
        onUnlocked={() => setBootGate({ unlock_required: false, pending_action: "" })}
      />
    );
  }

  if (isLoading) {
    // Inline styles so this screen is visible even if theme CSS variables
    // haven't been applied yet on a cold start.
    return (
      <div
        className="flex items-center justify-center h-screen"
        style={{
          backgroundColor: "var(--bg-primary, #18181b)",
          color: "var(--text-primary, #f4f4f5)",
        }}
      >
        <div className="text-sm opacity-70">{loadingMessage}</div>
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
        <Route path="/" element={<Navigate to="/folder" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
