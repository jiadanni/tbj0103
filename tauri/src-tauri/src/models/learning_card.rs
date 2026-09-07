use serde::{Deserialize, Serialize};

/// SM-2 spaced repetition card (ported from LearningCard @Model)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningCard {
    pub id: String,
    pub workspace_id: String,
    pub front: String,
    pub back: String,
    pub source_type: String,
    pub source_id: Option<String>,
    pub topic_id: Option<String>,
    // SM-2 fields
    pub ease_factor: f64,
    pub interval: i64,
    pub repetitions: i64,
    pub next_review_date: String,
    pub last_reviewed_at: Option<String>,
    pub created_at: String,
    /// Model that generated this card (None for manual cards and cards
    /// created before provenance tracking).
    #[serde(default)]
    pub generated_by_model: Option<String>,
    /// Card kind: "flashcard" (question/answer) or "info" (long-form
    /// explanation). Drives the feed's Study/Test split.
    #[serde(default)]
    pub kind: String,
    /// 1-5 difficulty, or None when the card is unlevelled. Unlevelled cards
    /// are never filtered out by a level selection.
    #[serde(default)]
    pub difficulty: Option<i64>,
    /// Domain preset naming this card's levels; falls back to the workspace's.
    #[serde(default)]
    pub difficulty_preset: Option<String>,
    /// Overrides the preset's label for this card's level when set.
    #[serde(default)]
    pub difficulty_label: Option<String>,
    /// When set, the card is quarantined out of the feed but not deleted.
    #[serde(default)]
    pub suspended_at: Option<String>,
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
    pub workspace_id: String,
    pub front: String,
    pub back: String,
    pub source_type: Option<String>,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateCardsRequest {
    pub workspace_id: String,
    pub topic: String,
    pub count: Option<u32>,
    pub model: String,
    pub ollama_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateFromConceptRequest {
    pub workspace_id: String,
    pub concept_id: String,
    pub count: Option<u32>,
    pub model: String,
    pub ollama_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlashcardTopic {
    pub id: String,
    pub workspace_id: String,
    pub topic: String,
    pub source: String,
    pub mastery_score: f64,
    pub last_generated_at: Option<String>,
    pub card_count: i64,
    pub parent_topic_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateForTopicRequest {
    pub workspace_id: String,
    pub topic_id: String,
    pub count: Option<u32>,
    pub model: String,
    pub ollama_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractFlashcardsRequest {
    pub workspace_id: String,
    pub content: String,
    pub source_type: String,
    pub source_id: Option<String>,
    pub model: String,
    pub ollama_url: Option<String>,
}

impl LearningCard {
    pub fn new(
        workspace_id: impl Into<String>,
        front: impl Into<String>,
        back: impl Into<String>,
    ) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.into(),
            front: front.into(),
            back: back.into(),
            source_type: "manual".to_string(),
            source_id: None,
            topic_id: None,
            ease_factor: 2.5,
            interval: 1,
            repetitions: 0,
            next_review_date: today,
            last_reviewed_at: None,
            created_at: now,
            generated_by_model: None,
            kind: "flashcard".to_string(),
            difficulty: None,
            difficulty_preset: None,
            difficulty_label: None,
            suspended_at: None,
        }
    }
}
