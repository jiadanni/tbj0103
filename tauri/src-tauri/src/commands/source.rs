use crate::db::DbState;
use crate::models::source::{CreateSourceRequest, Source};
use crate::services::ai_content_generator::generate_summary;
use crate::services::workspace_hierarchy::workspace_filter_sql;
use tauri::State;

const MAX_UPLOAD_FILE_SIZE_BYTES: i64 = 50 * 1024 * 1024;

fn row_to_source(row: &rusqlite::Row) -> rusqlite::Result<Source> {
    Ok(Source {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        source_type: row.get(2)?,
        title: row.get(3)?,
        filename: row.get(4)?,
        file_type: row.get(5)?,
        file_size: row.get(6)?,
        url: row.get(7)?,
        content: row.get(8)?,
        summary: row.get(9)?,
        favicon_data: row.get(10)?,
        is_processed: row.get::<_, i32>(11)? != 0,
        folder: row.get(12)?,
        token_count: row.get(13)?,
        chunk_count: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
    })
}

/// Rough token count: split on whitespace, multiply by ~1.3 for sub-word tokens.
fn estimate_tokens(text: &str) -> i64 {
    let words = text.split_whitespace().count();
    ((words as f64) * 1.3).round() as i64
}

#[tauri::command]
pub async fn create_source(state: State<'_, DbState>, req: CreateSourceRequest) -> Result<Source, String> {
    if let Some(size) = req.file_size {
        if size > MAX_UPLOAD_FILE_SIZE_BYTES {
            return Err("File exceeds 50MB limit".to_string());
        }
    }
    if req.source_type != "document" && req.source_type != "web_capture" {
        return Err("source_type must be 'document' or 'web_capture'".to_string());
    }

    let pool = state.0.clone();

    let src = tokio::task::spawn_blocking(move || -> Result<Source, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        let tokens = estimate_tokens(&req.content);

        let summary = req.summary.or_else(|| {
            if !req.content.is_empty() {
                Some(generate_summary(&req.content, 200))
            } else {
                None
            }
        });

        let src = Source {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: req.workspace_id,
            source_type: req.source_type,
            title: req.title,
            filename: req.filename,
            file_type: req.file_type,
            file_size: req.file_size,
            url: req.url,
            content: req.content,
            summary,
            favicon_data: None,
            is_processed: false,
            folder: req.folder,
            token_count: Some(tokens),
            chunk_count: None,
            created_at: now.clone(),
            updated_at: now,
        };
        conn.execute(
            "INSERT INTO sources (id, workspace_id, source_type, title, filename, file_type, file_size, url, content, summary, is_processed, folder, token_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, ?12, ?13, ?14)",
            rusqlite::params![
                src.id, src.workspace_id, src.source_type, src.title, src.filename,
                src.file_type, src.file_size, src.url, src.content, src.summary,
                src.folder, src.token_count, src.created_at, src.updated_at
            ],
        ).map_err(|e| e.to_string())?;
        Ok(src)
    }).await.map_err(|e| e.to_string())??;

    Ok(src)
}

#[tauri::command]
pub fn list_sources(
    state: State<DbState>,
    workspace_id: String,
    source_type: Option<String>,
    include_descendants: Option<bool>,
) -> Result<Vec<Source>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let (cte, ws_cond) = workspace_filter_sql(include_descendants.unwrap_or(false));
    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(ref st) =
        source_type
    {
        (
            format!(
                "{cte}SELECT s.id, s.workspace_id, s.source_type, s.title, s.filename, s.file_type, s.file_size, s.url, s.content, s.summary, s.favicon_data, s.is_processed, s.folder, s.token_count,
                    (SELECT COUNT(*) FROM source_chunks WHERE source_id = s.id), s.created_at, s.updated_at
             FROM sources s WHERE s.workspace_id {ws_cond} AND s.source_type = ?2 ORDER BY s.created_at DESC"
            ),
            vec![Box::new(workspace_id) as Box<dyn rusqlite::types::ToSql>, Box::new(st.clone())],
        )
    } else {
        (
            format!(
                "{cte}SELECT s.id, s.workspace_id, s.source_type, s.title, s.filename, s.file_type, s.file_size, s.url, s.content, s.summary, s.favicon_data, s.is_processed, s.folder, s.token_count,
                    (SELECT COUNT(*) FROM source_chunks WHERE source_id = s.id), s.created_at, s.updated_at
             FROM sources s WHERE s.workspace_id {ws_cond} ORDER BY s.created_at DESC"
            ),
            vec![Box::new(workspace_id) as Box<dyn rusqlite::types::ToSql>],
        )
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let items = stmt
        .query_map(params_refs.as_slice(), row_to_source)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_source(state: State<DbState>, id: String) -> Result<Option<Source>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT s.id, s.workspace_id, s.source_type, s.title, s.filename, s.file_type, s.file_size, s.url, s.content, s.summary, s.favicon_data, s.is_processed,
                s.folder, s.token_count, (SELECT COUNT(*) FROM source_chunks WHERE source_id = s.id), s.created_at, s.updated_at
         FROM sources s WHERE s.id = ?1",
        rusqlite::params![id],
        row_to_source,
    );
    match result {
        Ok(s) => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn update_source(
    state: State<DbState>,
    id: String,
    title: Option<String>,
    summary: Option<String>,
    is_processed: Option<bool>,
    folder: Option<String>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE sources SET
            title = COALESCE(?1, title),
            summary = COALESCE(?2, summary),
            is_processed = COALESCE(?3, is_processed),
            folder = COALESCE(?4, folder),
            updated_at = ?5
         WHERE id = ?6",
        rusqlite::params![
            title,
            summary,
            is_processed.map(|v| v as i32),
            folder,
            now,
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_source(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sources WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Chunk source content and mark as processed.
#[tauri::command]
pub fn process_source(state: State<DbState>, id: String) -> Result<i64, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let content: String = conn
        .query_row(
            "SELECT content FROM sources WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let chunks = chunk_text(&content, 512, 50);
    let chunk_count = chunks.len() as i64;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "DELETE FROM source_chunks WHERE source_id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;

    for (i, chunk) in chunks.iter().enumerate() {
        let chunk_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO source_chunks (id, source_id, content, chunk_index, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![chunk_id, id, chunk, i as i64, now],
        ).map_err(|e| e.to_string())?;
    }

    conn.execute(
        "UPDATE sources SET is_processed = 1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    )
    .map_err(|e| e.to_string())?;

    Ok(chunk_count)
}

fn chunk_text(text: &str, chunk_words: usize, overlap_words: usize) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return vec![];
    }
    let step = chunk_words.saturating_sub(overlap_words).max(1);
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < words.len() {
        let end = (start + chunk_words).min(words.len());
        chunks.push(words[start..end].join(" "));
        if end >= words.len() {
            break;
        }
        start += step;
    }
    chunks
}
