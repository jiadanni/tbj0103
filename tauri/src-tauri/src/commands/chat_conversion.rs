//! Tauri commands that convert a chat session into a note or a document.
//!
//! Flow (shared by both commands):
//!   1. Load the chat bundle from SQLite (sync, short-lived pool connection).
//!   2. Pick the configured chat model (sync).
//!   3. Drop the connection and call Ollama (async).
//!   4. Re-acquire a pool connection, persist the note/document,
//!      then call `linking_engine::index_note_links` so the extracted
//!      concepts land in `concept_nodes` / `concept_mentions`.

use crate::db::DbState;
use crate::models::note::ProjectNote;
use crate::models::source::Source;
use crate::ollama::client::OllamaClient;
use crate::services::chat_conversion::{build_converted_chat, load_chat_bundle};
use crate::services::linking_engine;
use crate::services::model_settings::get_configured_chat_model;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvertChatRequest {
    pub session_id: String,
    pub ollama_url: Option<String>,
}

/// Convert a chat session into a new `project_notes` row.
/// Returns the created note. Extracted concepts are wiki-linked in the
/// note body and mirrored into `concept_nodes` / `concept_mentions`.
#[tauri::command]
pub async fn convert_chat_to_note(
    state: State<'_, DbState>,
    req: ConvertChatRequest,
) -> Result<ProjectNote, String> {
    // Step 1 — load chat + resolve model (sync, short-lived connection).
    let (bundle, model) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let bundle = load_chat_bundle(&conn, &req.session_id)?;
        let model = get_configured_chat_model(&conn)
            .ok_or_else(|| "No chat model configured. Set one in Settings → AI Models.".to_string())?;
        (bundle, model)
    };

    // Step 2 — call Ollama (async, no DB connection held).
    let client = OllamaClient::new(req.ollama_url)?;
    let converted = build_converted_chat(&client, &model, &bundle).await?;

    // Step 3 — persist + index (sync, re-acquire connection).
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let note = ProjectNote {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id: bundle.workspace_id.clone(),
        title: converted.title.clone(),
        content: converted.content.clone(),
        note_type: "ai_generated".to_string(),
        tags: vec!["from-chat".to_string()],
        created_at: now.clone(),
        updated_at: now,
    };
    let tags_json = serde_json::to_string(&note.tags).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT INTO project_notes (id, workspace_id, title, content, note_type, tags, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            note.id,
            note.workspace_id,
            note.title,
            note.content,
            note.note_type,
            tags_json,
            note.created_at,
            note.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Index [[wiki-links]] (concepts) into the knowledge graph.
    let _ = linking_engine::index_note_links(
        &conn,
        "note",
        &note.id,
        &note.workspace_id,
        &note.content,
    );

    Ok(note)
}

/// Convert a chat session into a new `sources` row (source_type = 'document').
/// The document is chunked into `source_chunks` and marked `is_processed = 1`,
/// making it retrievable by the RAG pipeline. Concepts are indexed into the
/// knowledge graph with `source_type = "document"`.
#[tauri::command]
pub async fn convert_chat_to_document(
    state: State<'_, DbState>,
    req: ConvertChatRequest,
) -> Result<Source, String> {
    // Step 1 — load + model resolution.
    let (bundle, model) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let bundle = load_chat_bundle(&conn, &req.session_id)?;
        let model = get_configured_chat_model(&conn)
            .ok_or_else(|| "No chat model configured. Set one in Settings → AI Models.".to_string())?;
        (bundle, model)
    };

    // Step 2 — Ollama call.
    let client = OllamaClient::new(req.ollama_url)?;
    let converted = build_converted_chat(&client, &model, &bundle).await?;

    // Step 3 — persist into `sources`, chunk into `source_chunks`, index concepts.
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let byte_size = converted.content.len() as i64;
    let word_count = converted.content.split_whitespace().count() as f64;
    let token_count = (word_count * 1.3).round() as i64;

    let src = Source {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id: bundle.workspace_id.clone(),
        source_type: "document".to_string(),
        title: converted.title.clone(),
        filename: Some(format!("{}.md", sanitize_filename(&converted.title))),
        file_type: Some("md".to_string()),
        file_size: Some(byte_size),
        url: None,
        content: converted.content.clone(),
        summary: None,
        favicon_data: None,
        is_processed: true,
        folder: None,
        token_count: Some(token_count),
        chunk_count: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    conn.execute(
        "INSERT INTO sources (id, workspace_id, source_type, title, filename, file_type, file_size, url, content, summary, favicon_data, is_processed, folder, token_count, created_at, updated_at)
         VALUES (?1, ?2, 'document', ?3, ?4, ?5, ?6, NULL, ?7, NULL, NULL, 1, NULL, ?8, ?9, ?10)",
        rusqlite::params![
            src.id,
            src.workspace_id,
            src.title,
            src.filename,
            src.file_type,
            src.file_size,
            src.content,
            src.token_count,
            src.created_at,
            src.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Chunk for RAG retrieval — reuse the existing chunker from commands::document.
    let chunks = crate::commands::document::chunk_text(&src.content, 512, 50);
    for (i, chunk) in chunks.iter().enumerate() {
        let chunk_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO source_chunks (id, source_id, content, chunk_index, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![chunk_id, src.id, chunk, i as i64, now],
        )
        .map_err(|e| e.to_string())?;
    }

    // Index concepts into the knowledge graph.
    let _ = linking_engine::index_note_links(
        &conn,
        "document",
        &src.id,
        &src.workspace_id,
        &src.content,
    );

    // Return with the actual chunk_count populated so the UI can show it.
    Ok(Source {
        chunk_count: Some(chunks.len() as i64),
        ..src
    })
}

/// Strip characters that are problematic in filenames; keep it lightweight.
fn sanitize_filename(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '-' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "converted-chat".to_string()
    } else {
        trimmed
    }
}
