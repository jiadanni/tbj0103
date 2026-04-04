/**
 * BackupSettingsSection — create, list, restore and delete backups.
 * Mirrors BackupSettingsSection.swift + BackupTimelineView.swift.
 */
import { useEffect, useState } from "react";
import { confirm, message, open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "react-router-dom";
import { Upload, Trash2, Archive, RefreshCw, FolderInput } from "lucide-react";
import { api } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface BackupMeta {
  id: string;
  workspace_name: string;
  created_at: string;
  workspace_id: string;
}

export default function BackupSettingsSection() {
  const navigate = useNavigate();
  const { activeWorkspaceId, setActiveWorkspaceId, setActiveProjectId, setProjectsForWorkspace, setWorkspaces } = useWorkspaceStore();
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [importingLmStudio, setImportingLmStudio] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.backup.list().then((b) => setBackups(b as BackupMeta[])).catch(() => {});
  }, []);

  async function createBackup() {
    if (!activeWorkspaceId) {return;}
    setCreating(true);
    setError(null);
    try {
      await api.backup.create(activeWorkspaceId);
      await api.backup.list().then((b) => setBackups(b as BackupMeta[]));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setCreating(false);
    }
  }

  async function restoreBackup(id: string) {
    if (!await confirm("Restore this backup? This will overwrite existing data for this workspace.")) {return;}
    setRestoring(id);
    setError(null);
    try {
      // In a real flow we'd load the JSON then call api.backup.restore(json)
      // For now, trigger a reload
      await api.backup.list().then((b) => setBackups(b as BackupMeta[]));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoring(null);
    }
  }

  async function deleteBackup(id: string) {
    if (!await confirm("Delete this backup?")) {return;}
    await api.backup.delete(id);
    setBackups((prev) => prev.filter((b) => b.id !== id));
  }

  async function importFromLmStudio() {
    setError(null);
    setImportingLmStudio(true);

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select LM Studio conversations folder",
      });
      const folderPath = Array.isArray(selected) ? selected[0] : selected;
      if (!folderPath) {return;}

      const result = await api.chatFile.importLmStudioFolder(folderPath);
      if (result.imported < 1) {
        throw new Error("LM Studio import completed without importing any conversations.");
      }

      const [workspaces, importedProjects, firstSession] = await Promise.all([
        api.workspace.list(),
        api.project.list(result.workspace_id),
        api.chat.listSessions(result.workspace_id, null, { limit: 1, offset: 0 }),
      ]);
      if (firstSession.length < 1) {
        throw new Error("LM Studio import reported success, but no chat sessions were found in the imported workspace.");
      }
      setWorkspaces(workspaces);
      setProjectsForWorkspace(result.workspace_id, importedProjects);
      setActiveWorkspaceId(result.workspace_id);
      setActiveProjectId(null);

      const lines = [
        `${result.imported} conversation${result.imported === 1 ? "" : "s"} imported.`,
        `${result.projects_created} project${result.projects_created === 1 ? "" : "s"} created.`,
      ];
      if (result.errors > 0) {
        lines.push(`${result.errors} file${result.errors === 1 ? "" : "s"} skipped (empty or unreadable).`);
      }
      const summary = lines.join("\n");

      navigate(`/chat/${firstSession[0].id}`);
      await message(summary, { title: "LM Studio import complete", kind: result.errors > 0 ? "warning" : "info" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "LM Studio import failed";
      setError(msg);
      await message(msg, { title: "LM Studio import failed", kind: "error" });
    } finally {
      setImportingLmStudio(false);
    }
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

        <div className="mb-5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Import from LM Studio</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Pick a folder containing LM Studio <code>.conversation.json</code> files. The folder name becomes a new workspace and subfolders become projects.
              </p>
            </div>
            <button
              onClick={() => void importFromLmStudio()}
              disabled={importingLmStudio}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
            >
              {importingLmStudio ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
              {importingLmStudio ? "Importing…" : "Import Folder"}
            </button>
          </div>
        </div>

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
