use crate::db::DbState;
use crate::commands::chat_file::{ChatCryptoState, ChatsDirState};
use crate::models::folder::{CreateFolderRequest, Folder, UpdateFolderRequest};
use crate::services::folder_service;
use serde::Serialize;
use tauri::State;

#[tauri::command]
pub fn create_folder(state: State<DbState>, req: CreateFolderRequest) -> Result<Folder, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    folder_service::create(&conn, req)
}

#[tauri::command]
pub fn list_folders(
    state: State<DbState>,
    workspace_id: String,
    include_descendants: Option<bool>,
) -> Result<Vec<Folder>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    folder_service::list(&conn, &workspace_id, include_descendants.unwrap_or(false))
}

#[tauri::command]
pub fn get_folder(state: State<DbState>, id: String) -> Result<Option<Folder>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    folder_service::get(&conn, &id)
}

#[tauri::command]
pub fn update_folder(
    state: State<DbState>,
    req: UpdateFolderRequest,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
    folder_service::update(&conn, req, &chats_dir_state.0, pass.as_deref())
}

#[tauri::command]
pub fn delete_folder(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    folder_service::delete(&conn, &id)
}

#[tauri::command]
pub fn move_folder_to_workspace(
    state: State<DbState>,
    folder_id: String,
    target_workspace_id: String,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
) -> Result<Folder, String> {
    let mut conn = state.0.get().map_err(|e| e.to_string())?;
    let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
    folder_service::move_to_workspace(
        &mut conn,
        &folder_id,
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
    fn update_folder_renames_chat_file_directory() {
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

        let project = create_folder(
            db_state.clone(),
            CreateFolderRequest {
                workspace_id: workspace.id.clone(),
                name: "Folder One".to_string(),
                folder_description: None,
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
                folder_id: project.id.clone(),
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

        update_folder(
            db_state,
            UpdateFolderRequest {
                id: project.id,
                workspace_id: None,
                name: Some("Folder Renamed".to_string()),
                folder_description: None,
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
pub struct FolderStats {
    pub note_count: i64,
    pub document_count: i64,
    pub chat_session_count: i64,
    pub flashcard_count: i64,
    pub web_capture_count: i64,
}

#[tauri::command]
pub fn get_folder_stats(state: State<DbState>, id: String) -> Result<FolderStats, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let chat_session_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chat_sessions WHERE folder_id = ?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(FolderStats {
        note_count: 0,
        document_count: 0,
        chat_session_count,
        flashcard_count: 0,
        web_capture_count: 0,
    })
}
