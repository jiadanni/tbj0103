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
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<ArtifactSummary>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    artifact_service::list_artifacts(&conn, &workspace_id, limit, offset)
}

#[tauri::command]
pub async fn get_artifact_versions(
    state: State<'_, DbState>,
    id: String,
) -> Result<Vec<ArtifactSummary>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare(
        "WITH RECURSIVE chain AS (
            SELECT id, title, artifact_type, language, description, tags, is_pinned, version, updated_at, parent_artifact_id 
            FROM artifacts WHERE id = ?1
            UNION ALL
            SELECT a.id, a.title, a.artifact_type, a.language, a.description, a.tags, a.is_pinned, a.version, a.updated_at, a.parent_artifact_id
            FROM artifacts a JOIN chain c ON a.id = c.parent_artifact_id
        )
        SELECT id, title, artifact_type, language, description, tags, is_pinned, version, updated_at FROM chain ORDER BY version DESC"
    ).map_err(|e| e.to_string())?;

    let iter = stmt.query_map(rusqlite::params![id], |row| {
        let tags_json: String = row.get(5)?;
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        Ok(ArtifactSummary {
            id: row.get(0)?,
            title: row.get(1)?,
            artifact_type: row.get(2)?,
            language: row.get(3)?,
            description: row.get(4)?,
            tags,
            is_pinned: row.get::<_, i32>(6)? != 0,
            version: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;

    iter.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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
pub async fn search_artifacts(
    state: State<'_, DbState>,
    workspace_id: String,
    query: String,
) -> Result<Vec<ArtifactSummary>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    // For Phase 3, we'd generate embedding first then call search_artifacts_semantic.
    // For now, let's just do a keyword search as fallback.
    
    let mut stmt = conn.prepare(
        "SELECT id, title, artifact_type, language, description, tags, is_pinned, version, updated_at
         FROM artifacts 
         WHERE workspace_id = ?1 AND (title LIKE ?2 OR content LIKE ?2 OR description LIKE ?2)
         ORDER BY is_pinned DESC, updated_at DESC"
    ).map_err(|e| e.to_string())?;

    let query_param = format!("%{}%", query);
    let iter = stmt.query_map(rusqlite::params![workspace_id, query_param], |row| {
        let tags_json: String = row.get(5)?;
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        Ok(ArtifactSummary {
            id: row.get(0)?,
            title: row.get(1)?,
            artifact_type: row.get(2)?,
            language: row.get(3)?,
            description: row.get(4)?,
            tags,
            is_pinned: row.get::<_, i32>(6)? != 0,
            version: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;

    iter.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_artifact_version(
    state: State<'_, DbState>,
    parent_id: String,
    content: String,
) -> Result<Artifact, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    // 1. Get parent details
    let parent = artifact_service::get_artifact(&conn, &parent_id)?;
    
    // 2. Create new version
    let req = CreateArtifactRequest {
        workspace_id: parent.workspace_id,
        session_id: parent.session_id,
        message_id: parent.message_id,
        title: parent.title,
        artifact_type: parent.artifact_type,
        language: parent.language,
        content,
        description: format!("Updated version of {}", parent_id),
        tags: Some(serde_json::from_str(&parent.tags).unwrap_or_default()),
        parent_artifact_id: Some(parent_id),
    };

    let mut artifact = artifact_service::create_artifact(&conn, req)?;
    
    // Update version number
    artifact.version = parent.version + 1;
    conn.execute(
        "UPDATE artifacts SET version = ?1 WHERE id = ?2",
        rusqlite::params![artifact.version, artifact.id],
    ).map_err(|e| e.to_string())?;

    Ok(artifact)
}

#[tauri::command]
pub async fn delete_artifact(
    state: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    artifact_service::delete_artifact(&conn, &id)
}
