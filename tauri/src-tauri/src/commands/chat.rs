use tauri::State;

use crate::commands::chat_file::{ChatCryptoState, ChatsDirState};
use crate::commands::quick_search::QuickSearchRuntimeState;
use crate::db::DbState;
use crate::models::chat::{AddMessageRequest, ChatSession, CreateChatSessionRequest, Message};
use crate::services::chat_service;
use crate::services::quick_search_service::{self, QuickSearchResult};

#[derive(Debug, serde::Deserialize)]
pub struct SearchChatSessionsRequest {
    pub workspace_id: String,
    pub query: String,
    pub folder_id: Option<String>,
    pub include_descendants: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
pub struct GetRelatedChatsRequest {
    pub workspace_id: String,
    pub session_id: Option<String>,
    pub tags: Vec<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, serde::Serialize)]
pub struct TokenUsageByDate {
    pub day: String,
    pub total_tokens: i64,
}

#[tauri::command]
pub fn create_chat_session(
    state: State<DbState>,
    req: CreateChatSessionRequest,
) -> Result<ChatSession, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::create_session(&conn, req)
}

#[tauri::command]
pub fn list_chat_sessions(
    state: State<DbState>,
    workspace_id: String,
    folder_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
    include_descendants: Option<bool>,
) -> Result<Vec<ChatSession>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::list_sessions(&conn, &workspace_id, &folder_id, limit, offset, include_descendants.unwrap_or(false))
}

#[tauri::command]
pub fn search_chat_sessions(
    state: State<DbState>,
    req: SearchChatSessionsRequest,
) -> Result<Vec<ChatSession>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::search_sessions(
        &conn,
        &req.workspace_id,
        req.folder_id.as_deref(),
        &req.query,
        req.include_descendants.unwrap_or(false),
    )
}

#[tauri::command]
pub fn get_chat_session(state: State<DbState>, id: String) -> Result<Option<ChatSession>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::get_session(&conn, &id)
}

#[tauri::command]
pub fn get_related_chats(
    state: tauri::State<DbState>,
    req: GetRelatedChatsRequest,
) -> Result<Vec<QuickSearchResult>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = req.limit.unwrap_or(5).clamp(1, 20);

    if req.tags.is_empty() {
        return Ok(vec![]);
    }

    // Quote every tag as an FTS5 phrase so multi-word tags (e.g. "state
    // management") and tags containing special chars (e.g. "c++") are safe.
    let fts_query: String = req
        .tags
        .iter()
        .filter_map(|tag| {
            let cleaned = tag.trim().replace('"', "");
            if cleaned.is_empty() { None } else { Some(format!("\"{}\"", cleaned)) }
        })
        .collect::<Vec<_>>()
        .join(" OR ");

    if fts_query.is_empty() {
        return Ok(vec![]);
    }

    let workspace_ids = vec![req.workspace_id.clone()];
    quick_search_service::query_filtered(
        &conn,
        &fts_query,
        limit,
        Some(&workspace_ids),
        req.session_id.as_deref(),
        Some(&["conversation".to_string()]),
    )
}

#[tauri::command]
pub fn delete_chat_session(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::soft_delete(&conn, &id)
}

#[tauri::command]
pub fn hard_delete_chat_session(
    state: State<DbState>,
    workspace_id: String,
    id: String,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::hard_delete(&conn, &workspace_id, &id)
}

#[tauri::command]
pub fn list_deleted_chat_sessions(
    state: State<DbState>,
    workspace_id: String,
    include_descendants: Option<bool>,
) -> Result<Vec<ChatSession>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::list_deleted(&conn, &workspace_id, include_descendants.unwrap_or(false))
}

#[tauri::command]
pub fn restore_chat_session(
    state: State<DbState>,
    workspace_id: String,
    id: String,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::restore(&conn, &workspace_id, &id)
}

#[tauri::command]
pub fn empty_recycle_bin(state: State<DbState>, workspace_id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::empty_recycle_bin(&conn, &workspace_id)
}

#[tauri::command]
pub fn move_chat_sessions(
    state: State<DbState>,
    session_ids: Vec<String>,
    target_workspace_id: String,
    target_folder_id: Option<String>,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
    chat_service::move_sessions(
        &conn,
        &session_ids,
        &target_workspace_id,
        target_folder_id.as_deref(),
        &chats_dir_state.0,
        pass.as_deref(),
    )
}

/// Request for batch cross-workspace move with optional folder structure preservation.
#[derive(Debug, serde::Deserialize)]
pub struct BatchMoveSessionsRequest {
    pub session_ids: Vec<String>,
    pub target_workspace_id: String,
    pub preserve_folder_structure: bool,
}

/// Maps source folder ID to newly created/matched destination folder ID.
#[derive(Debug, serde::Serialize, Default)]
pub struct BatchMoveSessionsResult {
    pub sessions_moved: usize,
    pub folders_created: Vec<String>,
    /// Map from source project ID to destination folder ID
    pub folder_mapping: std::collections::HashMap<String, String>,
}

/// Batch move sessions across workspaces in a single transaction.
/// When preserve_folder_structure is true, creates matching folders in the target workspace.
#[tauri::command]
pub fn batch_move_sessions(
    state: State<DbState>,
    req: BatchMoveSessionsRequest,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
) -> Result<BatchMoveSessionsResult, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
    let outcome = chat_service::batch_move_sessions(
        &conn,
        &req.session_ids,
        &req.target_workspace_id,
        req.preserve_folder_structure,
        &chats_dir_state.0,
        pass.as_deref(),
    )?;
    Ok(BatchMoveSessionsResult {
        sessions_moved: outcome.sessions_moved,
        folders_created: outcome.folders_created,
        folder_mapping: outcome.folder_mapping,
    })
}

#[tauri::command]
pub fn add_message(
    state: State<DbState>,
    quick_search_state: State<QuickSearchRuntimeState>,
    req: AddMessageRequest,
) -> Result<Message, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let workspace_id = req.workspace_id.clone();
    let message = chat_service::add_message(&conn, req)?;

    if let Ok(mut preferred_workspace_id) = quick_search_state.preferred_workspace_id.lock() {
        *preferred_workspace_id = Some(workspace_id);
    }

    Ok(message)
}

#[tauri::command]
pub fn get_messages(
    state: State<DbState>,
    session_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<Message>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::get_messages(&conn, &session_id, limit, offset)
}

#[tauri::command]
pub fn update_chat_session(
    state: State<DbState>,
    id: String,
    title: Option<String>,
    is_pinned: Option<bool>,
    system_prompt: Option<String>,
    model_name: Option<String>,
    exclude_from_analytics: Option<bool>,
    is_unread: Option<bool>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::update_session(&conn, &id, title, is_pinned, system_prompt, model_name, exclude_from_analytics, is_unread)
}

#[tauri::command]
pub fn get_token_usage_by_date(
    state: State<DbState>,
    workspace_id: String,
    days: Option<i64>,
) -> Result<Vec<TokenUsageByDate>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let rows = chat_service::get_token_usage_by_date(&conn, &workspace_id, days)?;
    Ok(rows
        .into_iter()
        .map(|(day, total_tokens)| TokenUsageByDate { day, total_tokens })
        .collect())
}

#[tauri::command]
pub fn touch_session_accessed(state: State<DbState>, session_id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::touch_accessed(&conn, &session_id)
}

#[tauri::command]
pub fn get_recent_sessions(
    state: State<DbState>,
    workspace_id: String,
    limit: Option<i64>,
    include_descendants: Option<bool>,
) -> Result<Vec<ChatSession>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::get_recent(&conn, &workspace_id, limit, include_descendants.unwrap_or(false))
}

#[tauri::command]
pub fn refresh_message(
    state: State<DbState>,
    session_id: String,
    message_id: String,
    model_id: String,
) -> Result<Message, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::refresh_message(&conn, &session_id, &message_id, &model_id)
}

#[tauri::command]
pub fn get_message_variants(
    state: State<DbState>,
    message_id: String,
) -> Result<Vec<Message>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::get_message_variants(&conn, &message_id)
}

#[tauri::command]
pub fn count_sessions_per_child_workspace(
    state: State<DbState>,
    parent_workspace_id: String,
) -> Result<std::collections::HashMap<String, i64>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    chat_service::count_sessions_per_child_workspace(&conn, &parent_workspace_id)
}
