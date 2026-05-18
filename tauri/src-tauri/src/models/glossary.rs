use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceGlossaryTerm {
    pub id: String,
    pub workspace_id: String,
    pub workspace_name: Option<String>,
    pub term: String,
    pub normalized_term: String,
    pub definition: String,
    pub aliases: Vec<String>,
    pub source_kind: String,
    pub source_session_id: Option<String>,
    pub is_user_edited: bool,
    pub created_at: String,
    pub updated_at: String,
    pub is_inherited: bool,
    pub inherited_from_workspace_id: Option<String>,
    pub inherited_from_workspace_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedWorkspaceGlossaryTerm {
    pub term: String,
    pub normalized_term: String,
    pub definition: String,
    pub aliases: Vec<String>,
    pub source_kind: String,
    pub workspace_id: String,
    pub workspace_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsertWorkspaceGlossaryTermRequest {
    pub id: Option<String>,
    pub workspace_id: String,
    pub term: String,
    pub definition: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub source_kind: Option<String>,
    pub source_session_id: Option<String>,
}
