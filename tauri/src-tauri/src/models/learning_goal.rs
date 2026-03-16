use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningGoal {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub goal_description: String,
    pub progress: f64,
    pub is_completed: bool,
    pub due_date: Option<String>,
    pub prerequisite_ids: Vec<String>,
    pub related_chat_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLearningGoalRequest {
    pub workspace_id: String,
    pub title: String,
    pub goal_description: Option<String>,
    pub due_date: Option<String>,
    pub prerequisite_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateLearningGoalRequest {
    pub id: String,
    pub title: Option<String>,
    pub goal_description: Option<String>,
    pub progress: Option<f64>,
    pub is_completed: Option<bool>,
    pub due_date: Option<String>,
    pub prerequisite_ids: Option<Vec<String>>,
}

impl LearningGoal {
    pub fn new(workspace_id: impl Into<String>, title: impl Into<String>) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.into(),
            title: title.into(),
            goal_description: String::new(),
            progress: 0.0,
            is_completed: false,
            due_date: None,
            prerequisite_ids: vec![],
            related_chat_ids: vec![],
            created_at: now.clone(),
            updated_at: now,
        }
    }
}
