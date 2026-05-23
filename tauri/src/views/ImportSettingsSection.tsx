/**
 * ImportSettingsSection — external conversation imports.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { Check, CheckSquare, ChevronDown, ChevronRight, FolderInput, Info, RefreshCw, Square, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import PromptDialog from "../components/PromptDialog";
import Tooltip from "../components/Tooltip";

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
  prompt_template?: string;
}

interface ClaudeConvPreview {
  uuid: string;
  name: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  project_uuid: string | null;
  first_user_message?: string;
  messages?: { role: string; content: string }[];
}

interface ChatSuggestion {
  conversation_uuid: string;
  project_uuid: string | null;
  score: number;
  reason: "title" | "keywords" | "embedding" | "none";
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
  const [importingGemini, setImportingGemini] = useState(false);
  const [importingClaude, setImportingClaude] = useState(false);
  const [claudeScanning, setClaudeScanning] = useState(false);
  const [claudeEmbeddingMatching, setClaudeEmbeddingMatching] = useState(false);
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
  const [projectInstructionsEnabled, setProjectInstructionsEnabled] = useState<Record<string, boolean>>({});
  const [expandedMemories, setExpandedMemories] = useState<Set<string>>(new Set());
  const [expandedInstructions, setExpandedInstructions] = useState<Set<string>>(new Set());
  const [focusedConvUuid, setFocusedConvUuid] = useState<string | null>(null);
  const [orphansExpanded, setOrphansExpanded] = useState(false);
  const [claudeSuggestions, setClaudeSuggestions] = useState<ChatSuggestion[]>([]);
  const [claudeMemoriesByProject, setClaudeMemoriesByProject] = useState<Record<string, string>>({});
  // chat_uuid → project_uuid (or null = unassigned). Initialised from server suggestions on scan.
  const [chatAssignments, setChatAssignments] = useState<Record<string, string | null>>({});
  // Focused project for the master/detail split view.
  const [focusedProjectUuid, setFocusedProjectUuid] = useState<string | null>(null);
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

  async function pickLmStudioFolders() {
    setError(null);
    setLmStudioScanning(true);
    resetLmStudioPreview();

    try {
      const selected = await open({
        directory: true,
        multiple: true,
        title: "Select LM Studio conversations folder(s)",
      });
      const folderPaths = Array.isArray(selected) ? selected : (selected ? [selected] : []);
      if (folderPaths.length === 0) { return; }

      if (folderPaths.length === 1) {
        // Single folder → preview + checkbox flow
        const folderPath = folderPaths[0];
        const result = await api.chatFile.previewLmStudioFolder(folderPath);
        if (result.total < 1) {
          throw new Error("No importable conversations were found in the selected folder.");
        }
        setLmStudioFolder(folderPath);
        setLmStudioPreviews(result.conversations);
        setLmStudioProjects(result.folders);
        setLmStudioSelected(new Set(result.conversations.map((c) => c.uuid)));
        setLmStudioSelectedProjects(new Set(result.folders.map((p) => p.uuid)));
        setLmStudioScanErrors(result.errors);
      } else {
        // Multiple folders → import directly, no preview
        setLmStudioScanning(false);
        setImportingLmStudio(true);
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
        if (result.total_skipped > 0) { lines.push(`${result.total_skipped} duplicate${result.total_skipped === 1 ? "" : "s"} skipped.`); }
        if (result.total_errors > 0) { lines.push(`${result.total_errors} file${result.total_errors === 1 ? "" : "s"} had errors.`); }
        await message(lines.join("\n"), { title: "Multi-folder import complete", kind: result.total_errors > 0 ? "warning" : "info" });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "LM Studio import failed";
      setError(msg);
      await message(msg, { title: "LM Studio import failed", kind: "error" });
    } finally {
      setLmStudioScanning(false);
      setImportingLmStudio(false);
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
    setProjectInstructionsEnabled({});
    setExpandedMemories(new Set());
    setOrphansExpanded(false);
    setClaudeSuggestions([]);
    setClaudeMemoriesByProject({});
    setChatAssignments({});
    setFocusedProjectUuid(null);
    setClaudeEmbeddingMatching(false);
  }

  async function pickClaudeFolder() {
    setError(null);
    const selected = await open({ directory: true, multiple: false, title: "Select Claude export folder" });
    const folderPath = Array.isArray(selected) ? selected[0] : selected;
    if (!folderPath) { return; }

    try {
      const detected = await api.chatFile.detectClaudeFormat(folderPath);
      resetClaudePreview();
      setClaudeFolderPath(folderPath);
      setClaudeDetectedFormat(detected.format);
      setClaudeFilesFound(detected.files_found);
      // Auto-scan kicks in via the useEffect watching [claudeFolderPath + include flags]
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
      setClaudeSuggestions(result.suggestions ?? []);
      setClaudeMemoriesByProject(result.memories_by_project ?? {});

      // Seed assignments from server suggestions (chat → suggested project_uuid).
      // Chats with no suggestion stay unassigned (null).
      const initialAssignments: Record<string, string | null> = {};
      const suggestionByChat = new Map<string, string | null>();
      for (const s of result.suggestions ?? []) {
        suggestionByChat.set(s.conversation_uuid, s.project_uuid);
      }
      for (const c of result.orphan_conversations) {
        initialAssignments[c.uuid] = suggestionByChat.get(c.uuid) ?? null;
      }
      setChatAssignments(initialAssignments);

      // Initialize per-project state.
      // Select a project for import if it has design_chats OR if any orphan is suggested to it.
      const suggestedProjects = new Set<string>();
      for (const v of suggestionByChat.values()) {
        if (v) {suggestedProjects.add(v);}
      }
      const selectedFolders = new Set<string>();
      const dests: Record<string, ProjectDestination> = {};
      const memEnabled: Record<string, boolean> = {};
      const instrEnabled: Record<string, boolean> = {};

      for (const proj of result.folders) {
        if (proj.conversation_count > 0 || suggestedProjects.has(proj.uuid)) {
          selectedFolders.add(proj.uuid);
        }
        dests[proj.uuid] = { type: "new-workspace", parentId: null, subWorkspaceId: null, name: proj.name };
        memEnabled[proj.uuid] = proj.has_memory;
        instrEnabled[proj.uuid] = proj.has_prompt;
      }

      setClaudeSelectedProjects(selectedFolders);
      // Default orphan "selected for import" = chats that ended up Unassigned (no suggestion).
      setClaudeSelected(new Set(
        result.orphan_conversations
          .filter((c) => !suggestionByChat.get(c.uuid))
          .map((c) => c.uuid),
      ));
      setProjectDestinations(dests);
      setProjectMemoryEnabled(memEnabled);
      setProjectInstructionsEnabled(instrEnabled);
      setFocusedProjectUuid(result.folders[0]?.uuid ?? null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Claude scan failed";
      setError(msg);
      await message(msg, { title: "Claude scan failed", kind: "error" });
    } finally {
      setClaudeScanning(false);
    }
  }, [claudeFolderPath, claudeIncludeConversations, claudeIncludeProjects, claudeIncludeMemories]);

  // Auto-scan whenever a folder is picked or the include toggles change.
  // Replaces the old manual "Select" / "Scan" button in the picker card.
  useEffect(() => {
    if (claudeFolderPath) {
      void scanClaudeFiles();
    }
  }, [claudeFolderPath, claudeIncludeConversations, claudeIncludeProjects, claudeIncludeMemories, scanClaudeFiles]);

  async function runEmbeddingMatch() {
    if (claudeOrphans.length === 0 || claudeProjects.length === 0) { return; }
    setError(null);
    setClaudeEmbeddingMatching(true);
    try {
      const unassigned = claudeOrphans.filter((c) => !chatAssignments[c.uuid]);
      const suggestions = await api.chatFile.matchClaudeWithEmbeddings({
        conversations: unassigned.map((c) => ({
          uuid: c.uuid,
          name: c.name,
          first_user_message: c.first_user_message ?? "",
        })),
        projects: claudeProjects.map((p) => ({
          uuid: p.uuid,
          name: p.name,
          prompt_template: p.prompt_template ?? "",
          description: p.description,
        })),
        memoriesByProject: claudeMemoriesByProject,
      });

      // Merge returned suggestions into chatAssignments and claudeSuggestions.
      const newAssignments = { ...chatAssignments };
      const newSuggestions = claudeSuggestions.filter(
        (s) => !suggestions.some((r) => r.conversation_uuid === s.conversation_uuid),
      );
      for (const s of suggestions) {
        newSuggestions.push({ ...s, reason: s.reason as ChatSuggestion["reason"] });
        if (s.project_uuid && !newAssignments[s.conversation_uuid]) {
          newAssignments[s.conversation_uuid] = s.project_uuid;
          setClaudeSelected((prev) => {
            const next = new Set(prev);
            next.delete(s.conversation_uuid);
            return next;
          });
        }
      }
      setChatAssignments(newAssignments);
      setClaudeSuggestions(newSuggestions);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Embedding match failed";
      setError(msg);
    } finally {
      setClaudeEmbeddingMatching(false);
    }
  }

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
      const folderMappings: Record<string, { workspace_id: string; folder_id: string }> = {};
      const projectMemoryTargets: Record<string, { workspace_id: string; folder_id: string }> = {};

      // Any project that has chats assigned to it must also have a folder created,
      // even if the user didn't explicitly tick its checkbox.
      const projectsToCreate = new Set(claudeSelectedFolders);
      for (const projUuid of Object.values(chatAssignments)) {
        if (projUuid) {projectsToCreate.add(projUuid);}
      }

      for (const projUuid of projectsToCreate) {
        const dest = projectDestinations[projUuid];
        if (!dest) { continue; }

        const proj = claudeProjects.find((p) => p.uuid === projUuid);
        const instrEnabled = projectInstructionsEnabled[projUuid] && proj?.has_prompt;
        const promptTemplate = instrEnabled ? (proj?.prompt_template ?? "") : "";

        let target: { workspace_id: string; folder_id: string };
        if (dest.type === "new-workspace") {
          const resolvedName = await resolveWorkspaceNameConflict(dest.name.trim(), workspaces, promptForName);
          if (!resolvedName) {
            setImportingClaude(false);
            return;
          }
          const existingWs = workspaces.find((w) => w.name.toLowerCase() === resolvedName.toLowerCase());
          const ws = existingWs ?? await api.workspace.create(resolvedName);
          if (promptTemplate) {
            await api.workspace.update(ws.id, ws.name, ws.description, promptTemplate);
          }
          // For a new workspace, we just put chats in the workspace directly, no folder!
          target = { workspace_id: ws.id, folder_id: "" };
        } else if (dest.type === "new-sub-workspace") {
          if (!dest.parentId) { throw new Error(`Missing parent for project "${dest.name}"`); }
          const ws = await api.workspace.createChild(dest.parentId, dest.name.trim());
          if (promptTemplate) {
            await api.workspace.update(ws.id, ws.name, ws.description, promptTemplate);
          }
          // Similar to new-workspace, for new child workspace, we just put chats in it directly.
          target = { workspace_id: ws.id, folder_id: "" };
        } else {
          if (!dest.subWorkspaceId) { throw new Error(`Missing sub-workspace for project "${dest.name}"`); }
          const folder = await api.folder.create(dest.subWorkspaceId, dest.name.trim(), {
            ...(promptTemplate ? { custom_instructions: promptTemplate } : {}),
          });
          target = { workspace_id: dest.subWorkspaceId, folder_id: folder.id };
        }
        folderMappings[projUuid] = target;
        if (projectMemoryEnabled[projUuid]) {
          projectMemoryTargets[projUuid] = target;
        }
      }

      // Build the override map: only chats whose assignment maps to a project
      // that's actually being imported (folderMappings has an entry for it).
      const chatProjectOverrides: Record<string, string> = {};
      const assignedConversationIds: string[] = [];
      for (const [chatId, projUuid] of Object.entries(chatAssignments)) {
        if (projUuid && folderMappings[projUuid]) {
          chatProjectOverrides[chatId] = projUuid;
          assignedConversationIds.push(chatId);
        }
      }

      // Conversations to send to the backend = explicitly-unassigned chats the
      // user ticked + assigned chats. (If a chat is assigned but the project
      // wasn't selected for import, it falls into Unassigned via the tick state.)
      const conversationIdsToImport = new Set<string>([
        ...assignedConversationIds,
        ...claudeSelected,
      ]);

      // Orphan workspace — only created if any unassigned chats remain.
      const unassignedCount = [...claudeSelected].filter(
        (id) => !chatProjectOverrides[id],
      ).length;
      let orphansDestination: { workspace_id: string; folder_id: string } | null = null;
      if (unassignedCount > 0) {
        const existing = workspaces.find((w) => w.name === "Unassigned Imports" && !w.parent_workspace_id);
        const ws = existing ?? await api.workspace.create("Unassigned Imports");
        const stamp = new Date().toISOString().slice(0, 10);
        const folder = await api.folder.create(ws.id, `Claude Import ${stamp}`, {});
        orphansDestination = { workspace_id: ws.id, folder_id: folder.id };
      }

      const freshWs = await api.workspace.list();
      setWorkspaces(freshWs);

      const result = await api.chatFile.importClaudeFiles({
        folderPath: claudeFolderPath,
        folderMappings,
        projectMemoryTargets,
        orphansDestination,
        selectedConversationIds: conversationIdsToImport.size > 0 ? [...conversationIdsToImport] : undefined,
        selectedProjectIds: [...claudeSelectedFolders],
        chatProjectOverrides: Object.keys(chatProjectOverrides).length > 0 ? chatProjectOverrides : undefined,
      });

      const finalFreshWs = await api.workspace.list();
      setWorkspaces(finalFreshWs);

      // Try to navigate to the first imported session.
      // Prefer orphans destination; fall back to first project mapping.
      let firstSession = null;
      const firstTarget = orphansDestination ?? Object.values(folderMappings)[0] ?? null;
      if (firstTarget) {
        const sessions = await api.chat.listSessions(firstTarget.workspace_id, firstTarget.folder_id || null, { limit: 1, offset: 0 });
        firstSession = sessions[0] ?? null;
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

      <div className="flex-1 flex flex-col overflow-hidden px-5 py-4 gap-3">
        {error && (
          <div className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* ── Import type cards ─────────────────────────────────────── */}
        <div className="shrink-0 grid grid-cols-3 gap-3">
          {/* LM Studio (single + multiple merged) */}
          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <FolderInput size={15} className="shrink-0 text-[var(--accent-color)]" />
                <h2 className="text-xs font-medium text-[var(--text-primary)] truncate">LM Studio</h2>
              </div>
              <button
                onClick={() => void pickLmStudioFolders()}
                disabled={lmStudioScanning || importingLmStudio}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {lmStudioScanning || importingLmStudio ? <RefreshCw size={11} className="animate-spin" /> : <FolderInput size={11} />}
                {lmStudioScanning ? "Scanning…" : importingLmStudio ? "Importing…" : "Select"}
              </button>
            </div>

          </section>

          {/* Google Takeout */}
          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <FolderInput size={15} className="shrink-0 text-[var(--accent-color)]" />
                <h2 className="text-xs font-medium text-[var(--text-primary)] truncate">Google Takeout</h2>
              </div>
              <button
                onClick={() => void importFromGeminiTakeout()}
                disabled={importingGemini}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {importingGemini ? <RefreshCw size={11} className="animate-spin" /> : <FolderInput size={11} />}
                {importingGemini ? "Importing…" : "Select File"}
              </button>
            </div>
          </section>

          {/* Claude Desktop Export */}
          <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <FolderInput size={15} className="shrink-0 text-[var(--accent-color)]" />
                <h2 className="text-xs font-medium text-[var(--text-primary)] truncate">Claude Desktop Export</h2>
                <Tooltip content="Conversations, projects, and memories are imported. Documents and files attached to projects are not supported." position="right">
                  <Info size={12} className="shrink-0 text-[var(--text-muted)] cursor-default" />
                </Tooltip>
              </div>
              <button
                onClick={() => void pickClaudeFolder()}
                disabled={claudeScanning || importingClaude}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                <FolderInput size={11} />
                {claudeFolderPath ? "Change" : "Select"}
              </button>
            </div>
          </section>
        </div>{/* end grid */}

        {/* ── LM Studio preview (below grid, only when a single folder was scanned) ── */}
        {lmStudioPreviews.length > 0 && (
          <section className="shrink-0 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3">
            <div className="flex flex-col gap-4">
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
          </section>
        )}

        {/* ── Claude Desktop detail (below grid, flex-fill) ──────────────────── */}
        {claudeFolderPath && claudeFilesFound && (
          <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
            {/* Folder info + toggles */}
            <div className="shrink-0 flex flex-col gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-[var(--text-muted)] truncate max-w-[70%]">{claudeFolderPath}</div>
                <div className="flex items-center gap-2">
                  {claudeScanning && <RefreshCw size={12} className="animate-spin text-[var(--text-muted)]" />}
                  <span className="text-[11px] font-medium text-[var(--accent-color)]">
                    {claudeDetectedFormat === "v2" ? "v2 (2026+)" : "legacy"}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {(["conversations", "projects", "memories"] as const).map((k) => (
                  <span key={k} className={`text-[11px] ${claudeFilesFound[k] ? "text-green-400" : "text-[var(--text-muted)] line-through"}`}>
                    {claudeFilesFound[k] ? "✓" : "✗"} {k}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-4">
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
            </div>

            {/* ── Per-project rows ─────────────────────────────── */}
            {claudeProjects.length > 0 && (
              <div className="shrink-0 flex flex-col gap-2">
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

                {/* Master / detail / preview split */}
                <div className="flex-1 min-h-0 flex flex-row gap-3 items-stretch">
                  {/* ── Master: project list ───────────────────────── */}
                  <div className="flex-1 min-h-0 min-w-0 flex flex-col divide-y divide-[var(--border-color)] overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] w-[28%] max-w-[28%]">
                    {claudeProjects.map((proj) => {
                      const checked = claudeSelectedFolders.has(proj.uuid);
                      const assignedCount = Object.values(chatAssignments).filter((p) => p === proj.uuid).length;
                      const totalChats = proj.conversation_count + assignedCount;
                      const isFocused = focusedProjectUuid === proj.uuid;
                      return (
                        <button
                          key={proj.uuid}
                          type="button"
                          onClick={() => setFocusedProjectUuid(proj.uuid)}
                          className={`flex items-start gap-2 p-3 text-left transition-colors ${isFocused ? "bg-[var(--accent-color)]/10" : "hover:bg-[var(--bg-hover)]"}`}
                        >
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setClaudeSelectedProjects((prev) => {
                                const next = new Set(prev);
                                if (checked) { next.delete(proj.uuid); } else { next.add(proj.uuid); }
                                return next;
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === " " || e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                                setClaudeSelectedProjects((prev) => {
                                  const next = new Set(prev);
                                  if (checked) { next.delete(proj.uuid); } else { next.add(proj.uuid); }
                                  return next;
                                });
                              }
                            }}
                            className="mt-0.5 shrink-0 text-[var(--accent-color)] cursor-pointer"
                          >
                            {checked ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--text-muted)]" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-medium text-[var(--text-primary)]">{proj.name}</span>
                              {totalChats === 0 && (
                                <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">no chats</span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--text-muted)]">
                              {totalChats} chat{totalChats === 1 ? "" : "s"}
                              {assignedCount > 0 && ` (+${assignedCount} assigned)`}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* ── Detail: focused project ────────────────────── */}
                  <div className="flex-1 min-h-0 min-w-0 flex flex-col gap-2 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 w-[36%] max-w-[36%]">
                    {(() => {
                      const proj = claudeProjects.find((p) => p.uuid === focusedProjectUuid);
                      if (!proj) {
                        return <div className="m-auto text-[11px] text-[var(--text-muted)]">Select a project on the left.</div>;
                      }
                      const checked = claudeSelectedFolders.has(proj.uuid);
                      const dest = projectDestinations[proj.uuid];
                      const memoryExpanded = expandedMemories.has(proj.uuid);
                      const memoryText = claudeMemoriesByProject[proj.uuid] ?? "";
                      const subWsOptions = dest?.parentId
                        ? workspaces.filter((w) => w.parent_workspace_id === dest.parentId)
                        : [];
                      const nativeConvs = claudeConvsByProject[proj.uuid] ?? [];
                      const assignedConvs = claudeOrphans.filter((c) => chatAssignments[c.uuid] === proj.uuid);
                      const unassignedSuggestedConvs = claudeOrphans.filter(
                        (c) => chatAssignments[c.uuid] === null &&
                          claudeSuggestions.find((s) => s.conversation_uuid === c.uuid)?.project_uuid === proj.uuid,
                      );
                      const allProjectConvs = [
                        ...nativeConvs.map((c) => ({ ...c, _origin: "native" as const })),
                        ...assignedConvs.map((c) => ({ ...c, _origin: "assigned" as const })),
                        ...unassignedSuggestedConvs.map((c) => ({ ...c, _origin: "unassigned" as const })),
                      ];
                      return (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-[var(--text-primary)]">{proj.name}</div>
                              {proj.description && (
                                <div className="mt-1 text-[11px] text-[var(--text-muted)] line-clamp-3">{proj.description}</div>
                              )}
                            </div>
                          </div>

                          {!checked && (
                            <div className="rounded-md border border-dashed border-[var(--border-color)] p-2 text-[11px] text-[var(--text-muted)]">
                              Not selected for import — tick the checkbox on the left to configure a destination. Conversations and memory are still shown below.
                            </div>
                          )}

                          {dest && (
                            <div className={`flex flex-col gap-2 ${checked ? "" : "opacity-50 pointer-events-none"}`}>
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

                              {projectMemoryEnabled[proj.uuid] && memoryText && (
                                <div className="flex flex-col gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedMemories((prev) => {
                                      const next = new Set(prev);
                                      if (memoryExpanded) { next.delete(proj.uuid); } else { next.add(proj.uuid); }
                                      return next;
                                    })}
                                    className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                                  >
                                    {memoryExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                    Memory preview ({memoryText.length} char{memoryText.length === 1 ? "" : "s"})
                                  </button>
                                  {memoryExpanded && (
                                    <pre className="whitespace-pre-wrap rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-[11px] text-[var(--text-secondary)] max-h-40 overflow-y-auto">
                                      {memoryText}
                                    </pre>
                                  )}
                                </div>
                              )}

                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!projectInstructionsEnabled[proj.uuid]}
                                  disabled={!proj.has_prompt}
                                  onChange={(e) => setProjectInstructionsEnabled((prev) => ({ ...prev, [proj.uuid]: e.target.checked }))}
                                  className="rounded"
                                />
                                <span className={`text-[11px] ${proj.has_prompt ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>
                                  Import project instructions{!proj.has_prompt ? " (none in export)" : ""}
                                </span>
                              </label>

                              {projectInstructionsEnabled[proj.uuid] && proj.prompt_template && (() => {
                                const instrExpanded = expandedInstructions.has(proj.uuid);
                                return (
                                  <div className="flex flex-col gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setExpandedInstructions((prev) => {
                                        const next = new Set(prev);
                                        if (instrExpanded) { next.delete(proj.uuid); } else { next.add(proj.uuid); }
                                        return next;
                                      })}
                                      className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                                    >
                                      {instrExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                      Instructions preview ({proj.prompt_template.length} char{proj.prompt_template.length === 1 ? "" : "s"})
                                    </button>
                                    {instrExpanded && (
                                      <pre className="whitespace-pre-wrap rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-[11px] text-[var(--text-secondary)] max-h-40 overflow-y-auto">
                                        {proj.prompt_template}
                                      </pre>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {/* Conversations belonging to this project (native + assigned). */}
                          <div className="mt-2 flex flex-col gap-1">
                            <div className="text-[11px] font-medium text-[var(--text-primary)]">
                              Conversations ({allProjectConvs.length})
                            </div>
                            {allProjectConvs.length === 0 ? (
                              <div className="text-[11px] text-[var(--text-muted)]">
                                No conversations linked to this project. Use the &ldquo;Unassigned&rdquo; panel below to assign chats here.
                              </div>
                            ) : (
                              <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-[var(--border-color)]">
                                {allProjectConvs.map((conv) => (
                                  <div key={conv.uuid} onClick={() => setFocusedConvUuid(conv.uuid)} className={`flex cursor-pointer items-center gap-2 border-b border-[var(--border-color)] px-3 py-1.5 last:border-b-0 ${focusedConvUuid === conv.uuid ? "bg-[var(--accent-color)]/10" : "hover:bg-[var(--bg-hover)]"}`}>
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-[11px] text-[var(--text-primary)]">{conv.name || "Untitled"}</div>
                                      <div className="text-[10px] text-[var(--text-muted)]">{conv.message_count} msg{conv.message_count === 1 ? "" : "s"}</div>
                                    </div>
                                    {conv._origin === "native" ? (
                                      <span className="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">native</span>
                                    ) : (
                                      <input
                                        type="checkbox"
                                        checked={conv._origin === "assigned"}
                                        className="shrink-0 rounded cursor-pointer"
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setChatAssignments((prev) => ({ ...prev, [conv.uuid]: proj.uuid }));
                                            setClaudeSelected((prev) => {
                                              const next = new Set(prev);
                                              next.delete(conv.uuid);
                                              return next;
                                            });
                                          } else {
                                            setChatAssignments((prev) => ({ ...prev, [conv.uuid]: null }));
                                            setClaudeSelected((prev) => {
                                              const next = new Set(prev);
                                              next.add(conv.uuid);
                                              return next;
                                            });
                                          }
                                        }}
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* ── Preview: focused conversation ──────────────── */}
                  <div className="flex-1 min-h-0 min-w-0 flex flex-col gap-2 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 w-[36%] max-w-[36%]">
                    {(() => {
                      if (!focusedConvUuid) {
                        return <div className="m-auto text-[11px] text-[var(--text-muted)]">Select a conversation to preview.</div>;
                      }
                      const allConvs = [
                        ...Object.values(claudeConvsByProject).flat(),
                        ...claudeOrphans,
                      ];
                      const conv = allConvs.find((c) => c.uuid === focusedConvUuid);
                      if (!conv) {
                        return <div className="m-auto text-[11px] text-[var(--text-muted)]">Conversation not found.</div>;
                      }
                      return (
                        <>
                          <div className="text-sm font-medium text-[var(--text-primary)] truncate">{conv.name || "Untitled"}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">
                            {conv.message_count} message{conv.message_count === 1 ? "" : "s"}
                            {conv.updated_at && ` · ${new Date(conv.updated_at).toLocaleDateString()}`}
                          </div>
                          {conv.messages && conv.messages.length > 0 ? (
                            <div className="mt-1 flex-1 min-h-0 overflow-y-auto rounded-md border border-[var(--border-color)]">
                              {conv.messages.map((msg, i) => (
                                <div key={i} className={`flex flex-col gap-0.5 border-b border-[var(--border-color)] px-3 py-2 last:border-b-0 ${msg.role === "user" ? "bg-[var(--bg-elevated)]" : "bg-[var(--bg-primary)]"}`}>
                                  <span className="text-[10px] font-medium text-[var(--text-muted)]">{msg.role === "user" ? "You" : "Claude"}</span>
                                  <p className="whitespace-pre-wrap text-[11px] text-[var(--text-secondary)]">{msg.content}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-1 text-[11px] text-[var(--text-muted)]">No message preview available.</div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* ── Conversation assignment table ─────────────────── */}
            {claudeOrphans.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                {(() => {
                  const assignedTotal = Object.values(chatAssignments).filter((p) => !!p).length;
                  const unassignedTotal = claudeOrphans.length - assignedTotal;
                  const suggestedTotal = claudeSuggestions.filter(
                    (s) => s.project_uuid && chatAssignments[s.conversation_uuid] !== s.project_uuid,
                  ).length;
                  const projectsByUuid = new Map(claudeProjects.map((p) => [p.uuid, p] as const));
                  // The right-hand detail pane already shows assigned chats under their project.
                  // This panel lists only the *unassigned* remainder so the user can either
                  // accept a suggestion or pick a project from the dropdown.
                  const unassignedConvs = claudeOrphans.filter((c) => !chatAssignments[c.uuid]);
                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[var(--text-primary)]">
                          Unassigned conversations ({unassignedTotal} of {claudeOrphans.length} · {assignedTotal} already routed to projects)
                        </span>
                        <div className="flex gap-2">
                          {claudeOrphans.length >= 50 && unassignedTotal > 0 && (
                            <button
                              type="button"
                              onClick={() => void runEmbeddingMatch()}
                              disabled={claudeEmbeddingMatching || claudeScanning}
                              className="inline-flex items-center gap-1 text-xs text-[var(--accent-color)] hover:underline disabled:opacity-40 disabled:no-underline"
                            >
                              {claudeEmbeddingMatching ? <RefreshCw size={11} className="animate-spin" /> : null}
                              {claudeEmbeddingMatching ? "Matching…" : "Improve with AI matching"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const next: Record<string, string | null> = { ...chatAssignments };
                              for (const s of claudeSuggestions) {
                                if (s.project_uuid) { next[s.conversation_uuid] = s.project_uuid; }
                              }
                              setChatAssignments(next);
                              // Drop newly-assigned chats from the unassigned-tick set.
                              setClaudeSelected((prev) => {
                                const out = new Set(prev);
                                for (const s of claudeSuggestions) {
                                  if (s.project_uuid) {out.delete(s.conversation_uuid);}
                                }
                                return out;
                              });
                            }}
                            disabled={suggestedTotal === 0}
                            className="text-xs text-[var(--accent-color)] hover:underline disabled:opacity-40 disabled:no-underline"
                          >
                            Accept {suggestedTotal} suggestion{suggestedTotal === 1 ? "" : "s"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const cleared: Record<string, string | null> = {};
                              for (const c of claudeOrphans) { cleared[c.uuid] = null; }
                              setChatAssignments(cleared);
                              setClaudeSelected(new Set(claudeOrphans.map((c) => c.uuid)));
                            }}
                            className="text-xs text-[var(--text-muted)] hover:underline"
                          >
                            Clear all
                          </button>
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-[var(--text-muted)]">
                            These chats had no confident project match. They go to &ldquo;Unassigned Imports&rdquo; unless you assign one here.
                          </span>
                          <button
                            type="button"
                            onClick={() => setOrphansExpanded((p) => !p)}
                            className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                          >
                            {orphansExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {unassignedConvs.length} conversation{unassignedConvs.length === 1 ? "" : "s"}
                          </button>
                        </div>
                        {orphansExpanded && unassignedConvs.length > 0 && (
                          <div className="mt-2 max-h-96 overflow-y-auto rounded-md border border-[var(--border-color)]">
                            {unassignedConvs.map((conv) => {
                              const assigned = chatAssignments[conv.uuid] ?? null;
                              const ticked = claudeSelected.has(conv.uuid);
                              const suggestion = claudeSuggestions.find((s) => s.conversation_uuid === conv.uuid);
                              const suggestedProj = suggestion?.project_uuid ? projectsByUuid.get(suggestion.project_uuid) : null;
                              return (
                                <div key={conv.uuid} className="flex items-center gap-2 border-b border-[var(--border-color)] px-3 py-1.5 last:border-b-0 hover:bg-[var(--bg-hover)]">
                                  <input
                                    type="checkbox"
                                    checked={assigned !== null || ticked}
                                    onChange={(e) => {
                                      if (assigned !== null) {
                                        // Uncheck = clear the assignment back to null
                                        setChatAssignments((prev) => ({ ...prev, [conv.uuid]: null }));
                                        setClaudeSelected((prev) => {
                                          const next = new Set(prev);
                                          if (e.target.checked) {next.add(conv.uuid);} else {next.delete(conv.uuid);}
                                          return next;
                                        });
                                      } else {
                                        setClaudeSelected((prev) => {
                                          const next = new Set(prev);
                                          if (e.target.checked) {next.add(conv.uuid);} else {next.delete(conv.uuid);}
                                          return next;
                                        });
                                      }
                                    }}
                                  />
                                  <div className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-[11px] text-[var(--text-primary)]">{conv.name || "Untitled"}</span>
                                    {suggestedProj && assigned !== suggestion?.project_uuid && (
                                      <span className="text-[10px] text-[var(--text-muted)]">
                                        suggested: {suggestedProj.name} ({suggestion?.reason})
                                      </span>
                                    )}
                                  </div>
                                  <select
                                    value={assigned ?? ""}
                                    onChange={(e) => {
                                      const v = e.target.value || null;
                                      setChatAssignments((prev) => ({ ...prev, [conv.uuid]: v }));
                                      // If assigned to a project, untick from the "import as unassigned" set.
                                      if (v) {
                                        setClaudeSelected((prev) => {
                                          const next = new Set(prev);
                                          next.delete(conv.uuid);
                                          return next;
                                        });
                                      }
                                    }}
                                    className="shrink-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-primary)] max-w-[180px]"
                                  >
                                    <option value="">— Unassigned —</option>
                                    {claudeProjects.map((p) => (
                                      <option key={p.uuid} value={p.uuid}>{p.name}</option>
                                    ))}
                                  </select>
                                  <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{conv.message_count} msg{conv.message_count === 1 ? "" : "s"}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
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
                    || (
                      claudeSelectedFolders.size === 0
                      && claudeSelected.size === 0
                      && Object.values(chatAssignments).every((p) => !p)
                    )
                    || (() => {
                      const projectsToCheck = new Set<string>(claudeSelectedFolders);
                      for (const p of Object.values(chatAssignments)) {
                        if (p) {projectsToCheck.add(p);}
                      }
                      return [...projectsToCheck].some((uuid) => {
                        const d = projectDestinations[uuid];
                        return !d || !destIsComplete(d);
                      });
                    })()
                  }
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                >
                  {importingClaude ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                  {importingClaude ? "Importing..." : "Import"}
                </button>
              </div>
            )}
          </div>
        )}
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
