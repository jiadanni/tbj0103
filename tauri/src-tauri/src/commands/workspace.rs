use tauri::State;
use crate::db::DbState;
use crate::models::workspace::{Workspace, CreateWorkspaceRequest, UpdateWorkspaceRequest};

#[tauri::command]
pub fn create_workspace(state: State<DbState>, req: CreateWorkspaceRequest) -> Result<Workspace, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let ws = Workspace::new(req.name, req.description.unwrap_or_default());

    let sig_json = serde_json::to_string(&ws.topic_signature).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO workspaces (id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_archived, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![ws.id, ws.name, ws.description, ws.prompt_instructions, sig_json, ws.signature_updated_at, ws.is_archived as i64, ws.created_at, ws.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(ws)
}

#[tauri::command]
pub fn list_workspaces(state: State<DbState>) -> Result<Vec<Workspace>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_archived, created_at, updated_at
         FROM workspaces
         WHERE is_archived = 0
         ORDER BY name COLLATE NOCASE ASC, created_at ASC, id ASC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map([], |row| {
        let sig_json: String = row.get(4)?;
        let topic_signature = serde_json::from_str(&sig_json).unwrap_or_default();
        let is_archived: i64 = row.get(6)?;
        Ok(Workspace {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            prompt_instructions: row.get(3)?,
            topic_signature,
            signature_updated_at: row.get(5)?,
            is_archived: is_archived != 0,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn list_archived_workspaces(state: State<DbState>) -> Result<Vec<Workspace>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_archived, created_at, updated_at
         FROM workspaces
         WHERE is_archived = 1
         ORDER BY name COLLATE NOCASE ASC, created_at ASC, id ASC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map([], |row| {
        let sig_json: String = row.get(4)?;
        let topic_signature = serde_json::from_str(&sig_json).unwrap_or_default();
        let is_archived: i64 = row.get(6)?;
        Ok(Workspace {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            prompt_instructions: row.get(3)?,
            topic_signature,
            signature_updated_at: row.get(5)?,
            is_archived: is_archived != 0,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_workspace(state: State<DbState>, id: String) -> Result<Option<Workspace>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_archived, created_at, updated_at FROM workspaces WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            let sig_json: String = row.get(4)?;
            let topic_signature = serde_json::from_str(&sig_json).unwrap_or_default();
            let is_archived: i64 = row.get(6)?;
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                prompt_instructions: row.get(3)?,
                topic_signature,
                signature_updated_at: row.get(5)?,
                is_archived: is_archived != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    );
    match result {
        Ok(ws) => Ok(Some(ws)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn archive_workspace(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE workspaces SET is_archived = 1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn unarchive_workspace(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE workspaces SET is_archived = 0, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_workspace(state: State<DbState>, req: UpdateWorkspaceRequest) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    // Always update name and updated_at; conditionally update description and prompt_instructions
    conn.execute(
        "UPDATE workspaces SET name = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![req.name, now, req.id],
    ).map_err(|e| e.to_string())?;
    if let Some(description) = &req.description {
        conn.execute(
            "UPDATE workspaces SET description = ?1 WHERE id = ?2",
            rusqlite::params![description, req.id],
        ).map_err(|e| e.to_string())?;
    }
    if let Some(instructions) = &req.prompt_instructions {
        conn.execute(
            "UPDATE workspaces SET prompt_instructions = ?1 WHERE id = ?2",
            rusqlite::params![instructions, req.id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_workspace(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM workspaces WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
