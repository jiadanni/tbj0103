use crate::db::DbState;
use crate::services::model_settings::get_model_for_job;
use crate::services::{git_sync, memory_pipeline, summarization_service, workspace_glossary};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

static SCHEDULER_RUNNING: AtomicBool = AtomicBool::new(false);
/// Counts scheduler ticks consumed by the concept-hierarchy job so we can
/// gate it to roughly every 5 minutes (5 ticks at the current 60s cadence).
/// Cheap LLM amortisation guard — the job itself is bounded internally too.
static HIERARCHY_TICK: AtomicU32 = AtomicU32::new(0);
const HIERARCHY_TICK_INTERVAL: u32 = 5;

/// Mirror of the TypeScript `BackgroundTaskEvent` interface in api.ts.
#[derive(Debug, Clone, Serialize)]
pub struct BackgroundTaskEvent {
    pub task_type: String,
    pub status: String, // "started" | "processing" | "completed" | "failed"
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

fn emit_task(app: &AppHandle, task_type: &str, status: &str, message: &str, model: Option<String>) {
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
                let mem_model = lookup_job_model(&app, "memory_extraction_model").await;
                emit_task(&app, "memory_extraction", "started", "Extracting memories…", mem_model.clone());
                let mem_result =
                    memory_pipeline::process_auto_memory_extraction(&db, ollama_url.clone()).await;
                emit_task(
                    &app,
                    "memory_extraction",
                    if mem_result.is_ok() { "completed" } else { "failed" },
                    if mem_result.is_ok() { "Memory extraction done" } else { "Memory extraction failed" },
                    mem_model,
                );

                let glossary_model = lookup_job_model(&app, "glossary_model").await;
                emit_task(&app, "workspace_glossary", "started", "Refreshing workspace glossary…", glossary_model.clone());
                let glossary_result = workspace_glossary::refresh_due_workspaces(&db).await;
                emit_task(
                    &app,
                    "workspace_glossary",
                    if glossary_result.is_ok() { "completed" } else { "failed" },
                    if glossary_result.is_ok() {
                        "Workspace glossary refreshed"
                    } else {
                        "Workspace glossary refresh failed"
                    },
                    glossary_model.clone(),
                );

                emit_task(
                    &app,
                    "hover_definition_scan",
                    "started",
                    "Scanning chats for missing definitions…",
                    glossary_model.clone(),
                );
                let scan_result = workspace_glossary::scan_recent_sessions_for_missing_terms(&db).await;
                emit_task(
                    &app,
                    "hover_definition_scan",
                    if scan_result.is_ok() { "completed" } else { "failed" },
                    if scan_result.is_ok() {
                        "Hover definition scan done"
                    } else {
                        "Hover definition scan failed"
                    },
                    glossary_model,
                );

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
                    let summ_model = lookup_job_model(&app, "summarization_model").await;
                    emit_task(&app, "summarization", "started", "Summarizing chats…", summ_model.clone());
                    let mut any_failed = false;
                    for (session_id, workspace_id) in sessions {
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
                    emit_task(
                        &app,
                        "summarization",
                        if any_failed { "failed" } else { "completed" },
                        if any_failed { "Summarization failed" } else { "Summarization done" },
                        summ_model,
                    );
                }

                // 4. Flashcard topic sync + automatic card generation
                let fc_model = lookup_job_model(&app, "flashcard_model").await;
                emit_task(&app, "flashcard_generation", "started", "Generating flashcards…", fc_model.clone());
                let fc_result = crate::services::flashcard_topic_service::tick(&db, ollama_url.clone()).await;
                emit_task(
                    &app,
                    "flashcard_generation",
                    if fc_result.is_ok() { "completed" } else { "failed" },
                    if fc_result.is_ok() { "Flashcard generation done" } else { "Flashcard generation failed" },
                    fc_model,
                );

                // 5. Concept hierarchy — LLM-assisted parent detection.
                //    Gated to every Nth tick so we don't spend ~20 LLM calls
                //    every minute. The job itself caps work per call.
                let hierarchy_tick = HIERARCHY_TICK.fetch_add(1, Ordering::Relaxed) + 1;
                if hierarchy_tick.is_multiple_of(HIERARCHY_TICK_INTERVAL) {
                    let ch_model = lookup_job_model(&app, "concept_hierarchy_model").await;
                    emit_task(
                        &app,
                        "concept_hierarchy",
                        "started",
                        "Linking related topics…",
                        ch_model.clone(),
                    );
                    let ch_result =
                        crate::services::concept_hierarchy_service::tick(&db, ollama_url.clone())
                            .await;
                    let (status, message) = match &ch_result {
                        Ok(report) => (
                            "completed",
                            format!(
                                "Topic linking done ({} considered, {} linked)",
                                report.considered, report.linked
                            ),
                        ),
                        Err(_) => ("failed", "Topic linking failed".to_string()),
                    };
                    emit_task(&app, "concept_hierarchy", status, &message, ch_model);
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
