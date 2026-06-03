use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardRoute {
    pub path: String,
    pub state: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardOverview {
    pub chat_sessions: i64,
    pub notes: i64,
    pub sources: i64,
    pub concepts: i64,
    pub flashcards: i64,
    pub active_goals: i64,
    pub completed_goals: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardContinueLearning {
    pub session_id: String,
    pub title: String,
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
    pub updated_at: String,
    pub message_count: i64,
    pub last_snippet: Option<String>,
    pub last_role: Option<String>,
    pub route: DashboardRoute,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardReviewSummary {
    pub due_today: i64,
    pub total_cards: i64,
    pub learned: i64,
    pub avg_ease: f64,
    pub route: DashboardRoute,
    /// Distinct topic count where flashcards are due today.
    #[serde(default)]
    pub topics_due_for_review: i64,
    /// Highest-priority topic name (currently: any due topic).
    #[serde(default)]
    pub top_due_topic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewTopic {
    pub concept_id: String,
    pub name: String,
    /// Currently always "stale" since AI-scored "grade" / "goal" reasons were removed.
    pub reason_kind: String,
    /// Human-readable detail used by the view.
    pub detail: String,
    /// Lower = higher priority.
    pub priority: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardLayoutSection {
    pub id: String,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardLayout {
    pub version: i32,
    pub sections: Vec<DashboardLayoutSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardSummary {
    pub workspace_id: String,
    pub workspace_name: String,
    pub overview: DashboardOverview,
    pub continue_learning: Vec<DashboardContinueLearning>,
    pub review: DashboardReviewSummary,
}
