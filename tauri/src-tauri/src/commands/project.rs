use tauri::State;
use crate::db::DbState;
use crate::models::project::{Project, CreateProjectRequest, UpdateProjectRequest};
use serde::Serialize;

#[tauri::command]
pub fn create_project(state: State<DbState>, req: CreateProjectRequest) -> Result<Project, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut p = Project::new(req.workspace_id.clone(), req.name);
    if let Some(d) = req.project_description { p.project_description = d; }
    if let Some(c) = req.custom_instructions { p.custom_instructions = c; }
    if let Some(col) = req.color { p.color = col; }
    if let Some(icon) = req.icon { p.icon = icon; }
    conn.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![p.id, p.workspace_id, p.name, p.project_description, p.custom_instructions, p.color, p.icon, p.created_at, p.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(p)
}

#[tauri::command]
pub fn list_projects(state: State<DbState>, workspace_id: String) -> Result<Vec<Project>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at
         FROM projects WHERE workspace_id = ?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![workspace_id], |row| {
        Ok(Project {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            name: row.get(2)?,
            project_description: row.get(3)?,
            custom_instructions: row.get(4)?,
            color: row.get(5)?,
            icon: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_project(state: State<DbState>, id: String) -> Result<Option<Project>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at
         FROM projects WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(Project {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            name: row.get(2)?,
            project_description: row.get(3)?,
            custom_instructions: row.get(4)?,
            color: row.get(5)?,
            icon: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        }),
    );
    match result {
        Ok(p) => Ok(Some(p)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn update_project(state: State<DbState>, req: UpdateProjectRequest) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE projects SET
            workspace_id = COALESCE(?1, workspace_id),
            name = COALESCE(?2, name),
            project_description = COALESCE(?3, project_description),
            custom_instructions = COALESCE(?4, custom_instructions),
            color = COALESCE(?5, color),
            icon = COALESCE(?6, icon),
            updated_at = ?7
         WHERE id = ?8",
        rusqlite::params![req.workspace_id, req.name, req.project_description, req.custom_instructions, req.color, req.icon, now, req.id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_project(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct ProjectStats {
    pub note_count: i64,
    pub document_count: i64,
    pub chat_session_count: i64,
    pub flashcard_count: i64,
    pub web_capture_count: i64,
}

#[tauri::command]
pub fn get_project_stats(state: State<DbState>, id: String) -> Result<ProjectStats, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // Look up the workspace this project belongs to
    let workspace_id: String = conn.query_row(
        "SELECT workspace_id FROM projects WHERE id = ?1",
        rusqlite::params![id],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    // Notes, documents, flashcards, web captures are workspace-scoped
    let note_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM project_notes WHERE workspace_id = ?1",
        rusqlite::params![workspace_id], |r| r.get(0)
    ).unwrap_or(0);
    let document_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sources WHERE workspace_id = ?1 AND source_type = 'document'",
        rusqlite::params![workspace_id], |r| r.get(0)
    ).unwrap_or_else(|_| conn.query_row(
        "SELECT COUNT(*) FROM uploaded_documents WHERE workspace_id = ?1",
        rusqlite::params![workspace_id], |r| r.get(0)
    ).unwrap_or(0));
    // Chat sessions are still project-scoped (project = optional chat container)
    let chat_session_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chat_sessions WHERE project_id = ?1",
        rusqlite::params![id], |r| r.get(0)
    ).unwrap_or(0);
    let flashcard_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM learning_cards WHERE workspace_id = ?1",
        rusqlite::params![workspace_id], |r| r.get(0)
    ).unwrap_or(0);
    let web_capture_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sources WHERE workspace_id = ?1 AND source_type = 'web_capture'",
        rusqlite::params![workspace_id], |r| r.get(0)
    ).unwrap_or_else(|_| conn.query_row(
        "SELECT COUNT(*) FROM web_captures WHERE workspace_id = ?1",
        rusqlite::params![workspace_id], |r| r.get(0)
    ).unwrap_or(0));
    Ok(ProjectStats {
        note_count,
        document_count,
        chat_session_count,
        flashcard_count,
        web_capture_count,
    })
}
