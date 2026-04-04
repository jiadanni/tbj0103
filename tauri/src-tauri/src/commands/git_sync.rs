use tauri::{AppHandle, Manager, State};
use serde::{Deserialize, Serialize};
use crate::db::DbState;
use crate::services::git_sync;

fn is_ssh_remote(remote_url: &str) -> bool {
    let trimmed = remote_url.trim();
    trimmed.starts_with("git@") || trimmed.starts_with("ssh://")
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitSyncStatus {
    pub enabled: bool,
    pub remote_url: String,
    pub last_synced_at: String,
    pub last_error: String,
}

#[tauri::command]
pub fn get_git_sync_status(state: State<DbState>) -> Result<GitSyncStatus, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let get = |key: &str| -> String {
        conn.query_row("SELECT value FROM settings WHERE key = ?1", rusqlite::params![key], |r| r.get(0))
            .unwrap_or_default()
    };
    Ok(GitSyncStatus {
        enabled: get("git_sync_enabled") == "true",
        remote_url: get("git_sync_remote_url"),
        last_synced_at: get("git_sync_last_synced_at"),
        last_error: get("git_sync_last_error"),
    })
}

#[tauri::command]
pub fn configure_git_sync(
    app: AppHandle,
    state: State<DbState>,
    remote_url: String,
    enabled: bool,
) -> Result<(), String> {
    if enabled && !remote_url.is_empty() && !is_ssh_remote(&remote_url) {
        return Err("Git sync requires an SSH remote URL (for example git@github.com:you/aetherium-sync.git).".to_string());
    }

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let conn = state.0.get().map_err(|e| e.to_string())?;

    let set = |key: &str, val: &str| {
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, val],
        ).map(|_| ()).map_err(|e| e.to_string())
    };

    set("git_sync_enabled", if enabled { "true" } else { "false" })?;
    set("git_sync_remote_url", &remote_url)?;
    set("git_sync_last_error", "")?;

    if enabled && !remote_url.is_empty() {
        git_sync::ensure_repo(&app_dir, &remote_url)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn trigger_git_sync(app: AppHandle, state: State<'_, DbState>) -> Result<GitSyncStatus, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let remote_url = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        conn.query_row("SELECT value FROM settings WHERE key = 'git_sync_remote_url'", [], |r| r.get::<_, String>(0))
            .unwrap_or_default()
    };

    if remote_url.is_empty() {
        return Err("No remote URL configured".to_string());
    }
    if !is_ssh_remote(&remote_url) {
        return Err("Git sync requires an SSH remote URL.".to_string());
    }

    git_sync::ensure_repo(&app_dir, &remote_url)?;
    let result = git_sync::sync(&app_dir);

    let now = chrono::Utc::now().to_rfc3339();
    let error_str = result.error.clone().unwrap_or_default();

    {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let set = |key: &str, val: &str| {
            let _ = conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                rusqlite::params![key, val],
            );
        };
        if !result.conflict && result.error.is_none() {
            set("git_sync_last_synced_at", &now);
        }
        set("git_sync_last_error", &error_str);
    }

    Ok(GitSyncStatus {
        enabled: true,
        remote_url,
        last_synced_at: if result.error.is_none() { now } else { String::new() },
        last_error: error_str,
    })
}
