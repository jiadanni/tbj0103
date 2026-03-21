use std::time::Duration;
use tauri::{AppHandle, Manager};
use crate::db::DbState;
use crate::services::{memory_pipeline, summarization_service};

pub fn start_scheduler(app: AppHandle) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        
        loop {
            interval.tick().await;
            
            let db = app.state::<DbState>();
            let ollama_url = Some("http://localhost:11434".to_string()); // Default
            
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
        }
    });
}
