/**
 * WorkspaceSettingsView — manage workspaces: rename, reorder, delete, and switch.
 * Mirrors WorkspaceListView.swift + workspace picker behaviour.
 */
import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Trash2, Pencil, Check, X, LayoutGrid,
  MessageSquare, FileText, Globe, Brain, CreditCard,
  Database, Sparkles, Save, Loader2
} from "lucide-react";
import { api } from "../lib/api";
import ConfirmDialog from "../components/ConfirmDialog";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { Workspace } from "../stores/workspaceStore";
import type { DashboardSummary } from "../lib/api";

type WorkspaceDialogState =
  | { kind: "last-workspace" }
  | { kind: "delete"; workspace: Workspace };

export default function WorkspaceSettingsView() {
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, addWorkspace, setWorkspaces } = useWorkspaceStore();
  const switchWorkspaceToChat = useSettingsStore((state) => state.switchWorkspaceToChat);
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [dialogState, setDialogState] = useState<WorkspaceDialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);

  // Stats & Details State
  const [selectedId, setSelectedId] = useState<string | null>(activeWorkspaceId);
  const [stats, setStats] = useState<DashboardSummary | null>(null);
  const [memoryCount, setMemoryCount] = useState<number>(0);
  const [loadingStats, setLoadingStats] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  const selectedWorkspace = useMemo(() =>
    workspaces.find(w => w.id === selectedId),
  [workspaces, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setStats(null);
      setMemoryCount(0);
      setEditPrompt("");
      return;
    }

    const ws = workspaces.find(w => w.id === selectedId);
    if (ws) {
      setEditPrompt(ws.prompt_instructions || "");
    }

    async function loadStats() {
      if (!selectedId) {return;}
      setLoadingStats(true);
      try {
        const [summary, memories] = await Promise.all([
          api.dashboard.getSummary(selectedId),
          api.memory.list(selectedId)
        ]);
        setStats(summary);
        setMemoryCount(memories.length);
      } catch (err) {
        console.error("Failed to load workspace stats:", err);
      } finally {
        setLoadingStats(false);
      }
    }

    loadStats();
  }, [selectedId, workspaces]);

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

  function activateWorkspace(workspaceId: string) {
    const isChanged = workspaceId !== activeWorkspaceId;
    setActiveWorkspaceId(workspaceId);
    if (isChanged && switchWorkspaceToChat) {
      navigate("/chat");
    }
  }

  function resetNewWorkspaceForm() {
    setNewName("");
    setNewDescription("");
    setShowNew(false);
  }

  async function createWorkspace() {
    if (!newName.trim()) {return;}
    setCreating(true);
    try {
      const trimmedDescription = newDescription.trim();
      const ws = await api.workspace.create(newName.trim(), trimmedDescription || undefined);
      addWorkspace(ws);
      activateWorkspace(ws.id);
      resetNewWorkspaceForm();
    } finally {
      setCreating(false);
    }
  }

  async function renameWorkspace(id: string) {
    if (!editName.trim()) { setEditingId(null); return; }
    const trimmedDesc = editDescription.trim();
    await api.workspace.update(id, editName.trim(), trimmedDesc || undefined);
    setWorkspaces(workspaces.map((w) =>
      w.id === id ? { ...w, name: editName.trim(), description: trimmedDesc } : w
    ));
    setEditingId(null);
  }

  async function performDeleteWorkspace(ws: Workspace) {
    await api.workspace.delete(ws.id);
    const remaining = workspaces.filter((w) => w.id !== ws.id);
    setWorkspaces(remaining);
    if (activeWorkspaceId === ws.id) {
      const nextWorkspaceId = remaining[0]?.id ?? null;
      if (nextWorkspaceId) {
        activateWorkspace(nextWorkspaceId);
      } else {
        setActiveWorkspaceId(null);
      }
    }
  }

  function deleteWorkspace(ws: Workspace) {
    if (workspaces.length === 1) {
      setDialogState({ kind: "last-workspace" });
      return;
    }
    setDialogState({ kind: "delete", workspace: ws });
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
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90"
        >
          <Plus size={12} /> New Workspace
        </button>
      </div>

      {/* New workspace form */}
      {showNew && (
        <div className="flex flex-col gap-2 px-5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-elevated)] shrink-0">
          <div className="max-w-3xl w-full flex flex-col gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {createWorkspace();}
              if (e.key === "Escape") { resetNewWorkspaceForm(); }
            }}
            placeholder="Workspace name…"
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
              workspaces.map((ws) => {
                const isActive = ws.id === activeWorkspaceId;
                const isSelected = ws.id === selectedId;
                const isEditing = editingId === ws.id;
                return (
                  <div
                    key={ws.id}
                    onClick={() => setSelectedId(ws.id)}
                    className={`rounded-xl border p-4 transition-all cursor-pointer group ${
                      isSelected
                        ? "border-[var(--accent-color)] bg-[var(--accent-color)]/5 ring-1 ring-[var(--accent-color)]/20"
                        : "border-[var(--border-color)] bg-[var(--bg-elevated)] hover:border-[var(--border-color-hover)]"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Active indicator */}
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
                            <textarea
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {setEditingId(null);}
                              }}
                              placeholder="Optional description…"
                              rows={2}
                              className="resize-none text-xs bg-[var(--bg-input)] border border-[var(--border-color)] rounded px-2 py-1 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                            />
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-[var(--text-primary)] truncate">{ws.name}</span>
                              {isActive && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-color)]/20 text-[var(--accent-color)] font-medium">
                                  Active
                                </span>
                              )}
                            </div>
                            {ws.description && (
                              <p className="text-[11px] text-[var(--text-muted)] line-clamp-1">{ws.description}</p>
                            )}
                          </div>
                        )}
                        <p className="text-[10px] text-[var(--text-muted)]/60 mt-1">
                          Created {formatDate(ws.created_at)}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                        {!isActive && (
                          <button
                            onClick={() => activateWorkspace(ws.id)}
                            className="px-2 py-1 text-[11px] rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors"
                          >
                            Switch
                          </button>
                        )}
                        <button
                          onClick={() => { setEditingId(ws.id); setEditName(ws.name); setEditDescription(ws.description ?? ""); }}
                          className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-hover)]"
                          title="Rename"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => deleteWorkspace(ws)}
                          className="p-1.5 text-[var(--text-muted)] hover:text-red-400 rounded-lg hover:bg-red-400/10"
                          title="Delete workspace"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
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
                </div>
                {selectedWorkspace.description && (
                  <p className="text-[var(--text-secondary)] text-sm max-w-2xl">{selectedWorkspace.description}</p>
                )}
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
                  />
                  <StatCard
                    icon={<FileText size={16} />}
                    label="Notes & Daily"
                    value={stats?.overview.notes ?? 0}
                    loading={loadingStats}
                  />
                  <StatCard
                    icon={<Globe size={16} />}
                    label="Sources & Docs"
                    value={stats?.overview.sources ?? 0}
                    loading={loadingStats}
                  />
                  <StatCard
                    icon={<Brain size={16} />}
                    label="Concept Nodes"
                    value={stats?.overview.concepts ?? 0}
                    loading={loadingStats}
                  />
                  <StatCard
                    icon={<CreditCard size={16} />}
                    label="Flashcards"
                    value={stats?.overview.flashcards ?? 0}
                    loading={loadingStats}
                  />
                  <StatCard
                    icon={<Database size={16} />}
                    label="AI Memories"
                    value={memoryCount}
                    loading={loadingStats}
                  />
                </div>
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
          Workspaces isolate projects, notes, daily entries, and knowledge graphs. You can switch between them using the tab bar at the top.
        </p>
      </div>

      {dialogState && (
        <ConfirmDialog
          title={dialogState.kind === "delete" ? "Confirm Deletion" : "Cannot Delete Workspace"}
          description={
            dialogState.kind === "delete"
              ? `Delete "${dialogState.workspace.name}" and all its projects, notes, and data? This cannot be undone.`
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

function StatCard({ icon, label, value, loading }: { icon: React.ReactNode; label: string; value: number; loading: boolean }) {
  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl p-4 flex flex-col gap-2 shadow-sm transition-all hover:border-[var(--border-color-hover)]">
      <div className="flex items-center justify-between">
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
