use tauri::State;
use crate::db::DbState;
use crate::models::chat::{ChatSession, Message, Citation, CreateChatSessionRequest, AddMessageRequest};

#[tauri::command]
pub fn create_chat_session(state: State<DbState>, req: CreateChatSessionRequest) -> Result<ChatSession, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut s = ChatSession::new(req.project_id.clone());
    if let Some(t) = req.title { s.title = t; }
    if let Some(m) = req.model_name { s.model_name = m; }
    if let Some(sp) = req.system_prompt { s.system_prompt = sp; }
    s.parent_session_id = req.parent_session_id;
    s.branch_message_id = req.branch_message_id;
    conn.execute(
        "INSERT INTO chat_sessions (id, project_id, title, model_name, system_prompt, is_pinned, parent_session_id, branch_message_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![s.id, s.project_id, s.title, s.model_name, s.system_prompt, s.is_pinned as i32,
                          s.parent_session_id, s.branch_message_id, s.created_at, s.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(s)
}

#[tauri::command]
pub fn list_chat_sessions(state: State<DbState>, project_id: String) -> Result<Vec<ChatSession>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, title, model_name, system_prompt, is_pinned, parent_session_id, branch_message_id, created_at, updated_at
         FROM chat_sessions WHERE project_id = ?1 ORDER BY is_pinned DESC, updated_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![project_id], |row| {
        Ok(ChatSession {
            id: row.get(0)?,
            project_id: row.get(1)?,
            title: row.get(2)?,
            model_name: row.get(3)?,
            system_prompt: row.get(4)?,
            is_pinned: row.get::<_, i32>(5)? != 0,
            parent_session_id: row.get(6)?,
            branch_message_id: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_chat_session(state: State<DbState>, id: String) -> Result<Option<ChatSession>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, project_id, title, model_name, system_prompt, is_pinned, parent_session_id, branch_message_id, created_at, updated_at
         FROM chat_sessions WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(ChatSession {
            id: row.get(0)?,
            project_id: row.get(1)?,
            title: row.get(2)?,
            model_name: row.get(3)?,
            system_prompt: row.get(4)?,
            is_pinned: row.get::<_, i32>(5)? != 0,
            parent_session_id: row.get(6)?,
            branch_message_id: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        }),
    );
    match result {
        Ok(s) => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_chat_session(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM chat_sessions WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
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
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let role_str = msg.role.to_string();
    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, model_name, tokens_used, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![msg.id, msg.session_id, role_str, msg.content, msg.model_name, msg.tokens_used, msg.created_at],
    ).map_err(|e| e.to_string())?;
    // Update session's updated_at
    let now = chrono::Utc::now().to_rfc3339();
    let _ = conn.execute(
        "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, req.session_id],
    );
    Ok(msg)
}

#[tauri::command]
pub fn get_messages(state: State<DbState>, session_id: String) -> Result<Vec<Message>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, session_id, role, content, model_name, tokens_used, created_at
         FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![session_id], |row| {
        let role_str: String = row.get(2)?;
        let role = role_str.parse::<crate::models::chat::MessageRole>()
            .unwrap_or(crate::models::chat::MessageRole::User);
        Ok(Message {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role,
            content: row.get(3)?,
            model_name: row.get(4)?,
            tokens_used: row.get(5)?,
            created_at: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}
