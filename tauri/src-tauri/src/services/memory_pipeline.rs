use rusqlite::Connection;
use crate::models::chat::Message;
use crate::ollama::client::{OllamaClient, OllamaMessage};

/// Auto-extract memories if the session has new unextracted messages.
/// This checks if the session length is a multiple of 5.
pub async fn process_auto_memory_extraction(conn: &Connection, ollama_url: Option<String>) -> Result<(), String> {
    // 1. Find sessions that have messages but haven't been extracted recently
    // For simplicity in Phase 1, we can just look for sessions where message count % 5 == 0
    // and we haven't extracted for the latest message.
    
    // We'll keep track of last extracted message ID in `chat_sessions` or similar.
    // For now, we'll fetch the last 5 messages of active sessions, and if the last one is a user message
    // and we haven't extracted for it, we do it.
    
    // In a real implementation, you'd want a state tracking table.
    // We'll query sessions that have exactly a multiple of 5 messages.
    
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, project_id FROM chat_sessions"
    ).unwrap();
    
    let sessions = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    }).unwrap().filter_map(Result::ok).collect::<Vec<_>>();
    
    for (session_id, workspace_id, _project_id) in sessions {
        let mut msg_stmt = conn.prepare(
            "SELECT id, role, content FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
        ).unwrap();
        
        let messages = msg_stmt.query_map(rusqlite::params![session_id], |row| {
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
        }).unwrap().filter_map(Result::ok).collect::<Vec<_>>();
        
        if !messages.is_empty() && messages.len() % 5 == 0 {
            // Need to ensure we don't repeatedly extract for the same 5 messages.
            // We can check if any memory was created in the last few minutes for this session,
            // or just use a simple heuristic. For now, since we don't have a tracking column,
            // we'll leave the actual extraction loop to be triggered securely.
            // Let's implement the extraction logic itself first.
        }
    }

    Ok(())
}

pub async fn extract_and_store_memories(
    conn: &Connection,
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
                    for fact in facts {
                        let id = uuid::Uuid::new_v4().to_string();
                        let now = chrono::Utc::now().to_rfc3339();
                        
                        // Phase 3: Dedup using cosine similarity. For Phase 1, just insert.
                        let _ = conn.execute(
                            "INSERT INTO memories (id, workspace_id, project_id, content, memory_type, source_session_id, is_pinned, is_active, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, 'fact', ?5, 0, 1, ?6, ?7)",
                            rusqlite::params![id, workspace_id, project_id, fact, session_id, now, now],
                        );
                        
                        // Store dummy embedding for now, or generate actual embedding
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