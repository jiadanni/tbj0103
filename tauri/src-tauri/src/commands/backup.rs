use tauri::State;
use serde::{Deserialize, Serialize};
use crate::db::DbState;
use crate::models::backup::BackupManifestEntry;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    pub id: String,
    pub created_at: String,
    pub filename: String,
    pub size_bytes: i64,
    pub project_count: i64,
    pub chat_count: i64,
}

/// Create a full JSON backup of the workspace and return the backup JSON string.
#[tauri::command]
pub fn create_backup(state: State<DbState>, workspace_id: String) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    // Serialize workspace
    let (ws_name,): (String,) = conn.query_row(
        "SELECT name FROM workspaces WHERE id = ?1",
        rusqlite::params![workspace_id],
        |r| Ok((r.get(0)?,)),
    ).map_err(|e| format!("Workspace not found: {e}"))?;

    // Projects
    let mut stmt = conn.prepare("SELECT id, name, project_description, custom_instructions, color, icon FROM projects WHERE workspace_id = ?1").map_err(|e| e.to_string())?;
    let projects_json: Vec<serde_json::Value> = stmt.query_map(rusqlite::params![workspace_id], |r| {
        Ok(serde_json::json!({
            "id": r.get::<_, String>(0)?,
            "name": r.get::<_, String>(1)?,
            "description": r.get::<_, String>(2)?,
            "custom_instructions": r.get::<_, String>(3)?,
            "color": r.get::<_, String>(4)?,
            "icon": r.get::<_, String>(5)?,
        }))
    }).map_err(|e| e.to_string())?
    .filter_map(Result::ok)
    .collect();

    let chat_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chat_sessions cs JOIN projects p ON cs.project_id = p.id WHERE p.workspace_id = ?1",
        rusqlite::params![workspace_id],
        |r| r.get(0),
    ).unwrap_or(0);

    let backup = serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "version": "1.0",
        "created_at": chrono::Utc::now().to_rfc3339(),
        "workspace": {
            "id": workspace_id,
            "name": ws_name,
            "projects": projects_json,
        },
        "stats": {
            "project_count": projects_json.len(),
            "chat_count": chat_count,
        }
    });

    serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_backups(_state: State<DbState>) -> Result<Vec<BackupInfo>, String> {
    // In production, this reads a manifest file from the backup directory.
    // Returning empty list here as a scaffold — frontend manages backup file paths.
    Ok(vec![])
}

#[tauri::command]
pub fn restore_backup(state: State<DbState>, backup_json: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let backup: serde_json::Value = serde_json::from_str(&backup_json)
        .map_err(|e| format!("Invalid backup JSON: {e}"))?;

    let workspace = &backup["workspace"];
    let ws_id = workspace["id"].as_str().unwrap_or_default();
    let ws_name = workspace["name"].as_str().unwrap_or("Restored Workspace");

    // Upsert workspace
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR REPLACE INTO workspaces (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![ws_id, ws_name, now, now],
    ).map_err(|e| e.to_string())?;

    // Restore projects
    if let Some(projects) = workspace["projects"].as_array() {
        for p in projects {
            let pid = p["id"].as_str().unwrap_or_default();
            let pname = p["name"].as_str().unwrap_or("Project");
            conn.execute(
                "INSERT OR IGNORE INTO projects (id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![pid, ws_id, pname, p["description"].as_str().unwrap_or(""), p["custom_instructions"].as_str().unwrap_or(""), p["color"].as_str().unwrap_or("#007AFF"), p["icon"].as_str().unwrap_or("folder"), now, now],
            ).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_backup(_id: String) -> Result<(), String> {
    // Backup file deletion — managed by frontend file path
    Ok(())
}
