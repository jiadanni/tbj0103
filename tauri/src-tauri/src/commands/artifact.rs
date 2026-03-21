use tauri::State;
use crate::models::artifact::{Artifact, ArtifactSummary, CreateArtifactRequest};
use crate::db::DbState;
use crate::services::artifact_service;

#[tauri::command]
pub async fn create_artifact(
    state: State<'_, DbState>,
    req: CreateArtifactRequest,
) -> Result<Artifact, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    artifact_service::create_artifact(&conn, req)
}

#[tauri::command]
pub async fn get_artifact(
    state: State<'_, DbState>,
    id: String,
) -> Result<Artifact, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    artifact_service::get_artifact(&conn, &id)
}

#[tauri::command]
pub async fn list_artifacts(
    state: State<'_, DbState>,
    workspace_id: String,
) -> Result<Vec<ArtifactSummary>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    artifact_service::list_artifacts(&conn, &workspace_id)
}

#[tauri::command]
pub async fn update_artifact(
    state: State<'_, DbState>,
    id: String,
    updates: serde_json::Value,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    if let Some(is_pinned) = updates.get("is_pinned").and_then(|v| v.as_bool()) {
        artifact_service::update_artifact_pin(&conn, &id, is_pinned)?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn delete_artifact(
    state: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    artifact_service::delete_artifact(&conn, &id)
}
