/**
 * Typed IPC wrappers for all Tauri backend commands.
 * Mirrors the Rust #[tauri::command] functions in src-tauri/src/commands/.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { Workspace, Project } from "../stores/workspaceStore";
import type { ChatSession, Message } from "../stores/chatStore";

// ----- Types -----

export interface TopicTag {
  tag: string;
  weight: number;
  source: string;
}

export interface TopicSignature {
  domain_tags: TopicTag[];
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
  created_at: string; updated_at: string;
}

export interface ConceptLink {
  id: string; source_id: string; target_id: string;
  link_type: string; strength: number; context: string; created_at: string;
}

export interface LearningCard {
  id: string; workspace_id: string; front: string; back: string;
  source_type: string; ease_factor: number; interval: number;
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

export interface SearchResult {
  id: string; result_type: string; title: string; excerpt: string;
  score: number; source_id?: string; project_id?: string;
}

export interface OllamaModel { name: string; size?: number; modified_at?: string; }

export interface GraphStatistics {
  id: string; workspace_id?: string; total_concepts: number;
  total_links: number; avg_degree: number; density: number; updated_at: string;
}

export interface AppSettings {
  preferred_model: string; backup_enabled: boolean; touch_id_enabled: boolean;
  auto_lock_minutes: number; theme: string; accent_color: string;
  font_size: number; sidebar_width: number; ollama_base_url: string;
  embedding_model: string;
  chat_title_auto_refresh: "disabled" | "initial_only" | "periodic";
  chat_title_refresh_interval: number;
  chat_json_storage: boolean;
  chat_encryption_enabled: boolean;
  web_session_preserve: boolean;
  dual_model_enabled: boolean;
  draft_model: string;
  compare_model_a: string;
  compare_model_b: string;
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
  result?: string; result_at?: string; created_at: string; updated_at: string;
}

export interface AnalysisResult {
  concepts_created: number;
  links_created: number;
  concepts_skipped: number;
}

export interface SuggestedGoal {
  title: string;
  description: string;
  related_concepts: string[];
}

export interface AiModel {
  id: string; name: string; model_id: string; provider: string;
  priority: number; is_paid: boolean; enabled: boolean;
  tokens_used_total: number; created_at: string;
}

// ----- Workspaces -----
export const api = {
  topicSignature: {
    get: (workspaceId: string) => invoke<TopicSignature>("get_topic_signature", { workspaceId }),
    regenerate: (workspaceId: string, model?: string, ollamaUrl?: string) => invoke<TopicSignature>("regenerate_topic_signature", { workspaceId, model, ollamaUrl }),
    checkMatch: (workspaceId: string, message: string) => invoke<WorkspaceMatchResult>("check_workspace_match", { workspaceId, message }),
  },
  
  workspace: {
    create: (name: string) => invoke<Workspace>("create_workspace", { req: { name } }),
    list: () => invoke<Workspace[]>("list_workspaces"),
    get: (id: string) => invoke<Workspace | null>("get_workspace", { id }),
    update: (id: string, name: string) => invoke<void>("update_workspace", { req: { id, name } }),
    delete: (id: string) => invoke<void>("delete_workspace", { id }),
  },

  project: {
    create: (workspaceId: string, name: string, opts?: Partial<{ project_description: string; color: string; icon: string }>) =>
      invoke<Project>("create_project", { req: { workspace_id: workspaceId, name, ...opts } }),
    list: (workspaceId: string) => invoke<Project[]>("list_projects", { workspaceId }),
    get: (id: string) => invoke<Project | null>("get_project", { id }),
    update: (id: string, fields: Partial<Project>) => invoke<void>("update_project", { req: { id, ...fields } }),
    delete: (id: string) => invoke<void>("delete_project", { id }),
    getStats: (id: string) => invoke<{ note_count: number; document_count: number; chat_session_count: number; flashcard_count: number; web_capture_count: number }>("get_project_stats", { id }),
  },

  chat: {
    createSession: (workspaceId: string, projectId?: string | null, opts?: { title?: string; modelName?: string; systemPrompt?: string }) =>
      invoke<ChatSession>("create_chat_session", { req: { workspace_id: workspaceId, project_id: projectId ?? '', title: opts?.title, model_name: opts?.modelName, system_prompt: opts?.systemPrompt } }),
    listSessions: (workspaceId: string, projectId?: string | null) => invoke<ChatSession[]>("list_chat_sessions", { workspaceId, projectId: projectId ?? '' }),
    getSession: (workspaceId: string, id: string) => invoke<ChatSession | null>("get_chat_session", { workspaceId, id }),
    deleteSession: (workspaceId: string, id: string) => invoke<void>("delete_chat_session", { workspaceId, id }),
    updateSession: (workspaceId: string, id: string, fields: { title?: string; is_pinned?: boolean; system_prompt?: string }) =>
      invoke<void>("update_chat_session", { workspaceId, id, title: fields.title, isPinned: fields.is_pinned, systemPrompt: fields.system_prompt }),
    moveSessions: (sessionIds: string[], targetWorkspaceId: string, targetProjectId?: string) =>
      invoke<void>("move_chat_sessions", { sessionIds, targetWorkspaceId, targetProjectId }),
    addMessage: (workspaceId: string, sessionId: string, role: "user" | "assistant", content: string, modelName?: string, tokensUsed?: number, durationMs?: number) =>
      invoke<Message>("add_message", { req: { workspace_id: workspaceId, session_id: sessionId, role, content, model_name: modelName, tokens_used: tokensUsed, duration_ms: durationMs } }),
    getMessages: (workspaceId: string, sessionId: string) => invoke<Message[]>("get_messages", { workspaceId, sessionId }),
    getTokenUsageByDate: (workspaceId: string, days?: number) =>
      invoke<{ day: string; total_tokens: number }[]>("get_token_usage_by_date", { workspaceId, days }),
  },

  chatFile: {
    getInfo: () => invoke<{ chats_dir: string; encryption_enabled: boolean }>("get_chat_file_info"),
    setupEncryption: (passphrase: string) => invoke<number>("setup_chat_encryption", { passphrase }),
    disableEncryption: () => invoke<number>("disable_chat_encryption"),
    exportAsJson: (sessionId: string, destPath: string) =>
      invoke<void>("export_chat_as_json", { sessionId, destPath }),
    importFromJson: (path: string, passphrase?: string) =>
      invoke<string>("import_chat_from_json", { path, passphrase }),
    syncAll: () => invoke<number>("sync_all_chats_to_files"),
  },

  graph: {
    createConcept: (workspaceId: string, name: string, opts?: Partial<ConceptNode>) =>
      invoke<ConceptNode>("create_concept", { req: { workspace_id: workspaceId, name, ...opts } }),
    listConcepts: (workspaceId: string) => invoke<ConceptNode[]>("list_concepts", { workspaceId }),
    getConcept: (id: string) => invoke<ConceptNode | null>("get_concept", { id }),
    updateConcept: (id: string, fields: Partial<ConceptNode>) => invoke<void>("update_concept", { id, ...fields }),
    deleteConcept: (id: string) => invoke<void>("delete_concept", { id }),
    createLink: (sourceId: string, targetId: string, linkType?: string, strength?: number) =>
      invoke<ConceptLink>("create_concept_link", { req: { source_id: sourceId, target_id: targetId, link_type: linkType, strength } }),
    listLinks: (workspaceId: string) => invoke<ConceptLink[]>("list_concept_links", { workspaceId }),
    deleteLink: (id: string) => invoke<void>("delete_concept_link", { id }),
    getStats: (workspaceId: string) => invoke<GraphStatistics>("get_graph_stats", { workspaceId }),
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
    listDue: (workspaceId: string) => invoke<LearningCard[]>("list_flashcards_due", { workspaceId }),
    review: (cardId: string, quality: number) =>
      invoke<LearningCard>("review_flashcard", { req: { card_id: cardId, quality } }),
    getStats: (workspaceId: string) => invoke<ReviewStats>("get_review_stats", { workspaceId }),
    generate: (workspaceId: string, topic: string, model: string, count?: number, ollamaUrl?: string) =>
      invoke<LearningCard[]>("generate_flashcards", { req: { workspace_id: workspaceId, topic, model, count, ollama_url: ollamaUrl } }),
  },

  note: {
    create: (workspaceId: string, title: string, content?: string) =>
      invoke<ProjectNote>("create_note", { req: { workspace_id: workspaceId, title, content } }),
    list: (workspaceId: string) => invoke<ProjectNote[]>("list_notes", { workspaceId }),
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

  search: {
    keyword: (query: string, workspaceId: string, projectId?: string) =>
      invoke<SearchResult[]>("keyword_search", { req: { query, workspace_id: workspaceId, project_id: projectId } }),
    semantic: (query: string, workspaceId: string, queryEmbedding: number[]) =>
      invoke<SearchResult[]>("semantic_search", { req: { query, workspace_id: workspaceId }, queryEmbedding, workspaceId }),
  },

  ollama: {
    sendMessage: (sessionId: string, model: string, messages: { role: string; content: string }[], stream: boolean, ollamaUrl?: string) =>
      invoke<string>("send_message", { req: { session_id: sessionId, model, messages, stream, ollama_url: ollamaUrl } }),
    sendDualModelMessage: (sessionId: string, draftModel: string, refineModel: string, messages: { role: string; content: string }[], ollamaUrl?: string) =>
      invoke<string>("send_dual_model_message", { req: { session_id: sessionId, draft_model: draftModel, refine_model: refineModel, messages, ollama_url: ollamaUrl } }),
    listModels: (ollamaUrl?: string) => invoke<OllamaModel[]>("list_models", { ollamaUrl }),
    generateTitle: (model: string, firstMessage: string, ollamaUrl?: string) =>
      invoke<string>("generate_title", { model, firstMessage, ollamaUrl }),
    generateTitleFromConversation: (model: string, conversation: { role: string; content: string }[], ollamaUrl?: string) =>
      invoke<string>("generate_title_from_conversation", { model, conversation, ollamaUrl }),
    extractTopics: (texts: string[], model: string, ollamaUrl?: string) =>
      invoke<{ topic: string; weight: number }[]>("extract_topics", { texts, model, ollamaUrl }),
    generateEmbedding: (text: string, model?: string, ollamaUrl?: string) =>
      invoke<number[]>("generate_embedding", { req: { text, model, ollama_url: ollamaUrl } }),
    generateFollowUps: (model: string, messages: { role: string; content: string }[], ollamaUrl?: string) =>
      invoke<string[]>("generate_follow_ups", { model, messages, ollamaUrl }),
    stopStream: (sessionId: string) => invoke<void>("stop_stream", { sessionId }),
  },

  export: {
    markdown: (workspaceId: string) => invoke<string>("export_markdown", { req: { workspace_id: workspaceId } }),
    json: (workspaceId: string) => invoke<string>("export_json", { req: { workspace_id: workspaceId } }),
    obsidian: (workspaceId: string) => invoke<Array<{ path: string; content: string }>>("export_obsidian_vault", { req: { workspace_id: workspaceId } }),
  },

  backup: {
    create: (workspaceId: string) => invoke<string>("create_backup", { workspaceId }),
    list: () => invoke<any[]>("list_backups"),
    restore: (backupJson: string) => invoke<void>("restore_backup", { backupJson }),
    delete: (id: string) => invoke<void>("delete_backup", { id }),
  },

  settings: {
    get: () => invoke<AppSettings>("get_settings"),
    update: (settings: AppSettings) => invoke<void>("update_settings", { settings }),
  },

  graphAlgo: {
    pagerank: (nodes: any[], edges: any[]) =>
      invoke<any[]>("compute_pagerank", { input: { nodes, edges } }),
    communities: (nodes: any[], edges: any[]) =>
      invoke<any[]>("detect_communities", { input: { nodes, edges } }),
    shortestPath: (nodes: any[], edges: any[], sourceId: string, targetId: string) =>
      invoke<any>("find_shortest_path", { input: { nodes, edges }, sourceId, targetId }),
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
    list: (workspaceId: string) =>
      invoke<{ id: string; workspace_id: string; url: string; title: string; content: string; summary?: string; is_processed: boolean; created_at: string }[]>(
        "list_web_captures", { workspaceId }
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
    add: (name: string, modelId: string, opts?: { provider?: string; is_paid?: boolean; priority?: number }) =>
      invoke<AiModel>("add_ai_model", { req: { name, model_id: modelId, ...opts } }),
    update: (id: string, fields: { name?: string; priority?: number; is_paid?: boolean; enabled?: boolean }) =>
      invoke<AiModel>("update_ai_model", { req: { id, ...fields } }),
    delete: (id: string) => invoke<void>("delete_ai_model", { id }),
    getDefault: () => invoke<AiModel>("get_default_model"),
    recordTokenUsage: (modelId: string, tokens: number) =>
      invoke<void>("record_model_token_usage", { modelId, tokens }),
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
    create: (workspaceId: string, content: string, opts?: { processAt?: string; modelName?: string; promptPrefix?: string }) =>
      invoke<ThoughtItem>("create_thought", {
        req: { workspace_id: workspaceId, content, process_at: opts?.processAt, model_name: opts?.modelName, prompt_prefix: opts?.promptPrefix },
      }),
    list: (workspaceId: string) => invoke<ThoughtItem[]>("list_thoughts", { workspaceId }),
    getDue: (workspaceId: string) => invoke<ThoughtItem[]>("get_due_thoughts", { workspaceId }),
    updateStatus: (id: string, status: string) => invoke<void>("update_thought_status", { id, status }),
    updateResult: (id: string, result: string) => invoke<void>("update_thought_result", { id, result }),
    delete: (id: string) => invoke<void>("delete_thought", { id }),
  },

  webAI: {
    /** Send a query to a web AI provider via the Playwright bridge. */
    sendMessage: (sessionId: string, provider: string, query: string, preserveSession: boolean) =>
      invoke<string>("send_web_message", { sessionId: sessionId, provider, query, preserveSession }),
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

  mcp: {
    listServers: () => invoke<MCPServerConfig[]>("list_mcp_servers", {}),
    addServer: (name: string, command: string, args: string[], workspaceId: string) =>
      invoke<MCPServerConfig>("add_mcp_server", { name, command, args, workspace_id: workspaceId }),
    updateServer: (name: string, command: string, args: string[], enabled: boolean) =>
      invoke<void>("update_mcp_server", { name, command, args, enabled }),
    deleteServer: (name: string) =>
      invoke<void>("delete_mcp_server", { name }),
    connectServer: (serverName: string) =>
      invoke<void>("mcp_connect_server", { server_name: serverName }),
    disconnectServer: (serverName: string) =>
      invoke<void>("mcp_disconnect_server", { server_name: serverName }),
    listTools: (serverName: string) =>
      invoke<MCPTool[]>("mcp_list_tools", { server_name: serverName }),
    callTool: (serverName: string, toolName: string, toolArguments: Record<string, unknown>) =>
      invoke<string>("mcp_call_tool", { server_name: serverName, tool_name: toolName, arguments: toolArguments }),
    listResources: (serverName: string) =>
      invoke<[MCPResource[], MCPResourceTemplate[]]>("mcp_list_resources", { server_name: serverName }),
    readResource: (serverName: string, uri: string) =>
      invoke<string>("mcp_read_resource", { server_name: serverName, uri }),
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
    invoke<MCPServerConfig>("add_mcp_server", { name, command, args, workspace_id: workspaceId }),
  updateServer: (name: string, command: string, args: string[], enabled: boolean) =>
    invoke<void>("update_mcp_server", { name, command, args, enabled }),
  deleteServer: (name: string) =>
    invoke<void>("delete_mcp_server", { name }),
  connectServer: (serverName: string) =>
    invoke<void>("mcp_connect_server", { server_name: serverName }),
  disconnectServer: (serverName: string) =>
    invoke<void>("mcp_disconnect_server", { server_name: serverName }),

  // Tool discovery and invocation
  listTools: (serverName: string) =>
    invoke<MCPTool[]>("mcp_list_tools", { server_name: serverName }),
  callTool: (serverName: string, toolName: string, toolArguments: Record<string, unknown>) =>
    invoke<string>("mcp_call_tool", { server_name: serverName, tool_name: toolName, arguments: toolArguments }),

  // Resource discovery and access
  listResources: (serverName: string) =>
    invoke<[MCPResource[], MCPResourceTemplate[]]>("mcp_list_resources", { server_name: serverName }),
  readResource: (serverName: string, uri: string) =>
    invoke<string>("mcp_read_resource", { server_name: serverName, uri }),
};
