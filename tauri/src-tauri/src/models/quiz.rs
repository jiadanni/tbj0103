use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quiz {
    pub id: String,
    pub workspace_id: String,
    pub kind: String,
    pub title: String,
    pub topic_ids: Vec<String>,
    pub topic_labels: Vec<String>,
    pub status: String,
    pub score: Option<f64>,
    pub question_count: i64,
    pub chat_session_id: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizQuestion {
    pub id: String,
    pub quiz_id: String,
    pub position: i64,
    pub prompt: String,
    pub expected_answer: String,
    pub rubric: String,
    pub topic: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizAnswer {
    pub id: String,
    pub quiz_id: String,
    pub question_id: String,
    pub user_answer: String,
    pub score: Option<f64>,
    pub feedback: String,
    pub graded_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizDetail {
    pub quiz: Quiz,
    pub questions: Vec<QuizQuestion>,
    pub answers: Vec<QuizAnswer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizSummary {
    pub quiz: Quiz,
    pub answered_count: i64,
    pub average_score: Option<f64>,
}
