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
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

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
        model_name: req.model_name.unwrap_or_else(|| "qwen2.5:7b".to_string()),
        prompt_prefix: req.prompt_prefix.unwrap_or_default(),
        result: None,
        result_at: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    conn.execute(
        "INSERT INTO thought_queue (id, workspace_id, content, status, process_at, model_name, prompt_prefix, result, result_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, ?8, ?9)",
        rusqlite::params![
            item.id, item.workspace_id, item.content, item.status,
            item.process_at, item.model_name, item.prompt_prefix,
            item.created_at, item.updated_at
        ],
    ).map_err(|e| e.to_string())?;
    Ok(item)
}

#[tauri::command]
pub fn list_thoughts(state: State<DbState>, workspace_id: String) -> Result<Vec<ThoughtItem>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, content, status, process_at, model_name, prompt_prefix, result, result_at, created_at, updated_at
         FROM thought_queue WHERE workspace_id = ?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![workspace_id], |row| row_to_thought(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_due_thoughts(state: State<DbState>, workspace_id: String) -> Result<Vec<ThoughtItem>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, content, status, process_at, model_name, prompt_prefix, result, result_at, created_at, updated_at
         FROM thought_queue
         WHERE workspace_id = ?1 AND status = 'scheduled' AND process_at <= ?2
         ORDER BY process_at ASC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![workspace_id, now], |row| row_to_thought(row))
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

#[tauri::command]
pub fn update_thought_result(state: State<DbState>, id: String, result: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
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
