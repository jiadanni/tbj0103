use rusqlite::Connection;
use crate::models::context::{TokenBudget, ContextSources};
use crate::models::chat::{Message, MessageRole};
use crate::ollama::client::OllamaMessage;

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
    model_name: &str,
    options: &std::collections::HashMap<String, serde_json::Value>,
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

    // 1. System Prompt
    let mut system_parts = vec![];
    
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

    // 2. Memories (Top-K / Pinned)
    let mut memories_text = String::new();
    let mut stmt = conn.prepare("SELECT id, content FROM memories WHERE workspace_id = ?1 AND is_active = 1 ORDER BY is_pinned DESC, updated_at DESC LIMIT 10").unwrap();
    if let Ok(iter) = stmt.query_map(rusqlite::params![workspace_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) {
        for row in iter.flatten() {
            let (id, content) = row;
            memories_text.push_str(&format!("- {}\n", content));
            sources.memories_used.push(id);
        }
    }
    if !memories_text.is_empty() {
        system_parts.push(format!("Active Context/Memories:\n{}", memories_text));
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
