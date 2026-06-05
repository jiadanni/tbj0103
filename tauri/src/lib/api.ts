/**
 * Typed IPC wrappers for all Tauri backend commands.
 * Mirrors the Rust #[tauri::command] functions in src-tauri/src/commands/.
 */
import { invoke as _rawTauriInvoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { Workspace, Folder } from "../stores/workspaceStore";
import type { ChatSession, Message } from "../stores/chatStore";
import { timed } from "./perf";

// IPC observability is always on so we can see queue stalls and slow commands
// in the dev terminal. Output is `console.log`/`console.error`, which Tauri
// pipes to stderr in dev mode, alongside Rust log lines.
const OBSERVABILITY_ENABLED = typeof window !== "undefined";

type ObservabilityMeta = Record<string, unknown>;
const browserCrypto = globalThis.crypto;
const browserPerformance = globalThis.performance;

function createRequestId(): string {
  if (typeof browserCrypto !== "undefined" && typeof browserCrypto.randomUUID === "function") {
    return browserCrypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Workspace context provider registered by the workspace store at startup.
// Decoupled via a setter to avoid a circular import (workspaceStore -> api.ts).
type WorkspaceLogContext = { workspaceId?: string; parentWorkspaceId?: string };
let workspaceContextProvider: (() => WorkspaceLogContext) | null = null;

export function setIpcWorkspaceContextProvider(provider: () => WorkspaceLogContext): void {
  workspaceContextProvider = provider;
}

function currentWorkspaceContext(): WorkspaceLogContext {
  try {
    return workspaceContextProvider?.() ?? {};
  } catch {
    return {};
  }
}

function logIpcEvent(level: "debug" | "error", message: string, payload: ObservabilityMeta): void {
  if (!OBSERVABILITY_ENABLED) {return;}
  // eslint-disable-next-line no-console
  const logger = level === "error" ? console.error : console.log;
  logger(`[ipc] ${message}`, { ...currentWorkspaceContext(), ...payload });
}

// Wrap every IPC so command duration is logged. `invoke` is the local name used
// throughout this file; the underlying Tauri call goes through `_rawTauriInvoke`.
// Slow commands (>= 50ms) and all errors are logged so queue stalls show up in
// the dev terminal alongside scheduler / ollama lines.
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const startedAt = browserPerformance.now();
  try {
    const result = await _rawTauriInvoke<T>(command, args);
    const durationMs = Number((browserPerformance.now() - startedAt).toFixed(1));
    if (durationMs >= 50) {
      logIpcEvent("debug", `<- ${command}`, { command, durationMs });
    }
    return result;
  } catch (error) {
    const durationMs = Number((browserPerformance.now() - startedAt).toFixed(1));
    logIpcEvent("error", `xx ${command}`, {
      command,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
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
    // Bypass the timed `invoke` wrapper so we don't double-log the same call.
    const result = await _rawTauriInvoke<T>(command, args);
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
  auto_detected_tags: TopicTag[];
  custom_tags: string[];
  excluded_tags: string[];
  intent_patterns: string[];
  generated_at: string | null;
  message_count_at_gen: number | null;
  ollama_enriched: boolean;
  suggested_prompts?: string[];
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

export interface PromptSuggestion {
  id: string;
  prompt: string;
  tags: string[];
  score: number;
}

export interface PromptBankJob {
  id: string;
  workspace_id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  target_count: number;
  generated_count: number;
  model: string;
  error?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface PromptBankStatus {
  prompt_count: number;
  active_job: PromptBankJob | null;
  latest_job: PromptBankJob | null;
}

export interface LearningGoal {
  id: string; workspace_id: string; title: string; goal_description: string;
  progress: number; is_completed: boolean; due_date?: string;
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

export interface ChangeProposal {
  id: string;
  workspace_id: string;
  job_id: string | null;
  proposal_type: string;
  target_node_id: string | null;
  payload: string;
  reason: string | null;
  created_at: string;
}

export interface RoadmapSnapshot {
  id: string;
  workspace_id: string;
  source_job_id: string | null;
  source_model: string | null;
  concept_count: number;
  link_count: number;
  created_at: string;
}

export interface KnowledgeSettings {
  upgrade_mode: string;
  supersede_mode: string;
  confidence_threshold: number;
}

export type KnowledgeResetScope = "workspace" | "workspace_with_children" | "all_workspaces";

export interface KnowledgeResetOptions {
  clear_graph?: boolean;
  clear_topic_signatures?: boolean;
  clear_prompt_bank?: boolean;
  clear_analysis_jobs?: boolean;
  clear_legacy_topics?: boolean;
  delete_generated_cards?: boolean;
}

export interface KnowledgeResetResult {
  dry_run: boolean;
  workspace_count: number;
  concept_nodes: number;
  concept_links: number;
  concept_mentions: number;
  graph_statistics: number;
  roadmap_snapshots: number;
  analyze_jobs: number;
  analyze_job_chunks: number;
  change_proposals: number;
  flashcard_topics: number;
  generated_cards_deleted: number;
  generated_cards_detached: number;
  learning_goals_detached: number;
  topic_signatures_cleared: number;
  prompt_bank_prompts: number;
  prompt_bank_jobs: number;
}

export interface LearningCard {
  id: string; workspace_id: string; front: string; back: string;
  source_type: string; source_id?: string; topic_id?: string;
  ease_factor: number; interval: number;
  repetitions: number; next_review_date: string; last_reviewed_at?: string;
  created_at: string;
}

export interface ReviewStats {
  total_cards: number; due_today: number; learned: number; avg_ease: number;
}

export interface FlashcardTopic {
  id: string; workspace_id: string; topic: string; source: string;
  mastery_score: number; last_generated_at?: string; card_count: number;
  parent_topic_id?: string | null;
}

export type QuizKind = "pop" | "exam";

export interface Quiz {
  id: string;
  workspace_id: string;
  kind: string;
  title: string;
  topic_ids: string[];
  topic_labels: string[];
  status: string;
  score?: number | null;
  question_count: number;
  chat_session_id?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export interface QuizQuestion {
  id: string;
  quiz_id: string;
  position: number;
  prompt: string;
  expected_answer: string;
  rubric: string;
  topic: string;
  created_at: string;
}

export interface QuizAnswer {
  id: string;
  quiz_id: string;
  question_id: string;
  user_answer: string;
  score?: number | null;
  feedback: string;
  graded_at?: string | null;
  created_at: string;
}

export interface QuizDetail {
  quiz: Quiz;
  questions: QuizQuestion[];
  answers: QuizAnswer[];
}

export interface QuizSummary {
  quiz: Quiz;
  answered_count: number;
  average_score?: number | null;
}

export interface SuggestedTopic {
  topic: FlashcardTopic;
  reason: string;
  due_count: number;
}

export interface SuggestedConcept {
  concept_id: string;
  concept_name: string;
  hierarchy_level: string;
  reason: string;
  due_count: number;
  avg_ease: number;
  card_count: number;
}

export interface ProjectNote {
  id: string; workspace_id: string; title: string; content: string;
  note_type: string; tags: string[]; is_pinned: boolean; created_at: string; updated_at: string;
  date?: string; mood?: number; productivity?: number; template_id?: string | null;
  folder?: string | null;
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
  score: number; source_id?: string; folder_id?: string;
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
  folder_id?: string | null;
  folder_name?: string | null;
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
  summary_type: "info" | "extensive";
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
  status: 'queued' | 'started' | 'processing' | 'completed' | 'failed' | 'cancelled';
  message: string;
  /** Model name being used for this job, when applicable. */
  model?: string;
  /** Workspace the job belongs to, when applicable. */
  workspace_id?: string;
}

export interface ActiveJob {
  task_type: string;
  workspace_id?: string;
  model?: string;
  started_at?: string;
  status: string;
}


/**
 * Emitted when a background job is gated on user confirmation (run-mode is
 * `confirm_only` or `dual_model`). The status bar shows a play button while
 * status is `"pending"`; subsequent statuses clear it.
 */
export interface BackgroundTaskPromptEvent {
  task_type: string;
  mode: 'confirm_only' | 'dual_model';
  status: 'pending' | 'dismissed' | 'confirmed' | 'cancelled';
  heavy_model?: string;
  small_model?: string;
  timeout_seconds: number;
}

export type BackgroundJobRunMode = 'auto' | 'confirm_only' | 'dual_model';

export interface ScheduledJobSetting {
  job_key: string;
  run_mode: BackgroundJobRunMode | string;
  heavy_model: string;
}

export interface ScheduledTaskSettings {
  jobs: ScheduledJobSetting[];
  confirm_timeout_seconds: number;
}

export interface WorkspaceGlossaryTerm {
  id: string;
  workspace_id: string;
  workspace_name?: string | null;
  term: string;
  normalized_term: string;
  definition: string;
  aliases: string[];
  source_kind: "manual" | "glossary_seed" | "ai_scan" | string;
  source_session_id?: string | null;
  is_user_edited: boolean;
  created_at: string;
  updated_at: string;
  is_inherited: boolean;
  inherited_from_workspace_id?: string | null;
  inherited_from_workspace_name?: string | null;
}

export interface ResolvedWorkspaceGlossaryTerm {
  term: string;
  normalized_term: string;
  definition: string;
  aliases: string[];
  source_kind: "manual" | "glossary_seed" | "ai_scan" | string;
  workspace_id: string;
  workspace_name?: string | null;
}

export interface DescendantAnalysisProgress {
  workspace_id: string;
  workspace_name: string;
  index: number;
  total: number;
  status: 'started' | 'completed' | 'skipped' | 'failed';
  error?: string;
  result?: AnalysisResult;
}

export interface GraphStatistics {
  id: string; workspace_id?: string; total_concepts: number;
  total_links: number; avg_degree: number; density: number; updated_at: string;
}

export interface AppSettings {
  preferred_model: string; backup_enabled: boolean; touch_id_enabled: boolean; pin_lock_enabled: boolean;
  auto_lock_minutes: number; theme: string; accent_color: string;
  font_size: number; sidebar_width: number; ollama_base_url: string;
  ollama_remote_enabled: boolean;
  auto_start_ollama: boolean;
  mlx_base_url: string;
  llamacpp_model_paths: string[];
  background_model: string;
  summarization_model: string;
  memory_extraction_model: string;
  flashcard_model: string;
  glossary_model: string;
  topic_signature_model: string;
  goal_suggestion_model: string;
  concept_hierarchy_model: string;
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
  about_you?: string;
  inject_about_you_into_chat?: boolean;
  switch_workspace_section: string;
  hide_native_menu: boolean;
  show_gen_info: boolean;
  show_gen_info_token_count: boolean;
  show_gen_info_duration: boolean;
  show_gen_info_speed: boolean;
  show_gen_info_model: boolean;
  demo_dismissed: boolean;
  memory_enabled: boolean;
  memory_extraction_threshold: number;
  memory_extraction_idle_minutes: number;
  topic_analysis_interval_minutes: number;
  summarization_min_messages: number;
  summarization_max_sessions: number;
  hover_definition_scan_enabled: boolean;
  hover_definition_scan_max_sessions: number;
  workspace_glossary_refresh_interval_minutes: number;
  git_sync_interval_minutes: number;
  menubar_icon_style: "monochrome" | "white" | "black";
  user_chat_label: string;
  assistant_chat_label: string;
  background_inference_enabled: boolean;
  vram_headroom_gb: number;
  vram_headroom_percent: number;
  ram_headroom_gb: number;
  ram_headroom_percent: number;
}

// Narrow slices of AppSettings returned by the split `get_core_settings`,
// `get_ai_settings`, and `get_advanced_settings` commands. Each mirrors the
// corresponding Rust struct exactly. The fat `get_settings`/AppSettings pair
// stays for now; callers should migrate to these slices to shrink the
// per-fetch IPC payload.

export interface CoreSettings {
  theme: string;
  accent_color: string;
  font_size: number;
  sidebar_width: number;
  menubar_icon_style: "monochrome" | "white" | "black";
  hide_native_menu: boolean;
  switch_workspace_section: string;
  user_chat_label: string;
  assistant_chat_label: string;
  demo_dismissed: boolean;
  web_session_preserve: boolean;
  chat_title_auto_refresh: "disabled" | "initial_only" | "periodic";
  chat_title_refresh_interval: number;
  about_you: string;
  inject_about_you_into_chat: boolean;
  prompt_instructions: string;
}

export interface AiSettings {
  preferred_model: string;
  background_model: string;
  summarization_model: string;
  memory_extraction_model: string;
  flashcard_model: string;
  glossary_model: string;
  topic_signature_model: string;
  goal_suggestion_model: string;
  concept_hierarchy_model: string;
  embedding_model: string;
  draft_model: string;
  compare_model_a: string;
  compare_model_b: string;
  ollama_base_url: string;
  ollama_remote_enabled: boolean;
  auto_start_ollama: boolean;
  mlx_base_url: string;
  llamacpp_model_paths: string[];
  dual_model_enabled: boolean;
  dual_model_execution_mode: "serial" | "parallel";
  chat_json_storage: boolean;
  chat_encryption_enabled: boolean;
  show_gen_info: boolean;
  show_gen_info_token_count: boolean;
  show_gen_info_duration: boolean;
  show_gen_info_speed: boolean;
  show_gen_info_model: boolean;
  background_inference_enabled: boolean;
}

export interface AdvancedSettings {
  quick_search_models: string[];
  quick_search_shortcut: string;
  quick_search_workspace_scope: string;
  quick_search_type_filters: string[];
  backup_enabled: boolean;
  touch_id_enabled: boolean;
  pin_lock_enabled: boolean;
  auto_lock_minutes: number;
  start_at_login: boolean;
  open_in_background: boolean;
  keep_running_in_tray: boolean;
  immediate_delete: boolean;
  confirm_move_to_trash: boolean;
  memory_enabled: boolean;
  memory_extraction_threshold: number;
  memory_extraction_idle_minutes: number;
  topic_analysis_interval_minutes: number;
  summarization_min_messages: number;
  summarization_max_sessions: number;
  hover_definition_scan_enabled: boolean;
  hover_definition_scan_max_sessions: number;
  workspace_glossary_refresh_interval_minutes: number;
  git_sync_interval_minutes: number;
  vram_headroom_gb: number;
  vram_headroom_percent: number;
  ram_headroom_gb: number;
  ram_headroom_percent: number;
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

export interface StreamEvent { session_id: string; chunk: string; done: boolean; tokens_used?: number; duration_ms?: number; load_duration_ms?: number; }

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
  memory_type: "fact" | "preference" | string;
  scope: "global" | "workspace";
  source_session_id?: string | null;
  is_pinned: boolean;
  is_active: boolean;
  reinforcement_count: number;
  last_reinforced_at?: string | null;
  superseded_by?: string | null;
  superseded_at?: string | null;
  superseded_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemorySummary {
  id: string;
  scope: "global" | "workspace";
  workspace_id?: string | null;
  content: string;
  is_auto_generated: boolean;
  generated_at: string;
  edited_at?: string | null;
}

export interface MemorySummarySnapshot {
  id: string;
  summary_id: string;
  scope: "global" | "workspace";
  workspace_id?: string | null;
  content: string;
  is_auto_generated: boolean;
  snapshotted_at: string;
}

export interface AnalysisResult {
  concepts_created: number;
  links_created: number;
  concepts_skipped: number;
  chapters_created: number;
  sections_created: number;
  job_id?: string;
  total_chunks?: number;
  failed_chunks?: number;
}

export interface DedupReport {
  merged_chapters: number;
  merged_sections: number;
  proposals_created: number;
}

export interface WorkspaceAnalysisProgress {
  job_id: string;
  workspace_id: string;
  chunk_index: number;
  total_chunks: number;
  label: string;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  nodes_created: number;
  links_created: number;
  error?: string;
}

export interface LearningPathItem {
  concept_id: string;
  concept_name: string;
  concept_description: string;
  hierarchy_path: string;
  met_prereqs: number;
  unmet_prereqs: number;
}

export interface AiModel {
  id: string; name: string; model_id: string; provider: string;
  role_tags: string[];
  priority: number; is_paid: boolean; enabled: boolean; is_hidden: boolean;
  tokens_used_total: number; created_at: string;
  context_size?: number | null;
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
  /** Per-logical-core CPU usage, 0–100. Empty array when unavailable. */
  cpu_core_usages: number[];
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
  folder_id?: string | null;
  folder_name?: string | null;
  updated_at: string;
  message_count: number;
  last_snippet?: string | null;
  last_role?: string | null;
  route: DashboardRoute;
}

export interface DashboardReviewSummary {
  due_today: number;
  total_cards: number;
  learned: number;
  avg_ease: number;
  route: DashboardRoute;
  /** Distinct topic count with at least one flashcard due today. */
  topics_due_for_review: number;
  /** Single topic name surfaced as the "next up" hint. */
  top_due_topic: string | null;
}

export interface ReviewTopic {
  concept_id: string;
  name: string;
  /** Currently always "stale" since AI-scored grade/goal reasons were removed. */
  reason_kind: string;
  detail: string;
  priority: number;
}

export interface DashboardLayoutSection {
  id: string;
  hidden: boolean;
}

export interface DashboardLayout {
  version: number;
  sections: DashboardLayoutSection[];
}

export interface DashboardSummary {
  workspace_id: string;
  workspace_name: string;
  overview: DashboardOverview;
  continue_learning: DashboardContinueLearning[];
  review: DashboardReviewSummary;
}

// ----- Workspaces -----
export const api = {
  topicSignature: {
    get: (workspaceId: string) => invoke<TopicSignature>("get_topic_signature", { workspaceId }),
    regenerate: (workspaceId: string, model?: string, ollamaUrl?: string) => invoke<TopicSignature>("regenerate_topic_signature", { workspaceId, model, ollamaUrl }),
    update: (workspaceId: string, custom_tags: string[], excluded_tags: string[]) =>
      invoke<TopicSignature>("update_topic_signature", {
        workspaceId,
        customTags: custom_tags,
        excludedTags: excluded_tags,
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
    update: (id: string, name: string, description?: string, promptInstructions?: string, surveyData?: string, excludeFromAiAnalysis?: boolean, aboutYou?: string) => invoke<void>("update_workspace", { req: { id, name, description, prompt_instructions: promptInstructions, survey_data: surveyData, exclude_from_ai_analysis: excludeFromAiAnalysis, about_you: aboutYou } }),
    setParent: (id: string, parentId: string | null) => invoke<void>("set_workspace_parent", { id, parentId }),
    delete: (id: string) => invoke<void>("delete_workspace", { id }),
    updateIcon: (id: string, icon: string) => invoke<void>("update_workspace_icon", { id, icon }),
    recommendIcon: (workspaceName: string, workspaceDescription: string) => invoke<string>("recommend_workspace_icon", { workspaceName, workspaceDescription }),
    generateIcon: (workspaceId: string) => invoke<void>("generate_workspace_icon", { workspaceId }),
    generateWorkspacePrompts: (workspaceId: string, workspaceName: string, surveyData?: string | null) => invoke<string[]>("generate_workspace_prompts", { workspaceId, workspaceName, surveyData }),
    listPromptSuggestions: (workspaceId: string, limit = 12) =>
      invoke<PromptSuggestion[]>("list_workspace_prompt_suggestions", { workspaceId, limit }),
    getPromptBankStatus: (workspaceId: string) =>
      invoke<PromptBankStatus>("get_workspace_prompt_bank_status", { workspaceId }),
    startPromptBankJob: (workspaceId: string, targetCount = 120) =>
      invoke<PromptBankJob>("start_workspace_prompt_bank_job", { workspaceId, targetCount }),
    hide: (id: string) => invoke<void>("hide_workspace", { id }),
    unhide: (id: string) => invoke<void>("unhide_workspace", { id }),
    reorder: (ids: string[]) => invoke<void>("reorder_workspaces", { ids }),
  },

  workspaceGlossary: {
    resolve: (workspaceId: string, candidates: string[]) =>
      invoke<ResolvedWorkspaceGlossaryTerm | null>("resolve_workspace_glossary_term", {
        workspaceId,
        candidates,
      }),
    list: (workspaceId: string, includeInherited = false) =>
      invoke<WorkspaceGlossaryTerm[]>("list_workspace_glossary_terms", {
        workspaceId,
        includeInherited,
      }),
    upsert: (req: {
      id?: string | null;
      workspace_id: string;
      term: string;
      definition: string;
      aliases?: string[];
      source_kind?: string;
      source_session_id?: string | null;
    }) => invoke<WorkspaceGlossaryTerm>("upsert_workspace_glossary_term", { req }),
    delete: (id: string) => invoke<void>("delete_workspace_glossary_term", { id }),
    refresh: (workspaceId: string) =>
      invoke<WorkspaceGlossaryTerm[]>("refresh_workspace_glossary", { workspaceId }),
  },

  folder: {
    create: (workspaceId: string, name: string, opts?: Partial<{ folder_description: string; custom_instructions: string; color: string; icon: string }>) =>
      invoke<Folder>("create_folder", { req: { workspace_id: workspaceId, name, ...opts } }),
    list: (workspaceId: string, opts?: { includeDescendants?: boolean }) => invoke<Folder[]>("list_folders", { workspaceId, includeDescendants: opts?.includeDescendants }),
    get: (id: string) => invoke<Folder | null>("get_folder", { id }),
    update: (id: string, fields: Partial<Folder>) => invoke<void>("update_folder", { req: { id, ...fields } }),
    delete: (id: string) => invoke<void>("delete_folder", { id }),
    moveToWorkspace: (folderId: string, targetWorkspaceId: string) => invoke<Folder>("move_folder_to_workspace", { folderId, targetWorkspaceId }),
    getStats: (id: string) => invoke<{ note_count: number; document_count: number; chat_session_count: number; flashcard_count: number; web_capture_count: number }>("get_folder_stats", { id }),
  },

  dashboard: {
    getSummary: (workspaceId: string, options?: { includeDescendants?: boolean }) =>
      timed("dashboard.getSummary", () =>
        invoke<DashboardSummary>("get_dashboard_summary", { workspaceId, includeDescendants: options?.includeDescendants }),
      ),
    getReviewTopics: (workspaceId: string, options?: { includeDescendants?: boolean }) =>
      invoke<ReviewTopic[]>("get_review_topics", { workspaceId, includeDescendants: options?.includeDescendants }),
    getLayout: (workspaceId: string) =>
      invoke<DashboardLayout>("get_dashboard_layout", { workspaceId }),
    setLayout: (workspaceId: string, layout: DashboardLayout) =>
      invoke<void>("set_dashboard_layout", { workspaceId, layout }),
    resetLayout: (workspaceId: string) =>
      invoke<DashboardLayout>("reset_dashboard_layout", { workspaceId }),
  },

  chat: {
    createSession: (workspaceId: string, folderId?: string | null, opts?: { title?: string; modelName?: string; systemPrompt?: string; is_incognito?: boolean; exclude_from_analytics?: boolean }) =>
      invoke<ChatSession>("create_chat_session", { req: { workspace_id: workspaceId, folder_id: folderId ?? '', title: opts?.title, model_name: opts?.modelName, system_prompt: opts?.systemPrompt, is_incognito: opts?.is_incognito, exclude_from_analytics: opts?.exclude_from_analytics } }),
    listSessions: (workspaceId: string, folderId?: string | null, opts?: { limit?: number; offset?: number; includeDescendants?: boolean }) =>
      timed("chat.listSessions", () =>
        invoke<ChatSession[]>("list_chat_sessions", { workspaceId, folderId: folderId ?? '', limit: opts?.limit, offset: opts?.offset, includeDescendants: opts?.includeDescendants }),
      ),
    getRelatedChats: (workspaceId: string, tags: string[], sessionId?: string, limit?: number) =>
      invoke<QuickSearchResult[]>("get_related_chats", { req: { workspace_id: workspaceId, tags, session_id: sessionId, limit } }),
    searchSessions: (workspaceId: string, query: string, folderId?: string | null, opts?: { includeDescendants?: boolean }) =>
      timed("chat.searchSessions", () =>
        invoke<ChatSession[]>("search_chat_sessions", { req: { workspace_id: workspaceId, query, folder_id: folderId ?? null, include_descendants: opts?.includeDescendants } }),
      ),
    getSession: (workspaceId: string, id: string) => invoke<ChatSession | null>("get_chat_session", { workspaceId, id }),
    deleteSession: (workspaceId: string, id: string) => invoke<void>("delete_chat_session", { workspaceId, id }),
    updateSession: (workspaceId: string, id: string, fields: { title?: string; is_pinned?: boolean; system_prompt?: string; model_name?: string; exclude_from_analytics?: boolean; is_unread?: boolean }) =>
      invoke<void>("update_chat_session", { workspaceId, id, title: fields.title, isPinned: fields.is_pinned, systemPrompt: fields.system_prompt, modelName: fields.model_name, excludeFromAnalytics: fields.exclude_from_analytics, isUnread: fields.is_unread }),
    moveSessions: (sessionIds: string[], targetWorkspaceId: string, targetFolderId?: string) =>
      invoke<void>("move_chat_sessions", { sessionIds, targetWorkspaceId, targetFolderId }),
    batchMoveSessions: (sessionIds: string[], targetWorkspaceId: string, preserveFolderStructure: boolean) =>
      invoke<{ sessions_moved: number; folders_created: string[]; folder_mapping: Record<string, string> }>(
        "batch_move_sessions",
        { req: { session_ids: sessionIds, target_workspace_id: targetWorkspaceId, preserve_folder_structure: preserveFolderStructure } }
      ),
    listDeletedSessions: (workspaceId: string, opts?: { includeDescendants?: boolean }) => invoke<ChatSession[]>("list_deleted_chat_sessions", { workspaceId, includeDescendants: opts?.includeDescendants }),
    restoreSession: (workspaceId: string, id: string) => invoke<void>("restore_chat_session", { workspaceId, id }),
    hardDeleteSession: (workspaceId: string, id: string) => invoke<void>("hard_delete_chat_session", { workspaceId, id }),
    emptyRecycleBin: (workspaceId: string) => invoke<void>("empty_recycle_bin", { workspaceId }),
    addMessage: (workspaceId: string, sessionId: string, role: "user" | "assistant", content: string, modelName?: string, tokensUsed?: number, durationMs?: number) =>
      invoke<Message>("add_message", { req: { workspace_id: workspaceId, session_id: sessionId, role, content, model_name: modelName, tokens_used: tokensUsed, duration_ms: durationMs } }),
    getMessages: (workspaceId: string, sessionId: string, limit?: number, offset?: number) =>
      timed("chat.getMessages", () => invoke<Message[]>("get_messages", { sessionId, limit, offset })),
    refreshMessage: (sessionId: string, messageId: string, modelId: string) =>
      invoke<Message>("refresh_message", { sessionId, messageId, modelId }),
    deleteMessageAndFollowing: (sessionId: string, messageId: string) =>
      invoke<number>("delete_message_and_following", { sessionId, messageId }),
    getMessageVariants: (messageId: string) =>
      invoke<Message[]>("get_message_variants", { messageId }),
    getTokenUsageByDate: (workspaceId: string, days?: number) =>
      invoke<{ day: string; total_tokens: number }[]>("get_token_usage_by_date", { workspaceId, days }),
    touchSessionAccessed: (sessionId: string) =>
      invoke<void>("touch_session_accessed", { sessionId }),
    getRecentSessions: (workspaceId: string, limit?: number, opts?: { includeDescendants?: boolean }) =>
      invoke<ChatSession[]>("get_recent_sessions", { workspaceId, limit, includeDescendants: opts?.includeDescendants }),
    countSessionsPerChildWorkspace: (parentWorkspaceId: string) =>
      invoke<Record<string, number>>("count_sessions_per_child_workspace", { parentWorkspaceId }),
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
    importFromJson: (path: string, workspaceId: string, folderId?: string | null, passphrase?: string) =>
      invoke<ChatSession>("import_chat_from_json", { path, workspaceId, folderId: folderId ?? null, passphrase }),
    syncAll: () => invoke<number>("sync_all_chats_to_files"),
    previewLmStudioFolder: (folderPath: string) =>
      invoke<{
        conversations: {
          uuid: string;
          name: string;
          message_count: number;
          created_at: string;
          updated_at: string;
          folder_id: string | null;
          folder_name: string | null;
          source_path: string;
        }[];
        total: number;
        folders: {
          uuid: string;
          name: string;
          conversation_count: number;
          message_count: number;
        }[];
        errors: number;
        error_messages: string[];
      }>("preview_lmstudio_folder", { folderPath }),
    importLmStudioFolder: (folderPath: string, workspaceName?: string, selectedIds?: string[], selectedFolderIds?: string[]) =>
      invoke<{
        imported: number;
        skipped: number;
        workspace_id: string;
        workspace_name: string;
        folders_created: number;
        errors: number;
        error_messages: string[];
      }>("import_lmstudio_folder", {
        folderPath,
        workspaceName: workspaceName ?? null,
        selectedIds: selectedIds ?? null,
        selectedFolderIds: selectedFolderIds ?? null,
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
          folders_created?: number;
          errors?: number;
        }>;
      }>("import_multiple_folders", { folderPaths }),
    previewGeminiTakeout: (filePath: string) =>
      invoke<{
        conversations: {
          uuid: string;
          name: string;
          message_count: number;
          created_at: string;
          updated_at: string;
          first_user_message: string;
          messages: { role: string; content: string }[];
        }[];
        total: number;
      }>("preview_gemini_takeout", { filePath }),
    importGeminiTakeout: (filePath: string, workspaceName?: string, selectedIds?: string[]) =>
      invoke<{
        imported_sessions: number;
        imported_messages: number;
        skipped: number;
        workspace_id: string;
        workspace_name: string;
        errors: number;
        error_messages: string[];
      }>("import_gemini_takeout", { filePath, workspaceName: workspaceName ?? null, selectedIds: selectedIds ?? null }),
    previewChatGptFolder: (folderPath: string) =>
      invoke<{
        conversations: {
          uuid: string;
          name: string;
          message_count: number;
          created_at: string;
          updated_at: string;
          first_user_message: string;
          messages: { role: string; content: string }[];
        }[];
        total: number;
      }>("preview_chatgpt_folder", { folderPath }),
    importChatGptFolder: (
      folderPath: string,
      workspaceId: string | null,
      workspaceName: string | null,
      selectedIds?: string[],
    ) =>
      invoke<{
        imported_sessions: number;
        skipped: number;
        workspace_id: string;
        errors: number;
        error_messages: string[];
      }>("import_chatgpt_folder", {
        folderPath,
        workspaceId,
        workspaceName,
        selectedIds: selectedIds ?? null,
      }),
    detectClaudeFormat: (folderPath: string) =>
      invoke<{
        format: "legacy" | "v2";
        files_found: { conversations: boolean; projects: boolean; memories: boolean };
      }>("detect_claude_format", { folderPath }),
    previewClaudeFiles: (args: {
      folderPath: string;
      includeConversations: boolean;
      includeProjects: boolean;
      includeMemories: boolean;
    }) =>
      invoke<{
        format: "legacy" | "v2";
        folders: {
          uuid: string;
          name: string;
          description: string;
          has_prompt: boolean;
          doc_count: number;
          conversation_count: number;
          has_memory: boolean;
          prompt_template?: string;
        }[];
        conversations_by_project: Record<string, { uuid: string; name: string; message_count: number; created_at: string; updated_at: string; project_uuid: string | null; first_user_message?: string; messages?: { role: string; content: string }[] }[]>;
        orphan_conversations: { uuid: string; name: string; message_count: number; created_at: string; updated_at: string; project_uuid: string | null; first_user_message?: string; messages?: { role: string; content: string }[] }[];
        orphan_count: number;
        memories: {
          conversations_memory: string;
          folder_memories: { project_uuid: string; folder_name: string; memory: string }[];
        } | null;
        memories_by_project?: Record<string, string> | null;
        suggestions: { conversation_uuid: string; project_uuid: string | null; score: number; reason: "title" | "keywords" | "none" }[];
        files_found: { conversations: boolean; projects: boolean; memories: boolean };
      }>("preview_claude_files", {
        folderPath: args.folderPath,
        includeConversations: args.includeConversations,
        includeProjects: args.includeProjects,
        includeMemories: args.includeMemories,
      }),
    matchClaudeWithEmbeddings: (args: {
      conversations: { uuid: string; name: string; first_user_message: string }[];
      projects: { uuid: string; name: string; prompt_template: string; description: string }[];
      memoriesByProject: Record<string, string>;
    }) =>
      invoke<{ conversation_uuid: string; project_uuid: string | null; score: number; reason: string }[]>(
        "match_claude_with_embeddings",
        {
          conversations: args.conversations,
          projects: args.projects,
          memoriesByProject: args.memoriesByProject,
        },
      ),
    importClaudeFiles: (args: {
      folderPath: string;
      folderMappings: Record<string, string>;
      projectMemoryTargets: Record<string, string>;
      orphansFolderId: string | null;
      selectedConversationIds?: string[];
      selectedProjectIds?: string[];
      chatProjectOverrides?: Record<string, string>;
    }) =>
      invoke<{
        imported: number;
        memories_imported: number;
        errors: number;
        error_messages: string[];
      }>("import_claude_files", {
        folderPath: args.folderPath,
        folderMappings: args.folderMappings,
        projectMemoryTargets: args.projectMemoryTargets,
        orphansFolderId: args.orphansFolderId ?? null,
        selectedConversationIds: args.selectedConversationIds ?? null,
        selectedProjectIds: args.selectedProjectIds ?? null,
        chatProjectOverrides: args.chatProjectOverrides ?? null,
      }),
  },

  security: {
    getStatus: () => invoke<SecurityStatus>("get_security_status"),
    setPin: (newPin: string, currentPin?: string) => invoke<void>("set_pin_passcode", { newPin, currentPin }),
    verifyPin: (pin: string) => invoke<boolean>("verify_pin_passcode", { pin }),
    removePin: (currentPin: string) => invoke<void>("remove_pin_passcode", { currentPin }),
    authenticateBiometric: () => invoke<boolean>("authenticate_biometric"),
    unlockApp: () => invoke<void>("unlock_app"),
    lockApp: () => invoke<void>("lock_app"),
  },

  graph: {
    createConcept: (workspaceId: string, name: string, opts?: Partial<ConceptNode>) =>
      invoke<ConceptNode>("create_concept", { req: { workspace_id: workspaceId, name, ...opts } }),
    listConcepts: (workspaceId: string, limit?: number, offset?: number, opts?: { includeDescendants?: boolean; includeSuperseded?: boolean }) =>
      invoke<ConceptNode[]>("list_concepts", { workspaceId, limit, offset, includeDescendants: opts?.includeDescendants, includeSuperseded: opts?.includeSuperseded }),
    getConcept: (id: string) => invoke<ConceptNode | null>("get_concept", { id }),
    updateConcept: (id: string, fields: Partial<ConceptNode>) => invoke<void>("update_concept", { id, ...fields }),
    deleteConcept: (id: string) => invoke<void>("delete_concept", { id }),
    setConceptParent: (childId: string, parentId: string | null) =>
      invoke<void>("set_concept_parent", { childId, parentId }),
    createLink: (sourceId: string, targetId: string, linkType?: string, strength?: number) =>
      invoke<ConceptLink>("create_concept_link", { req: { source_id: sourceId, target_id: targetId, link_type: linkType, strength } }),
    listLinks: (workspaceId: string, limit?: number, offset?: number, opts?: { includeDescendants?: boolean }) => invoke<ConceptLink[]>("list_concept_links", { workspaceId, limit, offset, includeDescendants: opts?.includeDescendants }),
    deleteLink: (id: string) => invoke<void>("delete_concept_link", { id }),
    getStats: (workspaceId: string) => invoke<GraphStatistics>("get_graph_stats", { workspaceId }),
    getLearningPath: (workspaceId: string) => invoke<LearningPathItem[]>("get_learning_path", { workspaceId }),
    extractConcepts: (workspaceId: string, text: string, sourceType: string, sourceId: string) =>
      invoke<{ created: string[]; existing: string[]; mentions_recorded: number }>(
        "extract_and_link_concepts",
        { req: { workspace_id: workspaceId, text, source_type: sourceType, source_id: sourceId } },
      ),
    /** Idempotent: ensures a concept exists for the given tag name (case-insensitive). Returns the concept id. */
    upsertFromTopicTag: (workspaceId: string, name: string) =>
      invoke<string>("upsert_concept_from_tag", { workspaceId, name }),
    undoLastAnalysis: (workspaceId: string) => invoke<void>("undo_last_analysis", { workspaceId }),
    listRoadmapSnapshots: (workspaceId: string) =>
      invoke<RoadmapSnapshot[]>("list_roadmap_snapshots", { workspaceId }),
    restoreRoadmapSnapshot: (snapshotId: string) =>
      invoke<void>("restore_roadmap_snapshot", { snapshotId }),
    resetKnowledgeState: (req: {
      scope: KnowledgeResetScope;
      workspaceId?: string;
      options?: KnowledgeResetOptions;
      dryRun?: boolean;
    }) => invoke<KnowledgeResetResult>("reset_knowledge_state", {
      req: {
        scope: req.scope,
        workspace_id: req.workspaceId,
        options: req.options,
        dry_run: req.dryRun,
      },
    }),
    listChangeProposals: (workspaceId: string) => invoke<ChangeProposal[]>("list_change_proposals", { workspaceId }),
    applyChangeProposal: (id: string) => invoke<void>("apply_change_proposal", { id }),
    dismissChangeProposal: (id: string) => invoke<void>("dismiss_change_proposal", { id }),
    getKnowledgeSettings: () => invoke<KnowledgeSettings>("get_knowledge_settings"),
  },

  learningGoal: {
    create: (workspaceId: string, title: string) =>
      invoke<LearningGoal>("create_learning_goal", { req: { workspace_id: workspaceId, title } }),
    list: (workspaceId: string, opts?: { includeDescendants?: boolean; includeAncestors?: boolean }) =>
      invoke<LearningGoal[]>("list_learning_goals", {
        workspaceId,
        includeDescendants: opts?.includeDescendants,
        includeAncestors: opts?.includeAncestors,
      }),
    update: (id: string, fields: Partial<LearningGoal>) =>
      invoke<void>("update_learning_goal", { req: { id, ...fields } }),
    delete: (id: string) => invoke<void>("delete_learning_goal", { id }),
  },

  flashcard: {
    create: (workspaceId: string, front: string, back: string) =>
      invoke<LearningCard>("create_flashcard", { req: { workspace_id: workspaceId, front, back } }),
    listDue: (workspaceId: string, opts?: { limit?: number; offset?: number; includeDescendants?: boolean; conceptId?: string }) =>
      invoke<LearningCard[]>("list_flashcards_due", { workspaceId, limit: opts?.limit, offset: opts?.offset, includeDescendants: opts?.includeDescendants, conceptId: opts?.conceptId }),
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
    listTopics: (workspaceId: string, includeDescendants?: boolean) =>
      invoke<FlashcardTopic[]>("list_flashcard_topics", { workspaceId, includeDescendants }),
    generateForTopic: (workspaceId: string, topicId: string, model: string, count?: number, ollamaUrl?: string) =>
      invoke<LearningCard[]>("generate_flashcards_for_topic", { req: { workspace_id: workspaceId, topic_id: topicId, model, count, ollama_url: ollamaUrl } }),
    suggestNext: (workspaceId: string, includeDescendants?: boolean) =>
      invoke<SuggestedTopic | null>("suggest_next_topic", { workspaceId, includeDescendants }),
    suggestNextConcept: (workspaceId: string, includeDescendants?: boolean) =>
      invoke<SuggestedConcept | null>("suggest_next_concept", { workspaceId, includeDescendants }),
  },

  quiz: {
    create: (req: {
      workspaceId: string;
      kind: QuizKind;
      topicIds: string[];
      questionCount?: number;
      chatSessionId?: string;
      title?: string;
      model?: string;
    }) =>
      invoke<QuizDetail>("create_quiz", {
        req: {
          workspace_id: req.workspaceId,
          kind: req.kind,
          topic_ids: req.topicIds,
          question_count: req.questionCount,
          chat_session_id: req.chatSessionId,
          title: req.title,
          model: req.model,
        },
      }),
    get: (quizId: string) => invoke<QuizDetail>("get_quiz", { quizId }),
    list: (workspaceId: string, limit?: number) =>
      invoke<QuizSummary[]>("list_quizzes", { workspaceId, limit }),
    submitAnswer: (req: {
      quizId: string;
      questionId: string;
      userAnswer: string;
      model?: string;
    }) =>
      invoke<QuizAnswer>("submit_quiz_answer", {
        req: {
          quiz_id: req.quizId,
          question_id: req.questionId,
          user_answer: req.userAnswer,
          model: req.model,
        },
      }),
    finalize: (quizId: string) => invoke<Quiz>("finalize_quiz", { quizId }),
    delete: (quizId: string) => invoke<void>("delete_quiz", { quizId }),
  },

  note: {
    create: (workspaceId: string, title: string, content?: string, folder?: string | null, isPinned?: boolean) =>
      invoke<ProjectNote>("create_note", { req: { workspace_id: workspaceId, title, content, folder: folder ?? null, is_pinned: isPinned ?? false } }),
    list: (workspaceId: string, opts?: { limit?: number; offset?: number; includeDescendants?: boolean }) =>
      invoke<ProjectNote[]>("list_notes", { workspaceId, limit: opts?.limit, offset: opts?.offset, includeDescendants: opts?.includeDescendants }),
    get: (id: string) => invoke<ProjectNote | null>("get_note", { id }),
    update: (id: string, fields: Partial<ProjectNote>) => invoke<void>("update_note", { req: { id, ...fields } }),
    delete: (id: string) => invoke<void>("delete_note", { id }),
    getDailyNote: (workspaceId: string, date?: string) =>
      invoke<ProjectNote>("get_or_create_daily_note", { req: { workspace_id: workspaceId, date } }),
    updateDailyNote: (id: string, content?: string, mood?: number, productivity?: number) =>
      invoke<void>("update_daily_note", { id, content, mood: mood !== undefined ? mood : null, productivity: productivity !== undefined ? productivity : null }),
    listDailyNotesInRange: (workspaceId: string, startDate: string, endDate: string, opts?: { includeDescendants?: boolean }) =>
      invoke<ProjectNote[]>("list_daily_notes_in_range", { workspaceId, startDate, endDate, includeDescendants: opts?.includeDescendants }),
    listTemplates: (workspaceId: string, opts?: { includeDescendants?: boolean }) => invoke<NoteTemplate[]>("list_templates", { workspaceId, includeDescendants: opts?.includeDescendants }),
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
    list: (workspaceId: string, sourceType?: string, opts?: { includeDescendants?: boolean }) =>
      invoke<Source[]>("list_sources", { workspaceId, sourceType, includeDescendants: opts?.includeDescendants }),
    get: (id: string) => invoke<Source | null>("get_source", { id }),
    update: (id: string, fields: { title?: string; summary?: string; is_processed?: boolean; folder?: string }) =>
      invoke<void>("update_source", { id, ...fields }),
    delete: (id: string) => invoke<void>("delete_source", { id }),
    process: (id: string) => invoke<number>("process_source", { id }),
  },

  search: {
    keyword: (query: string, workspaceId: string, folderId?: string) =>
      invoke<SearchResult[]>("keyword_search", { req: { query, workspace_id: workspaceId, folder_id: folderId } }),
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
        includeDescendants?: boolean;
      },
    ) =>
      timed("quickSearch.query", () =>
        invoke<QuickSearchResult[]>("query_quick_search", {
          req: {
            query,
            limit: options?.limit,
            workspace_id: options?.workspaceId ?? null,
            kind_filters: options?.kindFilters ?? null,
            include_descendants: options?.includeDescendants ?? false,
          },
        }),
      ),
    getContext: () => invoke<QuickSearchContext>("get_quick_search_context"),
    openResult: (result: QuickSearchResult) =>
      invoke<void>("open_quick_search_result", { result }),
    markMainWindowReady: () => invoke<void>("mark_main_window_ready"),
  },

  context: {

    assembleAndSend: (sessionId: string, workspaceId: string, modelName: string, options?: Record<string, unknown>) =>
      invoke<string>("assemble_and_send", { req: { session_id: sessionId, workspace_id: workspaceId, model_name: modelName, options: options || {} } }),

    listenContextSources: (sessionId: string, onSources: (sources: unknown) => void): Promise<UnlistenFn> =>

      listen<unknown>(`context-sources-${sessionId}`, (event) => onSources(event.payload)),
  },

  artifact: {
    create: (req: CreateArtifactRequest) => invoke<Artifact>("create_artifact", { req }),
    list: (workspace_id: string, limit?: number, offset?: number, opts?: { includeDescendants?: boolean }) => invoke<ArtifactSummary[]>("list_artifacts", { workspaceId: workspace_id, limit, offset, includeDescendants: opts?.includeDescendants }),
    get: (id: string) => invoke<Artifact>("get_artifact", { id }),
    update: (id: string, updates: Partial<CreateArtifactRequest & { is_pinned: boolean }>) => invoke<void>("update_artifact", { id, updates }),
    delete: (id: string) => invoke<void>("delete_artifact", { id }),
    versions: (id: string) => invoke<ArtifactSummary[]>("get_artifact_versions", { id }),
    search: (workspace_id: string, query: string) => invoke<ArtifactSummary[]>("search_artifacts", { workspaceId: workspace_id, query }),
    createVersion: (parentId: string, content: string) => invoke<Artifact>("create_artifact_version", { parentId, content }),
  },

  summary: {
    generate: (session_id: string, workspace_id: string, summary_type: string, force = false) =>
      invoke<void>("generate_summary", { sessionId: session_id, workspaceId: workspace_id, summaryType: summary_type, force }),
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
    generateFollowUps: (model: string, messages: { role: string; content: string }[], ollamaUrl?: string, memoryContext?: string) => {
      const requestId = createRequestId();
      return invokeObserved<string[]>(
        "generate_follow_ups",
        { model, messages, ollamaUrl, requestId, memoryContext },
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
    roadmap: {
      markdown: (workspaceId: string) =>
        invoke<string>("export_roadmap_markdown", { req: { workspace_id: workspaceId } }),
      json: (workspaceId: string) =>
        invoke<string>("export_roadmap_json", { req: { workspace_id: workspaceId } }),
      mermaid: (workspaceId: string) =>
        invoke<string>("export_roadmap_mermaid", { req: { workspace_id: workspaceId } }),
      csv: (workspaceId: string) =>
        invoke<string>("export_roadmap_csv", { req: { workspace_id: workspaceId } }),
      png: (workspaceId: string, svg: string, width: number, height: number) =>
        invoke<number[]>("export_roadmap_png", {
          req: { workspace_id: workspaceId, svg, width, height },
        }),
      pdf: (workspaceId: string, svg: string, width: number, height: number) =>
        invoke<number[]>("export_roadmap_pdf", {
          req: { workspace_id: workspaceId, svg, width, height },
        }),
    },
  },

  backup: {
    create: (workspaceId: string) => invoke<string>("create_backup", { workspaceId }),

    list: () => invoke<{ id: string; name: string; created_at: string; size: number }[]>("list_backups"),
    restore: (backupJson: string) => invoke<string>("restore_backup", { backupJson }),
    delete: (id: string) => invoke<void>("delete_backup", { id }),
    createGlobal: () => invoke<string>("create_global_backup"),
    restoreGlobal: (backupJson: string) => invoke<string[]>("restore_global_backup", { backupJson }),
  },

  settings: {
    get: () => timed("settings.get", () => invoke<AppSettings>("get_settings")),
    getCore: () => invoke<CoreSettings>("get_core_settings"),
    getAi: () => invoke<AiSettings>("get_ai_settings"),
    getAdvanced: () => invoke<AdvancedSettings>("get_advanced_settings"),
    update: (settings: AppSettings) => invoke<void>("update_settings", { settings }),
    updateOne: (key: string, value: unknown) => invoke<void>("update_setting", { key, value }),
    reloadTrayIcon: () => invoke<void>("reload_tray_icon"),
  },

  graphAlgo: {
    pagerank: (workspaceId: string, damping?: number, iterations?: number) =>

      invoke<Array<{ node_id: string; score: number }>>("compute_pagerank", { workspaceId, damping, iterations }),
    communities: (workspaceId: string) =>

      invoke<Array<{ node_id: string; community_id: number }>>("detect_communities", { workspaceId }),
    shortestPath: (workspaceId: string, sourceId: string, targetId: string) =>

      invoke<{ path: string[]; total_weight: number; found: boolean }>("find_shortest_path", { workspaceId, sourceId, targetId }),
  },

  demo: {
    activate: () => invoke<string>("activate_demo_mode"),
    deactivate: () => invoke<void>("deactivate_demo_mode"),
  },

  alarm: {
    create: (title: string, fireDate: string, workspaceId?: string) =>
      invoke<CalendarAlarm>("create_alarm", { req: { title, fire_date: fireDate, workspace_id: workspaceId } }),
    list: (workspaceId?: string, opts?: { includeDescendants?: boolean }) => invoke<CalendarAlarm[]>("list_alarms", { workspaceId, includeDescendants: opts?.includeDescendants }),
    delete: (id: string) => invoke<void>("delete_alarm", { id }),
  },

  webCapture: {
    create: (workspaceId: string, url: string, title: string, content: string, summary?: string) =>
      invoke<{ id: string; workspace_id: string; url: string; title: string; content: string; summary?: string; is_processed: boolean; created_at: string }>(
        "create_web_capture", { workspaceId, url, title, content, summary }
      ),
    list: (workspaceId: string, opts?: { limit?: number; offset?: number; includeDescendants?: boolean }) =>
      invoke<{ id: string; workspace_id: string; url: string; title: string; content: string; summary?: string; is_processed: boolean; created_at: string }[]>(
        "list_web_captures", { workspaceId, limit: opts?.limit, offset: opts?.offset, includeDescendants: opts?.includeDescendants }
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
    update: (id: string, fields: { name?: string; role_tags?: string[]; priority?: number; is_paid?: boolean; enabled?: boolean; is_hidden?: boolean; context_size?: number | null }) =>
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
    listActiveBackgroundJobs: () => invoke<ActiveJob[]>("list_active_background_jobs"),
  },

  knowledge: {
    analyzeWorkspace: (workspaceId: string, model: string, opts?: { ollamaUrl?: string; focusTopic?: string; surveyContext?: string }) =>
      invoke<AnalysisResult>("analyze_workspace", {
        req: {
          workspace_id: workspaceId,
          model,
          ollama_url: opts?.ollamaUrl,
          focus_topic: opts?.focusTopic,
          survey_context: opts?.surveyContext,
        },
      }),
    checkWorkspaceAnalyzable: (workspaceId: string) =>
      invoke<{ ready: boolean; item_count: number; char_count: number }>("check_workspace_analyzable", {
        workspaceId,
      }),
    analyzeDescendants: (workspaceId: string, model: string, opts?: { ollamaUrl?: string; focusTopic?: string }) =>
      invoke<DescendantAnalysisProgress[]>("analyze_descendants", {
        req: {
          workspace_id: workspaceId,
          model,
          ollama_url: opts?.ollamaUrl,
          focus_topic: opts?.focusTopic,
        },
      }),
    listenDescendantProgress: (onEvent: (event: DescendantAnalysisProgress) => void): Promise<UnlistenFn> =>
      listen<DescendantAnalysisProgress>("descendant-analysis-progress", (event) => {
        onEvent(event.payload);
      }),
    analyzeWorkspaceChunked: (workspaceId: string, model: string, opts?: { ollamaUrl?: string; focusTopic?: string; surveyContext?: string }) =>
      invoke<AnalysisResult>("analyze_workspace_chunked", {
        req: {
          workspace_id: workspaceId,
          model,
          ollama_url: opts?.ollamaUrl,
          focus_topic: opts?.focusTopic,
          survey_context: opts?.surveyContext,
        },
      }),
    listenWorkspaceProgress: (onEvent: (event: WorkspaceAnalysisProgress) => void): Promise<UnlistenFn> =>
      listen<WorkspaceAnalysisProgress>("workspace-analysis-progress", (event) => {
        onEvent(event.payload);
      }),
    dedupWorkspaceConcepts: (workspaceId: string, model: string, opts?: { ollamaUrl?: string }) =>
      invoke<DedupReport>("dedup_workspace_concepts", {
        req: {
          workspace_id: workspaceId,
          model,
          ollama_url: opts?.ollamaUrl,
        },
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
    deleteWorkspaceFacts: (workspaceId: string) =>
      invoke<number>("delete_workspace_facts", { workspaceId }),
    deleteAll: (workspaceId: string, scope: Memory["scope"]) =>
      invoke<void>("delete_all_memories", { workspaceId, scope }),
    deactivateAll: (workspaceId: string, scope: Memory["scope"]) =>
      invoke<void>("deactivate_all_memories", { workspaceId, scope }),
    getSummary: (scope: MemorySummary["scope"], workspaceId?: string) =>
      invoke<MemorySummary | null>("get_memory_summary", { scope, workspaceId: workspaceId ?? null }),
    upsertSummary: (scope: MemorySummary["scope"], content: string, workspaceId?: string) =>
      invoke<MemorySummary>("upsert_memory_summary", { scope, content, workspaceId: workspaceId ?? null }),
    regenerateSummary: (scope: MemorySummary["scope"], workspaceId?: string) =>
      invoke<MemorySummary>("regenerate_memory_summary", { scope, workspaceId: workspaceId ?? null }),
    listSummarySnapshots: (scope: MemorySummary["scope"], workspaceId?: string) =>
      invoke<MemorySummarySnapshot[]>("list_memory_summary_snapshots", { scope, workspaceId: workspaceId ?? null }),
    restoreSummarySnapshot: (snapshotId: string) =>
      invoke<MemorySummary>("restore_memory_summary_snapshot", { snapshotId }),
  },

  webAI: {
    /** Send a query to a web AI provider via the Playwright bridge. */
    sendMessage: (sessionId: string, provider: string, query: string, preserveSession: boolean) =>
      invoke<string>("send_web_message", { sessionId: sessionId, provider, query, preserveSession }),
    stopStream: (sessionId: string) =>
      invoke<void>("stop_web_stream", { sessionId }),
  },

  // Streaming: listen to Ollama stream events for a session
  listenStream: (sessionId: string, onChunk: (chunk: string, done: boolean, tokensUsed?: number, durationMs?: number, loadDurationMs?: number) => void): Promise<UnlistenFn> =>
    listen<StreamEvent>(`ollama-stream-${sessionId}`, (event) => {
      onChunk(event.payload.chunk, event.payload.done, event.payload.tokens_used, event.payload.duration_ms, event.payload.load_duration_ms);
    }),

  // Streaming: listen to the refine (large model) events for a dual-model session
  listenRefineStream: (sessionId: string, onChunk: (chunk: string, done: boolean, tokensUsed?: number, durationMs?: number, loadDurationMs?: number) => void): Promise<UnlistenFn> =>
    listen<StreamEvent>(`ollama-refine-${sessionId}`, (event) => {
      onChunk(event.payload.chunk, event.payload.done, event.payload.tokens_used, event.payload.duration_ms, event.payload.load_duration_ms);
    }),

  listenBackgroundTask: (onEvent: (event: BackgroundTaskEvent) => void): Promise<UnlistenFn> =>
    listen<BackgroundTaskEvent>("background-task", (event) => {
      onEvent(event.payload);
    }),

  listenBackgroundTaskPrompt: (onEvent: (event: BackgroundTaskPromptEvent) => void): Promise<UnlistenFn> =>
    listen<BackgroundTaskPromptEvent>("background-task-prompt", (event) => {
      onEvent(event.payload);
    }),

  backgroundJobs: {
    confirm: (taskType: string) =>
      invoke<boolean>("confirm_background_job", { taskType }),
    dismiss: (taskType: string) =>
      invoke<boolean>("dismiss_background_job", { taskType }),
    cancel: (taskType: string) =>
      invoke<boolean>("cancel_background_job", { taskType }),
    getScheduledTaskSettings: () =>
      invoke<ScheduledTaskSettings>("get_scheduled_task_settings"),
    setScheduledTaskSetting: (key: string, value: string) =>
      invoke<void>("set_scheduled_task_setting", { key, value }),
    setCurrentWorkspaceId: (workspaceId: string | null) =>
      invoke<void>("set_current_workspace_id", { workspaceId }),
  },

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
    logFrontendEventsBatch: (events: Array<{ level: string; source: string; message: string; metadata?: string }>) =>
      invoke<void>("log_frontend_events_batch", { req: { events } }),
    setLogLevel: (level: "debug" | "info" | "warn" | "error") =>
      invoke<void>("set_log_level", { level }),
    getLogLevel: () => invoke<string>("get_log_level"),
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
