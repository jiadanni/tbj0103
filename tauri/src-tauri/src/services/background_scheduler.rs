use crate::commands::background_jobs::QueueBackgroundProcessingRequest;
use crate::db::DbState;
use crate::services::model_settings::{
    get_confirm_timeout_seconds, get_heavy_model, get_model_for_job, get_run_mode, RunMode,
};
use crate::services::{git_sync, memory_pipeline, summarization_service, workspace_glossary};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{broadcast, oneshot, OwnedSemaphorePermit, Semaphore};

static SCHEDULER_RUNNING: AtomicBool = AtomicBool::new(false);

/// In-process broadcast bus for background-task events. Sibling to the
/// `app.emit("background-task", …)` IPC fire — anything in the Rust process
/// that wants to observe scheduler progress (e.g., the workspace-refresh
/// coordinator running in sync mode) subscribes here instead of trying to
/// re-listen to its own outbound IPC events.
static EVENT_BUS: LazyLock<broadcast::Sender<BackgroundTaskEvent>> = LazyLock::new(|| {
    let (tx, _rx) = broadcast::channel::<BackgroundTaskEvent>(128);
    tx
});

/// Subscribe to background-task events broadcast in-process. The returned
/// receiver yields every event emitted via `emit_task` / `emit_task_with_progress`
/// from the moment of subscription. Missed messages while the receiver is
/// behind become `RecvError::Lagged`; callers should treat that as a soft
/// signal to re-check their pending set.
pub fn subscribe_task_events() -> broadcast::Receiver<BackgroundTaskEvent> {
    EVENT_BUS.subscribe()
}

/// Pending confirmation channels keyed by task_type. When a job is gated by
/// `confirm_only` or `dual_model`, the scheduler installs a oneshot sender
/// here and awaits the receiver. `confirm_background_job` resolves it.
type PendingMap = HashMap<String, oneshot::Sender<PromptResolution>>;
static PENDING: LazyLock<Mutex<PendingMap>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Cancel flags for currently-running jobs. The stop button in the status bar
/// sets these; running jobs check between stages and abort cooperatively.
static CANCEL_FLAGS: LazyLock<Mutex<HashMap<String, bool>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Live in-memory queue/running state for scheduler-managed jobs. This powers
/// the frontend queue view for jobs that do not persist their own status in
/// SQLite.
static ACTIVE_JOBS: LazyLock<Mutex<HashMap<String, ActiveBackgroundJob>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static MANUAL_QUEUE: LazyLock<Mutex<VecDeque<String>>> =
    LazyLock::new(|| Mutex::new(VecDeque::new()));
static MANUAL_DRAIN_RUNNING: AtomicBool = AtomicBool::new(false);
static MANUAL_PROCESSING_RUNNING: AtomicBool = AtomicBool::new(false);
static NEXT_TICK_AT: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));

/// Per-job start instants for measuring duration. Keyed by job_key; populated
/// on the "started" / "processing" transition and consumed on terminal status.
static RUN_STARTED_AT: LazyLock<Mutex<HashMap<String, std::time::Instant>>> =
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
    JOB_LOCK
        .clone()
        .acquire_owned()
        .await
        .expect("JOB_LOCK semaphore closed")
}

#[derive(Debug, Clone, Copy)]
enum PromptResolution {
    Confirmed,
    Cancelled,
}
/// Counts scheduler ticks consumed by the concept-hierarchy job so we can
/// gate it to roughly every 30 minutes. Cheap LLM amortisation guard — the
/// job itself is bounded internally too.
static HIERARCHY_TICK: AtomicU32 = AtomicU32::new(0);
const HIERARCHY_TICK_INTERVAL: u32 = 6;
/// Same idea for the prompt-bank job — refilling happens at most hourly.
/// Prompts are only generated when a
/// workspace dips below `REFILL_WATERMARK`, so the on-tick check is a cheap
/// SQL lookup, but we cap how often we even consider it to avoid streaks.
static PROMPT_BANK_TICK: AtomicU32 = AtomicU32::new(0);
const PROMPT_BANK_TICK_INTERVAL: u32 = 12;

const SCHEDULER_INTERVAL_SECS: i64 = 300;
const SCHEDULER_INTERVAL_MINUTES: u32 = (SCHEDULER_INTERVAL_SECS / 60) as u32;
const MEMORY_TICK_INTERVAL: u32 = 1;
const GLOSSARY_TICK_INTERVAL: u32 = 6;
const HOVER_SCAN_TICK_INTERVAL: u32 = 3;
const SUMMARIZATION_TICK_INTERVAL: u32 = 2;
const FLASHCARD_TICK_INTERVAL: u32 = 6;
// Cleanup checks hourly; the real gate is the 24h (configurable) watermark.
const FLASHCARD_CLEANUP_TICK_INTERVAL: u32 = 12;

pub const SCHEDULED_JOB_KEYS: &[&str] = &[
    "memory_extraction",
    "workspace_glossary",
    "hover_definition_scan",
    "summarization",
    "flashcard_generation",
    "flashcard_cleanup",
    "concept_hierarchy",
    "workspace_prompt_bank",
];

fn job_label(task_type: &str) -> &'static str {
    match task_type {
        "memory_extraction" => "Memory Extraction",
        "summarization" => "Summarization",
        "flashcard_generation" => "Flashcard Generation",
        "flashcard_cleanup" => "Flashcard Cleanup",
        "workspace_glossary" => "Workspace Glossary",
        "hover_definition_scan" => "Hover Definitions",
        "concept_hierarchy" => "Topic Hierarchy",
        "workspace_prompt_bank" => "Starter Prompts / Topic Signatures",
        "workspace_analysis" => "Workspace Analysis",
        "manual_data_processing" => "Background Processing",
        "git_sync" => "Git Sync",
        _ => "Background Job",
    }
}

/// Mirror of the TypeScript `BackgroundTaskEvent` interface in api.ts.
#[derive(Debug, Clone, Serialize)]
pub struct BackgroundTaskEvent {
    pub task_type: String,
    pub status: String, // "queued" | "started" | "processing" | "completed" | "failed" | "cancelled"
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    /// 1-indexed position of the child job currently running within a batch.
    /// Populated by `manual_data_processing`; `None` for jobs that aren't
    /// part of a multi-step batch.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<u32>,
    /// Total number of child jobs in the current batch. See `current`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
    /// `task_type` of the child job currently running inside a batch. Lets the
    /// frontend map progress to the right row without parsing `message`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_task_type: Option<String>,
}

/// Emitted on `background-task-prompt` when a job is gated on user
/// confirmation. The status-bar shows a play button until the user clicks it
/// or the timeout elapses.
#[derive(Debug, Clone, Serialize)]
pub struct BackgroundTaskPromptEvent {
    pub task_type: String,
    pub mode: String,   // "confirm_only" | "dual_model"
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
        RunMode::Disabled => (false, None),
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
    emit_task_full(app, task_type, status, message, model, None, None, None, None);
}

/// Like `emit_task` but carries batch progress numerics (`current` / `total`)
/// and the child `task_type` currently running. Used by `manual_data_processing`
/// so the Data Controls panel can render a total + per-row progress UI without
/// parsing free-text status messages.
fn emit_task_with_progress(
    app: &AppHandle,
    task_type: &str,
    status: &str,
    message: &str,
    model: Option<String>,
    current: Option<u32>,
    total: Option<u32>,
    current_task_type: Option<String>,
) {
    emit_task_full(
        app,
        task_type,
        status,
        message,
        model,
        None,
        current,
        total,
        current_task_type,
    );
}

#[allow(clippy::too_many_arguments)]
fn emit_task_full(
    app: &AppHandle,
    task_type: &str,
    status: &str,
    message: &str,
    model: Option<String>,
    workspace_id: Option<String>,
    current: Option<u32>,
    total: Option<u32>,
    current_task_type: Option<String>,
) {
    let resolved_workspace_id = match status {
        "queued" => {
            let mut resolved = workspace_id.clone();
            if let Ok(mut jobs) = ACTIVE_JOBS.lock() {
                let existing = jobs.get(task_type).cloned();
                let merged_workspace = workspace_id
                    .clone()
                    .or_else(|| existing.and_then(|job| job.workspace_id));
                resolved = merged_workspace.clone();
                jobs.insert(
                    task_type.to_string(),
                    ActiveBackgroundJob {
                        task_type: task_type.to_string(),
                        workspace_id: merged_workspace,
                        model: model.clone(),
                        started_at: Some(chrono::Utc::now().to_rfc3339()),
                        status: "queued".to_string(),
                    },
                );
            }
            resolved
        }
        "started" | "processing" => {
            let mut resolved = workspace_id.clone();
            if let Ok(mut jobs) = ACTIVE_JOBS.lock() {
                let existing = jobs.get(task_type).cloned();
                let merged_workspace = workspace_id
                    .clone()
                    .or_else(|| existing.as_ref().and_then(|job| job.workspace_id.clone()));
                let existing_model = existing.as_ref().and_then(|job| job.model.clone());
                resolved = merged_workspace.clone();
                jobs.insert(
                    task_type.to_string(),
                    ActiveBackgroundJob {
                        task_type: task_type.to_string(),
                        workspace_id: merged_workspace,
                        model: model.clone().or(existing_model),
                        started_at: Some(chrono::Utc::now().to_rfc3339()),
                        status: "running".to_string(),
                    },
                );
            }
            if status == "started" {
                if let Ok(mut starts) = RUN_STARTED_AT.lock() {
                    starts.entry(task_type.to_string())
                        .or_insert_with(std::time::Instant::now);
                }
            }
            resolved
        }
        _ => {
            let mut resolved = workspace_id.clone();
            if let Ok(mut jobs) = ACTIVE_JOBS.lock() {
                if resolved.is_none() {
                    resolved = jobs.get(task_type).and_then(|job| job.workspace_id.clone());
                }
                jobs.remove(task_type);
            }
            if matches!(status, "completed" | "failed" | "cancelled") {
                let started_at = RUN_STARTED_AT.lock().ok().and_then(|mut m| m.remove(task_type));
                let input_tokens: Option<i64> = None;
                let output_tokens: Option<i64> = None;
                let duration_ms = started_at.map(|t| t.elapsed().as_millis() as i64);
                let completed_at = chrono::Utc::now().to_rfc3339();
                let started_at_rfc = started_at
                    .map(|t| {
                        let elapsed = chrono::Duration::from_std(t.elapsed())
                            .unwrap_or(chrono::Duration::zero());
                        (chrono::Utc::now() - elapsed).to_rfc3339()
                    })
                    .unwrap_or_else(|| completed_at.clone());
                let error_message = if status == "completed" { None } else { Some(message.to_string()) };
                let job_key = task_type.to_string();
                let ws_id = resolved.clone();
                let status_owned = status.to_string();
                let db = app.state::<DbState>();
                let pool = db.0.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    if let Ok(conn) = pool.get() {
                        let _ = conn.execute(
                            "INSERT INTO inference_job_runs \
                                (job_key, workspace_id, started_at, completed_at, duration_ms, \
                                 input_tokens, output_tokens, status, error_message) \
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                            rusqlite::params![
                                job_key,
                                ws_id,
                                started_at_rfc,
                                completed_at,
                                duration_ms,
                                input_tokens,
                                output_tokens,
                                status_owned,
                                error_message,
                            ],
                        );
                    }
                });
            }
            resolved
        }
    };
    let event = BackgroundTaskEvent {
        task_type: task_type.to_string(),
        status: status.to_string(),
        message: message.to_string(),
        model,
        workspace_id: resolved_workspace_id,
        current,
        total,
        current_task_type,
    };
    // Mirror to the in-process broadcast bus first so subscribers (e.g., the
    // workspace-refresh coordinator) cannot race with the IPC emit. Receive
    // errors here mean no listeners — that is fine.
    let _ = EVENT_BUS.send(event.clone());
    let _ = app.emit("background-task", event);
}

fn current_next_tick_at() -> Option<String> {
    NEXT_TICK_AT.lock().ok().and_then(|value| value.clone())
}

fn set_next_tick_at_from_now() {
    let next = chrono::Utc::now() + chrono::Duration::seconds(SCHEDULER_INTERVAL_SECS);
    if let Ok(mut value) = NEXT_TICK_AT.lock() {
        *value = Some(next.to_rfc3339());
    }
}

fn interval_due_label(_next_tick_at: Option<&str>, ticks_remaining: u32) -> String {
    let minutes = ticks_remaining.saturating_mul(SCHEDULER_INTERVAL_MINUTES);
    if ticks_remaining <= 1 {
        return "due on next scheduler check".to_string();
    }
    format!("due in about {minutes} min ({ticks_remaining} checks)")
}

fn every_tick_label(tick_interval: u32) -> String {
    let minutes = tick_interval
        .max(1)
        .saturating_mul(SCHEDULER_INTERVAL_MINUTES);
    format!("checks every {minutes} min when idle and data changed")
}

fn eligible_count(conn: &rusqlite::Connection, sql: &str) -> bool {
    conn.query_row(sql, [], |row| row.get::<_, i64>(0))
        .map(|count| count > 0)
        .unwrap_or(false)
}

fn max_source_updated_sql(workspace_id_expr: &str) -> String {
    format!(
        "SELECT MAX(updated_at) FROM (
           SELECT w.updated_at AS updated_at
           FROM workspaces w
           WHERE w.id = {workspace_id_expr}
           UNION ALL
           SELECT pn.updated_at
           FROM project_notes pn
           WHERE pn.workspace_id = {workspace_id_expr}
           UNION ALL
           SELECT dn.updated_at
           FROM daily_notes dn
           WHERE dn.workspace_id = {workspace_id_expr}
           UNION ALL
           SELECT d.updated_at
           FROM uploaded_documents d
           WHERE d.workspace_id = {workspace_id_expr}
           UNION ALL
           SELECT wc.created_at
           FROM web_captures wc
           WHERE wc.workspace_id = {workspace_id_expr}
           UNION ALL
           SELECT m.created_at
           FROM messages m
           JOIN chat_sessions cs ON cs.id = m.session_id
           WHERE cs.workspace_id = {workspace_id_expr}
             AND cs.is_incognito = 0
             AND cs.exclude_from_analytics = 0
             AND cs.is_imported = 0
         )"
    )
}

fn has_auto_work(conn: &rusqlite::Connection, job_key: &str) -> bool {
    match job_key {
        "memory_extraction" => {
            let threshold =
                crate::commands::settings::get_setting(conn, "memory_extraction_threshold")
                    .and_then(|value| value.parse::<i64>().ok())
                    .unwrap_or(5);
            eligible_count(
                conn,
                &format!(
                    "SELECT COUNT(*)
                     FROM chat_sessions cs
                     WHERE datetime(cs.updated_at) > datetime('now', '-24 hours')
                       AND cs.is_incognito = 0
                       AND cs.exclude_from_analytics = 0
                       AND cs.is_imported = 0
                       AND (
                         SELECT COUNT(*) FROM messages m WHERE m.session_id = cs.id
                       ) >= {threshold}
                       AND (
                         SELECT COUNT(*) FROM messages m WHERE m.session_id = cs.id
                       ) > cs.last_processed_message_count"
                ),
            )
        }
        "summarization" => {
            let min_messages =
                crate::commands::settings::get_setting(conn, "summarization_min_messages")
                    .and_then(|value| value.parse::<i64>().ok())
                    .unwrap_or(1);
            eligible_count(
                conn,
                &format!(
                    "SELECT COUNT(*)
                     FROM chat_sessions cs
                     WHERE datetime(cs.updated_at) > datetime('now', '-24 hours')
                       AND cs.is_incognito = 0
                       AND cs.exclude_from_analytics = 0
                       AND cs.is_imported = 0
                       AND (
                         SELECT COUNT(*) FROM messages m WHERE m.session_id = cs.id
                       ) >= {min_messages}
                       AND NOT EXISTS (
                         SELECT 1
                         FROM conversation_summaries s
                         WHERE s.session_id = cs.id
                           AND s.summary_type = 'info'
                           AND s.message_range_end >= (
                             SELECT COUNT(*) FROM messages m WHERE m.session_id = cs.id
                           )
                       )"
                ),
            )
        }
        "workspace_glossary" => eligible_count(
            conn,
            &format!(
                "SELECT COUNT(*)
                 FROM workspaces w
                 LEFT JOIN workspace_glossary_state s ON s.workspace_id = w.id
                 WHERE w.is_hidden = 0
                   AND (
                     s.workspace_id IS NULL
                     OR COALESCE(s.assistant_message_count_at_seed, 0) < (
                       SELECT COUNT(*)
                       FROM messages m
                       JOIN chat_sessions cs ON cs.id = m.session_id
                       WHERE cs.workspace_id = w.id
                         AND m.role = 'assistant'
                         AND cs.is_incognito = 0
                         AND cs.exclude_from_analytics = 0
                         AND cs.is_imported = 0
                     )
                     OR datetime(COALESCE(({}), '1970-01-01T00:00:00Z'))
                        > datetime(COALESCE(s.updated_at, '1970-01-01T00:00:00Z'))
                   )",
                max_source_updated_sql("w.id")
            ),
        ),
        "hover_definition_scan" => eligible_count(
            conn,
            "SELECT COUNT(*)
             FROM chat_sessions cs
             WHERE cs.is_incognito = 0
               AND cs.exclude_from_analytics = 0
               AND cs.is_imported = 0
               AND (
                 SELECT COUNT(*)
                 FROM messages m
                 WHERE m.session_id = cs.id AND m.role = 'assistant'
               ) > COALESCE((
                 SELECT last_scanned_assistant_count
                 FROM session_glossary_scan_state s
                 WHERE s.session_id = cs.id
               ), 0)",
        ),
        "flashcard_generation" => {
            let min_interval = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = 'flashcard_topic_min_interval_minutes'",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .ok()
                .and_then(|value| value.trim_matches('"').parse::<i64>().ok())
                .unwrap_or(60);
            let target_cards =
                crate::services::flashcard_topic_service::topic_target_cards(conn);
            eligible_count(
                conn,
                &format!(
                    "SELECT COUNT(*)
                     FROM flashcard_topics
                     WHERE card_count < {target_cards}
                       AND (
                         last_generated_at IS NULL
                         OR datetime(last_generated_at) < datetime('now', '-{min_interval} minutes')
                       )"
                ),
            )
        }
        "flashcard_cleanup" => {
            let interval_hours = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = 'flashcard_cleanup_interval_hours'",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .ok()
                .and_then(|value| value.trim_matches('"').parse::<i64>().ok())
                .unwrap_or(
                    crate::services::flashcard_topic_service::DEFAULT_CLEANUP_INTERVAL_HOURS,
                );
            eligible_count(
                conn,
                &format!(
                    "SELECT COUNT(*)
                     FROM flashcard_topics
                     WHERE card_count >= 2
                       AND COALESCE(
                             (SELECT datetime(trim(value, '\"')) FROM settings
                              WHERE key = 'flashcard_cleanup_last_run_at'),
                             datetime('1970-01-01')
                           ) < datetime('now', '-{interval_hours} hours')"
                ),
            )
        }
        "concept_hierarchy" => eligible_count(
            conn,
            "SELECT COUNT(*)
             FROM concept_nodes cn
             WHERE NOT EXISTS (
                 SELECT 1 FROM concept_links cl
                 WHERE cl.source_id = cn.id AND cl.link_type = 'part_of'
             )
             AND (
                 cn.parent_checked_at IS NULL
                 OR cn.parent_checked_at < (
                     SELECT MAX(cn2.created_at) FROM concept_nodes cn2
                     WHERE cn2.workspace_id = cn.workspace_id
                 )
             )",
        ),
        "workspace_prompt_bank" => eligible_count(
            conn,
            "SELECT COUNT(*)
             FROM workspaces w
             LEFT JOIN workspace_prompt_bank_jobs j
               ON j.workspace_id = w.id AND j.status IN ('queued', 'running')
             WHERE w.is_hidden = 0
               AND j.id IS NULL
               AND COALESCE((
                 SELECT COUNT(*)
                 FROM workspace_prompt_bank p
                 WHERE p.workspace_id = w.id
                   AND p.dismissed_at IS NULL
               ), 0) < 15",
        ),
        _ => true,
    }
}

async fn has_auto_work_for_job(app: &AppHandle, job_key: &str) -> bool {
    let db = app.state::<DbState>();
    let pool = db.0.clone();
    let job_key = job_key.to_string();
    tokio::task::spawn_blocking(move || -> bool {
        let Ok(conn) = pool.get() else {
            return false;
        };
        has_auto_work(&conn, &job_key)
    })
    .await
    .unwrap_or(false)
}

async fn lookup_manual_job_model(app: &AppHandle, job_key: &str) -> Option<String> {
    let db = app.state::<DbState>();
    let pool = db.0.clone();
    let job_key_owned = job_key.to_string();
    tokio::task::spawn_blocking(move || -> Option<String> {
        let conn = pool.get().ok()?;
        let mode = get_run_mode(&conn, &job_key_owned);
        let default_model = get_model_for_job(&conn, &format!("{}_model", job_key_owned))
            .or_else(|| get_model_for_job(&conn, &job_key_owned));
        match mode {
            RunMode::Auto | RunMode::Disabled => default_model,
            RunMode::ConfirmOnly | RunMode::DualModel => {
                get_heavy_model(&conn, &job_key_owned).or(default_model)
            }
        }
    })
    .await
    .ok()
    .flatten()
}

async fn lookup_ollama_url(app: &AppHandle) -> Option<String> {
    let db = app.state::<DbState>();
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
}

async fn run_manual_job(
    app: &AppHandle,
    task_type: &str,
    _model: Option<String>,
) -> Result<(), String> {
    let db = app.state::<DbState>();
    let ollama_url = lookup_ollama_url(app).await;
    match task_type {
        "memory_extraction" => {
            memory_pipeline::process_auto_memory_extraction(&db, ollama_url).await
        }
        "workspace_glossary" => workspace_glossary::refresh_due_workspaces(&db)
            .await
            .map(|_| ()),
        "hover_definition_scan" => workspace_glossary::scan_recent_sessions_for_missing_terms(&db)
            .await
            .map(|_| ()),
        "summarization" => {
            let sessions: Vec<(String, String)> = {
                let pool = db.0.clone();
                tokio::task::spawn_blocking(move || -> Vec<(String, String)> {
                    let Ok(conn) = pool.get() else {
                        return Vec::new();
                    };
                    let idle = crate::commands::settings::get_setting(
                        &conn,
                        "memory_extraction_idle_minutes",
                    )
                    .and_then(|v| v.parse::<u32>().ok())
                    .unwrap_or(5);
                    let max =
                        crate::commands::settings::get_setting(&conn, "summarization_max_sessions")
                            .and_then(|v| v.parse::<u32>().ok())
                            .unwrap_or(5);
                    let sql = format!(
                        "SELECT cs.id, cs.workspace_id FROM chat_sessions cs
                         WHERE datetime(cs.updated_at) > datetime('now', '-{} minutes')
                           AND cs.is_incognito = 0
                           AND cs.exclude_from_analytics = 0
                           AND cs.is_imported = 0
                         ORDER BY cs.updated_at DESC
                         LIMIT {}",
                        idle, max
                    );
                    let Ok(mut stmt) = conn.prepare(&sql) else {
                        return Vec::new();
                    };
                    stmt.query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })
                    .map(|rows| rows.filter_map(Result::ok).collect::<Vec<_>>())
                    .unwrap_or_default()
                })
                .await
                .unwrap_or_default()
            };
            let mut any_failed = false;
            for (session_id, workspace_id) in sessions {
                if summarization_service::generate_info_summary(
                    &db,
                    &session_id,
                    &workspace_id,
                    ollama_url.clone(),
                )
                .await
                .is_err()
                {
                    any_failed = true;
                }
            }
            if any_failed {
                Err("Summarization failed".to_string())
            } else {
                Ok(())
            }
        }
        "flashcard_generation" => {
            crate::services::flashcard_topic_service::tick(&db, ollama_url).await
        }
        "flashcard_cleanup" => {
            crate::services::flashcard_topic_service::cleanup_tick(&db, ollama_url).await
        }
        "concept_hierarchy" => crate::services::concept_hierarchy_service::tick(&db, ollama_url)
            .await
            .map(|_| ()),
        "workspace_prompt_bank" => crate::services::prompt_bank::tick(&db).await.map(|_| ()),
        other => Err(format!("Unknown background job: {other}")),
    }
    .map_err(|error| {
        if error.trim().is_empty() {
            format!("{} failed", job_label(task_type))
        } else {
            error
        }
    })
}

async fn drain_manual_queue(app: AppHandle) {
    if MANUAL_DRAIN_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    loop {
        let Some(task_type) = MANUAL_QUEUE
            .lock()
            .ok()
            .and_then(|mut queue| queue.pop_front())
        else {
            MANUAL_DRAIN_RUNNING.store(false, Ordering::SeqCst);
            return;
        };
        let model = lookup_manual_job_model(&app, &task_type).await;
        let _permit = acquire_job_permit().await;
        emit_task(
            &app,
            &task_type,
            "started",
            &format!("Running {}…", job_label(&task_type)),
            model.clone(),
        );
        register_running(&task_type);
        let result = if is_cancelled(&task_type) {
            Err("cancelled".to_string())
        } else {
            run_manual_job(&app, &task_type, model.clone()).await
        };
        let cancelled = is_cancelled(&task_type);
        let message = if cancelled {
            format!("{} cancelled", job_label(&task_type))
        } else if result.is_ok() {
            format!("{} done", job_label(&task_type))
        } else {
            format!("{} failed", job_label(&task_type))
        };
        emit_task(
            &app,
            &task_type,
            if cancelled || result.is_err() {
                "failed"
            } else {
                "completed"
            },
            &message,
            model,
        );
        unregister_running(&task_type);
    }
}

pub fn queue_manual_job(app: AppHandle, task_type: String) -> Result<(), String> {
    if !SCHEDULED_JOB_KEYS.contains(&task_type.as_str()) {
        return Err(format!("Unknown scheduled job: {task_type}"));
    }
    {
        let mut queue = MANUAL_QUEUE.lock().map_err(|e| e.to_string())?;
        if queue.iter().any(|queued| queued == &task_type) {
            return Ok(());
        }
        queue.push_back(task_type.clone());
    }
    emit_task(
        &app,
        &task_type,
        "queued",
        &format!("Queued {} to run next…", job_label(&task_type)),
        None,
    );
    tauri::async_runtime::spawn(drain_manual_queue(app));
    Ok(())
}

fn normalize_manual_processing_tasks(task_types: &[String]) -> Result<Vec<String>, String> {
    let mut tasks = Vec::new();
    for task_type in task_types {
        if !SCHEDULED_JOB_KEYS.contains(&task_type.as_str()) {
            return Err(format!("Unknown scheduled job: {task_type}"));
        }
        if !tasks.iter().any(|task| task == task_type) {
            tasks.push(task_type.clone());
        }
    }
    if tasks.is_empty() {
        tasks.extend(SCHEDULED_JOB_KEYS.iter().map(|task| (*task).to_string()));
    }
    Ok(tasks)
}

fn resolve_processing_workspaces(
    conn: &rusqlite::Connection,
    req: &QueueBackgroundProcessingRequest,
) -> Result<Vec<String>, String> {
    match req.scope.as_str() {
        "current_workspace" => {
            let workspace_id = crate::services::model_settings::get_current_workspace_id(conn)
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| "No current workspace is selected".to_string())?;
            Ok(vec![workspace_id])
        }
        "selected_workspaces" => {
            if req.workspace_ids.is_empty() {
                return Err("Select at least one workspace".to_string());
            }
            let mut ids = Vec::new();
            for workspace_id in &req.workspace_ids {
                let exists = conn
                    .query_row(
                        "SELECT COUNT(*) FROM workspaces WHERE id = ?1 AND is_hidden = 0",
                        rusqlite::params![workspace_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap_or(0)
                    > 0;
                if exists && !ids.iter().any(|id| id == workspace_id) {
                    ids.push(workspace_id.clone());
                }
            }
            if ids.is_empty() {
                return Err("Selected workspaces are unavailable".to_string());
            }
            Ok(ids)
        }
        "all_workspaces" => {
            let mut stmt = conn
                .prepare("SELECT id FROM workspaces WHERE is_hidden = 0 ORDER BY lower(name) ASC")
                .map_err(|e| e.to_string())?;
            let ids = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            if ids.is_empty() {
                return Err("No workspaces are available".to_string());
            }
            Ok(ids)
        }
        other => Err(format!("Unsupported processing scope: {other}")),
    }
}

async fn resolve_processing_workspaces_for_app(
    app: &AppHandle,
    req: &QueueBackgroundProcessingRequest,
) -> Result<Vec<String>, String> {
    let db = app.state::<DbState>();
    let pool = db.0.clone();
    let req = req.clone();
    tokio::task::spawn_blocking(move || -> Result<Vec<String>, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        resolve_processing_workspaces(&conn, &req)
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn run_manual_processing_job(
    app: &AppHandle,
    task_type: &str,
    workspace_ids: &[String],
    include_imported: bool,
) -> Result<(), String> {
    let db = app.state::<DbState>();
    let ollama_url = lookup_ollama_url(app).await;
    match task_type {
        "memory_extraction" => {
            memory_pipeline::process_memory_extraction_for_workspaces(
                &db,
                workspace_ids,
                include_imported,
                ollama_url,
            )
            .await
        }
        "workspace_glossary" => {
            let mut any_failed = false;
            for workspace_id in workspace_ids {
                if is_cancelled("manual_data_processing") {
                    return Err("cancelled".to_string());
                }
                if workspace_glossary::refresh_workspace_glossary_with_options(
                    &db,
                    workspace_id,
                    include_imported,
                )
                .await
                .is_err()
                {
                    any_failed = true;
                }
            }
            if any_failed {
                Err("Workspace glossary failed".to_string())
            } else {
                Ok(())
            }
        }
        "hover_definition_scan" => {
            workspace_glossary::scan_sessions_for_missing_terms_with_options(
                &db,
                Some(workspace_ids),
                include_imported,
            )
            .await
            .map(|_| ())
        }
        "summarization" => {
            let sessions =
                collect_summary_sessions_for_workspaces(&db, workspace_ids, include_imported).await;
            let mut any_failed = false;
            for (session_id, workspace_id) in sessions {
                if is_cancelled("manual_data_processing") {
                    return Err("cancelled".to_string());
                }
                if summarization_service::generate_info_summary_with_imported(
                    &db,
                    &session_id,
                    &workspace_id,
                    ollama_url.clone(),
                    include_imported,
                )
                .await
                .is_err()
                {
                    any_failed = true;
                }
            }
            if any_failed {
                Err("Summarization failed".to_string())
            } else {
                Ok(())
            }
        }
        "flashcard_generation" => {
            crate::services::flashcard_topic_service::tick_for_workspaces(
                &db,
                ollama_url,
                Some(workspace_ids),
            )
            .await
        }
        "concept_hierarchy" => crate::services::concept_hierarchy_service::tick_for_workspaces(
            &db,
            ollama_url,
            Some(workspace_ids),
        )
        .await
        .map(|_| ()),
        "workspace_prompt_bank" => {
            crate::services::prompt_bank::tick_for_workspaces(&db, Some(workspace_ids))
                .await
                .map(|_| ())
        }
        other => Err(format!("Unknown background job: {other}")),
    }
}

async fn collect_summary_sessions_for_workspaces(
    db: &DbState,
    workspace_ids: &[String],
    include_imported: bool,
) -> Vec<(String, String)> {
    let pool = db.0.clone();
    let workspace_ids = workspace_ids.to_vec();
    tokio::task::spawn_blocking(move || -> Vec<(String, String)> {
        let Ok(conn) = pool.get() else {
            return Vec::new();
        };
        let min_messages =
            crate::commands::settings::get_setting(&conn, "summarization_min_messages")
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or(1);
        let mut sessions = Vec::new();
        for workspace_id in workspace_ids {
            let imported_clause = if include_imported {
                ""
            } else {
                "AND cs.is_imported = 0"
            };
            let sql = format!(
                "SELECT cs.id, cs.workspace_id
                 FROM chat_sessions cs
                 WHERE cs.workspace_id = ?1
                   AND cs.is_incognito = 0
                   AND cs.exclude_from_analytics = 0
                   {imported_clause}
                   AND (
                     SELECT COUNT(*) FROM messages m WHERE m.session_id = cs.id
                   ) >= ?2
                   AND NOT EXISTS (
                     SELECT 1
                     FROM conversation_summaries s
                     WHERE s.session_id = cs.id
                       AND s.summary_type = 'info'
                       AND s.message_range_end >= (
                         SELECT COUNT(*) FROM messages m WHERE m.session_id = cs.id
                       )
                   )
                 ORDER BY cs.updated_at DESC"
            );
            let Ok(mut stmt) = conn.prepare(&sql) else {
                continue;
            };
            let mapped = stmt.query_map(rusqlite::params![workspace_id, min_messages], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            });
            if let Ok(rows) = mapped {
                sessions.extend(rows.filter_map(Result::ok));
            }
        }
        sessions
    })
    .await
    .unwrap_or_default()
}

async fn run_manual_processing_batch(
    app: AppHandle,
    req: QueueBackgroundProcessingRequest,
    tasks: Vec<String>,
    workspace_ids: Vec<String>,
) {
    let task_type = "manual_data_processing";
    let _permit = acquire_job_permit().await;
    let total_tasks = u32::try_from(tasks.len()).unwrap_or(u32::MAX);
    emit_task_with_progress(
        &app,
        task_type,
        "started",
        "Running background processing…",
        None,
        Some(0),
        Some(total_tasks),
        None,
    );
    register_running(task_type);

    let mut any_failed = false;
    let mut completed = 0usize;
    for (idx, task) in tasks.iter().enumerate() {
        if is_cancelled(task_type) {
            any_failed = true;
            break;
        }
        let current_idx = u32::try_from(idx + 1).unwrap_or(u32::MAX);
        emit_task_with_progress(
            &app,
            task_type,
            "processing",
            &format!("Running {}…", job_label(task)),
            None,
            Some(current_idx),
            Some(total_tasks),
            Some(task.clone()),
        );
        match run_manual_processing_job(&app, task, &workspace_ids, req.include_imported).await {
            Ok(()) => completed += 1,
            Err(error) if error == "cancelled" => {
                any_failed = true;
                break;
            }
            Err(_) => any_failed = true,
        }
    }

    let cancelled = is_cancelled(task_type);
    let status = if cancelled || any_failed {
        "failed"
    } else {
        "completed"
    };
    let message = if cancelled {
        "Background processing cancelled".to_string()
    } else if any_failed {
        format!(
            "Background processing finished with issues ({completed}/{})",
            tasks.len()
        )
    } else {
        format!("Background processing done ({completed}/{})", tasks.len())
    };
    let completed_u32 = u32::try_from(completed).unwrap_or(u32::MAX);
    emit_task_with_progress(
        &app,
        task_type,
        status,
        &message,
        None,
        Some(completed_u32),
        Some(total_tasks),
        None,
    );
    unregister_running(task_type);
    MANUAL_PROCESSING_RUNNING.store(false, Ordering::SeqCst);
}

pub fn queue_manual_processing(
    app: AppHandle,
    req: QueueBackgroundProcessingRequest,
) -> Result<(), String> {
    if MANUAL_PROCESSING_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Background processing is already queued or running".to_string());
    }

    let tasks = match normalize_manual_processing_tasks(&req.task_types) {
        Ok(tasks) => tasks,
        Err(error) => {
            MANUAL_PROCESSING_RUNNING.store(false, Ordering::SeqCst);
            return Err(error);
        }
    };

    let app_for_resolve = app.clone();
    tauri::async_runtime::spawn(async move {
        let resolved = resolve_processing_workspaces_for_app(&app_for_resolve, &req).await;
        let workspace_ids = match resolved {
            Ok(ids) => ids,
            Err(error) => {
                emit_task(
                    &app_for_resolve,
                    "manual_data_processing",
                    "failed",
                    &error,
                    None,
                );
                MANUAL_PROCESSING_RUNNING.store(false, Ordering::SeqCst);
                return;
            }
        };
        emit_task(
            &app_for_resolve,
            "manual_data_processing",
            "queued",
            "Queued background processing…",
            None,
        );
        run_manual_processing_batch(app_for_resolve, req, tasks, workspace_ids).await;
    });
    Ok(())
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
        let mut interval =
            tokio::time::interval(Duration::from_secs(SCHEDULER_INTERVAL_SECS as u64));
        let mut git_sync_tick: u32 = 0;
        let mut memory_tick: u32 = 0;
        let mut glossary_tick: u32 = 0;
        let mut hover_scan_tick: u32 = 0;
        let mut summarization_tick: u32 = 0;
        let mut flashcard_tick: u32 = 0;
        let mut flashcard_cleanup_tick: u32 = 0;
        set_next_tick_at_from_now();

        loop {
            interval.tick().await;
            set_next_tick_at_from_now();
            git_sync_tick += 1;
            memory_tick += 1;
            glossary_tick += 1;
            hover_scan_tick += 1;
            summarization_tick += 1;
            flashcard_tick += 1;
            flashcard_cleanup_tick += 1;

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
                    let Ok(conn) = pool.get() else {
                        return true;
                    };
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
                if memory_tick.is_multiple_of(MEMORY_TICK_INTERVAL)
                    && has_auto_work_for_job(&app, "memory_extraction").await
                {
                    let mem_default = lookup_job_model(&app, "memory_extraction_model").await;
                    let (mem_run, mem_model) =
                        gate_job(&app, "memory_extraction", mem_default).await;
                    if mem_run {
                        let _permit = acquire_job_permit_with_queue(
                            &app,
                            "memory_extraction",
                            "Queued for memory extraction…",
                            "Extracting memories…",
                            mem_model.clone(),
                        )
                        .await;
                        register_running("memory_extraction");
                        let mem_result = if is_cancelled("memory_extraction") {
                            Err("cancelled".to_string())
                        } else {
                            memory_pipeline::process_auto_memory_extraction(&db, ollama_url.clone())
                                .await
                        };
                        let cancelled = is_cancelled("memory_extraction");
                        emit_task(
                            &app,
                            "memory_extraction",
                            if cancelled {
                                "failed"
                            } else if mem_result.is_ok() {
                                "completed"
                            } else {
                                "failed"
                            },
                            if cancelled {
                                "Memory extraction cancelled"
                            } else if mem_result.is_ok() {
                                "Memory extraction done"
                            } else {
                                "Memory extraction failed"
                            },
                            mem_model,
                        );
                        unregister_running("memory_extraction");
                    }
                }

                let glossary_default = if glossary_tick.is_multiple_of(GLOSSARY_TICK_INTERVAL)
                    || hover_scan_tick.is_multiple_of(HOVER_SCAN_TICK_INTERVAL)
                {
                    lookup_job_model(&app, "glossary_model").await
                } else {
                    None
                };
                if glossary_tick.is_multiple_of(GLOSSARY_TICK_INTERVAL)
                    && has_auto_work_for_job(&app, "workspace_glossary").await
                {
                    let (g_run, glossary_model) =
                        gate_job(&app, "workspace_glossary", glossary_default.clone()).await;
                    if g_run {
                        let _permit = acquire_job_permit_with_queue(
                            &app,
                            "workspace_glossary",
                            "Queued for glossary refresh…",
                            "Refreshing workspace glossary…",
                            glossary_model.clone(),
                        )
                        .await;
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
                            if cancelled || glossary_result.is_err() {
                                "failed"
                            } else {
                                "completed"
                            },
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
                }

                if hover_scan_tick.is_multiple_of(HOVER_SCAN_TICK_INTERVAL)
                    && has_auto_work_for_job(&app, "hover_definition_scan").await
                {
                    let (scan_run, scan_model) =
                        gate_job(&app, "hover_definition_scan", glossary_default).await;
                    if scan_run {
                        let _permit = acquire_job_permit_with_queue(
                            &app,
                            "hover_definition_scan",
                            "Queued for definition scan…",
                            "Scanning chats for missing definitions…",
                            scan_model.clone(),
                        )
                        .await;
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
                            if cancelled || scan_result.is_err() {
                                "failed"
                            } else {
                                "completed"
                            },
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
                }

                // 2. Process summarization — only sessions with recent activity
                let sessions: Vec<(String, String)> = if summarization_tick
                    .is_multiple_of(SUMMARIZATION_TICK_INTERVAL)
                    && has_auto_work_for_job(&app, "summarization").await
                {
                    let (summ_recency_minutes, summ_max_sessions) = {
                        let pool = db.0.clone();
                        tokio::task::spawn_blocking(move || -> (u32, u32) {
                            let Ok(conn) = pool.get() else {
                                return (5, 5);
                            };
                            let idle = crate::commands::settings::get_setting(
                                &conn,
                                "memory_extraction_idle_minutes",
                            )
                            .and_then(|v| v.parse::<u32>().ok())
                            .unwrap_or(5);
                            let max = crate::commands::settings::get_setting(
                                &conn,
                                "summarization_max_sessions",
                            )
                            .and_then(|v| v.parse::<u32>().ok())
                            .unwrap_or(5);
                            (idle, max)
                        })
                        .await
                        .unwrap_or((5, 5))
                    };
                    let pool = db.0.clone();
                    tokio::task::spawn_blocking(move || -> Vec<(String, String)> {
                        let Ok(conn) = pool.get() else {
                            return Vec::new();
                        };
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
                } else {
                    Vec::new()
                };

                if !sessions.is_empty() {
                    let summ_default = lookup_job_model(&app, "summarization_model").await;
                    let (summ_run, summ_model) =
                        gate_job(&app, "summarization", summ_default).await;
                    if summ_run {
                        let _permit = acquire_job_permit_with_queue(
                            &app,
                            "summarization",
                            "Queued for summarization…",
                            "Summarizing chats…",
                            summ_model.clone(),
                        )
                        .await;
                        register_running("summarization");
                        let mut any_failed = false;
                        for (session_id, workspace_id) in sessions {
                            if is_cancelled("summarization") {
                                any_failed = true;
                                break;
                            }
                            let result = summarization_service::generate_info_summary(
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
                            if cancelled {
                                "Summarization cancelled"
                            } else if any_failed {
                                "Summarization failed"
                            } else {
                                "Summarization done"
                            },
                            summ_model,
                        );
                        unregister_running("summarization");
                    }
                }

                // 4. Flashcard topic sync + automatic card generation
                if flashcard_tick.is_multiple_of(FLASHCARD_TICK_INTERVAL)
                    && has_auto_work_for_job(&app, "flashcard_generation").await
                {
                    let fc_default = lookup_job_model(&app, "flashcard_model").await;
                    let (fc_run, fc_model) =
                        gate_job(&app, "flashcard_generation", fc_default).await;
                    if fc_run {
                        let _permit = acquire_job_permit_with_queue(
                            &app,
                            "flashcard_generation",
                            "Queued for flashcard generation…",
                            "Generating flashcards…",
                            fc_model.clone(),
                        )
                        .await;
                        register_running("flashcard_generation");
                        let fc_result = if is_cancelled("flashcard_generation") {
                            Err("cancelled".to_string())
                        } else {
                            crate::services::flashcard_topic_service::tick(&db, ollama_url.clone())
                                .await
                        };
                        let cancelled = is_cancelled("flashcard_generation");
                        // Carry the tick's actual error into the event/run record;
                        // a bare "failed" hides the reason (missing model, bad JSON).
                        let fc_message = if cancelled {
                            "Flashcard generation cancelled".to_string()
                        } else {
                            match &fc_result {
                                Ok(()) => "Flashcard generation done".to_string(),
                                Err(e) => format!("Flashcard generation failed: {e}"),
                            }
                        };
                        emit_task(
                            &app,
                            "flashcard_generation",
                            if cancelled || fc_result.is_err() {
                                "failed"
                            } else {
                                "completed"
                            },
                            &fc_message,
                            fc_model,
                        );
                        unregister_running("flashcard_generation");
                    }
                }

                // 4b. Flashcard duplicate cleanup — LLM groups same-question
                //     cards; keeper prefers reviewed cards, then larger models.
                if flashcard_cleanup_tick.is_multiple_of(FLASHCARD_CLEANUP_TICK_INTERVAL)
                    && has_auto_work_for_job(&app, "flashcard_cleanup").await
                {
                    let fcc_default = lookup_job_model(&app, "flashcard_cleanup_model").await;
                    let (fcc_run, fcc_model) =
                        gate_job(&app, "flashcard_cleanup", fcc_default).await;
                    if fcc_run {
                        let _permit = acquire_job_permit_with_queue(
                            &app,
                            "flashcard_cleanup",
                            "Queued for flashcard cleanup…",
                            "Cleaning up duplicate flashcards…",
                            fcc_model.clone(),
                        )
                        .await;
                        register_running("flashcard_cleanup");
                        let fcc_result = if is_cancelled("flashcard_cleanup") {
                            Err("cancelled".to_string())
                        } else {
                            crate::services::flashcard_topic_service::cleanup_tick(
                                &db,
                                ollama_url.clone(),
                            )
                            .await
                        };
                        let cancelled = is_cancelled("flashcard_cleanup");
                        let fcc_message = if cancelled {
                            "Flashcard cleanup cancelled".to_string()
                        } else {
                            match &fcc_result {
                                Ok(()) => "Flashcard cleanup done".to_string(),
                                Err(e) => format!("Flashcard cleanup failed: {e}"),
                            }
                        };
                        emit_task(
                            &app,
                            "flashcard_cleanup",
                            if cancelled || fcc_result.is_err() {
                                "failed"
                            } else {
                                "completed"
                            },
                            &fcc_message,
                            fcc_model,
                        );
                        unregister_running("flashcard_cleanup");
                    }
                }

                // 5. Concept hierarchy — LLM-assisted parent detection.
                //    Gated to every Nth tick so we don't spend ~20 LLM calls
                //    every minute. The job itself caps work per call.
                let hierarchy_tick = HIERARCHY_TICK.fetch_add(1, Ordering::Relaxed) + 1;
                if hierarchy_tick.is_multiple_of(HIERARCHY_TICK_INTERVAL)
                    && has_auto_work_for_job(&app, "concept_hierarchy").await
                {
                    let ch_default = lookup_job_model(&app, "concept_hierarchy_model").await;
                    let (ch_run, ch_model) = gate_job(&app, "concept_hierarchy", ch_default).await;
                    if ch_run {
                        let _permit = acquire_job_permit_with_queue(
                            &app,
                            "concept_hierarchy",
                            "Queued for topic linking…",
                            "Linking related topics…",
                            ch_model.clone(),
                        )
                        .await;
                        register_running("concept_hierarchy");
                        let ch_result = if is_cancelled("concept_hierarchy") {
                            Err("cancelled".to_string())
                        } else {
                            crate::services::concept_hierarchy_service::tick(
                                &db,
                                ollama_url.clone(),
                            )
                            .await
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
                let (pb_run, prompt_bank_model) = if prompt_bank_tick
                    .is_multiple_of(PROMPT_BANK_TICK_INTERVAL)
                    && has_auto_work_for_job(&app, "workspace_prompt_bank").await
                {
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
                    )
                    .await;
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
                        if cancelled || prompt_bank_result.is_err() {
                            "failed"
                        } else {
                            "completed"
                        },
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
                    let Ok(conn) = pool.get() else {
                        return 10;
                    };
                    let mins: u32 =
                        crate::commands::settings::get_setting(&conn, "git_sync_interval_minutes")
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(5);
                    mins.div_ceil(SCHEDULER_INTERVAL_MINUTES).max(1)
                })
                .await
                .unwrap_or(10)
            };
            if git_sync_tick.is_multiple_of(git_sync_ticks) {
                let (sync_enabled, remote_url) = {
                    let pool = db.0.clone();
                    tokio::task::spawn_blocking(move || -> (bool, String) {
                        let Ok(conn) = pool.get() else {
                            return (false, String::new());
                        };
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
                        if sync_ok {
                            "Git sync done"
                        } else {
                            "Git sync failed"
                        },
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

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct InferenceJobStatus {
    pub job_key: String,
    pub label: String,
    pub enabled: bool,
    pub state: String,
    pub run_mode: String,
    pub small_model: Option<String>,
    pub heavy_model: Option<String>,
    pub next_check_at: Option<String>,
    pub next_due_at: Option<String>,
    pub due_label: String,
    /// Estimated input tokens (chars/4) for the next run, computed from the
    /// pending eligible work in the current workspace. `None` when no work is
    /// pending or the estimate can't be computed (e.g. no active workspace).
    pub pending_input_tokens: Option<i64>,
    /// Number of eligible work items in the current workspace that the next
    /// run would consume.
    pub pending_work_count: Option<i64>,
    /// Aggregate stats over the retention window (default 30 days) for the
    /// current workspace. All `None` when there is no run history yet.
    pub avg_duration_ms: Option<f64>,
    pub avg_input_tokens: Option<f64>,
    pub runs_count: Option<i64>,
    pub success_rate: Option<f64>,
    pub last_duration_ms: Option<i64>,
    pub last_completed_at: Option<String>,
}

/// Approximate token count from character count. Matches the 4-char/token
/// heuristic the frontend uses elsewhere (see WorkspaceMemoryPanel,
/// KnowledgeGraphView). Pure estimate — no tokenizer involved.
fn chars_to_tokens(chars: i64) -> i64 {
    if chars <= 0 { 0 } else { (chars + 3) / 4 }
}

/// Compute (pending_work_count, pending_input_tokens) for `job_key` scoped to
/// `workspace_id`. Returns `(None, None)` when no workspace is active or the
/// job has no per-workspace notion of input.
fn pending_workload_for_job(
    conn: &rusqlite::Connection,
    job_key: &str,
    workspace_id: Option<&str>,
) -> (Option<i64>, Option<i64>) {
    let Some(ws) = workspace_id else {
        return (None, None);
    };
    let row: Option<(i64, i64)> = match job_key {
        "memory_extraction" => {
            let threshold =
                crate::commands::settings::get_setting(conn, "memory_extraction_threshold")
                    .and_then(|value| value.parse::<i64>().ok())
                    .unwrap_or(5);
            conn.query_row(
                &format!(
                    "SELECT COUNT(DISTINCT cs.id),
                            COALESCE(SUM(LENGTH(m.content)), 0)
                     FROM chat_sessions cs
                     JOIN messages m ON m.session_id = cs.id
                     WHERE cs.workspace_id = ?1
                       AND datetime(cs.updated_at) > datetime('now', '-24 hours')
                       AND cs.is_incognito = 0
                       AND cs.exclude_from_analytics = 0
                       AND cs.is_imported = 0
                       AND cs.id IN (
                         SELECT cs2.id FROM chat_sessions cs2
                         WHERE cs2.workspace_id = ?1
                           AND (SELECT COUNT(*) FROM messages mm WHERE mm.session_id = cs2.id) >= {threshold}
                           AND (SELECT COUNT(*) FROM messages mm WHERE mm.session_id = cs2.id) > cs2.last_processed_message_count
                       )"
                ),
                rusqlite::params![ws],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
            )
            .ok()
        }
        "summarization" => {
            let min_messages =
                crate::commands::settings::get_setting(conn, "summarization_min_messages")
                    .and_then(|value| value.parse::<i64>().ok())
                    .unwrap_or(1);
            conn.query_row(
                &format!(
                    "SELECT COUNT(DISTINCT cs.id),
                            COALESCE(SUM(LENGTH(m.content)), 0)
                     FROM chat_sessions cs
                     JOIN messages m ON m.session_id = cs.id
                     WHERE cs.workspace_id = ?1
                       AND datetime(cs.updated_at) > datetime('now', '-24 hours')
                       AND cs.is_incognito = 0
                       AND cs.exclude_from_analytics = 0
                       AND cs.is_imported = 0
                       AND (SELECT COUNT(*) FROM messages mm WHERE mm.session_id = cs.id) >= {min_messages}
                       AND NOT EXISTS (
                         SELECT 1 FROM conversation_summaries s
                         WHERE s.session_id = cs.id
                           AND s.summary_type = 'info'
                           AND s.message_range_end >= (
                             SELECT COUNT(*) FROM messages mm WHERE mm.session_id = cs.id
                           )
                       )"
                ),
                rusqlite::params![ws],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
            )
            .ok()
        }
        "workspace_glossary" => conn
            .query_row(
                "SELECT 1, COALESCE(SUM(LENGTH(m.content)), 0)
                 FROM messages m
                 JOIN chat_sessions cs ON cs.id = m.session_id
                 WHERE cs.workspace_id = ?1
                   AND m.role = 'assistant'
                   AND cs.is_incognito = 0
                   AND cs.exclude_from_analytics = 0
                   AND cs.is_imported = 0",
                rusqlite::params![ws],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
            )
            .ok(),
        "hover_definition_scan" => conn
            .query_row(
                "SELECT COUNT(DISTINCT cs.id),
                        COALESCE(SUM(LENGTH(m.content)), 0)
                 FROM chat_sessions cs
                 JOIN messages m ON m.session_id = cs.id AND m.role = 'assistant'
                 WHERE cs.workspace_id = ?1
                   AND cs.is_incognito = 0
                   AND cs.exclude_from_analytics = 0
                   AND cs.is_imported = 0
                   AND (
                     SELECT COUNT(*) FROM messages mm
                     WHERE mm.session_id = cs.id AND mm.role = 'assistant'
                   ) > COALESCE((
                     SELECT last_scanned_assistant_count
                     FROM session_glossary_scan_state s WHERE s.session_id = cs.id
                   ), 0)",
                rusqlite::params![ws],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
            )
            .ok(),
        "flashcard_generation" => {
            let min_interval = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = 'flashcard_topic_min_interval_minutes'",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .ok()
                .and_then(|value| value.trim_matches('"').parse::<i64>().ok())
                .unwrap_or(60);
            conn.query_row(
                &format!(
                    "SELECT COUNT(*), COALESCE(SUM(LENGTH(topic)), 0)
                     FROM flashcard_topics
                     WHERE workspace_id = ?1
                       AND card_count < 8
                       AND (
                         last_generated_at IS NULL
                         OR datetime(last_generated_at) < datetime('now', '-{min_interval} minutes')
                       )"
                ),
                rusqlite::params![ws],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
            )
            .ok()
        }
        "concept_hierarchy" => conn
            .query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(LENGTH(name) + LENGTH(concept_description)), 0)
                 FROM concept_nodes cn
                 WHERE cn.workspace_id = ?1
                   AND NOT EXISTS (
                     SELECT 1 FROM concept_links cl
                     WHERE cl.source_id = cn.id AND cl.link_type = 'part_of'
                   )
                   AND (
                     cn.parent_checked_at IS NULL
                     OR cn.parent_checked_at < (
                       SELECT MAX(cn2.created_at) FROM concept_nodes cn2
                       WHERE cn2.workspace_id = cn.workspace_id
                     )
                   )",
                rusqlite::params![ws],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
            )
            .ok(),
        "workspace_prompt_bank" => conn
            .query_row(
                "SELECT 1, COALESCE(SUM(LENGTH(m.content)), 0)
                 FROM messages m
                 JOIN chat_sessions cs ON cs.id = m.session_id
                 WHERE cs.workspace_id = ?1
                   AND cs.is_incognito = 0
                   AND cs.exclude_from_analytics = 0
                   AND cs.is_imported = 0",
                rusqlite::params![ws],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
            )
            .ok(),
        _ => None,
    };
    match row {
        Some((count, chars)) if count > 0 && chars > 0 => {
            (Some(count), Some(chars_to_tokens(chars)))
        }
        _ => (None, None),
    }
}

fn model_setting_for_job(job_key: &str) -> &'static str {
    match job_key {
        "memory_extraction" => "memory_extraction_model",
        "summarization" => "summarization_model",
        "flashcard_generation" => "flashcard_model",
        "workspace_glossary" | "hover_definition_scan" => "glossary_model",
        "concept_hierarchy" => "concept_hierarchy_model",
        "workspace_prompt_bank" => "topic_signature_model",
        "workspace_analysis" => "workspace_analysis_model",
        _ => "",
    }
}

fn add_minutes_to_rfc3339(base: Option<&str>, minutes: u32) -> Option<String> {
    let base = base?;
    chrono::DateTime::parse_from_rfc3339(base).ok().map(|date| {
        (date.with_timezone(&chrono::Utc) + chrono::Duration::minutes(minutes as i64)).to_rfc3339()
    })
}

fn add_scheduler_ticks_to_rfc3339(base: Option<&str>, ticks: u32) -> Option<String> {
    add_minutes_to_rfc3339(base, ticks.saturating_mul(SCHEDULER_INTERVAL_MINUTES))
}

pub fn list_scheduled_statuses(
    conn: &rusqlite::Connection,
) -> Result<Vec<InferenceJobStatus>, String> {
    let active_jobs = ACTIVE_JOBS
        .lock()
        .map(|map| map.clone())
        .unwrap_or_default();
    let queued_jobs = MANUAL_QUEUE
        .lock()
        .map(|queue| queue.iter().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let background_enabled =
        crate::commands::settings::get_setting(conn, "background_inference_enabled")
            .map(|value| value == "true")
            .unwrap_or(true);
    let next_check_at = current_next_tick_at();
    let current_workspace = crate::services::model_settings::get_current_workspace_id(conn);
    let aggregate_stats = compute_run_aggregates(conn, current_workspace.as_deref())
        .unwrap_or_default();

    Ok(SCHEDULED_JOB_KEYS
        .iter()
        .map(|job_key| {
            let model_setting = model_setting_for_job(job_key);
            let run_mode = get_run_mode(conn, job_key).as_str().to_string();
            let small_model = if model_setting.is_empty() {
                None
            } else {
                get_model_for_job(conn, model_setting)
            };
            let heavy_model = get_heavy_model(conn, job_key);
            let active = active_jobs.get(*job_key);
            let is_manual_queued = queued_jobs.iter().any(|queued| queued == job_key);
            let is_disabled = !background_enabled || run_mode == "disabled";
            let has_work = background_enabled && run_mode != "disabled" && has_auto_work(conn, job_key);
            let mut state = if is_disabled {
                "disabled".to_string()
            } else if has_work {
                "scheduled".to_string()
            } else {
                "no_eligible_work".to_string()
            };
            let mut due_label = if is_disabled {
                if run_mode == "disabled" {
                    "disabled".to_string()
                } else {
                    "background inference disabled".to_string()
                }
            } else if has_work {
                every_tick_label(1)
            } else {
                "waiting for new messages or sources".to_string()
            };
            let mut next_due_at = None;

            if let Some(job) = active {
                state = if job.status == "queued" {
                    "queued"
                } else {
                    "running"
                }
                .to_string();
                due_label = if job.status == "queued" {
                    "queued to run"
                } else {
                    "running now"
                }
                .to_string();
            } else if is_manual_queued {
                state = "queued".to_string();
                due_label = "queued to run next".to_string();
            } else if background_enabled && has_work {
                match *job_key {
                    "memory_extraction" => {
                        due_label = every_tick_label(MEMORY_TICK_INTERVAL);
                    }
                    "workspace_glossary" => {
                        due_label = every_tick_label(GLOSSARY_TICK_INTERVAL);
                    }
                    "hover_definition_scan" => {
                        due_label = every_tick_label(HOVER_SCAN_TICK_INTERVAL);
                    }
                    "summarization" => {
                        due_label = every_tick_label(SUMMARIZATION_TICK_INTERVAL);
                    }
                    "flashcard_generation" => {
                        due_label = every_tick_label(FLASHCARD_TICK_INTERVAL);
                    }
                    "concept_hierarchy" => {
                        let elapsed =
                            HIERARCHY_TICK.load(Ordering::Relaxed) % HIERARCHY_TICK_INTERVAL;
                        let remaining = if elapsed == 0 {
                            HIERARCHY_TICK_INTERVAL
                        } else {
                            HIERARCHY_TICK_INTERVAL - elapsed
                        };
                        state = if remaining <= 1 {
                            "due_now"
                        } else {
                            "scheduled"
                        }
                        .to_string();
                        due_label = interval_due_label(next_check_at.as_deref(), remaining);
                        next_due_at = add_scheduler_ticks_to_rfc3339(
                            next_check_at.as_deref(),
                            remaining.saturating_sub(1),
                        );
                    }
                    "workspace_prompt_bank" => {
                        let elapsed =
                            PROMPT_BANK_TICK.load(Ordering::Relaxed) % PROMPT_BANK_TICK_INTERVAL;
                        let remaining = if elapsed == 0 {
                            PROMPT_BANK_TICK_INTERVAL
                        } else {
                            PROMPT_BANK_TICK_INTERVAL - elapsed
                        };
                        state = if remaining <= 1 {
                            "due_now"
                        } else {
                            "scheduled"
                        }
                        .to_string();
                        due_label = interval_due_label(next_check_at.as_deref(), remaining);
                        next_due_at = add_scheduler_ticks_to_rfc3339(
                            next_check_at.as_deref(),
                            remaining.saturating_sub(1),
                        );
                    }
                    _ => {}
                }
            }

            let (pending_work_count, pending_input_tokens) =
                pending_workload_for_job(conn, job_key, current_workspace.as_deref());
            let stats = aggregate_stats.get(*job_key).cloned().unwrap_or_default();

            InferenceJobStatus {
                job_key: (*job_key).to_string(),
                label: job_label(job_key).to_string(),
                enabled: background_enabled,
                state,
                run_mode,
                small_model,
                heavy_model,
                next_check_at: next_check_at.clone(),
                next_due_at,
                due_label,
                pending_input_tokens,
                pending_work_count,
                avg_duration_ms: stats.avg_duration_ms,
                avg_input_tokens: stats.avg_input_tokens,
                runs_count: stats.runs_count,
                success_rate: stats.success_rate,
                last_duration_ms: stats.last_duration_ms,
                last_completed_at: stats.last_completed_at,
            }
        })
        .collect())
}

#[derive(Debug, Clone, Default)]
struct JobRunStats {
    avg_duration_ms: Option<f64>,
    avg_input_tokens: Option<f64>,
    runs_count: Option<i64>,
    success_rate: Option<f64>,
    last_duration_ms: Option<i64>,
    last_completed_at: Option<String>,
}

/// Read `inference_job_runs_retention_days` setting (default 30, clamped 1..=365).
fn run_retention_days(conn: &rusqlite::Connection) -> i64 {
    crate::commands::settings::get_setting(conn, "inference_job_runs_retention_days")
        .and_then(|v| v.parse::<i64>().ok())
        .map(|v| v.clamp(1, 365))
        .unwrap_or(30)
}

/// Aggregate per-job run stats over the retention window, scoped to the active
/// workspace. Returns a map from job_key to stats; jobs with no runs are absent.
fn compute_run_aggregates(
    conn: &rusqlite::Connection,
    workspace_id: Option<&str>,
) -> rusqlite::Result<std::collections::HashMap<String, JobRunStats>> {
    let days = run_retention_days(conn);
    let cutoff = format!("-{} days", days);
    let mut stmt = conn.prepare(
        "SELECT job_key, \
                AVG(duration_ms)  AS avg_duration_ms, \
                AVG(input_tokens) AS avg_input_tokens, \
                COUNT(*)          AS runs_count, \
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count, \
                MAX(completed_at) AS last_completed_at \
         FROM inference_job_runs \
         WHERE completed_at IS NOT NULL \
           AND completed_at >= datetime('now', ?1) \
           AND (workspace_id = ?2 OR (?2 IS NULL AND workspace_id IS NULL)) \
         GROUP BY job_key",
    )?;
    let mut out = std::collections::HashMap::new();
    let mut rows = stmt.query(rusqlite::params![cutoff, workspace_id])?;
    while let Some(row) = rows.next()? {
        let job_key: String = row.get(0)?;
        let avg_duration_ms: Option<f64> = row.get(1)?;
        let avg_input_tokens: Option<f64> = row.get(2)?;
        let runs_count: Option<i64> = row.get(3)?;
        let completed_count: Option<i64> = row.get(4)?;
        let last_completed_at: Option<String> = row.get(5)?;
        let success_rate = match (runs_count, completed_count) {
            (Some(r), Some(c)) if r > 0 => Some(c as f64 / r as f64),
            _ => None,
        };
        let last_duration_ms: Option<i64> = conn.query_row(
            "SELECT duration_ms FROM inference_job_runs \
             WHERE job_key = ?1 \
               AND completed_at IS NOT NULL \
               AND (workspace_id = ?2 OR (?2 IS NULL AND workspace_id IS NULL)) \
             ORDER BY completed_at DESC LIMIT 1",
            rusqlite::params![job_key, workspace_id],
            |r| r.get(0),
        ).ok().flatten();
        out.insert(
            job_key,
            JobRunStats {
                avg_duration_ms,
                avg_input_tokens,
                runs_count,
                success_rate,
                last_duration_ms,
                last_completed_at,
            },
        );
    }
    Ok(out)
}

/// Delete runs older than the retention window. Called on app start.
pub fn prune_old_runs(conn: &rusqlite::Connection) -> rusqlite::Result<usize> {
    let days = run_retention_days(conn);
    let cutoff = format!("-{} days", days);
    conn.execute(
        "DELETE FROM inference_job_runs WHERE completed_at < datetime('now', ?1)",
        rusqlite::params![cutoff],
    )
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
        if let Some(existing) = jobs
            .iter_mut()
            .find(|existing| existing.task_type == job.task_type)
        {
            *existing = job;
        } else {
            jobs.push(job);
        }
    }
    Ok(jobs)
}
