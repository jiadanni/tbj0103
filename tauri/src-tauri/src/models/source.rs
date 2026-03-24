use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadedDocument {
    pub id: String,
    pub workspace_id: String,
    pub filename: String,
    pub file_type: String,
    pub file_size: i64,
    pub content: String,
    pub summary: Option<String>,
    pub is_processed: bool,
    pub chunk_count: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentChunk {
    pub id: String,
    pub document_id: String,
    pub content: String,
    pub chunk_index: i64,
    pub embedding: Option<Vec<f32>>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebCapture {
    pub id: String,
    pub workspace_id: String,
    pub url: String,
    pub title: String,
    pub content: String,
    pub summary: Option<String>,
    pub favicon_data: Option<String>,
    pub is_processed: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioTranscription {
    pub id: String,
    pub workspace_id: String,
    pub filename: String,
    pub transcript: String,
    pub duration_seconds: Option<f64>,
    pub is_processed: bool,
    pub created_at: String,
}

// ── Unified Source model ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Source {
    pub id: String,
    pub workspace_id: String,
    pub source_type: String,
    pub title: String,
    pub filename: Option<String>,
    pub file_type: Option<String>,
    pub file_size: Option<i64>,
    pub url: Option<String>,
    pub content: String,
    pub summary: Option<String>,
    pub favicon_data: Option<String>,
    pub is_processed: bool,
    pub folder: Option<String>,
    pub token_count: Option<i64>,
    pub chunk_count: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceChunk {
    pub id: String,
    pub source_id: String,
    pub content: String,
    pub chunk_index: i64,
    pub embedding: Option<Vec<f32>>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSourceRequest {
    pub workspace_id: String,
    pub source_type: String,
    pub title: String,
    pub filename: Option<String>,
    pub file_type: Option<String>,
    pub file_size: Option<i64>,
    pub url: Option<String>,
    pub content: String,
    pub summary: Option<String>,
    pub folder: Option<String>,
}

// ── Legacy request types (kept for backward compat) ──────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadDocumentRequest {
    pub workspace_id: String,
    pub filename: String,
    pub file_type: String,
    pub file_size: i64,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessDocumentRequest {
    pub document_id: String,
}
