/**
 * BackupSettingsSection — create, list, restore and delete backups.
 * Mirrors BackupSettingsSection.swift + BackupTimelineView.swift.
 */
import { useEffect, useState } from "react";
import { Download, Upload, Trash2, Archive, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface BackupMeta {
  id: string;
  workspace_name: string;
  created_at: string;
  workspace_id: string;
}

export default function BackupSettingsSection() {
  const { activeWorkspaceId, workspaces } = useWorkspaceStore();
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.backup.list().then((b) => setBackups(b as BackupMeta[])).catch(() => {});
  }, []);

  async function createBackup() {
    if (!activeWorkspaceId) return;
    setCreating(true);
    setError(null);
    try {
      const json = await api.backup.create(activeWorkspaceId);
      await api.backup.list().then((b) => setBackups(b as BackupMeta[]));
    } catch (e: any) {
      setError(e?.message ?? "Backup failed");
    } finally {
      setCreating(false);
    }
  }

  async function restoreBackup(id: string) {
    if (!confirm("Restore this backup? This will overwrite existing data for this workspace.")) return;
    setRestoring(id);
    setError(null);
    try {
      // In a real flow we'd load the JSON then call api.backup.restore(json)
      // For now, trigger a reload
      await api.backup.list().then((b) => setBackups(b as BackupMeta[]));
    } catch (e: any) {
      setError(e?.message ?? "Restore failed");
    } finally {
      setRestoring(null);
    }
  }

  async function deleteBackup(id: string) {
    if (!confirm("Delete this backup?")) return;
    await api.backup.delete(id);
    setBackups((prev) => prev.filter((b) => b.id !== id));
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString();
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">Backups</h1>
        <button
          onClick={createBackup}
          disabled={creating || !activeWorkspaceId}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40"
        >
          {creating ? <RefreshCw size={12} className="animate-spin" /> : <Archive size={12} />}
          {creating ? "Creating…" : "Create Backup"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            {error}
          </div>
        )}

        {!activeWorkspaceId && (
          <p className="text-[var(--text-muted)] text-sm">Select a workspace to manage backups.</p>
        )}

        {backups.length === 0 && activeWorkspaceId && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Archive size={32} className="text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">No backups yet.</p>
            <p className="text-xs text-[var(--text-muted)]">Create one to protect your data.</p>
          </div>
        )}

        <div className="space-y-2">
          {backups.map((b) => (
            <div
              key={b.id}
              className="group flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-color)]"
            >
              <Archive size={16} className="text-[var(--text-muted)] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--text-primary)]">{b.workspace_name}</p>
                <p className="text-xs text-[var(--text-muted)]">{formatDate(b.created_at)}</p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                <button
                  onClick={() => restoreBackup(b.id)}
                  disabled={restoring === b.id}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--accent-color)]"
                  title="Restore"
                >
                  {restoring === b.id
                    ? <RefreshCw size={13} className="animate-spin" />
                    : <Upload size={13} />
                  }
                </button>
                <button
                  onClick={() => deleteBackup(b.id)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-red-400"
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
