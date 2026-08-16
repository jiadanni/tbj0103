/**
 * ImportSettingsSection — external conversation imports.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Check, CheckSquare, ChevronDown, ChevronRight, Download, Eye, FolderInput, RefreshCw, Square, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, type ChatSuggestion } from "../lib/api";
import { conversationGist, isGenericConversationName } from "../lib/conversationGist";
import { useWorkspaceStore } from "../stores/workspaceStore";
import PromptDialog from "../components/PromptDialog";
import { Tooltip } from "../components/Tooltip";
import ImportConversationPreview, { type ImportConversation } from "../components/ImportConversationPreview";

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

/** A chat already imported in a prior run, with its current in-app location. */
interface LinkedConvInfo {
  session_id: string;
  source_conversation_uuid: string;
  title: string;
  workspace_id: string;
  workspace_name: string;
  folder_id: string;
  folder_name: string;
}

/** A remembered import destination for a Claude project ("__orphans__" for unassigned chats). */
interface KnownDestInfo {
  source_project_uuid: string;
  source_project_name: string;
  workspace_id: string;
  workspace_name: string;
  folder_id: string;
  folder_name: string;
}

interface ClaudeConvPreview {
  uuid: string;
  name: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  project_uuid: string | null;
  first_user_message?: string;
  /** Claude-generated conversation overview from the export — used by the matcher. */
  summary?: string;
  messages?: { role: string; content: string }[];
}

/** A proposed new workspace grouping unassigned chats, minted from a cluster. */
interface ProposedGroup {
  name: string;
  terms: string[];
  memberUuids: string[];
}

type MatchStrictness = "strict" | "balanced" | "loose";

type MergeChoice = "merge-this" | "merge-all" | "rename" | "cancel";

/**
 * If a workspace with the given name already exists, prompt the user
 * to merge into it or provide a new name. Returns the resolved name
 * (original for merge, new for rename) or null if the user cancels.
 *
 * When `bulkContext` is provided, the user can pick "Merge All" to apply
 * the merge decision to every subsequent conflict in the same import.
 */
async function resolveWorkspaceNameConflict(
  name: string,
  workspaces: { name: string }[],
  promptForName: (defaultValue: string) => Promise<string | null>,
  bulkContext?: {
    mergeAllRef: { current: boolean };
    askMergeChoice: (conflictName: string) => Promise<MergeChoice>;
  },
): Promise<string | null> {
  const normalised = name.trim().toLowerCase();
  const exists = workspaces.some(
    (w) => w.name.trim().toLowerCase() === normalised,
  );
  if (!exists) { return name; }

  if (bulkContext?.mergeAllRef.current) {
    return name; // merge — decision already made for this batch
  }

  let choice: MergeChoice;
  if (bulkContext) {
    choice = await bulkContext.askMergeChoice(name);
    if (choice === "merge-all") {
      bulkContext.mergeAllRef.current = true;
    }
  } else {
    const merge = await ask(
      `A workspace named "${name}" already exists.\n\nMerge conversations into the existing workspace?`,
      { title: "Workspace already exists", kind: "warning", okLabel: "Merge", cancelLabel: "Rename" },
    );
    choice = merge ? "merge-this" : "rename";
  }

  if (choice === "cancel") { return null; }
  if (choice === "merge-this" || choice === "merge-all") { return name; }

  // Ask for a new name via styled prompt dialog
  const newName = await promptForName(`${name} (2)`);
  if (!newName) { return null; } // user cancelled

  // Recurse in case the new name also conflicts
  return resolveWorkspaceNameConflict(newName.trim(), workspaces, promptForName, bulkContext);
}

export default function ImportSettingsSection() {
  const navigate = useNavigate();
  const setActiveFolderId = useWorkspaceStore((s) => s.setActiveFolderId);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);
  const setFoldersForWorkspace = useWorkspaceStore((s) => s.setFoldersForWorkspace);
  const setWorkspaces = useWorkspaceStore((s) => s.setWorkspaces);
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
  const [lmStudioMergeExisting, setLmStudioMergeExisting] = useState(false);
  const [lmStudioCloneEdited, setLmStudioCloneEdited] = useState(false);
  const [importingGemini, setImportingGemini] = useState(false);
  const [geminiFilePath, setGeminiFilePath] = useState<string | null>(null);
  const [geminiPreviews, setGeminiPreviews] = useState<ImportConversation[]>([]);
  const [geminiSelected, setGeminiSelected] = useState<Set<string>>(new Set());
  const [geminiScanning, setGeminiScanning] = useState(false);
  const [focusedGeminiUuid, setFocusedGeminiUuid] = useState<string | null>(null);
  const [importingClaude, setImportingClaude] = useState(false);
  const [claudeScanning, setClaudeScanning] = useState(false);
  const [claudeEmbeddingMatching, setClaudeEmbeddingMatching] = useState(false);
  // Model used for embedding-based import matching. Empty = falls back to the
  // configured embedding model. Populated from the Ollama model list on demand.
  const [importMatchModel, setImportMatchModel] = useState("");
  const [availableMatchModels, setAvailableMatchModels] = useState<string[]>([]);
  const [showMatchModelMenu, setShowMatchModelMenu] = useState(false);
  const matchModelMenuRef = useRef<HTMLDivElement>(null);
  const [claudeIncludeConversations, setClaudeIncludeConversations] = useState(true);
  const [claudeIncludeProjects, setClaudeIncludeProjects] = useState(true);
  const [claudeIncludeMemories, setClaudeIncludeMemories] = useState(true);
  const [claudeMergeExisting, setClaudeMergeExisting] = useState(false);
  const [claudeCloneEdited, setClaudeCloneEdited] = useState(false);
  // Move previously imported chats back to their remembered import destination.
  // Default off: app state wins — linked chats merge wherever they now live.
  const [claudeRestoreDestinations, setClaudeRestoreDestinations] = useState(false);
  // Chats recognized from a prior import (Claude conversation UUID → location).
  const [claudeLinked, setClaudeLinked] = useState<Record<string, LinkedConvInfo>>({});
  // Remembered destinations from prior imports (project UUID / "__orphans__").
  const [claudeKnownDests, setClaudeKnownDests] = useState<Record<string, KnownDestInfo>>({});
  const [linkedListOpen, setLinkedListOpen] = useState(false);
  // Previously imported chats still sitting in the unassigned area — they stay
  // in the review flow (flagged) and re-match every round.
  const [claudeLinkedUnassigned, setClaudeLinkedUnassigned] = useState<Record<string, LinkedConvInfo>>({});
  // Persisted matcher strictness preset (import.match_strictness setting).
  const [matchStrictness, setMatchStrictness] = useState<MatchStrictness>("balanced");
  // Proposed new workspaces from clustering, keyed by a stable synthetic
  // "proposed:<hash>" id that flows through the import plumbing like a project.
  const [proposedGroups, setProposedGroups] = useState<Record<string, ProposedGroup>>({});
  const [clusterProposing, setClusterProposing] = useState(false);
  // Review-table filter: show every review row or only still-unassigned ones.
  const [rowFilter, setRowFilter] = useState<"all" | "unassigned">("unassigned");
  const [rowSearch, setRowSearch] = useState("");
  const [projectsSectionOpen, setProjectsSectionOpen] = useState(true);
  // Snapshot of scan-time destination pre-fills. When the user leaves a
  // project's picker untouched, import reuses the remembered destination ids
  // instead of creating workspaces/folders.
  const prefilledDestsRef = useRef<Record<string, ProjectDestination>>({});
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
  // Inline preview toggle for a row in the unassigned-conversations table.
  const [previewConvUuid, setPreviewConvUuid] = useState<string | null>(null);
  const [claudeSuggestions, setClaudeSuggestions] = useState<ChatSuggestion[]>([]);
  // How many projects the topic pass successfully enriched (null = not run yet).
  const [topicCoverage, setTopicCoverage] = useState<{ enriched: number; total: number } | null>(null);
  // Partial-failure notice from the last AI matching run (e.g. an Ollama
  // timeout mid-run). Suggestions from completed batches are still applied;
  // this tells the user the rest degraded to keyword matching.
  const [matchWarning, setMatchWarning] = useState<string | null>(null);
  // Completion notice for the last AI matching run — how many chats got a
  // suggestion and what to do next. Without this, the only sign the run
  // finished was the job pill vanishing from the status bar.
  const [matchSummary, setMatchSummary] = useState<string | null>(null);
  const [claudeMemoriesByProject, setClaudeMemoriesByProject] = useState<Record<string, string>>({});
  // chat_uuid → project_uuid (or null = unassigned). Initialised from server suggestions on scan.
  const [chatAssignments, setChatAssignments] = useState<Record<string, string | null>>({});
  // Focused project for the master/detail split view.
  const [focusedProjectUuid, setFocusedProjectUuid] = useState<string | null>(null);
  const [bulkDestType, setBulkDestType] = useState<ProjectDestType>("new-workspace");
  const [bulkParentId, setBulkParentId] = useState<string | null>(null);
  const [importingChatGpt, setImportingChatGpt] = useState(false);
  const [chatGptFolderPath, setChatGptFolderPath] = useState<string | null>(null);
  const [chatGptPreviews, setChatGptPreviews] = useState<ImportConversation[]>([]);
  const [chatGptSelected, setChatGptSelected] = useState<Set<string>>(new Set());
  const [chatGptScanning, setChatGptScanning] = useState(false);
  const [focusedChatGptUuid, setFocusedChatGptUuid] = useState<string | null>(null);
  const [chatGptDestType, setChatGptDestType] = useState<"new" | "existing">("new");
  const [chatGptWorkspaceId, setChatGptWorkspaceId] = useState<string | null>(null);
  const [chatGptNewWorkspaceName, setChatGptNewWorkspaceName] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [promptState, setPromptState] = useState<{ defaultValue: string } | null>(null);
  const promptResolveRef = useRef<((value: string | null) => void) | null>(null);
  const [mergeChoiceState, setMergeChoiceState] = useState<{ conflictName: string } | null>(null);
  const mergeChoiceResolveRef = useRef<((value: MergeChoice) => void) | null>(null);

  const promptForName = useCallback((defaultValue: string): Promise<string | null> => {
    return new Promise((resolve) => {
      promptResolveRef.current = resolve;
      setPromptState({ defaultValue });
    });
  }, []);

  const askMergeChoice = useCallback((conflictName: string): Promise<MergeChoice> => {
    return new Promise((resolve) => {
      mergeChoiceResolveRef.current = resolve;
      setMergeChoiceState({ conflictName });
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
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "LM Studio import failed";
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
        lmStudioMergeExisting,
        lmStudioMergeExisting && lmStudioCloneEdited,
      );
      if (result.imported < 1 && result.appended_sessions < 1 && result.skipped > 0) {
        await message(`All ${result.skipped} conversation${result.skipped === 1 ? "" : "s"} already imported — nothing new to add.`, {
          title: "LM Studio import",
          kind: "info",
        });
        resetLmStudioPreview();
        return;
      }
      if (result.imported < 1 && result.appended_sessions < 1) {
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
      if (result.appended_sessions > 0) {
        lines.push(
          `${result.appended_messages} new message${result.appended_messages === 1 ? "" : "s"} added to ${result.appended_sessions} existing chat${result.appended_sessions === 1 ? "" : "s"}.`,
        );
      }
      if (result.cloned > 0) {
        lines.push(`${result.cloned} edited chat${result.cloned === 1 ? "" : "s"} cloned as new copies.`);
      }
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
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "LM Studio import failed";
      setError(msg);
      await message(msg, { title: "LM Studio import failed", kind: "error" });
    } finally {
      setImportingLmStudio(false);
    }
  }

  function resetGeminiPreview() {
    setGeminiFilePath(null);
    setGeminiPreviews([]);
    setGeminiSelected(new Set());
    setFocusedGeminiUuid(null);
  }

  async function pickGeminiFile() {
    setError(null);
    setGeminiScanning(true);
    resetGeminiPreview();

    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "Select browser activity export HTML file",
        filters: [{ name: "HTML", extensions: ["html", "htm"] }],
      });
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (!filePath) { return; }

      const result = await api.chatFile.previewGeminiTakeout(filePath);
      if (result.total < 1) {
        throw new Error("No importable conversations were found in the selected file.");
      }
      setGeminiFilePath(filePath);
      setGeminiPreviews(result.conversations);
      setGeminiSelected(new Set(result.conversations.map((c) => c.uuid)));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Activity scan failed";
      setError(msg);
      await message(msg, { title: "Activity scan failed", kind: "error" });
    } finally {
      setGeminiScanning(false);
    }
  }

  async function importFromGeminiTakeout() {
    if (!geminiFilePath) { return; }
    setError(null);
    setImportingGemini(true);

    try {
      const selectedIds = [...geminiSelected];
      if (selectedIds.length < 1) {
        throw new Error("Select at least one conversation to import.");
      }

      const defaultName = "Imported Browser Chats";
      const resolvedName = await resolveWorkspaceNameConflict(defaultName, workspaces, promptForName);
      if (!resolvedName) { return; }

      const result = await api.chatFile.importGeminiTakeout(
        geminiFilePath,
        resolvedName !== defaultName ? resolvedName : undefined,
        selectedIds,
      );
      if (result.imported_sessions < 1 && (result.skipped ?? 0) > 0) {
        await message(`All ${result.skipped} conversation${result.skipped === 1 ? "" : "s"} already imported — nothing new to add.`, {
          title: "Activity import",
          kind: "info",
        });
        resetGeminiPreview();
        return;
      }
      if (result.imported_sessions < 1) {
        throw new Error("The activity export completed without importing any conversations.");
      }

      const [freshWorkspaces, importedProjects, firstSession] = await Promise.all([
        api.workspace.list(),
        api.folder.list(result.workspace_id),
        api.chat.listSessions(result.workspace_id, result.folder_id ?? null, { limit: 1, offset: 0 }),
      ]);

      setWorkspaces(freshWorkspaces);
      setFoldersForWorkspace(result.workspace_id, importedProjects);
      setActiveWorkspaceId(result.workspace_id);
      setActiveFolderId(result.folder_id ?? null);

      const lines = [
        `${result.imported_sessions} conversation${result.imported_sessions === 1 ? "" : "s"} imported.`,
        `${result.imported_messages} total message${result.imported_messages === 1 ? "" : "s"} processed.`,
      ];
      if (result.skipped > 0) {
        lines.push(`${result.skipped} duplicate${result.skipped === 1 ? "" : "s"} skipped.`);
      }
      if (result.errors > 0) {
        lines.push(`${result.errors} conversation${result.errors === 1 ? "" : "s"} had errors.`);
      }

      resetGeminiPreview();

      if (firstSession.length > 0) {
        navigate(`/chat/${firstSession[0].id}`);
      }

      await message(lines.join("\n"), {
        title: "Activity import complete",
        kind: result.errors > 0 ? "warning" : "info",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Activity import failed";
      setError(msg);
      await message(msg, { title: "Activity import failed", kind: "error" });
    } finally {
      setImportingGemini(false);
    }
  }

  function resetChatGptPreview() {
    setChatGptFolderPath(null);
    setChatGptPreviews([]);
    setChatGptSelected(new Set());
    setFocusedChatGptUuid(null);
    setChatGptDestType("new");
    setChatGptWorkspaceId(null);
    setChatGptNewWorkspaceName("");
  }

  async function pickChatGptFolder() {
    setError(null);
    setChatGptScanning(true);
    resetChatGptPreview();

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select ChatGPT export folder",
      });
      const folderPath = Array.isArray(selected) ? selected[0] : selected;
      if (!folderPath) { return; }

      const result = await api.chatFile.previewChatGptFolder(folderPath);
      if (result.total < 1) {
        throw new Error("No importable conversations were found in the selected folder.");
      }
      setChatGptFolderPath(folderPath);
      setChatGptPreviews(result.conversations);
      setChatGptSelected(new Set(result.conversations.map((c) => c.uuid)));

      const folderName = folderPath.split(/[/\\]/).filter(Boolean).pop() ?? "ChatGPT Import";
      setChatGptNewWorkspaceName(folderName);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "ChatGPT scan failed";
      setError(msg);
      await message(msg, { title: "ChatGPT scan failed", kind: "error" });
    } finally {
      setChatGptScanning(false);
    }
  }

  async function importFromChatGptFolder() {
    if (!chatGptFolderPath) { return; }
    setError(null);
    setImportingChatGpt(true);

    try {
      const selectedIds = [...chatGptSelected];
      if (selectedIds.length < 1) {
        throw new Error("Select at least one conversation to import.");
      }

      let finalWorkspaceId: string | null = null;
      let finalWorkspaceName: string | null = null;

      if (chatGptDestType === "existing") {
        if (!chatGptWorkspaceId) {
          throw new Error("Select an existing workspace to import into.");
        }
        finalWorkspaceId = chatGptWorkspaceId;
      } else {
        const defaultName = chatGptNewWorkspaceName.trim() || "ChatGPT Import";
        const resolvedName = await resolveWorkspaceNameConflict(defaultName, workspaces, promptForName);
        if (!resolvedName) {
          setImportingChatGpt(false);
          return;
        }
        finalWorkspaceName = resolvedName;
      }

      const result = await api.chatFile.importChatGptFolder(
        chatGptFolderPath,
        finalWorkspaceId,
        finalWorkspaceName,
        selectedIds,
      );

      if (result.imported_sessions < 1 && result.skipped > 0) {
        await message(`All ${result.skipped} conversation${result.skipped === 1 ? "" : "s"} already imported — nothing new to add.`, {
          title: "ChatGPT import",
          kind: "info",
        });
        resetChatGptPreview();
        return;
      }
      if (result.imported_sessions < 1) {
        throw new Error("ChatGPT import completed without importing any conversations.");
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
      ];
      if (result.skipped > 0) {
        lines.push(`${result.skipped} duplicate${result.skipped === 1 ? "" : "s"} skipped.`);
      }
      if (result.errors > 0) {
        lines.push(`${result.errors} conversation${result.errors === 1 ? "" : "s"} had errors.`);
      }

      resetChatGptPreview();

      if (firstSession.length > 0) {
        navigate(`/chat/${firstSession[0].id}`);
      }

      await message(lines.join("\n"), {
        title: "ChatGPT import complete",
        kind: result.errors > 0 ? "warning" : "info",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "ChatGPT import failed";
      setError(msg);
      await message(msg, { title: "ChatGPT import failed", kind: "error" });
    } finally {
      setImportingChatGpt(false);
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
    setTopicCoverage(null);
    setClaudeMemoriesByProject({});
    setChatAssignments({});
    setFocusedProjectUuid(null);
    setClaudeEmbeddingMatching(false);
    setClaudeLinked({});
    setClaudeKnownDests({});
    setLinkedListOpen(false);
    setClaudeLinkedUnassigned({});
    setProposedGroups({});
    setClusterProposing(false);
    setRowFilter("all");
    prefilledDestsRef.current = {};
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
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Could not detect Claude export format";
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

      // Chats recognized from a prior import merge automatically — they are
      // excluded from the review/assignment flow entirely. Exception: chats
      // still sitting in the unassigned area stay reviewable each round.
      const linked = result.linked_conversations ?? {};
      const knownDests = result.known_destinations ?? {};
      const reviewOrphans = result.orphan_conversations.filter((c) => !linked[c.uuid]);

      setClaudeLinked(linked);
      setClaudeKnownDests(knownDests);
      setClaudeLinkedUnassigned(result.linked_unassigned ?? {});
      setMatchStrictness(result.match_strictness ?? "balanced");
      setClaudeProjects(result.folders);
      setClaudeConvsByProject(result.conversations_by_project);
      setClaudeOrphans(reviewOrphans);
      setClaudeSuggestions(result.suggestions ?? []);
      setClaudeMemoriesByProject(result.memories_by_project ?? {});

      // Seed assignments from server suggestions (chat → suggested project_uuid).
      // Chats with no suggestion stay unassigned (null).
      const initialAssignments: Record<string, string | null> = {};
      const suggestionByChat = new Map<string, string | null>();
      for (const s of result.suggestions ?? []) {
        suggestionByChat.set(s.conversation_uuid, s.project_uuid);
      }
      for (const c of reviewOrphans) {
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
        // Pre-fill from the remembered destination when one exists; import
        // reuses its ids directly as long as the picker stays untouched.
        const known = knownDests[proj.uuid];
        dests[proj.uuid] = {
          type: "new-workspace",
          parentId: null,
          subWorkspaceId: null,
          name: known && !known.folder_id ? known.workspace_name : proj.name,
        };
        memEnabled[proj.uuid] = proj.has_memory;
        instrEnabled[proj.uuid] = proj.has_prompt;
      }
      prefilledDestsRef.current = { ...dests };

      setClaudeSelectedProjects(selectedFolders);
      // Default orphan "selected for import" = chats that ended up Unassigned (no suggestion).
      setClaudeSelected(new Set(
        reviewOrphans
          .filter((c) => !suggestionByChat.get(c.uuid))
          .map((c) => c.uuid),
      ));
      setProjectDestinations(dests);
      setProjectMemoryEnabled(memEnabled);
      setProjectInstructionsEnabled(instrEnabled);
      setFocusedProjectUuid(result.folders[0]?.uuid ?? null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Claude scan failed";
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

  // Close the model-picker dropdown on outside click.
  useEffect(() => {
    if (!showMatchModelMenu) { return; }
    function onClickOutside(e: MouseEvent) {
      if (matchModelMenuRef.current && !matchModelMenuRef.current.contains(e.target as Node)) {
        setShowMatchModelMenu(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showMatchModelMenu]);

  /// Distil project prompts into topic lists, then re-match deterministically.
  /// Cost scales with project count (~20 calls' worth) rather than chat count,
  /// so this is the default for large exports.
  async function runTopicMatch(opts?: { rerunAll?: boolean; modelOverride?: string }) {
    return runMatch("topics", opts);
  }

  /// Classify each chat directly with the LLM. Accurate but expensive — one call
  /// per ~10 chats, so ~100 sequential calls for a 1000-chat export.
  async function runEmbeddingMatch(opts?: { rerunAll?: boolean; modelOverride?: string }) {
    return runMatch("llm", opts);
  }

  async function runMatch(
    strategy: "topics" | "llm",
    opts?: { rerunAll?: boolean; modelOverride?: string },
  ) {
    if (claudeOrphans.length === 0 || claudeProjects.length === 0) { return; }
    setError(null);
    setMatchWarning(null);
    setMatchSummary(null);
    setClaudeEmbeddingMatching(true);
    setShowMatchModelMenu(false);
    const effectiveModel = opts?.modelOverride ?? importMatchModel;
    try {
      const targetConvs = opts?.rerunAll
        ? claudeOrphans
        : claudeOrphans.filter((c) => !chatAssignments[c.uuid]);
      const projectArgs = claudeProjects.map((p) => ({
        uuid: p.uuid,
        name: p.name,
        prompt_template: p.prompt_template ?? "",
        description: p.description,
      }));

      let suggestions: ChatSuggestion[];
      if (strategy === "topics") {
        const result = await api.chatFile.matchClaudeWithTopics({
          // Pass full transcripts so matching can look past a vague opener.
          conversations: targetConvs.map((c) => ({
            uuid: c.uuid,
            name: c.name,
            first_user_message: c.first_user_message ?? "",
            summary: c.summary ?? "",
            messages: c.messages,
          })),
          projects: projectArgs,
          memoriesByProject: claudeMemoriesByProject,
          modelOverride: effectiveModel || undefined,
        });
        suggestions = result.suggestions as ChatSuggestion[];
        setTopicCoverage({
          enriched: result.projects_with_topics,
          total: result.projects_total,
        });
        if (result.topic_batches_failed > 0) {
          setMatchWarning(
            result.topic_batches_failed === result.topic_batches_total
              ? `Topic generation failed (${result.llm_error ?? "Ollama error"}) — all chats were matched on base project vocabulary only.`
              : `Topic generation failed for ${result.topic_batches_failed} of ${result.topic_batches_total} batches (${result.llm_error ?? "Ollama error"}) — affected projects matched on base vocabulary only.`,
          );
        }
      } else {
        const result = await api.chatFile.matchClaudeWithLlm({
          conversations: targetConvs.map((c) => ({
            uuid: c.uuid,
            name: c.name,
            first_user_message: c.first_user_message ?? "",
            summary: c.summary ?? "",
          })),
          projects: projectArgs,
          memoriesByProject: claudeMemoriesByProject,
          modelOverride: effectiveModel || undefined,
        });
        suggestions = result.suggestions as ChatSuggestion[];
        if (result.llm_error) {
          setMatchWarning(
            `AI matching stopped after batch ${result.batches_completed} of ${result.batches_total} (${result.llm_error}) — remaining chats used keyword fallback.`,
          );
        }
      }

      // Suggestions ARE assignments: matched chats pre-select their suggested
      // project in the review table, and importing routes them there unless
      // the user changes the row. Review = change what's wrong.
      const newSuggestions = opts?.rerunAll
        ? []
        : claudeSuggestions.filter(
            (s) => !suggestions.some((r) => r.conversation_uuid === s.conversation_uuid),
          );
      for (const s of suggestions) {
        newSuggestions.push({ ...s, reason: s.reason as ChatSuggestion["reason"] });
      }
      setChatAssignments((prev) => {
        // Re-run resets everything first; incremental runs keep prior state.
        const next: Record<string, string | null> = opts?.rerunAll
          ? Object.fromEntries(claudeOrphans.map((c) => [c.uuid, null as string | null]))
          : { ...prev };
        for (const s of suggestions) {
          if (s.project_uuid) { next[s.conversation_uuid] = s.project_uuid; }
        }
        return next;
      });
      // Newly assigned chats leave the import-as-unassigned tick set.
      setClaudeSelected((prev) => {
        const base = opts?.rerunAll ? new Set(claudeOrphans.map((c) => c.uuid)) : new Set(prev);
        for (const s of suggestions) {
          if (s.project_uuid) { base.delete(s.conversation_uuid); }
        }
        return base;
      });
      setClaudeSuggestions(newSuggestions);
      const suggestedCount = suggestions.filter((s) => s.project_uuid).length;
      setMatchSummary(
        suggestedCount === 0
          ? `AI matching finished: no confident project match for the ${targetConvs.length} chat${targetConvs.length === 1 ? "" : "s"} checked.`
          : `AI matching finished: assigned ${suggestedCount} of ${targetConvs.length} chats. Review below and change anything that's wrong.`,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "AI matching failed";
      setError(msg);
    } finally {
      setClaudeEmbeddingMatching(false);
    }
  }

  /// Stable synthetic key for a proposed group: content-derived (FNV-1a over
  /// the sorted member UUIDs), NOT the backend's positional cluster-N id, so
  /// re-running clustering re-mints the same key for the same members and
  /// remembered destinations survive across runs.
  function proposedGroupKey(memberUuids: string[]): string {
    const input = [...memberUuids].sort().join("|");
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `proposed:${hash.toString(16)}`;
  }

  /// Cluster the leftover (still-unassigned) chats into proposed new
  /// workspaces, assign members to the synthetic keys, and seed destinations.
  async function proposeNewWorkspaces() {
    const leftovers = claudeOrphans.filter((c) => !chatAssignments[c.uuid]);
    if (leftovers.length === 0) { return; }
    setError(null);
    setMatchWarning(null);
    setMatchSummary(null);
    setClusterProposing(true);
    setShowMatchModelMenu(false);
    try {
      const result = await api.chatFile.clusterUnmatchedClaudeChats({
        conversations: leftovers.map((c) => ({
          uuid: c.uuid,
          name: c.name,
          first_user_message: c.first_user_message ?? "",
          summary: c.summary ?? "",
          messages: c.messages,
        })),
        unmatchedUuids: leftovers.map((c) => c.uuid),
        modelOverride: importMatchModel || undefined,
      });

      if (result.clusters.length === 0) {
        setMatchSummary("No coherent groups found among the unassigned chats (groups need at least 3 related chats).");
        return;
      }

      const groups: Record<string, ProposedGroup> = {};
      const assignments: Record<string, string> = {};
      const dests: Record<string, ProjectDestination> = {};
      for (const cluster of result.clusters) {
        const key = proposedGroupKey(cluster.conversation_uuids);
        groups[key] = {
          name: cluster.label,
          terms: cluster.terms,
          memberUuids: cluster.conversation_uuids,
        };
        dests[key] = { type: "new-workspace", parentId: null, subWorkspaceId: null, name: cluster.label };
        for (const uuid of cluster.conversation_uuids) {
          assignments[uuid] = key;
        }
      }
      setProposedGroups((prev) => ({ ...prev, ...groups }));
      setProjectDestinations((prev) => ({ ...prev, ...dests }));
      setChatAssignments((prev) => ({ ...prev, ...assignments }));
      setClaudeSelected((prev) => {
        const next = new Set(prev);
        for (const uuid of Object.keys(assignments)) { next.delete(uuid); }
        return next;
      });

      const grouped = Object.keys(assignments).length;
      setMatchSummary(
        `Proposed ${result.clusters.length} new workspace${result.clusters.length === 1 ? "" : "s"} covering ${grouped} of ${leftovers.length} unassigned chats (${result.strategy} grouping). Review the assignments below.`,
      );
      if (result.strategy === "lexical") {
        setMatchWarning("Semantic grouping was unavailable (no embedding model reachable) — groups were formed from title keywords only.");
      } else if (result.names_generated === 0) {
        setMatchWarning("Group naming was unavailable — proposed workspaces use keyword names; rename them in the destination picker.");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Grouping failed";
      setError(msg);
    } finally {
      setClusterProposing(false);
    }
  }

  /**
   * Write the review state (projects + orphan conversations + current
   * assignments/suggestions) to a JSON file the user can hand to an external
   * AI (chat or CLI tool) for analysis. Export-only for now — there is no
   * re-import of the AI's answers yet.
   */
  async function exportReviewForAi() {
    const payload = {
      format: "aetherium-claude-import-review",
      version: 1,
      exported_at: new Date().toISOString(),
      instructions:
        "Each conversation needs a destination. Set assigned_project_uuid to the uuid of the best-fitting project " +
        "(from `projects`) or proposed workspace (from `proposed_workspaces`), or leave it null when nothing fits. " +
        "Use `summary`, `gist`, `first_user_message`, and `messages` to judge the topic. " +
        "`suggestion` is the app's own heuristic guess — feel free to overrule it.",
      projects: claudeProjects.map((p) => ({
        uuid: p.uuid,
        name: p.name,
        description: p.description,
        prompt_template: p.prompt_template ?? "",
      })),
      proposed_workspaces: Object.entries(proposedGroups).map(([key, g]) => ({
        uuid: key,
        name: g.name,
        terms: g.terms,
      })),
      conversations: claudeOrphans.map((c) => {
        const suggestion = claudeSuggestions.find((s) => s.conversation_uuid === c.uuid);
        return {
          uuid: c.uuid,
          name: c.name,
          gist: conversationGist(c, 300),
          first_user_message: c.first_user_message ?? "",
          summary: c.summary ?? "",
          message_count: c.message_count,
          created_at: c.created_at,
          updated_at: c.updated_at,
          assigned_project_uuid: chatAssignments[c.uuid] ?? null,
          suggestion: suggestion
            ? { project_uuid: suggestion.project_uuid, score: suggestion.score, reason: suggestion.reason }
            : null,
          messages: c.messages ?? [],
        };
      }),
    };
    const date = new Date().toISOString().slice(0, 10);
    const dest = await save({
      defaultPath: `claude-import-review-${date}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!dest) { return; }
    try {
      await writeTextFile(dest, JSON.stringify(payload, null, 2));
      await message(`Exported ${payload.conversations.length} conversations and ${payload.projects.length} projects.`, { title: "Export complete" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Export failed";
      setError(msg);
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
      const mergeAllRef = { current: false };
      const bulkConflictContext = { mergeAllRef, askMergeChoice };

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

        // Remembered destination from a prior import: as long as the user left
        // this project's picker untouched, reuse the existing workspace/folder
        // ids instead of creating anything.
        const known = claudeKnownDests[projUuid];
        const prefilled = prefilledDestsRef.current[projUuid];
        const destUntouched = !!prefilled && JSON.stringify(dest) === JSON.stringify(prefilled);

        let target: { workspace_id: string; folder_id: string };
        if (known && destUntouched) {
          target = { workspace_id: known.workspace_id, folder_id: known.folder_id };
        } else if (dest.type === "new-workspace") {
          const resolvedName = await resolveWorkspaceNameConflict(dest.name.trim(), workspaces, promptForName, bulkConflictContext);
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
          // Reuse an existing child workspace with the same name instead of
          // re-creating it on every re-import.
          const existingChild = workspaces.find(
            (w) => w.parent_workspace_id === dest.parentId
              && w.name.trim().toLowerCase() === dest.name.trim().toLowerCase(),
          );
          const ws = existingChild ?? await api.workspace.createChild(dest.parentId, dest.name.trim());
          if (promptTemplate) {
            await api.workspace.update(ws.id, ws.name, ws.description, promptTemplate);
          }
          // Similar to new-workspace, for new child workspace, we just put chats in it directly.
          target = { workspace_id: ws.id, folder_id: "" };
        } else {
          if (!dest.subWorkspaceId) { throw new Error(`Missing sub-workspace for project "${dest.name}"`); }
          // Reuse an existing folder with the same name instead of re-creating.
          const existingFolders = await api.folder.list(dest.subWorkspaceId);
          const existingFolder = existingFolders.find(
            (f) => f.name.trim().toLowerCase() === dest.name.trim().toLowerCase(),
          );
          const folder = existingFolder ?? await api.folder.create(dest.subWorkspaceId, dest.name.trim(), {
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
      // user ticked + assigned chats + previously imported chats (recognized by
      // Claude UUID; the backend merges those in place automatically).
      const conversationIdsToImport = new Set<string>([
        ...assignedConversationIds,
        ...claudeSelected,
        ...Object.keys(claudeLinked),
      ]);

      // Orphan workspace — only created if any unassigned chats remain.
      const unassignedCount = [...claudeSelected].filter(
        (id) => !chatProjectOverrides[id],
      ).length;
      let orphansDestination: { workspace_id: string; folder_id: string } | null = null;
      const knownOrphans = claudeKnownDests["__orphans__"];
      if (unassignedCount > 0 && knownOrphans) {
        // Reuse the destination unassigned chats went to last time instead of
        // minting a new dated folder per import run.
        orphansDestination = { workspace_id: knownOrphans.workspace_id, folder_id: knownOrphans.folder_id };
      } else if (unassignedCount > 0) {
        const existing = workspaces.find((w) => w.name === "Unassigned Imports" && !w.parent_workspace_id);
        const ws = existing ?? await api.workspace.create("Unassigned Imports");
        const stamp = new Date().toISOString().slice(0, 10);
        const folder = await api.folder.create(ws.id, `Claude Import ${stamp}`, {});
        orphansDestination = { workspace_id: ws.id, folder_id: folder.id };
      }

      const freshWs = await api.workspace.list();
      setWorkspaces(freshWs);

      const mappedFolderMappings: Record<string, { workspaceId: string; folderId: string }> = {};
      for (const [uuid, target] of Object.entries(folderMappings)) {
        mappedFolderMappings[uuid] = { workspaceId: target.workspace_id, folderId: target.folder_id };
      }
      const mappedProjectMemoryTargets: Record<string, { workspaceId: string; folderId: string }> = {};
      for (const [uuid, target] of Object.entries(projectMemoryTargets)) {
        mappedProjectMemoryTargets[uuid] = { workspaceId: target.workspace_id, folderId: target.folder_id };
      }

      const result = await api.chatFile.importClaudeFiles({
        folderPath: claudeFolderPath,
        folderMappings: mappedFolderMappings,
        projectMemoryTargets: mappedProjectMemoryTargets,
        orphansDestination: orphansDestination
          ? { workspaceId: orphansDestination.workspace_id, folderId: orphansDestination.folder_id }
          : null,
        selectedConversationIds: conversationIdsToImport.size > 0 ? [...conversationIdsToImport] : undefined,
        selectedProjectIds: [...claudeSelectedFolders],
        chatProjectOverrides: Object.keys(chatProjectOverrides).length > 0 ? chatProjectOverrides : undefined,
        mergeExisting: claudeMergeExisting,
        cloneEdited: claudeMergeExisting && claudeCloneEdited,
        restoreDestinations: claudeRestoreDestinations,
        projectNameOverrides: Object.fromEntries(
          Object.entries(proposedGroups)
            .filter(([key]) => folderMappings[key])
            .map(([key, group]) => [key, group.name]),
        ),
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
      if (result.appended_sessions > 0) {
        lines.push(
          `${result.appended_messages} new message${result.appended_messages === 1 ? "" : "s"} added to ${result.appended_sessions} existing chat${result.appended_sessions === 1 ? "" : "s"}.`,
        );
      }
      if (result.cloned > 0) {
        lines.push(`${result.cloned} edited chat${result.cloned === 1 ? "" : "s"} cloned as new copies.`);
      }
      if (result.linked > 0) {
        lines.push(`${result.linked} previously imported chat${result.linked === 1 ? "" : "s"} updated in place.`);
      }
      if (result.moved_back > 0) {
        lines.push(`${result.moved_back} chat${result.moved_back === 1 ? "" : "s"} moved back to their import location.`);
      }
      if (result.reassigned > 0) {
        lines.push(`${result.reassigned} previously imported chat${result.reassigned === 1 ? "" : "s"} moved to their newly assigned project.`);
      }
      if (result.skipped > 0) {
        lines.push(`${result.skipped} duplicate${result.skipped === 1 ? "" : "s"} skipped.`);
      }
      if (result.memories_imported > 0) {
        lines.push(`${result.memories_imported} memor${result.memories_imported === 1 ? "y" : "ies"} imported.`);
      }
      if (result.memories_updated > 0) {
        lines.push(`${result.memories_updated} memor${result.memories_updated === 1 ? "y" : "ies"} updated with newer content.`);
      }
      if (result.memories_skipped > 0) {
        lines.push(`${result.memories_skipped} unchanged memor${result.memories_skipped === 1 ? "y" : "ies"} skipped.`);
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
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Claude import failed";
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

  // Which importer is actively showing a preview (only one at a time)
  const activeLmStudio = lmStudioPreviews.length > 0;
  const activeGemini = geminiPreviews.length > 0;
  const activeClaude = !!claudeFolderPath;
  const activeChatGpt = chatGptPreviews.length > 0;
  const anyActive = activeLmStudio || activeGemini || activeClaude || activeChatGpt;

  const rootWorkspaces = workspaces.filter((w) => !w.parent_workspace_id);

  const containerOverflowHidden = claudeFolderPath || chatGptPreviews.length > 0 || geminiPreviews.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[var(--border-color)] px-5 py-3">
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">Import</h1>
      </div>

      <div className={`${containerOverflowHidden ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto"} flex flex-col px-5 py-4 gap-3`}>
        {error && (
          <div className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* ── Import sources ──────────────────────────────────────────
            Full descriptive cards while nothing is selected; collapse to a
            single compact chip row once a source is active so the review UI
            below gets the vertical space. */}
        {(() => {
          const sources = [
            {
              key: "lm-studio",
              name: "LM Studio",
              description: "Select one folder to preview conversations, or multiple folders to import directly.",
              active: activeLmStudio,
              busy: lmStudioScanning || importingLmStudio,
              label: lmStudioScanning ? "Scanning…" : importingLmStudio ? "Importing…" : "Select",
              onPick: () => void pickLmStudioFolders(),
            },
            {
              key: "gemini",
              name: "Google Gemini",
              description: "Import conversations from a Google Takeout HTML activity export.",
              active: activeGemini,
              busy: geminiScanning || importingGemini,
              label: geminiScanning ? "Scanning…" : importingGemini ? "Importing…" : geminiFilePath ? "Change" : "Select",
              onPick: () => void pickGeminiFile(),
            },
            {
              key: "claude",
              name: "Claude",
              description: "Import conversations, projects, and memories from a Claude Desktop export folder. Documents and files attached to projects are not supported.",
              active: activeClaude,
              busy: claudeScanning || importingClaude,
              label: claudeFolderPath ? "Change" : "Select",
              onPick: () => void pickClaudeFolder(),
            },
            {
              key: "chatgpt",
              name: "ChatGPT",
              description: "Import conversations from a ChatGPT export folder containing conversations.json files.",
              active: activeChatGpt,
              busy: chatGptScanning || importingChatGpt,
              label: chatGptScanning ? "Scanning…" : importingChatGpt ? "Importing…" : chatGptFolderPath ? "Change" : "Select",
              onPick: () => void pickChatGptFolder(),
            },
          ];

          if (!anyActive) {
            return (
              <div className="shrink-0 grid grid-cols-4 gap-3">
                {sources.map((src) => (
                  <section key={src.key} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <FolderInput size={15} className="shrink-0 text-[var(--accent-color)]" />
                        <h2 className="text-xs font-medium text-[var(--text-primary)]">{src.name}</h2>
                      </div>
                      <button
                        onClick={src.onPick}
                        disabled={src.busy}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                      >
                        {src.busy ? <RefreshCw size={11} className="animate-spin" /> : <FolderInput size={11} />}
                        {src.label}
                      </button>
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)]">{src.description}</p>
                  </section>
                ))}
              </div>
            );
          }

          return (
            <div className="shrink-0 flex flex-wrap items-center gap-2">
              {sources.map((src) => (
                <Tooltip key={src.key} content={src.description} position="bottom">
                  <div className={`inline-flex items-center gap-2 rounded-lg border bg-[var(--bg-elevated)] px-2.5 py-1 transition-opacity ${src.active ? "border-[var(--accent-color)]/50" : "border-[var(--border-color)]"} ${!src.active ? "opacity-40 pointer-events-none" : ""}`}>
                    <FolderInput size={13} className="shrink-0 text-[var(--accent-color)]" />
                    <h2 className="text-xs font-medium text-[var(--text-primary)]">{src.name}</h2>
                    <button
                      onClick={src.onPick}
                      disabled={src.busy}
                      className="shrink-0 inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                    >
                      {src.busy && <RefreshCw size={10} className="animate-spin" />}
                      {src.label}
                    </button>
                  </div>
                </Tooltip>
              ))}
            </div>
          );
        })()}

        {/* ── LM Studio preview (below grid, only when a single folder was scanned) ── */}
        {lmStudioPreviews.length > 0 && (
          <section className="shrink-0 max-w-3xl rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3">
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

                <div className="flex flex-col gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2">
                  <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={lmStudioMergeExisting}
                      onChange={(e) => setLmStudioMergeExisting(e.target.checked)}
                      className="accent-[var(--accent-color)]"
                    />
                    <span>
                      Merge re-imports — append new messages to existing chats instead of skipping duplicates.
                    </span>
                  </label>
                  <label className={`flex items-center gap-2 pl-5 text-[11px] ${lmStudioMergeExisting ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)] opacity-60"}`}>
                    <input
                      type="checkbox"
                      checked={lmStudioCloneEdited}
                      onChange={(e) => setLmStudioCloneEdited(e.target.checked)}
                      disabled={!lmStudioMergeExisting}
                      className="accent-[var(--accent-color)]"
                    />
                    <span>
                      For chats edited locally, import the source as a new copy (preserves your edits).
                    </span>
                  </label>
                </div>

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

        {/* ── Google Takeout preview (below grid, only when a file was scanned) ── */}
        {geminiPreviews.length > 0 && (
          <section className="flex-1 min-h-[450px] max-w-4xl rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3 flex flex-col gap-3 overflow-hidden">
            <ImportConversationPreview
              conversations={geminiPreviews}
              selected={geminiSelected}
              onSelectionChange={setGeminiSelected}
              focusedUuid={focusedGeminiUuid}
              onFocusChange={setFocusedGeminiUuid}
              assistantLabel="Gemini"
            />
            <div className="shrink-0 flex items-center justify-end gap-2">
              <button
                onClick={() => resetGeminiPreview()}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <X size={12} /> Cancel
              </button>
              <button
                onClick={() => void importFromGeminiTakeout()}
                disabled={geminiSelected.size === 0 || importingGemini}
                className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent-color)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                {importingGemini ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                {importingGemini ? "Importing..." : `Import ${geminiSelected.size} conversation${geminiSelected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </section>
        )}

        {/* ── ChatGPT preview (below grid, only when a folder was scanned) ── */}
        {chatGptPreviews.length > 0 && (
          <section className="flex-1 min-h-[450px] max-w-4xl rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3 flex flex-col gap-3 overflow-hidden">
            {/* Destination Configuration */}
            <div className="shrink-0 flex flex-wrap items-center gap-4 border-b border-[var(--border-color)] pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--text-primary)]">Import Destination:</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setChatGptDestType("new")}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${chatGptDestType === "new" ? "border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]" : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                  >
                    New Workspace
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatGptDestType("existing")}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${chatGptDestType === "existing" ? "border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]" : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                  >
                    Existing Workspace
                  </button>
                </div>
              </div>

              {chatGptDestType === "new" ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[var(--text-secondary)]">Workspace Name:</span>
                  <input
                    type="text"
                    value={chatGptNewWorkspaceName}
                    onChange={(e) => setChatGptNewWorkspaceName(e.target.value)}
                    placeholder="ChatGPT Import"
                    className="rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)] w-56"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[var(--text-secondary)]">Select Workspace:</span>
                  <div className="relative">
                    <select
                      value={chatGptWorkspaceId ?? ""}
                      onChange={(e) => setChatGptWorkspaceId(e.target.value || null)}
                      className="appearance-none cursor-pointer rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] pl-2 pr-8 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                    >
                      <option value="">Choose a workspace…</option>
                      {workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  </div>
                </div>
              )}
            </div>

            <ImportConversationPreview
              conversations={chatGptPreviews}
              selected={chatGptSelected}
              onSelectionChange={setChatGptSelected}
              focusedUuid={focusedChatGptUuid}
              onFocusChange={setFocusedChatGptUuid}
              assistantLabel="ChatGPT"
            />
            
            <div className="shrink-0 flex items-center justify-end gap-2">
              <button
                onClick={() => resetChatGptPreview()}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <X size={12} /> Cancel
              </button>
              <button
                onClick={() => void importFromChatGptFolder()}
                disabled={
                  chatGptSelected.size === 0 ||
                  importingChatGpt ||
                  (chatGptDestType === "existing" && !chatGptWorkspaceId) ||
                  (chatGptDestType === "new" && !chatGptNewWorkspaceName.trim())
                }
                className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent-color)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                {importingChatGpt ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                {importingChatGpt ? "Importing..." : `Import ${chatGptSelected.size} conversation${chatGptSelected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </section>
        )}

        {/* ── Claude Desktop detail (below grid, flex-fill) ──────────────────── */}
        {claudeFolderPath && claudeFilesFound && (
          <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto pr-1">
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
                    <span className={`text-xs ${item.available ? "text-[var(--text-primary)]" : "text-[var(--text-muted)] line-through"}`}>
                      {item.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* ── Per-project rows ─────────────────────────────── */}
            {claudeProjects.length > 0 && (
              <div className={`flex flex-col gap-2 ${projectsSectionOpen ? "flex-1 min-h-[400px]" : ""}`}>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setProjectsSectionOpen((v) => !v)}
                    className="flex items-center gap-1 text-xs font-medium text-[var(--text-primary)]"
                    aria-expanded={projectsSectionOpen}
                  >
                    {projectsSectionOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    Projects ({claudeSelectedFolders.size}/{claudeProjects.length})
                  </button>
                  {projectsSectionOpen && (
                    <div className="flex gap-2">
                      <button onClick={() => setClaudeSelectedProjects(new Set(claudeProjects.map((p) => p.uuid)))} className="text-xs text-[var(--accent-color)] hover:underline">All</button>
                      <button onClick={() => setClaudeSelectedProjects(new Set())} className="text-xs text-[var(--text-muted)] hover:underline">None</button>
                    </div>
                  )}
                </div>

                {projectsSectionOpen && (<>
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
                    <div className="relative">
                      <select
                        value={bulkParentId ?? ""}
                        onChange={(e) => setBulkParentId(e.target.value || null)}
                        className="appearance-none cursor-pointer rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] pl-2 pr-7 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                      >
                        <option value="">Select workspace…</option>
                        {rootWorkspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                      <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    </div>
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
                                  <div className="relative">
                                    <select
                                      value={dest.parentId ?? ""}
                                      onChange={(e) => setProjectDestinations((prev) => ({ ...prev, [proj.uuid]: { ...dest, parentId: e.target.value || null, subWorkspaceId: null } }))}
                                      className="appearance-none cursor-pointer rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] pl-2 pr-7 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                                    >
                                      <option value="">Select workspace…</option>
                                      {rootWorkspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                                    </select>
                                    <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                                  </div>
                                )}
                                {dest.type === "folder-in-sub" && (
                                  <div className="relative">
                                    <select
                                      value={dest.subWorkspaceId ?? ""}
                                      disabled={!dest.parentId}
                                      onChange={(e) => setProjectDestinations((prev) => ({ ...prev, [proj.uuid]: { ...dest, subWorkspaceId: e.target.value || null } }))}
                                      className="appearance-none cursor-pointer rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] pl-2 pr-7 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)] disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                      <option value="">{dest.parentId ? (subWsOptions.length ? "Select sub-workspace…" : "No sub-workspaces yet") : "Pick workspace first"}</option>
                                      {subWsOptions.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                                    </select>
                                    <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                                  </div>
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
                </>)}
              </div>
            )}

            {/* ── Previously imported chats (merge automatically) ── */}
            {Object.keys(claudeLinked).length > 0 && (
              <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2">
                <button
                  type="button"
                  onClick={() => setLinkedListOpen((v) => !v)}
                  className="flex w-full items-center justify-between text-xs text-[var(--text-primary)]"
                >
                  <span>
                    {Object.keys(claudeLinked).length} chat{Object.keys(claudeLinked).length === 1 ? " was" : "s were"} imported before and will merge automatically.
                    {Object.keys(claudeKnownDests).length > 0 && (
                      <span className="ml-1 text-[var(--text-muted)]">Remembered destinations will be reused.</span>
                    )}
                  </span>
                  <ChevronDown size={12} className={`shrink-0 transition-transform ${linkedListOpen ? "rotate-180" : ""}`} />
                </button>
                {linkedListOpen && (
                  <ul className="mt-2 max-h-48 overflow-y-auto flex flex-col gap-0.5">
                    {Object.values(claudeLinked).map((info) => (
                      <li key={info.source_conversation_uuid} className="truncate text-[11px] text-[var(--text-secondary)]">
                        {info.title}
                        <span className="text-[var(--text-muted)]">
                          {" — "}{info.workspace_name}{info.folder_name ? ` / ${info.folder_name}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* ── Conversation assignment table ─────────────────── */}
            {claudeOrphans.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                {(() => {
                  const assignedTotal = Object.values(chatAssignments).filter((p) => !!p).length;
                  const unassignedTotal = claudeOrphans.length - assignedTotal;
                  const projectsByUuid = new Map(claudeProjects.map((p) => [p.uuid, p] as const));
                  // Destination name for an assignment/suggestion key — a real
                  // Claude project or a proposed new workspace.
                  const nameForKey = (key: string): string =>
                    projectsByUuid.get(key)?.name ?? proposedGroups[key]?.name ?? "?";
                  // The review table shows EVERY orphan (assigned rows keep
                  // their destination pre-selected) so the user can see what
                  // was classified; the filter narrows to the leftovers.
                  const searchQuery = rowSearch.trim().toLowerCase();
                  const matchesSearch = (c: ClaudeConvPreview) =>
                    !searchQuery ||
                    c.name.toLowerCase().includes(searchQuery) ||
                    (c.first_user_message ?? "").toLowerCase().includes(searchQuery) ||
                    (c.summary ?? "").toLowerCase().includes(searchQuery);
                  const reviewRows = (rowFilter === "unassigned"
                    ? claudeOrphans.filter((c) => !chatAssignments[c.uuid])
                    : claudeOrphans
                  ).filter(matchesSearch);
                  // Render cap: at 1k-10k chats a full list stalls the DOM.
                  const ROW_CAP = 300;
                  const visibleRows = reviewRows.slice(0, ROW_CAP);
                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[var(--text-primary)]">
                          Unassigned conversations ({unassignedTotal} of {claudeOrphans.length} · {assignedTotal} already routed to projects)
                          {topicCoverage && (
                            <span className="ml-2 font-normal text-[var(--text-muted)]">
                              topics generated for {topicCoverage.enriched}/{topicCoverage.total} projects
                            </span>
                          )}
                        </span>
                        <div className="flex gap-2">
                          {claudeOrphans.length >= 1 && (
                            <div ref={matchModelMenuRef} className="relative">
                              {/* Split button: primary action + chevron for dropdown */}
                              <div className="flex items-center rounded border border-[var(--border-color)] overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() => void runTopicMatch()}
                                  disabled={claudeEmbeddingMatching || claudeScanning}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-[var(--accent-color)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:pointer-events-none transition-colors"
                                  title={`Summarises each project's instructions into topic keywords, then re-matches every chat locally. Cost scales with projects (${claudeProjects.length}), not chats — expect a few minutes. ${importMatchModel ? `Using: ${importMatchModel}` : "Using your configured chat/background model"}`}
                                >
                                  {claudeEmbeddingMatching ? <RefreshCw size={11} className="animate-spin" /> : null}
                                  {claudeEmbeddingMatching ? "Matching\u2026" : "Improve with AI matching"}
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!showMatchModelMenu && availableMatchModels.length === 0) {
                                      try {
                                        // Fetch chat/background models (not embedding models)
                                        const models = await api.ollama.listModels();
                                        setAvailableMatchModels(models.map((m) => m.name));
                                      } catch { /* ignore */ }
                                    }
                                    setShowMatchModelMenu((v) => !v);
                                  }}
                                  disabled={claudeEmbeddingMatching || claudeScanning}
                                  className="border-l border-[var(--border-color)] px-1 py-0.5 text-[var(--accent-color)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:pointer-events-none transition-colors"
                                  aria-label="AI matching options"
                                >
                                  <ChevronDown size={10} />
                                </button>
                              </div>
                              {showMatchModelMenu && (
                                <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-lg py-1">
                                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Model</div>
                                  {[
                                    { label: "Configured chat model", value: "" },
                                    ...availableMatchModels.map((m) => ({ label: m, value: m })),
                                  ].map((opt) => (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      onClick={() => {
                                        setImportMatchModel(opt.value);
                                        setShowMatchModelMenu(false);
                                      }}
                                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] flex items-center gap-2 ${
                                        importMatchModel === opt.value ? "text-[var(--accent-color)]" : "text-[var(--text-primary)]"
                                      }`}
                                    >
                                      {importMatchModel === opt.value && <Check size={11} />}
                                      <span className={importMatchModel === opt.value ? "" : "ml-[15px]"}>{opt.label}</span>
                                    </button>
                                  ))}
                                  <div className="my-1 border-t border-[var(--border-color)]" />
                                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Matching</div>
                                  {([
                                    { label: "Strict — only clear winners", value: "strict" as const },
                                    { label: "Balanced (default)", value: "balanced" as const },
                                    { label: "Loose — assign more, review more", value: "loose" as const },
                                  ]).map((opt) => (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      onClick={() => {
                                        setMatchStrictness(opt.value);
                                        setShowMatchModelMenu(false);
                                        void (async () => {
                                          try {
                                            await api.settings.updateOne("import.match_strictness", opt.value);
                                          } catch { /* matcher falls back to balanced */ }
                                          void runTopicMatch({ rerunAll: true });
                                        })();
                                      }}
                                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] flex items-center gap-2 ${
                                        matchStrictness === opt.value ? "text-[var(--accent-color)]" : "text-[var(--text-primary)]"
                                      }`}
                                    >
                                      {matchStrictness === opt.value && <Check size={11} />}
                                      <span className={matchStrictness === opt.value ? "" : "ml-[15px]"}>{opt.label}</span>
                                    </button>
                                  ))}
                                  <div className="my-1 border-t border-[var(--border-color)]" />
                                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Actions</div>
                                  <button
                                    type="button"
                                    onClick={() => void runTopicMatch({ rerunAll: true })}
                                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ml-0"
                                  >
                                    Re-run all matching
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void runEmbeddingMatch()}
                                    title={`Classifies each chat individually — roughly ${Math.ceil(unassignedTotal / 10)} AI calls. Slower, but can catch chats topics miss.`}
                                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ml-0"
                                  >
                                    Classify each chat (slow)
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void proposeNewWorkspaces()}
                                    disabled={clusterProposing || unassignedTotal === 0}
                                    title="Groups the remaining unassigned chats into proposed NEW workspaces. One AI call per chat — expect minutes on large exports."
                                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ml-0 disabled:opacity-40 disabled:pointer-events-none"
                                  >
                                    {clusterProposing ? "Grouping…" : "Propose new workspaces for leftovers"}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => void exportReviewForAi()}
                            title="Export projects and these conversations (with transcripts, assignments, and the app's suggestions) as JSON, to hand to an external AI for analysis."
                            className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                          >
                            <Download size={11} />
                            Export for AI
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
                      {matchSummary && (
                        <div className="flex items-start justify-between gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5">
                          <span className="text-[11px] text-emerald-500">{matchSummary}</span>
                          <button
                            type="button"
                            onClick={() => setMatchSummary(null)}
                            className="shrink-0 text-[11px] text-emerald-500/70 hover:text-emerald-500"
                            aria-label="Dismiss matching summary"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      )}
                      {matchWarning && (
                        <div className="flex items-start justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
                          <span className="text-[11px] text-amber-500">{matchWarning}</span>
                          <button
                            type="button"
                            onClick={() => setMatchWarning(null)}
                            className="shrink-0 text-[11px] text-amber-500/70 hover:text-amber-500"
                            aria-label="Dismiss matching warning"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      )}
                      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-[var(--text-muted)]">
                            Assigned chats import to their pre-selected destination; the rest go to &ldquo;Unassigned Imports&rdquo;. Change any row that&rsquo;s wrong.
                          </span>
                          <div className="flex items-center gap-2">
                            <input
                              type="search"
                              value={rowSearch}
                              onChange={(e) => setRowSearch(e.target.value)}
                              placeholder="Filter conversations…"
                              className="w-44 rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                            />
                            <button
                              type="button"
                              onClick={() => setRowFilter((f) => (f === "all" ? "unassigned" : "all"))}
                              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline decoration-dotted"
                              title="Toggle between every reviewable chat and only the still-unassigned ones"
                            >
                              {rowFilter === "all" ? "showing: all" : "showing: unassigned only"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setOrphansExpanded((p) => !p)}
                              className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                            >
                              {orphansExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              {reviewRows.length} conversation{reviewRows.length === 1 ? "" : "s"}
                            </button>
                          </div>
                        </div>
                        {orphansExpanded && reviewRows.length > 0 && (
                          <div className="mt-2 max-h-96 overflow-y-auto rounded-md border border-[var(--border-color)]">
                            {visibleRows.map((conv) => {
                              const assigned = chatAssignments[conv.uuid] ?? null;
                              const ticked = claudeSelected.has(conv.uuid);
                              const suggestion = claudeSuggestions.find((s) => s.conversation_uuid === conv.uuid);
                              const suggestedProj = suggestion?.project_uuid ? projectsByUuid.get(suggestion.project_uuid) : null;
                              const previewOpen = previewConvUuid === conv.uuid;
                              // Generic-named chats (empty or literal "Untitled") get a
                              // snippet from the summary / opener so the row is identifiable.
                              const snippet = isGenericConversationName(conv.name) ? conversationGist(conv, 120) : "";
                              return (
                                <div key={conv.uuid} className="border-b border-[var(--border-color)] last:border-b-0">
                                <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg-hover)]">
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
                                    <button
                                      type="button"
                                      onClick={() => setPreviewConvUuid(previewOpen ? null : conv.uuid)}
                                      className="truncate text-left text-[11px] text-[var(--text-primary)] hover:underline"
                                      title="Toggle chat preview"
                                    >
                                      {claudeLinkedUnassigned[conv.uuid] && (
                                        <span
                                          className="mr-1 rounded bg-[var(--bg-elevated)] px-1 py-0.5 text-[9px] text-[var(--text-muted)]"
                                          title="This chat was imported before and still sits in Unassigned Imports — assigning it moves the existing chat."
                                        >
                                          imported, still unassigned
                                        </span>
                                      )}
                                      {conv.name || "Untitled"}
                                      {snippet && <span className="text-[var(--text-muted)]"> — {snippet}</span>}
                                    </button>
                                    {(suggestedProj || (suggestion?.alternates.length ?? 0) > 0) && (
                                      <span className="truncate text-[10px] text-[var(--text-muted)]">
                                        {suggestedProj
                                          ? `suggested: ${suggestedProj.name} (${suggestion?.reason})`
                                          : "no confident match"}
                                        {(suggestion?.alternates ?? []).map((alt) => (
                                          <span key={alt.project_uuid}>
                                            {" · also: "}{nameForKey(alt.project_uuid)} {Math.round(alt.score * 100)}%
                                          </span>
                                        ))}
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setPreviewConvUuid(previewOpen ? null : conv.uuid)}
                                    className={`shrink-0 rounded p-0.5 ${previewOpen ? "text-[var(--accent-color)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
                                    aria-label={previewOpen ? "Hide chat preview" : "Show chat preview"}
                                    aria-expanded={previewOpen}
                                  >
                                    <Eye size={12} />
                                  </button>
                                  <div className="relative shrink-0 max-w-[180px]">
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
                                      className="w-full appearance-none cursor-pointer rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] pl-2 pr-7 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                                    >
                                      <option value="">— Unassigned —</option>
                                      <optgroup label="Claude projects">
                                        {claudeProjects.map((p) => (
                                          <option key={p.uuid} value={p.uuid}>{p.name}</option>
                                        ))}
                                      </optgroup>
                                      {Object.keys(proposedGroups).length > 0 && (
                                        <optgroup label="Proposed workspaces">
                                          {Object.entries(proposedGroups).map(([key, group]) => (
                                            <option key={key} value={key}>{group.name}</option>
                                          ))}
                                        </optgroup>
                                      )}
                                    </select>
                                    <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                                  </div>
                                  <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{conv.message_count} msg{conv.message_count === 1 ? "" : "s"}</span>
                                </div>
                                {previewOpen && (() => {
                                  const gist = conversationGist(conv);
                                  const gistIsAuto = !conv.summary?.trim() && !!gist;
                                  return (
                                  <div className="border-t border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2">
                                    {gist && (
                                      <p className="mb-2 whitespace-pre-wrap text-[11px] italic text-[var(--text-secondary)]">
                                        {gistIsAuto && (
                                          <span className="mr-1 rounded bg-[var(--bg-elevated)] px-1 py-0.5 text-[9px] not-italic text-[var(--text-muted)]">auto</span>
                                        )}
                                        {gist}
                                      </p>
                                    )}
                                    {conv.messages && conv.messages.length > 0 ? (
                                      <div className="max-h-64 overflow-y-auto rounded-md border border-[var(--border-color)]">
                                        {conv.messages.map((msg, i) => (
                                          <div key={i} className={`flex flex-col gap-0.5 border-b border-[var(--border-color)] px-3 py-2 last:border-b-0 ${msg.role === "user" ? "bg-[var(--bg-elevated)]" : "bg-[var(--bg-primary)]"}`}>
                                            <span className="text-[10px] font-medium text-[var(--text-muted)]">{msg.role === "user" ? "You" : "Claude"}</span>
                                            <p className="whitespace-pre-wrap text-[11px] text-[var(--text-secondary)]">{msg.content}</p>
                                          </div>
                                        ))}
                                      </div>
                                    ) : conv.first_user_message ? (
                                      <p className="whitespace-pre-wrap text-[11px] text-[var(--text-secondary)]">{conv.first_user_message}</p>
                                    ) : !gist ? (
                                      <p className="text-[11px] text-[var(--text-muted)]">No preview available for this chat.</p>
                                    ) : null}
                                  </div>
                                  );
                                })()}
                                </div>
                              );
                            })}
                            {reviewRows.length > ROW_CAP && (
                              <div className="border-t border-[var(--border-color)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
                                Showing {ROW_CAP} of {reviewRows.length} — use the filter or assign chats to narrow the list.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* ── Action row ───────────────────────────────────── */}
            {(claudeProjects.length > 0 || claudeOrphans.length > 0 || Object.keys(claudeLinked).length > 0) && (
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex flex-col gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2">
                  <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={claudeMergeExisting}
                      onChange={(e) => setClaudeMergeExisting(e.target.checked)}
                      className="accent-[var(--accent-color)]"
                    />
                    <span>
                      Merge re-imports — append new messages to existing chats instead of skipping duplicates.
                    </span>
                  </label>
                  <label className={`flex items-center gap-2 pl-5 text-[11px] ${claudeMergeExisting ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)] opacity-60"}`}>
                    <input
                      type="checkbox"
                      checked={claudeCloneEdited}
                      onChange={(e) => setClaudeCloneEdited(e.target.checked)}
                      disabled={!claudeMergeExisting}
                      className="accent-[var(--accent-color)]"
                    />
                    <span>
                      For chats edited locally, import the source as a new copy (preserves your edits).
                    </span>
                  </label>
                  {Object.keys(claudeLinked).length > 0 && (
                    <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                      <input
                        type="checkbox"
                        checked={claudeRestoreDestinations}
                        onChange={(e) => setClaudeRestoreDestinations(e.target.checked)}
                        className="accent-[var(--accent-color)]"
                      />
                      <span>
                        Move previously imported chats back to their original import location (default: leave them where they are now).
                      </span>
                    </label>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2">
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
                      && Object.keys(claudeLinked).length === 0
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
      {mergeChoiceState && (
        <MergeChoiceDialog
          conflictName={mergeChoiceState.conflictName}
          onChoice={(choice) => {
            setMergeChoiceState(null);
            mergeChoiceResolveRef.current?.(choice);
            mergeChoiceResolveRef.current = null;
          }}
        />
      )}
    </div>
  );
}

function MergeChoiceDialog({
  conflictName,
  onChoice,
}: {
  conflictName: string;
  onChoice: (choice: MergeChoice) => void;
}) {
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onChoice("cancel");
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onChoice]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => onChoice("cancel")}
    >
      <div
        className="mx-4 flex w-full max-w-md flex-col gap-5 rounded-3xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">Workspace already exists</h3>
          <p className="text-sm leading-6 text-[var(--text-secondary)]">
            A workspace named &ldquo;{conflictName}&rdquo; already exists. Merge conversations into the existing workspace, or rename this one?
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={() => onChoice("rename")}
            className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            Rename
          </button>
          <button
            onClick={() => onChoice("merge-this")}
            className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            Merge
          </button>
          <button
            onClick={() => onChoice("merge-all")}
            className="rounded-xl bg-[var(--accent-color)] px-4 py-2 text-sm text-white hover:opacity-90"
          >
            Merge All
          </button>
        </div>
      </div>
    </div>
  );
}
