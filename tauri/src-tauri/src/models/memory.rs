use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    pub id: String,
    pub workspace_id: Option<String>,
    pub content: String,
    pub memory_type: String,
    pub scope: String,
    pub source_session_id: Option<String>,
    pub is_pinned: bool,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMemoryRequest {
    pub workspace_id: Option<String>,
    pub content: String,
    pub memory_type: Option<String>,
    pub scope: Option<String>,
    pub source_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateMemoryRequest {
    pub id: String,
    pub content: Option<String>,
    pub memory_type: Option<String>,
    pub is_pinned: Option<bool>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractMemoriesRequest {
    pub workspace_id: String,
    pub session_id: String,
    pub messages: Vec<ExtractMessage>,
    pub model: String,
    pub ollama_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySummary {
    pub id: String,
    pub scope: String,
    pub workspace_id: Option<String>,
    pub content: String,
    pub is_auto_generated: bool,
    pub generated_at: String,
    pub edited_at: Option<String>,
}
