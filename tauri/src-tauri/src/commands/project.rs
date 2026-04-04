use tauri::State;
use crate::db::DbState;
use crate::models::project::{Project, CreateProjectRequest, UpdateProjectRequest};
use serde::Serialize;

#[tauri::command]
pub fn create_project(state: State<DbState>, req: CreateProjectRequest) -> Result<Project, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
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
    let conn = state.0.get().map_err(|e| e.to_string())?;
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
    let conn = state.0.get().map_err(|e| e.to_string())?;
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
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE projects SET
            name = COALESCE(?1, name),
            project_description = COALESCE(?2, project_description),
            custom_instructions = COALESCE(?3, custom_instructions),
            color = COALESCE(?4, color),
            icon = COALESCE(?5, icon),
            updated_at = ?6
         WHERE id = ?7",
        rusqlite::params![req.name, req.project_description, req.custom_instructions, req.color, req.icon, now, req.id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_project(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn move_project_to_workspace(
    state: State<DbState>,
    project_id: String,
    target_workspace_id: String,
) -> Result<Project, String> {
    let mut conn = state.0.get().map_err(|e| e.to_string())?;

    // Get the source project
    let source_project: Project = conn.query_row(
        "SELECT id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at
         FROM projects WHERE id = ?1",
        rusqlite::params![project_id],
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
        })
    ).map_err(|e| e.to_string())?;

    if source_project.workspace_id == target_workspace_id {
        return Ok(source_project);
    }

    let now = chrono::Utc::now().to_rfc3339();

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let new_project = Project::new(target_workspace_id.clone(), source_project.name.clone());

    tx.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            new_project.id,
            new_project.workspace_id,
            new_project.name,
            source_project.project_description,
            source_project.custom_instructions,
            source_project.color,
            source_project.icon,
            new_project.created_at,
            new_project.updated_at
        ],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE chat_sessions
         SET workspace_id = ?1, project_id = ?2, updated_at = ?3
         WHERE project_id = ?4",
        rusqlite::params![
            target_workspace_id,
            new_project.id,
            now,
            project_id
        ],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM projects WHERE id = ?1",
        rusqlite::params![project_id],
    ).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    // Return the newly created project
    Ok(Project {
        id: new_project.id,
        workspace_id: new_project.workspace_id,
        name: new_project.name,
        project_description: source_project.project_description,
        custom_instructions: source_project.custom_instructions,
        color: source_project.color,
        icon: source_project.icon,
        created_at: new_project.created_at,
        updated_at: new_project.updated_at,
    })
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
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let chat_session_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chat_sessions WHERE project_id = ?1",
        rusqlite::params![id], |r| r.get(0)
    ).unwrap_or(0);
    Ok(ProjectStats {
        note_count: 0,
        document_count: 0,
        chat_session_count,
        flashcard_count: 0,
        web_capture_count: 0,
    })
}
