/**
 * BackupSettingsSection — file-based backup and restore for a workspace.
 */
import { useMemo, useState } from "react";
import { confirm, message, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { Archive, Download, RefreshCw, Upload } from "lucide-react";
import { api } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "workspace";
}

function buildBackupFilename(workspaceName: string) {
  const date = new Date().toISOString().slice(0, 10);
  return `${sanitizeFilenamePart(workspaceName)}-${date}.aetherium-backup.json`;
}

export default function BackupSettingsSection() {
  const {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    setActiveProjectId,
    setProjectsForWorkspace,
    setWorkspaces,
  } = useWorkspaceStore();
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );

  async function createBackup() {
    if (!activeWorkspaceId || !activeWorkspace) {return;}

    setError(null);
    const destination = await save({
      title: "Save workspace backup",
      defaultPath: buildBackupFilename(activeWorkspace.name),
      filters: [{ name: "Aetherium Backup", extensions: ["json"] }],
    });
    if (!destination) {return;}

    setCreating(true);
    try {
      const backupJson = await api.backup.create(activeWorkspaceId);
      await writeTextFile(destination, backupJson);
      await message(`Saved a backup for "${activeWorkspace.name}".`, {
        title: "Backup created",
        kind: "info",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Backup failed";
      setError(msg);
      await message(msg, { title: "Backup failed", kind: "error" });
    } finally {
      setCreating(false);
    }
  }

  async function restoreBackup() {
    const selected = await open({
      multiple: false,
      title: "Select a backup file",
      filters: [{ name: "Aetherium Backup", extensions: ["json"] }],
    });
    const backupPath = Array.isArray(selected) ? selected[0] : selected;
    if (!backupPath) {return;}

    const shouldRestore = await confirm(
      "Restore this backup? Existing data for the restored workspace id will be replaced.",
      { title: "Restore backup" },
    );
    if (!shouldRestore) {return;}

    setRestoring(true);
    setError(null);
    try {
      const backupJson = await readTextFile(backupPath);
      const restoredWorkspaceId = await api.backup.restore(backupJson);
      const [nextWorkspaces, nextProjects] = await Promise.all([
        api.workspace.list(),
        api.project.list(restoredWorkspaceId),
      ]);

      setWorkspaces(nextWorkspaces);
      setProjectsForWorkspace(restoredWorkspaceId, nextProjects);
      setActiveWorkspaceId(restoredWorkspaceId);
      setActiveProjectId(null);

      await message("The backup file was restored into your workspace list.", {
        title: "Restore complete",
        kind: "info",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Restore failed";
      setError(msg);
      await message(msg, { title: "Restore failed", kind: "error" });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[var(--border-color)] px-5 py-3">
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">Backup</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Archive size={16} className="text-[var(--accent-color)]" />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Create Backup File</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Save the current workspace as a portable JSON backup you can archive or move to another device.
                </p>
                <p className="mt-3 text-xs text-[var(--text-muted)]">
                  {activeWorkspace
                    ? `Current workspace: ${activeWorkspace.name}`
                    : "Select a workspace to create a backup."}
                </p>
              </div>

              <button
                onClick={() => void createBackup()}
                disabled={creating || !activeWorkspace}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-3 py-2 text-xs text-white hover:opacity-90 disabled:opacity-40"
              >
                {creating ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} />}
                {creating ? "Creating..." : "Save Backup"}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Upload size={16} className="text-[var(--accent-color)]" />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Restore Backup File</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Open an Aetherium backup JSON file and restore that workspace back into the app.
                </p>
                <p className="mt-3 text-xs text-[var(--text-muted)]">
                  Restore replaces any existing workspace that uses the same backup workspace id.
                </p>
              </div>

              <button
                onClick={() => void restoreBackup()}
                disabled={restoring}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {restoring ? <RefreshCw size={12} className="animate-spin" /> : <Upload size={12} />}
                {restoring ? "Restoring..." : "Open Backup"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
