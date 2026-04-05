/**
 * WorkspaceSettingsView — manage workspaces: rename, reorder, delete, and switch.
 * Mirrors WorkspaceListView.swift + workspace picker behaviour.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Pencil, Check, X, LayoutGrid } from "lucide-react";
import { api } from "../lib/api";
import ConfirmDialog from "../components/ConfirmDialog";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { Workspace } from "../stores/workspaceStore";

type WorkspaceDialogState =
  | { kind: "last-workspace" }
  | { kind: "delete"; workspace: Workspace };

export default function WorkspaceSettingsView() {
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, addWorkspace, setWorkspaces } = useWorkspaceStore();
  const switchWorkspaceToChat = useSettingsStore((state) => state.switchWorkspaceToChat);
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [dialogState, setDialogState] = useState<WorkspaceDialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);

  function activateWorkspace(workspaceId: string) {
    const isChanged = workspaceId !== activeWorkspaceId;
    setActiveWorkspaceId(workspaceId);
    if (isChanged && switchWorkspaceToChat) {
      navigate("/chat");
    }
  }

  async function createWorkspace() {
    if (!newName.trim()) {return;}
    setCreating(true);
    try {
      const ws = await api.workspace.create(newName.trim());
      addWorkspace(ws);
      activateWorkspace(ws.id);
      setNewName("");
      setShowNew(false);
    } finally {
      setCreating(false);
    }
  }

  async function renameWorkspace(id: string) {
    if (!editName.trim()) { setEditingId(null); return; }
    await api.workspace.update(id, editName.trim());
    setWorkspaces(workspaces.map((w) => w.id === id ? { ...w, name: editName.trim() } : w));
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
        <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-elevated)] shrink-0">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {createWorkspace();}
              if (e.key === "Escape") { setShowNew(false); setNewName(""); }
            }}
            placeholder="Workspace name…"
            className="flex-1 text-sm bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg px-3 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
          />
          <button
            onClick={createWorkspace}
            disabled={creating || !newName.trim()}
            className="px-3 py-1.5 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40"
          >
            {creating ? "Creating…" : "Create"}
          </button>
          <button
            onClick={() => { setShowNew(false); setNewName(""); }}
            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Workspace list */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {workspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] gap-2">
            <LayoutGrid size={32} className="opacity-30" />
            <p className="text-sm">No workspaces yet.</p>
          </div>
        ) : (
          workspaces.map((ws) => {
            const isActive = ws.id === activeWorkspaceId;
            const isEditing = editingId === ws.id;
            return (
              <div
                key={ws.id}
                className={`rounded-xl border p-4 transition-colors ${
                  isActive
                    ? "border-[var(--accent-color)] bg-[var(--accent-color)]/10"
                    : "border-[var(--border-color)] bg-[var(--bg-elevated)] hover:border-[var(--border-color)]"
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Active indicator */}
                  <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${isActive ? "bg-[var(--accent-color)]" : "bg-[var(--bg-hover)]"}`} />

                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {renameWorkspace(ws.id);}
                            if (e.key === "Escape") {setEditingId(null);}
                          }}
                          className="flex-1 text-sm font-medium bg-[var(--bg-input)] border border-[var(--accent-color)] rounded px-2 py-0.5 text-[var(--text-primary)] outline-none"
                        />
                        <button onClick={() => renameWorkspace(ws.id)} className="text-[var(--accent-color)]">
                          <Check size={14} />
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-[var(--text-muted)]">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">{ws.name}</span>
                        {isActive && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-color)]/20 text-[var(--accent-color)] font-medium">
                            Active
                          </span>
                        )}
                      </div>
                    )}
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">
                      Created {formatDate(ws.created_at)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {!isActive && (
                      <button
                        onClick={() => activateWorkspace(ws.id)}
                        className="px-2 py-1 text-[11px] rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors"
                      >
                        Switch
                      </button>
                    )}
                    <button
                      onClick={() => { setEditingId(ws.id); setEditName(ws.name); }}
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
