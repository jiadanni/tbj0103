use crate::db::DbState;
use crate::models::source::WebCapture;
use crate::services::ai_content_generator::generate_summary;
use crate::services::workspace_hierarchy::workspace_filter_sql;
use tauri::State;

#[tauri::command]
pub async fn create_web_capture(
    state: State<'_, DbState>,
    workspace_id: String,
    url: String,
    title: String,
    content: String,
    summary: Option<String>,
) -> Result<WebCapture, String> {
    let pool = state.0.clone();

    let capture = tokio::task::spawn_blocking(move || -> Result<WebCapture, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();

        let summary_val = summary.or_else(|| {
            if !content.is_empty() {
                Some(generate_summary(&content, 200))
            } else {
                None
            }
        });

        let capture = WebCapture {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id,
            url,
            title,
            content,
            summary: summary_val,
            favicon_data: None,
            is_processed: false,
            created_at: now.clone(),
        };
        conn.execute(
            "INSERT INTO sources (id, workspace_id, source_type, title, url, content, summary, favicon_data, is_processed, created_at, updated_at)
             VALUES (?1, ?2, 'web_capture', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            rusqlite::params![
                capture.id,
                capture.workspace_id,
                capture.title,
                capture.url,
                capture.content,
                capture.summary,
                capture.favicon_data,
                capture.is_processed as i32,
                capture.created_at
            ],
        ).map_err(|e| e.to_string())?;
        Ok(capture)
    }).await.map_err(|e| e.to_string())??;

    Ok(capture)
}

#[tauri::command]
pub fn list_web_captures(
    state: State<DbState>,
    workspace_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
    include_descendants: Option<bool>,
) -> Result<Vec<WebCapture>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(200).clamp(1, 1000);
    let offset = offset.unwrap_or(0).max(0);
    let (cte, ws_cond) = workspace_filter_sql(include_descendants.unwrap_or(false));
    let sql = format!(
        "{cte}SELECT id, workspace_id, url, title, content, summary, favicon_data, is_processed, created_at
         FROM sources WHERE workspace_id {ws_cond} AND source_type = 'web_capture' ORDER BY created_at DESC LIMIT ?2 OFFSET ?3"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(rusqlite::params![workspace_id, limit, offset], |row| {
            Ok(WebCapture {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                url: row.get(2)?,
                title: row.get(3)?,
                content: row.get(4)?,
                summary: row.get(5)?,
                favicon_data: row.get(6)?,
                is_processed: row.get::<_, i32>(7)? != 0,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_web_capture(state: State<DbState>, id: String) -> Result<Option<WebCapture>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, workspace_id, url, title, content, summary, favicon_data, is_processed, created_at
         FROM sources WHERE id = ?1 AND source_type = 'web_capture'",
        rusqlite::params![id],
        |row| Ok(WebCapture {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
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
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sources WHERE id = ?1", rusqlite::params![id])
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
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sources SET
            title = COALESCE(?1, title),
            summary = COALESCE(?2, summary),
            is_processed = COALESCE(?3, is_processed),
            updated_at = ?4
         WHERE id = ?5",
        rusqlite::params![
            title,
            summary,
            is_processed.map(|v| v as i32),
            chrono::Utc::now().to_rfc3339(),
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
