use crate::db::DbState;
use crate::services::{git_sync, memory_pipeline, summarization_service};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

static SCHEDULER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Mirror of the TypeScript `BackgroundTaskEvent` interface in api.ts.
#[derive(Debug, Clone, Serialize)]
pub struct BackgroundTaskEvent {
    pub task_type: String,
    pub status: String, // "started" | "processing" | "completed" | "failed"
    pub message: String,
}

fn emit_task(app: &AppHandle, task_type: &str, status: &str, message: &str) {
    let _ = app.emit(
        "background_task",
        BackgroundTaskEvent {
            task_type: task_type.to_string(),
            status: status.to_string(),
            message: message.to_string(),
        },
    );
}

pub fn start_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        let mut git_sync_tick: u32 = 0;

        loop {
            interval.tick().await;
            git_sync_tick += 1;

            // Guard: skip this tick if the previous one is still running
            if SCHEDULER_RUNNING
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                continue;
            }

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
                if let Ok(conn) = db.0.get() {
                    let count: i64 = conn.query_row(
                        "SELECT COUNT(*) FROM chat_sessions WHERE datetime(last_accessed_at) >= datetime('now', '-5 minutes')",
                        [],
                        |row| row.get(0),
                    ).unwrap_or(0);
                    count > 0
                } else {
                    false
                }
            };

            // Read Ollama URL from settings
            let ollama_url = {
                match db.0.get() {
                    Ok(conn) => conn
                        .query_row(
                            "SELECT value FROM settings WHERE key = 'ollama_base_url'",
                            [],
                            |row| row.get::<_, String>(0),
                        )
                        .map(|v| v.trim_matches('"').to_string())
                        .ok(),
                    Err(_) => None,
                }
            };

            // If user is NOT chatting, run AI tasks
            if !is_streaming && !is_active_chatting {
                // 1. Process memory extraction
                emit_task(&app, "memory_extraction", "started", "Extracting memories…");
                let mem_result =
                    memory_pipeline::process_auto_memory_extraction(&db, ollama_url.clone()).await;
                emit_task(
                    &app,
                    "memory_extraction",
                    if mem_result.is_ok() { "completed" } else { "failed" },
                    if mem_result.is_ok() { "Memory extraction done" } else { "Memory extraction failed" },
                );

                // 2. Process summarization — only sessions with recent activity
                let sessions = {
                    match db.0.get() {
                        Ok(conn) => {
                            match conn.prepare(
                                "SELECT cs.id, cs.workspace_id FROM chat_sessions cs
                                 WHERE datetime(cs.updated_at) > datetime('now', '-5 minutes')
                                   AND cs.is_incognito = 0
                                   AND cs.exclude_from_analytics = 0
                                   AND cs.is_imported = 0
                                 ORDER BY cs.updated_at DESC
                                 LIMIT 5",
                            ) {
                                Ok(mut stmt) => stmt
                                    .query_map([], |row| {
                                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                                    })
                                    .map(|rows| rows.filter_map(Result::ok).collect::<Vec<_>>())
                                    .unwrap_or_default(),
                                Err(_) => Vec::new(),
                            }
                        }
                        Err(_) => Vec::new(),
                    }
                };

                if !sessions.is_empty() {
                    emit_task(&app, "summarization", "started", "Summarizing chats…");
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
                    );
                }
            }

            // 3. Git sync — every 10 ticks (5 minutes at 30s interval)
            if git_sync_tick % 10 == 0 {
                let (sync_enabled, remote_url) = {
                    match db.0.get() {
                        Ok(conn) => {
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
                        }
                        Err(_) => (false, String::new()),
                    }
                };

                if sync_enabled && !remote_url.is_empty() {
                    emit_task(&app, "git_sync", "started", "Syncing to Git…");
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
                            if let Ok(conn) = db.0.get() {
                                let set = |key: &str, val: &str| {
                                    let _ = conn.execute(
                                        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                                        rusqlite::params![key, val],
                                    );
                                };
                                if result.error.is_none() && !result.conflict {
                                    set("git_sync_last_synced_at", &now);
                                    set("git_sync_last_error", "");
                                } else if let Some(err) = result.error {
                                    set("git_sync_last_error", &err);
                                }
                            }
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
                    );
                }
            }

            SCHEDULER_RUNNING.store(false, Ordering::SeqCst);
        }
    });
}
