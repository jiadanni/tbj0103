use crate::db::DbState;
use crate::services::prompt_bank::{
    self, PromptBankJob, PromptBankStatus, PromptSuggestion,
};
use tauri::{AppHandle, Manager, State};

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
    if job.status == "queued" {
        let pool = app.state::<DbState>().0.clone();
        let job_id = job.id.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = prompt_bank::run_job_by_id(pool.clone(), job_id.clone()).await {
                prompt_bank::mark_job_failed(&pool, &job_id, &error);
            }
        });
    }
    Ok(job)
}
