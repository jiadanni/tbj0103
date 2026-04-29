/**
 * ImportSettingsSection — external conversation imports.
 */
import { useCallback, useRef, useState } from "react";
import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { Check, CheckSquare, FolderInput, RefreshCw, Square, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import PromptDialog from "../components/PromptDialog";

/**
 * If a workspace with the given name already exists, prompt the user
 * to merge into it or provide a new name. Returns the resolved name
 * (original for merge, new for rename) or null if the user cancels.
 */
async function resolveWorkspaceNameConflict(
  name: string,
  workspaces: { name: string }[],
  promptForName: (defaultValue: string) => Promise<string | null>,
): Promise<string | null> {
  const normalised = name.trim().toLowerCase();
  const exists = workspaces.some(
    (w) => w.name.trim().toLowerCase() === normalised,
  );
  if (!exists) { return name; }

  const merge = await ask(
    `A workspace named "${name}" already exists.\n\nMerge conversations into the existing workspace?`,
    { title: "Workspace already exists", kind: "warning", okLabel: "Merge", cancelLabel: "Rename" },
  );

  if (merge) { return name; } // merge into existing

  // Ask for a new name via styled prompt dialog
  const newName = await promptForName(`${name} (2)`);
  if (!newName) { return null; } // user cancelled

  // Recurse in case the new name also conflicts
  return resolveWorkspaceNameConflict(newName.trim(), workspaces, promptForName);
}

export default function ImportSettingsSection() {
  const navigate = useNavigate();
  const {
    setActiveProjectId,
    setActiveWorkspaceId,
    setProjectsForWorkspace,
    setWorkspaces,
  } = useWorkspaceStore();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const [importingLmStudio, setImportingLmStudio] = useState(false);
  const [lmStudioFolder, setLmStudioFolder] = useState<string | null>(null);
  const [lmStudioPreviews, setLmStudioPreviews] = useState<
    {
      uuid: string;
      name: string;
      message_count: number;
      created_at: string;
      updated_at: string;
      project_id: string | null;
      project_name: string | null;
      source_path: string;
    }[]
  >([]);
  const [lmStudioProjects, setLmStudioProjects] = useState<
    {
      uuid: string;
      name: string;
      conversation_count: number;
      message_count: number;
    }[]
  >([]);
  const [lmStudioSelected, setLmStudioSelected] = useState<Set<string>>(new Set());
  const [lmStudioSelectedProjects, setLmStudioSelectedProjects] = useState<Set<string>>(new Set());
  const [lmStudioScanning, setLmStudioScanning] = useState(false);
  const [lmStudioScanErrors, setLmStudioScanErrors] = useState(0);
  const [importingMultipleFolders, setImportingMultipleFolders] = useState(false);
  const [importingGemini, setImportingGemini] = useState(false);
  const [importingClaude, setImportingClaude] = useState(false);
  const [claudeFolder, setClaudeFolder] = useState<string | null>(null);
  const [claudePreviews, setClaudePreviews] = useState<
    { uuid: string; name: string; message_count: number; created_at: string; updated_at: string }[]
  >([]);
  const [claudeProjects, setClaudeProjects] = useState<
    { uuid: string; name: string; description: string; has_prompt: boolean; doc_count: number }[]
  >([]);
  const [claudeMemories, setClaudeMemories] = useState<{
    conversations_memory: string;
    project_memories: { project_uuid: string; project_name: string; memory: string }[];
  } | null>(null);
  const [claudeSelected, setClaudeSelected] = useState<Set<string>>(new Set());
  const [claudeSelectedProjects, setClaudeSelectedProjects] = useState<Set<string>>(new Set());
  const [claudeImportMemories, setClaudeImportMemories] = useState(true);
  const [claudeScanning, setClaudeScanning] = useState(false);
  const [importingClaudeProjects, setImportingClaudeProjects] = useState(false);
  const [projectsScanning, setProjectsScanning] = useState(false);
  const [projectsFilePath, setProjectsFilePath] = useState<string | null>(null);
  const [projectPreviews, setProjectPreviews] = useState<
    { uuid: string; name: string; description: string; has_prompt: boolean; prompt_preview: string | null }[]
  >([]);
  const [selectedProjectImportIds, setSelectedProjectImportIds] = useState<Set<string>>(new Set());
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptState, setPromptState] = useState<{ defaultValue: string } | null>(null);
  const promptResolveRef = useRef<((value: string | null) => void) | null>(null);

  const promptForName = useCallback((defaultValue: string): Promise<string | null> => {
    return new Promise((resolve) => {
      promptResolveRef.current = resolve;
      setPromptState({ defaultValue });
    });
  }, []);

  function resetLmStudioPreview() {
    setLmStudioFolder(null);
    setLmStudioPreviews([]);
    setLmStudioProjects([]);
    setLmStudioSelected(new Set());
    setLmStudioSelectedProjects(new Set());
    setLmStudioScanErrors(0);
  }

  async function scanLmStudioFolder() {
    setError(null);
    setLmStudioScanning(true);
    resetLmStudioPreview();

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select LM Studio conversations folder",
      });
      const folderPath = Array.isArray(selected) ? selected[0] : selected;
      if (!folderPath) { return; }

      const result = await api.chatFile.previewLmStudioFolder(folderPath);
      if (result.total < 1) {
        throw new Error("No importable conversations were found in the selected folder.");
      }

      setLmStudioFolder(folderPath);
      setLmStudioPreviews(result.conversations);
      setLmStudioProjects(result.projects);
      setLmStudioSelected(new Set(result.conversations.map((conversation) => conversation.uuid)));
      setLmStudioSelectedProjects(new Set(result.projects.map((project) => project.uuid)));
      setLmStudioScanErrors(result.errors);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "LM Studio scan failed";
      setError(msg);
      await message(msg, { title: "LM Studio scan failed", kind: "error" });
    } finally {
      setLmStudioScanning(false);
    }
  }

  async function importFromLmStudio() {
    if (!lmStudioFolder) { return; }
    setError(null);
    setImportingLmStudio(true);

    try {
      const selectedConversationIds = lmStudioPreviews
        .filter((conversation) => (
          lmStudioSelected.has(conversation.uuid)
          && (!conversation.project_id || lmStudioSelectedProjects.has(conversation.project_id))
        ))
        .map((conversation) => conversation.uuid);

      if (selectedConversationIds.length < 1) {
        throw new Error("Select at least one LM Studio conversation to import.");
      }

      // Derive workspace name from folder and check for conflicts
      const defaultName = lmStudioFolder.split(/[/\\]/).filter(Boolean).pop() ?? "Imported Chats";
      const resolvedName = await resolveWorkspaceNameConflict(defaultName, workspaces, promptForName);
      if (!resolvedName) {return;} // user cancelled

      const selectedProjectIds = [...lmStudioSelectedProjects];
      const result = await api.chatFile.importLmStudioFolder(
        lmStudioFolder,
        resolvedName !== defaultName ? resolvedName : undefined,
        selectedConversationIds,
        selectedProjectIds.length > 0 ? selectedProjectIds : undefined,
      );
      if (result.imported < 1 && result.skipped > 0) {
        await message(`All ${result.skipped} conversation${result.skipped === 1 ? "" : "s"} already imported — nothing new to add.`, {
          title: "LM Studio import",
          kind: "info",
        });
        resetLmStudioPreview();
        return;
      }
      if (result.imported < 1) {
        throw new Error("LM Studio import completed without importing any conversations.");
      }

      const [freshWorkspaces, importedProjects, firstSession] = await Promise.all([
        api.workspace.list(),
        api.project.list(result.workspace_id),
        api.chat.listSessions(result.workspace_id, null, { limit: 1, offset: 0 }),
      ]);
      if (firstSession.length < 1) {
        throw new Error("LM Studio import reported success, but no chat sessions were found in the imported workspace.");
      }

      setWorkspaces(freshWorkspaces);
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
        lines.push(`${result.errors} file${result.errors === 1 ? "" : "s"} skipped (empty or unreadable).`);
      }

      resetLmStudioPreview();
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

  async function importFromMultipleFolders() {
    setError(null);
    setImportingMultipleFolders(true);

    try {
      const selected = await open({
        directory: true,
        multiple: true,
        title: "Select folders to import as workspaces",
      });
      const folderPaths = Array.isArray(selected) ? selected : (selected ? [selected] : []);
      if (!folderPaths || folderPaths.length === 0) { return; }

      const result = await api.chatFile.importMultipleFolders(folderPaths);

      if (result.total_imported < 1) {
        throw new Error("No conversations were imported from the selected folders.");
      }

      const freshWorkspaces = await api.workspace.list();
      setWorkspaces(freshWorkspaces);

      const lines = [
        `${result.successful}/${result.total_folders} folders processed successfully.`,
        `${result.total_imported} total conversation${result.total_imported === 1 ? "" : "s"} imported.`,
      ];
      if (result.total_skipped > 0) {
        lines.push(`${result.total_skipped} duplicate${result.total_skipped === 1 ? "" : "s"} skipped.`);
      }
      if (result.total_errors > 0) {
        lines.push(`${result.total_errors} file${result.total_errors === 1 ? "" : "s"} had errors.`);
      }

      await message(lines.join("\n"), {
        title: "Multi-folder import complete",
        kind: result.total_errors > 0 ? "warning" : "info",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Multi-folder import failed";
      setError(msg);
      await message(msg, { title: "Multi-folder import failed", kind: "error" });
    } finally {
      setImportingMultipleFolders(false);
    }
  }

  async function importFromGeminiTakeout() {
    setError(null);
    setImportingGemini(true);

    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "Select browser activity export HTML file",
        filters: [{ name: "HTML", extensions: ["html", "htm"] }],
      });
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (!filePath) {return;}

      const defaultName = "Imported Browser Chats";
      const resolvedName = await resolveWorkspaceNameConflict(defaultName, workspaces, promptForName);
      if (!resolvedName) {return;}

      const result = await api.chatFile.importGeminiTakeout(
        filePath,
        resolvedName !== defaultName ? resolvedName : undefined,
      );
      if (result.imported_sessions < 1) {
        throw new Error("The activity export completed without importing any conversations.");
      }

      const [freshWorkspaces, importedProjects, firstSession] = await Promise.all([
        api.workspace.list(),
        api.project.list(result.workspace_id),
        api.chat.listSessions(result.workspace_id, null, { limit: 1, offset: 0 }),
      ]);

      setWorkspaces(freshWorkspaces);
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
        title: "Activity import complete",
        kind: "info",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Activity import failed";
      setError(msg);
      await message(msg, { title: "Activity import failed", kind: "error" });
    } finally {
      setImportingGemini(false);
    }
  }

  async function scanClaudeProjects() {
    setError(null);
    setProjectsScanning(true);
    setProjectPreviews([]);
    setProjectsFilePath(null);
    setSelectedProjectImportIds(new Set());
    setExpandedProjectId(null);

    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "Select projects export JSON file",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (!filePath) { return; }

      const result = await api.chatFile.previewClaudeProjects(filePath);
      if (result.total < 1) {
        throw new Error("No projects were found in the selected export.");
      }

      setProjectsFilePath(filePath);
      setProjectPreviews(result.projects);
      // Select all by default
      setSelectedProjectImportIds(new Set(result.projects.map((p) => p.uuid)));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Project export scan failed";
      setError(msg);
      await message(msg, { title: "Project export scan failed", kind: "error" });
    } finally {
      setProjectsScanning(false);
    }
  }

  async function importClaudeProjects() {
    if (!projectsFilePath || selectedProjectImportIds.size === 0) { return; }
    setError(null);
    setImportingClaudeProjects(true);

    try {
      const selectedIds = [...selectedProjectImportIds];
      const result = await api.chatFile.importClaudeProjects(projectsFilePath, selectedIds);

      const freshWorkspaces = await api.workspace.list();
      setWorkspaces(freshWorkspaces);

      // Clear preview state
      setProjectsFilePath(null);
      setProjectPreviews([]);
      setSelectedProjectImportIds(new Set());
      setExpandedProjectId(null);

      const lines = [
        `${result.created} workspace${result.created === 1 ? "" : "s"} created from the project export.`,
      ];
      if (result.skipped > 0) {
        lines.push(`${result.skipped} skipped (workspace with same name already exists).`);
      }

      await message(lines.join("\n"), {
        title: "Project export imported",
        kind: "info",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Project export import failed";
      setError(msg);
      await message(msg, { title: "Project export import failed", kind: "error" });
    } finally {
      setImportingClaudeProjects(false);
    }
  }

  const scanClaudeDesktop = useCallback(async () => {
    setError(null);
    setClaudeScanning(true);
    setClaudePreviews([]);
    setClaudeProjects([]);
    setClaudeMemories(null);
    setClaudeFolder(null);

    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "Select conversations export JSON file",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (!filePath) { return; }

      const result = await api.chatFile.previewClaudeDesktop(filePath);
      if (result.total < 1) {
        throw new Error("No conversations with messages were found in the selected export.");
      }

      setClaudeFolder(filePath);
      setClaudePreviews(result.conversations);
      setClaudeProjects(result.projects);
      setClaudeMemories(result.memories);
      // Select all by default
      setClaudeSelected(new Set(result.conversations.map((c) => c.uuid)));
      setClaudeSelectedProjects(new Set(result.projects.map((p) => p.uuid)));
      setClaudeImportMemories(result.memories != null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Conversation export scan failed";
      setError(msg);
      await message(msg, { title: "Conversation export scan failed", kind: "error" });
    } finally {
      setClaudeScanning(false);
    }
  }, []);

  async function importFromClaudeDesktop() {
    if (!claudeFolder || claudeSelected.size === 0) { return; }
    setError(null);
    setImportingClaude(true);

    try {
      const defaultName = "Imported Conversations";
      const resolvedName = await resolveWorkspaceNameConflict(defaultName, workspaces, promptForName);
      if (!resolvedName) { return; }

      const selectedIds = [...claudeSelected];
      const selectedProjectIds = [...claudeSelectedProjects];
      const result = await api.chatFile.importClaudeDesktop(
        claudeFolder,
        resolvedName !== defaultName ? resolvedName : undefined,
        selectedIds,
        selectedProjectIds.length > 0 ? selectedProjectIds : undefined,
        claudeImportMemories,
      );
      if (result.imported < 1) {
        throw new Error("The conversation export completed without importing any conversations.");
      }

      const [freshWorkspaces, importedProjects, firstSession] = await Promise.all([
        api.workspace.list(),
        api.project.list(result.workspace_id),
        api.chat.listSessions(result.workspace_id, null, { limit: 1, offset: 0 }),
      ]);

      setWorkspaces(freshWorkspaces);
      setProjectsForWorkspace(result.workspace_id, importedProjects);
      setActiveWorkspaceId(result.workspace_id);
      setActiveProjectId(null);

      const lines = [
        `${result.imported} conversation${result.imported === 1 ? "" : "s"} imported.`,
        `${result.projects_created} project${result.projects_created === 1 ? "" : "s"} created.`,
      ];
      if (result.memories_imported > 0) {
        lines.push(`${result.memories_imported} memor${result.memories_imported === 1 ? "y" : "ies"} imported.`);
      }
      if (result.skipped > 0) {
        lines.push(`${result.skipped} duplicate${result.skipped === 1 ? "" : "s"} skipped.`);
      }
      if (result.errors > 0) {
        lines.push(`${result.errors} conversation${result.errors === 1 ? "" : "s"} had errors.`);
      }

      // Clear preview state
      setClaudeFolder(null);
      setClaudePreviews([]);
      setClaudeProjects([]);
      setClaudeMemories(null);
      setClaudeSelected(new Set());
      setClaudeSelectedProjects(new Set());
      setClaudeImportMemories(true);

      if (firstSession.length > 0) {
        navigate(`/chat/${firstSession[0].id}`);
      }

      await message(lines.join("\n"), {
        title: "Conversation import complete",
        kind: result.errors > 0 ? "warning" : "info",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Conversation import failed";
      setError(msg);
      await message(msg, { title: "Conversation import failed", kind: "error" });
    } finally {
      setImportingClaude(false);
    }
  }

  const selectedLmStudioConversationCount = lmStudioPreviews.filter((conversation) => (
    lmStudioSelected.has(conversation.uuid)
    && (!conversation.project_id || lmStudioSelectedProjects.has(conversation.project_id))
  )).length;

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
                  Pick a folder containing LM Studio <code>.conversation.json</code> files. Conversations are listed for review before import, and subfolders can be imported as projects selectively.
                </p>
              </div>

              <button
                onClick={() => void scanLmStudioFolder()}
                disabled={lmStudioScanning || importingLmStudio}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {lmStudioScanning ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {lmStudioScanning ? "Scanning..." : "Scan Folder"}
              </button>
            </div>

            {lmStudioPreviews.length > 0 && (
              <div className="mt-4 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      Conversations ({selectedLmStudioConversationCount}/{lmStudioPreviews.length})
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setLmStudioSelected(new Set(lmStudioPreviews.map((conversation) => conversation.uuid)))}
                        className="text-xs text-[var(--accent-color)] hover:underline"
                      >
                        All
                      </button>
                      <button
                        onClick={() => setLmStudioSelected(new Set())}
                        className="text-xs text-[var(--text-muted)] hover:underline"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
                    {lmStudioPreviews.map((conversation) => {
                      const checked = lmStudioSelected.has(conversation.uuid);
                      return (
                        <label
                          key={conversation.uuid}
                          className="flex cursor-pointer items-center gap-2.5 border-b border-[var(--border-color)] px-3 py-2 last:border-b-0 hover:bg-[var(--bg-hover)]"
                        >
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={checked}
                            onClick={() => {
                              setLmStudioSelected((prev) => {
                                const next = new Set(prev);
                                if (checked) { next.delete(conversation.uuid); }
                                else { next.add(conversation.uuid); }
                                return next;
                              });
                            }}
                            className="shrink-0 text-[var(--accent-color)]"
                          >
                            {checked ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--text-muted)]" />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-[var(--text-primary)]">
                              {conversation.name || "Untitled"}
                            </p>
                            <p className="truncate text-[10px] text-[var(--text-muted)]">
                              {conversation.message_count} msg{conversation.message_count !== 1 && "s"}
                              {" · "}
                              {conversation.project_name || "Workspace root"}
                              {" · "}
                              {conversation.source_path}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {lmStudioProjects.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[var(--text-primary)]">
                        Projects ({lmStudioSelectedProjects.size}/{lmStudioProjects.length})
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setLmStudioSelectedProjects(new Set(lmStudioProjects.map((project) => project.uuid)))}
                          className="text-xs text-[var(--accent-color)] hover:underline"
                        >
                          All
                        </button>
                        <button
                          onClick={() => setLmStudioSelectedProjects(new Set())}
                          className="text-xs text-[var(--text-muted)] hover:underline"
                        >
                          None
                        </button>
                      </div>
                    </div>
                    <div className="max-h-44 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
                      {lmStudioProjects.map((project) => {
                        const checked = lmStudioSelectedProjects.has(project.uuid);
                        return (
                          <label
                            key={project.uuid}
                            className="flex cursor-pointer items-center gap-2.5 border-b border-[var(--border-color)] px-3 py-2 last:border-b-0 hover:bg-[var(--bg-hover)]"
                          >
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              onClick={() => {
                                setLmStudioSelectedProjects((prev) => {
                                  const next = new Set(prev);
                                  if (checked) { next.delete(project.uuid); }
                                  else { next.add(project.uuid); }
                                  return next;
                                });
                              }}
                              className="shrink-0 text-[var(--accent-color)]"
                            >
                              {checked ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--text-muted)]" />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-[var(--text-primary)]">
                                {project.name}
                              </p>
                              <p className="text-[10px] text-[var(--text-muted)]">
                                {project.conversation_count} conversation{project.conversation_count !== 1 ? "s" : ""}
                                {" · "}
                                {project.message_count} total message{project.message_count !== 1 ? "s" : ""}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {lmStudioScanErrors > 0 && (
                  <p className="text-[10px] text-amber-400">
                    {lmStudioScanErrors} file{lmStudioScanErrors === 1 ? "" : "s"} could not be previewed and will be skipped unless fixed.
                  </p>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => resetLmStudioPreview()}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  >
                    <X size={12} /> Cancel
                  </button>
                  <button
                    onClick={() => void importFromLmStudio()}
                    disabled={selectedLmStudioConversationCount === 0 || importingLmStudio}
                    className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent-color)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                  >
                    {importingLmStudio ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                    {importingLmStudio ? "Importing..." : `Import ${selectedLmStudioConversationCount} conversation${selectedLmStudioConversationCount !== 1 ? "s" : ""}`}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FolderInput size={16} className="text-[var(--accent-color)]" />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Import Multiple Folders</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Select multiple folders at once. Each folder containing <code>.conversation.json</code> files will be imported as a separate workspace.
                </p>
              </div>

              <button
                onClick={() => void importFromMultipleFolders()}
                disabled={importingMultipleFolders}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {importingMultipleFolders ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {importingMultipleFolders ? "Importing..." : "Import Folders"}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FolderInput size={16} className="text-[var(--accent-color)]" />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Import Browser Activity Export</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Pick an exported browser activity HTML file. Supported today: Google Takeout activity exports. It scans for <code>My Activity.html</code> content and imports conversations into a new workspace.
                </p>
              </div>

              <button
                onClick={() => void importFromGeminiTakeout()}
                disabled={importingGemini}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {importingGemini ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {importingGemini ? "Importing..." : "Import Activity"}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FolderInput size={16} className="text-[var(--accent-color)]" />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Import Project Export</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Pick a <code>projects.json</code> export file. Supported today: Claude Desktop project exports. Each imported project becomes its own workspace with descriptions and instructions.
                </p>
              </div>

              <button
                onClick={() => void scanClaudeProjects()}
                disabled={projectsScanning || importingClaudeProjects}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {projectsScanning ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {projectsScanning ? "Scanning..." : "Scan Export"}
              </button>
            </div>

            {/* ── Project review picker ─────────────────────────── */}
            {projectPreviews.length > 0 && (
              <div className="mt-4 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      Projects ({selectedProjectImportIds.size}/{projectPreviews.length})
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedProjectImportIds(new Set(projectPreviews.map((p) => p.uuid)))}
                        className="text-xs text-[var(--accent-color)] hover:underline"
                      >
                        All
                      </button>
                      <button
                        onClick={() => setSelectedProjectImportIds(new Set())}
                        className="text-xs text-[var(--text-muted)] hover:underline"
                      >
                        None
                      </button>
                    </div>
                  </div>

                  <div className="max-h-96 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
                    {projectPreviews.map((proj) => {
                      const checked = selectedProjectImportIds.has(proj.uuid);
                      const expanded = expandedProjectId === proj.uuid;
                      return (
                        <div key={proj.uuid} className="border-b border-[var(--border-color)] last:border-b-0">
                          <div className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-[var(--bg-hover)]">
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              onClick={() => {
                                setSelectedProjectImportIds((prev) => {
                                  const next = new Set(prev);
                                  if (checked) { next.delete(proj.uuid); }
                                  else { next.add(proj.uuid); }
                                  return next;
                                });
                              }}
                              className="mt-0.5 shrink-0 text-[var(--accent-color)]"
                            >
                              {checked ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--text-muted)]" />}
                            </button>
                            <div
                              className="min-w-0 flex-1"
                              onClick={() => setExpandedProjectId(expanded ? null : proj.uuid)}
                            >
                              <p className="truncate text-xs font-medium text-[var(--text-primary)]">
                                {proj.name}
                              </p>
                              <p className="text-[10px] text-[var(--text-muted)]">
                                {proj.description || "No description"}
                                {proj.has_prompt && " · Has instructions"}
                              </p>
                            </div>
                            {(proj.description || proj.has_prompt) && (
                              <button
                                type="button"
                                onClick={() => setExpandedProjectId(expanded ? null : proj.uuid)}
                                className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                                aria-label={expanded ? "Collapse" : "Expand"}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                                >
                                  <polyline points="6 9 12 15 18 9" />
                                </svg>
                              </button>
                            )}
                          </div>
                          {expanded && (proj.description || proj.prompt_preview) && (
                            <div className="px-3 pb-3 pt-0 pl-10 flex flex-col gap-2">
                              {proj.description && (
                                <div>
                                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Description</p>
                                  <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{proj.description}</p>
                                </div>
                              )}
                              {proj.prompt_preview && (
                                <div>
                                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Instructions</p>
                                  <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap font-mono bg-[var(--bg-elevated)] rounded px-2 py-1.5">{proj.prompt_preview}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Import / Cancel buttons */}
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => {
                      setProjectsFilePath(null);
                      setProjectPreviews([]);
                      setSelectedProjectImportIds(new Set());
                      setExpandedProjectId(null);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  >
                    <X size={12} /> Cancel
                  </button>
                  <button
                    onClick={() => void importClaudeProjects()}
                    disabled={selectedProjectImportIds.size === 0 || importingClaudeProjects}
                    className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent-color)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                  >
                    {importingClaudeProjects ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                    {importingClaudeProjects ? "Importing..." : `Import ${selectedProjectImportIds.size} project${selectedProjectImportIds.size !== 1 ? "s" : ""}`}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FolderInput size={16} className="text-[var(--accent-color)]" />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Import Conversation Export</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Pick a <code>conversations.json</code> export file. Supported today: Claude Desktop conversation exports. Conversations are listed for selection before import.
                </p>
              </div>

              <button
                onClick={() => void scanClaudeDesktop()}
                disabled={claudeScanning || importingClaude}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {claudeScanning ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {claudeScanning ? "Scanning..." : "Scan Export"}
              </button>
            </div>

            {/* ── Selection picker ─────────────────────────────── */}
            {claudePreviews.length > 0 && (
              <div className="mt-4 flex flex-col gap-4">

                {/* ── Conversations ── */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      Conversations ({claudeSelected.size}/{claudePreviews.length})
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setClaudeSelected(new Set(claudePreviews.map((c) => c.uuid)))}
                        className="text-xs text-[var(--accent-color)] hover:underline"
                      >
                        All
                      </button>
                      <button
                        onClick={() => setClaudeSelected(new Set())}
                        className="text-xs text-[var(--text-muted)] hover:underline"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
                    {claudePreviews.map((conv) => {
                      const checked = claudeSelected.has(conv.uuid);
                      return (
                        <label
                          key={conv.uuid}
                          className="flex cursor-pointer items-center gap-2.5 border-b border-[var(--border-color)] px-3 py-2 last:border-b-0 hover:bg-[var(--bg-hover)]"
                        >
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={checked}
                            onClick={() => {
                              setClaudeSelected((prev) => {
                                const next = new Set(prev);
                                if (checked) { next.delete(conv.uuid); }
                                else { next.add(conv.uuid); }
                                return next;
                              });
                            }}
                            className="shrink-0 text-[var(--accent-color)]"
                          >
                            {checked ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--text-muted)]" />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-[var(--text-primary)]">
                              {conv.name || "Untitled"}
                            </p>
                            <p className="text-[10px] text-[var(--text-muted)]">
                              {conv.message_count} msg{conv.message_count !== 1 && "s"} &middot; {new Date(conv.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* ── Projects ── */}
                {claudeProjects.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[var(--text-primary)]">
                        Projects ({claudeSelectedProjects.size}/{claudeProjects.length})
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setClaudeSelectedProjects(new Set(claudeProjects.map((p) => p.uuid)))}
                          className="text-xs text-[var(--accent-color)] hover:underline"
                        >
                          All
                        </button>
                        <button
                          onClick={() => setClaudeSelectedProjects(new Set())}
                          className="text-xs text-[var(--text-muted)] hover:underline"
                        >
                          None
                        </button>
                      </div>
                    </div>
                    <div className="max-h-44 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
                      {claudeProjects.map((proj) => {
                        const checked = claudeSelectedProjects.has(proj.uuid);
                        return (
                          <label
                            key={proj.uuid}
                            className="flex cursor-pointer items-center gap-2.5 border-b border-[var(--border-color)] px-3 py-2 last:border-b-0 hover:bg-[var(--bg-hover)]"
                          >
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              onClick={() => {
                                setClaudeSelectedProjects((prev) => {
                                  const next = new Set(prev);
                                  if (checked) { next.delete(proj.uuid); }
                                  else { next.add(proj.uuid); }
                                  return next;
                                });
                              }}
                              className="shrink-0 text-[var(--accent-color)]"
                            >
                              {checked ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--text-muted)]" />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-[var(--text-primary)]">
                                {proj.name}
                              </p>
                              <p className="text-[10px] text-[var(--text-muted)]">
                                {proj.has_prompt && "Has instructions"}
                                {proj.has_prompt && proj.doc_count > 0 && " · "}
                                {proj.doc_count > 0 && `${proj.doc_count} doc${proj.doc_count !== 1 ? "s" : ""}`}
                                {!proj.has_prompt && proj.doc_count === 0 && "Empty project"}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Memories ── */}
                {claudeMemories && (claudeMemories.conversations_memory || claudeMemories.project_memories.length > 0) && (
                  <div className="flex flex-col gap-2">
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={claudeImportMemories}
                        onClick={() => setClaudeImportMemories((v) => !v)}
                        className="shrink-0 text-[var(--accent-color)]"
                      >
                        {claudeImportMemories ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--text-muted)]" />}
                      </button>
                      <span className="text-xs font-medium text-[var(--text-primary)]">
                        Import saved memories
                      </span>
                    </label>
                    <p className="text-[10px] text-[var(--text-muted)] pl-6">
                      {claudeMemories.conversations_memory ? "1 conversation memory" : ""}
                      {claudeMemories.conversations_memory && claudeMemories.project_memories.length > 0 ? " + " : ""}
                      {claudeMemories.project_memories.length > 0
                        ? `${claudeMemories.project_memories.length} project memor${claudeMemories.project_memories.length !== 1 ? "ies" : "y"}`
                        : ""}
                    </p>
                  </div>
                )}

                {/* Import / Cancel buttons */}
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => {
                      setClaudeFolder(null);
                      setClaudePreviews([]);
                      setClaudeProjects([]);
                      setClaudeMemories(null);
                      setClaudeSelected(new Set());
                      setClaudeSelectedProjects(new Set());
                      setClaudeImportMemories(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  >
                    <X size={12} /> Cancel
                  </button>
                  <button
                    onClick={() => void importFromClaudeDesktop()}
                    disabled={claudeSelected.size === 0 || importingClaude}
                    className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent-color)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                  >
                    {importingClaude ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                    {importingClaude ? "Importing..." : `Import ${claudeSelected.size} conversation${claudeSelected.size !== 1 ? "s" : ""}`}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
      {promptState && (
        <PromptDialog
          title="Rename Workspace"
          description="Enter a new workspace name to avoid the conflict."
          defaultValue={promptState.defaultValue}
          placeholder="Workspace name"
          confirmLabel="Use This Name"
          onCancel={() => {
            setPromptState(null);
            promptResolveRef.current?.(null);
            promptResolveRef.current = null;
          }}
          onConfirm={(value) => {
            setPromptState(null);
            promptResolveRef.current?.(value);
            promptResolveRef.current = null;
          }}
        />
      )}
    </div>
  );
}
