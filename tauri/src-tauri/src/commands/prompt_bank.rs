use crate::db::DbState;
use crate::services::background_scheduler::BackgroundTaskEvent;
use crate::services::prompt_bank::{self, PromptBankJob, PromptBankStatus, PromptSuggestion};
use tauri::{AppHandle, Emitter, Manager, State};

fn emit_prompt_bank_task(
    app: &AppHandle,
    status: &str,
    message: &str,
    model: Option<String>,
    workspace_id: Option<String>,
) {
    let _ = app.emit(
        "background-task",
        BackgroundTaskEvent {
            task_type: "workspace_prompt_bank".to_string(),
            status: status.to_string(),
            message: message.to_string(),
            model,
            workspace_id,
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
    if job.status == "running" {
        // Already running (someone else picked it up). Emit "processing" so
        // the status bar reflects the live state immediately.
        emit_prompt_bank_task(
            &app,
            "processing",
            "Refreshing starter prompts…",
            Some(job.model.clone()),
            Some(workspace_id.clone()),
        );
    }
    if job.status == "queued" {
        emit_prompt_bank_task(
            &app,
            "queued",
            "Queued for starter prompt refresh…",
            Some(job.model.clone()),
            Some(workspace_id.clone()),
        );
        let pool = app.state::<DbState>().0.clone();
        let job_id = job.id.clone();
        let model = job.model.clone();
        let workspace_id_for_task = workspace_id.clone();
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            // Wait for any in-flight background job to finish so we don't
            // overlap with the scheduler (would show two pills in the status
            // bar and ask Ollama to load two models concurrently). The
            // "started" event is deferred until AFTER we hold the permit so
            // the pill only appears when work is actually happening.
            let _permit = crate::services::background_scheduler::acquire_job_permit().await;
            emit_prompt_bank_task(
                &app_handle,
                "started",
                "Refreshing starter prompts…",
                Some(model.clone()),
                Some(workspace_id_for_task.clone()),
            );
            if let Err(error) = prompt_bank::run_job_by_id(pool.clone(), job_id.clone()).await {
                prompt_bank::mark_job_failed(&pool, &job_id, &error);
                emit_prompt_bank_task(
                    &app_handle,
                    "failed",
                    "Starter prompt refresh failed",
                    Some(model),
                    Some(workspace_id_for_task),
                );
            } else {
                emit_prompt_bank_task(
                    &app_handle,
                    "completed",
                    "Starter prompts refreshed",
                    Some(model),
                    Some(workspace_id_for_task),
                );
            }
        });
    }
    Ok(job)
}
