use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artifact {
    pub id: String,
    pub workspace_id: String,
    pub session_id: Option<String>,
    pub message_id: Option<String>,
    pub title: String,
    pub artifact_type: String,
    pub language: String,
    pub content: String,
    pub description: String,
    pub tags: String,
    pub is_pinned: bool,
    pub version: i32,
    pub parent_artifact_id: Option<String>,
    pub token_count: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateArtifactRequest {
    pub workspace_id: String,
    pub session_id: Option<String>,
    pub message_id: Option<String>,
    pub title: String,
    pub artifact_type: String,
    pub language: String,
    pub content: String,
    pub description: String,
    pub tags: Option<Vec<String>>,
    pub parent_artifact_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactSummary {
    pub id: String,
    pub title: String,
    pub artifact_type: String,
    pub language: String,
    pub description: String,
    pub tags: Vec<String>,
    pub is_pinned: bool,
    pub version: i32,
    pub updated_at: String,
}
