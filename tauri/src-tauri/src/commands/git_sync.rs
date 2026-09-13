use crate::commands::security::{require_auth_for_destructive_ops, AuthState};
use crate::db::DbState;
use crate::services::git_sync;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

fn is_ssh_remote(remote_url: &str) -> bool {
    let trimmed = remote_url.trim();
    trimmed.starts_with("git@") || trimmed.starts_with("ssh://")
}

fn read_setting(conn: &rusqlite::Connection, key: &str) -> String {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [key],
        |row| row.get::<_, String>(0),
    ).unwrap_or_default()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitSyncStatus {
    pub enabled: bool,
    pub remote_url: String,
    pub last_synced_at: String,
    pub last_error: String,
    pub device_id: String,
    pub device_label: String,
    pub device_branch: String,
    pub main_branch: String,
    pub is_main_role: bool,
}

#[tauri::command]
pub fn get_git_sync_status(state: State<DbState>) -> Result<GitSyncStatus, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    
    let device_id = read_setting(&conn, "git_sync_device_id");
    let device_branch = if device_id.is_empty() {
        String::new()
    } else {
        format!("device/{}", device_id)
    };

    Ok(GitSyncStatus {
        enabled: read_setting(&conn, "git_sync_enabled") == "true",
        remote_url: read_setting(&conn, "git_sync_remote_url"),
        last_synced_at: read_setting(&conn, "git_sync_last_synced_at"),
        last_error: read_setting(&conn, "git_sync_last_error"),
        device_id,
        device_label: read_setting(&conn, "git_sync_device_label"),
        device_branch,
        main_branch: read_setting(&conn, "git_sync_main_branch"),
        is_main_role: read_setting(&conn, "git_sync_is_main_role") == "true",
    })
}

#[tauri::command]
pub async fn configure_git_sync(
    auth: State<'_, AuthState>,
    app: AppHandle,
    state: State<'_, DbState>,
    remote_url: String,
    enabled: bool,
) -> Result<(), String> {
    require_auth_for_destructive_ops(&auth, &state)?;
    if enabled && !remote_url.is_empty() && !is_ssh_remote(&remote_url) {
        return Err("Git sync requires an SSH remote URL (for example git@github.com:you/aetherium-sync.git).".to_string());
    }

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if enabled && !remote_url.is_empty() {
        let remote = remote_url.clone();
        tokio::task::spawn_blocking(move || git_sync::ensure_repo(&app_dir, &remote))
            .await
            .map_err(|e| e.to_string())??;
    }
    let conn = state.0.get().map_err(|e| e.to_string())?;

    let set = |key: &str, val: &str| {
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, val],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
    };

    set("git_sync_enabled", if enabled { "true" } else { "false" })?;
    set("git_sync_remote_url", &remote_url)?;
    set("git_sync_last_error", "")?;

    if enabled {
        let device_id = read_setting(&conn, "git_sync_device_id");
        if device_id.is_empty() {
            let new_id = uuid::Uuid::new_v4().to_string();
            set("git_sync_device_id", &new_id)?;
        }
        
        let main_branch = read_setting(&conn, "git_sync_main_branch");
        if main_branch.is_empty() {
            set("git_sync_main_branch", "main")?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn trigger_git_sync(
    auth: State<'_, AuthState>,
    app: AppHandle,
    state: State<'_, DbState>,
) -> Result<GitSyncStatus, String> {
    require_auth_for_destructive_ops(&auth, &state)?;
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let (remote_url, device_branch, main_branch, is_main_role) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        if read_setting(&conn, "git_sync_enabled") != "true" {
            return Err("Git sync is disabled".to_string());
        }
        let url = read_setting(&conn, "git_sync_remote_url");
        let device_id = read_setting(&conn, "git_sync_device_id");
        let dev_branch = format!("device/{}", device_id);
        let main_br = read_setting(&conn, "git_sync_main_branch");
        let is_main = read_setting(&conn, "git_sync_is_main_role") == "true";
        (url, dev_branch, main_br, is_main)
    };

    if remote_url.is_empty() {
        return Err("No remote URL configured".to_string());
    }
    if !is_ssh_remote(&remote_url) {
        return Err("Git sync requires an SSH remote URL.".to_string());
    }

    let remote = remote_url.clone();
    let result = tokio::task::spawn_blocking(move || {
        git_sync::ensure_repo(&app_dir, &remote)?;
        Ok::<_, String>(git_sync::sync_v2(&app_dir, &device_branch, &main_branch, is_main_role))
    })
    .await
    .map_err(|e| e.to_string())??;

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
        if result.error.is_none() {
            set("git_sync_last_synced_at", &now);
        }
        set("git_sync_last_error", &error_str);
    }

    // Call get_git_sync_status to return full new status
    get_git_sync_status(state)
}

#[tauri::command]
pub fn set_git_sync_device_label(
    state: State<DbState>,
    label: String,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('git_sync_device_label', ?1)",
        [&label],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_git_sync_main_role(
    auth: State<AuthState>,
    state: State<DbState>,
) -> Result<(), String> {
    require_auth_for_destructive_ops(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('git_sync_is_main_role', 'true')",
        [],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_git_sync_devices(
    app: AppHandle,
) -> Result<Vec<git_sync::RemoteDeviceBranch>, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let repo_dir = git_sync::data_dir_from_app_dir(&app_dir);
    tokio::task::spawn_blocking(move || {
        git_sync::list_remote_device_branches(&repo_dir)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn list_pending_promotions(
    state: State<DbState>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let map = git_sync::load_chat_commit_map(&conn)?;
    let pending: Vec<serde_json::Value> = map.iter()
        .filter(|(_, record)| {
            record.last_known_main_commit.is_some()
                && record.last_known_main_commit.as_deref() != Some(&record.last_known_device_commit)
        })
        .map(|(path, _)| {
            serde_json::json!({
                "chat_relpath": path,
                "session_id": path.split('/').next_back()
                    .and_then(|f| f.strip_suffix(".json.enc").or_else(|| f.strip_suffix(".json")))
                    .unwrap_or(""),
                "title": path,
            })
        })
        .collect();
    Ok(pending)
}

#[tauri::command]
pub async fn promote_chat_to_main(
    auth: State<'_, AuthState>,
    app: AppHandle,
    state: State<'_, DbState>,
    chat_relpath: String,
) -> Result<git_sync::PromoteOutcome, String> {
    require_auth_for_destructive_ops(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let main_branch = read_setting(&conn, "git_sync_main_branch");
    if main_branch.is_empty() {
        return Err("Main branch not configured".into());
    }
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let repo_dir = git_sync::data_dir_from_app_dir(&app_dir);
    drop(conn);
    tokio::task::spawn_blocking(move || {
        git_sync::promote_chat_to_main(&repo_dir, &main_branch, &chat_relpath)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn promote_all_diverged_chats(
    auth: State<'_, AuthState>,
    app: AppHandle,
    state: State<'_, DbState>,
) -> Result<Vec<(String, git_sync::PromoteOutcome)>, String> {
    require_auth_for_destructive_ops(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let main_branch = read_setting(&conn, "git_sync_main_branch");
    if main_branch.is_empty() {
        return Err("Main branch not configured".into());
    }
    let map = git_sync::load_chat_commit_map(&conn)?;
    let paths: Vec<String> = map.iter()
        .filter(|(_, r)| r.last_known_main_commit.is_some()
            && r.last_known_main_commit.as_deref() != Some(&r.last_known_device_commit))
        .map(|(p, _)| p.clone())
        .collect();
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let repo_dir = git_sync::data_dir_from_app_dir(&app_dir);
    drop(conn);
    tokio::task::spawn_blocking(move || {
        Ok(git_sync::promote_all_diverged_chats(&repo_dir, &main_branch, &paths))
    }).await.map_err(|e| e.to_string())?
}
