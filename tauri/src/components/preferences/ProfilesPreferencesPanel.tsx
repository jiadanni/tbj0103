import React, { useEffect, useState } from "react";
import {
  Database,
  Plus,
  RefreshCw,
  Trash2,
  Edit2,
  Check,
  AlertTriangle,
  Loader2,
  ArrowRightLeft,
  Calendar,
} from "lucide-react";
import { useProfileStore } from "../../stores/profileStore";
import type { AppProfile } from "../../lib/api";

export function ProfilesPreferencesPanel() {
  const {
    profiles,
    activeProfileId,
    activeProfile,
    loading,
    error,
    loadProfiles,
    createProfile,
    switchProfile,
    renameProfile,
    deleteProfile,
  } = useProfileStore();

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [switchImmediate, setSwitchImmediate] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const [switchTarget, setSwitchTarget] = useState<AppProfile | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  const [renameTarget, setRenameTarget] = useState<AppProfile | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AppProfile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      return;
    }
    setIsCreating(true);
    setLocalError(null);
    try {
      await createProfile(newName.trim(), newDescription.trim() || undefined, switchImmediate);
      setCreateModalOpen(false);
      setNewName("");
      setNewDescription("");
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmSwitch = async () => {
    if (!switchTarget) {
      return;
    }
    setIsSwitching(true);
    setLocalError(null);
    try {
      await switchProfile(switchTarget.id);
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : String(err));
      setIsSwitching(false);
    }
  };

  const handleOpenRename = (profile: AppProfile) => {
    setRenameTarget(profile);
    setRenameName(profile.name);
    setRenameDescription(profile.description);
  };

  const handleConfirmRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !renameName.trim()) {
      return;
    }
    setIsRenaming(true);
    setLocalError(null);
    try {
      await renameProfile(renameTarget.id, renameName.trim(), renameDescription.trim() || undefined);
      setRenameTarget(null);
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRenaming(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setIsDeleting(true);
    setLocalError(null);
    try {
      await deleteProfile(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="space-y-6 p-5">
        {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Profiles & Vaults
          </h2>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Isolated SQLite database vaults. Use separate profiles to store large historical
            imports (like Claude archives) without cluttering your daily workspaces or search results.
          </p>
        </div>
        <button
          onClick={() => {
            setNewName("");
            setNewDescription("");
            setSwitchImmediate(true);
            setCreateModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          <Plus size={14} />
          New Vault / Profile
        </button>
      </div>

      {(error || localError) && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
          <AlertTriangle size={16} className="shrink-0" />
          <span>{error || localError}</span>
        </div>
      )}

      {/* Active Vault Hero Card */}
      {activeProfile && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-color)]/10 text-[var(--accent-color)]">
                <Database size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-[var(--text-primary)]">
                    {activeProfile.name}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Active Vault
                  </span>
                  {activeProfile.is_default && (
                    <span className="rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {activeProfile.description || "Primary active database environment"}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
                <Calendar size={12} />
                Created {new Date(activeProfile.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Profiles List */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          All Vaults ({profiles.length})
        </h3>

        {loading && profiles.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-xs text-[var(--text-muted)]">
            <Loader2 size={16} className="animate-spin mr-2" />
            Loading vaults...
          </div>
        ) : (
          <div className="grid gap-3">
            {profiles.map((p) => {
              const isActive = p.id === activeProfileId;
              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between rounded-xl border p-3.5 transition-colors ${
                    isActive
                      ? "border-[var(--accent-color)]/40 bg-[var(--accent-color)]/5"
                      : "border-[var(--border-color)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                        isActive
                          ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                          : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                      }`}
                    >
                      <Database size={18} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)]">
                          {p.name}
                        </span>
                        {isActive ? (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                            Current
                          </span>
                        ) : null}
                        {p.is_default && (
                          <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                            Default
                          </span>
                        )}
                        <span className="text-[10px] text-[var(--text-muted)] font-mono">
                          ({p.id})
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                        {p.description || "No description provided"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenRename(p)}
                      title="Rename Vault"
                      className="rounded-lg border border-[var(--border-color)] p-1.5 text-[var(--text-muted)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      <Edit2 size={13} />
                    </button>

                    {!isActive && !p.is_default && (
                      <button
                        onClick={() => setDeleteTarget(p)}
                        title="Delete Vault"
                        className="rounded-lg border border-[var(--border-color)] p-1.5 text-[var(--text-muted)] hover:border-red-500/40 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}

                    {!isActive ? (
                      <button
                        onClick={() => setSwitchTarget(p)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors"
                      >
                        <ArrowRightLeft size={12} />
                        Switch to Vault
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-400">
                        <Check size={14} />
                        Active
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Create New Vault / Profile
            </h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              A new vault creates an isolated SQLite database and chat storage.
            </p>

            <form onSubmit={handleCreate} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Vault Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Claude Archive, Work Projects"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent-color)] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Description (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Historical Claude export from 2023-2026"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent-color)] focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="switchImmediate"
                  checked={switchImmediate}
                  onChange={(e) => setSwitchImmediate(e.target.checked)}
                  className="rounded border-[var(--border-color)] text-[var(--accent-color)] focus:ring-0"
                />
                <label
                  htmlFor="switchImmediate"
                  className="text-xs text-[var(--text-primary)] cursor-pointer select-none"
                >
                  Switch to this vault and restart immediately
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-color)]">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  disabled={isCreating}
                  className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !newName.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {isCreating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  {switchImmediate ? "Create & Restart" : "Create Vault"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Switch Confirmation Modal */}
      {switchTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-color)]/10 text-[var(--accent-color)]">
                <RefreshCw size={20} className={isSwitching ? "animate-spin" : ""} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Switch Vault
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Switch to &quot;{switchTarget.name}&quot;
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs text-[var(--text-secondary)] leading-relaxed">
              Switching vaults requires restarting Aetherium to load the selected database.
              Any unsaved changes or active generations will be interrupted.
            </p>

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setSwitchTarget(null)}
                disabled={isSwitching}
                className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSwitch}
                disabled={isSwitching}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {isSwitching ? <Loader2 size={13} className="animate-spin" /> : <ArrowRightLeft size={13} />}
                Switch & Restart
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Rename Vault
            </h3>

            <form onSubmit={handleConfirmRename} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Vault Name
                </label>
                <input
                  type="text"
                  required
                  value={renameName}
                  onChange={(e) => setRenameName(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={renameDescription}
                  onChange={(e) => setRenameDescription(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-color)]">
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  disabled={isRenaming}
                  className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRenaming || !renameName.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {isRenaming ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-red-500/20 bg-[var(--bg-elevated)] p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
                <Trash2 size={20} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Delete Vault
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {deleteTarget.name}
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs text-[var(--text-secondary)] leading-relaxed">
              Are you sure you want to permanently delete the vault <strong>&quot;{deleteTarget.name}&quot;</strong>?
              This will erase its database file, chats, notes, and settings. This action cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-40 transition-colors"
              >
                {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Permanently Delete
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
