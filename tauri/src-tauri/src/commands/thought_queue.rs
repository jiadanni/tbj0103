use tauri::State;
use crate::db::DbState;
use crate::models::thought_queue::{ThoughtItem, CreateThoughtRequest};

fn row_to_thought(row: &rusqlite::Row) -> rusqlite::Result<ThoughtItem> {
    Ok(ThoughtItem {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        content: row.get(2)?,
        status: row.get(3)?,
        process_at: row.get(4)?,
        model_name: row.get(5)?,
        prompt_prefix: row.get(6)?,
        result: row.get(7)?,
        result_at: row.get(8)?,
        session_id: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

const SELECT_COLS: &str = "id, workspace_id, content, status, process_at, model_name, prompt_prefix, result, result_at, session_id, created_at, updated_at";

#[tauri::command]
pub fn create_thought(state: State<DbState>, req: CreateThoughtRequest) -> Result<ThoughtItem, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let status = if req.process_at.is_some() { "scheduled" } else { "pending" };
    let item = ThoughtItem {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id: req.workspace_id.clone(),
        content: req.content.clone(),
        status: status.to_string(),
        process_at: req.process_at.clone(),
        model_name: req.model_name.unwrap_or_default(),
        prompt_prefix: req.prompt_prefix.unwrap_or_default(),
        result: None,
        result_at: None,
        session_id: req.session_id.clone(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    // If linked to a session, also insert the user's thought content as a user message
    if let Some(ref sid) = item.session_id {
        let msg_id = uuid::Uuid::new_v4().to_string();
        let _ = conn.execute(
            "INSERT INTO messages (id, session_id, role, content, model_name, created_at)
             VALUES (?1, ?2, 'user', ?3, ?4, ?5)",
            rusqlite::params![msg_id, sid, item.content, item.model_name, now],
        );
    }

    conn.execute(
        "INSERT INTO thought_queue (id, workspace_id, content, status, process_at, model_name, prompt_prefix, result, result_at, session_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, ?8, ?9, ?10)",
        rusqlite::params![
            item.id, item.workspace_id, item.content, item.status,
            item.process_at, item.model_name, item.prompt_prefix,
            item.session_id, item.created_at, item.updated_at
        ],
    ).map_err(|e| e.to_string())?;
    Ok(item)
}

#[tauri::command]
pub fn list_thoughts(state: State<DbState>, workspace_id: String) -> Result<Vec<ThoughtItem>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let sql = format!("SELECT {SELECT_COLS} FROM thought_queue WHERE workspace_id = ?1 ORDER BY created_at DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![workspace_id], row_to_thought)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn list_thoughts_by_session(state: State<DbState>, session_id: String) -> Result<Vec<ThoughtItem>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let sql = format!("SELECT {SELECT_COLS} FROM thought_queue WHERE session_id = ?1 ORDER BY created_at ASC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![session_id], row_to_thought)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_due_thoughts(state: State<DbState>, workspace_id: String) -> Result<Vec<ThoughtItem>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let sql = format!(
        "SELECT {SELECT_COLS} FROM thought_queue
         WHERE workspace_id = ?1 AND status = 'scheduled' AND process_at <= ?2
         ORDER BY process_at ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![workspace_id, now], row_to_thought)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn update_thought_status(state: State<DbState>, id: String, status: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE thought_queue SET status = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![status, now, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Update thought result. If linked to a chat session, auto-insert the AI result as an assistant message.
#[tauri::command]
pub fn update_thought_result(state: State<DbState>, id: String, result: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // Check if this thought is linked to a session
    let session_id: Option<String> = conn.query_row(
        "SELECT session_id FROM thought_queue WHERE id = ?1",
        rusqlite::params![id],
        |row| row.get(0),
    ).ok().flatten();

    // If linked to a session, insert the result as an assistant message
    if let Some(ref sid) = session_id {
        let model_name: String = conn.query_row(
            "SELECT model_name FROM thought_queue WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        ).unwrap_or_default();

        let msg_id = uuid::Uuid::new_v4().to_string();
        let _ = conn.execute(
            "INSERT INTO messages (id, session_id, role, content, model_name, created_at)
             VALUES (?1, ?2, 'assistant', ?3, ?4, ?5)",
            rusqlite::params![msg_id, sid, result, model_name, now],
        );
    }

    conn.execute(
        "UPDATE thought_queue SET result = ?1, result_at = ?2, status = 'done', updated_at = ?2 WHERE id = ?3",
        rusqlite::params![result, now, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_thought(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM thought_queue WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
