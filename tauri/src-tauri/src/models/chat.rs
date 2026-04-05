use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    System,
}

impl std::fmt::Display for MessageRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MessageRole::User => write!(f, "user"),
            MessageRole::Assistant => write!(f, "assistant"),
            MessageRole::System => write!(f, "system"),
        }
    }
}

impl std::str::FromStr for MessageRole {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "user" => Ok(MessageRole::User),
            "assistant" => Ok(MessageRole::Assistant),
            "system" => Ok(MessageRole::System),
            _ => Err(format!("Unknown role: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
    pub id: String,
    pub workspace_id: String,
    pub project_id: String,
    pub title: String,
    pub model_name: String,
    pub system_prompt: String,
    pub is_pinned: bool,
    pub is_incognito: bool,
    pub exclude_from_analytics: bool,
    pub is_deleted: bool,
    pub deleted_at: Option<String>,
    pub last_accessed_at: Option<String>,
    pub last_processed_message_count: i64,
    pub is_imported: bool,
    pub parent_session_id: Option<String>,
    pub branch_message_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: MessageRole,
    pub content: String,
    pub model_name: Option<String>,
    pub tokens_used: Option<i64>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub id: String,
    pub message_id: String,
    pub source_id: String,
    pub source_type: String,
    pub excerpt: String,
    pub relevance_score: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateChatSessionRequest {
    pub workspace_id: String,
    pub project_id: String,
    pub title: Option<String>,
    pub model_name: Option<String>,
    pub system_prompt: Option<String>,
    pub is_incognito: Option<bool>,
    pub exclude_from_analytics: Option<bool>,
    pub parent_session_id: Option<String>,
    pub branch_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddMessageRequest {
    pub workspace_id: String,
    pub session_id: String,
    pub role: MessageRole,
    pub content: String,
    pub model_name: Option<String>,
    pub tokens_used: Option<i64>,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddCitationRequest {
    pub message_id: String,
    pub source_id: String,
    pub source_type: String,
    pub excerpt: String,
    pub relevance_score: f64,
}

impl ChatSession {
    pub fn new(workspace_id: impl Into<String>, project_id: impl Into<String>) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.into(),
            project_id: project_id.into(),
            title: "New Chat".to_string(),
            model_name: String::new(),
            system_prompt: String::new(),
            is_pinned: false,
            is_incognito: false,
            exclude_from_analytics: false,
            is_deleted: false,
            deleted_at: None,
            last_accessed_at: Some(now.clone()),
            last_processed_message_count: 0,
            is_imported: false,
            parent_session_id: None,
            branch_message_id: None,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

impl Message {
    pub fn new(
        session_id: impl Into<String>,
        role: MessageRole,
        content: impl Into<String>,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.into(),
            role,
            content: content.into(),
            model_name: None,
            tokens_used: None,
            duration_ms: None,
            created_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}
