use tauri::State;
use crate::db::DbState;
use crate::models::source::{UploadedDocument, UploadDocumentRequest, ProcessDocumentRequest};

const MAX_UPLOAD_FILE_SIZE_BYTES: i64 = 50 * 1024 * 1024;

#[tauri::command]
pub fn upload_document(state: State<DbState>, req: UploadDocumentRequest) -> Result<UploadedDocument, String> {
    if req.file_size > MAX_UPLOAD_FILE_SIZE_BYTES {
        return Err("File exceeds 50MB limit".to_string());
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let doc = UploadedDocument {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id: req.workspace_id,
        filename: req.filename,
        file_type: req.file_type,
        file_size: req.file_size,
        content: req.content,
        summary: None,
        is_processed: false,
        chunk_count: None,
        created_at: now.clone(),
        updated_at: now,
    };
    conn.execute(
        "INSERT INTO uploaded_documents (id, workspace_id, filename, file_type, file_size, content, is_processed, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)",
        rusqlite::params![doc.id, doc.workspace_id, doc.filename, doc.file_type, doc.file_size, doc.content, doc.created_at, doc.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(doc)
}

#[tauri::command]
pub fn list_documents(state: State<DbState>, workspace_id: String) -> Result<Vec<UploadedDocument>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT d.id, d.workspace_id, d.filename, d.file_type, d.file_size, d.content, d.summary, d.is_processed,
                (SELECT COUNT(*) FROM document_chunks WHERE document_id = d.id), d.created_at, d.updated_at
         FROM uploaded_documents d WHERE d.workspace_id = ?1 ORDER BY d.created_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![workspace_id], |row| {
        Ok(UploadedDocument {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            filename: row.get(2)?,
            file_type: row.get(3)?,
            file_size: row.get(4)?,
            content: row.get(5)?,
            summary: row.get(6)?,
            is_processed: row.get::<_, i32>(7)? != 0,
            chunk_count: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_document(state: State<DbState>, id: String) -> Result<Option<UploadedDocument>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, workspace_id, filename, file_type, file_size, content, summary, is_processed, NULL, created_at, updated_at
         FROM uploaded_documents WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(UploadedDocument {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            filename: row.get(2)?,
            file_type: row.get(3)?,
            file_size: row.get(4)?,
            content: row.get(5)?,
            summary: row.get(6)?,
            is_processed: row.get::<_, i32>(7)? != 0,
            chunk_count: None,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        }),
    );
    match result {
        Ok(d) => Ok(Some(d)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_document(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM uploaded_documents WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Chunk the document content and mark it as processed.
/// Full embedding generation happens asynchronously via the AI service.
#[tauri::command]
pub fn process_document(state: State<DbState>, req: ProcessDocumentRequest) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let content: String = conn.query_row(
        "SELECT content FROM uploaded_documents WHERE id = ?1",
        rusqlite::params![req.document_id],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    // Chunk by ~512 words with 50-word overlap
    let chunks = chunk_text(&content, 512, 50);
    let chunk_count = chunks.len() as i64;
    let now = chrono::Utc::now().to_rfc3339();

    for (i, chunk) in chunks.iter().enumerate() {
        let chunk_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO document_chunks (id, document_id, content, chunk_index, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![chunk_id, req.document_id, chunk, i as i64, now],
        ).map_err(|e| e.to_string())?;
    }

    conn.execute(
        "UPDATE uploaded_documents SET is_processed = 1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, req.document_id],
    ).map_err(|e| e.to_string())?;

    Ok(chunk_count)
}

/// Split text into overlapping word chunks.
fn chunk_text(text: &str, chunk_words: usize, overlap_words: usize) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() { return vec![]; }
    let step = chunk_words.saturating_sub(overlap_words).max(1);
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < words.len() {
        let end = (start + chunk_words).min(words.len());
        chunks.push(words[start..end].join(" "));
        if end >= words.len() { break; }
        start += step;
    }
    chunks
}
