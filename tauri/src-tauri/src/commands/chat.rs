use tauri::State;

use crate::commands::chat_file::{ChatCryptoState, ChatsDirState};
use crate::db::DbState;
use crate::models::chat::{
    AddMessageRequest, ChatSession, CreateChatSessionRequest, Message, MessageRole,
};
use crate::services::chat_file_store;
use crate::services::quick_search_service::{self, QuickSearchResult};

#[derive(Debug, serde::Deserialize)]
pub struct SearchChatSessionsRequest {
    pub workspace_id: String,
    pub query: String,
    pub project_id: Option<String>,
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

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatSession> {
    Ok(ChatSession {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        project_id: row.get(2)?,
        title: row.get(3)?,
        model_name: row.get(4)?,
        system_prompt: row.get(5)?,
        is_pinned: row.get::<_, i32>(6)? != 0,
        is_incognito: row.get::<_, i32>(7)? != 0,
        exclude_from_analytics: row.get::<_, i32>(8)? != 0,
        is_deleted: row.get::<_, i32>(9)? != 0,
        deleted_at: row.get(10)?,
        last_accessed_at: row.get(11)?,
        last_processed_message_count: row.get(12)?,
        is_imported: row.get::<_, i32>(13)? != 0,
        parent_session_id: row.get(14)?,
        branch_message_id: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        message_count: row.get(18)?,
    })
}

#[tauri::command]
pub fn create_chat_session(
    state: State<DbState>,
    req: CreateChatSessionRequest,
) -> Result<ChatSession, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut session = ChatSession::new(req.workspace_id, req.project_id);
    if let Some(title) = req.title {
        session.title = title;
    }
    if let Some(model_name) = req.model_name {
        session.model_name = model_name;
    }
    if let Some(system_prompt) = req.system_prompt {
        session.system_prompt = system_prompt;
    }
    session.is_incognito = req.is_incognito.unwrap_or(false);
    session.exclude_from_analytics = req.exclude_from_analytics.unwrap_or(false);
    session.parent_session_id = req.parent_session_id;
    session.branch_message_id = req.branch_message_id;

    conn.execute(
        "INSERT INTO chat_sessions (
            id, workspace_id, project_id, title, model_name, system_prompt,
            is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at,
            last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
            created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        rusqlite::params![
            session.id,
            session.workspace_id,
            session.project_id,
            session.title,
            session.model_name,
            session.system_prompt,
            session.is_pinned as i32,
            session.is_incognito as i32,
            session.exclude_from_analytics as i32,
            session.is_deleted as i32,
            session.deleted_at,
            session.last_accessed_at,
            session.last_processed_message_count,
            session.is_imported as i32,
            session.parent_session_id,
            session.branch_message_id,
            session.created_at,
            session.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(session)
}

#[tauri::command]
pub fn list_chat_sessions(
    state: State<DbState>,
    workspace_id: String,
    project_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<ChatSession>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(200).clamp(1, 1000);
    let offset = offset.unwrap_or(0).max(0);
    let sql = if project_id.is_empty() {
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
                created_at, updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = id) AS message_count
         FROM chat_sessions
         WHERE workspace_id = ?1 AND is_deleted = 0
         ORDER BY is_pinned DESC, updated_at DESC
         LIMIT ?2 OFFSET ?3"
    } else {
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
                created_at, updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = id) AS message_count
         FROM chat_sessions
         WHERE workspace_id = ?1 AND project_id = ?2 AND is_deleted = 0
         ORDER BY is_pinned DESC, updated_at DESC
         LIMIT ?3 OFFSET ?4"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = if project_id.is_empty() {
        stmt.query_map(
            rusqlite::params![workspace_id, limit, offset],
            row_to_session,
        )
    } else {
        stmt.query_map(
            rusqlite::params![workspace_id, project_id, limit, offset],
            row_to_session,
        )
    }
    .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_chat_sessions(
    state: State<DbState>,
    req: SearchChatSessionsRequest,
) -> Result<Vec<ChatSession>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let pattern = format!("%{}%", req.query.trim());
    let sql = if req.project_id.as_deref().unwrap_or_default().is_empty() {
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
                created_at, updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = id) AS message_count
         FROM chat_sessions
         WHERE workspace_id = ?1 AND is_deleted = 0
           AND (title LIKE ?2 OR model_name LIKE ?2)
         ORDER BY is_pinned DESC, updated_at DESC"
    } else {
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
                created_at, updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = id) AS message_count
         FROM chat_sessions
         WHERE workspace_id = ?1 AND project_id = ?2 AND is_deleted = 0
           AND (title LIKE ?3 OR model_name LIKE ?3)
         ORDER BY is_pinned DESC, updated_at DESC"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = if let Some(project_id) = req.project_id.filter(|id| !id.is_empty()) {
        stmt.query_map(
            rusqlite::params![req.workspace_id, project_id, pattern],
            row_to_session,
        )
    } else {
        stmt.query_map(rusqlite::params![req.workspace_id, pattern], row_to_session)
    }
    .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_chat_session(state: State<DbState>, id: String) -> Result<Option<ChatSession>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
                created_at, updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = id) AS message_count
         FROM chat_sessions WHERE id = ?1",
        rusqlite::params![id],
        row_to_session,
    );

    match result {
        Ok(session) => Ok(Some(session)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
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

    quick_search_service::query_filtered(
        &conn,
        &fts_query,
        limit,
        Some(&req.workspace_id),
        req.session_id.as_deref(),
        Some("conversation"),
    )
}

#[tauri::command]
pub fn delete_chat_session(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE chat_sessions
         SET is_deleted = 1, deleted_at = ?1, updated_at = ?1
         WHERE id = ?2",
        rusqlite::params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn hard_delete_chat_session(
    state: State<DbState>,
    workspace_id: String,
    id: String,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM chat_sessions WHERE id = ?1 AND workspace_id = ?2",
        rusqlite::params![id, workspace_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_deleted_chat_sessions(
    state: State<DbState>,
    workspace_id: String,
) -> Result<Vec<ChatSession>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
                created_at, updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = id) AS message_count
         FROM chat_sessions
         WHERE workspace_id = ?1 AND is_deleted = 1
         ORDER BY deleted_at DESC, updated_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![workspace_id], row_to_session)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_chat_session(
    state: State<DbState>,
    workspace_id: String,
    id: String,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE chat_sessions
         SET is_deleted = 0, deleted_at = NULL, updated_at = ?1
         WHERE id = ?2 AND workspace_id = ?3",
        rusqlite::params![now, id, workspace_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn empty_recycle_bin(state: State<DbState>, workspace_id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM chat_sessions WHERE workspace_id = ?1 AND is_deleted = 1",
        rusqlite::params![workspace_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn move_chat_sessions(
    state: State<DbState>,
    session_ids: Vec<String>,
    target_workspace_id: String,
    target_project_id: Option<String>,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
) -> Result<(), String> {
    if session_ids.is_empty() {
        return Ok(());
    }
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let previous_paths =
        chat_file_store::capture_session_file_variants(&conn, &chats_dir_state.0, &session_ids);
    let target_project_id = target_project_id.unwrap_or_default();

    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;
    let result = (|| {
        let placeholders: String = session_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 4))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "UPDATE chat_sessions SET workspace_id = ?1, project_id = ?2 WHERE id IN ({})",
            placeholders
        );
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> =
            Vec::with_capacity(2 + session_ids.len());
        params.push(Box::new(target_workspace_id.clone()));
        params.push(Box::new(target_project_id.clone()));
        for sid in &session_ids {
            params.push(Box::new(sid.clone()));
        }
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
            chat_file_store::sync_session_files_for_hierarchy_change(
                &conn,
                &chats_dir_state.0,
                &session_ids,
                &previous_paths,
                pass.as_deref(),
            )?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

/// Request for batch cross-workspace move with optional folder structure preservation.
#[derive(Debug, serde::Deserialize)]
pub struct BatchMoveSessionsRequest {
    pub session_ids: Vec<String>,
    pub target_workspace_id: String,
    pub preserve_folder_structure: bool,
}

/// Maps source project ID to newly created/matched destination project ID.
#[derive(Debug, serde::Serialize, Default)]
pub struct BatchMoveSessionsResult {
    pub sessions_moved: usize,
    pub projects_created: Vec<String>,
    /// Map from source project ID to destination project ID
    pub project_mapping: std::collections::HashMap<String, String>,
}

/// Batch move sessions across workspaces in a single transaction.
/// When preserve_folder_structure is true, creates matching projects in the target workspace.
#[tauri::command]
pub fn batch_move_sessions(
    state: State<DbState>,
    req: BatchMoveSessionsRequest,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
) -> Result<BatchMoveSessionsResult, String> {
    if req.session_ids.is_empty() {
        return Ok(BatchMoveSessionsResult::default());
    }

    let conn = state.0.get().map_err(|e| e.to_string())?;
    let previous_paths =
        chat_file_store::capture_session_file_variants(&conn, &chats_dir_state.0, &req.session_ids);

    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;

    let result = (|| -> Result<BatchMoveSessionsResult, String> {
        use crate::models::project::Project;

        let mut res = BatchMoveSessionsResult::default();

        // Get session details with their source project info
        let placeholders: String = req
            .session_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(", ");

        let sql = format!(
            "SELECT id, project_id FROM chat_sessions WHERE id IN ({})",
            placeholders
        );

        let params: Vec<&dyn rusqlite::types::ToSql> = req
            .session_ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let session_project_pairs: Vec<(String, String)> = stmt
            .query_map(params.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1).unwrap_or_default(),
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        if req.preserve_folder_structure {
            // Get unique source project IDs (excluding empty/root)
            let source_project_ids: std::collections::HashSet<String> = session_project_pairs
                .iter()
                .filter(|(_, pid)| !pid.is_empty())
                .map(|(_, pid)| pid.clone())
                .collect();

            // Load source projects
            let mut source_projects: std::collections::HashMap<String, Project> =
                std::collections::HashMap::new();
            for pid in &source_project_ids {
                let project: Option<Project> = conn.query_row(
                    "SELECT id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at 
                     FROM projects WHERE id = ?1",
                    rusqlite::params![pid],
                    |row| Ok(Project {
                        id: row.get(0)?,
                        workspace_id: row.get(1)?,
                        name: row.get(2)?,
                        project_description: row.get(3)?,
                        custom_instructions: row.get(4)?,
                        color: row.get(5)?,
                        icon: row.get(6)?,
                        created_at: row.get(7)?,
                        updated_at: row.get(8)?,
                    })
                ).ok();
                if let Some(p) = project {
                    source_projects.insert(pid.clone(), p);
                }
            }

            // Load existing projects in target workspace
            let existing_projects: Vec<(String, String)> = conn
                .prepare("SELECT id, name FROM projects WHERE workspace_id = ?1")
                .map_err(|e| e.to_string())?
                .query_map(rusqlite::params![&req.target_workspace_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;

            let existing_by_name: std::collections::HashMap<String, String> = existing_projects
                .iter()
                .map(|(id, name)| (name.trim().to_lowercase(), id.clone()))
                .collect();

            // Create or match projects
            for (source_pid, source_project) in &source_projects {
                let normalized_name = source_project.name.trim().to_lowercase();
                let target_pid = if let Some(existing_id) = existing_by_name.get(&normalized_name) {
                    existing_id.clone()
                } else {
                    // Create new project
                    let new_project =
                        Project::new(req.target_workspace_id.clone(), source_project.name.clone());
                    conn.execute(
                        "INSERT INTO projects (id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        rusqlite::params![
                            new_project.id,
                            new_project.workspace_id,
                            new_project.name,
                            source_project.project_description,
                            source_project.custom_instructions,
                            source_project.color,
                            source_project.icon,
                            new_project.created_at,
                            new_project.updated_at
                        ],
                    ).map_err(|e| e.to_string())?;
                    res.projects_created.push(new_project.id.clone());
                    new_project.id
                };
                res.project_mapping.insert(source_pid.clone(), target_pid);
            }

            // Move sessions to their mapped projects
            for (session_id, source_pid) in &session_project_pairs {
                let target_pid = if source_pid.is_empty() {
                    String::new()
                } else {
                    res.project_mapping
                        .get(source_pid)
                        .cloned()
                        .unwrap_or_default()
                };

                conn.execute(
                    "UPDATE chat_sessions SET workspace_id = ?1, project_id = ?2 WHERE id = ?3",
                    rusqlite::params![&req.target_workspace_id, &target_pid, session_id],
                ).map_err(|e| e.to_string())?;
            }
        } else {
            // Simple move all to workspace root (no folder structure)
            let sql = format!(
                "UPDATE chat_sessions SET workspace_id = ?1, project_id = ?2 WHERE id IN ({})",
                placeholders
            );
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> =
                Vec::with_capacity(2 + req.session_ids.len());
            params.push(Box::new(req.target_workspace_id.clone()));
            params.push(Box::new(String::new())); // Empty project_id = root
            for sid in &req.session_ids {
                params.push(Box::new(sid.clone()));
            }
            let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();
            conn.execute(&sql, param_refs.as_slice())
                .map_err(|e| e.to_string())?;
        }

        res.sessions_moved = session_project_pairs.len();
        let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
        chat_file_store::sync_session_files_for_hierarchy_change(
            &conn,
            &chats_dir_state.0,
            &req.session_ids,
            &previous_paths,
            pass.as_deref(),
        )?;

        Ok(res)
    })();

    match result {
        Ok(r) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(r)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

#[tauri::command]
pub fn add_message(state: State<DbState>, req: AddMessageRequest) -> Result<Message, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let msg = Message {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: req.session_id.clone(),
        role: req.role,
        content: req.content,
        model_name: req.model_name,
        tokens_used: req.tokens_used,
        duration_ms: req.duration_ms,
        variant_group_id: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let role_str = msg.role.to_string();
    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, model_name, tokens_used, duration_ms, variant_group_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            msg.id,
            msg.session_id,
            role_str,
            msg.content,
            msg.model_name,
            msg.tokens_used,
            msg.duration_ms,
            msg.variant_group_id,
            msg.created_at
        ],
    )
    .map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();
    let _ = conn.execute(
        "UPDATE chat_sessions SET updated_at = ?1, is_imported = 0 WHERE id = ?2",
        rusqlite::params![now, req.session_id],
    );
    Ok(msg)
}

#[tauri::command]
pub fn get_messages(
    state: State<DbState>,
    session_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<Message>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(200).clamp(1, 2000);
    let offset = offset.unwrap_or(0).max(0);
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, model_name, tokens_used, duration_ms, variant_group_id, created_at
         FROM messages WHERE session_id = ?1 ORDER BY created_at ASC
         LIMIT ?2 OFFSET ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![session_id, limit, offset], |row| {
            let role_str: String = row.get(2)?;
            let role = role_str.parse::<MessageRole>().unwrap_or(MessageRole::User);
            Ok(Message {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role,
                content: row.get(3)?,
                model_name: row.get(4)?,
                tokens_used: row.get(5)?,
                duration_ms: row.get(6)?,
                variant_group_id: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_chat_session(
    state: State<DbState>,
    id: String,
    title: Option<String>,
    is_pinned: Option<bool>,
    system_prompt: Option<String>,
    model_name: Option<String>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE chat_sessions SET
            title = COALESCE(?1, title),
            is_pinned = COALESCE(?2, is_pinned),
            system_prompt = COALESCE(?3, system_prompt),
            model_name = COALESCE(?4, model_name),
            updated_at = ?5
         WHERE id = ?6",
        rusqlite::params![
            title,
            is_pinned.map(|value| value as i32),
            system_prompt,
            model_name,
            now,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_token_usage_by_date(
    state: State<DbState>,
    workspace_id: String,
    days: Option<i64>,
) -> Result<Vec<TokenUsageByDate>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let days = days.unwrap_or(30).max(1);
    let mut stmt = conn.prepare(
        "SELECT substr(m.created_at, 1, 10) AS day, COALESCE(SUM(m.tokens_used), 0) AS total_tokens
         FROM messages m
         JOIN chat_sessions s ON s.id = m.session_id
         WHERE s.workspace_id = ?1
           AND m.tokens_used IS NOT NULL
           AND datetime(m.created_at) >= datetime('now', '-' || ?2 || ' days')
         GROUP BY substr(m.created_at, 1, 10)
         ORDER BY day ASC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![workspace_id, days], |row| {
            Ok(TokenUsageByDate {
                day: row.get(0)?,
                total_tokens: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn touch_session_accessed(state: State<DbState>, session_id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE chat_sessions SET last_accessed_at = ?1 WHERE id = ?2",
        rusqlite::params![now, session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_recent_sessions(
    state: State<DbState>,
    workspace_id: String,
    limit: Option<i64>,
) -> Result<Vec<ChatSession>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(10).clamp(1, 100);
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
                created_at, updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = id) AS message_count
         FROM chat_sessions
         WHERE workspace_id = ?1 AND is_deleted = 0
         ORDER BY last_accessed_at DESC
         LIMIT ?2"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![workspace_id, limit], row_to_session)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn refresh_message(
    state: State<DbState>,
    session_id: String,
    message_id: String,
    model_id: String,
) -> Result<Message, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    // Fetch the original message to refresh
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, model_name, tokens_used, duration_ms, variant_group_id, created_at
             FROM messages WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let original_msg = stmt
        .query_row(rusqlite::params![message_id], |row| {
            let role_str: String = row.get(2)?;
            let role = role_str.parse::<MessageRole>().unwrap_or(MessageRole::User);
            Ok(Message {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role,
                content: row.get(3)?,
                model_name: row.get(4)?,
                tokens_used: row.get(5)?,
                duration_ms: row.get(6)?,
                variant_group_id: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    // Only assistant messages can be refreshed
    if original_msg.role != MessageRole::Assistant {
        return Err("Only assistant messages can be refreshed".to_string());
    }

    // Determine variant group ID
    let variant_group_id = if let Some(existing_group) = original_msg.variant_group_id {
        existing_group
    } else {
        // First refresh - create new group ID and link the original message
        let new_group_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "UPDATE messages SET variant_group_id = ?1 WHERE id = ?2",
            rusqlite::params![&new_group_id, &original_msg.id],
        )
        .map_err(|e| e.to_string())?;
        new_group_id
    };

    // Create the new variant message
    let new_msg = Message {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        role: MessageRole::Assistant,
        content: String::new(), // Will be filled by streaming
        model_name: Some(model_id),
        tokens_used: None,
        duration_ms: None,
        variant_group_id: Some(variant_group_id),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    // Insert the new message with the variant group ID
    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, model_name, tokens_used, duration_ms, variant_group_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            new_msg.id,
            new_msg.session_id,
            new_msg.role.to_string(),
            new_msg.content,
            new_msg.model_name,
            new_msg.tokens_used,
            new_msg.duration_ms,
            new_msg.variant_group_id,
            new_msg.created_at
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(new_msg)
}

#[tauri::command]
pub fn get_message_variants(
    state: State<DbState>,
    message_id: String,
) -> Result<Vec<Message>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    // First, fetch the message to check if it's part of a variant group
    let mut stmt = conn
        .prepare("SELECT variant_group_id FROM messages WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let variant_group_id: Option<String> = stmt
        .query_row(rusqlite::params![message_id], |row| row.get(0))
        .ok();

    if let Some(group_id) = variant_group_id {
        // Fetch all messages in this variant group, sorted by created_at DESC (most recent first)
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, role, content, model_name, tokens_used, duration_ms, variant_group_id, created_at
                 FROM messages WHERE variant_group_id = ?1
                 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(rusqlite::params![group_id], |row| {
                let role_str: String = row.get(2)?;
                let role = role_str.parse::<MessageRole>().unwrap_or(MessageRole::User);
                Ok(Message {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role,
                    content: row.get(3)?,
                    model_name: row.get(4)?,
                    tokens_used: row.get(5)?,
                    duration_ms: row.get(6)?,
                    variant_group_id: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    } else {
        // No variants - return just this message
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, role, content, model_name, tokens_used, duration_ms, variant_group_id, created_at
                 FROM messages WHERE id = ?1",
            )
            .map_err(|e| e.to_string())?;

        let msg = stmt
            .query_row(rusqlite::params![message_id], |row| {
                let role_str: String = row.get(2)?;
                let role = role_str.parse::<MessageRole>().unwrap_or(MessageRole::User);
                Ok(Message {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role,
                    content: row.get(3)?,
                    model_name: row.get(4)?,
                    tokens_used: row.get(5)?,
                    duration_ms: row.get(6)?,
                    variant_group_id: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;

        Ok(vec![msg])
    }
}
