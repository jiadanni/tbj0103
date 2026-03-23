use rusqlite::Connection;
use crate::models::context::{TokenBudget, ContextSources};
use crate::ollama::client::OllamaMessage;
use crate::services::vector_index;

const MEMORY_SIMILARITY_THRESHOLD: f32 = 0.3;
const MEMORY_RETRIEVAL_TOP_K: usize = 5;

pub fn budget_for_context_window(context_size: usize) -> TokenBudget {
    let safe_total = (context_size as f64 * 0.90) as usize; // 10% safety margin
    let reserved_for_response = safe_total.min(2048);
    let usable = safe_total.saturating_sub(reserved_for_response);

    TokenBudget {
        system_prompt: (usable as f64 * 0.10) as usize,
        memories: (usable as f64 * 0.10) as usize,
        artifacts: (usable as f64 * 0.10) as usize,
        summaries: (usable as f64 * 0.15) as usize,
        conversation: (usable as f64 * 0.45) as usize,
        rag_context: (usable as f64 * 0.10) as usize,
    }
}

pub fn estimate_tokens(text: &str) -> usize {
    text.len() / 4 // 1 token ≈ 4 chars
}

pub fn assemble_context(
    conn: &Connection,
    workspace_id: &str,
    session_id: &str,
    _model_name: &str,
    _options: &std::collections::HashMap<String, serde_json::Value>,
    query_embedding: Option<&[f32]>,
) -> Result<(Vec<OllamaMessage>, ContextSources), String> {
    // Basic budget, default to 8192 if unknown
    // Note: Querying Ollama /api/show for num_ctx can be added later
    let context_size = 8192;
    let budget = budget_for_context_window(context_size);
    let mut sources = ContextSources {
        memories_used: vec![],
        artifacts_used: vec![],
        summaries_used: vec![],
        documents_used: vec![],
    };

    let mut final_messages: Vec<OllamaMessage> = vec![];

    // 1. System Prompt (order: global → workspace → project → session)
    let mut system_parts = vec![];

    // Global prompt instructions from settings
    {
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = 'prompt_instructions'").unwrap();
        if let Ok(val) = stmt.query_row([], |row| row.get::<_, String>(0)) {
            let text: String = serde_json::from_str(&val).unwrap_or_default();
            if !text.is_empty() {
                system_parts.push(text);
            }
        }
    }

    // Workspace-level prompt instructions
    {
        let mut stmt = conn.prepare("SELECT prompt_instructions FROM workspaces WHERE id = ?1").unwrap();
        if let Ok(instr) = stmt.query_row(rusqlite::params![workspace_id], |row| row.get::<_, String>(0)) {
            if !instr.is_empty() {
                system_parts.push(instr);
            }
        }
    }

    // Load project custom instructions if session is linked to a project
    let mut stmt = conn.prepare("SELECT p.custom_instructions FROM projects p JOIN chat_sessions cs ON p.id = cs.project_id WHERE cs.id = ?1").unwrap();
    if let Ok(Some(instr)) = stmt.query_row(rusqlite::params![session_id], |row| {
        let text: Option<String> = row.get(0)?;
        Ok(text)
    }) {
        if !instr.is_empty() {
            system_parts.push(instr);
        }
    }

    // Check if session has a custom system prompt
    let mut stmt = conn.prepare("SELECT system_prompt FROM chat_sessions WHERE id = ?1").unwrap();
    if let Ok(Some(sp)) = stmt.query_row(rusqlite::params![session_id], |row| {
        let text: Option<String> = row.get(0)?;
        Ok(text)
    }) {
        if !sp.is_empty() {
            system_parts.push(sp);
        }
    }

    // 2. Memories — two-tier retrieval: pinned always, non-pinned by similarity
    let mut memories_text = String::new();
    let mut memory_tokens = 0usize;

    // Helper: append a memory line, respecting token budget. Returns true if added.
    let append_memory = |id: String, content: &str, scope: &str, tokens: &mut usize, text: &mut String, used: &mut Vec<String>, budget_limit: usize| -> bool {
        let prefix = if scope == "global" { "[global] " } else { "" };
        let line = format!("- {}{}\n", prefix, content);
        let line_tokens = estimate_tokens(&line);
        if *tokens + line_tokens > budget_limit {
            return false;
        }
        *tokens += line_tokens;
        text.push_str(&line);
        used.push(id);
        true
    };

    // Tier 1: Pinned memories (always included, no budget cap)
    {
        let pinned: Vec<(String, String, String)> = conn.prepare(
            "SELECT id, content, scope FROM memories \
             WHERE is_active = 1 AND is_pinned = 1 \
             AND ((workspace_id = ?1 AND scope = 'workspace') OR scope = 'global') \
             ORDER BY scope ASC, updated_at DESC"
        ).unwrap()
        .query_map(rusqlite::params![workspace_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        }).unwrap().flatten().collect();

        for (id, content, scope) in pinned {
            let prefix = if scope == "global" { "[global] " } else { "" };
            let line = format!("- {}{}\n", prefix, content);
            memory_tokens += estimate_tokens(&line);
            memories_text.push_str(&line);
            sources.memories_used.push(id);
        }
    }

    // Tier 1.5: Non-pinned memories WITHOUT embeddings (legacy/manual — include unconditionally)
    {
        let unembedded: Vec<(String, String, String)> = conn.prepare(
            "SELECT m.id, m.content, m.scope FROM memories m \
             LEFT JOIN memory_embeddings me ON m.id = me.memory_id \
             WHERE m.is_active = 1 AND m.is_pinned = 0 \
             AND ((m.workspace_id = ?1 AND m.scope = 'workspace') OR m.scope = 'global') \
             AND me.memory_id IS NULL \
             ORDER BY m.updated_at DESC"
        ).unwrap()
        .query_map(rusqlite::params![workspace_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        }).unwrap().flatten().collect();

        for (id, content, scope) in unembedded {
            if !append_memory(id, &content, &scope, &mut memory_tokens, &mut memories_text, &mut sources.memories_used, budget.memories) {
                break;
            }
        }
    }

    // Tier 2: Non-pinned memories WITH embeddings — ranked by similarity
    if memory_tokens < budget.memories {
        if let Some(qe) = query_embedding {
            // Semantic retrieval: score each embedded non-pinned memory
            let candidates: Vec<(String, String, String, Vec<u8>)> = conn.prepare(
                "SELECT m.id, m.content, m.scope, me.embedding FROM memories m \
                 JOIN memory_embeddings me ON m.id = me.memory_id \
                 WHERE m.is_active = 1 AND m.is_pinned = 0 \
                 AND ((m.workspace_id = ?1 AND m.scope = 'workspace') OR m.scope = 'global')"
            ).unwrap()
            .query_map(rusqlite::params![workspace_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, Vec<u8>>(3)?))
            }).unwrap().flatten().collect();

            let mut scored: Vec<(f32, String, String, String)> = candidates.into_iter()
                .filter_map(|(id, content, scope, emb_bytes)| {
                    let stored_emb = vector_index::bytes_to_f32_vec(&emb_bytes);
                    let similarity = vector_index::cosine_similarity(qe, &stored_emb);
                    if similarity >= MEMORY_SIMILARITY_THRESHOLD {
                        Some((similarity, id, content, scope))
                    } else {
                        None
                    }
                })
                .collect();
            scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

            for (_, id, content, scope) in scored.into_iter().take(MEMORY_RETRIEVAL_TOP_K) {
                if !append_memory(id, &content, &scope, &mut memory_tokens, &mut memories_text, &mut sources.memories_used, budget.memories) {
                    break;
                }
            }
        } else {
            // Fallback: no embedding available, use recency-based retrieval
            let fallback: Vec<(String, String, String)> = conn.prepare(
                "SELECT m.id, m.content, m.scope FROM memories m \
                 JOIN memory_embeddings me ON m.id = me.memory_id \
                 WHERE m.is_active = 1 AND m.is_pinned = 0 \
                 AND ((m.workspace_id = ?1 AND m.scope = 'workspace') OR m.scope = 'global') \
                 ORDER BY m.updated_at DESC LIMIT 10"
            ).unwrap()
            .query_map(rusqlite::params![workspace_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            }).unwrap().flatten().collect();

            for (id, content, scope) in fallback {
                if !append_memory(id, &content, &scope, &mut memory_tokens, &mut memories_text, &mut sources.memories_used, budget.memories) {
                    break;
                }
            }
        }
    }

    if !memories_text.is_empty() {
        system_parts.push(format!("Active Context/Memories:\n{}", memories_text));
    }

    // 3. Past conversation summaries from OTHER sessions
    let mut summaries_text = String::new();
    {
        let mut stmt = conn.prepare(
            "SELECT id, content FROM conversation_summaries WHERE workspace_id = ?1 AND session_id != ?2 ORDER BY created_at DESC LIMIT 3"
        ).map_err(|e| e.to_string())?;
        
        let rows = stmt.query_map(rusqlite::params![workspace_id, session_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;

        for row in rows.flatten() {
            let (id, content) = row;
            summaries_text.push_str(&format!("- {}\n", content));
            sources.summaries_used.push(id);
        }
    }
    if !summaries_text.is_empty() {
        system_parts.push(format!("Relevant Context from Past Conversations:\n{}", summaries_text));
    }

    // 4. Referenced artifacts (pinned artifacts always included)
    let mut artifacts_text = String::new();
    {
        let mut stmt = conn.prepare(
            "SELECT id, title, content FROM artifacts WHERE workspace_id = ?1 AND is_pinned = 1 LIMIT 5"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map(rusqlite::params![workspace_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        }).map_err(|e| e.to_string())?;

        for row in rows.flatten() {
            let (id, title, content) = row;
            let excerpt: String = content.chars().take(500).collect();
            artifacts_text.push_str(&format!("### {}\n{}\n\n", title, excerpt));
            sources.artifacts_used.push(id);
        }
    }
    if !artifacts_text.is_empty() {
        system_parts.push(format!("Pinned Artifacts:\n{}", artifacts_text));
    }

    // Push system message
    let full_system = system_parts.join("\n\n");
    if !full_system.is_empty() {
        final_messages.push(OllamaMessage {
            role: "system".to_string(),
            content: full_system,
        });
    }

    // 6. Conversation history
    let mut history: Vec<OllamaMessage> = vec![];
    let mut stmt = conn.prepare(
        "SELECT role, content FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
    ).unwrap();
    
    if let Ok(iter) = stmt.query_map(rusqlite::params![session_id], |row| {
        Ok(OllamaMessage {
            role: row.get(0)?,
            content: row.get(1)?,
        })
    }) {
        for msg in iter.flatten() {
            history.push(msg);
        }
    }

    // Truncate history to fit budget
    let mut truncated_history = vec![];
    let mut current_history_tokens = 0;
    
    // Always keep first user message (establishes context)
    if let Some(first) = history.first() {
        if first.role == "user" {
            truncated_history.push(first.clone());
            current_history_tokens += estimate_tokens(&first.content);
        }
    }

    // Keep most recent 4 messages (2 turns)
    let recent_count = 4;
    let skip_first = if !truncated_history.is_empty() { 1 } else { 0 };
    let recent_messages: Vec<OllamaMessage> = history.iter().skip(skip_first).rev().take(recent_count).cloned().collect();
    
    let mut middle_messages: Vec<OllamaMessage> = history.iter().skip(skip_first).rev().skip(recent_count).cloned().collect();
    middle_messages.reverse(); // put back in chronological order

    // Build the final history keeping token limit in mind
    let mut combined = vec![];
    if !truncated_history.is_empty() {
        combined.push(truncated_history[0].clone());
    }
    
    // Add middle messages if they fit budget
    for msg in middle_messages {
        let tokens = estimate_tokens(&msg.content);
        if current_history_tokens + tokens <= budget.conversation {
            combined.push(msg);
            current_history_tokens += tokens;
        }
    }

    // Add recent messages
    for msg in recent_messages.into_iter().rev() {
        combined.push(msg);
    }

    final_messages.extend(combined);

    Ok((final_messages, sources))
}
