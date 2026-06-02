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
    /// Distinct topic count where any of: latest quiz score < 0.7 (last 30d),
    /// stale + under-reinforced, or backed by an at-risk learning_goal.
    #[serde(default)]
    pub topics_due_for_review: i64,
    /// Highest-priority topic name (priority: grade -> goal -> stale).
    #[serde(default)]
    pub top_due_topic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewTopic {
    pub concept_id: String,
    pub name: String,
    /// One of: "grade", "goal", "stale".
    pub reason_kind: String,
    /// Human-readable detail used by the view.
    pub detail: String,
    /// Lower = higher priority (grade=0, goal=1, stale=2).
    pub priority: i64,
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
    pub goals: Vec<DashboardGoalSummary>,
    pub progression: Vec<DashboardSuggestion>,
    pub knowledge_health: DashboardKnowledgeHealth,
    pub recent_activity: Vec<DashboardActivity>,
}
