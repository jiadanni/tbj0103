use tauri::State;
use crate::db::DbState;
use crate::models::workspace::TopicSignature;
use crate::services::topic_signature::{collect_workspace_text, generate_heuristic, compute_match_score, find_best_workspace};
use serde::{Deserialize, Serialize};

#[tauri::command]
pub fn get_topic_signature(state: State<DbState>, workspace_id: String) -> Result<TopicSignature, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let sig_json: String = conn.query_row(
        "SELECT topic_signature FROM workspaces WHERE id = ?1",
        rusqlite::params![workspace_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    
    let sig = serde_json::from_str(&sig_json).unwrap_or_default();
    Ok(sig)
}

#[derive(Serialize, Deserialize)]
pub struct WorkspaceSuggestion {
    pub workspace_id: String,
    pub workspace_name: String,
    pub score: f64,
}

#[derive(Serialize, Deserialize)]
pub struct WorkspaceMatchResult {
    pub current_score: f64,
    pub is_match: bool,
    pub suggestion: Option<WorkspaceSuggestion>,
}

#[tauri::command]
pub fn regenerate_topic_signature(
    state: State<DbState>, 
    workspace_id: String,
    _model: Option<String>,
    _ollama_url: Option<String>
) -> Result<TopicSignature, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    // Get existing to preserve manual/ignored
    let existing_json: String = conn.query_row(
        "SELECT topic_signature FROM workspaces WHERE id = ?1",
        rusqlite::params![workspace_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    let existing: TopicSignature = serde_json::from_str(&existing_json).unwrap_or_default();

    let (text, count) = collect_workspace_text(&conn, &workspace_id)?;
    if count == 0 {
        return Ok(existing);
    }
    
    let mut sig = generate_heuristic(&text);
    sig.message_count_at_gen = Some(count);
    
    // Preserve
    sig.manual_tags = existing.manual_tags;
    sig.ignored_tags = existing.ignored_tags;
    
    let sig_json = serde_json::to_string(&sig).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    
    conn.execute(
        "UPDATE workspaces SET topic_signature = ?1, signature_updated_at = ?2 WHERE id = ?3",
        rusqlite::params![sig_json, now, workspace_id],
    ).map_err(|e| e.to_string())?;
    
    Ok(sig)
}

#[tauri::command]
pub fn update_topic_signature(
    state: State<DbState>,
    workspace_id: String,
    manual_tags: Vec<String>,
    ignored_tags: Vec<String>
) -> Result<TopicSignature, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let sig_json: String = conn.query_row(
        "SELECT topic_signature FROM workspaces WHERE id = ?1",
        rusqlite::params![workspace_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    
    let mut sig: TopicSignature = serde_json::from_str(&sig_json).unwrap_or_default();
    sig.manual_tags = manual_tags;
    sig.ignored_tags = ignored_tags;
    
    let updated_json = serde_json::to_string(&sig).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE workspaces SET topic_signature = ?1 WHERE id = ?2",
        rusqlite::params![updated_json, workspace_id],
    ).map_err(|e| e.to_string())?;
    
    Ok(sig)
}

#[tauri::command]
pub fn check_workspace_match(state: State<DbState>, workspace_id: String, message: String) -> Result<WorkspaceMatchResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let sig_json: String = conn.query_row(
        "SELECT topic_signature FROM workspaces WHERE id = ?1",
        rusqlite::params![workspace_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    
    let sig = serde_json::from_str::<TopicSignature>(&sig_json).unwrap_or_default();
    if sig.domain_tags.is_empty() {
        return Ok(WorkspaceMatchResult { current_score: 1.0, is_match: true, suggestion: None });
    }
    
    let score = compute_match_score(&message, &sig);
    
    let threshold_str: String = conn.query_row(
        "SELECT value FROM settings WHERE key = 'migration_suggestion_threshold'",
        [],
        |row| row.get(0),
    ).unwrap_or_else(|_| "0.3".to_string());
    
    let threshold = threshold_str.parse::<f64>().unwrap_or(0.3);
    
    if score >= threshold {
        Ok(WorkspaceMatchResult { current_score: score, is_match: true, suggestion: None })
    } else {
        match find_best_workspace(&conn, &message, &workspace_id, threshold) {
            Some((id, name, sugg_score)) => {
                Ok(WorkspaceMatchResult { 
                    current_score: score, 
                    is_match: false, 
                    suggestion: Some(WorkspaceSuggestion {
                        workspace_id: id,
                        workspace_name: name,
                        score: sugg_score,
                    })
                })
            },
            None => Ok(WorkspaceMatchResult { current_score: score, is_match: true, suggestion: None })
        }
    }
}
