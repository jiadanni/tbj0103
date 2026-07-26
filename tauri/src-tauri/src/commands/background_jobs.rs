use crate::db::DbState;
use crate::services::background_scheduler;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, Emitter};

#[tauri::command]
pub async fn confirm_background_job(task_type: String) -> Result<bool, String> {
    Ok(background_scheduler::resolve_prompt(&task_type, true))
}

#[tauri::command]
pub async fn dismiss_background_job(task_type: String) -> Result<bool, String> {
    Ok(background_scheduler::resolve_prompt(&task_type, false))
}

#[tauri::command]
pub async fn cancel_background_job(task_type: String) -> Result<bool, String> {
    Ok(background_scheduler::request_cancel(&task_type))
}

#[tauri::command]
pub async fn queue_background_job_now(app: AppHandle, task_type: String) -> Result<(), String> {
    background_scheduler::ensure_ollama_reachable(&app).await?;
    background_scheduler::queue_manual_job(app, task_type)
}

#[derive(Debug, Clone, Deserialize)]
pub struct QueueBackgroundProcessingRequest {
    pub scope: String,
    #[serde(default)]
    pub workspace_ids: Vec<String>,
    #[serde(default)]
    pub task_types: Vec<String>,
    #[serde(default)]
    pub include_imported: bool,
}

#[tauri::command]
pub async fn queue_background_processing_now(
    app: AppHandle,
    req: QueueBackgroundProcessingRequest,
) -> Result<(), String> {
    background_scheduler::ensure_ollama_reachable(&app).await?;
    background_scheduler::queue_manual_processing(app, req)
}

/// All settings used by the Inference Jobs preferences section. Fetched in a
/// single IPC round-trip so the UI can render without dozens of generic
/// get_setting calls.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InferenceJobSettings {
    pub jobs: Vec<InferenceJobSetting>,
    pub confirm_timeout_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceJobSetting {
    pub job_key: String,
    pub run_mode: String, // "auto" | "confirm_only" | "dual_model"
    pub heavy_model: String,
}

#[tauri::command]
pub async fn get_inference_job_settings(
    state: State<'_, DbState>,
) -> Result<InferenceJobSettings, String> {
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || -> Result<InferenceJobSettings, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let jobs = background_scheduler::SCHEDULED_JOB_KEYS
            .iter()
            .map(|key| {
                let run_mode = crate::services::model_settings::get_string_setting(
                    &conn,
                    &format!("{}_run_mode", key),
                )
                .unwrap_or_else(|| "auto".to_string());
                let heavy_model = crate::services::model_settings::get_string_setting(
                    &conn,
                    &format!("{}_heavy_model", key),
                )
                .unwrap_or_default();
                InferenceJobSetting {
                    job_key: (*key).to_string(),
                    run_mode,
                    heavy_model,
                }
            })
            .collect();
        let confirm_timeout_seconds =
            crate::services::model_settings::get_confirm_timeout_seconds(&conn);
        Ok(InferenceJobSettings {
            jobs,
            confirm_timeout_seconds,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_inference_job_statuses(
    state: State<'_, DbState>,
) -> Result<Vec<background_scheduler::InferenceJobStatus>, String> {
    let pool = state.0.clone();
    tokio::task::spawn_blocking(
        move || -> Result<Vec<background_scheduler::InferenceJobStatus>, String> {
            let conn = pool.get().map_err(|e| e.to_string())?;
            background_scheduler::list_scheduled_statuses(&conn)
        },
    )
    .await
    .map_err(|e| e.to_string())?
}

/// Persist the user's currently-active workspace ID. The background scheduler
/// reads this to prefer the active workspace when picking work — see
/// `services/background_scheduler.rs::current_workspace_id`. Frontend should
/// call this whenever the workspace store's `activeWorkspaceId` changes.
#[tauri::command]
pub async fn set_current_workspace_id(
    state: State<'_, DbState>,
    workspace_id: Option<String>,
) -> Result<(), String> {
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('current_workspace_id', ?1)",
            rusqlite::params![workspace_id.unwrap_or_default()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_inference_job_setting(
    state: State<'_, DbState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_active_background_jobs(
    state: State<'_, DbState>,
) -> Result<Vec<background_scheduler::ActiveBackgroundJob>, String> {
    let pool = state.0.clone();
    tokio::task::spawn_blocking(
        move || -> Result<Vec<background_scheduler::ActiveBackgroundJob>, String> {
            let conn = pool.get().map_err(|e| e.to_string())?;
            background_scheduler::list_active(&conn)
        },
    )
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pause_background_scheduler(app: AppHandle, duration_seconds: Option<u64>) -> Result<(), String> {
    background_scheduler::pause_scheduler(duration_seconds);
    let status = background_scheduler::get_pause_status();
    let _ = app.emit("background-scheduler-pause-status", status);

    if let Some(secs) = duration_seconds {
        let app_clone = app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(secs)).await;
            let status = background_scheduler::get_pause_status();
            let _ = app_clone.emit("background-scheduler-pause-status", status);
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn resume_background_scheduler(app: AppHandle) -> Result<(), String> {
    background_scheduler::resume_scheduler();
    let status = background_scheduler::get_pause_status();
    let _ = app.emit("background-scheduler-pause-status", status);
    Ok(())
}

#[tauri::command]
pub async fn get_background_scheduler_pause_status() -> Result<background_scheduler::PauseStatus, String> {
    Ok(background_scheduler::get_pause_status())
}
