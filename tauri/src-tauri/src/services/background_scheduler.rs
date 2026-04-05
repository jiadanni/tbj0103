use crate::db::DbState;
use crate::services::{git_sync, memory_pipeline, summarization_service};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};

static SCHEDULER_RUNNING: AtomicBool = AtomicBool::new(false);

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
                let _ =
                    memory_pipeline::process_auto_memory_extraction(&db, ollama_url.clone()).await;

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

                for (session_id, workspace_id) in sessions {
                    let _ = summarization_service::generate_rolling_summary(
                        &db,
                        &session_id,
                        &workspace_id,
                        ollama_url.clone(),
                    )
                    .await;
                }
            }

            // 3. Git sync — every 10 ticks (5 minutes at 30s interval)
            if git_sync_tick % 10 == 0 {
                let (sync_enabled, remote_url) =
                    {
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
                                let url = conn.query_row(
                                "SELECT value FROM settings WHERE key = 'git_sync_remote_url'", [],
                                |r| r.get::<_, String>(0)
                            ).unwrap_or_default();
                                (enabled, url)
                            }
                            Err(_) => (false, String::new()),
                        }
                    };

                if sync_enabled && !remote_url.is_empty() {
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
                        }
                    }
                }
            }

            SCHEDULER_RUNNING.store(false, Ordering::SeqCst);
        }
    });
}
