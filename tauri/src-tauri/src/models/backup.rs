use serde::{Deserialize, Serialize};

/// Top-level backup snapshot (mirrors BackupModels.swift)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupSnapshot {
    pub id: String,
    pub created_at: String,
    pub app_version: String,
    pub workspace: WorkspaceBackup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub snapshots: Vec<BackupManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifestEntry {
    pub id: String,
    pub created_at: String,
    pub filename: String,
    pub size_bytes: i64,
    pub folder_count: i64,
    pub chat_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceBackup {
    pub id: String,
    pub name: String,
    pub folders: Vec<ProjectBackup>,
    pub learning_goals: Vec<LearningGoalBackup>,
    pub concept_nodes: Vec<ConceptNodeBackup>,
    pub concept_links: Vec<ConceptLinkBackup>,
    pub daily_notes: Vec<DailyNoteBackup>,
    pub note_templates: Vec<NoteTemplateBackup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectBackup {
    pub id: String,
    pub name: String,
    pub folder_description: String,
    pub custom_instructions: String,
    pub color: String,
    pub icon: String,
    pub chat_sessions: Vec<ChatSessionBackup>,
    pub documents: Vec<DocumentBackup>,
    pub notes: Vec<ProjectNoteBackup>,
    pub learning_cards: Vec<LearningCardBackup>,
    pub learning_paths: Vec<LearningPathBackup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSessionBackup {
    pub id: String,
    pub title: String,
    pub model_name: String,
    pub system_prompt: String,
    pub messages: Vec<MessageBackup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageBackup {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentBackup {
    pub id: String,
    pub filename: String,
    pub file_type: String,
    pub content: String,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectNoteBackup {
    pub id: String,
    pub title: String,
    pub content: String,
    pub note_type: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningCardBackup {
    pub id: String,
    pub front: String,
    pub back: String,
    pub ease_factor: f64,
    pub interval: i64,
    pub next_review_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningPathBackup {
    pub id: String,
    pub title: String,
    pub milestones: Vec<MilestoneBackup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MilestoneBackup {
    pub id: String,
    pub title: String,
    pub is_completed: bool,
    pub order_index: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningGoalBackup {
    pub id: String,
    pub title: String,
    pub progress: f64,
    pub is_completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptNodeBackup {
    pub id: String,
    pub name: String,
    pub concept_type: String,
    pub concept_description: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptLinkBackup {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub link_type: String,
    pub strength: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyNoteBackup {
    pub id: String,
    pub date: String,
    pub content: String,
    pub mood: Option<i64>,
    pub productivity: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteTemplateBackup {
    pub id: String,
    pub name: String,
    pub content: String,
    pub is_built_in: bool,
}

/// Global backup containing all workspaces and app settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalBackupSnapshot {
    pub id: String,
    pub created_at: String,
    pub app_version: String,
    pub workspaces: Vec<WorkspaceBackup>,
    pub settings: serde_json::Value, // App-wide settings
    pub stats: serde_json::Value,    // Overall statistics
}
