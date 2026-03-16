use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteTemplate {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub template_description: String,
    pub content: String,
    pub icon: String,
    pub is_built_in: bool,
    pub variables: Vec<TemplateVariable>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateVariable {
    pub name: String,
    pub placeholder: String,
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyNote {
    pub id: String,
    pub workspace_id: String,
    pub date: String,
    pub content: String,
    pub mood: Option<i64>,
    pub productivity: Option<i64>,
    pub template_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningPath {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub path_description: String,
    pub milestones: Vec<PathMilestone>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathMilestone {
    pub id: String,
    pub path_id: String,
    pub title: String,
    pub milestone_description: String,
    pub is_completed: bool,
    pub order_index: i64,
    pub completed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectNote {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub content: String,
    pub note_type: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNoteRequest {
    pub project_id: String,
    pub title: String,
    pub content: Option<String>,
    pub note_type: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateNoteRequest {
    pub id: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetOrCreateDailyNoteRequest {
    pub workspace_id: String,
    pub date: Option<String>,
    pub template_id: Option<String>,
}

impl DailyNote {
    pub fn new(workspace_id: impl Into<String>, date: impl Into<String>) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.into(),
            date: date.into(),
            content: String::new(),
            mood: None,
            productivity: None,
            template_id: None,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}
