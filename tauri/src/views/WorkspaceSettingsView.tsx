/**
 * WorkspaceSettingsView — manage workspaces: rename, reorder, delete, and switch.
 * Mirrors WorkspaceListView.swift + workspace picker behaviour.
 */
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Trash2, Pencil, Check, X, LayoutGrid,
  MessageSquare, FileText, Globe, Brain, CreditCard,
  Database, Sparkles, Save, Loader2, ChevronRight, ChevronDown, ArrowUpDown, BookOpen, FolderPlus
} from "lucide-react";
import { api } from "../lib/api";
import ConfirmDialog from "../components/ConfirmDialog";
import { CompactMenuSelect } from "../components/CompactMenuSelect";
import { TopicsSection } from "../components/TopicsSection";
import WorkspaceMemoryPanel from "./WorkspaceMemoryPanel";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { Tooltip } from "../components/Tooltip";
import { useSettingsStore } from "../stores/settingsStore";
import type { Workspace } from "../stores/workspaceStore";
import type { DashboardSummary, TopicSignature, WorkspaceGlossaryTerm } from "../lib/api";

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
  const [memoryCounts, setMemoryCounts] = useState<{ facts: number; preferences: number }>({ facts: 0, preferences: 0 });
  const [loadingStats, setLoadingStats] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [topicSignaturesByWorkspace, setTopicSignaturesByWorkspace] = useState<Record<string, TopicSignature | null>>({});
  const [glossaryTerms, setGlossaryTerms] = useState<WorkspaceGlossaryTerm[]>([]);
  const [isLoadingGlossary, setIsLoadingGlossary] = useState(false);
  const [isRefreshingGlossary, setIsRefreshingGlossary] = useState(false);
  const [isSavingGlossary, setIsSavingGlossary] = useState(false);
  const [deletingGlossaryId, setDeletingGlossaryId] = useState<string | null>(null);
  const [editingGlossaryId, setEditingGlossaryId] = useState<string | null>(null);
  const [glossaryDraftTerm, setGlossaryDraftTerm] = useState("");
  const [glossaryDraftAliases, setGlossaryDraftAliases] = useState("");
  const [glossaryDraftDefinition, setGlossaryDraftDefinition] = useState("");

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("ws-sections-collapsed") ?? "{}");
    } catch { return {}; }
  });
  const toggleSection = (key: string) => {
    setCollapsedSections(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem("ws-sections-collapsed", JSON.stringify(next));
      return next;
    });
  };

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
  const childCreateParentId = selectedWorkspace?.id ?? null;
  const localGlossaryTerms = useMemo(
    () => glossaryTerms.filter((term) => !term.is_inherited),
    [glossaryTerms],
  );
  const inheritedGlossaryTerms = useMemo(
    () => glossaryTerms.filter((term) => term.is_inherited),
    [glossaryTerms],
  );

  useEffect(() => {
    setMoveToParentId("");
    if (!selectedId) {
      setStats(null);
      setMemoryCounts({ facts: 0, preferences: 0 });
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

  useEffect(() => {
    if (!selectedId) {
      setGlossaryTerms([]);
      return;
    }

    const workspaceId = selectedId;
    let cancelled = false;
    async function loadGlossary() {
      setIsLoadingGlossary(true);
      try {
        const terms = await api.workspaceGlossary.list(workspaceId, true);
        if (!cancelled) {
          setGlossaryTerms(terms);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load workspace glossary:", err);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingGlossary(false);
        }
      }
    }

    loadGlossary();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  function resetGlossaryEditor() {
    setEditingGlossaryId(null);
    setGlossaryDraftTerm("");
    setGlossaryDraftAliases("");
    setGlossaryDraftDefinition("");
  }

  function startGlossaryEditor(term?: WorkspaceGlossaryTerm) {
    setEditingGlossaryId(term && !term.is_inherited ? term.id : "new");
    setGlossaryDraftTerm(term?.term ?? "");
    setGlossaryDraftAliases(term?.aliases.join(", ") ?? "");
    setGlossaryDraftDefinition(term?.definition ?? "");
  }

  async function reloadGlossary(workspaceId: string) {
    const terms = await api.workspaceGlossary.list(workspaceId, true);
    setGlossaryTerms(terms);
  }

  async function saveGlossaryTerm() {
    if (!selectedId || !glossaryDraftTerm.trim() || !glossaryDraftDefinition.trim()) {
      return;
    }

    setIsSavingGlossary(true);
    try {
      await api.workspaceGlossary.upsert({
        id: editingGlossaryId && editingGlossaryId !== "new" ? editingGlossaryId : undefined,
        workspace_id: selectedId,
        term: glossaryDraftTerm.trim(),
        definition: glossaryDraftDefinition.trim(),
        aliases: parseAliasDraft(glossaryDraftAliases),
        source_kind: "manual",
      });
      await reloadGlossary(selectedId);
      resetGlossaryEditor();
    } catch (err) {
      console.error("Failed to save glossary term:", err);
    } finally {
      setIsSavingGlossary(false);
    }
  }

  async function refreshGlossary() {
    if (!selectedId) {
      return;
    }
    setIsRefreshingGlossary(true);
    try {
      await api.workspaceGlossary.refresh(selectedId);
      await reloadGlossary(selectedId);
    } catch (err) {
      console.error("Failed to refresh workspace glossary:", err);
    } finally {
      setIsRefreshingGlossary(false);
    }
  }

  async function deleteGlossaryTerm(id: string) {
    setDeletingGlossaryId(id);
    try {
      await api.workspaceGlossary.delete(id);
      if (selectedId) {
        await reloadGlossary(selectedId);
      }
      if (editingGlossaryId === id) {
        resetGlossaryEditor();
      }
    } catch (err) {
      console.error("Failed to delete glossary term:", err);
    } finally {
      setDeletingGlossaryId(null);
    }
  }

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

      {showNew && (
        <CreateWorkspaceDialog
          parentName={createParentId ? (workspaces.find((w) => w.id === createParentId)?.name ?? "Parent") : null}
          creating={creating}
          onConfirm={createWorkspace}
          onCancel={resetNewWorkspaceForm}
          name={newName}
          onNameChange={setNewName}
          description={newDescription}
          onDescriptionChange={setNewDescription}
        />
      )}

      {/* Main Content Areas */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Workspace list */}
        <div className="w-[260px] border-r border-[var(--border-color)] flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
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
                  <div key={ws.id}>
                    <div
                      onClick={() => setSelectedId(ws.id)}
                      className={`relative flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer group transition-colors ${
                        isSelected
                          ? "bg-[var(--accent-color)]/10 text-[var(--accent-color)]"
                          : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {children.length > 0 ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedParents((current) => ({ ...current, [ws.id]: !isExpanded })); }}
                          className="shrink-0 -ml-1 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} child workspaces for ${ws.name}`}
                        >
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </button>
                      ) : (
                        <span className="w-3 shrink-0" />
                      )}

                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                            <input
                              autoFocus
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {renameWorkspace(ws.id);}
                                if (e.key === "Escape") {setEditingId(null);}
                              }}
                              placeholder="Workspace name…"
                              className="flex-1 text-sm bg-[var(--bg-input)] border border-[var(--accent-color)] rounded px-2 py-0.5 text-[var(--text-primary)] outline-none"
                            />
                            <button onClick={() => renameWorkspace(ws.id)} className="text-[var(--accent-color)]">
                              <Check size={14} />
                            </button>
                            <button onClick={() => setEditingId(null)} className="text-[var(--text-muted)]">
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 min-w-0">
                            {isActive && (
                              <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--accent-color)]" />
                            )}
                            <span className="text-sm truncate">
                              {ws.name}
                            </span>
                            {children.length > 0 && (
                              <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                                {children.length}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div
                        className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--bg-secondary)] rounded px-0.5"
                        onClick={e => e.stopPropagation()}
                      >
                        {!isActive && (
                          <button
                            onClick={() => activateWorkspace(ws.id)}
                            className="px-1.5 py-0.5 text-[10px] rounded text-[var(--text-secondary)] hover:text-[var(--accent-color)] transition-colors"
                          >
                            Switch
                          </button>
                        )}
                        <Tooltip content="New child workspace">
                          <button
                            onClick={() => openCreateForm(ws.id)}
                            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded"
                          >
                            <Plus size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip content="Rename">
                          <button
                            title="Rename"
                            onClick={() => { setEditingId(ws.id); setEditName(ws.name); setEditDescription(ws.description ?? ""); }}
                            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded"
                          >
                            <Pencil size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip content="Delete workspace">
                          <button
                            onClick={() => deleteWorkspace(ws)}
                            className="p-1 text-[var(--text-muted)] hover:text-red-400 rounded"
                          >
                            <Trash2 size={12} />
                          </button>
                        </Tooltip>
                      </div>
                    </div>

                    {children.length > 0 && isExpanded && (
                      <div className="ml-3 border-l border-[var(--border-color)] pl-1 mt-0.5">
                        {children.map((child) => {
                          const isChildActive = child.id === activeWorkspaceId;
                          const isChildSelected = child.id === selectedId;
                          const isChildEditing = editingId === child.id;

                          return (
                            <div
                              key={child.id}
                              onClick={() => setSelectedId(child.id)}
                              className={`relative flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer group transition-colors ${
                                isChildSelected
                                  ? "bg-[var(--accent-color)]/10 text-[var(--accent-color)]"
                                  : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                              }`}
                            >
                              <div className="flex-1 min-w-0">
                                {isChildEditing ? (
                                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                    <input
                                      autoFocus
                                      value={editName}
                                      onChange={(e) => setEditName(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {renameWorkspace(child.id);}
                                        if (e.key === "Escape") {setEditingId(null);}
                                      }}
                                      placeholder="Workspace name…"
                                      className="flex-1 text-sm bg-[var(--bg-input)] border border-[var(--accent-color)] rounded px-2 py-0.5 text-[var(--text-primary)] outline-none"
                                    />
                                    <button onClick={() => renameWorkspace(child.id)} className="text-[var(--accent-color)]">
                                      <Check size={14} />
                                    </button>
                                    <button onClick={() => setEditingId(null)} className="text-[var(--text-muted)]">
                                      <X size={14} />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 min-w-0">
                                    {isChildActive && (
                                      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--accent-color)]" />
                                    )}
                                    <span className="text-sm truncate">
                                      {child.name}
                                    </span>
                                  </div>
                                )}
                              </div>

                              <div
                                className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--bg-secondary)] rounded px-0.5"
                                onClick={e => e.stopPropagation()}
                              >
                                {!isChildActive && (
                                  <button
                                    onClick={() => activateWorkspace(child.id)}
                                    className="px-1.5 py-0.5 text-[10px] rounded text-[var(--text-secondary)] hover:text-[var(--accent-color)] transition-colors"
                                  >
                                    Switch
                                  </button>
                                )}
                                <Tooltip content="Rename">
                                  <button
                                    title="Rename"
                                    onClick={() => { setEditingId(child.id); setEditName(child.name); setEditDescription(child.description ?? ""); }}
                                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded"
                                  >
                                    <Pencil size={12} />
                                  </button>
                                </Tooltip>
                                <Tooltip content="Delete workspace">
                                  <button
                                    onClick={() => deleteWorkspace(child)}
                                    className="p-1 text-[var(--text-muted)] hover:text-red-400 rounded"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </Tooltip>
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
            <div className="app-container py-6 divide-y divide-[var(--border-color)]">
              {/* Header Details */}
              <div className="space-y-2 pb-5">
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
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
                  {selectedWorkspaceType && (
                    <span>{selectedWorkspaceType}</span>
                  )}
                  {selectedWorkspace.parent_workspace_id && selectedParentWorkspace && (
                    <span>Parent: {selectedParentWorkspace.name}</span>
                  )}
                  {!selectedWorkspace.parent_workspace_id && (
                    <span>{(childWorkspacesByParent[selectedWorkspace.id] ?? []).length} child workspace{(childWorkspacesByParent[selectedWorkspace.id] ?? []).length !== 1 ? "s" : ""}</span>
                  )}
                  <span>Created {formatDate(selectedWorkspace.created_at)}</span>
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
              <div className="space-y-3 py-5">
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
                  rows={2}
                  className="w-full resize-none text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] transition-colors shadow-sm"
                />
              </div>

              {/* Statistics Row */}
              <div className="flex flex-wrap gap-2 py-5">
                {[
                  { icon: <MessageSquare size={12} />, label: "Chats", value: stats?.overview.chat_sessions ?? 0, onClick: () => navigate("/chat") },
                  { icon: <FileText size={12} />, label: "Notes", value: stats?.overview.notes ?? 0, onClick: () => navigate("/notes") },
                  { icon: <Globe size={12} />, label: "Sources", value: stats?.overview.sources ?? 0, onClick: () => navigate("/sources") },
                  { icon: <Brain size={12} />, label: "Nodes", value: stats?.overview.concepts ?? 0, onClick: () => navigate("/graph") },
                  { icon: <CreditCard size={12} />, label: "Flashcards", value: stats?.overview.flashcards ?? 0, onClick: () => navigate("/flashcards") },
                  { icon: <Database size={12} />, label: "Facts", value: memoryCounts.facts },
                  { icon: <Database size={12} />, label: "Preferences", value: memoryCounts.preferences },
                ].map(({ icon, label, value, onClick }) => (
                  <button
                    key={label}
                    onClick={onClick}
                    disabled={!onClick}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-xs text-[var(--text-secondary)] hover:border-[var(--border-color-hover)] transition-all disabled:cursor-default"
                  >
                    <span className="text-[var(--accent-color)]">{icon}</span>
                    {loadingStats ? <Loader2 size={10} className="animate-spin" /> : <span className="font-semibold text-[var(--text-primary)]">{value}</span>}
                    <span className="text-[var(--text-muted)]">{label}</span>
                  </button>
                ))}
              </div>

              {/* Workspace Memory Panel */}
              <div className="space-y-3 py-5">
                <button
                  onClick={() => toggleSection("memory")}
                  className="flex w-full items-center justify-between"
                >
                  <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-2">
                    <Database size={12} /> Workspace Memory
                  </h3>
                  <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${collapsedSections["memory"] ? "-rotate-90" : ""}`} />
                </button>
                {!collapsedSections["memory"] && (
                  /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
                  <WorkspaceMemoryPanel workspaceId={selectedId!} onCountsChange={setMemoryCounts} />
                )}
              </div>

              {/* Conversation Prompt Editor */}
              <div className="space-y-3 py-5">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => toggleSection("prompt")}
                    className="flex items-center gap-2 min-w-0"
                  >
                    <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-2">
                      <Sparkles size={12} /> Conversation Prompt
                    </h3>
                    <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform flex-shrink-0 ${collapsedSections["prompt"] ? "-rotate-90" : ""}`} />
                  </button>
                  <button
                    onClick={savePrompt}
                    disabled={isSavingPrompt || editPrompt.trim() === selectedWorkspace.prompt_instructions}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40 transition-all font-medium"
                  >
                    {isSavingPrompt ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    {isSavingPrompt ? "Saving..." : "Save Changes"}
                  </button>
                </div>
                {!collapsedSections["prompt"] && (
                  <>
                    <div className="relative group">
                      <textarea
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        placeholder="Set global instructions for the AI in this workspace... (e.g., 'Always be concise', 'Focus on Rust code', etc.)"
                        rows={4}
                        className="w-full resize-none text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] transition-colors shadow-sm"
                      />
                      <div className="absolute right-3 bottom-3 text-[10px] text-[var(--text-muted)] pointer-events-none opacity-0 group-focus-within:opacity-100 transition-opacity">
                        {editPrompt.length} characters
                      </div>
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed italic">
                      Note: These instructions are prepended to the system prompt of every new chat session started within this workspace.
                    </p>
                  </>
                )}
              </div>

              {/* Topics Manager */}
              <div className="space-y-3 py-5">
                <button
                  onClick={() => toggleSection("topics")}
                  className="flex w-full items-center justify-between"
                >
                  <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-2">
                    <Brain size={12} /> Workspace Topics
                  </h3>
                  <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${collapsedSections["topics"] ? "-rotate-90" : ""}`} />
                </button>
                {!collapsedSections["topics"] && (
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
                )}
              </div>

              <div className="space-y-3 py-5">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => toggleSection("glossary")}
                    className="flex items-center gap-2 min-w-0"
                  >
                    <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-2">
                      <BookOpen size={12} /> Workspace Glossary
                    </h3>
                    <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform flex-shrink-0 ${collapsedSections["glossary"] ? "-rotate-90" : ""}`} />
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startGlossaryEditor()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--accent-color)]"
                    >
                      <Plus size={12} />
                      Add Term
                    </button>
                    <button
                      onClick={refreshGlossary}
                      disabled={isRefreshingGlossary}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {isRefreshingGlossary ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      Refresh Glossary
                    </button>
                  </div>
                </div>
                {!collapsedSections["glossary"] && (<>
                <p className="text-xs text-[var(--text-muted)]">
                  Definitions here are checked before the built-in tech dictionary. Child workspaces can override inherited parent terms.
                </p>

                {editingGlossaryId && (
                  <div className="space-y-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        value={glossaryDraftTerm}
                        onChange={(e) => setGlossaryDraftTerm(e.target.value)}
                        placeholder="Term"
                        className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                      />
                      <input
                        value={glossaryDraftAliases}
                        onChange={(e) => setGlossaryDraftAliases(e.target.value)}
                        placeholder="Aliases, comma separated"
                        className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                      />
                    </div>
                    <textarea
                      value={glossaryDraftDefinition}
                      onChange={(e) => setGlossaryDraftDefinition(e.target.value)}
                      placeholder="Definition"
                      rows={4}
                      className="w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={resetGlossaryEditor}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveGlossaryTerm}
                        disabled={isSavingGlossary || !glossaryDraftTerm.trim() || !glossaryDraftDefinition.trim()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        {isSavingGlossary ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        Save Term
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <GlossaryListSection
                    title="Local Terms"
                    terms={localGlossaryTerms}
                    loading={isLoadingGlossary}
                    emptyMessage="No local glossary terms yet."
                    onEdit={startGlossaryEditor}
                    onDelete={deleteGlossaryTerm}
                    deletingId={deletingGlossaryId}
                  />
                  <GlossaryListSection
                    title="Inherited Terms"
                    terms={inheritedGlossaryTerms}
                    loading={isLoadingGlossary}
                    emptyMessage="No inherited glossary terms."
                    overrideLabel="Override"
                    onOverride={(term) => startGlossaryEditor(term)}
                  />
                </div>
                </>)}
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

function CreateWorkspaceDialog({
  parentName,
  creating,
  onConfirm,
  onCancel,
  name,
  onNameChange,
  description,
  onDescriptionChange,
}: {
  parentName: string | null;
  creating: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape" && !creating) { onCancel(); }
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [creating, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => { if (!creating) { onCancel(); } }}
    >
      <div
        className="mx-4 flex w-full max-w-md flex-col gap-5 rounded-3xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-color)]/12 text-[var(--accent-color)]">
            <FolderPlus size={18} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              {parentName ? `New Child Workspace` : "New Root Workspace"}
            </h3>
            {parentName && (
              <p className="text-sm text-[var(--text-muted)] mt-0.5">Under <span className="font-medium text-[var(--text-secondary)]">{parentName}</span></p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) { onConfirm(); }
            }}
            placeholder={parentName ? "Child workspace name…" : "Workspace name…"}
            className="w-full text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] transition-colors"
          />
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Optional description…"
            rows={2}
            className="w-full resize-none text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] transition-colors"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={creating}
            className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={creating || !name.trim()}
            className="rounded-xl bg-[var(--accent-color)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {creating ? <Loader2 size={13} className="animate-spin" /> : null}
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GlossaryListSection({
  title,
  terms,
  loading,
  emptyMessage,
  deletingId,
  overrideLabel,
  onEdit,
  onDelete,
  onOverride,
}: {
  title: string;
  terms: WorkspaceGlossaryTerm[];
  loading: boolean;
  emptyMessage: string;
  deletingId?: string | null;
  overrideLabel?: string;
  onEdit?: (term: WorkspaceGlossaryTerm) => void;
  onDelete?: (id: string) => void;
  onOverride?: (term: WorkspaceGlossaryTerm) => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h4>
        <span className="text-xs text-[var(--text-muted)]">{terms.length}</span>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 size={14} className="animate-spin" />
          Loading glossary terms…
        </div>
      ) : terms.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">{emptyMessage}</p>
      ) : (
        <div className="space-y-2">
          {terms.map((term) => (
            <div key={term.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{term.term}</span>
                    <span className="rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                      {term.source_kind === "glossary_seed" ? "AI Glossary" : term.source_kind === "ai_scan" ? "AI Scan" : "Manual"}
                    </span>
                    {term.is_inherited && term.inherited_from_workspace_name && (
                      <span className="rounded-full bg-[var(--accent-color)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent-color)]">
                        From {term.inherited_from_workspace_name}
                      </span>
                    )}
                  </div>
                  {term.aliases.length > 0 && (
                    <p className="mb-1.5 text-[11px] text-[var(--text-muted)]">
                      Aliases: {term.aliases.join(", ")}
                    </p>
                  )}
                  <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{term.definition}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!term.is_inherited && onEdit && (
                    <button
                      onClick={() => onEdit(term)}
                      className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {!term.is_inherited && onDelete && (
                    <button
                      onClick={() => onDelete(term.id)}
                      disabled={deletingId === term.id}
                      className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                    >
                      {deletingId === term.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  )}
                  {term.is_inherited && onOverride && (
                    <button
                      onClick={() => onOverride(term)}
                      className="rounded-lg border border-[var(--border-color)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--accent-color)]"
                    >
                      {overrideLabel ?? "Override"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function parseAliasDraft(value: string): string[] {
  return value
    .split(",")
    .map((alias) => alias.trim())
    .filter(Boolean);
}
