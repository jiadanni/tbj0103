use std::time::Duration;
use tauri::{AppHandle, Manager};
use crate::db::DbState;
use crate::services::{memory_pipeline, summarization_service, git_sync};

pub fn start_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        let mut git_sync_tick: u32 = 0;

        loop {
            interval.tick().await;
            git_sync_tick += 1;

            // L5: Before processing, check if user is actively streaming to avoid concurrent Ollama calls
            let is_streaming = {
                let abort_state = app.state::<crate::commands::ollama::StreamAbortState>();
                let map = abort_state.0.lock().unwrap();
                !map.is_empty()
            };
            if is_streaming { continue; }
            
            let db = app.state::<DbState>();
            
            // L4: Read Ollama URL from settings
            let ollama_url = {
                let conn = db.0.lock().unwrap();
                conn.query_row("SELECT value FROM settings WHERE key = 'ollama_base_url'", [], |row| row.get::<_, String>(0))
                    .map(|v| v.trim_matches('"').to_string())
                    .ok()
            };
            
            // 1. Process memory extraction
            let _ = memory_pipeline::process_auto_memory_extraction(&db, ollama_url.clone()).await;

            // 2. Process summarization
            let sessions = {
                let conn = db.0.lock().unwrap();
                let mut stmt = conn.prepare("SELECT id, workspace_id FROM chat_sessions").unwrap();
                stmt.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                }).unwrap().filter_map(Result::ok).collect::<Vec<_>>()
            };

            for (session_id, workspace_id) in sessions {
                let _ = summarization_service::generate_rolling_summary(&db, &session_id, &workspace_id, ollama_url.clone()).await;
            }

            // 3. Git sync — every 10 ticks (5 minutes at 30s interval)
            if git_sync_tick.is_multiple_of(10) {
                let (sync_enabled, remote_url) = {
                    let conn = db.0.lock().unwrap();
                    let enabled = conn.query_row(
                        "SELECT value FROM settings WHERE key = 'git_sync_enabled'", [],
                        |r| r.get::<_, String>(0)
                    ).unwrap_or_default() == "true";
                    let url = conn.query_row(
                        "SELECT value FROM settings WHERE key = 'git_sync_remote_url'", [],
                        |r| r.get::<_, String>(0)
                    ).unwrap_or_default();
                    (enabled, url)
                };

                if sync_enabled && !remote_url.is_empty() {
                    if let Ok(app_dir) = app.path().app_data_dir() {
                        if git_sync::ensure_repo(&app_dir, &remote_url).is_ok() {
                            let result = git_sync::sync(&app_dir);
                            let now = chrono::Utc::now().to_rfc3339();
                            let conn = db.0.lock().unwrap();
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
    });
}
