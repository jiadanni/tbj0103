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
    pub route: DashboardRoute,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardConceptFocus {
    pub concept_id: String,
    pub name: String,
    pub review_count: i64,
    pub reason: String,
    pub route: DashboardRoute,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardReviewSummary {
    pub due_today: i64,
    pub total_cards: i64,
    pub learned: i64,
    pub avg_ease: f64,
    pub under_reviewed_concepts: i64,
    pub weak_concepts: Vec<DashboardConceptFocus>,
    pub route: DashboardRoute,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardGoalSummary {
    pub id: String,
    pub title: String,
    pub progress: f64,
    pub is_completed: bool,
    pub due_date: Option<String>,
    pub updated_at: String,
    pub route: DashboardRoute,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardSuggestion {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub description: String,
    pub route: DashboardRoute,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardKnowledgeHealth {
    pub stalled_goals: i64,
    pub unprocessed_sources: i64,
    pub isolated_concepts: i64,
    pub active_topic_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardActivity {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub subtitle: String,
    pub timestamp: String,
    pub route: DashboardRoute,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardSummary {
    pub workspace_id: String,
    pub workspace_name: String,
    pub overview: DashboardOverview,
    pub continue_learning: Option<DashboardContinueLearning>,
    pub review: DashboardReviewSummary,
    pub goals: Vec<DashboardGoalSummary>,
    pub progression: Vec<DashboardSuggestion>,
    pub knowledge_health: DashboardKnowledgeHealth,
    pub recent_activity: Vec<DashboardActivity>,
}
