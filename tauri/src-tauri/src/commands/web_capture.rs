use tauri::State;
use crate::db::DbState;
use crate::models::source::WebCapture;

#[tauri::command]
pub fn create_web_capture(
    state: State<DbState>,
    project_id: String,
    url: String,
    title: String,
    content: String,
    summary: Option<String>,
) -> Result<WebCapture, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let capture = WebCapture {
        id: uuid::Uuid::new_v4().to_string(),
        project_id,
        url,
        title,
        content,
        summary,
        favicon_data: None,
        is_processed: false,
        created_at: now.clone(),
    };
    conn.execute(
        "INSERT INTO web_captures (id, project_id, url, title, content, summary, favicon_data, is_processed, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            capture.id, capture.project_id, capture.url, capture.title,
            capture.content, capture.summary, capture.favicon_data,
            capture.is_processed as i32, capture.created_at
        ],
    ).map_err(|e| e.to_string())?;
    Ok(capture)
}

#[tauri::command]
pub fn list_web_captures(state: State<DbState>, project_id: String) -> Result<Vec<WebCapture>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, url, title, content, summary, favicon_data, is_processed, created_at
         FROM web_captures WHERE project_id = ?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![project_id], |row| {
        Ok(WebCapture {
            id: row.get(0)?,
            project_id: row.get(1)?,
            url: row.get(2)?,
            title: row.get(3)?,
            content: row.get(4)?,
            summary: row.get(5)?,
            favicon_data: row.get(6)?,
            is_processed: row.get::<_, i32>(7)? != 0,
            created_at: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_web_capture(state: State<DbState>, id: String) -> Result<Option<WebCapture>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, project_id, url, title, content, summary, favicon_data, is_processed, created_at
         FROM web_captures WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(WebCapture {
            id: row.get(0)?,
            project_id: row.get(1)?,
            url: row.get(2)?,
            title: row.get(3)?,
            content: row.get(4)?,
            summary: row.get(5)?,
            favicon_data: row.get(6)?,
            is_processed: row.get::<_, i32>(7)? != 0,
            created_at: row.get(8)?,
        }),
    );
    match result {
        Ok(c) => Ok(Some(c)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_web_capture(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM web_captures WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_web_capture(
    state: State<DbState>,
    id: String,
    title: Option<String>,
    summary: Option<String>,
    is_processed: Option<bool>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE web_captures SET
            title = COALESCE(?1, title),
            summary = COALESCE(?2, summary),
            is_processed = COALESCE(?3, is_processed)
         WHERE id = ?4",
        rusqlite::params![title, summary, is_processed.map(|v| v as i32), id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
