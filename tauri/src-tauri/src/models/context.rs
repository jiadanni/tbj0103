use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssembleAndSendRequest {
    pub session_id: String,
    pub workspace_id: String,
    pub model_name: String,
    #[serde(default)]
    pub options: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenBudget {
    pub system_prompt: usize,
    pub memories: usize,
    pub artifacts: usize,
    pub summaries: usize,
    pub conversation: usize,
    pub rag_context: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextSources {
    pub memories_used: Vec<String>,
    pub artifacts_used: Vec<String>,
    pub summaries_used: Vec<String>,
    pub documents_used: Vec<String>,
}
