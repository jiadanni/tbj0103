/**
 * BackupSettingsSection — file-based backup and restore for a workspace.
 */
import { useMemo, useState } from "react";
import { confirm, message, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { Archive, Download, RefreshCw, Upload } from "lucide-react";
import { api } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import SuccessDialog from "../components/SuccessDialog";

function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "workspace";
}

function buildBackupFilename(workspaceName: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const datetime = `${getPart("year")}-${getPart("month")}-${getPart("day")}-${getPart("hour")}-${getPart("minute")}-${getPart("second")}`;
  return `${sanitizeFilenamePart(workspaceName)}-${datetime}.aetherium-backup.json`;
}

export default function BackupSettingsSection() {
  const {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    setActiveFolderId,
    setFoldersForWorkspace,
    setWorkspaces,
  } = useWorkspaceStore();
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successDialog, setSuccessDialog] = useState<{ title: string; description: string } | null>(null);

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
      setSuccessDialog({
        title: "Backup created",
        description: `Saved a backup for "${activeWorkspace.name}".`,
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
        api.folder.list(restoredWorkspaceId),
      ]);

      setWorkspaces(nextWorkspaces);
      setFoldersForWorkspace(restoredWorkspaceId, nextProjects);
      setActiveWorkspaceId(restoredWorkspaceId);
      setActiveFolderId(null);

      setSuccessDialog({
        title: "Restore complete",
        description: "The backup file was restored into your workspace list.",
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
    <div className="w-full">
      {(creating || restoring) && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-[var(--accent-color)]/20 bg-[var(--accent-color)]/5 px-4 py-3 text-sm text-[var(--text-secondary)] shadow-sm">
          <RefreshCw size={16} className="animate-spin text-[var(--accent-color)]" />
          <div className="flex-1">
            <span className="font-medium text-[var(--text-primary)]">
              {creating ? "Creating backup..." : "Restoring backup..."}
            </span>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Please do not close Aetherium while this process completes.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
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
              {creating ? "Exporting..." : "Export"}
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
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-3 py-2 text-xs text-white hover:opacity-90 disabled:opacity-40"
            >
              {restoring ? <RefreshCw size={12} className="animate-spin" /> : <Upload size={12} />}
              {restoring ? "Restoring..." : "Restore"}
            </button>
          </div>
        </section>
      </div>

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
