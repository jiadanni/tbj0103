use tauri::State;

use crate::db::DbState;
use crate::models::chat::{AddMessageRequest, ChatSession, CreateChatSessionRequest, Message, MessageRole};

#[derive(Debug, serde::Deserialize)]
pub struct SearchChatSessionsRequest {
    pub workspace_id: String,
    pub query: String,
    pub project_id: Option<String>,
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
        parent_session_id: row.get(11)?,
        branch_message_id: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

#[tauri::command]
pub fn create_chat_session(state: State<DbState>, req: CreateChatSessionRequest) -> Result<ChatSession, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
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
            parent_session_id, branch_message_id, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
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
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(200).clamp(1, 1000);
    let offset = offset.unwrap_or(0).max(0);
    let sql = if project_id.is_empty() {
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                parent_session_id, branch_message_id, created_at, updated_at
         FROM chat_sessions
         WHERE workspace_id = ?1 AND is_deleted = 0
         ORDER BY is_pinned DESC, updated_at DESC
         LIMIT ?2 OFFSET ?3"
    } else {
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                parent_session_id, branch_message_id, created_at, updated_at
         FROM chat_sessions
         WHERE workspace_id = ?1 AND project_id = ?2 AND is_deleted = 0
         ORDER BY is_pinned DESC, updated_at DESC
         LIMIT ?3 OFFSET ?4"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = if project_id.is_empty() {
        stmt.query_map(rusqlite::params![workspace_id, limit, offset], row_to_session)
    } else {
        stmt.query_map(rusqlite::params![workspace_id, project_id, limit, offset], row_to_session)
    }
    .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_chat_sessions(
    state: State<DbState>,
    req: SearchChatSessionsRequest,
) -> Result<Vec<ChatSession>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let pattern = format!("%{}%", req.query.trim());
    let sql = if req.project_id.as_deref().unwrap_or_default().is_empty() {
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                parent_session_id, branch_message_id, created_at, updated_at
         FROM chat_sessions
         WHERE workspace_id = ?1 AND is_deleted = 0
           AND (title LIKE ?2 OR model_name LIKE ?2)
         ORDER BY is_pinned DESC, updated_at DESC"
    } else {
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                parent_session_id, branch_message_id, created_at, updated_at
         FROM chat_sessions
         WHERE workspace_id = ?1 AND project_id = ?2 AND is_deleted = 0
           AND (title LIKE ?3 OR model_name LIKE ?3)
         ORDER BY is_pinned DESC, updated_at DESC"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = if let Some(project_id) = req.project_id.filter(|id| !id.is_empty()) {
        stmt.query_map(rusqlite::params![req.workspace_id, project_id, pattern], row_to_session)
    } else {
        stmt.query_map(rusqlite::params![req.workspace_id, pattern], row_to_session)
    }
    .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_chat_session(state: State<DbState>, id: String) -> Result<Option<ChatSession>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                parent_session_id, branch_message_id, created_at, updated_at
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
pub fn delete_chat_session(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
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
pub fn hard_delete_chat_session(state: State<DbState>, workspace_id: String, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM chat_sessions WHERE id = ?1 AND workspace_id = ?2",
        rusqlite::params![id, workspace_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_deleted_chat_sessions(state: State<DbState>, workspace_id: String) -> Result<Vec<ChatSession>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                parent_session_id, branch_message_id, created_at, updated_at
         FROM chat_sessions
         WHERE workspace_id = ?1 AND is_deleted = 1
         ORDER BY deleted_at DESC, updated_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![workspace_id], row_to_session)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_chat_session(state: State<DbState>, workspace_id: String, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
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
    let conn = state.0.lock().map_err(|e| e.to_string())?;
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
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let target_project_id = target_project_id.unwrap_or_default();
    for session_id in session_ids {
        conn.execute(
            "UPDATE chat_sessions
             SET workspace_id = ?1, project_id = ?2, updated_at = ?3
             WHERE id = ?4",
            rusqlite::params![target_workspace_id, target_project_id, now, session_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn add_message(state: State<DbState>, req: AddMessageRequest) -> Result<Message, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let msg = Message {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: req.session_id.clone(),
        role: req.role,
        content: req.content,
        model_name: req.model_name,
        tokens_used: req.tokens_used,
        duration_ms: req.duration_ms,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let role_str = msg.role.to_string();
    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, model_name, tokens_used, duration_ms, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            msg.id,
            msg.session_id,
            role_str,
            msg.content,
            msg.model_name,
            msg.tokens_used,
            msg.duration_ms,
            msg.created_at
        ],
    )
    .map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();
    let _ = conn.execute(
        "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, req.session_id],
    );
    Ok(msg)
}

#[tauri::command]
pub fn get_messages(state: State<DbState>, session_id: String, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<Message>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(200).clamp(1, 2000);
    let offset = offset.unwrap_or(0).max(0);
    let mut stmt = conn.prepare(
        "SELECT id, session_id, role, content, model_name, tokens_used, duration_ms, created_at
         FROM messages WHERE session_id = ?1 ORDER BY created_at ASC
         LIMIT ?2 OFFSET ?3"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![session_id, limit, offset], |row| {
        let role_str: String = row.get(2)?;
        let role = role_str
            .parse::<MessageRole>()
            .unwrap_or(MessageRole::User);
        Ok(Message {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role,
            content: row.get(3)?,
            model_name: row.get(4)?,
            tokens_used: row.get(5)?,
            duration_ms: row.get(6)?,
            created_at: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_chat_session(
    state: State<DbState>,
    id: String,
    title: Option<String>,
    is_pinned: Option<bool>,
    system_prompt: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE chat_sessions SET
            title = COALESCE(?1, title),
            is_pinned = COALESCE(?2, is_pinned),
            system_prompt = COALESCE(?3, system_prompt),
            updated_at = ?4
         WHERE id = ?5",
        rusqlite::params![
            title,
            is_pinned.map(|value| value as i32),
            system_prompt,
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
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let days = days.unwrap_or(30).max(1);
    let mut stmt = conn.prepare(
        "SELECT substr(m.created_at, 1, 10) AS day, COALESCE(SUM(m.tokens_used), 0) AS total_tokens
         FROM messages m
         JOIN chat_sessions s ON s.id = m.session_id
         WHERE s.workspace_id = ?1
           AND m.tokens_used IS NOT NULL
           AND m.created_at >= datetime('now', '-' || ?2 || ' days')
         GROUP BY substr(m.created_at, 1, 10)
         ORDER BY day ASC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![workspace_id, days], |row| {
        Ok(TokenUsageByDate {
            day: row.get(0)?,
            total_tokens: row.get(1)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
