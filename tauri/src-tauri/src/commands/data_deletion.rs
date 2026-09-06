use tauri::{AppHandle, Emitter, Runtime, State};

use crate::commands::chat_file::ChatsDirState;
use crate::commands::security::{require_auth, require_auth_for_destructive_ops, AuthState};
use crate::db::DbState;
use crate::services::data_deletion_service::{
    self, DataDeletionPreview, DataDeletionRequest, DataDeletionResult,
};

#[tauri::command]
pub async fn preview_data_deletion(
    auth: State<'_, AuthState>,
    state: State<'_, DbState>,
    req: DataDeletionRequest,
) -> Result<DataDeletionPreview, String> {
    require_auth(&auth, &state)?;
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(|e| e.to_string())?;
        data_deletion_service::preview_deletion(&conn, &req)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn execute_data_deletion<R: Runtime>(
    app: AppHandle<R>,
    auth: State<'_, AuthState>,
    state: State<'_, DbState>,
    chats_dir_state: State<'_, ChatsDirState>,
    req: DataDeletionRequest,
) -> Result<DataDeletionResult, String> {
    require_auth_for_destructive_ops(&auth, &state)?;
    let pool = state.0.clone();
    let chats_dir = chats_dir_state.0.clone();
    let has_chats = req.categories.iter().any(|c| c == "chats");
    let has_concepts = req.categories.iter().any(|c| c == "concepts");
    let has_sources = req.categories.iter().any(|c| c == "sources");

    let result = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        data_deletion_service::execute_deletion(&mut conn, &chats_dir, &req)
    })
    .await
    .map_err(|e| e.to_string())??;

    // Reactivity events
    if has_chats {
        let _ = app.emit("chats-changed", ());
    }
    if has_concepts {
        let _ = app.emit("knowledge-state-reset", ());
    }
    if has_sources {
        let _ = app.emit("sources-changed", ());
    }
    let _ = app.emit("workspaces-changed", ());

    Ok(result)
}
