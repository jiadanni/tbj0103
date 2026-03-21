use crate::db::DbState;
use crate::models::summary::ConversationSummary;
use crate::ollama::client::{OllamaClient, OllamaMessage};

pub async fn generate_rolling_summary(
    state: &DbState,
    session_id: &str,
    workspace_id: &str,
    ollama_url: Option<String>,
) -> Result<(), String> {
    // 1. Get messages that need summarization
    let messages: Vec<(String, String, String)> = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, role, content FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
        ).unwrap();
        
        stmt.query_map(rusqlite::params![session_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        }).unwrap().filter_map(Result::ok).collect()
    };

    if messages.len() < 10 {
        return Ok(());
    }

    let mut conversation_text = String::new();
    for (_, role, content) in &messages {
        conversation_text.push_str(&format!("{}: {}\n", role, content));
    }

    let client = OllamaClient::new(ollama_url);
    let prompt = format!(
        "Summarize the following conversation concisely. Focus on key decisions, topics, and user preferences.\n\n\
        Conversation:\n{}",
        conversation_text
    );

    let msgs = vec![OllamaMessage { role: "user".to_string(), content: prompt }];
    
    if let Ok(summary_content) = client.send_message("llama3.2", msgs).await {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        
        conn.execute(
            "INSERT INTO conversation_summaries (id, session_id, workspace_id, summary_type, content, message_range_start, message_range_end, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'rolling', ?4, 0, ?5, ?6, ?7)",
            rusqlite::params![id, session_id, workspace_id, summary_content, messages.len() as i32, now, now],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}
