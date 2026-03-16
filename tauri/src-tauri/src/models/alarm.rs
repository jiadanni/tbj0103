use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarAlarm {
    pub id: String,
    pub workspace_id: Option<String>,
    pub title: String,
    pub fire_date: String,
    pub duration_seconds: f64,
    pub input_prompt: String,
    pub is_dismissed: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAlarmRequest {
    pub workspace_id: Option<String>,
    pub title: String,
    pub fire_date: String,
    pub duration_seconds: Option<f64>,
    pub input_prompt: Option<String>,
}

impl CalendarAlarm {
    pub fn new(title: impl Into<String>, fire_date: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: None,
            title: title.into(),
            fire_date: fire_date.into(),
            duration_seconds: 0.0,
            input_prompt: String::new(),
            is_dismissed: false,
            created_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}
