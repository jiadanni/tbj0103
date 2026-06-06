use crate::db::DbState;
use crate::ollama::client::{OllamaClient, OllamaMessage};
use crate::services::model_settings::get_model_for_job;

pub const SUMMARY_TYPE_INFO: &str = "info";
pub const SUMMARY_TYPE_EXTENSIVE: &str = "extensive";

pub async fn generate_info_summary(
    state: &DbState,
    session_id: &str,
    workspace_id: &str,
    ollama_url: Option<String>,
) -> Result<(), String> {
    generate_info_summary_with_imported(state, session_id, workspace_id, ollama_url, false).await
}

pub async fn generate_info_summary_with_imported(
    state: &DbState,
    session_id: &str,
    workspace_id: &str,
    ollama_url: Option<String>,
    include_imported: bool,
) -> Result<(), String> {
    generate_summary_with_options(
        state,
        session_id,
        workspace_id,
        SUMMARY_TYPE_INFO,
        ollama_url,
        false,
        include_imported,
    )
    .await
}

pub async fn generate_summary_with_options(
    state: &DbState,
    session_id: &str,
    workspace_id: &str,
    summary_type: &str,
    ollama_url: Option<String>,
    force: bool,
    include_imported: bool,
) -> Result<(), String> {
    if !matches!(summary_type, SUMMARY_TYPE_INFO | SUMMARY_TYPE_EXTENSIVE) {
        return Err(format!("Unsupported summary type: {summary_type}"));
    }

    // Skip imported sessions that haven't received new messages
    {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let is_imported: i64 = conn
            .query_row(
                "SELECT is_imported FROM chat_sessions WHERE id = ?1",
                rusqlite::params![session_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if is_imported != 0 && !include_imported {
            return Ok(());
        }
    }
    // 1. Get messages that need summarization
    let messages: Vec<(String, String, String)> = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, role, content FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
        ).map_err(|e| e.to_string())?;

        let messages = stmt
            .query_map(rusqlite::params![session_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        messages
    };

    let min_messages: usize = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        crate::commands::settings::get_setting(&conn, "summarization_min_messages")
            .and_then(|v| v.parse().ok())
            .unwrap_or(1)
    };

    if messages.len() < min_messages {
        return Ok(());
    }

    // Check if we already have a summary of this type covering this many messages.
    {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let existing_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM conversation_summaries
             WHERE session_id = ?1 AND summary_type = ?2 AND message_range_end >= ?3",
                rusqlite::params![session_id, summary_type, messages.len() as i32],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if !force && existing_count > 0 {
            return Ok(());
        }
    }

    let mut conversation_text = String::new();
    for (_, role, content) in &messages {
        conversation_text.push_str(&format!("{}: {}\n", role, content));
    }

    let Ok(client) = OllamaClient::new(ollama_url) else {
        return Ok(());
    };
    let prompt = match summary_type {
        SUMMARY_TYPE_INFO => format!(
            "Summarize the following conversation as a single concise paragraph of plain prose (no headings, no bullet points, no markdown). \
            Cover the key decisions, topics, and user preferences in flowing sentences. Keep it under 120 words.\n\n\
            Conversation:\n{}",
            conversation_text
        ),
        SUMMARY_TYPE_EXTENSIVE => format!(
            "Write a polished, comprehensive synopsis of the following conversation in plain prose. \
            Explain the user's goals, important context, key decisions, open questions, and actionable next steps. \
            Use 2-4 short paragraphs with no headings, bullet points, or markdown. Keep it under 320 words.\n\n\
            Conversation:\n{}",
            conversation_text
        ),
        _ => unreachable!(),
    };

    let msgs = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];

    // Use the configured background/chat model and skip quietly if none is available.
    let model = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        get_model_for_job(&conn, "summarization_model")
    };

    let Some(model) = model else {
        return Ok(());
    };

    if let Ok(summary_content) = client
        .send_message_with_options("summarization_service", &model, msgs, Some("0s"))
        .await
    {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        if force {
            conn.execute(
                "DELETE FROM conversation_summaries WHERE session_id = ?1 AND summary_type = ?2",
                rusqlite::params![session_id, summary_type],
            )
            .map_err(|e| e.to_string())?;
        }

        conn.execute(
            "INSERT INTO conversation_summaries (id, session_id, workspace_id, summary_type, content, message_range_start, message_range_end, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8)",
            rusqlite::params![
                id,
                session_id,
                workspace_id,
                summary_type,
                summary_content,
                messages.len() as i32,
                now,
                now
            ],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}
