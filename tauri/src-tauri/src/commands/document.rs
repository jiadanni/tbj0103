use crate::db::DbState;
use crate::models::source::{ProcessDocumentRequest, UploadDocumentRequest, UploadedDocument};
use crate::services::ai_content_generator::generate_summary;
use crate::services::linking_engine;
use tauri::State;

const MAX_UPLOAD_FILE_SIZE_BYTES: i64 = 50 * 1024 * 1024;

#[tauri::command]
pub async fn upload_document(
    state: State<'_, DbState>,
    req: UploadDocumentRequest,
) -> Result<UploadedDocument, String> {
    if req.file_size > MAX_UPLOAD_FILE_SIZE_BYTES {
        return Err("File exceeds 50MB limit".to_string());
    }

    let pool = state.0.clone();

    let doc = tokio::task::spawn_blocking(move || -> Result<UploadedDocument, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();

        let summary = if !req.content.is_empty() {
            Some(generate_summary(&req.content, 200))
        } else {
            None
        };

        let doc = UploadedDocument {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: req.workspace_id.clone(),
            filename: req.filename.clone(),
            file_type: req.file_type.clone(),
            file_size: req.file_size,
            content: req.content.clone(),
            summary: summary.clone(),
            is_processed: false,
            chunk_count: None,
            created_at: now.clone(),
            updated_at: now,
        };

        conn.execute(
            "INSERT INTO sources (id, workspace_id, source_type, title, filename, file_type, file_size, content, summary, is_processed, created_at, updated_at)
             VALUES (?1, ?2, 'document', ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10)",
            rusqlite::params![
                doc.id,
                doc.workspace_id,
                doc.filename,
                doc.filename,
                doc.file_type,
                doc.file_size,
                doc.content,
                doc.summary,
                doc.created_at,
                doc.updated_at
            ],
        ).map_err(|e| e.to_string())?;

        // Index any [[wiki-links]] present in the uploaded document so documents
        // participate in the knowledge graph (mirrors the pattern in commands::note::create_note).
        if !doc.content.is_empty() {
            let _ = linking_engine::index_note_links(
                &conn,
                "document",
                &doc.id,
                &doc.workspace_id,
                &doc.content,
            );
        }

        Ok(doc)
    }).await.map_err(|e| e.to_string())??;

    Ok(doc)
}

#[tauri::command]
pub fn list_documents(
    state: State<DbState>,
    workspace_id: String,
) -> Result<Vec<UploadedDocument>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT s.id, s.workspace_id, s.filename, s.file_type, s.file_size, s.summary, s.is_processed,
                (SELECT COUNT(*) FROM source_chunks WHERE source_id = s.id), s.created_at, s.updated_at
         FROM sources s WHERE s.workspace_id = ?1 AND s.source_type = 'document' ORDER BY s.created_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(rusqlite::params![workspace_id], |row| {
            Ok(UploadedDocument {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                filename: row.get(2)?,
                file_type: row.get(3)?,
                file_size: row.get(4)?,
                content: "".to_string(), // Omit full content for listing metadata
                summary: row.get(5)?,
                is_processed: row.get::<_, i32>(6)? != 0,
                chunk_count: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_document(state: State<DbState>, id: String) -> Result<Option<UploadedDocument>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT s.id, s.workspace_id, s.filename, s.file_type, s.file_size, s.content, s.summary, s.is_processed,
                (SELECT COUNT(*) FROM source_chunks WHERE source_id = s.id), s.created_at, s.updated_at
         FROM sources s WHERE s.id = ?1 AND s.source_type = 'document'",
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
            chunk_count: row.get(8)?,
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
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sources WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Chunk the document content and mark it as processed.
/// Full embedding generation happens asynchronously via the AI service.
#[tauri::command]
pub fn process_document(state: State<DbState>, req: ProcessDocumentRequest) -> Result<i64, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let content: String = conn
        .query_row(
            "SELECT content FROM sources WHERE id = ?1 AND source_type = 'document'",
            rusqlite::params![req.document_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Chunk by ~512 words with 50-word overlap
    let chunks = chunk_text(&content, 512, 50);
    let chunk_count = chunks.len() as i64;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "DELETE FROM source_chunks WHERE source_id = ?1",
        rusqlite::params![req.document_id],
    )
    .map_err(|e| e.to_string())?;

    for (i, chunk) in chunks.iter().enumerate() {
        let chunk_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO source_chunks (id, source_id, content, chunk_index, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![chunk_id, req.document_id, chunk, i as i64, now],
        ).map_err(|e| e.to_string())?;
    }

    conn.execute(
        "UPDATE sources SET is_processed = 1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, req.document_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(chunk_count)
}

/// Split text into overlapping word chunks.
pub(crate) fn chunk_text(text: &str, chunk_words: usize, overlap_words: usize) -> Vec<String> {
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
