use crate::db::DbState;
use crate::models::workspace::TopicSignature;
use crate::services::topic_signature::{
    compute_match_score, find_best_workspace, recompute_workspace_signature_with_ai,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn get_topic_signature(
    state: State<DbState>,
    workspace_id: String,
) -> Result<TopicSignature, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    let sig_json: String = conn
        .query_row(
            "SELECT topic_signature FROM workspaces WHERE id = ?1",
            rusqlite::params![workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

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
pub async fn regenerate_topic_signature(
    app: AppHandle,
    state: State<'_, DbState>,
    workspace_id: String,
    model: Option<String>,
    ollama_url: Option<String>,
) -> Result<TopicSignature, String> {
    // User-initiated: no cancel_rx needed (it IS the high-priority caller)
    let sig = recompute_workspace_signature_with_ai(&state, &workspace_id, model, ollama_url, None).await?;
    let _ = app.emit("workspaces-changed", ());
    Ok(sig)
}

#[tauri::command]
pub fn update_topic_signature(
    app: AppHandle,
    state: State<DbState>,
    workspace_id: String,
    custom_tags: Vec<String>,
    excluded_tags: Vec<String>,
) -> Result<TopicSignature, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    let sig_json: String = conn
        .query_row(
            "SELECT topic_signature FROM workspaces WHERE id = ?1",
            rusqlite::params![workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let mut sig: TopicSignature = serde_json::from_str(&sig_json).unwrap_or_default();
    sig.custom_tags = custom_tags;
    sig.excluded_tags = excluded_tags.clone();
    sig.auto_detected_tags.retain(|t| !excluded_tags.contains(&t.tag));

    let updated_json = serde_json::to_string(&sig).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE workspaces SET topic_signature = ?1 WHERE id = ?2",
        rusqlite::params![updated_json, workspace_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = app.emit("workspaces-changed", ());
    Ok(sig)
}

#[tauri::command]
pub fn check_workspace_match(
    state: State<DbState>,
    workspace_id: String,
    message: String,
) -> Result<WorkspaceMatchResult, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    let sig_json: String = conn
        .query_row(
            "SELECT topic_signature FROM workspaces WHERE id = ?1",
            rusqlite::params![workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let sig = serde_json::from_str::<TopicSignature>(&sig_json).unwrap_or_default();
    if sig.auto_detected_tags.is_empty() {
        return Ok(WorkspaceMatchResult {
            current_score: 1.0,
            is_match: true,
            suggestion: None,
        });
    }

    let score = compute_match_score(&message, &sig);

    let threshold_str: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'migration_suggestion_threshold'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "0.5".to_string());

    let threshold = threshold_str.parse::<f64>().unwrap_or(0.5);

    if score >= threshold {
        Ok(WorkspaceMatchResult {
            current_score: score,
            is_match: true,
            suggestion: None,
        })
    } else {
        match find_best_workspace(&conn, &message, &workspace_id, threshold) {
            Some((id, name, sugg_score)) => Ok(WorkspaceMatchResult {
                current_score: score,
                is_match: false,
                suggestion: Some(WorkspaceSuggestion {
                    workspace_id: id,
                    workspace_name: name,
                    score: sugg_score,
                }),
            }),
            None => Ok(WorkspaceMatchResult {
                current_score: score,
                is_match: true,
                suggestion: None,
            }),
        }
    }
}
