/**
 * Typed IPC wrappers for all Tauri backend commands.
 * Mirrors the Rust #[tauri::command] functions in src-tauri/src/commands/.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { Workspace, Project } from "../stores/workspaceStore";
import type { ChatSession, Message } from "../stores/chatStore";

const OBSERVABILITY_ENABLED =
  typeof window !== "undefined" &&
  (window.location.protocol === "http:" || window.location.protocol === "https:");

type ObservabilityMeta = Record<string, unknown>;
const browserCrypto = globalThis.crypto;
const browserPerformance = globalThis.performance;

function createRequestId(): string {
  if (typeof browserCrypto !== "undefined" && typeof browserCrypto.randomUUID === "function") {
    return browserCrypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function logIpcEvent(level: "debug" | "error", message: string, payload: ObservabilityMeta): void {
  if (!OBSERVABILITY_ENABLED) {return;}
  // eslint-disable-next-line no-console
  const logger = level === "error" ? console.error : console.log;
  logger(`[ipc] ${message}`, payload);
}

function ipcSlowThresholdMs(command: string): number {
  switch (command) {
    case "send_message":
    case "send_dual_model_message":
    case "generate_title":
    case "generate_title_from_conversation":
    case "polish_prompt":
    case "generate_follow_ups":
    case "extract_topics":
      return 15_000;
    case "generate_embedding":
      return 3_000;
    case "list_models":
    case "list_models_fresh":
    case "ensure_ollama_running":
      return 1_500;
    default:
      return 5_000;
  }
}

function formatIpcSummary(
  status: "ok" | "slow" | "error" | "cache",
  command: string,
  meta: ObservabilityMeta,
): string {
  const parts = [`status=${status}`, `api=${command}`];
  if (typeof meta.model === "string") {parts.push(`model=${meta.model}`);}
  if (typeof meta.draftModel === "string") {parts.push(`draftModel=${meta.draftModel}`);}
  if (typeof meta.refineModel === "string") {parts.push(`refineModel=${meta.refineModel}`);}
  if (typeof meta.requestId === "string") {parts.push(`requestId=${meta.requestId}`);}
  if (typeof meta.sessionId === "string") {parts.push(`sessionId=${meta.sessionId}`);}
  if (typeof meta.durationMs === "number") {parts.push(`durationMs=${meta.durationMs}`);}
  return parts.join(" ");
}

async function invokeObserved<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  meta: ObservabilityMeta,
): Promise<T> {
  const requestId = typeof meta.requestId === "string" ? meta.requestId : createRequestId();
  const startedAt = browserPerformance.now();

  try {
    const result = await invoke<T>(command, args);
    const durationMs = Number((browserPerformance.now() - startedAt).toFixed(3));
    const status = durationMs >= ipcSlowThresholdMs(command) ? "slow" : "ok";
    logIpcEvent("debug", `<- ${command}`, {
      ...meta,
      requestId,
      durationMs,
      status,
      summary: formatIpcSummary(status, command, { ...meta, requestId, durationMs }),
    });
    return result;
  } catch (error) {
    const durationMs = Number((browserPerformance.now() - startedAt).toFixed(3));
    logIpcEvent("error", `xx ${command}`, {
      ...meta,
      requestId,
      durationMs,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      summary: formatIpcSummary("error", command, { ...meta, requestId, durationMs }),
    });
    throw error;
  }
}

// ----- Types -----

export interface TopicTag {
  tag: string;
  weight: number;
  source: string;
}

export interface TopicSignature {
  domain_tags: TopicTag[];
  manual_tags: string[];
  ignored_tags: string[];
  intent_patterns: string[];
  generated_at: string | null;
  message_count_at_gen: number | null;
  ollama_enriched: boolean;
}

export interface WorkspaceSuggestion {
  workspace_id: string;
  workspace_name: string;
  score: number;
}

export interface WorkspaceMatchResult {
  current_score: number;
  is_match: boolean;
  suggestion: WorkspaceSuggestion | null;
}

export interface LearningGoal {
  id: string; workspace_id: string; title: string; goal_description: string;
  progress: number; is_completed: boolean; due_date?: string;
  prerequisite_ids: string[]; related_chat_ids: string[];
  created_at: string; updated_at: string;
}

export interface ConceptNode {
  id: string; workspace_id: string; name: string; concept_description: string;
  concept_type: string; tags: string[]; aliases: string[];
  x_position: number; y_position: number; review_count: number;
  hierarchy_level: string;
  created_at: string; updated_at: string;
}

export interface ConceptLink {
  id: string; source_id: string; target_id: string;
  link_type: string; strength: number; context: string; created_at: string;
}

export interface LearningCard {
  id: string; workspace_id: string; front: string; back: string;
  source_type: string; source_id?: string; ease_factor: number; interval: number;
  repetitions: number; next_review_date: string; last_reviewed_at?: string;
  created_at: string;
}

export interface ReviewStats {
  total_cards: number; due_today: number; learned: number; avg_ease: number;
}

export interface ProjectNote {
  id: string; workspace_id: string; title: string; content: string;
  note_type: string; tags: string[]; created_at: string; updated_at: string;
}

export interface DailyNote {
  id: string; workspace_id: string; date: string; content: string;
  mood?: number; productivity?: number; created_at: string; updated_at: string;
}

export interface NoteTemplate {
  id: string; workspace_id: string; name: string; content: string;
  icon: string; is_built_in: boolean; created_at: string; updated_at: string;
}

export interface UploadedDocument {
  id: string; workspace_id: string; filename: string; file_type: string;
  file_size: number; content: string; summary?: string; is_processed: boolean;
  chunk_count?: number; created_at: string; updated_at: string;
}

export interface Source {
  id: string; workspace_id: string; source_type: string; title: string;
  filename?: string; file_type?: string; file_size?: number; url?: string;
  content: string; summary?: string; favicon_data?: string; is_processed: boolean;
  folder?: string; token_count?: number;
  chunk_count?: number; created_at: string; updated_at: string;
}

export interface SearchResult {
  id: string; result_type: string; title: string; excerpt: string;
  score: number; source_id?: string; project_id?: string;
}

export interface QuickSearchResult {
  doc_id: string;
  target_id: string;
  kind: "conversation" | "message" | "artifact" | "memory" | "summary" | string;
  title: string;
  subtitle: string;
  excerpt: string;
  workspace_id?: string | null;
  workspace_name: string;
  project_id?: string | null;
  project_name?: string | null;
  session_id?: string | null;
  source_session_id?: string | null;
  updated_at: string;
  score: number;
  recent: boolean;
}

export interface QuickSearchContext {
  preferred_workspace_id?: string | null;
}

export interface OllamaModelDetails { parameter_size?: string; }
export interface OllamaModel { name: string; size?: number; modified_at?: string; details?: OllamaModelDetails; capabilities?: string[]; }
export interface OllamaRuntimeStatus {
  available: boolean;
  launched: boolean;
  message: string;
  models: OllamaModel[];
}

// ----- Model list cache -----
let modelCache: { promise: Promise<OllamaModel[]>; url: string | undefined; ts: number } | null = null;
const MODEL_CACHE_TTL = 30_000; // 30 seconds

function cachedListModels(ollamaUrl?: string): Promise<OllamaModel[]> {
  const now = Date.now();
  if (modelCache && modelCache.url === ollamaUrl && now - modelCache.ts < MODEL_CACHE_TTL) {
    logIpcEvent("debug", "cache hit list_models", {
      command: "list_models",
      layer: "frontend-cache",
      ollamaUrl,
      ageMs: now - modelCache.ts,
      status: "cache",
      summary: formatIpcSummary("cache", "list_models", {
        ollamaUrl,
        ageMs: now - modelCache.ts,
      }),
    });
    return modelCache.promise;
  }
  const requestId = createRequestId();
  const promise = invokeObserved<OllamaModel[]>(
    "list_models",
    { ollamaUrl, requestId },
    {
      requestId,
      layer: "tauri-ipc",
      provider: "ollama",
      ollamaUrl,
    },
  );
  modelCache = { promise, url: ollamaUrl, ts: now };
  promise.catch(() => {
    if (modelCache?.promise === promise) {modelCache = null;}
  });
  return promise;
}

export interface Artifact {
  id: string;
  workspace_id: string;
  session_id: string | null;
  message_id: string | null;
  title: string;
  artifact_type: string;
  language: string;
  content: string;
  description: string;
  tags: string; // JSON string
  is_pinned: boolean;
  version: number;
  parent_artifact_id: string | null;
  token_count: number;
  created_at: string;
  updated_at: string;
}

export interface ArtifactSummary {
  id: string;
  title: string;
  artifact_type: string;
  language: string;
  description: string;
  tags: string[];
  is_pinned: boolean;
  version: number;
  updated_at: string;
}

export interface ConversationSummary {
  id: string;
  session_id: string;
  workspace_id: string;
  summary_type: string;
  content: string;
  key_topics: string;
  message_range_start: number;
  message_range_end: number;
  token_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateArtifactRequest {
  workspace_id: string;
  session_id?: string | null;
  message_id?: string | null;
  title: string;
  artifact_type: string;
  language: string;
  content: string;
  description: string;
  tags?: string[];
  parent_artifact_id?: string | null;
}

export interface BackgroundTaskEvent {
  task_type: string;
  status: 'started' | 'processing' | 'completed' | 'failed';
  message: string;
}

export interface GraphStatistics {
  id: string; workspace_id?: string; total_concepts: number;
  total_links: number; avg_degree: number; density: number; updated_at: string;
}

export interface AppSettings {
  preferred_model: string; backup_enabled: boolean; touch_id_enabled: boolean; pin_lock_enabled: boolean;
  auto_lock_minutes: number; theme: string; accent_color: string;
  font_size: number; sidebar_width: number; ollama_base_url: string;
  auto_start_ollama: boolean;
  mlx_base_url: string;
  llamacpp_model_paths: string[];
  background_model: string;
  quick_search_models: string[];
  quick_search_shortcut: string;
  quick_search_workspace_scope: string;
  quick_search_type_filters: string[];
  embedding_model: string;
  chat_title_auto_refresh: "disabled" | "initial_only" | "periodic";
  chat_title_refresh_interval: number;
  chat_json_storage: boolean;
  chat_encryption_enabled: boolean;
  web_session_preserve: boolean;
  dual_model_enabled: boolean;
  draft_model: string;
  dual_model_execution_mode: "serial" | "parallel";
  compare_model_a: string;
  compare_model_b: string;
  start_at_login: boolean;
  open_in_background: boolean;
  keep_running_in_tray: boolean;
  immediate_delete: boolean;
  confirm_move_to_trash: boolean;
  prompt_instructions: string;
  switch_workspace_section: string;
  hide_native_menu: boolean;
  show_gen_info: boolean;
  show_gen_info_token_count: boolean;
  show_gen_info_duration: boolean;
  show_gen_info_speed: boolean;
  show_gen_info_model: boolean;
  demo_dismissed: boolean;
  memory_enabled: boolean;
}

export interface GitSyncStatus {
  enabled: boolean;
  remote_url: string;
  last_synced_at: string;
  last_error: string;
}

export interface LogEntry {
  id: number;
  timestamp: string;
  level: string;
  source: string;
  message: string;
  metadata: string;
}

export interface SecurityStatus {
  pin_enabled: boolean;
  pin_lock_enabled: boolean;
  touch_id_enabled: boolean;
  biometric_available: boolean;
  biometric_label: string;
}

export interface BacklinkEntry {
  source_type: string; source_id: string; context: string; concept_name: string;
}

export interface RetrievedChunk {
  chunk_id: string; document_id: string; filename: string;
  content: string; score: number; chunk_index: number;
}

export interface CalendarAlarm {
  id: string; workspace_id?: string; title: string; fire_date: string;
  duration_seconds: number; input_prompt: string; is_dismissed: boolean;
  created_at: string;
}

export interface StreamEvent { session_id: string; chunk: string; done: boolean; tokens_used?: number; duration_ms?: number; }

export interface ThoughtItem {
  id: string; workspace_id: string; content: string;
  status: 'pending' | 'scheduled' | 'processing' | 'done';
  process_at?: string; model_name: string; prompt_prefix: string;
  result?: string; result_at?: string; session_id?: string;
  created_at: string; updated_at: string;
}

export interface Memory {
  id: string;
  workspace_id?: string | null;
  content: string;
  memory_type: "fact" | "preference" | "context" | string;
  scope: "global" | "workspace";
  source_session_id?: string | null;
  is_pinned: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AnalysisResult {
  concepts_created: number;
  links_created: number;
  concepts_skipped: number;
  chapters_created: number;
  sections_created: number;
}

export interface LearningPathItem {
  concept_id: string;
  concept_name: string;
  concept_description: string;
  hierarchy_path: string;
  met_prereqs: number;
  unmet_prereqs: number;
}

export interface SuggestedGoal {
  title: string;
  description: string;
  related_concepts: string[];
}

export interface AiModel {
  id: string; name: string; model_id: string; provider: string;
  role_tags: string[];
  priority: number; is_paid: boolean; enabled: boolean; is_hidden: boolean;
  tokens_used_total: number; created_at: string;
}

export interface ModelSpeedStat {
  model_name: string;
  avg_chat_tokens_per_second: number;
  weighted_tokens_per_second: number;
  chat_count: number;
}

export interface SystemSpecs {
  host_name?: string | null;
  os_name: string;
  os_version?: string | null;
  kernel_version?: string | null;
  cpu_brand: string;
  cpu_arch: string;
  logical_cores: number;
  physical_cores?: number | null;
  total_memory_bytes: number;
  available_memory_bytes: number;
  total_swap_bytes: number;
  gpu_name?: string | null;
  gpu_memory_bytes?: number | null;
  gpu_detection_source?: string | null;
}

/** Lightweight snapshot polled every few seconds for the status bar. */
export interface PerformanceStats {
  /** Global CPU usage across all cores, 0–100. */
  cpu_usage_percent: number;
  /** RAM currently in use (bytes). */
  memory_used_bytes: number;
  /** Total physical RAM (bytes). */
  memory_total_bytes: number;
  /** GPU VRAM in use (bytes). null when unavailable. */
  gpu_vram_used_bytes: number | null;
  /** Total GPU VRAM (bytes). null when unavailable. */
  gpu_vram_total_bytes: number | null;
  /** GPU display name. null when unavailable. */
  gpu_name: string | null;
  /**
   * True when gpu_vram_used_bytes reflects live usage (nvidia-smi on Linux/Windows).
   * False when only total capacity is known (macOS system_profiler).
   */
  gpu_vram_usage_available: boolean;
}

export interface DashboardRoute {
  path: string;
  state?: Record<string, unknown> | null;
}

export interface DashboardOverview {
  chat_sessions: number;
  notes: number;
  sources: number;
  concepts: number;
  flashcards: number;
  active_goals: number;
  completed_goals: number;
}

export interface DashboardContinueLearning {
  session_id: string;
  title: string;
  project_id?: string | null;
  project_name?: string | null;
  updated_at: string;
  route: DashboardRoute;
}

export interface DashboardConceptFocus {
  concept_id: string;
  name: string;
  review_count: number;
  reason: string;
  route: DashboardRoute;
}

export interface DashboardReviewSummary {
  due_today: number;
  total_cards: number;
  learned: number;
  avg_ease: number;
  under_reviewed_concepts: number;
  weak_concepts: DashboardConceptFocus[];
  route: DashboardRoute;
}

export interface DashboardGoalSummary {
  id: string;
  title: string;
  progress: number;
  is_completed: boolean;
  due_date?: string | null;
  updated_at: string;
  route: DashboardRoute;
}

export interface DashboardSuggestion {
  id: string;
  kind: string;
  title: string;
  description: string;
  route: DashboardRoute;
}

export interface DashboardKnowledgeHealth {
  stalled_goals: number;
  unprocessed_sources: number;
  isolated_concepts: number;
  active_topic_tags: string[];
}

export interface DashboardActivity {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  timestamp: string;
  route: DashboardRoute;
}

export interface DashboardSummary {
  workspace_id: string;
  workspace_name: string;
  overview: DashboardOverview;
  continue_learning?: DashboardContinueLearning | null;
  review: DashboardReviewSummary;
  goals: DashboardGoalSummary[];
  progression: DashboardSuggestion[];
  knowledge_health: DashboardKnowledgeHealth;
  recent_activity: DashboardActivity[];
}

// ----- Workspaces -----
export const api = {
  topicSignature: {
    get: (workspaceId: string) => invoke<TopicSignature>("get_topic_signature", { workspaceId }),
    regenerate: (workspaceId: string, model?: string, ollamaUrl?: string) => invoke<TopicSignature>("regenerate_topic_signature", { workspaceId, model, ollamaUrl }),
    update: (workspaceId: string, manual_tags: string[], ignored_tags: string[]) =>
      invoke<TopicSignature>("update_topic_signature", {
        workspaceId,
        manualTags: manual_tags,
        ignoredTags: ignored_tags,
      }),
    checkMatch: (workspaceId: string, message: string) => invoke<WorkspaceMatchResult>("check_workspace_match", { workspaceId, message }),
  },
  
  workspace: {
    create: (name: string, description?: string) => invoke<Workspace>("create_workspace", { req: { name, description } }),
    createChild: (parentId: string, name: string, description?: string) => invoke<Workspace>("create_child_workspace", { req: { parent_id: parentId, name, description } }),
    list: () => invoke<Workspace[]>("list_workspaces"),
    listRoots: () => invoke<Workspace[]>("list_root_workspaces"),
    listChildren: (parentId: string) => invoke<Workspace[]>("list_child_workspaces", { parentId }),
    listHidden: () => invoke<Workspace[]>("list_hidden_workspaces"),
    get: (id: string) => invoke<Workspace | null>("get_workspace", { id }),
    update: (id: string, name: string, description?: string, promptInstructions?: string) => invoke<void>("update_workspace", { req: { id, name, description, prompt_instructions: promptInstructions } }),
    setParent: (id: string, parentId: string | null) => invoke<void>("set_workspace_parent", { id, parentId }),
    delete: (id: string) => invoke<void>("delete_workspace", { id }),
    updateIcon: (id: string, icon: string) => invoke<void>("update_workspace_icon", { id, icon }),
    recommendIcon: (workspaceName: string, workspaceDescription: string) => invoke<string>("recommend_workspace_icon", { workspaceName, workspaceDescription }),
    hide: (id: string) => invoke<void>("hide_workspace", { id }),
    unhide: (id: string) => invoke<void>("unhide_workspace", { id }),
    reorder: (ids: string[]) => invoke<void>("reorder_workspaces", { ids }),
  },

  project: {
    create: (workspaceId: string, name: string, opts?: Partial<{ project_description: string; custom_instructions: string; color: string; icon: string }>) =>
      invoke<Project>("create_project", { req: { workspace_id: workspaceId, name, ...opts } }),
    list: (workspaceId: string) => invoke<Project[]>("list_projects", { workspaceId }),
    get: (id: string) => invoke<Project | null>("get_project", { id }),
    update: (id: string, fields: Partial<Project>) => invoke<void>("update_project", { req: { id, ...fields } }),
    delete: (id: string) => invoke<void>("delete_project", { id }),
    moveToWorkspace: (projectId: string, targetWorkspaceId: string) => invoke<Project>("move_project_to_workspace", { projectId, targetWorkspaceId }),
    getStats: (id: string) => invoke<{ note_count: number; document_count: number; chat_session_count: number; flashcard_count: number; web_capture_count: number }>("get_project_stats", { id }),
  },

  dashboard: {
    getSummary: (workspaceId: string) => invoke<DashboardSummary>("get_dashboard_summary", { workspaceId }),
  },

  chat: {
    createSession: (workspaceId: string, projectId?: string | null, opts?: { title?: string; modelName?: string; systemPrompt?: string; is_incognito?: boolean; exclude_from_analytics?: boolean }) =>
      invoke<ChatSession>("create_chat_session", { req: { workspace_id: workspaceId, project_id: projectId ?? '', title: opts?.title, model_name: opts?.modelName, system_prompt: opts?.systemPrompt, is_incognito: opts?.is_incognito, exclude_from_analytics: opts?.exclude_from_analytics } }),
    listSessions: (workspaceId: string, projectId?: string | null, opts?: { limit?: number; offset?: number }) =>
      invoke<ChatSession[]>("list_chat_sessions", { workspaceId, projectId: projectId ?? '', limit: opts?.limit, offset: opts?.offset }),
    getRelatedChats: (workspaceId: string, tags: string[], sessionId?: string, limit?: number) =>
      invoke<QuickSearchResult[]>("get_related_chats", { req: { workspace_id: workspaceId, tags, session_id: sessionId, limit } }),
    searchSessions: (workspaceId: string, query: string, projectId?: string | null) =>
      invoke<ChatSession[]>("search_chat_sessions", { req: { workspace_id: workspaceId, query, project_id: projectId ?? null } }),
    getSession: (workspaceId: string, id: string) => invoke<ChatSession | null>("get_chat_session", { workspaceId, id }),
    deleteSession: (workspaceId: string, id: string) => invoke<void>("delete_chat_session", { workspaceId, id }),
    updateSession: (workspaceId: string, id: string, fields: { title?: string; is_pinned?: boolean; system_prompt?: string; model_name?: string }) =>
      invoke<void>("update_chat_session", { workspaceId, id, title: fields.title, isPinned: fields.is_pinned, systemPrompt: fields.system_prompt, modelName: fields.model_name }),
    moveSessions: (sessionIds: string[], targetWorkspaceId: string, targetProjectId?: string) =>
      invoke<void>("move_chat_sessions", { sessionIds, targetWorkspaceId, targetProjectId }),
    batchMoveSessions: (sessionIds: string[], targetWorkspaceId: string, preserveFolderStructure: boolean) =>
      invoke<{ sessions_moved: number; projects_created: string[]; project_mapping: Record<string, string> }>(
        "batch_move_sessions",
        { req: { session_ids: sessionIds, target_workspace_id: targetWorkspaceId, preserve_folder_structure: preserveFolderStructure } }
      ),
    listDeletedSessions: (workspaceId: string) => invoke<ChatSession[]>("list_deleted_chat_sessions", { workspaceId }),
    restoreSession: (workspaceId: string, id: string) => invoke<void>("restore_chat_session", { workspaceId, id }),
    hardDeleteSession: (workspaceId: string, id: string) => invoke<void>("hard_delete_chat_session", { workspaceId, id }),
    emptyRecycleBin: (workspaceId: string) => invoke<void>("empty_recycle_bin", { workspaceId }),
    addMessage: (workspaceId: string, sessionId: string, role: "user" | "assistant", content: string, modelName?: string, tokensUsed?: number, durationMs?: number) =>
      invoke<Message>("add_message", { req: { workspace_id: workspaceId, session_id: sessionId, role, content, model_name: modelName, tokens_used: tokensUsed, duration_ms: durationMs } }),
    getMessages: (workspaceId: string, sessionId: string, limit?: number, offset?: number) => invoke<Message[]>("get_messages", { sessionId, limit, offset }),
    refreshMessage: (sessionId: string, messageId: string, modelId: string) =>
      invoke<Message>("refresh_message", { sessionId, messageId, modelId }),
    getMessageVariants: (messageId: string) =>
      invoke<Message[]>("get_message_variants", { messageId }),
    getTokenUsageByDate: (workspaceId: string, days?: number) =>
      invoke<{ day: string; total_tokens: number }[]>("get_token_usage_by_date", { workspaceId, days }),
    touchSessionAccessed: (sessionId: string) =>
      invoke<void>("touch_session_accessed", { sessionId }),
    getRecentSessions: (workspaceId: string, limit?: number) =>
      invoke<ChatSession[]>("get_recent_sessions", { workspaceId, limit }),
    convertToNote: (sessionId: string, ollamaUrl?: string) =>
      invoke<ProjectNote>("convert_chat_to_note", { req: { session_id: sessionId, ollama_url: ollamaUrl } }),
    convertToDocument: (sessionId: string, ollamaUrl?: string) =>
      invoke<Source>("convert_chat_to_document", { req: { session_id: sessionId, ollama_url: ollamaUrl } }),
  },

  chatFile: {
    getInfo: () => invoke<{ chats_dir: string; encryption_enabled: boolean }>("get_chat_file_info"),
    reveal: (sessionId: string) => invoke<void>("reveal_chat_file", { sessionId }),
    setupEncryption: (passphrase: string) => invoke<number>("setup_chat_encryption", { passphrase }),
    disableEncryption: () => invoke<number>("disable_chat_encryption"),
    exportAsJson: (sessionId: string, destPath: string) =>
      invoke<void>("export_chat_as_json", { sessionId, destPath }),
    importFromJson: (path: string, workspaceId: string, projectId?: string | null, passphrase?: string) =>
      invoke<ChatSession>("import_chat_from_json", { path, workspaceId, projectId: projectId ?? null, passphrase }),
    syncAll: () => invoke<number>("sync_all_chats_to_files"),
    previewLmStudioFolder: (folderPath: string) =>
      invoke<{
        conversations: {
          uuid: string;
          name: string;
          message_count: number;
          created_at: string;
          updated_at: string;
          project_id: string | null;
          project_name: string | null;
          source_path: string;
        }[];
        total: number;
        projects: {
          uuid: string;
          name: string;
          conversation_count: number;
          message_count: number;
        }[];
        errors: number;
        error_messages: string[];
      }>("preview_lmstudio_folder", { folderPath }),
    importLmStudioFolder: (folderPath: string, workspaceName?: string, selectedIds?: string[], selectedProjectIds?: string[]) =>
      invoke<{
        imported: number;
        skipped: number;
        workspace_id: string;
        workspace_name: string;
        projects_created: number;
        errors: number;
        error_messages: string[];
      }>("import_lmstudio_folder", {
        folderPath,
        workspaceName: workspaceName ?? null,
        selectedIds: selectedIds ?? null,
        selectedProjectIds: selectedProjectIds ?? null,
      }),
    importMultipleFolders: (folderPaths: string[]) =>
      invoke<{
        total_folders: number;
        successful: number;
        total_imported: number;
        total_skipped: number;
        total_errors: number;
        results: Array<{
          folder_path: string;
          workspace_name?: string;
          workspace_id?: string;
          status: "success" | "error" | "warning";
          message?: string;
          imported?: number;
          skipped?: number;
          projects_created?: number;
          errors?: number;
        }>;
      }>("import_multiple_folders", { folderPaths }),
    importGeminiTakeout: (filePath: string, workspaceName?: string) =>
      invoke<{
        imported_sessions: number;
        imported_messages: number;
        workspace_id: string;
        workspace_name: string;
      }>("import_gemini_takeout", { filePath, workspaceName: workspaceName ?? null }),
    importClaudeDesktop: (filePath: string, workspaceName?: string, selectedIds?: string[], selectedProjectIds?: string[], importMemories?: boolean) =>
      invoke<{
        imported: number;
        skipped: number;
        workspace_id: string;
        workspace_name: string;
        projects_created: number;
        memories_imported: number;
        errors: number;
        error_messages: string[];
      }>("import_claude_desktop", { filePath, workspaceName: workspaceName ?? null, selectedIds: selectedIds ?? null, selectedProjectIds: selectedProjectIds ?? null, importMemories: importMemories ?? false }),
    previewClaudeDesktop: (filePath: string) =>
      invoke<{
        conversations: { uuid: string; name: string; message_count: number; created_at: string; updated_at: string }[];
        total: number;
        projects: { uuid: string; name: string; description: string; has_prompt: boolean; doc_count: number }[];
        memories: {
          conversations_memory: string;
          project_memories: { project_uuid: string; project_name: string; memory: string }[];
        } | null;
      }>("preview_claude_desktop", { filePath }),
    importClaudeProjects: (filePath: string, selectedIds?: string[]) =>
      invoke<{
        created: number;
        skipped: number;
        total: number;
      }>("import_claude_projects", { filePath, selectedIds: selectedIds ?? null }),
    previewClaudeProjects: (filePath: string) =>
      invoke<{
        projects: { uuid: string; name: string; description: string; has_prompt: boolean; prompt_preview: string | null }[];
        total: number;
      }>("preview_claude_projects_file", { filePath }),
  },

  security: {
    getStatus: () => invoke<SecurityStatus>("get_security_status"),
    setPin: (newPin: string, currentPin?: string) => invoke<void>("set_pin_passcode", { newPin, currentPin }),
    verifyPin: (pin: string) => invoke<boolean>("verify_pin_passcode", { pin }),
    removePin: (currentPin: string) => invoke<void>("remove_pin_passcode", { currentPin }),
    authenticateBiometric: () => invoke<boolean>("authenticate_biometric"),
  },

  graph: {
    createConcept: (workspaceId: string, name: string, opts?: Partial<ConceptNode>) =>
      invoke<ConceptNode>("create_concept", { req: { workspace_id: workspaceId, name, ...opts } }),
    listConcepts: (workspaceId: string, limit?: number, offset?: number) => invoke<ConceptNode[]>("list_concepts", { workspaceId, limit, offset }),
    getConcept: (id: string) => invoke<ConceptNode | null>("get_concept", { id }),
    updateConcept: (id: string, fields: Partial<ConceptNode>) => invoke<void>("update_concept", { id, ...fields }),
    deleteConcept: (id: string) => invoke<void>("delete_concept", { id }),
    createLink: (sourceId: string, targetId: string, linkType?: string, strength?: number) =>
      invoke<ConceptLink>("create_concept_link", { req: { source_id: sourceId, target_id: targetId, link_type: linkType, strength } }),
    listLinks: (workspaceId: string, limit?: number, offset?: number) => invoke<ConceptLink[]>("list_concept_links", { workspaceId, limit, offset }),
    deleteLink: (id: string) => invoke<void>("delete_concept_link", { id }),
    getStats: (workspaceId: string) => invoke<GraphStatistics>("get_graph_stats", { workspaceId }),
    getLearningPath: (workspaceId: string) => invoke<LearningPathItem[]>("get_learning_path", { workspaceId }),
    extractConcepts: (workspaceId: string, text: string, sourceType: string, sourceId: string) =>
      invoke<{ created: string[]; existing: string[]; mentions_recorded: number }>(
        "extract_and_link_concepts",
        { req: { workspace_id: workspaceId, text, source_type: sourceType, source_id: sourceId } },
      ),
  },

  learningGoal: {
    create: (workspaceId: string, title: string) =>
      invoke<LearningGoal>("create_learning_goal", { req: { workspace_id: workspaceId, title } }),
    list: (workspaceId: string) => invoke<LearningGoal[]>("list_learning_goals", { workspaceId }),
    update: (id: string, fields: Partial<LearningGoal>) =>
      invoke<void>("update_learning_goal", { req: { id, ...fields } }),
    delete: (id: string) => invoke<void>("delete_learning_goal", { id }),
  },

  flashcard: {
    create: (workspaceId: string, front: string, back: string) =>
      invoke<LearningCard>("create_flashcard", { req: { workspace_id: workspaceId, front, back } }),
    listDue: (workspaceId: string, opts?: { limit?: number; offset?: number }) =>
      invoke<LearningCard[]>("list_flashcards_due", { workspaceId, limit: opts?.limit, offset: opts?.offset }),
    review: (cardId: string, quality: number) =>
      invoke<LearningCard>("review_flashcard", { req: { card_id: cardId, quality } }),
    getStats: (workspaceId: string) => invoke<ReviewStats>("get_review_stats", { workspaceId }),
    generate: (workspaceId: string, topic: string, model: string, count?: number, ollamaUrl?: string) =>
      invoke<LearningCard[]>("generate_flashcards", { req: { workspace_id: workspaceId, topic, model, count, ollama_url: ollamaUrl } }),
    generateFromConcept: (workspaceId: string, conceptId: string, model: string, count?: number, ollamaUrl?: string) =>
      invoke<LearningCard[]>("generate_flashcards_from_concept", { req: { workspace_id: workspaceId, concept_id: conceptId, model, count, ollama_url: ollamaUrl } }),
    listByConcept: (conceptId: string) =>
      invoke<LearningCard[]>("list_flashcards_by_concept", { conceptId }),
    listGraph: (workspaceId: string) =>
      invoke<LearningCard[]>("list_graph_flashcards", { workspaceId }),
    extractFromContent: (workspaceId: string, content: string, sourceType: string, model: string, sourceId?: string, ollamaUrl?: string) =>
      invoke<LearningCard[]>("extract_flashcards_from_content", { req: { workspace_id: workspaceId, content, source_type: sourceType, source_id: sourceId, model, ollama_url: ollamaUrl } }),
  },

  note: {
    create: (workspaceId: string, title: string, content?: string) =>
      invoke<ProjectNote>("create_note", { req: { workspace_id: workspaceId, title, content } }),
    list: (workspaceId: string, opts?: { limit?: number; offset?: number }) =>
      invoke<ProjectNote[]>("list_notes", { workspaceId, limit: opts?.limit, offset: opts?.offset }),
    get: (id: string) => invoke<ProjectNote | null>("get_note", { id }),
    update: (id: string, fields: Partial<ProjectNote>) => invoke<void>("update_note", { req: { id, ...fields } }),
    delete: (id: string) => invoke<void>("delete_note", { id }),
    getDailyNote: (workspaceId: string, date?: string) =>
      invoke<DailyNote>("get_or_create_daily_note", { req: { workspace_id: workspaceId, date } }),
    updateDailyNote: (id: string, content?: string, mood?: number, productivity?: number) =>
      invoke<void>("update_daily_note", { id, content, mood: mood !== undefined ? mood : null, productivity: productivity !== undefined ? productivity : null }),
    listDailyNotesInRange: (workspaceId: string, startDate: string, endDate: string) =>
      invoke<DailyNote[]>("list_daily_notes_in_range", { workspaceId, startDate, endDate }),
    listTemplates: (workspaceId: string) => invoke<NoteTemplate[]>("list_templates", { workspaceId }),
    createTemplate: (workspaceId: string, name: string, content: string) =>
      invoke<NoteTemplate>("create_template", { workspaceId, name, content }),
    deleteTemplate: (id: string) => invoke<void>("delete_template", { id }),
    updateTemplate: (id: string, fields: { name?: string; content?: string; icon?: string }) =>
      invoke<void>("update_template", { id, ...fields }),
    applyTemplate: (templateId: string, extraVars?: Record<string, string>) =>
      invoke<string>("apply_template", { templateId, extraVars: extraVars ?? {} }),
    getBacklinks: (workspaceId: string, conceptName: string) =>
      invoke<BacklinkEntry[]>("get_backlinks", { workspaceId, conceptName }),
    getOutboundLinks: (noteId: string) =>
      invoke<string[]>("get_note_outbound_links", { noteId }),
  },

  document: {
    upload: (workspaceId: string, filename: string, fileType: string, fileSize: number, content: string) =>
      invoke<UploadedDocument>("upload_document", { req: { workspace_id: workspaceId, filename, file_type: fileType, file_size: fileSize, content } }),
    list: (workspaceId: string) => invoke<UploadedDocument[]>("list_documents", { workspaceId }),
    get: (id: string) => invoke<UploadedDocument | null>("get_document", { id }),
    delete: (id: string) => invoke<void>("delete_document", { id }),
    process: (documentId: string) => invoke<number>("process_document", { req: { document_id: documentId } }),
  },

  source: {
    create: (req: { workspace_id: string; source_type: string; title: string; filename?: string; file_type?: string; file_size?: number; url?: string; content: string; summary?: string; folder?: string }) =>
      invoke<Source>("create_source", { req }),
    list: (workspaceId: string, sourceType?: string) =>
      invoke<Source[]>("list_sources", { workspaceId, sourceType }),
    get: (id: string) => invoke<Source | null>("get_source", { id }),
    update: (id: string, fields: { title?: string; summary?: string; is_processed?: boolean; folder?: string }) =>
      invoke<void>("update_source", { id, ...fields }),
    delete: (id: string) => invoke<void>("delete_source", { id }),
    process: (id: string) => invoke<number>("process_source", { id }),
  },

  search: {
    keyword: (query: string, workspaceId: string, projectId?: string) =>
      invoke<SearchResult[]>("keyword_search", { req: { query, workspace_id: workspaceId, project_id: projectId } }),
    semantic: (query: string, workspaceId: string, queryEmbedding: number[]) =>
      invoke<SearchResult[]>("semantic_search", { req: { query, workspace_id: workspaceId }, queryEmbedding, workspaceId }),
  },

  quickSearch: {
    show: () => invoke<void>("show_quick_search"),
    hide: () => invoke<void>("hide_quick_search"),
    query: (
      query: string,
      options?: {
        limit?: number;
        workspaceId?: string | null;
        kindFilters?: string[] | null;
      },
    ) =>
      invoke<QuickSearchResult[]>("query_quick_search", {
        req: {
          query,
          limit: options?.limit,
          workspace_id: options?.workspaceId ?? null,
          kind_filters: options?.kindFilters ?? null,
        },
      }),
    getContext: () => invoke<QuickSearchContext>("get_quick_search_context"),
    openResult: (result: QuickSearchResult) =>
      invoke<void>("open_quick_search_result", { result }),
    markMainWindowReady: () => invoke<void>("mark_main_window_ready"),
  },

  context: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assembleAndSend: (sessionId: string, workspaceId: string, modelName: string, options?: Record<string, any>) =>
      invoke<string>("assemble_and_send", { req: { session_id: sessionId, workspace_id: workspaceId, model_name: modelName, options: options || {} } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listenContextSources: (sessionId: string, onSources: (sources: any) => void): Promise<UnlistenFn> =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      listen<any>(`context-sources-${sessionId}`, (event) => onSources(event.payload)),
  },

  artifact: {
    create: (req: CreateArtifactRequest) => invoke<Artifact>("create_artifact", { req }),
    list: (workspace_id: string, limit?: number, offset?: number) => invoke<ArtifactSummary[]>("list_artifacts", { workspaceId: workspace_id, limit, offset }),
    get: (id: string) => invoke<Artifact>("get_artifact", { id }),
    update: (id: string, updates: Partial<CreateArtifactRequest & { is_pinned: boolean }>) => invoke<void>("update_artifact", { id, updates }),
    delete: (id: string) => invoke<void>("delete_artifact", { id }),
    versions: (id: string) => invoke<ArtifactSummary[]>("get_artifact_versions", { id }),
    search: (workspace_id: string, query: string) => invoke<ArtifactSummary[]>("search_artifacts", { workspaceId: workspace_id, query }),
    createVersion: (parentId: string, content: string) => invoke<Artifact>("create_artifact_version", { parentId, content }),
  },

  summary: {
    generate: (session_id: string, workspace_id: string, summary_type: string) => 
      invoke<void>("generate_summary", { sessionId: session_id, workspaceId: workspace_id, summaryType: summary_type }),
    list: (session_id: string) => invoke<ConversationSummary[]>("list_summaries", { sessionId: session_id }),
  },

  ollama: {
    sendMessage: (sessionId: string, model: string, messages: { role: string; content: string }[], stream: boolean, ollamaUrl?: string) => {
      const requestId = createRequestId();
      return invokeObserved<string>(
        "send_message",
        {
          req: {
            session_id: sessionId,
            model,
            messages,
            stream,
            ollama_url: ollamaUrl,
            request_id: requestId,
          },
        },
        {
          requestId,
          layer: "tauri-ipc",
          provider: "ollama",
          sessionId,
          model,
          stream,
          messageCount: messages.length,
          ollamaUrl,
        },
      );
    },
    sendDualModelMessage: (
      sessionId: string,
      draftModel: string,
      refineModel: string,
      messages: { role: string; content: string }[],
      executionMode: "serial" | "parallel",
      ollamaUrl?: string
    ) => {
      const requestId = createRequestId();
      return invokeObserved<string>(
        "send_dual_model_message",
        {
          req: {
            session_id: sessionId,
            draft_model: draftModel,
            refine_model: refineModel,
            messages,
            execution_mode: executionMode,
            ollama_url: ollamaUrl,
            request_id: requestId,
          },
        },
        {
          requestId,
          layer: "tauri-ipc",
          provider: "ollama",
          sessionId,
          draftModel,
          refineModel,
          executionMode,
          messageCount: messages.length,
          ollamaUrl,
        },
      );
    },
    listModels: (ollamaUrl?: string) => cachedListModels(ollamaUrl),
    /** Bypass cache and fetch fresh model list from Ollama */
    listModelsFresh: (ollamaUrl?: string) => {
      modelCache = null;
      const requestId = createRequestId();
      const promise = invokeObserved<OllamaModel[]>(
        "list_models_fresh",
        { ollamaUrl, requestId },
        {
          requestId,
          layer: "tauri-ipc",
          provider: "ollama",
          ollamaUrl,
          cacheBypassed: true,
        },
      );
      modelCache = { promise, url: ollamaUrl, ts: Date.now() };
      promise.catch(() => { if (modelCache?.promise === promise) { modelCache = null; } });
      return promise;
    },
    ensureRunning: (ollamaUrl?: string) => {
      const requestId = createRequestId();
      return invokeObserved<OllamaRuntimeStatus>(
        "ensure_ollama_running",
        { ollamaUrl, requestId },
        {
          requestId,
          layer: "tauri-ipc",
          provider: "ollama",
          ollamaUrl,
        },
      );
    },
    generateTitle: (model: string, firstMessage: string, ollamaUrl?: string) => {
      const requestId = createRequestId();
      return invokeObserved<string>(
        "generate_title",
        { model, firstMessage, ollamaUrl, requestId },
        {
          requestId,
          layer: "tauri-ipc",
          provider: "ollama",
          model,
          stream: false,
          ollamaUrl,
        },
      );
    },
    generateTitleFromConversation: (model: string, conversation: { role: string; content: string }[], ollamaUrl?: string) => {
      const requestId = createRequestId();
      return invokeObserved<string>(
        "generate_title_from_conversation",
        { model, conversation, ollamaUrl, requestId },
        {
          requestId,
          layer: "tauri-ipc",
          provider: "ollama",
          model,
          stream: false,
          messageCount: conversation.length,
          ollamaUrl,
        },
      );
    },
    polishPrompt: (model: string, prompt: string, ollamaUrl?: string) => {
      const requestId = createRequestId();
      return invokeObserved<string>(
        "polish_prompt",
        { req: { model, prompt, ollama_url: ollamaUrl, request_id: requestId } },
        {
          requestId,
          layer: "tauri-ipc",
          provider: "ollama",
          model,
          stream: false,
          promptLength: prompt.length,
          ollamaUrl,
        },
      );
    },
    extractTopics: (texts: string[], model: string, ollamaUrl?: string) => {
      const requestId = createRequestId();
      return invokeObserved<{ topic: string; weight: number }[]>(
        "extract_topics",
        { texts, model, ollamaUrl, requestId },
        {
          requestId,
          layer: "tauri-ipc",
          provider: "ollama",
          model,
          textCount: texts.length,
          ollamaUrl,
        },
      );
    },
    generateEmbedding: (text: string, model?: string, ollamaUrl?: string) => {
      const requestId = createRequestId();
      return invokeObserved<number[]>(
        "generate_embedding",
        { req: { text, model, ollama_url: ollamaUrl, request_id: requestId } },
        {
          requestId,
          layer: "tauri-ipc",
          provider: "ollama",
          model,
          inputLength: text.length,
          ollamaUrl,
        },
      );
    },
    generateFollowUps: (model: string, messages: { role: string; content: string }[], ollamaUrl?: string) => {
      const requestId = createRequestId();
      return invokeObserved<string[]>(
        "generate_follow_ups",
        { model, messages, ollamaUrl, requestId },
        {
          requestId,
          layer: "tauri-ipc",
          provider: "ollama",
          model,
          messageCount: messages.length,
          ollamaUrl,
        },
      );
    },
    stopStream: (sessionId: string) => invoke<void>("stop_stream", { sessionId }),
  },

  mlx: {
    sendMessage: (sessionId: string, model: string, messages: { role: string; content: string }[], mlxUrl?: string) =>
      invoke<string>("send_mlx_message", { req: { session_id: sessionId, model, messages, mlx_url: mlxUrl } }),
    listModels: (mlxUrl?: string) =>
      invoke<{ id: string }[]>("list_mlx_models", { mlxUrl }),
    stopStream: (sessionId: string) => invoke<void>("stop_stream", { sessionId }),
  },

  llamacpp: {
    sendMessage: (sessionId: string, modelPath: string, messages: { role: string; content: string }[]) =>
      invoke<void>("send_llamacpp_message", { req: { session_id: sessionId, model_path: modelPath, messages } }),
    listModels: (modelPaths: string[]) =>
      invoke<string[]>("list_llamacpp_models", { modelPaths }),
    stopStream: (sessionId: string) =>
      invoke<void>("stop_llamacpp_stream", { sessionId }),
  },

  export: {
    markdown: (workspaceId: string) => invoke<string>("export_markdown", { req: { workspace_id: workspaceId } }),
    json: (workspaceId: string) => invoke<string>("export_json", { req: { workspace_id: workspaceId } }),
    obsidian: (workspaceId: string) => invoke<Array<{ path: string; content: string }>>("export_obsidian_vault", { req: { workspace_id: workspaceId } }),
  },

  backup: {
    create: (workspaceId: string) => invoke<string>("create_backup", { workspaceId }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    list: () => invoke<any[]>("list_backups"),
    restore: (backupJson: string) => invoke<string>("restore_backup", { backupJson }),
    delete: (id: string) => invoke<void>("delete_backup", { id }),
    createGlobal: () => invoke<string>("create_global_backup"),
    restoreGlobal: (backupJson: string) => invoke<string[]>("restore_global_backup", { backupJson }),
  },

  settings: {
    get: () => invoke<AppSettings>("get_settings"),
    update: (settings: AppSettings) => invoke<void>("update_settings", { settings }),
  },

  graphAlgo: {
    pagerank: (workspaceId: string, damping?: number, iterations?: number) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invoke<any[]>("compute_pagerank", { workspaceId, damping, iterations }),
    communities: (workspaceId: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invoke<any[]>("detect_communities", { workspaceId }),
    shortestPath: (workspaceId: string, sourceId: string, targetId: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invoke<any>("find_shortest_path", { workspaceId, sourceId, targetId }),
  },

  demo: {
    activate: () => invoke<string>("activate_demo_mode"),
    deactivate: () => invoke<void>("deactivate_demo_mode"),
  },

  alarm: {
    create: (title: string, fireDate: string, workspaceId?: string) =>
      invoke<CalendarAlarm>("create_alarm", { req: { title, fire_date: fireDate, workspace_id: workspaceId } }),
    list: (workspaceId?: string) => invoke<CalendarAlarm[]>("list_alarms", { workspaceId }),
    delete: (id: string) => invoke<void>("delete_alarm", { id }),
  },

  webCapture: {
    create: (workspaceId: string, url: string, title: string, content: string, summary?: string) =>
      invoke<{ id: string; workspace_id: string; url: string; title: string; content: string; summary?: string; is_processed: boolean; created_at: string }>(
        "create_web_capture", { workspaceId, url, title, content, summary }
      ),
    list: (workspaceId: string, opts?: { limit?: number; offset?: number }) =>
      invoke<{ id: string; workspace_id: string; url: string; title: string; content: string; summary?: string; is_processed: boolean; created_at: string }[]>(
        "list_web_captures", { workspaceId, limit: opts?.limit, offset: opts?.offset }
      ),
    get: (id: string) =>
      invoke<{ id: string; workspace_id: string; url: string; title: string; content: string; summary?: string; is_processed: boolean; created_at: string } | null>(
        "get_web_capture", { id }
      ),
    delete: (id: string) => invoke<void>("delete_web_capture", { id }),
    update: (id: string, fields: { title?: string; summary?: string; is_processed?: boolean }) =>
      invoke<void>("update_web_capture", { id, ...fields }),
  },

  aiModel: {
    list: () => invoke<AiModel[]>("list_ai_models"),
    listSpeedStats: () => invoke<ModelSpeedStat[]>("list_model_speed_stats"),
    add: (name: string, modelId: string, opts?: { provider?: string; role_tags?: string[]; is_paid?: boolean; priority?: number; enabled?: boolean; is_hidden?: boolean }) =>
      invoke<AiModel>("add_ai_model", { req: { name, model_id: modelId, ...opts } }),
    update: (id: string, fields: { name?: string; role_tags?: string[]; priority?: number; is_paid?: boolean; enabled?: boolean; is_hidden?: boolean }) =>
      invoke<AiModel>("update_ai_model", { req: { id, ...fields } }),
    delete: (id: string) => invoke<void>("delete_ai_model", { id }),
    getDefault: () => invoke<AiModel>("get_default_model"),
    recordTokenUsage: (modelId: string, provider: string, tokens: number) =>
      invoke<void>("record_model_token_usage", { modelId, provider, tokens }),
  },

  system: {
    getSpecs: () => invoke<SystemSpecs>("get_system_specs"),
    getPerformanceStats: () => invoke<PerformanceStats>("get_performance_stats"),
    toggleDevtools: () => invoke<void>("toggle_devtools"),
    openPreferencesWindow: (singleInstance = false) =>
      invoke<void>("open_preferences_window", { singleInstance }),
  },

  knowledge: {
    analyzeWorkspace: (workspaceId: string, model: string, opts?: { ollamaUrl?: string; focusTopic?: string }) =>
      invoke<AnalysisResult>("analyze_workspace", {
        req: {
          workspace_id: workspaceId,
          model,
          ollama_url: opts?.ollamaUrl,
          focus_topic: opts?.focusTopic,
        },
      }),
    suggestGoals: (workspaceId: string, model: string, ollamaUrl?: string) =>
      invoke<SuggestedGoal[]>("suggest_learning_goals", {
        req: { workspace_id: workspaceId, model, ollama_url: ollamaUrl },
      }),
  },

  thoughtQueue: {
    create: (workspaceId: string, content: string, opts?: { processAt?: string; modelName?: string; promptPrefix?: string; sessionId?: string }) =>
      invoke<ThoughtItem>("create_thought", {
        req: { workspace_id: workspaceId, content, process_at: opts?.processAt, model_name: opts?.modelName, prompt_prefix: opts?.promptPrefix, session_id: opts?.sessionId },
      }),
    list: (workspaceId: string) => invoke<ThoughtItem[]>("list_thoughts", { workspaceId }),
    listBySession: (sessionId: string) => invoke<ThoughtItem[]>("list_thoughts_by_session", { sessionId }),
    getDue: (workspaceId: string) => invoke<ThoughtItem[]>("get_due_thoughts", { workspaceId }),
    updateStatus: (id: string, status: string) => invoke<void>("update_thought_status", { id, status }),
    updateResult: (id: string, result: string) => invoke<void>("update_thought_result", { id, result }),
    delete: (id: string) => invoke<void>("delete_thought", { id }),
  },

  memory: {
    create: (content: string, scope: Memory["scope"], memoryType?: Memory["memory_type"], workspaceId?: string, sourceSessionId?: string) =>
      invoke<Memory>("create_memory", {
        req: {
          workspace_id: scope === "global" ? null : workspaceId,
          content,
          memory_type: memoryType,
          scope,
          source_session_id: sourceSessionId,
        },
      }),
    list: (workspaceId: string) => invoke<Memory[]>("list_memories", { workspaceId }),
    listGlobal: () => invoke<Memory[]>("list_global_memories"),
    listActive: (workspaceId: string) => invoke<Memory[]>("get_active_memories", { workspaceId }),
    update: (id: string, fields: { content?: string; memory_type?: Memory["memory_type"]; is_pinned?: boolean; is_active?: boolean }) =>
      invoke<Memory>("update_memory", { req: { id, ...fields } }),
    delete: (id: string) => invoke<void>("delete_memory", { id }),
  },

  webAI: {
    /** Send a query to a web AI provider via the Playwright bridge. */
    sendMessage: (sessionId: string, provider: string, query: string, preserveSession: boolean) =>
      invoke<string>("send_web_message", { sessionId: sessionId, provider, query, preserveSession }),
    stopStream: (sessionId: string) =>
      invoke<void>("stop_web_stream", { sessionId }),
  },

  // Streaming: listen to Ollama stream events for a session
  listenStream: (sessionId: string, onChunk: (chunk: string, done: boolean, tokensUsed?: number, durationMs?: number) => void): Promise<UnlistenFn> =>
    listen<StreamEvent>(`ollama-stream-${sessionId}`, (event) => {
      onChunk(event.payload.chunk, event.payload.done, event.payload.tokens_used, event.payload.duration_ms);
    }),

  // Streaming: listen to the refine (large model) events for a dual-model session
  listenRefineStream: (sessionId: string, onChunk: (chunk: string, done: boolean, tokensUsed?: number, durationMs?: number) => void): Promise<UnlistenFn> =>
    listen<StreamEvent>(`ollama-refine-${sessionId}`, (event) => {
      onChunk(event.payload.chunk, event.payload.done, event.payload.tokens_used, event.payload.duration_ms);
    }),

  listenBackgroundTask: (onEvent: (event: BackgroundTaskEvent) => void): Promise<UnlistenFn> =>
    listen<BackgroundTaskEvent>("background-task", (event) => {
      onEvent(event.payload);
    }),

  mcp: {
    listServers: () => invoke<MCPServerConfig[]>("list_mcp_servers", {}),
    addServer: (name: string, command: string, args: string[], workspaceId: string) =>
      invoke<MCPServerConfig>("add_mcp_server", { name, command, args, workspaceId }),
    updateServer: (name: string, command: string, args: string[], enabled: boolean) =>
      invoke<void>("update_mcp_server", { name, command, args, enabled }),
    deleteServer: (name: string) =>
      invoke<void>("delete_mcp_server", { name }),
    connectServer: (serverName: string) =>
      invoke<void>("mcp_connect_server", { serverName }),
    disconnectServer: (serverName: string) =>
      invoke<void>("mcp_disconnect_server", { serverName }),
    listTools: (serverName: string) =>
      invoke<MCPTool[]>("mcp_list_tools", { serverName }),
    callTool: (serverName: string, toolName: string, toolArguments: Record<string, unknown>) =>
      invoke<string>("mcp_call_tool", { serverName, toolName, arguments: toolArguments }),
    listResources: (serverName: string) =>
      invoke<[MCPResource[], MCPResourceTemplate[]]>("mcp_list_resources", { serverName }),
    readResource: (serverName: string, uri: string) =>
      invoke<string>("mcp_read_resource", { serverName, uri }),
  },

  gitSync: {
    getStatus: () => invoke<GitSyncStatus>("get_git_sync_status"),
    configure: (remoteUrl: string, enabled: boolean) =>
      invoke<void>("configure_git_sync", { remoteUrl, enabled }),
    triggerSync: () => invoke<GitSyncStatus>("trigger_git_sync"),
  },

  logs: {
    get: (opts?: { level?: string; source?: string; search?: string; before?: string; after?: string; limit?: number; offset?: number }) =>
      invoke<LogEntry[]>("get_logs", { req: opts ?? {} }),
    getSources: () => invoke<string[]>("get_log_sources"),
    clear: (before?: string) => invoke<number>("clear_logs", { before }),
    logFrontendEvent: (level: string, source: string, message: string, metadata?: string) =>
      invoke<void>("log_frontend_event", { req: { level, source, message, metadata } }),
  },
};

export interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  workspace_id: string;
  created_at: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mime_type?: string;
}

export interface MCPResourceTemplate {
  uri_template: string;
  name: string;
  description?: string;
  mime_type?: string;
}

export const mcp = {
  // Server management
  listServers: () => invoke<MCPServerConfig[]>("list_mcp_servers", {}),
  addServer: (name: string, command: string, args: string[], workspaceId: string) =>
    invoke<MCPServerConfig>("add_mcp_server", { name, command, args, workspaceId }),
  updateServer: (name: string, command: string, args: string[], enabled: boolean) =>
    invoke<void>("update_mcp_server", { name, command, args, enabled }),
  deleteServer: (name: string) =>
    invoke<void>("delete_mcp_server", { name }),
  connectServer: (serverName: string) =>
    invoke<void>("mcp_connect_server", { serverName }),
  disconnectServer: (serverName: string) =>
    invoke<void>("mcp_disconnect_server", { serverName }),

  // Tool discovery and invocation
  listTools: (serverName: string) =>
    invoke<MCPTool[]>("mcp_list_tools", { serverName }),
  callTool: (serverName: string, toolName: string, toolArguments: Record<string, unknown>) =>
    invoke<string>("mcp_call_tool", { serverName, toolName, arguments: toolArguments }),

  // Resource discovery and access
  listResources: (serverName: string) =>
    invoke<[MCPResource[], MCPResourceTemplate[]]>("mcp_list_resources", { serverName }),
  readResource: (serverName: string, uri: string) =>
    invoke<string>("mcp_read_resource", { serverName, uri }),
};
