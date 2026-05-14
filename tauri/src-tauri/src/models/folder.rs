use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub folder_description: String,
    pub custom_instructions: String,
    pub color: String,
    pub icon: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFolderRequest {
    pub workspace_id: String,
    pub name: String,
    pub folder_description: Option<String>,
    pub custom_instructions: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateFolderRequest {
    pub id: String,
    pub workspace_id: Option<String>,
    pub name: Option<String>,
    pub folder_description: Option<String>,
    pub custom_instructions: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
}

impl Folder {
    pub fn new(workspace_id: impl Into<String>, name: impl Into<String>) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.into(),
            name: name.into(),
            folder_description: String::new(),
            custom_instructions: String::new(),
            color: "#007AFF".to_string(),
            icon: "folder".to_string(),
            created_at: now.clone(),
            updated_at: now,
        }
    }
}
