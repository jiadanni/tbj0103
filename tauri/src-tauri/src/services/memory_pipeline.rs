use crate::db::DbState;
use crate::models::chat::Message;
use crate::ollama::client::{OllamaClient, OllamaMessage};
use crate::services::model_settings::{get_configured_chat_model, get_embedding_model};

/// Read a configurable threshold from settings (default: 5).
fn get_extraction_threshold(state: &DbState) -> usize {
    let conn = match state.0.get() {
        Ok(c) => c,
        Err(_) => return 5,
    };
    crate::commands::settings::get_setting(&conn, "memory_extraction_threshold")
        .and_then(|v| v.parse().ok())
        .unwrap_or(5)
}

/// Read a configurable idle window from settings (default: 5 minutes).
fn get_extraction_idle_minutes(state: &DbState) -> u32 {
    let conn = match state.0.get() {
        Ok(c) => c,
        Err(_) => return 5,
    };
    crate::commands::settings::get_setting(&conn, "memory_extraction_idle_minutes")
        .and_then(|v| v.parse().ok())
        .unwrap_or(5)
}

/// Auto-extract memories if the session has new unextracted messages.
pub async fn process_auto_memory_extraction(
    state: &DbState,
    ollama_url: Option<String>,
) -> Result<(), String> {
    let threshold = get_extraction_threshold(state);
    let idle_minutes = get_extraction_idle_minutes(state);
    let sessions = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let sql = format!(
            "SELECT id, workspace_id, project_id, last_processed_message_count FROM chat_sessions \
             WHERE datetime(updated_at) > datetime('now', '-{} minutes') \
             AND is_incognito = 0 \
             AND exclude_from_analytics = 0 \
             AND is_imported = 0 \
             ORDER BY updated_at DESC \
             LIMIT 5",
            idle_minutes
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let sessions = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
        sessions
    };

    for (session_id, workspace_id, project_id, last_count) in sessions {
        let messages = {
            let conn = state.0.get().map_err(|e| e.to_string())?;
            let mut msg_stmt = conn.prepare(
                "SELECT id, role, content FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
            ).map_err(|e| e.to_string())?;

            let messages = msg_stmt
                .query_map(rusqlite::params![session_id], |row| {
                    Ok(Message {
                        id: row.get(0)?,
                        session_id: session_id.clone(),
                        role: row
                            .get::<_, String>(1)?
                            .parse()
                            .unwrap_or(crate::models::chat::MessageRole::User),
                        content: row.get(2)?,
                        model_name: Some("".to_string()),
                        tokens_used: None,
                        duration_ms: None,
                        variant_group_id: None,
                        created_at: "".to_string(),
                    })
                })
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            messages
        };

        if !messages.is_empty()
            && messages.len() >= threshold
            && messages.len() > last_count as usize
            && extract_and_store_memories(
                state,
                &workspace_id,
                &project_id,
                &session_id,
                &messages,
                ollama_url.clone(),
            )
            .await
            .is_ok()
        {
            if let Ok(conn) = state.0.get() {
                let _ = conn.execute(
                    "UPDATE chat_sessions SET last_processed_message_count = ?1 WHERE id = ?2",
                    rusqlite::params![messages.len() as i64, session_id],
                );
            }
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
    if recent_messages.is_empty() {
        return Ok(());
    }

    let Ok(client) = OllamaClient::new(ollama_url) else {
        return Ok(());
    };

    let mut conversation_text = String::new();
    for msg in recent_messages {
        // Only include user messages to prevent the LLM from parroting assistant responses
        if msg.role == crate::models::chat::MessageRole::User {
            conversation_text.push_str(&format!("User: {}\n", msg.content));
        }
    }

    let prompt = format!(
        "You are a memory extraction system. Read the user's messages below and extract ONLY short statements about the user.\n\n\
        OUTPUT FORMAT: A JSON array of objects, each with \"type\" (\"fact\" or \"preference\") and \"content\" (string).\n\n\
        TYPES:\n\
        - \"fact\": Objective information about the user (what they know, own, do, are working on, their background).\n\
        - \"preference\": How the user wants to be communicated with or what they prefer.\n\n\
        RULES:\n\
        - Each \"content\" must be a single concise sentence (under 20 words).\n\
        - Write statements ABOUT THE USER, not explanations of topics.\n\
        - NEVER copy or paraphrase AI assistant responses.\n\
        - NEVER include explanations, definitions, or educational content.\n\
        - NEVER start with \"You are\", \"That's\", \"Great\", \"Let me\", \"Here's\", \"I \", \"In Python\", \"The\".\n\
        - Good fact: \"User is learning Python\"\n\
        - Good fact: \"User has an M1 MacBook Pro\"\n\
        - Good preference: \"User prefers concise explanations\"\n\
        - Bad: \"In Python, keyword arguments are evaluated before positional arguments.\"\n\
        - Bad: \"You are absolutely correct about function call semantics.\"\n\
        - Bad: \"The user asked about Python.\"\n\
        - If there is nothing worth remembering, return []\n\n\
        User messages:\n{}\n\n\
        Output ONLY a JSON array, nothing else. Example: [{{\"type\":\"fact\",\"content\":\"User is studying machine learning\"}}]",
        conversation_text
    );

    let msgs = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];

    // Fetch model config and existing embeddings in a SINGLE lock acquisition
    let (model, embedding_model, existing_embeddings) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let model = get_configured_chat_model(&conn);
        let emb_model = get_embedding_model(&conn);

        // Pre-fetch all existing memory embeddings for dedup (avoids per-fact lock)
        let existing: Vec<Vec<f32>> = conn
            .prepare(
                "SELECT me.embedding FROM memory_embeddings me 
             JOIN memories m ON me.memory_id = m.id 
             WHERE m.workspace_id = ?1",
            )
            .ok()
            .map(|mut stmt| {
                stmt.query_map(rusqlite::params![workspace_id], |row| {
                    let bytes: Vec<u8> = row.get(0)?;
                    Ok(crate::services::vector_index::bytes_to_f32_vec(&bytes))
                })
                .ok()
                .map(|iter| iter.flatten().collect::<Vec<_>>())
                .unwrap_or_default()
            })
            .unwrap_or_default();

        (model, emb_model, existing)
    }; // DB lock released here

    let Some(model) = model else {
        return Ok(());
    };
    let Some(embedding_model) = embedding_model else {
        return Ok(());
    };

    if let Ok(response) = client
        .send_message_with_options("memory_pipeline", &model, msgs, Some("0s"))
        .await
    {
        // Parse structured JSON: [{"type":"fact"|"preference","content":"..."}]
        if let Some(start) = response.find('[') {
            if let Some(end) = response.rfind(']') {
                let json_str = &response[start..=end];

                #[derive(serde::Deserialize)]
                struct ExtractedItem {
                    #[serde(rename = "type")]
                    memory_type: Option<String>,
                    content: Option<String>,
                }

                // Try structured format first, fall back to plain strings
                let items: Vec<(String, String)> = if let Ok(structured) = serde_json::from_str::<Vec<ExtractedItem>>(json_str) {
                    structured.into_iter().filter_map(|item| {
                        let content = item.content?;
                        let mem_type = match item.memory_type.as_deref() {
                            Some("preference") => "preference".to_string(),
                            _ => "fact".to_string(),
                        };
                        Some((content, mem_type))
                    }).collect()
                } else if let Ok(plain) = serde_json::from_str::<Vec<String>>(json_str) {
                    plain.into_iter().map(|s| (s, "fact".to_string())).collect()
                } else {
                    vec![]
                };

                // Post-extraction validation: reject assistant-like content
                let validated: Vec<(String, String)> = items.into_iter().filter(|(content, _)| {
                    let trimmed = content.trim();
                    let word_count = trimmed.split_whitespace().count();

                    // Reject overly long statements (likely paraphrased responses)
                    if word_count > 30 { return false; }

                    // Reject empty or trivial
                    if word_count < 3 { return false; }

                    // Reject statements starting with common assistant phrases
                    let lower = trimmed.to_lowercase();
                    let bad_prefixes = [
                        "you are", "that's", "great ", "let me", "here's", "i can",
                        "i will", "i'll", "in python", "in rust", "in javascript",
                        "the ", "this is", "sure,", "of course", "absolutely",
                        "certainly", "indeed", "note that", "remember that",
                        "it's worth", "it is worth", "keep in mind",
                    ];
                    if bad_prefixes.iter().any(|p| lower.starts_with(p)) { return false; }

                    // Reject if it contains a question mark (likely a question, not a fact)
                    if trimmed.contains('?') { return false; }

                    true
                }).collect();

                // Generate embeddings and check dedup OUTSIDE the lock
                let mut new_memories: Vec<(String, String, String, Vec<u8>)> = Vec::new();
                for (content, memory_type) in validated {
                    let embedding = if let Ok(emb) = client
                        .generate_embedding_with_options("memory_pipeline", &embedding_model, &content, Some("0s"))
                        .await
                    {
                        emb
                    } else {
                        continue;
                    };

                    // Semantic deduplication — CPU work with NO lock held
                    let is_duplicate = existing_embeddings.iter().any(|existing_emb| {
                        crate::services::vector_index::cosine_similarity(
                            &embedding,
                            existing_emb,
                        ) > 0.85
                    });

                    if !is_duplicate {
                        let embedding_bytes =
                            crate::services::vector_index::f32_vec_to_bytes(&embedding);
                        new_memories.push((
                            content,
                            memory_type,
                            uuid::Uuid::new_v4().to_string(),
                            embedding_bytes,
                        ));
                    }
                }

                // Write all new memories in a SINGLE lock + transaction
                if !new_memories.is_empty() {
                    let conn = state.0.get().map_err(|e| e.to_string())?;
                    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
                    let now = chrono::Utc::now().to_rfc3339();
                    for (content, memory_type, id, embedding_bytes) in &new_memories {
                        let _ = conn.execute(
                            "INSERT INTO memories (id, workspace_id, project_id, content, memory_type, scope, source_session_id, is_pinned, is_active, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, 'workspace', ?6, 0, 1, ?7, ?8)",
                            rusqlite::params![id, workspace_id, project_id, content, memory_type, session_id, now, now],
                        );
                        let _ = conn.execute(
                            "INSERT INTO memory_embeddings (memory_id, embedding, model, created_at)
                             VALUES (?1, ?2, ?3, ?4)",
                            rusqlite::params![id, embedding_bytes, embedding_model, now],
                        );
                    }
                    let _ = conn.execute_batch("COMMIT");

                    // Auto-regenerate workspace summary if it's auto-generated
                    let should_regen: bool = conn
                        .query_row(
                            "SELECT is_auto_generated FROM memory_summaries WHERE scope = 'workspace' AND workspace_id = ?1",
                            rusqlite::params![workspace_id],
                            |row| row.get::<_, i32>(0).map(|v| v != 0),
                        )
                        .unwrap_or(true); // If no summary exists yet, generate one

                    if should_regen {
                        // Trigger summary regeneration (best-effort, don't fail extraction)
                        let _ = auto_regenerate_summary(state, "workspace", Some(workspace_id), &client, &model).await;
                    }
                }
            }
        }
    }

    Ok(())
}

/// Best-effort summary regeneration after new memories are extracted.
async fn auto_regenerate_summary(
    state: &DbState,
    scope: &str,
    workspace_id: Option<&str>,
    client: &OllamaClient,
    model: &str,
) -> Result<(), String> {
    // Gather facts + preferences
    let memories: Vec<(String, String)> = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut items = Vec::new();
        if scope == "global" {
            let mut stmt = conn.prepare(
                "SELECT content, memory_type FROM memories WHERE scope = 'global' AND is_active = 1 ORDER BY created_at ASC"
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }).map_err(|e| e.to_string())?;
            items = rows.flatten().collect();
        } else if let Some(ws_id) = workspace_id {
            let mut stmt = conn.prepare(
                "SELECT content, memory_type FROM memories WHERE scope = 'workspace' AND workspace_id = ?1 AND is_active = 1 ORDER BY created_at ASC"
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(rusqlite::params![ws_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }).map_err(|e| e.to_string())?;
            items = rows.flatten().collect();
        }
        items
    };

    if memories.is_empty() {
        return Ok(());
    }

    let facts_text: Vec<String> = memories.iter()
        .filter(|(_, t)| t == "fact")
        .map(|(c, _)| format!("- {}", c))
        .collect();
    let prefs_text: Vec<String> = memories.iter()
        .filter(|(_, t)| t == "preference")
        .map(|(c, _)| format!("- {}", c))
        .collect();

    let mut context = String::new();
    if !facts_text.is_empty() {
        context.push_str("Facts:\n");
        context.push_str(&facts_text.join("\n"));
        context.push('\n');
    }
    if !prefs_text.is_empty() {
        context.push_str("\nPreferences:\n");
        context.push_str(&prefs_text.join("\n"));
        context.push('\n');
    }

    let prompt = format!(
        "Write a concise summary paragraph (under 100 words) about this person based on the following facts and preferences. \
        Write in third person. Be direct and factual. Do not add information that isn't in the facts.\n\n{}\n\nOutput ONLY the summary paragraph, nothing else.",
        context
    );

    let msgs = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];

    let summary_text = client
        .send_message_with_options("memory_summary", model, msgs, Some("0s"))
        .await
        .map_err(|e| e.to_string())?;

    let conn = state.0.get().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO memory_summaries (id, scope, workspace_id, content, is_auto_generated, generated_at, edited_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, NULL)
         ON CONFLICT(scope, workspace_id) DO UPDATE SET content = excluded.content, is_auto_generated = 1, generated_at = excluded.generated_at, edited_at = NULL",
        rusqlite::params![id, scope, workspace_id, summary_text.trim(), now],
    ).map_err(|e| e.to_string())?;

    Ok(())
}
