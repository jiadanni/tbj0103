use crate::db::DbState;
use crate::models::chat::Message;
use crate::ollama::client::{OllamaClient, OllamaMessage};

/// Auto-extract memories if the session has new unextracted messages.
/// This checks if the session length is a multiple of 5.
pub async fn process_auto_memory_extraction(state: &DbState, ollama_url: Option<String>) -> Result<(), String> {
    let sessions = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT id, workspace_id, project_id FROM chat_sessions").unwrap();
        stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        }).unwrap().filter_map(Result::ok).collect::<Vec<_>>()
    };

    for (session_id, workspace_id, project_id) in sessions {
        let messages = {
            let conn = state.0.lock().map_err(|e| e.to_string())?;
            let mut msg_stmt = conn.prepare(
                "SELECT id, role, content FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
            ).unwrap();
            
            msg_stmt.query_map(rusqlite::params![session_id], |row| {
                Ok(Message {
                    id: row.get(0)?,
                    session_id: session_id.clone(),
                    role: row.get::<_, String>(1)?.parse().unwrap_or(crate::models::chat::MessageRole::User),
                    content: row.get(2)?,
                    model_name: Some("".to_string()),
                    tokens_used: None,
                    duration_ms: None,
                    created_at: "".to_string(),
                })
            }).unwrap().filter_map(Result::ok).collect::<Vec<_>>()
        };

        if !messages.is_empty() && messages.len() % 5 == 0 {
            extract_and_store_memories(state, &workspace_id, &project_id, &session_id, &messages, ollama_url.clone()).await?;
        }
    }

    Ok(())
}

pub async fn extract_and_store_memories(
    state: &DbState,
    workspace_id: &str,
    project_id: &str,
    session_id: &str,
    recent_messages: &[Message],
    ollama_url: Option<String>,
) -> Result<(), String> {
    if recent_messages.is_empty() { return Ok(()); }

    let client = OllamaClient::new(ollama_url);
    
    let mut conversation_text = String::new();
    for msg in recent_messages {
        conversation_text.push_str(&format!("{}: {}\n", msg.role, msg.content));
    }

    let prompt = format!(
        "Extract any important facts, preferences, or context about the user from the following conversation.\n\
        Format as a JSON list of strings. Only include facts that are meant to be remembered long-term.\n\
        If there is nothing to remember, return an empty list [].\n\n\
        Conversation:\n{}",
        conversation_text
    );

    let msgs = vec![OllamaMessage { role: "user".to_string(), content: prompt }];
    
    // Call Ollama using a fast/cheap model or default
    if let Ok(response) = client.send_message("llama3.2", msgs).await {
        // Parse JSON
        if let Some(start) = response.find('[') {
            if let Some(end) = response.rfind(']') {
                let json_str = &response[start..=end];
                if let Ok(facts) = serde_json::from_str::<Vec<String>>(json_str) {
                    let conn = state.0.lock().map_err(|e| e.to_string())?;
                    for fact in facts {
                        let id = uuid::Uuid::new_v4().to_string();
                        let now = chrono::Utc::now().to_rfc3339();
                        
                        let _ = conn.execute(
                            "INSERT INTO memories (id, workspace_id, project_id, content, memory_type, source_session_id, is_pinned, is_active, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, 'fact', ?5, 0, 1, ?6, ?7)",
                            rusqlite::params![id, workspace_id, project_id, fact, session_id, now, now],
                        );
                        
                        let dummy_embedding: Vec<f32> = vec![0.0; 768];
                        let embedding_bytes: Vec<u8> = dummy_embedding.iter().flat_map(|f| f.to_le_bytes()).collect();
                        
                        let _ = conn.execute(
                            "INSERT INTO memory_embeddings (memory_id, embedding, model, created_at)
                             VALUES (?1, ?2, 'nomic-embed-text', ?3)",
                            rusqlite::params![id, embedding_bytes, now],
                        );
                    }
                }
            }
        }
    }

    Ok(())
}