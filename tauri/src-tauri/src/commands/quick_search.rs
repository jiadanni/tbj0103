use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::{
    db::DbState,
    services::quick_search_service::{self, QuickSearchResult},
};

#[derive(Default)]
pub struct QuickSearchRuntimeState {
    pub registered_shortcut: Mutex<Option<String>>,
    pub main_window_ready: Mutex<bool>,
    pub pending_navigation: Mutex<Option<QuickSearchResult>>,
    pub preferred_workspace_id: Mutex<Option<String>>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct QuickSearchRequest {
    pub query: String,
    pub limit: Option<u32>,
    pub workspace_id: Option<String>,
    pub kind_filters: Option<Vec<String>>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct QuickSearchContext {
    pub preferred_workspace_id: Option<String>,
}

#[tauri::command]
pub fn show_quick_search(app: AppHandle) -> Result<(), String> {
    show_window(&app)
}

#[tauri::command]
pub fn hide_quick_search(app: AppHandle) -> Result<(), String> {
    hide_window(&app)
}

#[tauri::command]
pub fn query_quick_search(
    state: State<DbState>,
    req: QuickSearchRequest,
) -> Result<Vec<QuickSearchResult>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = req.limit.unwrap_or(18).clamp(1, 50) as usize;
    let workspace_id = req.workspace_id;

    quick_search_service::query(
        &conn,
        &req.query,
        limit,
        workspace_id.as_deref(),
        req.kind_filters.as_deref(),
    )
}

#[tauri::command]
pub fn get_quick_search_context(
    runtime: State<QuickSearchRuntimeState>,
) -> Result<QuickSearchContext, String> {
    let preferred_workspace_id = runtime
        .preferred_workspace_id
        .lock()
        .map_err(|_| "Quick search workspace context is unavailable.".to_string())?
        .clone();

    Ok(QuickSearchContext { preferred_workspace_id })
}

#[tauri::command]
pub fn open_quick_search_result(app: AppHandle, result: QuickSearchResult) -> Result<(), String> {
    show_main_window(&app)?;
    emit_or_queue_navigation(&app, result)?;
    hide_window(&app)
}

#[tauri::command]
pub fn mark_main_window_ready(
    app: AppHandle,
    runtime: State<QuickSearchRuntimeState>,
) -> Result<(), String> {
    {
        let mut ready = runtime
            .main_window_ready
            .lock()
            .map_err(|_| "Main window readiness state is unavailable.".to_string())?;
        *ready = true;
    }

    let pending = {
        let mut pending = runtime
            .pending_navigation
            .lock()
            .map_err(|_| "Pending quick search navigation is unavailable.".to_string())?;
        pending.take()
    };

    if let Some(target) = pending {
        app.emit("app:navigate-target", target)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn show_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("quick-search")
        .ok_or_else(|| "Quick search window is not available.".to_string())?;

    let _ = window.unminimize();
    let _ = window.center();
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

pub fn hide_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("quick-search")
        .ok_or_else(|| "Quick search window is not available.".to_string())?;
    window.hide().map_err(|e| e.to_string())
}

pub fn toggle_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("quick-search")
        .ok_or_else(|| "Quick search window is not available.".to_string())?;

    if window.is_visible().map_err(|e| e.to_string())? {
        window.hide().map_err(|e| e.to_string())
    } else {
        show_window(app)
    }
}

pub fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is not available.".to_string())?;
    let _ = window.unminimize();
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

pub fn normalize_shortcut(shortcut: &str) -> Option<String> {
    let trimmed = shortcut.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn apply_shortcut(
    app: &AppHandle,
    runtime: &QuickSearchRuntimeState,
    next_shortcut: Option<String>,
) -> Result<(), String> {
    let manager = app.global_shortcut();
    let mut current = runtime
        .registered_shortcut
        .lock()
        .map_err(|_| "Quick search shortcut state is unavailable.".to_string())?;

    if *current == next_shortcut {
        return Ok(());
    }

    let previous = current.clone();
    if let Some(existing) = previous.as_ref() {
        let _ = manager.unregister(existing.as_str());
    }

    if let Some(next) = next_shortcut.as_ref() {
        if let Err(err) = manager.register(next.as_str()) {
            if let Some(previous_shortcut) = previous.as_ref() {
                let _ = manager.register(previous_shortcut.as_str());
            }
            return Err(format!(
                "Failed to register quick search shortcut \"{next}\": {err}"
            ));
        }
    }

    *current = next_shortcut;
    Ok(())
}

fn emit_or_queue_navigation(app: &AppHandle, result: QuickSearchResult) -> Result<(), String> {
    let runtime = app.state::<QuickSearchRuntimeState>();
    let is_ready = *runtime
        .main_window_ready
        .lock()
        .map_err(|_| "Main window readiness state is unavailable.".to_string())?;

    if is_ready {
        app.emit("app:navigate-target", result)
            .map_err(|e| e.to_string())
    } else {
        let mut pending = runtime
            .pending_navigation
            .lock()
            .map_err(|_| "Pending quick search navigation is unavailable.".to_string())?;
        *pending = Some(result);
        Ok(())
    }
}
