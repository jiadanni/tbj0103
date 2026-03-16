use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub project_description: String,
    pub custom_instructions: String,
    pub color: String,
    pub icon: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub workspace_id: String,
    pub name: String,
    pub project_description: Option<String>,
    pub custom_instructions: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProjectRequest {
    pub id: String,
    pub name: Option<String>,
    pub project_description: Option<String>,
    pub custom_instructions: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
}

impl Project {
    pub fn new(workspace_id: impl Into<String>, name: impl Into<String>) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.into(),
            name: name.into(),
            project_description: String::new(),
            custom_instructions: String::new(),
            color: "#007AFF".to_string(),
            icon: "folder".to_string(),
            created_at: now.clone(),
            updated_at: now,
        }
    }
}
