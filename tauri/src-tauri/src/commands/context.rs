use tauri::{AppHandle, State, Emitter};
use crate::models::context::AssembleAndSendRequest;
use crate::db::DbState;
use crate::services::context_assembler::assemble_context;
use crate::ollama::client::OllamaClient;

#[tauri::command]
pub async fn assemble_and_send(
    app: AppHandle,
    state: State<'_, DbState>,
    req: AssembleAndSendRequest,
) -> Result<String, String> {
    // 0. Embed the latest user message for semantic memory retrieval
    let last_user_message = {
        let conn_guard = state.0.lock().map_err(|e| e.to_string())?;
        conn_guard.query_row(
            "SELECT content FROM messages WHERE session_id = ?1 AND role = 'user' ORDER BY created_at DESC LIMIT 1",
            rusqlite::params![req.session_id],
            |row| row.get::<_, String>(0),
        ).ok()
    };

    let client_url = req.options.get("ollama_url").and_then(|v: &serde_json::Value| v.as_str()).map(|s: &str| s.to_string());
    let client = OllamaClient::new(client_url);

    let query_embedding = if let Some(msg) = &last_user_message {
        client.generate_embedding("nomic-embed-text", msg).await.ok()
    } else {
        None
    };

    // 1. Build context
    let (messages, sources) = {
        let conn_guard = state.0.lock().map_err(|e| e.to_string())?;
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
        let conn_guard = state.0.lock().map_err(|e| e.to_string())?;
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
