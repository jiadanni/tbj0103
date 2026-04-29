use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiModel {
    pub id: String,
    pub name: String,
    pub model_id: String,
    pub provider: String,
    pub role_tags: Vec<String>,
    pub priority: i64,
    pub is_paid: bool,
    pub enabled: bool,
    pub is_hidden: bool,
    pub tokens_used_total: i64,
    pub created_at: String,
    /// Per-model `num_ctx` override. `None` means use the global default.
    #[serde(default)]
    pub context_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSpeedStat {
    pub model_name: String,
    pub avg_chat_tokens_per_second: f64,
    pub weighted_tokens_per_second: f64,
    pub chat_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddAiModelRequest {
    pub name: String,
    pub model_id: String,
    pub provider: Option<String>,
    pub role_tags: Option<Vec<String>>,
    pub is_paid: Option<bool>,
    pub priority: Option<i64>,
    pub enabled: Option<bool>,
    pub is_hidden: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAiModelRequest {
    pub id: String,
    pub name: Option<String>,
    pub role_tags: Option<Vec<String>>,
    pub priority: Option<i64>,
    pub is_paid: Option<bool>,
    pub enabled: Option<bool>,
    pub is_hidden: Option<bool>,
    /// Optional per-model `num_ctx`. `Some(None)` clears the override.
    #[serde(default)]
    pub context_size: Option<Option<i64>>,
}
