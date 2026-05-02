use crate::db::DbState;
use crate::commands::chat_file::{ChatCryptoState, ChatsDirState};
use crate::models::project::{CreateProjectRequest, Project, UpdateProjectRequest};
use crate::services::project_service;
use serde::Serialize;
use tauri::State;

#[tauri::command]
pub fn create_project(state: State<DbState>, req: CreateProjectRequest) -> Result<Project, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    project_service::create(&conn, req)
}

#[tauri::command]
pub fn list_projects(state: State<DbState>, workspace_id: String) -> Result<Vec<Project>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    project_service::list(&conn, &workspace_id)
}

#[tauri::command]
pub fn get_project(state: State<DbState>, id: String) -> Result<Option<Project>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    project_service::get(&conn, &id)
}

#[tauri::command]
pub fn update_project(
    state: State<DbState>,
    req: UpdateProjectRequest,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
    project_service::update(&conn, req, &chats_dir_state.0, pass.as_deref())
}

#[tauri::command]
pub fn delete_project(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    project_service::delete(&conn, &id)
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
    let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
    project_service::move_to_workspace(
        &mut conn,
        &project_id,
        &target_workspace_id,
        &chats_dir_state.0,
        pass.as_deref(),
    )
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
            app.handle().clone(),
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
