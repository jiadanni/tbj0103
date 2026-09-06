import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import {
  api,
  REFRESH_WORKSPACE_TASK_TYPES,
  type BackgroundProcessingScope,
  type BackgroundTaskEvent,
  type DataDeletionPreview,
  type DataDeletionScope,
  type DataDeletionTimeFilter,
  type KnowledgeResetOptions,
  type KnowledgeResetResult,
} from "../../lib/api";
import { INFERENCE_JOBS_CATALOG } from "../../lib/inferenceJobsCatalog";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useSettingsStore } from "../../stores/settingsStore";
import SuccessDialog from "../SuccessDialog";
import {
  DEFAULT_KNOWLEDGE_RESET_OPTIONS,
  KnowledgeResetDialog,
  formatKnowledgeResetResult,
  sumKnowledgeResetResults,
} from "../KnowledgeReset";
import {
  DATA_DELETION_CATEGORIES,
  DataDeletionDialog,
  formatDataDeletionResult,
  TIME_FILTER_OPTIONS,
} from "../DataDeletion";

/** Default job selection for the "Run Background Processing Now" panel:
 *  the standard refresh jobs plus the maintenance/cleanup passes, which are
 *  opt-in for the Knowledge Map's graph-only refresh but useful here since
 *  this panel is an explicit, on-demand "catch up everything" action. */
const DEFAULT_PROCESSING_JOBS = [
  ...REFRESH_WORKSPACE_TASK_TYPES,
  "flashcard_cleanup",
  "memory_cleanup",
];

export function DataControlsPreferences() {
  const [options, setOptions] = useState<KnowledgeResetOptions>({ ...DEFAULT_KNOWLEDGE_RESET_OPTIONS });
  const [preview, setPreview] = useState<KnowledgeResetResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [processingRunning, setProcessingRunning] = useState(false);
  const [processingScope, setProcessingScope] = useState<BackgroundProcessingScope>("current_workspace");
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);
  // The reset owns its scope independently of the background-processing scope
  // above. They used to share one radio group, which meant a control labelled
  // "Background Processing" silently retargeted a destructive action in a
  // different card.
  const [resetScope, setResetScope] = useState<BackgroundProcessingScope>("current_workspace");
  const [resetWorkspaceIds, setResetWorkspaceIds] = useState<string[]>([]);
  const [selectedProcessingJobs, setSelectedProcessingJobs] = useState<string[]>(
    () => [...DEFAULT_PROCESSING_JOBS],
  );
  type BatchRowStatus = "queued" | "running" | "completed" | "failed";
  const [batchStatus, setBatchStatus] = useState<Record<string, BatchRowStatus> | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [batchWorkspaceProgress, setBatchWorkspaceProgress] = useState<{ workspaceId: string; index: number; total: number } | null>(null);
  const batchActiveRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [successDialog, setSuccessDialog] = useState<{ title: string; description: string } | null>(null);
  const workspaces = useWorkspaceStore((state) => state.workspaces).filter((workspace) => !workspace.is_hidden);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);

  // Runs the reset (or its dry-run preview) against whatever the reset card's
  // own Scope radio selects, rather than always hitting every workspace.
  async function runScopedReset(
    nextOptions: KnowledgeResetOptions,
    dryRun: boolean,
  ): Promise<KnowledgeResetResult> {
    if (resetScope === "all_workspaces") {
      return api.graph.resetKnowledgeState({ scope: "all_workspaces", options: nextOptions, dryRun });
    }

    const workspaceIds = resetScope === "selected_workspaces"
      ? resetWorkspaceIds
      : activeWorkspaceId
        ? [activeWorkspaceId]
        : [];

    if (workspaceIds.length === 0) {
      throw new Error(resetScope === "selected_workspaces"
        ? "Select at least one workspace to reset."
        : "No active workspace to reset.");
    }

    const results = await Promise.all(workspaceIds.map((workspaceId) => api.graph.resetKnowledgeState({
      scope: "workspace",
      workspaceId,
      options: nextOptions,
      dryRun,
    })));
    return sumKnowledgeResetResults(results);
  }

  const resetScopeIsEmpty = resetScope === "selected_workspaces"
    ? resetWorkspaceIds.length === 0
    : resetScope === "current_workspace" && !activeWorkspaceId;

  const resetScopeDescription = useMemo(() => {
    if (resetScope === "all_workspaces") {
      return "across all workspaces";
    }
    if (resetScope === "selected_workspaces") {
      const count = resetWorkspaceIds.length;
      return count === 1
        ? `for ${workspaces.find((w) => w.id === resetWorkspaceIds[0])?.name ?? "the selected workspace"}`
        : `across ${count} selected workspace${count === 1 ? "" : "s"}`;
    }
    const active = workspaces.find((w) => w.id === activeWorkspaceId);
    return active ? `for ${active.name}` : "for the current workspace";
  }, [resetScope, resetWorkspaceIds, workspaces, activeWorkspaceId]);

  // Short form for the button face — the prose description is too long to sit
  // inside a button, but the button must still say what it is about to hit.
  const resetScopeButtonLabel = useMemo(() => {
    if (resetScope === "all_workspaces") {
      return "All Workspaces";
    }
    if (resetScope === "selected_workspaces") {
      const count = resetWorkspaceIds.length;
      if (count === 1) {
        return workspaces.find((w) => w.id === resetWorkspaceIds[0])?.name ?? "1 Workspace";
      }
      return `${count} Workspaces`;
    }
    return workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? "This Workspace";
  }, [resetScope, resetWorkspaceIds, workspaces, activeWorkspaceId]);

  // ── Granular Data Deletion state ──
  const [deletionScope, setDeletionScope] = useState<DataDeletionScope>("current_workspace");
  const [deletionWorkspaceIds, setDeletionWorkspaceIds] = useState<string[]>([]);
  const [selectedDeletionCategories, setSelectedDeletionCategories] = useState<string[]>(
    () => DATA_DELETION_CATEGORIES.map((c) => c.id),
  );
  const [deletionTimeFilter, setDeletionTimeFilter] = useState<DataDeletionTimeFilter>("all");
  const [deletionPreview, setDeletionPreview] = useState<DataDeletionPreview | null>(null);
  const [loadingDeletionPreview, setLoadingDeletionPreview] = useState(false);
  const [deletionDialogOpen, setDeletionDialogOpen] = useState(false);
  const [deletionRunning, setDeletionRunning] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);

  function toggleDeletionCategory(catId: string, checked: boolean) {
    setSelectedDeletionCategories((current) =>
      checked ? Array.from(new Set([...current, catId])) : current.filter((id) => id !== catId),
    );
  }

  function toggleDeletionWorkspace(workspaceId: string, checked: boolean) {
    setDeletionWorkspaceIds((current) =>
      checked ? Array.from(new Set([...current, workspaceId])) : current.filter((id) => id !== workspaceId),
    );
  }

  function getResolvedDeletionWorkspaceIds(): string[] {
    if (deletionScope === "all_workspaces") {
      return workspaces.map((w) => w.id);
    }
    if (deletionScope === "selected_workspaces") {
      return deletionWorkspaceIds;
    }
    return activeWorkspaceId ? [activeWorkspaceId] : [];
  }

  const deletionScopeIsEmpty =
    deletionScope === "selected_workspaces"
      ? deletionWorkspaceIds.length === 0
      : deletionScope === "current_workspace" && !activeWorkspaceId;

  const deletionScopeDescription = useMemo(() => {
    if (deletionScope === "all_workspaces") {
      return "across all workspaces";
    }
    if (deletionScope === "selected_workspaces") {
      const count = deletionWorkspaceIds.length;
      return count === 1
        ? `for ${workspaces.find((w) => w.id === deletionWorkspaceIds[0])?.name ?? "the selected workspace"}`
        : `across ${count} selected workspace${count === 1 ? "" : "s"}`;
    }
    const active = workspaces.find((w) => w.id === activeWorkspaceId);
    return active ? `for ${active.name}` : "for the current workspace";
  }, [deletionScope, deletionWorkspaceIds, workspaces, activeWorkspaceId]);

  const deletionScopeButtonLabel = useMemo(() => {
    if (deletionScope === "all_workspaces") {
      return "All Workspaces";
    }
    if (deletionScope === "selected_workspaces") {
      const count = deletionWorkspaceIds.length;
      if (count === 1) {
        return workspaces.find((w) => w.id === deletionWorkspaceIds[0])?.name ?? "1 Workspace";
      }
      return `${count} Workspaces`;
    }
    return workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? "This Workspace";
  }, [deletionScope, deletionWorkspaceIds, workspaces, activeWorkspaceId]);

  async function openDeletionDialog() {
    setDeletionDialogOpen(true);
    setLoadingDeletionPreview(true);
    setDeletionError(null);
    try {
      const wsIds = getResolvedDeletionWorkspaceIds();
      const prev = await api.dataDeletion.preview({
        scope: deletionScope,
        workspace_ids: wsIds,
        categories: selectedDeletionCategories,
        time_filter: deletionTimeFilter,
      });
      setDeletionPreview(prev);
    } catch (err) {
      setDeletionError(err instanceof Error ? err.message : String(err));
      setDeletionPreview(null);
    } finally {
      setLoadingDeletionPreview(false);
    }
  }

  async function confirmDeletion() {
    setDeletionRunning(true);
    setDeletionError(null);
    try {
      const wsIds = getResolvedDeletionWorkspaceIds();
      const result = await api.dataDeletion.execute({
        scope: deletionScope,
        workspace_ids: wsIds,
        categories: selectedDeletionCategories,
        time_filter: deletionTimeFilter,
      });
      setDeletionDialogOpen(false);
      setSuccess(formatDataDeletionResult(result));
      setSuccessDialog({
        title: "Granular Data Deletion Complete",
        description: formatDataDeletionResult(result),
      });
    } catch (err) {
      setDeletionError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletionRunning(false);
    }
  }

  async function loadPreview(nextOptions: KnowledgeResetOptions) {
    setLoadingPreview(true);
    setError(null);
    try {
      setPreview(await runScopedReset(nextOptions, true));
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function openResetDialog() {
    setDialogOpen(true);
    setSuccess(null);
    await loadPreview(options);
  }

  async function updateOption(key: keyof KnowledgeResetOptions, value: boolean) {
    const next = { ...options, [key]: value };
    setOptions(next);
    if (dialogOpen) {
      await loadPreview(next);
    }
  }

  async function confirmReset() {
    setRunning(true);
    setError(null);
    try {
      const result = await runScopedReset(options, false);
      setPreview(result);
      setDialogOpen(false);
      setSuccess(formatKnowledgeResetResult(result));
      setSuccessDialog({
        title: "AI-Inferred Data Reset Complete",
        description: formatKnowledgeResetResult(result),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  // True only for the exact 7-job set the backend's dedicated refresh
  // coordinator (`refreshWorkspace`) runs — lets queueBackgroundProcessing
  // take that optimized path instead of the generic job queue.
  const isFastPathSelection = useMemo(() => {
    if (selectedProcessingJobs.length !== REFRESH_WORKSPACE_TASK_TYPES.length) { return false; }
    const selected = new Set(selectedProcessingJobs);
    return REFRESH_WORKSPACE_TASK_TYPES.every((t) => selected.has(t));
  }, [selectedProcessingJobs]);

  // True for this panel's own default (standard refresh + cleanup jobs) —
  // drives the "reset to default" affordance, independent of the fast path.
  const isDefaultSelection = useMemo(() => {
    if (selectedProcessingJobs.length !== DEFAULT_PROCESSING_JOBS.length) { return false; }
    const selected = new Set(selectedProcessingJobs);
    return DEFAULT_PROCESSING_JOBS.every((t) => selected.has(t));
  }, [selectedProcessingJobs]);

  function resetToDefaultSelection() {
    setSelectedProcessingJobs([...DEFAULT_PROCESSING_JOBS]);
  }

  async function queueBackgroundProcessing() {
    setProcessingRunning(true);
    setError(null);
    setSuccess(null);
    const taskTypes = selectedProcessingJobs.length > 0
      ? selectedProcessingJobs
      : [...REFRESH_WORKSPACE_TASK_TYPES];
    const initialStatus: Record<string, BatchRowStatus> = Object.fromEntries(
      taskTypes.map((t) => [t, "queued" as BatchRowStatus]),
    );
    setBatchStatus(initialStatus);
    setBatchProgress({ current: 0, total: taskTypes.length });
    setBatchWorkspaceProgress(null);
    batchActiveRef.current = true;
    try {
      if (isFastPathSelection && processingScope === "current_workspace" && activeWorkspaceId) {
        await api.knowledge.refreshWorkspace(activeWorkspaceId, "async");
        setSuccess("Refresh started. Progress will appear below and in the status bar.");
      } else {
        const workspaceIds = processingScope === "selected_workspaces"
          ? selectedWorkspaceIds
          : processingScope === "current_workspace" && activeWorkspaceId
            ? [activeWorkspaceId]
            : [];
        await api.backgroundJobs.queueProcessingNow({
          scope: processingScope,
          workspace_ids: workspaceIds,
          task_types: taskTypes,
          include_imported: true,
        });
        setSuccess("Background processing queued. Progress will appear below and in the status bar.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      batchActiveRef.current = false;
      setBatchStatus(null);
      setBatchProgress(null);
    } finally {
      setProcessingRunning(false);
    }
  }

  const [startingOllamaInPanel, setStartingOllamaInPanel] = useState(false);
  const checkOllamaReachability = useSettingsStore((s) => s.checkOllamaReachability);

  async function handleStartOllamaAndRetry() {
    setStartingOllamaInPanel(true);
    try {
      await api.ollama.ensureRunning();
      await checkOllamaReachability();
      setError(null);
      void queueBackgroundProcessing();
    } catch (err) {
      await checkOllamaReachability();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStartingOllamaInPanel(false);
    }
  }

  function toggleProcessingJob(jobKey: string, checked: boolean) {
    setSelectedProcessingJobs((current) => checked
      ? Array.from(new Set([...current, jobKey]))
      : current.filter((key) => key !== jobKey));
  }

  function toggleProcessingWorkspace(workspaceId: string, checked: boolean) {
    setSelectedWorkspaceIds((current) => checked
      ? Array.from(new Set([...current, workspaceId]))
      : current.filter((id) => id !== workspaceId));
  }

  function toggleResetWorkspace(workspaceId: string, checked: boolean) {
    setResetWorkspaceIds((current) => checked
      ? Array.from(new Set([...current, workspaceId]))
      : current.filter((id) => id !== workspaceId));
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    const childTypes = new Set(REFRESH_WORKSPACE_TASK_TYPES as readonly string[]);
    api.listenBackgroundTask((event: BackgroundTaskEvent) => {
      if (!batchActiveRef.current) { return; }
      const isStandardChild = childTypes.has(event.task_type);
      const isBatch = event.task_type === "manual_data_processing";
      if (!isStandardChild && !isBatch) { return; }

      if (isBatch) {
        if (typeof event.current === "number" && typeof event.total === "number") {
          setBatchProgress({ current: event.current, total: event.total });
        }
        const childKey = event.current_task_type;
        if (event.status === "processing" && childKey) {
          setBatchStatus((prev) => {
            if (!prev) { return prev; }
            const next: Record<string, BatchRowStatus> = { ...prev };
            for (const key of Object.keys(next)) {
              if (key === childKey) {
                next[key] = "running";
              } else if (next[key] === "running") {
                next[key] = "completed";
              }
            }
            return next;
          });
          if (
            event.workspace_id
            && typeof event.workspace_index === "number"
            && typeof event.workspace_total === "number"
          ) {
            setBatchWorkspaceProgress({
              workspaceId: event.workspace_id,
              index: event.workspace_index,
              total: event.workspace_total,
            });
          } else {
            // A job without per-workspace reporting is now running — clear
            // any stale progress left over from the previous child job.
            setBatchWorkspaceProgress(null);
          }
        } else if (event.status === "completed") {
          setBatchStatus((prev) => {
            if (!prev) { return prev; }
            const next: Record<string, BatchRowStatus> = { ...prev };
            for (const key of Object.keys(next)) {
              if (next[key] !== "failed") { next[key] = "completed"; }
            }
            return next;
          });
          setBatchWorkspaceProgress(null);
          finalizeBatch();
        } else if (event.status === "failed" || event.status === "cancelled") {
          setBatchStatus((prev) => {
            if (!prev) { return prev; }
            const next: Record<string, BatchRowStatus> = { ...prev };
            for (const key of Object.keys(next)) {
              if (next[key] === "running") { next[key] = "failed"; }
            }
            return next;
          });
          setBatchWorkspaceProgress(null);
          finalizeBatch();
        }
      } else if (isStandardChild) {
        const key = event.task_type;
        if (event.status === "started" || event.status === "processing") {
          setBatchStatus((prev) => prev && prev[key] !== undefined
            ? { ...prev, [key]: "running" }
            : prev);
        } else if (event.status === "completed") {
          setBatchStatus((prev) => {
            if (!prev || prev[key] === undefined) { return prev; }
            const next = { ...prev, [key]: "completed" as BatchRowStatus };
            advanceProgressFromStatus(next);
            checkAllSettled(next);
            return next;
          });
        } else if (event.status === "failed" || event.status === "cancelled") {
          setBatchStatus((prev) => {
            if (!prev || prev[key] === undefined) { return prev; }
            const next = { ...prev, [key]: "failed" as BatchRowStatus };
            advanceProgressFromStatus(next);
            checkAllSettled(next);
            return next;
          });
        }
      }
    }).then((fn) => {
      if (cancelled) { fn(); return; }
      unlisten = fn;
    }).catch(() => {});

    function advanceProgressFromStatus(status: Record<string, BatchRowStatus>) {
      const total = Object.keys(status).length;
      const settled = Object.values(status).filter((s) => s === "completed" || s === "failed").length;
      setBatchProgress({ current: settled, total });
    }
    function checkAllSettled(status: Record<string, BatchRowStatus>) {
      const allSettled = Object.values(status).every((s) => s === "completed" || s === "failed");
      if (allSettled) { finalizeBatch(); }
    }
    function finalizeBatch() {
      batchActiveRef.current = false;
      if (clearTimer) { clearTimeout(clearTimer); }
      clearTimer = setTimeout(() => {
        setBatchStatus(null);
        setBatchProgress(null);
        setBatchWorkspaceProgress(null);
      }, 5000);
    }

    return () => {
      cancelled = true;
      if (unlisten) { unlisten(); }
      if (clearTimer) { clearTimeout(clearTimer); }
    };
  }, []);

  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    api.aiModel.list().then((models) => {
      if (active) {
        setAvailableModels(
          models.map((m) => ({ id: m.model_id, name: m.name || m.model_id })),
        );
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!modelDropdownOpen) { return; }
    function handlePointerDown(event: MouseEvent) {
      if (modelMenuRef.current?.contains(event.target as Node)) { return; }
      setModelDropdownOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setModelDropdownOpen(false);
      }
    }
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [modelDropdownOpen]);

  const batchInFlight = batchStatus !== null
    && Object.values(batchStatus).some((s) => s === "queued" || s === "running");
  const processingDisabled = processingRunning
    || batchInFlight
    || (processingScope === "current_workspace" && !activeWorkspaceId)
    || (processingScope === "selected_workspaces" && selectedWorkspaceIds.length === 0)
    || selectedProcessingJobs.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain px-5 py-4">
      <div className="max-w-3xl space-y-6">
        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">Data Controls</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
              Global maintenance actions that can affect every workspace. Source chats, notes, files, and workspace records are preserved.
            </p>
          </div>

          {success && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {success}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="font-semibold text-rose-300">
                  {error.includes("Ollama isn't reachable") || error.includes("Failed to fetch models")
                    ? "Ollama Is Unreachable"
                    : "Background Processing Error"}
                </div>
                <div className="text-xs text-rose-300/80 mt-0.5">{error}</div>
              </div>
              {(error.includes("Ollama isn't reachable") || error.includes("Failed to fetch models")) && (
                <button
                  type="button"
                  onClick={() => { void handleStartOllamaAndRetry(); }}
                  disabled={startingOllamaInPanel}
                  className="inline-flex shrink-0 items-center justify-center rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-50 transition-colors"
                >
                  {startingOllamaInPanel ? "Starting Ollama..." : "Start Ollama & Retry"}
                </button>
              )}
            </div>
          )}

          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 py-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">Run Background Processing Now</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                    Catch up imported chats and source material once without changing automatic scheduling.
                  </p>
                </div>
                <div ref={modelMenuRef} className="relative inline-flex shrink-0 items-center rounded-xl bg-[var(--accent-color)] text-white shadow-sm font-medium text-sm">
                  <button
                    type="button"
                    onClick={() => { void queueBackgroundProcessing(); }}
                    disabled={processingDisabled}
                    title={isDefaultSelection ? `Runs the default refresh (${DEFAULT_PROCESSING_JOBS.length} jobs)` : "Runs only the jobs you have selected"}
                    className="inline-flex items-center gap-2 rounded-l-xl px-4 py-2 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {processingRunning || batchInFlight ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                    <span>{isDefaultSelection ? "Run Now" : "Run Custom"}</span>
                  </button>
                  <div className="h-5 w-[1px] bg-white/30" />
                  <button
                    type="button"
                    onClick={() => { setModelDropdownOpen((prev) => !prev); }}
                    disabled={processingDisabled}
                    title="Select model to run background processing with"
                    className="inline-flex items-center justify-center rounded-r-xl px-2.5 py-2 hover:bg-black/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronDown size={14} className={`transition-transform duration-200 ${modelDropdownOpen ? "rotate-180" : ""}`} />
                  </button>

                  {modelDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[220px] max-h-60 overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1.5 shadow-xl text-xs text-[var(--text-primary)]">
                      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)] mb-1">
                        Select Model to Run
                      </div>
                      {availableModels.length === 0 ? (
                        <div className="px-2 py-1.5 text-[var(--text-muted)]">No models configured</div>
                      ) : (
                        availableModels.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setModelDropdownOpen(false);
                              void (async () => {
                                await api.backgroundJobs.setInferenceJobSetting("background_model", m.id);
                                setSuccess(`Set background model to ${m.name} and queued processing.`);
                                void queueBackgroundProcessing();
                              })();
                            }}
                            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left text-[var(--text-secondary)] hover:bg-[var(--accent-color)]/15 hover:text-[var(--text-primary)] transition-colors"
                          >
                            <span className="truncate">{m.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              {!isDefaultSelection && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-muted)]">
                  <span>Custom selection — does not match the default.</span>
                  <button
                    type="button"
                    onClick={resetToDefaultSelection}
                    className="text-[var(--accent-color)] hover:underline"
                  >
                    Reset to default
                  </button>
                </div>
              )}

              {batchStatus && batchProgress && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                    <span>
                      {batchInFlight ? "Running" : "Finished"} job {batchProgress.current} of {batchProgress.total}
                      {batchWorkspaceProgress && (
                        <>
                          {" — workspace "}
                          {batchWorkspaceProgress.index} of {batchWorkspaceProgress.total}
                          {(() => {
                            const name = workspaces.find((w) => w.id === batchWorkspaceProgress.workspaceId)?.name;
                            return name ? ` (${name})` : "";
                          })()}
                        </>
                      )}
                    </span>
                    <span>{Math.round((batchProgress.current / Math.max(batchProgress.total, 1)) * 100)}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-primary)]">
                    <div
                      className="h-full bg-[var(--accent-color)] transition-all duration-300"
                      style={{ width: `${Math.min(100, (batchProgress.current / Math.max(batchProgress.total, 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Scope</div>
                  <div className="space-y-1.5">
                    {[
                      { value: "current_workspace", label: "Current workspace" },
                      { value: "selected_workspaces", label: "Selected workspaces" },
                      { value: "all_workspaces", label: "All workspaces" },
                    ].map((option) => (
                      <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                        <input
                          type="radio"
                          name="background-processing-scope"
                          checked={processingScope === option.value}
                          onChange={() => setProcessingScope(option.value as BackgroundProcessingScope)}
                          className="h-4 w-4 accent-[var(--accent-color)]"
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  {processingScope === "selected_workspaces" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Workspaces</div>
                        <div className="flex items-center gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => setSelectedWorkspaceIds([])}
                            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            Clear all
                          </button>
                          <span className="text-[var(--border-color)]">|</span>
                          <button
                            type="button"
                            onClick={() => setSelectedWorkspaceIds(workspaces.map((w) => w.id))}
                            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            Select all
                          </button>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {workspaces.map((workspace) => (
                          <label key={workspace.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                            <input
                              type="checkbox"
                              checked={selectedWorkspaceIds.includes(workspace.id)}
                              onChange={(event) => toggleProcessingWorkspace(workspace.id, event.target.checked)}
                              className="h-4 w-4 accent-[var(--accent-color)]"
                            />
                            <span className="truncate">{workspace.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Jobs</div>
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => setSelectedProcessingJobs([])}
                          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        >
                          Clear all
                        </button>
                        <span className="text-[var(--border-color)]">|</span>
                        <button
                          type="button"
                          onClick={() => setSelectedProcessingJobs(INFERENCE_JOBS_CATALOG.map((j) => j.job_key))}
                          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        >
                          Select all
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {INFERENCE_JOBS_CATALOG.map((job) => {
                        const rowStatus = batchStatus?.[job.job_key];
                        const pillStyles: Record<BatchRowStatus, string> = {
                          queued: "bg-[var(--bg-elevated)] text-[var(--text-muted)]",
                          running: "bg-[var(--accent-color)]/20 text-[var(--accent-color)] animate-pulse",
                          completed: "bg-emerald-500/15 text-emerald-300",
                          failed: "bg-red-500/15 text-red-300",
                        };
                        return (
                          <label key={job.job_key} className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedProcessingJobs.includes(job.job_key)}
                              onChange={(event) => toggleProcessingJob(job.job_key, event.target.checked)}
                              className="mt-0.5 h-4 w-4 accent-[var(--accent-color)]"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{job.label}</span>
                                {rowStatus && (
                                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${pillStyles[rowStatus]}`}>
                                    {rowStatus}
                                  </span>
                                )}
                              </span>
                              <span className="block text-xs leading-5 text-[var(--text-muted)]">{job.description}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-4">
            <div className="flex flex-col gap-4">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-[var(--text-primary)]">Reset AI-Inferred Workspace Data</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                  Clear generated graph, topic, prompt-bank, and analysis state {resetScopeDescription} after major concept iteration.
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Reset scope</div>
                <div className="flex flex-col gap-1.5 sm:flex-row">
                  {[
                    { value: "current_workspace", label: "Current workspace" },
                    { value: "selected_workspaces", label: "Selected workspaces" },
                    { value: "all_workspaces", label: "All workspaces" },
                  ].map((option) => (
                    <label key={option.value} className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-red-500/25 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                      <input
                        type="radio"
                        name="knowledge-reset-scope"
                        checked={resetScope === option.value}
                        onChange={() => {
                          const next = option.value as BackgroundProcessingScope;
                          setResetScope(next);
                          // Seed the checkbox list from the active workspace so
                          // the button label never reads "0 Workspaces" the
                          // instant this mode is picked.
                          if (next === "selected_workspaces" && resetWorkspaceIds.length === 0 && activeWorkspaceId) {
                            setResetWorkspaceIds([activeWorkspaceId]);
                          }
                        }}
                        className="h-4 w-4 accent-red-500"
                      />
                      <span className="truncate">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {resetScope === "selected_workspaces" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Workspaces to reset</div>
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setResetWorkspaceIds([])}
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        Clear all
                      </button>
                      <span className="text-[var(--border-color)]">|</span>
                      <button
                        type="button"
                        onClick={() => setResetWorkspaceIds(workspaces.map((w) => w.id))}
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        Select all
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {workspaces.map((workspace) => (
                      <label key={workspace.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-red-500/25 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={resetWorkspaceIds.includes(workspace.id)}
                          onChange={(event) => toggleResetWorkspace(workspace.id, event.target.checked)}
                          className="h-4 w-4 accent-red-500"
                        />
                        <span className="truncate">{workspace.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={openResetDialog}
                  disabled={resetScopeIsEmpty}
                  title={resetScopeIsEmpty ? "Select at least one workspace to reset." : undefined}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCcw size={15} />
                  {resetScopeIsEmpty ? "Reset AI-Inferred Data" : `Reset AI-Inferred Data — ${resetScopeButtonLabel}`}
                </button>
              </div>
            </div>
          </div>

          {/* Granular Data Deletion Card */}
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-4">
            <div className="flex flex-col gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Trash2 size={16} className="text-red-400" />
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">Granular Data Deletion</h3>
                </div>
                <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                  Selectively delete specific categories of data (chats, notes, sources, flashcards, concepts, memories, queue) {deletionScopeDescription} with optional age filtering.
                </p>
              </div>

              {/* Scope Selection */}
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Deletion scope</div>
                <div className="flex flex-col gap-1.5 sm:flex-row">
                  {[
                    { value: "current_workspace", label: "Current workspace" },
                    { value: "selected_workspaces", label: "Selected workspaces" },
                    { value: "all_workspaces", label: "All workspaces" },
                  ].map((option) => (
                    <label key={option.value} className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-red-500/25 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                      <input
                        type="radio"
                        name="data-deletion-scope"
                        checked={deletionScope === option.value}
                        onChange={() => {
                          const next = option.value as DataDeletionScope;
                          setDeletionScope(next);
                          if (next === "selected_workspaces" && deletionWorkspaceIds.length === 0 && activeWorkspaceId) {
                            setDeletionWorkspaceIds([activeWorkspaceId]);
                          }
                        }}
                        className="h-4 w-4 accent-red-500"
                      />
                      <span className="truncate">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {deletionScope === "selected_workspaces" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Workspaces to target</div>
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setDeletionWorkspaceIds([])}
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        Clear all
                      </button>
                      <span className="text-[var(--border-color)]">|</span>
                      <button
                        type="button"
                        onClick={() => setDeletionWorkspaceIds(workspaces.map((w) => w.id))}
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        Select all
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {workspaces.map((workspace) => (
                      <label key={workspace.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-red-500/25 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={deletionWorkspaceIds.includes(workspace.id)}
                          onChange={(event) => toggleDeletionWorkspace(workspace.id, event.target.checked)}
                          className="h-4 w-4 accent-red-500"
                        />
                        <span className="truncate">{workspace.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Category Selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Data Categories to delete</div>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedDeletionCategories([])}
                      className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      Clear all
                    </button>
                    <span className="text-[var(--border-color)]">|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedDeletionCategories(DATA_DELETION_CATEGORIES.map((c) => c.id))}
                      className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      Select all
                    </button>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {DATA_DELETION_CATEGORIES.map((cat) => (
                    <label key={cat.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-red-500/25 bg-[var(--bg-primary)] px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedDeletionCategories.includes(cat.id)}
                        onChange={(event) => toggleDeletionCategory(cat.id, event.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-red-500"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{cat.label}</span>
                        <span className="block text-xs leading-4 text-[var(--text-muted)] mt-0.5">{cat.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Time Cutoff Filter */}
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Retention / Age Cutoff</div>
                <div className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
                  {TIME_FILTER_OPTIONS.map((tf) => (
                    <label key={tf.value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-red-500/25 bg-[var(--bg-primary)] px-2.5 py-2 text-xs text-[var(--text-secondary)]">
                      <input
                        type="radio"
                        name="data-deletion-time-filter"
                        checked={deletionTimeFilter === tf.value}
                        onChange={() => setDeletionTimeFilter(tf.value)}
                        className="h-3.5 w-3.5 accent-red-500"
                      />
                      <span className="truncate">{tf.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Action Button */}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => { void openDeletionDialog(); }}
                  disabled={deletionScopeIsEmpty || selectedDeletionCategories.length === 0}
                  title={
                    deletionScopeIsEmpty
                      ? "Select at least one workspace."
                      : selectedDeletionCategories.length === 0
                        ? "Select at least one category to delete."
                        : undefined
                  }
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                >
                  <Trash2 size={15} />
                  {deletionScopeIsEmpty || selectedDeletionCategories.length === 0
                    ? "Delete Selected Data"
                    : `Delete Selected Data — ${deletionScopeButtonLabel}`}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {deletionDialogOpen && (
        <DataDeletionDialog
          scopeDescription={deletionScopeDescription}
          timeFilter={deletionTimeFilter}
          selectedCategories={selectedDeletionCategories}
          preview={deletionPreview}
          loadingPreview={loadingDeletionPreview}
          running={deletionRunning}
          error={deletionError}
          onConfirm={() => { void confirmDeletion(); }}
          onCancel={() => setDeletionDialogOpen(false)}
        />
      )}

      {dialogOpen && (
        <KnowledgeResetDialog
          title="Reset AI-Inferred Workspace Data"
          description={`Clear selected AI-inferred data ${resetScopeDescription}. Source material is preserved.`}
          options={options}
          preview={preview}
          loadingPreview={loadingPreview}
          running={running}
          error={error}
          onOptionChange={(key, value) => { void updateOption(key, value); }}
          onConfirm={() => { void confirmReset(); }}
          onCancel={() => setDialogOpen(false)}
        />
      )}
      {successDialog && (
        <SuccessDialog
          title={successDialog.title}
          description={successDialog.description}
          onConfirm={() => setSuccessDialog(null)}
        />
      )}
    </div>
  );
}
