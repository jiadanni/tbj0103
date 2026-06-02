use crate::db::DbState;
use crate::services::background_scheduler::BackgroundTaskEvent;
use crate::services::prompt_bank::{
    self, PromptBankJob, PromptBankStatus, PromptSuggestion,
};
use tauri::{AppHandle, Emitter, Manager, State};

fn emit_prompt_bank_task(app: &AppHandle, status: &str, message: &str, model: Option<String>) {
    let _ = app.emit(
        "background-task",
        BackgroundTaskEvent {
            task_type: "workspace_prompt_bank".to_string(),
            status: status.to_string(),
            message: message.to_string(),
            model,
        },
    );
}

#[tauri::command]
pub async fn list_workspace_prompt_suggestions(
    state: State<'_, DbState>,
    workspace_id: String,
    limit: Option<usize>,
) -> Result<Vec<PromptSuggestion>, String> {
    prompt_bank::list_suggestions(&state, &workspace_id, limit.unwrap_or(12)).await
}

#[tauri::command]
pub fn get_workspace_prompt_bank_status(
    state: State<'_, DbState>,
    workspace_id: String,
) -> Result<PromptBankStatus, String> {
    prompt_bank::get_status(&state, &workspace_id)
}

#[tauri::command]
pub fn start_workspace_prompt_bank_job(
    app: AppHandle,
    state: State<'_, DbState>,
    workspace_id: String,
    target_count: Option<i64>,
) -> Result<PromptBankJob, String> {
    let job = prompt_bank::create_job(&state, &workspace_id, target_count.unwrap_or(120))?;
    emit_prompt_bank_task(
        &app,
        if job.status == "running" { "processing" } else { "started" },
        "Refreshing starter prompts…",
        Some(job.model.clone()),
    );
    if job.status == "queued" {
        let pool = app.state::<DbState>().0.clone();
        let job_id = job.id.clone();
        let model = job.model.clone();
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            // Wait for any in-flight background job to finish so we don't
            // overlap with the scheduler (would show two pills in the status
            // bar and ask Ollama to load two models concurrently).
            let _permit = crate::services::background_scheduler::acquire_job_permit().await;
            if let Err(error) = prompt_bank::run_job_by_id(pool.clone(), job_id.clone()).await {
                prompt_bank::mark_job_failed(&pool, &job_id, &error);
                emit_prompt_bank_task(
                    &app_handle,
                    "failed",
                    "Starter prompt refresh failed",
                    Some(model),
                );
            } else {
                emit_prompt_bank_task(
                    &app_handle,
                    "completed",
                    "Starter prompts refreshed",
                    Some(model),
                );
            }
        });
    }
    Ok(job)
}
