use crate::db::DbState;
use crate::commands::chat_file::{ChatCryptoState, ChatsDirState};
use crate::models::project::{CreateProjectRequest, Project, UpdateProjectRequest};
use crate::services::chat_file_store;
use serde::Serialize;
use tauri::State;

#[tauri::command]
pub fn create_project(state: State<DbState>, req: CreateProjectRequest) -> Result<Project, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut p = Project::new(req.workspace_id.clone(), req.name);
    if let Some(d) = req.project_description {
        p.project_description = d;
    }
    if let Some(c) = req.custom_instructions {
        p.custom_instructions = c;
    }
    if let Some(col) = req.color {
        p.color = col;
    }
    if let Some(icon) = req.icon {
        p.icon = icon;
    }
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
    let items = stmt
        .query_map(rusqlite::params![workspace_id], |row| {
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
        })
        .map_err(|e| e.to_string())?
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
pub fn update_project(
    state: State<DbState>,
    req: UpdateProjectRequest,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let session_ids = if req.name.is_some() {
        let mut stmt = conn
            .prepare("SELECT id FROM chat_sessions WHERE project_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![req.id.clone()], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    } else {
        Vec::new()
    };
    let previous_paths =
        chat_file_store::capture_session_file_variants(&conn, &chats_dir_state.0, &session_ids);
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
        rusqlite::params![
            req.name,
            req.project_description,
            req.custom_instructions,
            req.color,
            req.icon,
            now,
            req.id
        ],
    )
    .map_err(|e| e.to_string())?;

    if !session_ids.is_empty() {
        let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
        chat_file_store::sync_session_files_for_hierarchy_change(
            &conn,
            &chats_dir_state.0,
            &session_ids,
            &previous_paths,
            pass.as_deref(),
        )?;
    }

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
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
) -> Result<Project, String> {
    let mut conn = state.0.get().map_err(|e| e.to_string())?;
    let mut session_id_stmt = conn
        .prepare("SELECT id FROM chat_sessions WHERE project_id = ?1")
        .map_err(|e| e.to_string())?;
    let session_ids = session_id_stmt
        .query_map(rusqlite::params![project_id.clone()], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(session_id_stmt);
    let previous_paths =
        chat_file_store::capture_session_file_variants(&conn, &chats_dir_state.0, &session_ids);

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
        rusqlite::params![target_workspace_id, new_project.id, now, project_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM projects WHERE id = ?1",
        rusqlite::params![project_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    if !session_ids.is_empty() {
        let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
        chat_file_store::sync_session_files_for_hierarchy_change(
            &conn,
            &chats_dir_state.0,
            &session_ids,
            &previous_paths,
            pass.as_deref(),
        )?;
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::chat::create_chat_session;
    use crate::commands::chat_file::{ChatCryptoState, ChatsDirState};
    use crate::commands::workspace::create_workspace;
    use crate::db::DbState;
    use crate::db::initialize_database;
    use crate::models::chat::CreateChatSessionRequest;
    use crate::models::workspace::CreateWorkspaceRequest;
    use crate::services::chat_file_store;
    use tauri::Manager;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    #[test]
    fn update_project_renames_chat_file_directory() {
        let dir = tempfile::tempdir().expect("Failed to create temp dir");
        let db_path = dir.path().join("test.db");
        let chats_dir = dir.path().join("chats");
        let db = initialize_database(&db_path).expect("Failed to initialize test db");

        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        app.manage(DbState(db));
        app.manage(ChatsDirState(chats_dir.clone()));
        app.manage(ChatCryptoState(std::sync::Mutex::new(None)));

        let db_state = app.state::<DbState>();
        let chats_dir_state = app.state::<ChatsDirState>();
        let crypto_state = app.state::<ChatCryptoState>();

        let workspace = create_workspace(
            db_state.clone(),
            CreateWorkspaceRequest {
                name: "Workspace Alpha".to_string(),
                description: None,
            },
        )
        .expect("Failed to create workspace");

        let project = create_project(
            db_state.clone(),
            CreateProjectRequest {
                workspace_id: workspace.id.clone(),
                name: "Folder One".to_string(),
                project_description: None,
                custom_instructions: None,
                color: None,
                icon: None,
            },
        )
        .expect("Failed to create project");

        let session = create_chat_session(
            db_state.clone(),
            CreateChatSessionRequest {
                workspace_id: workspace.id.clone(),
                project_id: project.id.clone(),
                title: Some("Hierarchy check".to_string()),
                model_name: None,
                system_prompt: None,
                is_incognito: None,
                exclude_from_analytics: None,
                parent_session_id: None,
                branch_message_id: None,
            },
        )
        .expect("Failed to create chat session");

        let conn = db_state.0.get().expect("Failed to get DB connection");
        chat_file_store::write_session_file(&conn, &chats_dir, &session.id, None)
            .expect("Failed to write session file");
        drop(conn);

        let old_path = chats_dir
            .join("Workspace Alpha")
            .join("Folder One")
            .join(format!("{}.json", session.id));
        assert!(old_path.exists(), "expected original hierarchy path to exist");

        update_project(
            db_state,
            UpdateProjectRequest {
                id: project.id,
                workspace_id: None,
                name: Some("Folder Renamed".to_string()),
                project_description: None,
                custom_instructions: None,
                color: None,
                icon: None,
            },
            chats_dir_state,
            crypto_state,
        )
        .expect("Failed to update project");

        let new_path = chats_dir
            .join("Workspace Alpha")
            .join("Folder Renamed")
            .join(format!("{}.json", session.id));
        assert!(new_path.exists(), "expected session file at renamed folder path");
        assert!(!old_path.exists(), "expected stale folder path to be removed");
    }
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
    let chat_session_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chat_sessions WHERE project_id = ?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(ProjectStats {
        note_count: 0,
        document_count: 0,
        chat_session_count,
        flashcard_count: 0,
        web_capture_count: 0,
    })
}
