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
    pub manual_tags: Vec<String>,
    pub ignored_tags: Vec<String>,
    pub intent_patterns: Vec<String>,
    pub generated_at: Option<String>,
    pub message_count_at_gen: Option<u64>,
    pub ollama_enriched: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub description: String,
    pub prompt_instructions: String,
    pub topic_signature: TopicSignature,
    pub signature_updated_at: Option<String>,
    pub is_hidden: bool,
    pub created_at: String,
    pub updated_at: String,
    pub parent_workspace_id: Option<String>,
    pub icon: String,
    pub order_index: i32,
    pub last_message_at: Option<String>,
    pub survey_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkspaceRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateChildWorkspaceRequest {
    pub parent_id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateWorkspaceRequest {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub prompt_instructions: Option<String>,
    pub survey_data: Option<String>,
}

impl Workspace {
    pub fn new(name: impl Into<String>, description: impl Into<String>) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            description: description.into(),
            prompt_instructions: String::new(),
            topic_signature: TopicSignature::default(),
            signature_updated_at: None,
            is_hidden: false,
            created_at: now.clone(),
            updated_at: now,
            parent_workspace_id: None,
            icon: String::new(),
            order_index: 0,
            last_message_at: None,
            survey_data: None,
        }
    }
}
