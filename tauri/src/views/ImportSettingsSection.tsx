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
  const [claudeScanning, setClaudeScanning] = useState(false);
  const [claudeIncludeConversations, setClaudeIncludeConversations] = useState(true);
  const [claudeIncludeProjects, setClaudeIncludeProjects] = useState(false);
  const [claudeIncludeMemories, setClaudeIncludeMemories] = useState(false);
  const [claudeConversationsPath, setClaudeConversationsPath] = useState<string | null>(null);
  const [claudeProjectsPath, setClaudeProjectsPath] = useState<string | null>(null);
  const [claudeMemoriesPath, setClaudeMemoriesPath] = useState<string | null>(null);
  const [claudePreviews, setClaudePreviews] = useState<
    { uuid: string; name: string; message_count: number; created_at: string; updated_at: string; project_uuid: string | null }[]
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
  const [error, setError] = useState<string | null>(null);
  const [slotWarnings, setSlotWarnings] = useState<Record<string, string | null>>({});
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

  async function pickClaudeFile(
    key: string,
    label: string,
    setter: (path: string | null) => void,
  ) {
    setError(null);
    const selected = await open({
      directory: false,
      multiple: false,
      title: `Select ${label}`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    const filePath = Array.isArray(selected) ? selected[0] : selected;
    if (filePath) {
      const filename = filePath.split("/").pop();
      setSlotWarnings((prev) => ({
        ...prev,
        [key]: filename !== label ? `Selected ${filename} — expected ${label}` : null,
      }));
      setter(filePath);
    }
  }

  const scanClaudeFiles = useCallback(async () => {
    setError(null);
    setClaudeScanning(true);
    setClaudePreviews([]);
    setClaudeProjects([]);
    setClaudeMemories(null);
    setClaudeSelected(new Set());
    setClaudeSelectedProjects(new Set());

    try {
      const wantConv = claudeIncludeConversations && !!claudeConversationsPath;
      const wantProj = claudeIncludeProjects && !!claudeProjectsPath;
      const wantMem = claudeIncludeMemories && !!claudeMemoriesPath;
      if (!wantConv && !wantProj && !wantMem) {
        throw new Error("Pick at least one file to scan.");
      }

      const result = await api.chatFile.previewClaudeFiles({
        conversationsPath: wantConv ? claudeConversationsPath : null,
        projectsPath: wantProj ? claudeProjectsPath : null,
        memoriesPath: wantMem ? claudeMemoriesPath : null,
      });

      if (result.total < 1 && result.projects.length < 1 && !result.memories) {
        throw new Error("Selected files contained nothing importable.");
      }

      setClaudePreviews(result.conversations);
      setClaudeProjects(result.projects);
      setClaudeMemories(result.memories);
      setClaudeSelected(new Set(result.conversations.map((c) => c.uuid)));
      setClaudeSelectedProjects(new Set(result.projects.map((p) => p.uuid)));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Claude scan failed";
      setError(msg);
      await message(msg, { title: "Claude scan failed", kind: "error" });
    } finally {
      setClaudeScanning(false);
    }
  }, [
    claudeIncludeConversations,
    claudeIncludeProjects,
    claudeIncludeMemories,
    claudeConversationsPath,
    claudeProjectsPath,
    claudeMemoriesPath,
  ]);

  async function importClaudeFiles() {
    const haveAnything =
      (claudeIncludeConversations && claudeSelected.size > 0)
      || (claudeIncludeProjects && claudeSelectedProjects.size > 0)
      || (claudeIncludeMemories && claudeMemories != null);
    if (!haveAnything) { return; }

    setError(null);
    setImportingClaude(true);

    try {
      const defaultName = "Imported Conversations";
      const resolvedName = await resolveWorkspaceNameConflict(defaultName, workspaces, promptForName);
      if (!resolvedName) { return; }

      const result = await api.chatFile.importClaudeFiles({
        workspaceName: resolvedName !== defaultName ? resolvedName : undefined,
        conversationsPath: claudeIncludeConversations ? claudeConversationsPath : null,
        projectsPath: claudeIncludeProjects ? claudeProjectsPath : null,
        memoriesPath: claudeIncludeMemories ? claudeMemoriesPath : null,
        selectedIds: claudeIncludeConversations ? [...claudeSelected] : undefined,
        selectedProjectIds: claudeIncludeProjects && claudeSelectedProjects.size > 0
          ? [...claudeSelectedProjects]
          : undefined,
        importMemories: claudeIncludeMemories,
      });

      const [freshWorkspaces, importedProjects, firstSession] = await Promise.all([
        api.workspace.list(),
        api.project.list(result.workspace_id),
        api.chat.listSessions(result.workspace_id, null, { limit: 1, offset: 0 }),
      ]);

      setWorkspaces(freshWorkspaces);
      setProjectsForWorkspace(result.workspace_id, importedProjects);
      setActiveWorkspaceId(result.workspace_id);
      setActiveProjectId(null);

      const lines: string[] = [];
      if (result.imported > 0) {
        lines.push(`${result.imported} conversation${result.imported === 1 ? "" : "s"} imported.`);
      }
      if (result.projects_created > 0) {
        lines.push(`${result.projects_created} project${result.projects_created === 1 ? "" : "s"} created.`);
      }
      if (result.memories_imported > 0) {
        lines.push(`${result.memories_imported} memor${result.memories_imported === 1 ? "y" : "ies"} imported.`);
      }
      if (result.skipped > 0) {
        lines.push(`${result.skipped} duplicate${result.skipped === 1 ? "" : "s"} skipped.`);
      }
      if (result.errors > 0) {
        lines.push(`${result.errors} item${result.errors === 1 ? "" : "s"} had errors.`);
      }
      if (lines.length === 0) {
        lines.push("Nothing was imported.");
      }

      // Clear preview state on success
      setClaudeConversationsPath(null);
      setClaudeProjectsPath(null);
      setClaudeMemoriesPath(null);
      setClaudePreviews([]);
      setClaudeProjects([]);
      setClaudeMemories(null);
      setClaudeSelected(new Set());
      setClaudeSelectedProjects(new Set());

      if (firstSession.length > 0) {
        navigate(`/chat/${firstSession[0].id}`);
      }

      await message(lines.join("\n"), {
        title: "Claude import complete",
        kind: result.errors > 0 ? "warning" : "info",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Claude import failed";
      setError(msg);
      await message(msg, { title: "Claude import failed", kind: "error" });
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
        <div className="flex flex-col gap-4 max-w-3xl">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}
<section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FolderInput size={16} className="text-[var(--accent-color)]" />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Import LM Studio Conversations Folder</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Choose a folder that contains LM Studio <code>.conversation.json</code> files. We will scan the folder, show the conversations for review, and let you choose which subfolders to import as projects.
                </p>
              </div>

              <button
                onClick={() => void scanLmStudioFolder()}
                disabled={lmStudioScanning || importingLmStudio}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {lmStudioScanning ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {lmStudioScanning ? "Scanning..." : "Scan LM Studio Folder"}
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
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Import Multiple LM Studio Conversation Folders</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Choose several folders at once. Each folder that contains LM Studio <code>.conversation.json</code> files will be imported into its own workspace.
                </p>
              </div>

              <button
                onClick={() => void importFromMultipleFolders()}
                disabled={importingMultipleFolders}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {importingMultipleFolders ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {importingMultipleFolders ? "Importing..." : "Import LM Studio Folders"}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FolderInput size={16} className="text-[var(--accent-color)]" />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Import Google Takeout Browser Activity File</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Choose a Google Takeout browser activity export file named <code>My Activity.html</code>. We will scan it for supported conversation history and import the results into a new workspace.
                </p>
              </div>

              <button
                onClick={() => void importFromGeminiTakeout()}
                disabled={importingGemini}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {importingGemini ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {importingGemini ? "Importing..." : "Import My Activity.html"}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FolderInput size={16} className="text-[var(--accent-color)]" />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Import from Claude Desktop</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Pick which files you want to import. Each file is independent — they can live in different folders. Conversations are linked back to their projects via <code>project_uuid</code>; chats whose project isn{"\u2019"}t included land in an <em>Unassigned Imports</em> project you can drain later.
                </p>
              </div>
            </div>

            {/* ── File slots ───────────────────────────────────────── */}
            <div className="mt-4 flex flex-col gap-3">
              {[
                {
                  key: "conversations",
                  label: "conversations.json",
                  description: "Chats with messages.",
                  enabled: claudeIncludeConversations,
                  setEnabled: setClaudeIncludeConversations,
                  path: claudeConversationsPath,
                  setPath: setClaudeConversationsPath,
                },
                {
                  key: "projects",
                  label: "projects.json",
                  description: "Project shells: name, description, custom instructions.",
                  enabled: claudeIncludeProjects,
                  setEnabled: setClaudeIncludeProjects,
                  path: claudeProjectsPath,
                  setPath: setClaudeProjectsPath,
                },
                {
                  key: "memories",
                  label: "memories.json",
                  description: "Workspace memory and per-project memories.",
                  enabled: claudeIncludeMemories,
                  setEnabled: setClaudeIncludeMemories,
                  path: claudeMemoriesPath,
                  setPath: setClaudeMemoriesPath,
                },
              ].map((slot) => (
                <div
                  key={slot.key}
                  className="flex flex-col gap-2 rounded-lg border border-[var(--border-color)] p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={slot.enabled}
                      onChange={(e) => {
                        slot.setEnabled(e.target.checked);
                        if (!e.target.checked) {
                          slot.setPath(null);
                          setSlotWarnings((prev) => ({ ...prev, [slot.key]: null }));
                          setClaudePreviews([]);
                          setClaudeProjects([]);
                          setClaudeMemories(null);
                        }
                      }}
                      className="mt-0.5"
                      disabled={importingClaude || claudeScanning}
                    />
                    <div>
                      <div className="text-xs font-medium text-[var(--text-primary)]">{slot.label}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">{slot.description}</div>
                    </div>
                  </label>
                  {slot.enabled && (
                    <div className="flex items-center gap-2">
                      {slotWarnings[slot.key] && (
                        <span className="text-[11px] text-yellow-400 whitespace-nowrap">
                          ⚠ {slotWarnings[slot.key]}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void pickClaudeFile(slot.key, slot.label, slot.setPath)}
                        disabled={importingClaude || claudeScanning}
                        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                      >
                        <FolderInput size={12} />
                        {slot.path ? "Change" : "Choose"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => void scanClaudeFiles()}
                disabled={
                  claudeScanning
                  || importingClaude
                  || (!(claudeIncludeConversations && claudeConversationsPath)
                      && !(claudeIncludeProjects && claudeProjectsPath)
                      && !(claudeIncludeMemories && claudeMemoriesPath))
                }
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {claudeScanning ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {claudeScanning ? "Scanning..." : "Scan files"}
              </button>
            </div>

            {/* ── Conversations preview ─────────────────────────── */}
            {claudePreviews.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
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
                <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--border-color)]">
                  {claudePreviews.map((conv) => {
                    const checked = claudeSelected.has(conv.uuid);
                    const orphan =
                      conv.project_uuid != null
                      && (!claudeIncludeProjects
                          || !claudeProjects.some(
                              (p) => p.uuid === conv.project_uuid && claudeSelectedProjects.has(p.uuid),
                          ));
                    return (
                      <label
                        key={conv.uuid}
                        className="flex cursor-pointer items-start gap-2 border-b border-[var(--border-color)] px-3 py-2 last:border-b-0 hover:bg-[var(--bg-hover)]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setClaudeSelected((prev) => {
                              const next = new Set(prev);
                              if (checked) { next.delete(conv.uuid); } else { next.add(conv.uuid); }
                              return next;
                            });
                          }}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs text-[var(--text-primary)]">{conv.name}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">
                            {conv.message_count} msg{conv.message_count === 1 ? "" : "s"}
                            {orphan && (
                              <span className="ml-2 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                                will land in Unassigned Imports
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Projects preview ──────────────────────────────── */}
            {claudeProjects.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
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
                <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--border-color)]">
                  {claudeProjects.map((proj) => {
                    const checked = claudeSelectedProjects.has(proj.uuid);
                    return (
                      <label
                        key={proj.uuid}
                        className="flex cursor-pointer items-start gap-2 border-b border-[var(--border-color)] px-3 py-2 last:border-b-0 hover:bg-[var(--bg-hover)]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setClaudeSelectedProjects((prev) => {
                              const next = new Set(prev);
                              if (checked) { next.delete(proj.uuid); } else { next.add(proj.uuid); }
                              return next;
                            });
                          }}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs text-[var(--text-primary)]">{proj.name}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">
                            {proj.has_prompt ? "Has instructions" : "No instructions"}
                            {proj.doc_count > 0 ? ` · ${proj.doc_count} doc${proj.doc_count === 1 ? "" : "s"}` : ""}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Memories notice ───────────────────────────────── */}
            {claudeMemories
              && (claudeMemories.conversations_memory || claudeMemories.project_memories.length > 0) && (
              <div className="mt-4 rounded-lg border border-[var(--border-color)] p-3">
                <div className="text-xs font-medium text-[var(--text-primary)]">Memories detected</div>
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                  {claudeMemories.conversations_memory ? "Workspace memory" : ""}
                  {claudeMemories.conversations_memory && claudeMemories.project_memories.length > 0 ? " + " : ""}
                  {claudeMemories.project_memories.length > 0
                    ? `${claudeMemories.project_memories.length} project memor${claudeMemories.project_memories.length !== 1 ? "ies" : "y"}`
                    : ""}
                </div>
              </div>
            )}

            {(claudePreviews.length > 0 || claudeProjects.length > 0 || claudeMemories) && (
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setClaudeConversationsPath(null);
                    setClaudeProjectsPath(null);
                    setClaudeMemoriesPath(null);
                    setClaudePreviews([]);
                    setClaudeProjects([]);
                    setClaudeMemories(null);
                    setClaudeSelected(new Set());
                    setClaudeSelectedProjects(new Set());
                  }}
                  disabled={importingClaude}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                >
                  <X size={12} />
                  Clear
                </button>
                <button
                  onClick={() => void importClaudeFiles()}
                  disabled={
                    importingClaude
                    || (
                      !(claudeIncludeConversations && claudeSelected.size > 0)
                      && !(claudeIncludeProjects && claudeSelectedProjects.size > 0)
                      && !(claudeIncludeMemories && claudeMemories != null)
                    )
                  }
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                >
                  {importingClaude ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                  {importingClaude ? "Importing..." : "Import"}
                </button>
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
