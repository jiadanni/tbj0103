use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThoughtItem {
    pub id: String,
    pub workspace_id: String,
    pub content: String,
    pub status: String,
    pub process_at: Option<String>,
    pub model_name: String,
    pub prompt_prefix: String,
    pub result: Option<String>,
    pub result_at: Option<String>,
    pub session_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateThoughtRequest {
    pub workspace_id: String,
    pub content: String,
    pub process_at: Option<String>,
    pub model_name: Option<String>,
    pub prompt_prefix: Option<String>,
    pub session_id: Option<String>,
}
