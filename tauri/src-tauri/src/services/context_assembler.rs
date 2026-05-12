use crate::models::context::{ContextSources, TokenBudget};
use crate::models::workspace::TopicSignature;
use crate::ollama::client::OllamaMessage;
use crate::services::vector_index;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

const MEMORY_SIMILARITY_THRESHOLD: f32 = 0.3;
const MEMORY_RETRIEVAL_TOP_K: usize = 5;

/// Default context window size used when the model's actual limit is unknown.
/// Ollama defaults to 2048; this value is 4× larger and safe for most models.
pub const DEFAULT_CONTEXT_SIZE: usize = 8192;

/// Process-global registry of per-model `num_ctx` overrides. Populated by the
/// `ai_model` commands whenever the model list is read or updated, so the
/// `OllamaClient` (which has no DB handle) can still pick up overrides.
/// Key: model_id (e.g. "llama3.1:8b"). Value: clamped num_ctx in tokens.
static MODEL_CONTEXT_OVERRIDES: OnceLock<RwLock<HashMap<String, usize>>> = OnceLock::new();

fn override_map() -> &'static RwLock<HashMap<String, usize>> {
    MODEL_CONTEXT_OVERRIDES.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Replace the override map atomically. Called whenever the AI model list is
/// loaded so removed/cleared overrides are reflected immediately.
pub fn replace_model_context_overrides(overrides: HashMap<String, usize>) {
    if let Ok(mut guard) = override_map().write() {
        *guard = overrides;
    }
}

/// Set or clear a single model's override.
pub fn set_model_context_override(model_id: &str, value: Option<usize>) {
    if let Ok(mut guard) = override_map().write() {
        match value {
            Some(v) => { guard.insert(model_id.to_string(), v); }
            None => { guard.remove(model_id); }
        }
    }
}

/// Resolve `num_ctx` for the given model name. Falls back to `DEFAULT_CONTEXT_SIZE`.
/// Looks up by exact match first, then by base name (`name` matching `name:tag`).
pub fn context_size_for_model(model_name: &str) -> usize {
    let Ok(guard) = override_map().read() else {
        return DEFAULT_CONTEXT_SIZE;
    };
    if let Some(v) = guard.get(model_name) { return *v; }
    let base = model_name.split(':').next().unwrap_or(model_name);
    if let Some(v) = guard.get(base) { return *v; }
    DEFAULT_CONTEXT_SIZE
}

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

/// Truncate a message list to fit within `budget_tokens`.
///
/// Always preserves `messages[0]` (anchors the conversation) and the most
/// recent `RECENT_WINDOW` messages (current turn + one prior turn).  Middle
/// messages are included in chronological order as long as they fit the
/// budget.  Returns the original list unchanged when everything already fits.
const RECENT_WINDOW: usize = 4;

pub fn truncate_messages(messages: Vec<OllamaMessage>, budget_tokens: usize) -> Vec<OllamaMessage> {
    if messages.is_empty() {
        return messages;
    }

    // Fast path: if everything fits, return as-is
    let total_tokens: usize = messages.iter().map(|m| estimate_tokens(&m.content)).sum();
    if total_tokens <= budget_tokens {
        return messages;
    }

    let n = messages.len();
    let recent_count = RECENT_WINDOW.min(n);
    let recent_start = n - recent_count;

    let mut result: Vec<OllamaMessage> = Vec::with_capacity(n);
    let mut tokens_used = 0usize;

    // Always include first message (establishes context)
    result.push(messages[0].clone());
    tokens_used += estimate_tokens(&messages[0].content);

    // Include middle messages that fit within budget [1..recent_start]
    for msg in messages.iter().take(recent_start).skip(1) {
        let t = estimate_tokens(&msg.content);
        if tokens_used + t <= budget_tokens {
            result.push(msg.clone());
            tokens_used += t;
        }
    }

    // Always append the recent window (skip index 0 if it is already in recent range)
    for msg in messages.iter().skip(recent_start.max(1)) {
        result.push(msg.clone());
    }

    result
}

pub fn assemble_context(
    conn: &Connection,
    workspace_id: &str,
    session_id: &str,
    _model_name: &str,
    _options: &std::collections::HashMap<String, serde_json::Value>,
    query_embedding: Option<&[f32]>,
) -> Result<(Vec<OllamaMessage>, ContextSources), String> {
    // Budget derived from the model's context window. Querying Ollama /api/show
    // for the actual num_ctx will be added in a follow-up (phase 3).
    let budget = budget_for_context_window(DEFAULT_CONTEXT_SIZE);
    let mut sources = ContextSources {
        memories_used: vec![],
        artifacts_used: vec![],
        summaries_used: vec![],
        documents_used: vec![],
    };

    let mut final_messages: Vec<OllamaMessage> = vec![];

    // 1. System Prompt (order: global → workspace → project → session)
    let mut system_parts = vec![];

    // Consolidated system instructions query (Global, Workspace, Project, Session)
    let mut stmt = conn
        .prepare(
            "SELECT
                (SELECT value FROM settings WHERE key = 'prompt_instructions'),
                w.prompt_instructions,
                p.custom_instructions,
                cs.system_prompt,
                w.topic_signature
             FROM chat_sessions cs
             LEFT JOIN workspaces w ON w.id = cs.workspace_id
             LEFT JOIN projects p ON p.id = cs.project_id
             WHERE cs.id = ?1",
        )
        .map_err(|e| e.to_string())?;

    if let Ok((global_json, ws_prompt, proj_prompt, sess_prompt, topic_sig_json)) = stmt.query_row(
        rusqlite::params![session_id],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        },
    ) {
        // Global
        if let Some(json) = global_json {
            let text: String = serde_json::from_str(&json).unwrap_or_default();
            if !text.is_empty() { system_parts.push(text); }
        }
        // Workspace
        if let Some(text) = ws_prompt {
            if !text.is_empty() { system_parts.push(text); }
        }
        // Project
        if let Some(text) = proj_prompt {
            if !text.is_empty() { system_parts.push(text); }
        }
        // Session
        if let Some(text) = sess_prompt {
            if !text.is_empty() { system_parts.push(text); }
        }
        // Workspace domain — helps LLM disambiguate short/ambiguous messages
        if let Some(sig_json) = topic_sig_json {
            let sig: TopicSignature = serde_json::from_str(&sig_json).unwrap_or_default();
            let mut active_tags: Vec<String> = sig
                .domain_tags
                .iter()
                .filter(|t| !sig.ignored_tags.contains(&t.tag))
                .map(|t| t.tag.clone())
                .collect();
            for tag in &sig.manual_tags {
                if !sig.ignored_tags.contains(tag) && !active_tags.contains(tag) {
                    active_tags.push(tag.clone());
                }
            }
            if !active_tags.is_empty() {
                system_parts.push(format!("Workspace domain: {}", active_tags.join(", ")));
            }
        }
    }

    // 2. Memories — summary first, then two-tier retrieval
    let mut memories_text = String::new();
    let mut memory_tokens = 0usize;

    // Inject memory summary (global + workspace) at the top
    {
        let summary_rows: Vec<(String, String)> = conn
            .prepare(
                "SELECT content, scope FROM memory_summaries WHERE content != '' AND (scope = 'global' OR (scope = 'workspace' AND workspace_id = ?1)) ORDER BY scope ASC"
            )
            .ok()
            .map(|mut stmt| {
                stmt.query_map(rusqlite::params![workspace_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .ok()
                .map(|iter| iter.flatten().collect::<Vec<_>>())
                .unwrap_or_default()
            })
            .unwrap_or_default();

        for (content, scope) in summary_rows {
            let prefix = if scope == "global" { "User summary: " } else { "Workspace context: " };
            let line = format!("{}{}\n\n", prefix, content);
            let line_tokens = estimate_tokens(&line);
            if memory_tokens + line_tokens <= budget.memories {
                memory_tokens += line_tokens;
                memories_text.push_str(&line);
            }
        }
    }

    // Helper: append a memory line, respecting token budget. Returns true if added.
    let append_memory = |id: String,
                         content: &str,
                         scope: &str,
                         tokens: &mut usize,
                         text: &mut String,
                         used: &mut Vec<String>,
                         budget_limit: usize|
     -> bool {
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

    // Tier 1: Pinned memories or non-pinned without embeddings (legacy/manual)
    {
        let memories: Vec<(String, String, String, i32)> = conn
            .prepare(
                "SELECT m.id, m.content, m.scope, m.is_pinned FROM memories m \
                 LEFT JOIN memory_embeddings me ON m.id = me.memory_id \
                 WHERE m.is_active = 1 \
                 AND ((m.workspace_id = ?1 AND m.scope = 'workspace') OR m.scope = 'global') \
                 AND (m.is_pinned = 1 OR me.memory_id IS NULL) \
                 ORDER BY m.is_pinned DESC, m.scope ASC, m.updated_at DESC",
            )
            .map_err(|e| e.to_string())?
            .query_map(rusqlite::params![workspace_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i32>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .flatten()
            .collect();

        for (id, content, scope, is_pinned) in memories {
            if is_pinned == 1 {
                // Pinned memories are always included
                let prefix = if scope == "global" { "[global] " } else { "" };
                let line = format!("- {}{}\n", prefix, content);
                memory_tokens += estimate_tokens(&line);
                memories_text.push_str(&line);
                sources.memories_used.push(id);
            } else {
                // Non-pinned unembedded memories respect the budget
                if !append_memory(
                    id,
                    &content,
                    &scope,
                    &mut memory_tokens,
                    &mut memories_text,
                    &mut sources.memories_used,
                    budget.memories,
                ) {
                    break;
                }
            }
        }
    }

    // Tier 2: Non-pinned memories WITH embeddings — ranked by similarity
    if memory_tokens < budget.memories {
        if let Some(qe) = query_embedding {
            // Semantic retrieval: score each embedded non-pinned memory
            let candidates: Vec<(String, String, String, Vec<u8>)> = conn
                .prepare(
                    "SELECT m.id, m.content, m.scope, me.embedding FROM memories m \
                     JOIN memory_embeddings me ON m.id = me.memory_id \
                     WHERE m.is_active = 1 AND m.is_pinned = 0 \
                     AND ((m.workspace_id = ?1 AND m.scope = 'workspace') OR m.scope = 'global')",
                )
                .map_err(|e| e.to_string())?
                .query_map(rusqlite::params![workspace_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Vec<u8>>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .flatten()
                .collect();

            let mut scored: Vec<(f32, String, String, String)> = candidates
                .into_iter()
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
                if !append_memory(
                    id,
                    &content,
                    &scope,
                    &mut memory_tokens,
                    &mut memories_text,
                    &mut sources.memories_used,
                    budget.memories,
                ) {
                    break;
                }
            }
        } else {
            // Fallback: no embedding available, use recency-based retrieval
            let fallback: Vec<(String, String, String)> = conn
                .prepare(
                    "SELECT m.id, m.content, m.scope FROM memories m \
                     JOIN memory_embeddings me ON m.id = me.memory_id \
                     WHERE m.is_active = 1 AND m.is_pinned = 0 \
                     AND ((m.workspace_id = ?1 AND m.scope = 'workspace') OR m.scope = 'global') \
                     ORDER BY m.updated_at DESC LIMIT 10",
                )
                .map_err(|e| e.to_string())?
                .query_map(rusqlite::params![workspace_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .flatten()
                .collect();

            for (id, content, scope) in fallback {
                if !append_memory(
                    id,
                    &content,
                    &scope,
                    &mut memory_tokens,
                    &mut memories_text,
                    &mut sources.memories_used,
                    budget.memories,
                ) {
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

        let rows = stmt
            .query_map(rusqlite::params![workspace_id, session_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        for row in rows.flatten() {
            let (id, content) = row;
            summaries_text.push_str(&format!("- {}\n", content));
            sources.summaries_used.push(id);
        }
    }
    if !summaries_text.is_empty() {
        system_parts.push(format!(
            "Relevant Context from Past Conversations:\n{}",
            summaries_text
        ));
    }

    // 4. Referenced artifacts (pinned artifacts always included)
    let mut artifacts_text = String::new();
    {
        let mut stmt = conn.prepare(
            "SELECT id, title, content FROM artifacts WHERE workspace_id = ?1 AND is_pinned = 1 LIMIT 5"
        ).map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(rusqlite::params![workspace_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;

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
    let mut stmt = conn
        .prepare("SELECT role, content FROM messages WHERE session_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;

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
    let recent_messages: Vec<OllamaMessage> = history
        .iter()
        .skip(skip_first)
        .rev()
        .take(recent_count)
        .cloned()
        .collect();

    let mut middle_messages: Vec<OllamaMessage> = history
        .iter()
        .skip(skip_first)
        .rev()
        .skip(recent_count)
        .cloned()
        .collect();
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

    // Always include the most recent messages to preserve immediate context.
    for msg in recent_messages.into_iter().rev() {
        combined.push(msg);
    }

    final_messages.extend(combined);

    Ok((final_messages, sources))
}
