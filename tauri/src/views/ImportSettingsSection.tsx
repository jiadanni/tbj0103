/**
 * ImportSettingsSection — external conversation imports.
 */
import { useState } from "react";
import { message, open } from "@tauri-apps/plugin-dialog";
import { FolderInput, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

export default function ImportSettingsSection() {
  const navigate = useNavigate();
  const {
    setActiveProjectId,
    setActiveWorkspaceId,
    setProjectsForWorkspace,
    setWorkspaces,
  } = useWorkspaceStore();
  const [importingLmStudio, setImportingLmStudio] = useState(false);
  const [importingGemini, setImportingGemini] = useState(false);
  const [importingClaude, setImportingClaude] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      navigate(`/chat/${firstSession[0].id}`);
      await message(lines.join("\n"), {
        title: "LM Studio import complete",
        kind: result.errors > 0 ? "warning" : "info",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "LM Studio import failed";
      setError(msg);
      await message(msg, { title: "LM Studio import failed", kind: "error" });
    } finally {
      setImportingLmStudio(false);
    }
  }

  async function importFromGeminiTakeout() {
    setError(null);
    setImportingGemini(true);

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Google Takeout folder (containing Gemini Apps)",
      });
      const folderPath = Array.isArray(selected) ? selected[0] : selected;
      if (!folderPath) {return;}

      const result = await api.chatFile.importGeminiTakeout(folderPath);
      if (result.imported_sessions < 1) {
        throw new Error("Gemini import completed without importing any conversations. Ensure the folder contains 'My Activity.html'.");
      }

      const [workspaces, importedProjects, firstSession] = await Promise.all([
        api.workspace.list(),
        api.project.list(result.workspace_id),
        api.chat.listSessions(result.workspace_id, null, { limit: 1, offset: 0 }),
      ]);

      setWorkspaces(workspaces);
      setProjectsForWorkspace(result.workspace_id, importedProjects);
      setActiveWorkspaceId(result.workspace_id);
      setActiveProjectId(null);

      const lines = [
        `${result.imported_sessions} conversation${result.imported_sessions === 1 ? "" : "s"} imported.`,
        `${result.imported_messages} total message${result.imported_messages === 1 ? "" : "s"} processed.`,
      ];

      if (firstSession.length > 0) {
        navigate(`/chat/${firstSession[0].id}`);
      }

      await message(lines.join("\n"), {
        title: "Gemini import complete",
        kind: "info",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Gemini import failed";
      setError(msg);
      await message(msg, { title: "Gemini import failed", kind: "error" });
    } finally {
      setImportingGemini(false);
    }
  }

  async function importFromClaudeDesktop() {
    setError(null);
    setImportingClaude(true);

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Claude Desktop export folder (containing conversations.json)",
      });
      const folderPath = Array.isArray(selected) ? selected[0] : selected;
      if (!folderPath) {return;}

      const result = await api.chatFile.importClaudeDesktop(folderPath);
      if (result.imported < 1) {
        throw new Error("Claude Desktop import completed without importing any conversations.");
      }

      const [workspaces, importedProjects, firstSession] = await Promise.all([
        api.workspace.list(),
        api.project.list(result.workspace_id),
        api.chat.listSessions(result.workspace_id, null, { limit: 1, offset: 0 }),
      ]);

      setWorkspaces(workspaces);
      setProjectsForWorkspace(result.workspace_id, importedProjects);
      setActiveWorkspaceId(result.workspace_id);
      setActiveProjectId(null);

      const lines = [
        `${result.imported} conversation${result.imported === 1 ? "" : "s"} imported.`,
        `${result.projects_created} project${result.projects_created === 1 ? "" : "s"} created.`,
      ];
      if (result.skipped > 0) {
        lines.push(`${result.skipped} duplicate${result.skipped === 1 ? "" : "s"} skipped.`);
      }
      if (result.errors > 0) {
        lines.push(`${result.errors} conversation${result.errors === 1 ? "" : "s"} had errors.`);
      }

      if (firstSession.length > 0) {
        navigate(`/chat/${firstSession[0].id}`);
      }

      await message(lines.join("\n"), {
        title: "Claude Desktop import complete",
        kind: result.errors > 0 ? "warning" : "info",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Claude Desktop import failed";
      setError(msg);
      await message(msg, { title: "Claude Desktop import failed", kind: "error" });
    } finally {
      setImportingClaude(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[var(--border-color)] px-5 py-3">
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">Import</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-4 max-w-3xl">
          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FolderInput size={16} className="text-[var(--accent-color)]" />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Import from LM Studio</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Pick a folder containing LM Studio <code>.conversation.json</code> files. The folder name becomes a new workspace and subfolders become projects.
                </p>
              </div>

              <button
                onClick={() => void importFromLmStudio()}
                disabled={importingLmStudio}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {importingLmStudio ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {importingLmStudio ? "Importing..." : "Import Folder"}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FolderInput size={16} className="text-[var(--accent-color)]" />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Import from Google Gemini</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Pick your extracted Google Takeout folder. It will scan for <code>My Activity.html</code> and import all conversations into a &quot;Gemini Apps&quot; workspace.
                </p>
              </div>

              <button
                onClick={() => void importFromGeminiTakeout()}
                disabled={importingGemini}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {importingGemini ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {importingGemini ? "Importing..." : "Import Takeout"}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FolderInput size={16} className="text-[var(--accent-color)]" />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Import from Claude Desktop</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Pick the folder containing your Claude Desktop export (<code>conversations.json</code> and optionally <code>projects.json</code>). All conversations import into a &quot;Claude Desktop&quot; workspace. Projects are created from the export if present.
                </p>
              </div>

              <button
                onClick={() => void importFromClaudeDesktop()}
                disabled={importingClaude}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {importingClaude ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {importingClaude ? "Importing..." : "Import Folder"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

