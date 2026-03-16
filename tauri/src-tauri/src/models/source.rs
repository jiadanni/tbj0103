use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadedDocument {
    pub id: String,
    pub project_id: String,
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
    pub project_id: String,
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
    pub project_id: String,
    pub filename: String,
    pub transcript: String,
    pub duration_seconds: Option<f64>,
    pub is_processed: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadDocumentRequest {
    pub project_id: String,
    pub filename: String,
    pub file_type: String,
    pub file_size: i64,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessDocumentRequest {
    pub document_id: String,
}
