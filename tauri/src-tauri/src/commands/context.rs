use tauri::{AppHandle, State, Emitter};
use crate::models::context::AssembleAndSendRequest;
use crate::db::DbState;
use crate::services::context_assembler::assemble_context;
use crate::services::model_settings::get_embedding_model;
use crate::ollama::client::OllamaClient;
use crate::ollama::client::OllamaMessage;

fn query_exists(
    conn: &rusqlite::Connection,
    sql: &str,
    params: impl rusqlite::Params,
) -> Result<bool, String> {
    conn.query_row(sql, params, |row| row.get::<_, bool>(0))
        .map_err(|e| e.to_string())
}

fn workspace_has_enriched_context(
    conn: &rusqlite::Connection,
    workspace_id: &str,
    session_id: &str,
) -> Result<bool, String> {
    let has_global_instructions = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'prompt_instructions'",
            [],
            |row| row.get::<_, String>(0),
        )
        .map(|raw| {
            let text: String = serde_json::from_str(&raw).unwrap_or_default();
            !text.trim().is_empty()
        })
        .unwrap_or(false);
    if has_global_instructions {
        return Ok(true);
    }

    if query_exists(
        conn,
        "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = ?1 AND TRIM(prompt_instructions) != '')",
        rusqlite::params![workspace_id],
    )? {
        return Ok(true);
    }

    if query_exists(
        conn,
        "SELECT EXISTS(
            SELECT 1
            FROM chat_sessions cs
            LEFT JOIN projects p ON p.id = cs.project_id
            WHERE cs.id = ?1
              AND (
                TRIM(COALESCE(cs.system_prompt, '')) != ''
                OR TRIM(COALESCE(p.custom_instructions, '')) != ''
              )
        )",
        rusqlite::params![session_id],
    )? {
        return Ok(true);
    }

    if query_exists(
        conn,
        "SELECT EXISTS(
            SELECT 1
            FROM memories
            WHERE is_active = 1
              AND ((workspace_id = ?1 AND scope = 'workspace') OR scope = 'global')
        )",
        rusqlite::params![workspace_id],
    )? {
        return Ok(true);
    }

    if query_exists(
        conn,
        "SELECT EXISTS(
            SELECT 1
            FROM conversation_summaries
            WHERE workspace_id = ?1 AND session_id != ?2
        )",
        rusqlite::params![workspace_id, session_id],
    )? {
        return Ok(true);
    }

    if query_exists(
        conn,
        "SELECT EXISTS(
            SELECT 1
            FROM artifacts
            WHERE workspace_id = ?1 AND is_pinned = 1
        )",
        rusqlite::params![workspace_id],
    )? {
        return Ok(true);
    }

    Ok(false)
}

fn load_raw_history(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Vec<OllamaMessage>, String> {
    let mut stmt = conn
        .prepare("SELECT role, content FROM messages WHERE session_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params![session_id], |row| {
        Ok(OllamaMessage {
            role: row.get(0)?,
            content: row.get(1)?,
        })
    })
    .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn assemble_and_send(
    app: AppHandle,
    state: State<'_, DbState>,
    req: AssembleAndSendRequest,
) -> Result<String, String> {
    let use_fast_path = {
        let conn_guard = state.0.get().map_err(|e| e.to_string())?;
        !workspace_has_enriched_context(&conn_guard, &req.workspace_id, &req.session_id)?
    };

    let client_url = req.options.get("ollama_url").and_then(|v: &serde_json::Value| v.as_str()).map(|s: &str| s.to_string());
    let client = OllamaClient::new(client_url)?;

    if use_fast_path {
        let messages = {
            let conn_guard = state.0.get().map_err(|e| e.to_string())?;
            load_raw_history(&conn_guard, &req.session_id)?
        };

        let _ = app.emit(
            &format!("context-sources-{}", req.session_id),
            crate::models::context::ContextSources {
                memories_used: vec![],
                artifacts_used: vec![],
                summaries_used: vec![],
                documents_used: vec![],
            },
        );

        return client.stream_message(&app, &req.session_id, &req.model_name, messages).await;
    }

    // 0. Embed the latest user message for semantic memory retrieval
    let last_user_message = {
        let conn_guard = state.0.get().map_err(|e| e.to_string())?;
        conn_guard.query_row(
            "SELECT content FROM messages WHERE session_id = ?1 AND role = 'user' ORDER BY created_at DESC LIMIT 1",
            rusqlite::params![req.session_id],
            |row| row.get::<_, String>(0),
        ).ok()
    };

    let embedding_model = {
        let conn_guard = state.0.get().map_err(|e| e.to_string())?;
        get_embedding_model(&conn_guard)
    };

    let query_embedding = if let (Some(msg), Some(model)) = (&last_user_message, &embedding_model) {
        client.generate_embedding(model, msg).await.ok()
    } else {
        None
    };

    // 1. Build context
    let (messages, sources) = {
        let conn_guard = state.0.get().map_err(|e| e.to_string())?;
        assemble_context(
            &conn_guard,
            &req.workspace_id,
            &req.session_id,
            &req.model_name,
            &req.options,
            query_embedding.as_deref(),
        )?
    };

    // Save snapshot AFTER destructuring
    {
        let conn_guard = state.0.get().map_err(|e| e.to_string())?;
        let snapshot_id = uuid::Uuid::new_v4().to_string();
        let assembled_text = serde_json::to_string(&messages).unwrap_or_default();
        let sources_json = serde_json::to_string(&sources).unwrap_or_default();
        let tokens_used = crate::services::context_assembler::estimate_tokens(&assembled_text);
        
        let last_msg_id: String = conn_guard.query_row(
            "SELECT id FROM messages WHERE session_id = ?1 ORDER BY created_at DESC LIMIT 1",
            rusqlite::params![req.session_id],
            |row| row.get(0)
        ).unwrap_or_else(|_| "unknown".to_string());

        let _ = conn_guard.execute(
            "INSERT INTO context_snapshots (id, session_id, message_id, assembled_context, token_budget, tokens_used, sources_json)
             VALUES (?1, ?2, ?3, ?4, 8192, ?5, ?6)",
            rusqlite::params![snapshot_id, req.session_id, last_msg_id, assembled_text, tokens_used as i32, sources_json],
        );
    }

    // Send event for sources so frontend knows what context was used
    let _ = app.emit(
        &format!("context-sources-{}", req.session_id),
        sources
    );

    // Call stream_message
    client.stream_message(&app, &req.session_id, &req.model_name, messages).await
}
