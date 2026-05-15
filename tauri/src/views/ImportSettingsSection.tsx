/**
 * ImportSettingsSection — external conversation imports.
 */
import { useCallback, useRef, useState } from "react";
import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { Check, CheckSquare, ChevronDown, ChevronRight, FolderInput, RefreshCw, Square, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import PromptDialog from "../components/PromptDialog";

type ProjectDestType = "new-workspace" | "new-sub-workspace" | "folder-in-sub";

interface ProjectDestination {
  type: ProjectDestType;
  parentId: string | null;       // for new-sub-workspace
  subWorkspaceId: string | null; // for folder-in-sub
  name: string;
}

interface ClaudeProjectPreview {
  uuid: string;
  name: string;
  description: string;
  has_prompt: boolean;
  doc_count: number;
  conversation_count: number;
  has_memory: boolean;
}

interface ClaudeConvPreview {
  uuid: string;
  name: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  project_uuid: string | null;
}

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
    setActiveFolderId,
    setActiveWorkspaceId,
    setFoldersForWorkspace,
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
      folder_id: string | null;
      folder_name: string | null;
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
  const [lmStudioSelectedFolders, setLmStudioSelectedProjects] = useState<Set<string>>(new Set());
  const [lmStudioScanning, setLmStudioScanning] = useState(false);
  const [lmStudioScanErrors, setLmStudioScanErrors] = useState(0);
  const [importingMultipleFolders, setImportingMultipleFolders] = useState(false);
  const [importingGemini, setImportingGemini] = useState(false);
  const [importingClaude, setImportingClaude] = useState(false);
  const [claudeScanning, setClaudeScanning] = useState(false);
  const [claudeIncludeConversations, setClaudeIncludeConversations] = useState(true);
  const [claudeIncludeProjects, setClaudeIncludeProjects] = useState(true);
  const [claudeIncludeMemories, setClaudeIncludeMemories] = useState(true);
  const [claudeFolderPath, setClaudeFolderPath] = useState<string | null>(null);
  const [claudeDetectedFormat, setClaudeDetectedFormat] = useState<"legacy" | "v2" | null>(null);
  const [claudeFilesFound, setClaudeFilesFound] = useState<{ conversations: boolean; projects: boolean; memories: boolean } | null>(null);
  const [claudeProjects, setClaudeProjects] = useState<ClaudeProjectPreview[]>([]);
  const [claudeConvsByProject, setClaudeConvsByProject] = useState<Record<string, ClaudeConvPreview[]>>({});
  const [claudeOrphans, setClaudeOrphans] = useState<ClaudeConvPreview[]>([]);
  const [claudeSelected, setClaudeSelected] = useState<Set<string>>(new Set()); // orphan conv UUIDs
  const [claudeSelectedFolders, setClaudeSelectedProjects] = useState<Set<string>>(new Set()); // project UUIDs
  const [projectDestinations, setProjectDestinations] = useState<Record<string, ProjectDestination>>({});
  const [projectMemoryEnabled, setProjectMemoryEnabled] = useState<Record<string, boolean>>({});
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [orphansExpanded, setOrphansExpanded] = useState(false);
  const [bulkDestType, setBulkDestType] = useState<ProjectDestType>("new-workspace");
  const [bulkParentId, setBulkParentId] = useState<string | null>(null);
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
      setLmStudioProjects(result.folders);
      setLmStudioSelected(new Set(result.conversations.map((conversation) => conversation.uuid)));
      setLmStudioSelectedProjects(new Set(result.folders.map((project) => project.uuid)));
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
          && (!conversation.folder_id || lmStudioSelectedFolders.has(conversation.folder_id))
        ))
        .map((conversation) => conversation.uuid);

      if (selectedConversationIds.length < 1) {
        throw new Error("Select at least one LM Studio conversation to import.");
      }

      // Derive workspace name from folder and check for conflicts
      const defaultName = lmStudioFolder.split(/[/\\]/).filter(Boolean).pop() ?? "Imported Chats";
      const resolvedName = await resolveWorkspaceNameConflict(defaultName, workspaces, promptForName);
      if (!resolvedName) {return;} // user cancelled

      const selectedFolderIds = [...lmStudioSelectedFolders];
      const result = await api.chatFile.importLmStudioFolder(
        lmStudioFolder,
        resolvedName !== defaultName ? resolvedName : undefined,
        selectedConversationIds,
        selectedFolderIds.length > 0 ? selectedFolderIds : undefined,
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
        api.folder.list(result.workspace_id),
        api.chat.listSessions(result.workspace_id, null, { limit: 1, offset: 0 }),
      ]);
      if (firstSession.length < 1) {
        throw new Error("LM Studio import reported success, but no chat sessions were found in the imported workspace.");
      }

      setWorkspaces(freshWorkspaces);
      setFoldersForWorkspace(result.workspace_id, importedProjects);
      setActiveWorkspaceId(result.workspace_id);
      setActiveFolderId(null);

      const lines = [
        `${result.imported} conversation${result.imported === 1 ? "" : "s"} imported.`,
        `${result.folders_created} project${result.folders_created === 1 ? "" : "s"} created.`,
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
        api.folder.list(result.workspace_id),
        api.chat.listSessions(result.workspace_id, null, { limit: 1, offset: 0 }),
      ]);

      setWorkspaces(freshWorkspaces);
      setFoldersForWorkspace(result.workspace_id, importedProjects);
      setActiveWorkspaceId(result.workspace_id);
      setActiveFolderId(null);

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

  function resetClaudePreview() {
    setClaudeProjects([]);
    setClaudeConvsByProject({});
    setClaudeOrphans([]);
    setClaudeSelected(new Set());
    setClaudeSelectedProjects(new Set());
    setProjectDestinations({});
    setProjectMemoryEnabled({});
    setExpandedProjects(new Set());
    setOrphansExpanded(false);
  }

  async function pickClaudeFolder() {
    setError(null);
    const selected = await open({ directory: true, multiple: false, title: "Select Claude export folder" });
    const folderPath = Array.isArray(selected) ? selected[0] : selected;
    if (!folderPath) { return; }

    try {
      const detected = await api.chatFile.detectClaudeFormat(folderPath);
      setClaudeFolderPath(folderPath);
      setClaudeDetectedFormat(detected.format);
      setClaudeFilesFound(detected.files_found);
      resetClaudePreview();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not detect Claude export format";
      setError(msg);
      setClaudeFolderPath(null);
      setClaudeDetectedFormat(null);
      setClaudeFilesFound(null);
    }
  }

  const scanClaudeFiles = useCallback(async () => {
    if (!claudeFolderPath) { return; }
    setError(null);
    setClaudeScanning(true);
    resetClaudePreview();

    try {
      const result = await api.chatFile.previewClaudeFiles({
        folderPath: claudeFolderPath,
        includeConversations: claudeIncludeConversations,
        includeProjects: claudeIncludeProjects,
        includeMemories: claudeIncludeMemories,
      });

      if (result.folders.length === 0 && result.orphan_count === 0) {
        throw new Error("No importable conversations found in the selected folder.");
      }

      setClaudeProjects(result.folders);
      setClaudeConvsByProject(result.conversations_by_project);
      setClaudeOrphans(result.orphan_conversations);

      // Initialize per-project state
      const selectedFolders = new Set<string>();
      const dests: Record<string, ProjectDestination> = {};
      const memEnabled: Record<string, boolean> = {};

      for (const proj of result.folders) {
        if (proj.conversation_count > 0) {
          selectedFolders.add(proj.uuid);
        }
        dests[proj.uuid] = { type: "new-workspace", parentId: null, subWorkspaceId: null, name: proj.name };
        memEnabled[proj.uuid] = proj.has_memory;
      }

      setClaudeSelectedProjects(selectedFolders);
      setClaudeSelected(new Set(result.orphan_conversations.map((c) => c.uuid)));
      setProjectDestinations(dests);
      setProjectMemoryEnabled(memEnabled);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Claude scan failed";
      setError(msg);
      await message(msg, { title: "Claude scan failed", kind: "error" });
    } finally {
      setClaudeScanning(false);
    }
  }, [claudeFolderPath, claudeIncludeConversations, claudeIncludeProjects, claudeIncludeMemories]);

  function applyBulkDestination() {
    setProjectDestinations((prev) => {
      const next = { ...prev };
      for (const uuid of claudeSelectedFolders) {
        const existing = next[uuid];
        if (existing) {
          next[uuid] = { ...existing, type: bulkDestType, parentId: bulkParentId, subWorkspaceId: null };
        }
      }
      return next;
    });
  }

  function destIsComplete(dest: ProjectDestination): boolean {
    if (dest.type === "new-workspace") { return dest.name.trim().length > 0; }
    if (dest.type === "new-sub-workspace") { return !!dest.parentId && dest.name.trim().length > 0; }
    return !!dest.subWorkspaceId && dest.name.trim().length > 0;
  }

  async function doClaudeImport() {
    if (!claudeFolderPath) { return; }
    setError(null);
    setImportingClaude(true);

    try {
      const folderMappings: Record<string, string> = {};
      const projectMemoryTargets: Record<string, string> = {};

      for (const projUuid of claudeSelectedFolders) {
        const dest = projectDestinations[projUuid];
        if (!dest) { continue; }

        let folderId: string;
        if (dest.type === "new-workspace") {
          const ws = await api.workspace.create(dest.name.trim());
          const folder = await api.folder.create(ws.id, dest.name.trim(), {});
          folderId = folder.id;
        } else if (dest.type === "new-sub-workspace") {
          if (!dest.parentId) { throw new Error(`Missing parent for project "${dest.name}"`); }
          const ws = await api.workspace.createChild(dest.parentId, dest.name.trim());
          const folder = await api.folder.create(ws.id, dest.name.trim(), {});
          folderId = folder.id;
        } else {
          if (!dest.subWorkspaceId) { throw new Error(`Missing sub-workspace for project "${dest.name}"`); }
          const folder = await api.folder.create(dest.subWorkspaceId, dest.name.trim(), {});
          folderId = folder.id;
        }
        folderMappings[projUuid] = folderId;
        if (projectMemoryEnabled[projUuid]) {
          projectMemoryTargets[projUuid] = folderId;
        }
      }

      // Orphan workspace
      let orphansFolderId: string | null = null;
      if (claudeOrphans.length > 0 && claudeSelected.size > 0) {
        const existing = workspaces.find((w) => w.name === "Unassigned Imports" && !w.parent_workspace_id);
        const ws = existing ?? await api.workspace.create("Unassigned Imports");
        const stamp = new Date().toISOString().slice(0, 10);
        const folder = await api.folder.create(ws.id, `Claude Import ${stamp}`, {});
        orphansFolderId = folder.id;
      }

      const freshWs = await api.workspace.list();
      setWorkspaces(freshWs);

      const result = await api.chatFile.importClaudeFiles({
        folderPath: claudeFolderPath,
        folderMappings,
        projectMemoryTargets,
        orphansFolderId,
        selectedConversationIds: claudeOrphans.length > 0 ? [...claudeSelected] : undefined,
        selectedProjectIds: [...claudeSelectedFolders],
      });

      const finalFreshWs = await api.workspace.list();
      setWorkspaces(finalFreshWs);

      // Try to navigate to the first imported session
      let firstSession = null;
      const firstFolderId = orphansFolderId ?? Object.values(folderMappings)[0];
      if (firstFolderId) {
        const wsId = finalFreshWs.find((w) => !w.parent_workspace_id)?.id;
        if (wsId) {
          const sessions = await api.chat.listSessions(wsId, firstFolderId, { limit: 1, offset: 0 });
          firstSession = sessions[0] ?? null;
        }
      }

      // Reset state
      setClaudeFolderPath(null);
      setClaudeDetectedFormat(null);
      setClaudeFilesFound(null);
      resetClaudePreview();

      const lines: string[] = [];
      if (result.imported > 0) {
        lines.push(`${result.imported} conversation${result.imported === 1 ? "" : "s"} imported.`);
      }
      if (result.memories_imported > 0) {
        lines.push(`${result.memories_imported} memor${result.memories_imported === 1 ? "y" : "ies"} imported.`);
      }
      if (result.errors > 0) {
        lines.push(`${result.errors} item${result.errors === 1 ? "" : "s"} had errors.`);
      }
      if (lines.length === 0) { lines.push("Nothing new was imported."); }

      if (firstSession) { navigate(`/chat/${firstSession.id}`); }

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
    && (!conversation.folder_id || lmStudioSelectedFolders.has(conversation.folder_id))
  )).length;

  const rootWorkspaces = workspaces.filter((w) => !w.parent_workspace_id);

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
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">LM Studio — Single Folder</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Select a folder containing <code>.conversation.json</code> files and choose which to import.
                </p>
              </div>

              <button
                onClick={() => void scanLmStudioFolder()}
                disabled={lmStudioScanning || importingLmStudio}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {lmStudioScanning ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {lmStudioScanning ? "Selecting..." : "Select Folder"}
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
                              {conversation.folder_name || "Workspace root"}
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
                        Projects ({lmStudioSelectedFolders.size}/{lmStudioProjects.length})
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
                        const checked = lmStudioSelectedFolders.has(project.uuid);
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
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">LM Studio — Multiple Folders</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Select several folders at once, each becoming its own workspace.
                </p>
              </div>

              <button
                onClick={() => void importFromMultipleFolders()}
                disabled={importingMultipleFolders}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {importingMultipleFolders ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {importingMultipleFolders ? "Importing..." : "Select Folders"}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FolderInput size={16} className="text-[var(--accent-color)]" />
                  <h2 className="text-sm font-medium text-[var(--text-primary)]">Google Takeout Browser History</h2>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Select a <code>My Activity.html</code> export to import supported conversation history.
                </p>
              </div>

              <button
                onClick={() => void importFromGeminiTakeout()}
                disabled={importingGemini}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {importingGemini ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                {importingGemini ? "Importing..." : "Select File"}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <FolderInput size={16} className="text-[var(--accent-color)]" />
                    <h2 className="text-sm font-medium text-[var(--text-primary)]">Claude Desktop Export</h2>
                  </div>
                  <p className="mt-2 text-xs text-[var(--text-muted)]">
                    Select your Claude export folder. Each project routes to its own workspace or sub-workspace.
                  </p>
                </div>
                <button
                  onClick={() => void pickClaudeFolder()}
                  disabled={claudeScanning || importingClaude}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                >
                  <FolderInput size={12} />
                  {claudeFolderPath ? "Change Folder" : "Select Folder"}
                </button>
              </div>

              {claudeFolderPath && claudeFilesFound && (
                <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] text-[var(--text-muted)] truncate max-w-[70%]">{claudeFolderPath}</div>
                    <span className="text-[11px] font-medium text-[var(--accent-color)]">
                      {claudeDetectedFormat === "v2" ? "v2 (2026+)" : "legacy"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {(["conversations", "projects", "memories"] as const).map((k) => (
                      <span key={k} className={`text-[11px] ${claudeFilesFound[k] ? "text-green-400" : "text-[var(--text-muted)] line-through"}`}>
                        {claudeFilesFound[k] ? "✓" : "✗"} {k}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-4 mt-1">
                    {([
                      { key: "conversations", label: "Conversations", enabled: claudeIncludeConversations, set: setClaudeIncludeConversations, available: claudeFilesFound.conversations },
                      { key: "projects", label: "Projects", enabled: claudeIncludeProjects, set: setClaudeIncludeProjects, available: claudeFilesFound.projects },
                      { key: "memories", label: "Memories", enabled: claudeIncludeMemories, set: setClaudeIncludeMemories, available: claudeFilesFound.memories },
                    ] as const).map((item) => (
                      <label key={item.key} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.enabled && item.available}
                          disabled={!item.available || claudeScanning || importingClaude}
                          onChange={(e) => item.set(e.target.checked)}
                          className="rounded"
                        />
                        <span className={`text-xs ${item.available ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>
                          {item.label}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-end mt-1">
                    <button
                      onClick={() => void scanClaudeFiles()}
                      disabled={claudeScanning || importingClaude || !claudeFolderPath}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                    >
                      {claudeScanning ? <RefreshCw size={12} className="animate-spin" /> : <FolderInput size={12} />}
                      {claudeScanning ? "Scanning..." : "Select"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Per-project rows ─────────────────────────────── */}
            {claudeProjects.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--text-primary)]">
                    Projects ({claudeSelectedFolders.size}/{claudeProjects.length})
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => setClaudeSelectedProjects(new Set(claudeProjects.map((p) => p.uuid)))} className="text-xs text-[var(--accent-color)] hover:underline">All</button>
                    <button onClick={() => setClaudeSelectedProjects(new Set())} className="text-xs text-[var(--text-muted)] hover:underline">None</button>
                  </div>
                </div>

                {/* Bulk action */}
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                  <span className="text-[11px] text-[var(--text-muted)]">Bulk:</span>
                  {([
                    { v: "new-workspace" as const, label: "New workspace" },
                    { v: "new-sub-workspace" as const, label: "New sub-workspace" },
                    { v: "folder-in-sub" as const, label: "Folder in sub-workspace" },
                  ]).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setBulkDestType(opt.v)}
                      className={`rounded-md border px-2.5 py-1 text-xs ${bulkDestType === opt.v ? "border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]" : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {(bulkDestType === "new-sub-workspace" || bulkDestType === "folder-in-sub") && (
                    <select
                      value={bulkParentId ?? ""}
                      onChange={(e) => setBulkParentId(e.target.value || null)}
                      className="rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-primary)]"
                    >
                      <option value="">Select workspace…</option>
                      {rootWorkspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  )}
                  <button
                    onClick={applyBulkDestination}
                    className="ml-auto rounded-md border border-[var(--border-color)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  >
                    Apply to selected
                  </button>
                </div>

                <div className="flex flex-col divide-y divide-[var(--border-color)] rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
                  {claudeProjects.map((proj) => {
                    const checked = claudeSelectedFolders.has(proj.uuid);
                    const dest = projectDestinations[proj.uuid];
                    const expanded = expandedProjects.has(proj.uuid);
                    const convs = claudeConvsByProject[proj.uuid] ?? [];
                    const subWsOptions = dest?.parentId
                      ? workspaces.filter((w) => w.parent_workspace_id === dest.parentId)
                      : [];

                    return (
                      <div key={proj.uuid} className="p-3">
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => setClaudeSelectedProjects((prev) => {
                              const next = new Set(prev);
                              if (checked) { next.delete(proj.uuid); } else { next.add(proj.uuid); }
                              return next;
                            })}
                            className="mt-0.5 shrink-0 text-[var(--accent-color)]"
                          >
                            {checked ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--text-muted)]" />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-medium text-[var(--text-primary)]">{proj.name}</span>
                              {proj.conversation_count === 0 && (
                                <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">no chats</span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--text-muted)]">
                              {proj.has_prompt ? "Has instructions" : "No instructions"}
                              {proj.doc_count > 0 ? ` · ${proj.doc_count} doc${proj.doc_count === 1 ? "" : "s"}` : ""}
                              {" · "}
                              {proj.conversation_count} chat{proj.conversation_count === 1 ? "" : "s"}
                            </div>
                          </div>
                        </div>

                        {checked && dest && (
                          <div className="mt-2 ml-6 flex flex-col gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              {([
                                { v: "new-workspace" as const, label: "New workspace" },
                                { v: "new-sub-workspace" as const, label: "New sub-workspace" },
                                { v: "folder-in-sub" as const, label: "Folder in sub-workspace" },
                              ]).map((opt) => (
                                <button
                                  key={opt.v}
                                  type="button"
                                  onClick={() => setProjectDestinations((prev) => ({ ...prev, [proj.uuid]: { ...dest, type: opt.v, subWorkspaceId: null } }))}
                                  className={`rounded-md border px-2 py-0.5 text-[11px] ${dest.type === opt.v ? "border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]" : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              {(dest.type === "new-sub-workspace" || dest.type === "folder-in-sub") && (
                                <select
                                  value={dest.parentId ?? ""}
                                  onChange={(e) => setProjectDestinations((prev) => ({ ...prev, [proj.uuid]: { ...dest, parentId: e.target.value || null, subWorkspaceId: null } }))}
                                  className="rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
                                >
                                  <option value="">Select workspace…</option>
                                  {rootWorkspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                              )}
                              {dest.type === "folder-in-sub" && (
                                <select
                                  value={dest.subWorkspaceId ?? ""}
                                  disabled={!dest.parentId}
                                  onChange={(e) => setProjectDestinations((prev) => ({ ...prev, [proj.uuid]: { ...dest, subWorkspaceId: e.target.value || null } }))}
                                  className="rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-primary)] disabled:opacity-40"
                                >
                                  <option value="">{dest.parentId ? (subWsOptions.length ? "Select sub-workspace…" : "No sub-workspaces yet") : "Pick workspace first"}</option>
                                  {subWsOptions.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                              )}
                              <div className="flex items-center gap-1">
                                <span className="text-[11px] text-[var(--text-muted)]">Name:</span>
                                <input
                                  type="text"
                                  value={dest.name}
                                  onChange={(e) => setProjectDestinations((prev) => ({ ...prev, [proj.uuid]: { ...dest, name: e.target.value } }))}
                                  className="rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-primary)] w-40"
                                />
                              </div>
                            </div>

                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!projectMemoryEnabled[proj.uuid]}
                                disabled={!proj.has_memory}
                                onChange={(e) => setProjectMemoryEnabled((prev) => ({ ...prev, [proj.uuid]: e.target.checked }))}
                                className="rounded"
                              />
                              <span className={`text-[11px] ${proj.has_memory ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>
                                Import project memory{!proj.has_memory ? " (none in export)" : ""}
                              </span>
                            </label>

                            {convs.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setExpandedProjects((prev) => {
                                  const next = new Set(prev);
                                  if (expanded) { next.delete(proj.uuid); } else { next.add(proj.uuid); }
                                  return next;
                                })}
                                className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                              >
                                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                {convs.length} conversation{convs.length === 1 ? "" : "s"}
                              </button>
                            )}

                            {expanded && convs.length > 0 && (
                              <div className="max-h-40 overflow-y-auto rounded-md border border-[var(--border-color)]">
                                {convs.map((conv) => (
                                  <div key={conv.uuid} className="border-b border-[var(--border-color)] px-3 py-1.5 last:border-b-0">
                                    <div className="truncate text-[11px] text-[var(--text-primary)]">{conv.name || "Untitled"}</div>
                                    <div className="text-[10px] text-[var(--text-muted)]">{conv.message_count} msg{conv.message_count === 1 ? "" : "s"}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Orphan conversations ──────────────────────────── */}
            {claudeOrphans.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--text-primary)]">
                    Unassigned ({claudeSelected.size}/{claudeOrphans.length})
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => setClaudeSelected(new Set(claudeOrphans.map((c) => c.uuid)))} className="text-xs text-[var(--accent-color)] hover:underline">All</button>
                    <button onClick={() => setClaudeSelected(new Set())} className="text-xs text-[var(--text-muted)] hover:underline">None</button>
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[var(--text-muted)]">→ &ldquo;Unassigned Imports&rdquo; workspace (auto-created)</span>
                    <button
                      type="button"
                      onClick={() => setOrphansExpanded((p) => !p)}
                      className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    >
                      {orphansExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {claudeOrphans.length} conversation{claudeOrphans.length === 1 ? "" : "s"}
                    </button>
                  </div>
                  {orphansExpanded && (
                    <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-[var(--border-color)]">
                      {claudeOrphans.map((conv) => {
                        const checked = claudeSelected.has(conv.uuid);
                        return (
                          <label key={conv.uuid} className="flex cursor-pointer items-center gap-2 border-b border-[var(--border-color)] px-3 py-1.5 last:border-b-0 hover:bg-[var(--bg-hover)]">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setClaudeSelected((prev) => {
                                const next = new Set(prev);
                                if (checked) { next.delete(conv.uuid); } else { next.add(conv.uuid); }
                                return next;
                              })}
                            />
                            <span className="truncate text-[11px] text-[var(--text-primary)]">{conv.name || "Untitled"}</span>
                            <span className="ml-auto shrink-0 text-[10px] text-[var(--text-muted)]">{conv.message_count} msg{conv.message_count === 1 ? "" : "s"}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Action row ───────────────────────────────────── */}
            {(claudeProjects.length > 0 || claudeOrphans.length > 0) && (
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setClaudeFolderPath(null);
                    setClaudeDetectedFormat(null);
                    setClaudeFilesFound(null);
                    resetClaudePreview();
                  }}
                  disabled={importingClaude}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                >
                  <X size={12} /> Clear
                </button>
                <button
                  onClick={() => void doClaudeImport()}
                  disabled={
                    importingClaude
                    || (claudeSelectedFolders.size === 0 && claudeSelected.size === 0)
                    || [...claudeSelectedFolders].some((uuid) => {
                      const d = projectDestinations[uuid];
                      return !d || !destIsComplete(d);
                    })
                  }
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
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
