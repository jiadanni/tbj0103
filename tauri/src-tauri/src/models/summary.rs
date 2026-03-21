use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSummary {
    pub id: String,
    pub session_id: String,
    pub workspace_id: String,
    pub summary_type: String,
    pub content: String,
    pub key_topics: String,
    pub message_range_start: i32,
    pub message_range_end: i32,
    pub token_count: i32,
    pub created_at: String,
    pub updated_at: String,
}
