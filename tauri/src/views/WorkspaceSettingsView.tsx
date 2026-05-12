/**
 * WorkspaceSettingsView — manage workspaces: rename, reorder, delete, and switch.
 * Mirrors WorkspaceListView.swift + workspace picker behaviour.
 */
import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Trash2, Pencil, Check, X, LayoutGrid, CornerDownRight,
  MessageSquare, FileText, Globe, Brain, CreditCard,
  Database, Sparkles, Save, Loader2, ChevronRight, ChevronDown, ArrowUpDown
} from "lucide-react";
import { api } from "../lib/api";
import ConfirmDialog from "../components/ConfirmDialog";
import CompactMenuSelect from "../components/CompactMenuSelect";
import { TopicsSection } from "../components/TopicsSection";
import WorkspaceMemoryPanel from "./WorkspaceMemoryPanel";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { Tooltip } from "../components/Tooltip";
import { useSettingsStore } from "../stores/settingsStore";
import type { Workspace } from "../stores/workspaceStore";
import type { DashboardSummary, TopicSignature } from "../lib/api";

type WorkspaceDialogState =
  | { kind: "last-workspace" }
  | { kind: "delete"; workspace: Workspace };

function WorkspaceSortMenu() {
  const workspaceSortOrder = useWorkspaceStore((state) => state.workspaceSortOrder);
  const setWorkspaceSortOrder = useWorkspaceStore((state) => state.setWorkspaceSortOrder);
  const [open, setOpen] = useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) { return; }
    function handleDown(e: MouseEvent) { if (!rootRef.current?.contains(e.target as Node)) { setOpen(false); } }
    function handleEsc(e: KeyboardEvent) { if (e.key === "Escape") { setOpen(false); } }
    window.addEventListener("mousedown", handleDown);
    window.addEventListener("keydown", handleEsc);
    return () => { window.removeEventListener("mousedown", handleDown); window.removeEventListener("keydown", handleEsc); };
  }, [open]);

  const options = [
    { id: "name-asc", label: "Name A–Z" },
    { id: "name-desc", label: "Name Z–A" },
    { id: "created-newest", label: "Newest First" },
    { id: "created-oldest", label: "Oldest First" },
    { id: "updated-newest", label: "Recently Updated" },
    { id: "updated-oldest", label: "Least Recently Updated" },
  ] as const;

  return (
    <div ref={rootRef} className="relative">
      <Tooltip content="Sort order">
        <button
          onClick={() => setOpen(!open)}
          className={`flex h-8 w-8 items-center justify-center rounded-lg border text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--accent-color)] ${open ? "border-[var(--accent-color)] bg-[var(--bg-hover)]" : "border-[var(--border-color)] bg-[var(--bg-elevated)]"}`}
        >
          <ArrowUpDown size={14} />
        </button>
      </Tooltip>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-48 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-xl py-1">
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => { setWorkspaceSortOrder(opt.id); setOpen(false); }}
              className={`flex w-full items-center px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--bg-hover)] ${
                workspaceSortOrder === opt.id ? "text-[var(--accent-color)] font-medium" : "text-[var(--text-secondary)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WorkspaceSettingsView() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeParentWorkspaceId = useWorkspaceStore((s) => s.activeParentWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);
  const setActiveParentWorkspaceId = useWorkspaceStore((s) => s.setActiveParentWorkspaceId);
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const setWorkspaces = useWorkspaceStore((s) => s.setWorkspaces);
  const switchWorkspaceSection = useSettingsStore((state) => state.switchWorkspaceSection);
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<WorkspaceDialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [moveToParentId, setMoveToParentId] = useState<string>("");
  const [isMovingToParent, setIsMovingToParent] = useState(false);
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});

  // Stats & Details State
  const [selectedId, setSelectedId] = useState<string | null>(activeWorkspaceId);
  const [stats, setStats] = useState<DashboardSummary | null>(null);
  const [memoryCount, setMemoryCount] = useState<number>(0);
  const [loadingStats, setLoadingStats] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [topicSignaturesByWorkspace, setTopicSignaturesByWorkspace] = useState<Record<string, TopicSignature | null>>({});

  const selectedWorkspace = useMemo(() =>
    workspaces.find(w => w.id === selectedId),
  [workspaces, selectedId]);
  const rootWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.parent_workspace_id === null),
    [workspaces]
  );
  const childWorkspacesByParent = useMemo(
    () => Object.fromEntries(
      rootWorkspaces.map((workspace) => [
        workspace.id,
        workspaces.filter((child) => child.parent_workspace_id === workspace.id),
      ])
    ) as Record<string, Workspace[]>,
    [rootWorkspaces, workspaces]
  );
  const selectedParentWorkspace = useMemo(() => {
    if (!selectedWorkspace) {
      return null;
    }

    if (!selectedWorkspace.parent_workspace_id) {
      return selectedWorkspace;
    }

    return workspaces.find((workspace) => workspace.id === selectedWorkspace.parent_workspace_id) ?? null;
  }, [selectedWorkspace, workspaces]);
  const selectedWorkspaceType = selectedWorkspace?.parent_workspace_id ? "Child Workspace" : selectedWorkspace ? "Root Workspace" : null;
  const childCreateParentId = selectedWorkspace?.parent_workspace_id ?? selectedWorkspace?.id ?? null;

  useEffect(() => {
    setMoveToParentId("");
    if (!selectedId) {
      setStats(null);
      setMemoryCount(0);
      setEditDescription("");
      setEditPrompt("");
      return;
    }

    const ws = workspaces.find(w => w.id === selectedId);
    if (ws) {
      setEditDescription(ws.description || "");
      setEditPrompt(ws.prompt_instructions || "");
    }

    let cancelled = false;

    async function loadStats() {
      if (!selectedId) {return;}
      setLoadingStats(true);
      try {
        const [summary, topicSig] = await Promise.all([
          api.dashboard.getSummary(selectedId),
          api.topicSignature.get(selectedId).catch(() => null)
        ]);
        if (cancelled) {return;}
        setStats(summary);
        setTopicSignaturesByWorkspace(prev => ({ ...prev, [selectedId]: topicSig }));
      } catch (err) {
        if (cancelled) {return;}
        console.error("Failed to load workspace stats:", err);
      } finally {
        if (!cancelled) {setLoadingStats(false);}
      }
    }

    loadStats();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function savePrompt() {
    if (!selectedId || !selectedWorkspace) {return;}
    setIsSavingPrompt(true);
    try {
      await api.workspace.update(selectedId, selectedWorkspace.name, selectedWorkspace.description, editPrompt.trim());
      setWorkspaces(workspaces.map(w => w.id === selectedId ? { ...w, prompt_instructions: editPrompt.trim() } : w));
    } catch (err) {
      console.error("Failed to save prompt instructions:", err);
    } finally {
      setIsSavingPrompt(false);
    }
  }

  async function saveDescription() {
    if (!selectedId || !selectedWorkspace) {return;}
    setIsSavingDescription(true);
    try {
      const trimmedDescription = editDescription.trim();
      await api.workspace.update(
        selectedId,
        selectedWorkspace.name,
        trimmedDescription || undefined,
        selectedWorkspace.prompt_instructions
      );
      setWorkspaces(workspaces.map((workspace) =>
        workspace.id === selectedId ? { ...workspace, description: trimmedDescription } : workspace
      ));
    } catch (err) {
      console.error("Failed to save workspace description:", err);
    } finally {
      setIsSavingDescription(false);
    }
  }

  function resolveWorkspaceActivation(workspaceId: string) {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      return { workspaceId, parentWorkspaceId: workspaceId };
    }

    if (workspace.parent_workspace_id) {
      return {
        workspaceId: workspace.id,
        parentWorkspaceId: workspace.parent_workspace_id,
      };
    }

    const childWorkspace = childWorkspacesByParent[workspace.id]?.[0];
    if (childWorkspace) {
      return {
        workspaceId: childWorkspace.id,
        parentWorkspaceId: workspace.id,
      };
    }

    return {
      workspaceId: workspace.id,
      parentWorkspaceId: workspace.id,
    };
  }

  function activateWorkspace(workspaceId: string) {
    const nextSelection = resolveWorkspaceActivation(workspaceId);
    const isChanged = nextSelection.workspaceId !== activeWorkspaceId;
    setActiveParentWorkspaceId(nextSelection.parentWorkspaceId);
    setActiveWorkspaceId(nextSelection.workspaceId);
    if (isChanged && switchWorkspaceSection) {
      navigate(switchWorkspaceSection);
    }
  }

  function openCreateForm(parentId: string | null = null) {
    if (parentId) {
      setExpandedParents((current) => ({ ...current, [parentId]: true }));
    }
    setCreateParentId(parentId);
    setShowNew(true);
  }

  function resetNewWorkspaceForm() {
    setNewName("");
    setNewDescription("");
    setCreateParentId(null);
    setShowNew(false);
  }

  async function createWorkspace() {
    if (!newName.trim()) {return;}
    setCreating(true);
    try {
      const trimmedDescription = newDescription.trim();
      const ws = createParentId
        ? await api.workspace.createChild(createParentId, newName.trim(), trimmedDescription || undefined)
        : await api.workspace.create(newName.trim(), trimmedDescription || undefined);
      addWorkspace(ws);
      const parentWorkspaceId = ws.parent_workspace_id;
      if (parentWorkspaceId) {
        setExpandedParents((current) => ({ ...current, [parentWorkspaceId]: true }));
      }
      setSelectedId(ws.id);
      activateWorkspace(ws.id);
      resetNewWorkspaceForm();
    } finally {
      setCreating(false);
    }
  }

  async function renameWorkspace(id: string) {
    if (!editName.trim()) { setEditingId(null); return; }
    const workspace = workspaces.find((item) => item.id === id);
    await api.workspace.update(
      id,
      editName.trim(),
      workspace?.description || undefined,
      workspace?.prompt_instructions
    );
    setWorkspaces(workspaces.map((w) =>
      w.id === id ? { ...w, name: editName.trim() } : w
    ));
    setEditingId(null);
  }

  async function performDeleteWorkspace(ws: Workspace) {
    await api.workspace.delete(ws.id);
    const remaining = await api.workspace.list();
    setWorkspaces(remaining);

    if (selectedId === ws.id) {
      const siblingId = ws.parent_workspace_id
        ? remaining.find((workspace) => workspace.parent_workspace_id === ws.parent_workspace_id)?.id
        : null;
      const promotedChildId = !ws.parent_workspace_id
        ? workspaces
            .filter((workspace) => workspace.parent_workspace_id === ws.id)
            .map((workspace) => workspace.id)
            .find((workspaceId) => remaining.some((workspace) => workspace.id === workspaceId))
        : null;
      setSelectedId(siblingId ?? ws.parent_workspace_id ?? promotedChildId ?? remaining[0]?.id ?? null);
    }
  }

  function deleteWorkspace(ws: Workspace) {
    if (workspaces.length === 1) {
      setDialogState({ kind: "last-workspace" });
      return;
    }
    setDialogState({ kind: "delete", workspace: ws });
  }

  async function moveWorkspaceToParent(ws: Workspace) {
    if (!moveToParentId) { return; }
    setIsMovingToParent(true);
    try {
      await api.workspace.setParent(ws.id, moveToParentId);
      const updated = workspaces.map((w) =>
        w.id === ws.id ? { ...w, parent_workspace_id: moveToParentId } : w
      );
      setWorkspaces(updated);
      // If this workspace was the active parent, update parent reference
      if (activeParentWorkspaceId === ws.id) {
        setActiveParentWorkspaceId(moveToParentId);
      }
      setMoveToParentId("");
    } finally {
      setIsMovingToParent(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">Workspaces</h1>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            {rootWorkspaces.length} root workspace{rootWorkspaces.length !== 1 ? "s" : ""} · {workspaces.length - rootWorkspaces.length} child workspace{workspaces.length - rootWorkspaces.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WorkspaceSortMenu />
          <button
            onClick={() => openCreateForm(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90"
          >
            <Plus size={12} /> New Workspace
          </button>
        </div>
      </div>

      {/* New workspace form */}
      {showNew && (
        <div className="flex flex-col gap-2 px-5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-elevated)] shrink-0">
          <div className="max-w-3xl w-full flex flex-col gap-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
            {createParentId
              ? `New Child Workspace in ${workspaces.find((workspace) => workspace.id === createParentId)?.name ?? "Parent Workspace"}`
              : "New Root Workspace"}
          </div>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {createWorkspace();}
              if (e.key === "Escape") { resetNewWorkspaceForm(); }
            }}
            placeholder={createParentId ? "Child workspace name…" : "Workspace name…"}
            className="text-sm bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg px-3 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
          />
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { resetNewWorkspaceForm(); }
            }}
            placeholder="Optional description…"
            rows={2}
            className="resize-none text-sm bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={createWorkspace}
              disabled={creating || !newName.trim()}
              className="px-3 py-1.5 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40"
            >
              {creating ? "Creating…" : "Create"}
            </button>
            <button
              onClick={() => { resetNewWorkspaceForm(); }}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X size={14} />
            </button>
          </div>
          </div>
        </div>
      )}

      {/* Main Content Areas */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Workspace list */}
        <div className="w-[380px] border-r border-[var(--border-color)] flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {workspaces.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] gap-2">
                <LayoutGrid size={32} className="opacity-30" />
                <p className="text-sm">No workspaces yet.</p>
              </div>
            ) : (
              rootWorkspaces.map((ws) => {
                const children = childWorkspacesByParent[ws.id] ?? [];
                const isActive = ws.id === activeWorkspaceId || ws.id === activeParentWorkspaceId;
                const isSelected = ws.id === selectedId;
                const isEditing = editingId === ws.id;
                const hasSelectedChild = children.some((child) => child.id === selectedId);
                const hasActiveChild = children.some((child) => child.id === activeWorkspaceId);
                const isExpanded = expandedParents[ws.id] ?? (hasSelectedChild || hasActiveChild);

                return (
                  <div key={ws.id} className="space-y-2">
                    <div
                      onClick={() => setSelectedId(ws.id)}
                      className={`rounded-xl border p-4 transition-all cursor-pointer group ${
                        isSelected
                          ? "border-[var(--accent-color)] bg-[var(--accent-color)]/5 ring-1 ring-[var(--accent-color)]/20"
                          : "border-[var(--border-color)] bg-[var(--bg-elevated)] hover:border-[var(--border-color-hover)]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${isActive ? "bg-[var(--accent-color)]" : "bg-[var(--bg-hover)]"}`} />

                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <div className="flex flex-col gap-1.5" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-2">
                                <input
                                  autoFocus
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {renameWorkspace(ws.id);}
                                    if (e.key === "Escape") {setEditingId(null);}
                                  }}
                                  placeholder="Workspace name…"
                                  className="flex-1 text-sm font-medium bg-[var(--bg-input)] border border-[var(--accent-color)] rounded px-2 py-0.5 text-[var(--text-primary)] outline-none"
                                />
                                <button onClick={() => renameWorkspace(ws.id)} className="text-[var(--accent-color)]">
                                  <Check size={14} />
                                </button>
                                <button onClick={() => setEditingId(null)} className="text-[var(--text-muted)]">
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <span className="block pr-2 text-[15px] font-semibold leading-5 text-[var(--text-primary)] whitespace-normal break-words">
                                {ws.name}
                              </span>
                              {(isActive || children.length > 0) && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {isActive && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-color)]/20 text-[var(--accent-color)] font-medium">
                                      {ws.id === activeWorkspaceId ? "Active" : "Active Parent"}
                                    </span>
                                  )}
                                  {children.length > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-secondary)] font-medium">
                                      {children.length} child{children.length !== 1 ? "ren" : ""}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-start gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          {children.length > 0 && (
                            <Tooltip content={isExpanded ? "Collapse child workspaces" : "Expand child workspaces"}>
                              <button
                                onClick={() => setExpandedParents((current) => ({ ...current, [ws.id]: !isExpanded }))}
                                className="mt-0.5 p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-hover)]"
                                aria-label={`${isExpanded ? "Collapse" : "Expand"} child workspaces for ${ws.name}`}
                              >
                                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              </button>
                            </Tooltip>
                          )}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {!isActive && (
                              <button
                                onClick={() => activateWorkspace(ws.id)}
                                className="px-2 py-1 text-[11px] rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors"
                              >
                                Switch
                              </button>
                            )}
                            <Tooltip content="New child workspace">
                              <button
                                onClick={() => openCreateForm(ws.id)}
                                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-hover)]"
                              >
                                <Plus size={13} />
                              </button>
                            </Tooltip>
                            <Tooltip content="Rename">
                              <button
                                onClick={() => { setEditingId(ws.id); setEditName(ws.name); setEditDescription(ws.description ?? ""); }}
                                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-hover)]"
                              >
                                <Pencil size={13} />
                              </button>
                            </Tooltip>
                            <Tooltip content="Delete workspace">
                              <button
                                onClick={() => deleteWorkspace(ws)}
                                className="p-1.5 text-[var(--text-muted)] hover:text-red-400 rounded-lg hover:bg-red-400/10"
                              >
                                <Trash2 size={13} />
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    </div>

                    {children.length > 0 && isExpanded && (
                      <div className="ml-5 border-l border-[var(--border-color)] pl-4 space-y-2">
                        {children.map((child) => {
                          const isChildActive = child.id === activeWorkspaceId;
                          const isChildSelected = child.id === selectedId;
                          const isChildEditing = editingId === child.id;

                          return (
                            <div
                              key={child.id}
                              onClick={() => setSelectedId(child.id)}
                              className={`rounded-xl border p-3 transition-all cursor-pointer group ${
                                isChildSelected
                                  ? "border-[var(--accent-color)] bg-[var(--accent-color)]/5 ring-1 ring-[var(--accent-color)]/20"
                                  : "border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--border-color-hover)]"
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <CornerDownRight size={14} className={`mt-0.5 shrink-0 ${isChildActive ? "text-[var(--accent-color)]" : "text-[var(--text-muted)]"}`} />
                                <div className="flex-1 min-w-0">
                                  {isChildEditing ? (
                                    <div className="flex flex-col gap-1.5" onClick={e => e.stopPropagation()}>
                                      <div className="flex items-center gap-2">
                                        <input
                                          autoFocus
                                          value={editName}
                                          onChange={(e) => setEditName(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") {renameWorkspace(child.id);}
                                            if (e.key === "Escape") {setEditingId(null);}
                                          }}
                                          placeholder="Workspace name…"
                                          className="flex-1 text-sm font-medium bg-[var(--bg-input)] border border-[var(--accent-color)] rounded px-2 py-0.5 text-[var(--text-primary)] outline-none"
                                        />
                                        <button onClick={() => renameWorkspace(child.id)} className="text-[var(--accent-color)]">
                                          <Check size={14} />
                                        </button>
                                        <button onClick={() => setEditingId(null)} className="text-[var(--text-muted)]">
                                          <X size={14} />
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex flex-col gap-1">
                                      <span className="block pr-2 text-[15px] font-semibold leading-5 text-[var(--text-primary)] whitespace-normal break-words">
                                        {child.name}
                                      </span>
                                      {isChildActive && (
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-color)]/20 text-[var(--accent-color)] font-medium">
                                            Active
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-start gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                  {!isChildActive && (
                                    <button
                                      onClick={() => activateWorkspace(child.id)}
                                      className="px-2 py-1 text-[11px] rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors"
                                    >
                                      Switch
                                    </button>
                                  )}
                                  <Tooltip content="Rename">
                                    <button
                                      onClick={() => { setEditingId(child.id); setEditName(child.name); setEditDescription(child.description ?? ""); }}
                                      className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-hover)]"
                                    >
                                      <Pencil size={13} />
                                    </button>
                                  </Tooltip>
                                  <Tooltip content="Delete workspace">
                                    <button
                                      onClick={() => deleteWorkspace(child)}
                                      className="p-1.5 text-[var(--text-muted)] hover:text-red-400 rounded-lg hover:bg-red-400/10"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </Tooltip>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Workspace Details */}
        <div className="flex-1 bg-[var(--bg-primary)] overflow-y-auto">
          {selectedWorkspace ? (
            <div className="p-8 max-w-4xl mx-auto space-y-10">
              {/* Header Details */}
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-[var(--text-primary)]">{selectedWorkspace.name}</h2>
                  {selectedWorkspace.id === activeWorkspaceId && (
                    <span className="px-2 py-0.5 rounded-md bg-[var(--accent-color)]/10 text-[var(--accent-color)] text-xs font-semibold">
                      Current Active Workspace
                    </span>
                  )}
                  {selectedWorkspace.id !== activeWorkspaceId && selectedWorkspace.id === activeParentWorkspaceId && (
                    <span className="px-2 py-0.5 rounded-md bg-[var(--bg-hover)] text-[var(--text-secondary)] text-xs font-semibold">
                      Active Parent Workspace
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                  {selectedWorkspaceType && (
                    <span className="px-2 py-1 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-color)]">
                      {selectedWorkspaceType}
                    </span>
                  )}
                  {selectedWorkspace.parent_workspace_id && selectedParentWorkspace && (
                    <span className="px-2 py-1 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-color)]">
                      Parent: {selectedParentWorkspace.name}
                    </span>
                  )}
                  {!selectedWorkspace.parent_workspace_id && (
                    <span className="px-2 py-1 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-color)]">
                      {(childWorkspacesByParent[selectedWorkspace.id] ?? []).length} child workspace{(childWorkspacesByParent[selectedWorkspace.id] ?? []).length !== 1 ? "s" : ""}
                    </span>
                  )}
                  <span className="px-2 py-1 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-color)]">
                    Created {formatDate(selectedWorkspace.created_at)}
                  </span>
                </div>
                {childCreateParentId && (
                  <div>
                    <button
                      onClick={() => openCreateForm(childCreateParentId)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--accent-color)]"
                    >
                      <Plus size={12} />
                      New Child Workspace
                    </button>
                  </div>
                )}
                {!selectedWorkspace.parent_workspace_id && rootWorkspaces.filter((ws) => ws.id !== selectedWorkspace.id).length > 0 && (
                  <div className="flex items-center gap-2">
                    <CompactMenuSelect
                      label="Move under parent"
                      value={moveToParentId}
                      onChange={setMoveToParentId}
                      options={[
                        { value: "", label: "Move under parent..." },
                        ...rootWorkspaces
                        .filter((ws) => ws.id !== selectedWorkspace.id)
                        .map((ws) => ({ value: ws.id, label: ws.name })),
                      ]}
                      widthClassName="w-56"
                      buttonClassName="h-10 rounded-xl bg-[var(--bg-elevated)] px-4 text-sm"
                      menuClassName="max-h-72 overflow-y-auto"
                    />
                    {moveToParentId && (
                      <button
                        onClick={() => moveWorkspaceToParent(selectedWorkspace)}
                        disabled={isMovingToParent}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40"
                      >
                        {isMovingToParent ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Move
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Description Editor */}
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
                    Description
                  </h3>
                  <button
                    onClick={saveDescription}
                    disabled={isSavingDescription || editDescription.trim() === (selectedWorkspace.description || "")}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40 transition-all font-medium"
                  >
                    {isSavingDescription ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    {isSavingDescription ? "Saving..." : "Save Description"}
                  </button>
                </div>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Describe what this workspace is for..."
                  rows={3}
                  className="w-full resize-none text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] transition-colors shadow-sm"
                />
              </div>

              {/* Statistics Grid */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-2">
                  <Database size={12} /> Workspace Statistics
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <StatCard
                    icon={<MessageSquare size={16} />}
                    label="Conversations"
                    value={stats?.overview.chat_sessions ?? 0}
                    loading={loadingStats}
                    onClick={() => navigate("/chat")}
                  />
                  <StatCard
                    icon={<FileText size={16} />}
                    label="Notes & Daily"
                    value={stats?.overview.notes ?? 0}
                    loading={loadingStats}
                    onClick={() => navigate("/notes")}
                  />
                  <StatCard
                    icon={<Globe size={16} />}
                    label="Sources & Docs"
                    value={stats?.overview.sources ?? 0}
                    loading={loadingStats}
                    onClick={() => navigate("/sources")}
                  />
                  <StatCard
                    icon={<Brain size={16} />}
                    label="Concept Nodes"
                    value={stats?.overview.concepts ?? 0}
                    loading={loadingStats}
                    onClick={() => navigate("/graph")}
                  />
                  <StatCard
                    icon={<CreditCard size={16} />}
                    label="Flashcards"
                    value={stats?.overview.flashcards ?? 0}
                    loading={loadingStats}
                    onClick={() => navigate("/flashcards")}
                  />
                  <StatCard
                    icon={<Database size={16} />}
                    label="AI Memories"
                    value={memoryCount}
                    loading={loadingStats}
                  />
                </div>
              </div>

              {/* Workspace Memory Panel */}
              <div className="pt-4">
                {/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */}
                <WorkspaceMemoryPanel workspaceId={selectedId!} onMemoryCountChange={setMemoryCount} />
              </div>

              {/* Conversation Prompt Editor */}
              <div className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-2">
                    <Sparkles size={12} /> Conversation Prompt
                  </h3>
                  <button
                    onClick={savePrompt}
                    disabled={isSavingPrompt || editPrompt.trim() === selectedWorkspace.prompt_instructions}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40 transition-all font-medium"
                  >
                    {isSavingPrompt ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    {isSavingPrompt ? "Saving..." : "Save Changes"}
                  </button>
                </div>
                <div className="relative group">
                  <textarea
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    placeholder="Set global instructions for the AI in this workspace... (e.g., 'Always be concise', 'Focus on Rust code', etc.)"
                    rows={8}
                    className="w-full resize-none text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] transition-colors shadow-sm"
                  />
                  <div className="absolute right-3 bottom-3 text-[10px] text-[var(--text-muted)] pointer-events-none opacity-0 group-focus-within:opacity-100 transition-opacity">
                    {editPrompt.length} characters
                  </div>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed italic">
                  Note: These instructions are prepended to the system prompt of every new chat session started within this workspace.
                </p>
              </div>

              {/* Topics Manager */}
              <div className="space-y-4 pt-4">
                <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-2">
                  <Brain size={12} /> Workspace Topics
                </h3>
                <TopicsSection
                  workspaceId={selectedWorkspace.id}
                  topicSignature={topicSignaturesByWorkspace[selectedWorkspace.id] ?? null}
                  onUpdate={(updated) => {
                    setTopicSignaturesByWorkspace(prev => ({
                      ...prev,
                      [selectedWorkspace.id]: updated
                    }));
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] gap-4 animate-in fade-in duration-700">
              <div className="w-16 h-16 rounded-3xl bg-[var(--bg-elevated)] flex items-center justify-center border border-[var(--border-color)]">
                <LayoutGrid size={32} className="opacity-20" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">No workspace selected</p>
                <p className="text-xs mt-1">Select a workspace from the list to view its details.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Help text */}
      <div className="px-5 py-3 border-t border-[var(--border-color)] shrink-0">
        <p className="text-[11px] text-[var(--text-muted)]">
          Root workspaces group child workspaces. Child workspaces keep their own chats, notes, and knowledge data while still appearing under their parent in the main workspace navigation.
        </p>
      </div>

      {dialogState && (
        <ConfirmDialog
          title={dialogState.kind === "delete" ? "Confirm Deletion" : "Cannot Delete Workspace"}
          description={
            dialogState.kind === "delete"
              ? dialogState.workspace.parent_workspace_id
                ? `Delete "${dialogState.workspace.name}" and all its projects, notes, and data? This cannot be undone.`
                : (childWorkspacesByParent[dialogState.workspace.id] ?? []).length > 0
                ? `Delete "${dialogState.workspace.name}"? Its child workspaces will be kept and promoted to root workspaces.`
                : `Delete "${dialogState.workspace.name}" and all its projects, notes, and data? This cannot be undone.`
              : "You need at least one workspace in Aetherium."
          }
          confirmLabel={dialogState.kind === "delete" ? "Delete Workspace" : "OK"}
          cancelLabel={dialogState.kind === "delete" ? "Cancel" : null}
          tone={dialogState.kind === "delete" ? "danger" : "default"}
          busy={dialogBusy}
          onCancel={() => {
            if (!dialogBusy) {
              setDialogState(null);
            }
          }}
          onConfirm={async () => {
            if (dialogBusy) {return;}
            if (dialogState.kind !== "delete") {
              setDialogState(null);
              return;
            }

            setDialogBusy(true);
            try {
              await performDeleteWorkspace(dialogState.workspace);
              setDialogState(null);
            } finally {
              setDialogBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function StatCard({ icon, label, value, loading, onClick }: { icon: React.ReactNode; label: string; value: number; loading: boolean; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl p-4 flex flex-col gap-2 shadow-sm transition-all hover:border-[var(--border-color-hover)]${onClick ? " cursor-pointer" : ""}`}
    >      <div className="flex items-center justify-between">
        <div className="text-[var(--accent-color)] bg-[var(--accent-color)]/10 p-1.5 rounded-lg">
          {icon}
        </div>
        {loading ? (
          <Loader2 size={12} className="text-[var(--text-muted)] animate-spin" />
        ) : (
          <span className="text-lg font-bold text-[var(--text-primary)]">{value}</span>
        )}
      </div>
      <span className="text-[11px] font-medium text-[var(--text-muted)]">{label}</span>
    </div>
  );
}
