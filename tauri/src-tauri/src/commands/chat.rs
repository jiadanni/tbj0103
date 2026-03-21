use tauri::State;
use serde::{Deserialize, Serialize};
use crate::db::DbState;
use crate::models::chat::{ChatSession, Message, CreateChatSessionRequest, AddMessageRequest};
use crate::commands::chat_file::{ChatCryptoState, ChatsDirState};
use crate::services::chat_file_store;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize)]
pub struct TokenUsageByDate {
    pub day: String,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchChatSessionsRequest {
    pub workspace_id: String,
    pub query: String,
    pub project_id: Option<String>,
}

fn map_chat_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatSession> {
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
pub fn create_chat_session(
    state: State<DbState>,
    chats_dir: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    req: CreateChatSessionRequest,
) -> Result<ChatSession, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut s = ChatSession::new(req.workspace_id.clone(), req.project_id.clone());
    if let Some(t) = req.title { s.title = t; }
    if let Some(m) = req.model_name { s.model_name = m; }
    if let Some(sp) = req.system_prompt { s.system_prompt = sp; }
    if let Some(inc) = req.is_incognito { s.is_incognito = inc; }
    if let Some(excluded) = req.exclude_from_analytics { s.exclude_from_analytics = excluded; }
    s.parent_session_id = req.parent_session_id;
    s.branch_message_id = req.branch_message_id;
    conn.execute(
        "INSERT INTO chat_sessions (id, workspace_id, project_id, title, model_name, system_prompt, is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at, parent_session_id, branch_message_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        rusqlite::params![s.id, s.workspace_id, s.project_id, s.title, s.model_name, s.system_prompt, s.is_pinned as i32,
                          s.is_incognito as i32, s.exclude_from_analytics as i32, s.is_deleted as i32, s.deleted_at, s.parent_session_id, s.branch_message_id, s.created_at, s.updated_at],
    ).map_err(|e| e.to_string())?;
    // Sync to file (best-effort)
    let pass = crypto.0.lock().ok().and_then(|g| g.clone());
    let _ = chat_file_store::write_session_file(&conn, &chats_dir.0, &s.id, pass.as_deref());
    Ok(s)
}

#[tauri::command]
pub fn list_chat_sessions(state: State<DbState>, workspace_id: String, project_id: String) -> Result<Vec<ChatSession>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let (sql, params) = if project_id.is_empty() {
        ("SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at, parent_session_id, branch_message_id, created_at, updated_at
          FROM chat_sessions WHERE workspace_id = ?1 AND is_deleted = 0 ORDER BY is_pinned DESC, updated_at DESC", 
         rusqlite::params![workspace_id])
    } else {
        ("SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at, parent_session_id, branch_message_id, created_at, updated_at
          FROM chat_sessions WHERE workspace_id = ?1 AND project_id = ?2 AND is_deleted = 0 ORDER BY is_pinned DESC, updated_at DESC",
         rusqlite::params![workspace_id, project_id])
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let items = stmt.query_map(params, |row| {
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
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn search_chat_sessions(
    state: State<DbState>,
    req: SearchChatSessionsRequest,
) -> Result<Vec<ChatSession>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let query = req.query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let pattern = format!("%{}%", query);
    let project_id = req.project_id.unwrap_or_default();
    let has_project_scope = !project_id.is_empty();
    let mut seen = HashSet::new();
    let mut results = Vec::new();

    let title_sql = if has_project_scope {
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt,
                is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at, parent_session_id,
                branch_message_id, created_at, updated_at
         FROM chat_sessions
         WHERE workspace_id = ?1
           AND project_id = ?2
           AND is_deleted = 0
           AND title LIKE ?3 COLLATE NOCASE
         ORDER BY is_pinned DESC, updated_at DESC
         LIMIT 50"
    } else {
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt,
                is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at, parent_session_id,
                branch_message_id, created_at, updated_at
         FROM chat_sessions
         WHERE workspace_id = ?1
           AND is_deleted = 0
           AND title LIKE ?2 COLLATE NOCASE
         ORDER BY is_pinned DESC, updated_at DESC
         LIMIT 50"
    };

    let mut title_stmt = conn.prepare(title_sql).map_err(|e| e.to_string())?;
    let title_matches = if has_project_scope {
        title_stmt
            .query_map(rusqlite::params![req.workspace_id, project_id, pattern], map_chat_session_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        title_stmt
            .query_map(rusqlite::params![req.workspace_id, pattern], map_chat_session_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    for session in title_matches {
        seen.insert(session.id.clone());
        results.push(session);
    }

    // Message-body search is much more expensive, so only do it for longer queries
    // and cap the number of sessions we collect from that pass.
    if query.chars().count() < 3 || results.len() >= 50 {
        return Ok(results);
    }

    let message_sql = if has_project_scope {
        "SELECT DISTINCT cs.id, cs.workspace_id, cs.project_id, cs.title, cs.model_name, cs.system_prompt,
                cs.is_pinned, cs.is_incognito, cs.exclude_from_analytics, cs.is_deleted, cs.deleted_at, cs.parent_session_id,
                cs.branch_message_id, cs.created_at, cs.updated_at
         FROM messages m
         JOIN chat_sessions cs ON cs.id = m.session_id
         WHERE cs.workspace_id = ?1
           AND cs.project_id = ?2
           AND cs.is_deleted = 0
           AND m.content LIKE ?3 COLLATE NOCASE
         ORDER BY cs.is_pinned DESC, cs.updated_at DESC
         LIMIT 25"
    } else {
        "SELECT DISTINCT cs.id, cs.workspace_id, cs.project_id, cs.title, cs.model_name, cs.system_prompt,
                cs.is_pinned, cs.is_incognito, cs.exclude_from_analytics, cs.is_deleted, cs.deleted_at, cs.parent_session_id,
                cs.branch_message_id, cs.created_at, cs.updated_at
         FROM messages m
         JOIN chat_sessions cs ON cs.id = m.session_id
         WHERE cs.workspace_id = ?1
           AND cs.is_deleted = 0
           AND m.content LIKE ?2 COLLATE NOCASE
         ORDER BY cs.is_pinned DESC, cs.updated_at DESC
         LIMIT 25"
    };

    let mut message_stmt = conn.prepare(message_sql).map_err(|e| e.to_string())?;
    let message_matches = if has_project_scope {
        message_stmt
            .query_map(rusqlite::params![req.workspace_id, project_id, pattern], map_chat_session_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        message_stmt
            .query_map(rusqlite::params![req.workspace_id, pattern], map_chat_session_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    for session in message_matches {
        if seen.insert(session.id.clone()) {
            results.push(session);
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn get_chat_session(state: State<DbState>, workspace_id: String, id: String) -> Result<Option<ChatSession>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at, parent_session_id, branch_message_id, created_at, updated_at
         FROM chat_sessions WHERE id = ?1 AND workspace_id = ?2",
        rusqlite::params![id, workspace_id],
        |row| Ok(ChatSession {
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
        }),
    );
    match result {
        Ok(s) => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_chat_session(
    state: State<DbState>,
    chats_dir: State<ChatsDirState>,
    workspace_id: String,
    id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    // Validate workspace ownership
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM chat_sessions WHERE id = ?1 AND workspace_id = ?2)",
        rusqlite::params![id, workspace_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    
    if !exists {
        return Err("Chat session not found in this workspace".to_string());
    }

    let immediate_delete: bool = conn.query_row(
        "SELECT value FROM settings WHERE key = 'immediate_delete'",
        [],
        |row| row.get::<_, String>(0),
    ).map(|v| v == "true").unwrap_or(false);

    if immediate_delete {
        conn.execute("DELETE FROM chat_sessions WHERE id = ?1", rusqlite::params![id])
            .map_err(|e| e.to_string())?;
        // Remove JSON file
        chat_file_store::delete_session_file(&chats_dir.0, &id);
    } else {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE chat_sessions SET is_deleted = 1, deleted_at = ?1 WHERE id = ?2",
            rusqlite::params![now, id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_deleted_chat_sessions(state: State<DbState>, workspace_id: String) -> Result<Vec<ChatSession>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at, parent_session_id, branch_message_id, created_at, updated_at
         FROM chat_sessions WHERE workspace_id = ?1 AND is_deleted = 1 ORDER BY deleted_at DESC"
    ).map_err(|e| e.to_string())?;

    let items = stmt.query_map(rusqlite::params![workspace_id], |row| {
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
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn restore_chat_session(state: State<DbState>, workspace_id: String, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE chat_sessions SET is_deleted = 0, deleted_at = NULL WHERE id = ?1 AND workspace_id = ?2",
        rusqlite::params![id, workspace_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn hard_delete_chat_session(
    state: State<DbState>,
    chats_dir: State<ChatsDirState>,
    workspace_id: String,
    id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM chat_sessions WHERE id = ?1 AND workspace_id = ?2",
        rusqlite::params![id, workspace_id],
    ).map_err(|e| e.to_string())?;
    // Remove JSON file
    chat_file_store::delete_session_file(&chats_dir.0, &id);
    Ok(())
}

#[tauri::command]
pub fn empty_recycle_bin(
    state: State<DbState>,
    chats_dir: State<ChatsDirState>,
    workspace_id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    // Find all deleted session IDs to remove their files
    let mut stmt = conn.prepare("SELECT id FROM chat_sessions WHERE workspace_id = ?1 AND is_deleted = 1")
        .map_err(|e| e.to_string())?;
    let ids = stmt.query_map(rusqlite::params![workspace_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM chat_sessions WHERE workspace_id = ?1 AND is_deleted = 1",
        rusqlite::params![workspace_id],
    ).map_err(|e| e.to_string())?;

    for id in ids {
        chat_file_store::delete_session_file(&chats_dir.0, &id);
    }
    Ok(())
}

#[tauri::command]
pub fn add_message(
    state: State<DbState>,
    chats_dir: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    req: AddMessageRequest,
) -> Result<Message, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    // Validate workspace ownership of the session
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM chat_sessions WHERE id = ?1 AND workspace_id = ?2)",
        rusqlite::params![req.session_id, req.workspace_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    
    if !exists {
        return Err("Chat session not found in this workspace".to_string());
    }

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
        rusqlite::params![msg.id, msg.session_id, role_str, msg.content, msg.model_name, msg.tokens_used, msg.duration_ms, msg.created_at],
    ).map_err(|e| e.to_string())?;
    // Update session's updated_at
    let now = chrono::Utc::now().to_rfc3339();
    let _ = conn.execute(
        "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, req.session_id],
    );
    // Sync full session to file (best-effort)
    let pass = crypto.0.lock().ok().and_then(|g| g.clone());
    let _ = chat_file_store::write_session_file(&conn, &chats_dir.0, &req.session_id, pass.as_deref());
    Ok(msg)
}

#[tauri::command]
pub fn get_messages(state: State<DbState>, workspace_id: String, session_id: String) -> Result<Vec<Message>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    // Validate workspace ownership of the session
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM chat_sessions WHERE id = ?1 AND workspace_id = ?2)",
        rusqlite::params![session_id, workspace_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    
    if !exists {
        return Err("Chat session not found in this workspace".to_string());
    }

    let mut stmt = conn.prepare(
        "SELECT id, session_id, role, content, model_name, tokens_used, duration_ms, created_at
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
            duration_ms: row.get(6)?,
            created_at: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}

/// Update a chat session's title, is_pinned flag, or system_prompt.
#[tauri::command]
pub fn update_chat_session(
    state: State<DbState>,
    chats_dir: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    workspace_id: String,
    id: String,
    title: Option<String>,
    is_pinned: Option<bool>,
    system_prompt: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    // Validate workspace ownership
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM chat_sessions WHERE id = ?1 AND workspace_id = ?2)",
        rusqlite::params![id, workspace_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    
    if !exists {
        return Err("Chat session not found in this workspace".to_string());
    }

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
            is_pinned.map(|v| v as i32),
            system_prompt,
            now,
            id
        ],
    ).map_err(|e| e.to_string())?;
    // Sync to file (best-effort)
    let pass = crypto.0.lock().ok().and_then(|g| g.clone());
    let _ = chat_file_store::write_session_file(&conn, &chats_dir.0, &id, pass.as_deref());
    Ok(())
}

/// Move one or more chat sessions to a different workspace (and optionally a project).
/// Clears project_id unless a new one is specified.
#[tauri::command]
pub fn move_chat_sessions(
    state: State<DbState>,
    chats_dir: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    session_ids: Vec<String>,
    target_workspace_id: String,
    target_project_id: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let project = target_project_id.unwrap_or_default();
    let mut affected_workspaces = HashSet::from([target_workspace_id.clone()]);

    for sid in &session_ids {
        let source_workspace_id: String = conn.query_row(
            "SELECT workspace_id FROM chat_sessions WHERE id = ?1",
            rusqlite::params![sid],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        affected_workspaces.insert(source_workspace_id);

        conn.execute(
            "UPDATE chat_sessions SET workspace_id = ?1, project_id = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![target_workspace_id, project, now, sid],
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE memories SET workspace_id = ?1, project_id = ?2, updated_at = ?3 WHERE source_session_id = ?4",
            rusqlite::params![target_workspace_id, project, now, sid],
        ).map_err(|e| e.to_string())?;

        // Sync to file (best-effort)
        let pass = crypto.0.lock().ok().and_then(|g| g.clone());
        let _ = chat_file_store::write_session_file(&conn, &chats_dir.0, sid, pass.as_deref());
    }

    for workspace_id in affected_workspaces {
        crate::services::topic_signature::recompute_workspace_signature(&conn, &workspace_id)?;
    }
    Ok(())
}

/// Return daily token usage for a workspace over the last N days (default: 90).
/// Used to drive the AI usage heatmap in ProjectDashboardView.
#[tauri::command]
pub fn get_token_usage_by_date(
    state: State<DbState>,
    workspace_id: String,
    days: Option<i64>,
) -> Result<Vec<TokenUsageByDate>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let days = days.unwrap_or(90);
    let mut stmt = conn.prepare(
        "SELECT substr(m.created_at, 1, 10) AS day,
                SUM(COALESCE(m.tokens_used, 0)) AS total_tokens
         FROM messages m
         JOIN chat_sessions cs ON cs.id = m.session_id
         WHERE cs.workspace_id = ?1
           AND m.created_at >= datetime('now', '-' || ?2 || ' days')
         GROUP BY day
         ORDER BY day ASC"
    ).map_err(|e| e.to_string())?;

    let items = stmt.query_map(rusqlite::params![workspace_id, days], |row| {
        Ok(TokenUsageByDate {
            day: row.get(0)?,
            total_tokens: row.get(1)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(items)
}
