use crate::db::DbState;
use crate::models::summary::ConversationSummary;
use crate::services::summarization_service::generate_summary_with_options;
use tauri::State;

#[tauri::command]
pub async fn generate_summary(
    state: State<'_, DbState>,
    session_id: String,
    workspace_id: String,
    summary_type: String,
    force: Option<bool>,
) -> Result<(), String> {
    let ollama_url = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT value FROM settings WHERE key = 'ollama_base_url'",
            [],
            |row| row.get::<_, String>(0),
        )
        .map(|v| v.trim_matches('"').to_string())
        .unwrap_or_else(|_| "http://localhost:11434".to_string())
    };

    generate_summary_with_options(
        &state,
        &session_id,
        &workspace_id,
        &summary_type,
        Some(ollama_url),
        force.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub fn list_summaries(
    state: State<'_, DbState>,
    session_id: String,
) -> Result<Vec<ConversationSummary>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, workspace_id, summary_type, content, key_topics, 
                message_range_start, message_range_end, token_count, created_at, updated_at 
         FROM conversation_summaries WHERE session_id = ?1 ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let summaries = stmt
        .query_map(rusqlite::params![session_id], |row| {
            Ok(ConversationSummary {
                id: row.get(0)?,
                session_id: row.get(1)?,
                workspace_id: row.get(2)?,
                summary_type: row.get(3)?,
                content: row.get(4)?,
                key_topics: row.get(5)?,
                message_range_start: row.get(6)?,
                message_range_end: row.get(7)?,
                token_count: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    Ok(summaries)
}
