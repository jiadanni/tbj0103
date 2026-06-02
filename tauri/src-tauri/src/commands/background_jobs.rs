use crate::db::DbState;
use crate::services::background_scheduler;
use serde::{Deserialize, Serialize};
use tauri::State;

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

/// All settings used by the Scheduled Tasks preferences section. Fetched in a
/// single IPC round-trip so the UI can render without dozens of generic
/// get_setting calls.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ScheduledTaskSettings {
    pub jobs: Vec<ScheduledJobSetting>,
    pub confirm_timeout_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledJobSetting {
    pub job_key: String,
    pub run_mode: String, // "auto" | "confirm_only" | "dual_model"
    pub heavy_model: String,
}

const SCHEDULED_JOB_KEYS: &[&str] = &[
    "memory_extraction",
    "workspace_glossary",
    "hover_definition_scan",
    "summarization",
    "flashcard_generation",
    "concept_hierarchy",
    "workspace_prompt_bank",
];

#[tauri::command]
pub async fn get_scheduled_task_settings(
    state: State<'_, DbState>,
) -> Result<ScheduledTaskSettings, String> {
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || -> Result<ScheduledTaskSettings, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let jobs = SCHEDULED_JOB_KEYS
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
                ScheduledJobSetting {
                    job_key: (*key).to_string(),
                    run_mode,
                    heavy_model,
                }
            })
            .collect();
        let confirm_timeout_seconds =
            crate::services::model_settings::get_confirm_timeout_seconds(&conn);
        Ok(ScheduledTaskSettings {
            jobs,
            confirm_timeout_seconds,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_scheduled_task_setting(
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
