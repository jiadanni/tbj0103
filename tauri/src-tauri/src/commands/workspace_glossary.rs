use crate::commands::security::{require_auth_for_destructive_ops, AuthState};
use crate::db::DbState;
use crate::models::glossary::{
    ResolvedWorkspaceGlossaryTerm, UpsertWorkspaceGlossaryTermRequest, WorkspaceGlossaryTerm,
};
use crate::services::workspace_glossary;
use tauri::{AppHandle, Emitter, Runtime, State};

#[tauri::command]
pub fn resolve_workspace_glossary_term<R: Runtime>(
    app: AppHandle<R>,
    state: State<DbState>,
    workspace_id: String,
    candidates: Vec<String>,
) -> Result<Option<ResolvedWorkspaceGlossaryTerm>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_glossary::resolve_term(&app, &conn, &workspace_id, &candidates)
}

#[tauri::command]
pub fn list_workspace_glossary_terms(
    state: State<DbState>,
    workspace_id: String,
    include_inherited: Option<bool>,
) -> Result<Vec<WorkspaceGlossaryTerm>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_glossary::list_terms(&conn, &workspace_id, include_inherited.unwrap_or(false))
}

#[tauri::command]
pub fn upsert_workspace_glossary_term<R: Runtime>(
    app: AppHandle<R>,
    state: State<DbState>,
    req: UpsertWorkspaceGlossaryTermRequest,
) -> Result<WorkspaceGlossaryTerm, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let term = workspace_glossary::upsert_term(&conn, req)?;
    let _ = app.emit("workspaces-changed", ());
    Ok(term)
}

#[tauri::command]
pub fn delete_workspace_glossary_term<R: Runtime>(
    app: AppHandle<R>,
    auth: State<AuthState>,
    state: State<DbState>,
    id: String,
) -> Result<(), String> {
    require_auth_for_destructive_ops(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_glossary::delete_term(&conn, &id)?;
    let _ = app.emit("workspaces-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn refresh_workspace_glossary<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
    workspace_id: String,
) -> Result<Vec<WorkspaceGlossaryTerm>, String> {
    let items = workspace_glossary::refresh_workspace_glossary(&state, &workspace_id).await?;
    let _ = app.emit("workspaces-changed", ());
    Ok(items)
}
