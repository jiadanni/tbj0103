use crate::db::DbState;
use crate::models::chat::Message;
use crate::ollama::client::{OllamaClient, OllamaMessage};
use crate::services::model_settings::{get_configured_chat_model, get_embedding_model};

/// Auto-extract memories if the session has new unextracted messages.
/// This checks if the session length is a multiple of 5.
pub async fn process_auto_memory_extraction(state: &DbState, ollama_url: Option<String>) -> Result<(), String> {
    let sessions = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        // Only process sessions updated in the last 5 minutes that are not private.
        let mut stmt = conn.prepare(
            "SELECT id, workspace_id, project_id FROM chat_sessions 
             WHERE updated_at > datetime('now', '-5 minutes') 
             AND is_incognito = 0
             AND exclude_from_analytics = 0"
        ).unwrap();
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

    let Ok(client) = OllamaClient::new(ollama_url) else {
        return Ok(());
    };
    
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
    
    // Use the configured background/chat model and skip quietly if none is available.
    let model = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        get_configured_chat_model(&conn)
    };

    let embedding_model = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        get_embedding_model(&conn)
    };

    let Some(model) = model else {
        return Ok(());
    };
    let Some(embedding_model) = embedding_model else {
        return Ok(());
    };

    if let Ok(response) = client.send_message(&model, msgs).await {
        // Parse JSON
        if let Some(start) = response.find('[') {
            if let Some(end) = response.rfind(']') {
                let json_str = &response[start..=end];
                if let Ok(facts) = serde_json::from_str::<Vec<String>>(json_str) {
                    for fact in facts {
                        // 1. Generate embedding for the new fact
                        let embedding = if let Ok(emb) = client.generate_embedding(&embedding_model, &fact).await {
                            emb
                        } else {
                            // Fallback to dummy if embedding fails, or skip
                            continue;
                        };

                        let conn = state.0.lock().map_err(|e| e.to_string())?;
                        
                        // 2. Semantic Deduplication: Check against existing memories in this workspace
                        let mut stmt = conn.prepare(
                            "SELECT me.embedding FROM memory_embeddings me 
                             JOIN memories m ON me.memory_id = m.id 
                             WHERE m.workspace_id = ?1"
                        ).unwrap();
                        
                        let mut is_duplicate = false;
                        if let Ok(iter) = stmt.query_map(rusqlite::params![workspace_id], |row| {
                            let bytes: Vec<u8> = row.get(0)?;
                            Ok(crate::services::vector_index::bytes_to_f32_vec(&bytes))
                        }) {
                            for existing_emb in iter.flatten() {
                                let similarity = crate::services::vector_index::cosine_similarity(&embedding, &existing_emb);
                                if similarity > 0.85 {
                                    is_duplicate = true;
                                    break;
                                }
                            }
                        }

                        if is_duplicate {
                            continue;
                        }

                        // 3. Insert if unique
                        let id = uuid::Uuid::new_v4().to_string();
                        let now = chrono::Utc::now().to_rfc3339();
                        
                        let _ = conn.execute(
                            "INSERT INTO memories (id, workspace_id, project_id, content, memory_type, scope, source_session_id, is_pinned, is_active, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, 'fact', 'workspace', ?5, 0, 1, ?6, ?7)",
                            rusqlite::params![id, workspace_id, project_id, fact, session_id, now, now],
                        );
                        
                        let embedding_bytes = crate::services::vector_index::f32_vec_to_bytes(&embedding);
                        let _ = conn.execute(
                            "INSERT INTO memory_embeddings (memory_id, embedding, model, created_at)
                             VALUES (?1, ?2, ?3, ?4)",
                            rusqlite::params![id, embedding_bytes, embedding_model, now],
                        );
                    }
                }
            }
        }
    }

    Ok(())
}
