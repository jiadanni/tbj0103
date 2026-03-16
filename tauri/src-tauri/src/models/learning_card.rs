use serde::{Deserialize, Serialize};

/// SM-2 spaced repetition card (ported from LearningCard @Model)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningCard {
    pub id: String,
    pub project_id: String,
    pub front: String,
    pub back: String,
    pub source_type: String,
    pub source_id: Option<String>,
    // SM-2 fields
    pub ease_factor: f64,
    pub interval: i64,
    pub repetitions: i64,
    pub next_review_date: String,
    pub last_reviewed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewRequest {
    pub card_id: String,
    /// Quality of recall: 0 (blackout) to 5 (perfect)
    pub quality: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewStats {
    pub total_cards: i64,
    pub due_today: i64,
    pub learned: i64,
    pub avg_ease: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCardRequest {
    pub project_id: String,
    pub front: String,
    pub back: String,
    pub source_type: Option<String>,
    pub source_id: Option<String>,
}

impl LearningCard {
    pub fn new(project_id: impl Into<String>, front: impl Into<String>, back: impl Into<String>) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: project_id.into(),
            front: front.into(),
            back: back.into(),
            source_type: "manual".to_string(),
            source_id: None,
            ease_factor: 2.5,
            interval: 1,
            repetitions: 0,
            next_review_date: today,
            last_reviewed_at: None,
            created_at: now,
        }
    }
}
