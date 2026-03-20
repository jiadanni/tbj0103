use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicTag {
    pub tag: String,
    pub weight: u32,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TopicSignature {
    pub domain_tags: Vec<TopicTag>,
    pub intent_patterns: Vec<String>,
    pub generated_at: Option<String>,
    pub message_count_at_gen: Option<u64>,
    pub ollama_enriched: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub topic_signature: TopicSignature,
    pub signature_updated_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkspaceRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateWorkspaceRequest {
    pub id: String,
    pub name: String,
}

impl Workspace {
    pub fn new(name: impl Into<String>) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            topic_signature: TopicSignature::default(),
            signature_updated_at: None,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}
