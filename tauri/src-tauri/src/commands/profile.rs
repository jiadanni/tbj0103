use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::commands::security::{require_auth_for_destructive_ops, AuthState};
use crate::db::DbState;
use crate::services::profile_manager::{self, AppProfile};

#[derive(Debug, Clone, Serialize)]
pub struct ProfilesResponse {
    pub active_profile_id: String,
    pub active_profile: AppProfile,
    pub profiles: Vec<AppProfile>,
}

#[tauri::command]
pub async fn list_profiles(app: AppHandle) -> Result<ProfilesResponse, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    tokio::task::spawn_blocking(move || {
        let (active_profile, _, _) = profile_manager::get_active_profile_and_paths(&app_dir);
        let config = profile_manager::load_profiles_config(&app_dir);
        Ok(ProfilesResponse {
            active_profile_id: config.active_profile_id,
            active_profile,
            profiles: config.profiles,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_profile(
    app: AppHandle,
    name: String,
    description: Option<String>,
    switch_to: Option<bool>,
) -> Result<AppProfile, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let profile = profile_manager::create_profile(&app_dir, &name, description.as_deref())?;

    if switch_to.unwrap_or(false) {
        profile_manager::switch_active_profile(&app_dir, &profile.id)?;
        let app_clone = app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
            app_clone.restart();
        });
    }

    Ok(profile)
}

#[tauri::command]
pub async fn switch_profile(app: AppHandle, profile_id: String) -> Result<(), String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    profile_manager::switch_active_profile(&app_dir, &profile_id)?;

    let app_clone = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
        app_clone.restart();
    });

    Ok(())
}

#[tauri::command]
pub async fn rename_profile(
    app: AppHandle,
    profile_id: String,
    name: String,
    description: Option<String>,
) -> Result<AppProfile, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    profile_manager::rename_profile(&app_dir, &profile_id, &name, description.as_deref())
}

#[tauri::command]
pub async fn delete_profile(
    app: AppHandle,
    auth: State<'_, AuthState>,
    db: State<'_, DbState>,
    profile_id: String,
) -> Result<(), String> {
    require_auth_for_destructive_ops(&auth, &db)?;

    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    profile_manager::delete_profile(&app_dir, &profile_id)
}
