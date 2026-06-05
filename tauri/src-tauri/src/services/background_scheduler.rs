use crate::db::DbState;
use crate::services::model_settings::{
    get_confirm_timeout_seconds, get_heavy_model, get_model_for_job, get_run_mode, RunMode,
};
use crate::services::{git_sync, memory_pipeline, summarization_service, workspace_glossary};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, OwnedSemaphorePermit, Semaphore};

static SCHEDULER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Pending confirmation channels keyed by task_type. When a job is gated by
/// `confirm_only` or `dual_model`, the scheduler installs a oneshot sender
/// here and awaits the receiver. `confirm_background_job` resolves it.
type PendingMap = HashMap<String, oneshot::Sender<PromptResolution>>;
static PENDING: LazyLock<Mutex<PendingMap>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Cancel flags for currently-running jobs. The stop button in the status bar
/// sets these; running jobs check between stages and abort cooperatively.
static CANCEL_FLAGS: LazyLock<Mutex<HashMap<String, bool>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Live in-memory queue/running state for scheduler-managed jobs. This powers
/// the frontend queue view for jobs that do not persist their own status in
/// SQLite.
static ACTIVE_JOBS: LazyLock<Mutex<HashMap<String, ActiveBackgroundJob>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Single-permit semaphore serializing every background job — scheduler ticks
/// and manually-triggered IPCs (e.g. `start_workspace_prompt_bank_job`) all
/// acquire this before doing work. Holding it for the duration of a job means
/// the status bar shows at most one running pill, and Ollama isn't asked to
/// load two models at the same time.
static JOB_LOCK: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(1)));

/// Acquire the global job lock. Manual IPCs and the scheduler tick both call
/// this; the returned permit must be held for the duration of the job and
/// dropped on completion.
pub async fn acquire_job_permit() -> OwnedSemaphorePermit {
    JOB_LOCK.clone().acquire_owned().await.expect("JOB_LOCK semaphore closed")
}

#[derive(Debug, Clone, Copy)]
enum PromptResolution {
    Confirmed,
    Cancelled,
}
/// Counts scheduler ticks consumed by the concept-hierarchy job so we can
/// gate it to roughly every 5 minutes (5 ticks at the current 60s cadence).
/// Cheap LLM amortisation guard — the job itself is bounded internally too.
static HIERARCHY_TICK: AtomicU32 = AtomicU32::new(0);
const HIERARCHY_TICK_INTERVAL: u32 = 5;
/// Same idea for the prompt-bank job — refilling happens at most every 30 min
/// (30 ticks at the current 60s cadence). Prompts are only generated when a
/// workspace dips below `REFILL_WATERMARK`, so the on-tick check is a cheap
/// SQL lookup, but we cap how often we even consider it to avoid streaks.
static PROMPT_BANK_TICK: AtomicU32 = AtomicU32::new(0);
const PROMPT_BANK_TICK_INTERVAL: u32 = 30;

/// Mirror of the TypeScript `BackgroundTaskEvent` interface in api.ts.
#[derive(Debug, Clone, Serialize)]
pub struct BackgroundTaskEvent {
    pub task_type: String,
    pub status: String, // "queued" | "started" | "processing" | "completed" | "failed" | "cancelled"
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

/// Emitted on `background-task-prompt` when a job is gated on user
/// confirmation. The status-bar shows a play button until the user clicks it
/// or the timeout elapses.
#[derive(Debug, Clone, Serialize)]
pub struct BackgroundTaskPromptEvent {
    pub task_type: String,
    pub mode: String, // "confirm_only" | "dual_model"
    pub status: String, // "pending" | "dismissed" | "confirmed" | "cancelled"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heavy_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub small_model: Option<String>,
    pub timeout_seconds: u64,
}

fn emit_prompt(
    app: &AppHandle,
    task_type: &str,
    mode: RunMode,
    status: &str,
    heavy_model: Option<String>,
    small_model: Option<String>,
    timeout_seconds: u64,
) {
    let _ = app.emit(
        "background-task-prompt",
        BackgroundTaskPromptEvent {
            task_type: task_type.to_string(),
            mode: mode.as_str().to_string(),
            status: status.to_string(),
            heavy_model,
            small_model,
            timeout_seconds,
        },
    );
}

/// Resolve a pending confirmation. Returns `false` if no prompt was pending.
pub fn resolve_prompt(task_type: &str, confirmed: bool) -> bool {
    let sender = {
        let Ok(mut map) = PENDING.lock() else {
            return false;
        };
        map.remove(task_type)
    };
    let Some(sender) = sender else {
        return false;
    };
    let resolution = if confirmed {
        PromptResolution::Confirmed
    } else {
        PromptResolution::Cancelled
    };
    sender.send(resolution).is_ok()
}

/// Request cooperative cancellation of a running job. Returns `true` if the
/// flag was set (i.e., the job was known). Jobs check this between stages.
pub fn request_cancel(task_type: &str) -> bool {
    if let Ok(mut map) = CANCEL_FLAGS.lock() {
        if map.contains_key(task_type) {
            map.insert(task_type.to_string(), true);
            return true;
        }
    }
    false
}

fn register_running(task_type: &str) {
    if let Ok(mut map) = CANCEL_FLAGS.lock() {
        map.insert(task_type.to_string(), false);
    }
}

fn unregister_running(task_type: &str) {
    if let Ok(mut map) = CANCEL_FLAGS.lock() {
        map.remove(task_type);
    }
}

pub fn is_cancelled(task_type: &str) -> bool {
    CANCEL_FLAGS
        .lock()
        .map(|m| m.get(task_type).copied().unwrap_or(false))
        .unwrap_or(false)
}

/// Read run-mode and heavy-model for a job from settings.
async fn lookup_job_mode(app: &AppHandle, job_key: &str) -> (RunMode, Option<String>, u64) {
    let db = app.state::<DbState>();
    let pool = db.0.clone();
    let job_key_owned = job_key.to_string();
    tokio::task::spawn_blocking(move || -> (RunMode, Option<String>, u64) {
        let Ok(conn) = pool.get() else {
            return (RunMode::Auto, None, 20);
        };
        let mode = get_run_mode(&conn, &job_key_owned);
        let heavy = get_heavy_model(&conn, &job_key_owned);
        let timeout = get_confirm_timeout_seconds(&conn);
        (mode, heavy, timeout)
    })
    .await
    .unwrap_or((RunMode::Auto, None, 20))
}

/// Gate a job behind the user's run-mode setting.
///
/// Returns `(should_run, model)`. When `should_run` is false the caller must
/// skip the job entirely (confirm_only timeout, or user-cancelled prompt).
/// When true, `model` is what to run with — heavy on confirmation, small/
/// default otherwise.
async fn gate_job(
    app: &AppHandle,
    job_key: &str,
    default_model: Option<String>,
) -> (bool, Option<String>) {
    let (mode, heavy_model, timeout_seconds) = lookup_job_mode(app, job_key).await;
    match mode {
        RunMode::Auto => (true, default_model),
        RunMode::ConfirmOnly | RunMode::DualModel => {
            let (tx, rx) = oneshot::channel::<PromptResolution>();
            {
                let Ok(mut map) = PENDING.lock() else {
                    return (true, default_model);
                };
                // Newest wins: drop any previously-installed sender for this job.
                map.insert(job_key.to_string(), tx);
            }
            emit_prompt(
                app,
                job_key,
                mode,
                "pending",
                heavy_model.clone(),
                default_model.clone(),
                timeout_seconds,
            );
            let wait = tokio::time::timeout(Duration::from_secs(timeout_seconds), rx).await;
            // Drop our entry if still installed (timeout path)
            let _ = PENDING.lock().map(|mut m| m.remove(job_key));
            match wait {
                Ok(Ok(PromptResolution::Confirmed)) => {
                    emit_prompt(
                        app,
                        job_key,
                        mode,
                        "confirmed",
                        heavy_model.clone(),
                        default_model.clone(),
                        timeout_seconds,
                    );
                    (true, heavy_model.or(default_model))
                }
                Ok(Ok(PromptResolution::Cancelled)) => {
                    emit_prompt(
                        app,
                        job_key,
                        mode,
                        "cancelled",
                        heavy_model,
                        default_model,
                        timeout_seconds,
                    );
                    (false, None)
                }
                _ => {
                    // Timeout or channel closed
                    emit_prompt(
                        app,
                        job_key,
                        mode,
                        "dismissed",
                        heavy_model,
                        default_model.clone(),
                        timeout_seconds,
                    );
                    match mode {
                        RunMode::DualModel => (true, default_model),
                        _ => (false, None),
                    }
                }
            }
        }
    }
}

fn emit_task(app: &AppHandle, task_type: &str, status: &str, message: &str, model: Option<String>) {
    match status {
        "queued" => {
            if let Ok(mut jobs) = ACTIVE_JOBS.lock() {
                let existing = jobs.get(task_type).cloned();
                jobs.insert(
                    task_type.to_string(),
                    ActiveBackgroundJob {
                        task_type: task_type.to_string(),
                        workspace_id: existing.and_then(|job| job.workspace_id),
                        model: model.clone(),
                        started_at: Some(chrono::Utc::now().to_rfc3339()),
                        status: "queued".to_string(),
                    },
                );
            }
        }
        "started" | "processing" => {
            if let Ok(mut jobs) = ACTIVE_JOBS.lock() {
                let existing = jobs.get(task_type).cloned();
                let workspace_id = existing.as_ref().and_then(|job| job.workspace_id.clone());
                let existing_model = existing.as_ref().and_then(|job| job.model.clone());
                jobs.insert(
                    task_type.to_string(),
                    ActiveBackgroundJob {
                        task_type: task_type.to_string(),
                        workspace_id,
                        model: model.clone().or(existing_model),
                        started_at: Some(chrono::Utc::now().to_rfc3339()),
                        status: "running".to_string(),
                    },
                );
            }
        }
        _ => {
            if let Ok(mut jobs) = ACTIVE_JOBS.lock() {
                jobs.remove(task_type);
            }
        }
    }
    let _ = app.emit(
        "background-task",
        BackgroundTaskEvent {
            task_type: task_type.to_string(),
            status: status.to_string(),
            message: message.to_string(),
            model,
        },
    );
}

async fn acquire_job_permit_with_queue(
    app: &AppHandle,
    task_type: &str,
    queued_message: &str,
    running_message: &str,
    model: Option<String>,
) -> OwnedSemaphorePermit {
    if let Ok(permit) = JOB_LOCK.clone().try_acquire_owned() {
        emit_task(app, task_type, "started", running_message, model);
        return permit;
    }

    emit_task(app, task_type, "queued", queued_message, model.clone());
    let permit = acquire_job_permit().await;
    emit_task(app, task_type, "started", running_message, model);
    permit
}

/// Look up the model the scheduler would use for a given job key.
async fn lookup_job_model(app: &AppHandle, job_key: &str) -> Option<String> {
    let db = app.state::<DbState>();
    let pool = db.0.clone();
    let job_key = job_key.to_string();
    tokio::task::spawn_blocking(move || -> Option<String> {
        let conn = pool.get().ok()?;
        get_model_for_job(&conn, &job_key)
    })
    .await
    .ok()
    .flatten()
}

pub fn start_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        let mut git_sync_tick: u32 = 0;

        loop {
            interval.tick().await;
            git_sync_tick += 1;

            // Guard: skip this tick if the previous one is still running
            if SCHEDULER_RUNNING
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                crate::logging::log_buffered(
                    "info",
                    "scheduler",
                    "[TICK_SKIP] previous tick still running",
                    "{}",
                );
                continue;
            }

            let tick_started_at = std::time::Instant::now();
            crate::logging::log_buffered("info", "scheduler", "[TICK_START]", "{}");

            let db = app.state::<DbState>();

            // Before processing, check if user is actively streaming to avoid concurrent Ollama calls
            let is_streaming = {
                let abort_state = app.state::<crate::commands::ollama::StreamAbortState>();
                let result = match abort_state.0.lock() {
                    Ok(map) => !map.is_empty(),
                    Err(_) => false,
                };
                result
            };

            let is_active_chatting = {
                let pool = db.0.clone();
                tokio::task::spawn_blocking(move || -> bool {
                    let Ok(conn) = pool.get() else { return false; };
                    let idle_minutes: u32 = crate::commands::settings::get_setting(&conn, "memory_extraction_idle_minutes")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(5);
                    let sql = format!(
                        "SELECT COUNT(*) FROM chat_sessions WHERE datetime(last_accessed_at) >= datetime('now', '-{} minutes')",
                        idle_minutes
                    );
                    let count: i64 = conn.query_row(&sql, [], |row| row.get(0)).unwrap_or(0);
                    count > 0
                })
                .await
                .unwrap_or(false)
            };

            // Read Ollama URL from settings
            let ollama_url = {
                let pool = db.0.clone();
                tokio::task::spawn_blocking(move || -> Option<String> {
                    let conn = pool.get().ok()?;
                    conn.query_row(
                        "SELECT value FROM settings WHERE key = 'ollama_base_url'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .map(|v| v.trim_matches('"').to_string())
                    .ok()
                })
                .await
                .ok()
                .flatten()
            };

            let background_inference_enabled = {
                let pool = db.0.clone();
                tokio::task::spawn_blocking(move || -> bool {
                    let Ok(conn) = pool.get() else { return true; };
                    crate::commands::settings::get_setting(&conn, "background_inference_enabled")
                        .map(|v| v == "true")
                        .unwrap_or(true)
                })
                .await
                .unwrap_or(true)
            };

            // If user is NOT chatting and background inference is enabled, run AI tasks
            if !is_streaming && !is_active_chatting && background_inference_enabled {
                // 1. Process memory extraction
                let mem_default = lookup_job_model(&app, "memory_extraction_model").await;
                let (mem_run, mem_model) = gate_job(&app, "memory_extraction", mem_default).await;
                if mem_run {
                    let _permit = acquire_job_permit_with_queue(
                        &app,
                        "memory_extraction",
                        "Queued for memory extraction…",
                        "Extracting memories…",
                        mem_model.clone(),
                    ).await;
                    register_running("memory_extraction");
                    let mem_result = if is_cancelled("memory_extraction") {
                        Err("cancelled".to_string())
                    } else {
                        memory_pipeline::process_auto_memory_extraction(&db, ollama_url.clone()).await
                    };
                    let cancelled = is_cancelled("memory_extraction");
                    emit_task(
                        &app,
                        "memory_extraction",
                        if cancelled { "failed" } else if mem_result.is_ok() { "completed" } else { "failed" },
                        if cancelled { "Memory extraction cancelled" } else if mem_result.is_ok() { "Memory extraction done" } else { "Memory extraction failed" },
                        mem_model,
                    );
                    unregister_running("memory_extraction");
                }

                let glossary_default = lookup_job_model(&app, "glossary_model").await;
                let (g_run, glossary_model) = gate_job(&app, "workspace_glossary", glossary_default.clone()).await;
                if g_run {
                    let _permit = acquire_job_permit_with_queue(
                        &app,
                        "workspace_glossary",
                        "Queued for glossary refresh…",
                        "Refreshing workspace glossary…",
                        glossary_model.clone(),
                    ).await;
                    register_running("workspace_glossary");
                    let glossary_result = if is_cancelled("workspace_glossary") {
                        Err("cancelled".to_string())
                    } else {
                        workspace_glossary::refresh_due_workspaces(&db).await
                    };
                    let cancelled = is_cancelled("workspace_glossary");
                    emit_task(
                        &app,
                        "workspace_glossary",
                        if cancelled || glossary_result.is_err() { "failed" } else { "completed" },
                        if cancelled {
                            "Workspace glossary cancelled"
                        } else if glossary_result.is_ok() {
                            "Workspace glossary refreshed"
                        } else {
                            "Workspace glossary refresh failed"
                        },
                        glossary_model,
                    );
                    unregister_running("workspace_glossary");
                }

                let (scan_run, scan_model) = gate_job(&app, "hover_definition_scan", glossary_default).await;
                if scan_run {
                    let _permit = acquire_job_permit_with_queue(
                        &app,
                        "hover_definition_scan",
                        "Queued for definition scan…",
                        "Scanning chats for missing definitions…",
                        scan_model.clone(),
                    ).await;
                    register_running("hover_definition_scan");
                    let scan_result = if is_cancelled("hover_definition_scan") {
                        Err("cancelled".to_string())
                    } else {
                        workspace_glossary::scan_recent_sessions_for_missing_terms(&db).await
                    };
                    let cancelled = is_cancelled("hover_definition_scan");
                    emit_task(
                        &app,
                        "hover_definition_scan",
                        if cancelled || scan_result.is_err() { "failed" } else { "completed" },
                        if cancelled {
                            "Hover definition scan cancelled"
                        } else if scan_result.is_ok() {
                            "Hover definition scan done"
                        } else {
                            "Hover definition scan failed"
                        },
                        scan_model,
                    );
                    unregister_running("hover_definition_scan");
                }

                // 2. Process summarization — only sessions with recent activity
                let (summ_recency_minutes, summ_max_sessions) = {
                    let pool = db.0.clone();
                    tokio::task::spawn_blocking(move || -> (u32, u32) {
                        let Ok(conn) = pool.get() else { return (5, 5); };
                        let idle = crate::commands::settings::get_setting(&conn, "memory_extraction_idle_minutes")
                            .and_then(|v| v.parse::<u32>().ok())
                            .unwrap_or(5);
                        let max = crate::commands::settings::get_setting(&conn, "summarization_max_sessions")
                            .and_then(|v| v.parse::<u32>().ok())
                            .unwrap_or(5);
                        (idle, max)
                    })
                    .await
                    .unwrap_or((5, 5))
                };
                let sessions: Vec<(String, String)> = {
                    let pool = db.0.clone();
                    tokio::task::spawn_blocking(move || -> Vec<(String, String)> {
                        let Ok(conn) = pool.get() else { return Vec::new(); };
                        let sql = format!(
                            "SELECT cs.id, cs.workspace_id FROM chat_sessions cs
                             WHERE datetime(cs.updated_at) > datetime('now', '-{} minutes')
                               AND cs.is_incognito = 0
                               AND cs.exclude_from_analytics = 0
                               AND cs.is_imported = 0
                             ORDER BY cs.updated_at DESC
                             LIMIT {}",
                            summ_recency_minutes, summ_max_sessions
                        );
                        let result = match conn.prepare(&sql) {
                            Ok(mut stmt) => stmt
                                .query_map([], |row| {
                                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                                })
                                .map(|rows| rows.filter_map(Result::ok).collect::<Vec<_>>())
                                .unwrap_or_default(),
                            Err(_) => Vec::new(),
                        };
                        result
                    })
                    .await
                    .unwrap_or_default()
                };

                if !sessions.is_empty() {
                    let summ_default = lookup_job_model(&app, "summarization_model").await;
                    let (summ_run, summ_model) = gate_job(&app, "summarization", summ_default).await;
                    if summ_run {
                        let _permit = acquire_job_permit_with_queue(
                            &app,
                            "summarization",
                            "Queued for summarization…",
                            "Summarizing chats…",
                            summ_model.clone(),
                        ).await;
                        register_running("summarization");
                        let mut any_failed = false;
                        for (session_id, workspace_id) in sessions {
                            if is_cancelled("summarization") {
                                any_failed = true;
                                break;
                            }
                            let result = summarization_service::generate_rolling_summary(
                                &db,
                                &session_id,
                                &workspace_id,
                                ollama_url.clone(),
                            )
                            .await;
                            if result.is_err() {
                                any_failed = true;
                            }
                        }
                        let cancelled = is_cancelled("summarization");
                        emit_task(
                            &app,
                            "summarization",
                            if any_failed { "failed" } else { "completed" },
                            if cancelled { "Summarization cancelled" } else if any_failed { "Summarization failed" } else { "Summarization done" },
                            summ_model,
                        );
                        unregister_running("summarization");
                    }
                }

                // 4. Flashcard topic sync + automatic card generation
                let fc_default = lookup_job_model(&app, "flashcard_model").await;
                let (fc_run, fc_model) = gate_job(&app, "flashcard_generation", fc_default).await;
                if fc_run {
                    let _permit = acquire_job_permit_with_queue(
                        &app,
                        "flashcard_generation",
                        "Queued for flashcard generation…",
                        "Generating flashcards…",
                        fc_model.clone(),
                    ).await;
                    register_running("flashcard_generation");
                    let fc_result = if is_cancelled("flashcard_generation") {
                        Err("cancelled".to_string())
                    } else {
                        crate::services::flashcard_topic_service::tick(&db, ollama_url.clone()).await
                    };
                    let cancelled = is_cancelled("flashcard_generation");
                    emit_task(
                        &app,
                        "flashcard_generation",
                        if cancelled || fc_result.is_err() { "failed" } else { "completed" },
                        if cancelled { "Flashcard generation cancelled" } else if fc_result.is_ok() { "Flashcard generation done" } else { "Flashcard generation failed" },
                        fc_model,
                    );
                    unregister_running("flashcard_generation");
                }

                // 5. Concept hierarchy — LLM-assisted parent detection.
                //    Gated to every Nth tick so we don't spend ~20 LLM calls
                //    every minute. The job itself caps work per call.
                let hierarchy_tick = HIERARCHY_TICK.fetch_add(1, Ordering::Relaxed) + 1;
                if hierarchy_tick.is_multiple_of(HIERARCHY_TICK_INTERVAL) {
                    let ch_default = lookup_job_model(&app, "concept_hierarchy_model").await;
                    let (ch_run, ch_model) = gate_job(&app, "concept_hierarchy", ch_default).await;
                    if ch_run {
                        let _permit = acquire_job_permit_with_queue(
                            &app,
                            "concept_hierarchy",
                            "Queued for topic linking…",
                            "Linking related topics…",
                            ch_model.clone(),
                        ).await;
                        register_running("concept_hierarchy");
                        let ch_result = if is_cancelled("concept_hierarchy") {
                            Err("cancelled".to_string())
                        } else {
                            crate::services::concept_hierarchy_service::tick(&db, ollama_url.clone()).await
                        };
                        let cancelled = is_cancelled("concept_hierarchy");
                        let (status, message) = if cancelled {
                            ("failed", "Topic linking cancelled".to_string())
                        } else {
                            match &ch_result {
                                Ok(report) => (
                                    "completed",
                                    format!(
                                        "Topic linking done ({} considered, {} linked)",
                                        report.considered, report.linked
                                    ),
                                ),
                                Err(_) => ("failed", "Topic linking failed".to_string()),
                            }
                        };
                        emit_task(&app, "concept_hierarchy", status, &message, ch_model);
                        unregister_running("concept_hierarchy");
                    }
                }

                let prompt_bank_tick = PROMPT_BANK_TICK.fetch_add(1, Ordering::Relaxed) + 1;
                let pb_default = lookup_job_model(&app, "topic_signature_model").await;
                let (pb_run, prompt_bank_model) = if prompt_bank_tick.is_multiple_of(PROMPT_BANK_TICK_INTERVAL) {
                    gate_job(&app, "workspace_prompt_bank", pb_default).await
                } else {
                    (false, None)
                };
                if pb_run {
                    let _permit = acquire_job_permit_with_queue(
                        &app,
                        "workspace_prompt_bank",
                        "Queued for starter prompt refresh…",
                        "Refreshing starter prompts…",
                        prompt_bank_model.clone(),
                    ).await;
                    register_running("workspace_prompt_bank");
                    let prompt_bank_result = if is_cancelled("workspace_prompt_bank") {
                        Err("cancelled".to_string())
                    } else {
                        crate::services::prompt_bank::tick(&db).await
                    };
                    let cancelled = is_cancelled("workspace_prompt_bank");
                    emit_task(
                        &app,
                        "workspace_prompt_bank",
                        if cancelled || prompt_bank_result.is_err() { "failed" } else { "completed" },
                        if cancelled {
                            "Starter prompt refresh cancelled"
                        } else if prompt_bank_result.is_ok() {
                            "Starter prompts refreshed"
                        } else {
                            "Starter prompt refresh failed"
                        },
                        prompt_bank_model,
                    );
                    unregister_running("workspace_prompt_bank");
                }
            }

            // 3. Git sync — configurable interval (default 5 minutes = 10 ticks at 30s)
            let git_sync_ticks = {
                let pool = db.0.clone();
                tokio::task::spawn_blocking(move || -> u32 {
                    let Ok(conn) = pool.get() else { return 10; };
                    let mins: u32 = crate::commands::settings::get_setting(&conn, "git_sync_interval_minutes")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(5);
                    (mins * 2).max(1) // 2 ticks per minute (30s interval)
                })
                .await
                .unwrap_or(10)
            };
            if git_sync_tick.is_multiple_of(git_sync_ticks) {
                let (sync_enabled, remote_url) = {
                    let pool = db.0.clone();
                    tokio::task::spawn_blocking(move || -> (bool, String) {
                        let Ok(conn) = pool.get() else { return (false, String::new()); };
                        let enabled = conn
                            .query_row(
                                "SELECT value FROM settings WHERE key = 'git_sync_enabled'",
                                [],
                                |r| r.get::<_, String>(0),
                            )
                            .unwrap_or_default()
                            == "true";
                        let url = conn
                            .query_row(
                                "SELECT value FROM settings WHERE key = 'git_sync_remote_url'",
                                [],
                                |r| r.get::<_, String>(0),
                            )
                            .unwrap_or_default();
                        (enabled, url)
                    })
                    .await
                    .unwrap_or((false, String::new()))
                };

                if sync_enabled && !remote_url.is_empty() {
                    emit_task(&app, "git_sync", "started", "Syncing to Git…", None);
                    let sync_ok;
                    if let Ok(app_dir) = app.path().app_data_dir() {
                        let remote_url_clone = remote_url.clone();
                        let app_dir_clone = app_dir.clone();
                        // Run blocking git operations on a dedicated thread to avoid blocking the async runtime
                        let sync_result = tokio::task::spawn_blocking(move || {
                            if git_sync::ensure_repo(&app_dir_clone, &remote_url_clone).is_ok() {
                                Some(git_sync::sync(&app_dir_clone))
                            } else {
                                None
                            }
                        })
                        .await;

                        if let Ok(Some(result)) = sync_result {
                            let now = chrono::Utc::now().to_rfc3339();
                            sync_ok = result.error.is_none() && !result.conflict;
                            let pool = db.0.clone();
                            let result_error = result.error.clone();
                            let result_conflict = result.conflict;
                            let _ = tokio::task::spawn_blocking(move || {
                                let Ok(conn) = pool.get() else { return; };
                                let set = |key: &str, val: &str| {
                                    let _ = conn.execute(
                                        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                                        rusqlite::params![key, val],
                                    );
                                };
                                if result_error.is_none() && !result_conflict {
                                    set("git_sync_last_synced_at", &now);
                                    set("git_sync_last_error", "");
                                } else if let Some(err) = result_error {
                                    set("git_sync_last_error", &err);
                                }
                            })
                            .await;
                        } else {
                            sync_ok = false;
                        }
                    } else {
                        sync_ok = false;
                    }
                    emit_task(
                        &app,
                        "git_sync",
                        if sync_ok { "completed" } else { "failed" },
                        if sync_ok { "Git sync done" } else { "Git sync failed" },
                        None,
                    );
                }
            }

            let tick_elapsed = tick_started_at.elapsed();
            crate::logging::log_buffered(
                "info",
                "scheduler",
                &format!(
                    "[TICK_END] duration={} streaming={} active_chatting={} bg_inference={}",
                    if tick_elapsed.as_secs() >= 1 {
                        format!("{:.2}s", tick_elapsed.as_secs_f64())
                    } else {
                        format!("{:.1}ms", tick_elapsed.as_secs_f64() * 1000.0)
                    },
                    is_streaming,
                    is_active_chatting,
                    background_inference_enabled,
                ),
                "{}",
            );
            SCHEDULER_RUNNING.store(false, Ordering::SeqCst);
        }
    });
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct ActiveBackgroundJob {
    pub task_type: String,
    pub workspace_id: Option<String>,
    pub model: Option<String>,
    pub started_at: Option<String>,
    pub status: String,
}

pub fn list_active(conn: &rusqlite::Connection) -> Result<Vec<ActiveBackgroundJob>, String> {
    let mut jobs = ACTIVE_JOBS
        .lock()
        .map(|map| map.values().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    let mut stmt = conn
        .prepare(
            "SELECT 'workspace_prompt_bank' AS task_type, workspace_id, model, started_at, status \
             FROM workspace_prompt_bank_jobs \
             WHERE status IN ('queued', 'running')",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ActiveBackgroundJob {
                task_type: row.get(0)?,
                workspace_id: row.get(1)?,
                model: row.get(2)?,
                started_at: row.get(3)?,
                status: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let job = row.map_err(|e| e.to_string())?;
        if let Some(existing) = jobs.iter_mut().find(|existing| existing.task_type == job.task_type) {
            *existing = job;
        } else {
            jobs.push(job);
        }
    }
    Ok(jobs)
}
