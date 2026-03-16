/**
 * Typed IPC wrappers for all Tauri backend commands.
 * Mirrors the Rust #[tauri::command] functions in src-tauri/src/commands/.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { Workspace, Project } from "../stores/workspaceStore";
import type { ChatSession, Message } from "../stores/chatStore";

// ----- Types -----

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
  id: string; project_id: string; front: string; back: string;
  source_type: string; ease_factor: number; interval: number;
  repetitions: number; next_review_date: string; last_reviewed_at?: string;
  created_at: string;
}

export interface ReviewStats {
  total_cards: number; due_today: number; learned: number; avg_ease: number;
}

export interface ProjectNote {
  id: string; project_id: string; title: string; content: string;
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
  id: string; project_id: string; filename: string; file_type: string;
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

export interface StreamEvent { session_id: string; chunk: string; done: boolean; }

// ----- Workspaces -----
export const api = {
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
    createSession: (projectId?: string | null, opts?: { title?: string; modelName?: string; systemPrompt?: string }) =>
      invoke<ChatSession>("create_chat_session", { req: { project_id: projectId ?? '', title: opts?.title, model_name: opts?.modelName, system_prompt: opts?.systemPrompt } }),
    listSessions: (projectId?: string | null) => invoke<ChatSession[]>("list_chat_sessions", { projectId: projectId ?? '' }),
    getSession: (id: string) => invoke<ChatSession | null>("get_chat_session", { id }),
    deleteSession: (id: string) => invoke<void>("delete_chat_session", { id }),
    updateSession: (id: string, fields: { title?: string; is_pinned?: boolean; system_prompt?: string }) =>
      invoke<void>("update_chat_session", { id, title: fields.title, isPinned: fields.is_pinned, systemPrompt: fields.system_prompt }),
    addMessage: (sessionId: string, role: "user" | "assistant", content: string) =>
      invoke<Message>("add_message", { req: { session_id: sessionId, role, content } }),
    getMessages: (sessionId: string) => invoke<Message[]>("get_messages", { sessionId }),
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
    create: (projectId: string, front: string, back: string) =>
      invoke<LearningCard>("create_flashcard", { req: { project_id: projectId, front, back } }),
    listDue: (projectId: string) => invoke<LearningCard[]>("list_flashcards_due", { projectId }),
    review: (cardId: string, quality: number) =>
      invoke<LearningCard>("review_flashcard", { req: { card_id: cardId, quality } }),
    getStats: (projectId: string) => invoke<ReviewStats>("get_review_stats", { projectId }),
  },

  note: {
    create: (projectId: string, title: string, content?: string) =>
      invoke<ProjectNote>("create_note", { req: { project_id: projectId, title, content } }),
    list: (projectId: string) => invoke<ProjectNote[]>("list_notes", { projectId }),
    get: (id: string) => invoke<ProjectNote | null>("get_note", { id }),
    update: (id: string, fields: Partial<ProjectNote>) => invoke<void>("update_note", { req: { id, ...fields } }),
    delete: (id: string) => invoke<void>("delete_note", { id }),
    getDailyNote: (workspaceId: string, date?: string) =>
      invoke<DailyNote>("get_or_create_daily_note", { req: { workspace_id: workspaceId, date } }),
    updateDailyNote: (id: string, content?: string, mood?: number, productivity?: number) =>
      invoke<void>("update_daily_note", { id, content, mood: mood !== undefined ? mood : null, productivity: productivity !== undefined ? productivity : null }),
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
    upload: (projectId: string, filename: string, fileType: string, fileSize: number, content: string) =>
      invoke<UploadedDocument>("upload_document", { req: { project_id: projectId, filename, file_type: fileType, file_size: fileSize, content } }),
    list: (projectId: string) => invoke<UploadedDocument[]>("list_documents", { projectId }),
    get: (id: string) => invoke<UploadedDocument | null>("get_document", { id }),
    delete: (id: string) => invoke<void>("delete_document", { id }),
    process: (documentId: string) => invoke<number>("process_document", { req: { document_id: documentId } }),
  },

  search: {
    keyword: (query: string, workspaceId: string, projectId?: string) =>
      invoke<SearchResult[]>("keyword_search", { req: { query, workspace_id: workspaceId, project_id: projectId } }),
    semantic: (query: string, workspaceId: string, queryEmbedding: number[], projectId: string) =>
      invoke<SearchResult[]>("semantic_search", { req: { query, workspace_id: workspaceId }, queryEmbedding, projectId }),
  },

  ollama: {
    sendMessage: (sessionId: string, model: string, messages: { role: string; content: string }[], stream: boolean, ollamaUrl?: string) =>
      invoke<string>("send_message", { req: { session_id: sessionId, model, messages, stream, ollama_url: ollamaUrl } }),
    listModels: (ollamaUrl?: string) => invoke<OllamaModel[]>("list_models", { ollamaUrl }),
    generateTitle: (model: string, firstMessage: string, ollamaUrl?: string) =>
      invoke<string>("generate_title", { model, firstMessage, ollamaUrl }),
    generateEmbedding: (text: string, model?: string, ollamaUrl?: string) =>
      invoke<number[]>("generate_embedding", { req: { text, model, ollama_url: ollamaUrl } }),
  },

  export: {
    markdown: (projectId: string) => invoke<string>("export_markdown", { req: { project_id: projectId } }),
    json: (projectId: string) => invoke<string>("export_json", { req: { project_id: projectId } }),
    obsidian: (projectId: string) => invoke<Array<{ path: string; content: string }>>("export_obsidian_vault", { req: { project_id: projectId } }),
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
    create: (projectId: string, url: string, title: string, content: string, summary?: string) =>
      invoke<{ id: string; project_id: string; url: string; title: string; content: string; summary?: string; is_processed: boolean; created_at: string }>(
        "create_web_capture", { projectId, url, title, content, summary }
      ),
    list: (projectId: string) =>
      invoke<{ id: string; project_id: string; url: string; title: string; content: string; summary?: string; is_processed: boolean; created_at: string }[]>(
        "list_web_captures", { projectId }
      ),
    get: (id: string) =>
      invoke<{ id: string; project_id: string; url: string; title: string; content: string; summary?: string; is_processed: boolean; created_at: string } | null>(
        "get_web_capture", { id }
      ),
    delete: (id: string) => invoke<void>("delete_web_capture", { id }),
    update: (id: string, fields: { title?: string; summary?: string; is_processed?: boolean }) =>
      invoke<void>("update_web_capture", { id, ...fields }),
  },

  // Streaming: listen to Ollama stream events for a session
  listenStream: (sessionId: string, onChunk: (chunk: string, done: boolean) => void): Promise<UnlistenFn> =>
    listen<StreamEvent>(`ollama-stream-${sessionId}`, (event) => {
      onChunk(event.payload.chunk, event.payload.done);
    }),
};
