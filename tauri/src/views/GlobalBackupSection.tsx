/**
 * GlobalBackupSection — file-based backup and restore for all workspaces.
 */
import { useState } from "react";
import { confirm, message, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { Archive, Download, RefreshCw, Upload } from "lucide-react";
import { api } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "aetherium";
}

function buildGlobalBackupFilename() {
  const date = new Date().toISOString().slice(0, 10);
  return `${sanitizeFilenamePart("aetherium-global")}-${date}.aetherium-backup.json`;
}

export default function GlobalBackupSection() {
  const {
    setWorkspaces,
    setActiveWorkspaceId,
    setProjectsForWorkspace,
  } = useWorkspaceStore();
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createGlobalBackup() {
    setError(null);
    const destination = await save({
      title: "Save global backup",
      defaultPath: buildGlobalBackupFilename(),
      filters: [{ name: "Aetherium Backup", extensions: ["json"] }],
    });
    if (!destination) {return;}

    setCreating(true);
    try {
      const backupJson = await api.backup.createGlobal();
      await writeTextFile(destination, backupJson);
      await message("Saved a global backup of all workspaces.", {
        title: "Global backup created",
        kind: "info",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Global backup failed";
      setError(msg);
      await message(msg, { title: "Global backup failed", kind: "error" });
    } finally {
      setCreating(false);
    }
  }

  async function restoreGlobalBackup() {
    const selected = await open({
      multiple: false,
      title: "Select a global backup file",
      filters: [{ name: "Aetherium Backup", extensions: ["json"] }],
    });
    const backupPath = Array.isArray(selected) ? selected[0] : selected;
    if (!backupPath) {return;}

    const shouldRestore = await confirm(
      "Restore this global backup? All workspaces in the backup will be restored. Existing workspaces with the same IDs will be replaced.",
      { title: "Restore global backup" },
    );
    if (!shouldRestore) {return;}

    setRestoring(true);
    setError(null);
    try {
      const backupJson = await readTextFile(backupPath);
      const restoredIds = await api.backup.restoreGlobal(backupJson);

      // Reload all workspaces
      const nextWorkspaces = await api.workspace.list();
      setWorkspaces(nextWorkspaces);

      // Preload projects for first restored workspace
      if (restoredIds.length > 0) {
        const firstId = restoredIds[0];
        const projects = await api.project.list(firstId);
        setProjectsForWorkspace(firstId, projects);
        setActiveWorkspaceId(firstId);
      }

      await message(
        `Restored ${restoredIds.length} workspace${restoredIds.length !== 1 ? "s" : ""} from global backup.`,
        {
          title: "Global restore complete",
          kind: "info",
        },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Restore failed";
      setError(msg);
      await message(msg, { title: "Global restore failed", kind: "error" });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[var(--border-color)] px-5 py-3">
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">Global Backup</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2 max-w-4xl">
          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Archive size={16} className="text-[var(--accent-color)]" />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Create Global Backup</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Save all workspaces and app data as a single portable JSON backup. Perfect for archiving or transferring your entire setup to another device.
                </p>
              </div>

              <button
                onClick={() => void createGlobalBackup()}
                disabled={creating}
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
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Restore Global Backup</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Open an Aetherium global backup file to restore all workspaces from that snapshot.
                </p>
                <p className="mt-3 text-xs text-[var(--text-muted)]">
                  Workspaces with matching IDs will be replaced. Other workspaces are preserved.
                </p>
              </div>

              <button
                onClick={() => void restoreGlobalBackup()}
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
