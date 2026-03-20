use tauri::State;
use crate::db::DbState;
use crate::models::workspace::{Workspace, CreateWorkspaceRequest, UpdateWorkspaceRequest};

#[tauri::command]
pub fn create_workspace(state: State<DbState>, req: CreateWorkspaceRequest) -> Result<Workspace, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let ws = Workspace::new(req.name);
    
    let sig_json = serde_json::to_string(&ws.topic_signature).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO workspaces (id, name, topic_signature, signature_updated_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![ws.id, ws.name, sig_json, ws.signature_updated_at, ws.created_at, ws.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(ws)
}

#[tauri::command]
pub fn list_workspaces(state: State<DbState>) -> Result<Vec<Workspace>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, topic_signature, signature_updated_at, created_at, updated_at FROM workspaces ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map([], |row| {
        let sig_json: String = row.get(2)?;
        let topic_signature = serde_json::from_str(&sig_json).unwrap_or_default();
        Ok(Workspace {
            id: row.get(0)?,
            name: row.get(1)?,
            topic_signature,
            signature_updated_at: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
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
        "SELECT id, name, topic_signature, signature_updated_at, created_at, updated_at FROM workspaces WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            let sig_json: String = row.get(2)?;
            let topic_signature = serde_json::from_str(&sig_json).unwrap_or_default();
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                topic_signature,
                signature_updated_at: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
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
pub fn update_workspace(state: State<DbState>, req: UpdateWorkspaceRequest) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE workspaces SET name = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![req.name, now, req.id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_workspace(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM workspaces WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
