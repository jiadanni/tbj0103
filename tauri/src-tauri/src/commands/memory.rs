use crate::db::DbState;
use crate::models::memory::{
    CreateMemoryRequest, ExtractMemoriesRequest, Memory, MemorySummary, MemorySummarySnapshot,
    UpdateMemoryRequest,
};
use crate::ollama::client::{OllamaClient, OllamaMessage};
use crate::services::model_settings::{get_configured_chat_model, get_embedding_model, get_ollama_base_url};
use tauri::State;

fn row_to_memory(row: &rusqlite::Row) -> rusqlite::Result<Memory> {
    Ok(Memory {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        content: row.get(2)?,
        memory_type: row.get(3)?,
        scope: row.get(4)?,
        source_session_id: row.get(5)?,
        is_pinned: row.get::<_, i32>(6)? != 0,
        is_active: row.get::<_, i32>(7)? != 0,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

const MEMORY_COLUMNS: &str = "id, workspace_id, content, memory_type, scope, source_session_id, is_pinned, is_active, created_at, updated_at";

/// Best-effort: generate and store an embedding for a memory.
/// Does not fail if Ollama is unavailable.
async fn store_memory_embedding(
    state: &DbState,
    memory_id: &str,
    content: &str,
    ollama_url: Option<String>,
) {
    let Ok(client) = OllamaClient::new(ollama_url) else {
        return;
    };
    let embedding_model = {
        let Ok(conn) = state.0.get() else {
            return;
        };
        get_embedding_model(&conn)
    };
    let Some(embedding_model) = embedding_model else {
        return;
    };

    if let Ok(embedding) = client.generate_embedding("memory_command", &embedding_model, content).await {
        if let Ok(conn) = state.0.get() {
            let embedding_bytes = crate::services::vector_index::f32_vec_to_bytes(&embedding);
            let now = chrono::Utc::now().to_rfc3339();
            let _ = conn.execute(
                "INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, model, created_at) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![memory_id, embedding_bytes, embedding_model, now],
            );
        }
    }
}

/// Read Ollama base URL from settings.
fn read_ollama_url(state: &DbState) -> Option<String> {
    let conn = state.0.get().ok()?;
    get_ollama_base_url(&conn)
}

#[tauri::command]
pub async fn create_memory(
    state: State<'_, DbState>,
    req: CreateMemoryRequest,
) -> Result<Memory, String> {
    let memory = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let memory_type = req.memory_type.unwrap_or_else(|| "fact".to_string());
        let scope = req.scope.unwrap_or_else(|| "workspace".to_string());
        let now = chrono::Utc::now().to_rfc3339();

        // Global memories have no workspace_id
        let workspace_id = if scope == "global" {
            None
        } else {
            req.workspace_id.clone()
        };

        conn.execute(
            "INSERT INTO memories (id, workspace_id, content, memory_type, scope, source_session_id, is_pinned, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 1, ?7, ?7)",
            rusqlite::params![id, workspace_id, req.content, memory_type, scope, req.source_session_id, now],
        ).map_err(|e| e.to_string())?;

        Memory {
            id,
            workspace_id,
            content: req.content,
            memory_type,
            scope,
            source_session_id: req.source_session_id,
            is_pinned: false,
            is_active: true,
            created_at: now.clone(),
            updated_at: now,
        }
    };

    // Best-effort embedding generation (outside DB lock)
    let ollama_url = read_ollama_url(&state);
    store_memory_embedding(&state, &memory.id, &memory.content, ollama_url).await;

    Ok(memory)
}

#[tauri::command]
pub fn list_memories(state: State<DbState>, workspace_id: String) -> Result<Vec<Memory>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {} FROM memories WHERE workspace_id = ?1 AND scope = 'workspace' ORDER BY is_pinned DESC, created_at DESC",
        MEMORY_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(rusqlite::params![workspace_id], row_to_memory)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn list_global_memories(state: State<DbState>) -> Result<Vec<Memory>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {} FROM memories WHERE scope = 'global' ORDER BY is_pinned DESC, created_at DESC",
        MEMORY_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([], row_to_memory)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub async fn update_memory(
    state: State<'_, DbState>,
    req: UpdateMemoryRequest,
) -> Result<Memory, String> {
    let content_changed = req.content.is_some();
    let memory = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE memories SET
                content = COALESCE(?1, content),
                memory_type = COALESCE(?2, memory_type),
                is_pinned = COALESCE(?3, is_pinned),
                is_active = COALESCE(?4, is_active),
                updated_at = ?5
             WHERE id = ?6",
            rusqlite::params![
                req.content,
                req.memory_type,
                req.is_pinned.map(|v| v as i32),
                req.is_active.map(|v| v as i32),
                now,
                req.id
            ],
        )
        .map_err(|e| e.to_string())?;

        let sql = format!("SELECT {} FROM memories WHERE id = ?1", MEMORY_COLUMNS);
        conn.query_row(&sql, rusqlite::params![req.id], row_to_memory)
            .map_err(|e| e.to_string())?
    };

    // Re-generate embedding if content changed
    if content_changed {
        let ollama_url = read_ollama_url(&state);
        store_memory_embedding(&state, &memory.id, &memory.content, ollama_url).await;
    }

    Ok(memory)
}

#[tauri::command]
pub fn delete_memory(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM memories WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_active_memories(
    state: State<DbState>,
    workspace_id: String,
) -> Result<Vec<Memory>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    // Return both workspace-scoped memories for this workspace AND all global memories
    let sql = format!(
        "SELECT {} FROM memories WHERE is_active = 1 AND ((workspace_id = ?1 AND scope = 'workspace') OR scope = 'global') ORDER BY scope ASC, is_pinned DESC, created_at DESC",
        MEMORY_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(rusqlite::params![workspace_id], row_to_memory)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn delete_all_memories(
    state: State<DbState>,
    workspace_id: String,
    scope: String,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    if scope == "global" {
        conn.execute("DELETE FROM memories WHERE scope = 'global'", [])
            .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "DELETE FROM memories WHERE workspace_id = ?1 AND scope = 'workspace'",
            rusqlite::params![workspace_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn deactivate_all_memories(
    state: State<DbState>,
    workspace_id: String,
    scope: String,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    if scope == "global" {
        conn.execute(
            "UPDATE memories SET is_active = 0, updated_at = ?1 WHERE scope = 'global' AND is_active = 1",
            rusqlite::params![now],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE memories SET is_active = 0, updated_at = ?1 WHERE workspace_id = ?2 AND scope = 'workspace' AND is_active = 1",
            rusqlite::params![now, workspace_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn extract_memories(
    state: State<'_, DbState>,
    req: ExtractMemoriesRequest,
) -> Result<Vec<Memory>, String> {
    // 1. Get existing memories to avoid duplicates
    let existing: Vec<String> = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT content FROM memories WHERE workspace_id = ?1 AND is_active = 1")
            .map_err(|e| e.to_string())?;
        let results: Vec<String> = stmt
            .query_map(rusqlite::params![req.workspace_id], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        results
    };

    // 2. Build extraction prompt
    let conversation = req
        .messages
        .iter()
        .map(|m| format!("{}: {}", m.role, m.content))
        .collect::<Vec<_>>()
        .join("\n");

    let existing_list = if existing.is_empty() {
        "None yet.".to_string()
    } else {
        existing
            .iter()
            .map(|m| format!("- {}", m))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let prompt = format!(
        r#"You are a memory extraction system. Read the conversation and output ONLY a JSON array of concise facts about the user.

RULES:
- Each "content" must be a single short sentence (under 20 words) about the user.
- Write facts ABOUT THE USER (what they know, want, prefer, are working on).
- Do NOT copy or paraphrase assistant responses or explanations.
- Do NOT include greetings, filler, or conversational text.
- Good: "User is studying Python function call semantics"
- Bad: "In Python, keyword arguments are evaluated before positional arguments."

Existing memories (do NOT duplicate these):
{existing_list}

Conversation:
{conversation}

Respond with ONLY a JSON array. Each item has "content" (string) and "memory_type" (one of: "fact", "preference", "context"). Return [] if nothing new.

Example: [{{"content": "User is studying machine learning", "memory_type": "fact"}}, {{"content": "User prefers concise explanations", "memory_type": "preference"}}]"#
    );

    // 3. Call Ollama
    let client = OllamaClient::new(req.ollama_url)?;
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    let raw = client.send_message("memory_command", &req.model, messages).await?;

    // 4. Parse JSON array from response
    let trimmed = raw.trim();
    let json_str = match (trimmed.find('['), trimmed.rfind(']')) {
        (Some(s), Some(e)) if e > s => &trimmed[s..=e],
        _ => return Ok(vec![]),
    };

    #[derive(serde::Deserialize)]
    struct ExtractedMemory {
        content: String,
        memory_type: String,
    }

    let extracted: Vec<ExtractedMemory> = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return Ok(vec![]),
    };

    if extracted.is_empty() {
        return Ok(vec![]);
    }

    // 5. Insert new memories with embeddings
    let mut created = Vec::new();
    let now = chrono::Utc::now().to_rfc3339();

    for em in extracted {
        let valid_type = match em.memory_type.as_str() {
            "fact" | "preference" => em.memory_type.clone(),
            _ => "fact".to_string(),
        };
        let id = uuid::Uuid::new_v4().to_string();

        {
            let conn = state.0.get().map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO memories (id, workspace_id, content, memory_type, scope, source_session_id, is_pinned, is_active, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'workspace', ?5, 0, 1, ?6, ?6)",
                rusqlite::params![id, req.workspace_id, em.content, valid_type, req.session_id, now],
            ).map_err(|e| e.to_string())?;
        }

        // Generate and store embedding (best-effort, outside DB lock)
        let embedding_model = {
            let conn = state.0.get().map_err(|e| e.to_string())?;
            get_embedding_model(&conn)
        };

        if let Some(embedding_model) = embedding_model {
            if let Ok(embedding) = client
                .generate_embedding("memory_command", &embedding_model, &em.content)
                .await
            {
                if let Ok(conn) = state.0.get() {
                    let embedding_bytes =
                        crate::services::vector_index::f32_vec_to_bytes(&embedding);
                    let _ = conn.execute(
                        "INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, model, created_at) VALUES (?1, ?2, ?3, ?4)",
                        rusqlite::params![id, embedding_bytes, embedding_model, now],
                    );
                }
            }
        }

        created.push(Memory {
            id,
            workspace_id: Some(req.workspace_id.clone()),
            content: em.content,
            memory_type: valid_type,
            scope: "workspace".to_string(),
            source_session_id: Some(req.session_id.clone()),
            is_pinned: false,
            is_active: true,
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }

    Ok(created)
}

/// Snapshot the current summary row (if any) into memory_summary_snapshots before it gets overwritten.
/// No-op when the row doesn't exist or its content is empty.
fn snapshot_current_summary(
    conn: &rusqlite::Connection,
    scope: &str,
    workspace_id: Option<&str>,
) -> Result<(), String> {
    let current: Result<(String, String, i32), rusqlite::Error> = if scope == "global" {
        conn.query_row(
            "SELECT id, content, is_auto_generated FROM memory_summaries WHERE scope = 'global'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
    } else {
        conn.query_row(
            "SELECT id, content, is_auto_generated FROM memory_summaries WHERE scope = 'workspace' AND workspace_id = ?1",
            rusqlite::params![workspace_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
    };

    match current {
        Ok((summary_id, content, is_auto)) if !content.trim().is_empty() => {
            let snap_id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let ws_id = if scope == "global" { None } else { workspace_id };
            conn.execute(
                "INSERT INTO memory_summary_snapshots (id, summary_id, scope, workspace_id, content, is_auto_generated, snapshotted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![snap_id, summary_id, scope, ws_id, content, is_auto, now],
            ).map_err(|e| e.to_string())?;
            Ok(())
        }
        Ok(_) | Err(rusqlite::Error::QueryReturnedNoRows) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn row_to_summary(row: &rusqlite::Row) -> rusqlite::Result<MemorySummary> {
    Ok(MemorySummary {
        id: row.get(0)?,
        scope: row.get(1)?,
        workspace_id: row.get(2)?,
        content: row.get(3)?,
        is_auto_generated: row.get::<_, i32>(4)? != 0,
        generated_at: row.get(5)?,
        edited_at: row.get(6)?,
    })
}

#[tauri::command]
pub fn get_memory_summary(
    state: State<DbState>,
    scope: String,
    workspace_id: Option<String>,
) -> Result<Option<MemorySummary>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let result = if scope == "global" {
        conn.query_row(
            "SELECT id, scope, workspace_id, content, is_auto_generated, generated_at, edited_at FROM memory_summaries WHERE scope = 'global'",
            [],
            row_to_summary,
        )
    } else {
        conn.query_row(
            "SELECT id, scope, workspace_id, content, is_auto_generated, generated_at, edited_at FROM memory_summaries WHERE scope = 'workspace' AND workspace_id = ?1",
            rusqlite::params![workspace_id],
            row_to_summary,
        )
    };
    match result {
        Ok(s) => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn upsert_memory_summary(
    state: State<DbState>,
    scope: String,
    workspace_id: Option<String>,
    content: String,
) -> Result<MemorySummary, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let ws_id = if scope == "global" { None } else { workspace_id };

    snapshot_current_summary(&conn, &scope, ws_id.as_deref())?;

    conn.execute(
        "INSERT INTO memory_summaries (id, scope, workspace_id, content, is_auto_generated, generated_at, edited_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)
         ON CONFLICT(scope, workspace_id) DO UPDATE SET content = excluded.content, is_auto_generated = 0, edited_at = excluded.edited_at",
        rusqlite::params![id, scope, ws_id, content, now],
    ).map_err(|e| e.to_string())?;

    // Read back the row (may have been updated, not inserted)
    let summary = if scope == "global" {
        conn.query_row(
            "SELECT id, scope, workspace_id, content, is_auto_generated, generated_at, edited_at FROM memory_summaries WHERE scope = 'global'",
            [],
            row_to_summary,
        )
    } else {
        conn.query_row(
            "SELECT id, scope, workspace_id, content, is_auto_generated, generated_at, edited_at FROM memory_summaries WHERE scope = 'workspace' AND workspace_id = ?1",
            rusqlite::params![ws_id],
            row_to_summary,
        )
    }.map_err(|e| e.to_string())?;

    Ok(summary)
}

#[tauri::command]
pub async fn regenerate_memory_summary(
    state: State<'_, DbState>,
    scope: String,
    workspace_id: Option<String>,
) -> Result<MemorySummary, String> {
    // Gather all active facts+preferences for this scope
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
        } else if let Some(ref ws_id) = workspace_id {
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
        // Store empty summary
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let ws_id = if scope == "global" { None } else { workspace_id.clone() };
        snapshot_current_summary(&conn, &scope, ws_id.as_deref())?;
        conn.execute(
            "INSERT INTO memory_summaries (id, scope, workspace_id, content, is_auto_generated, generated_at, edited_at)
             VALUES (?1, ?2, ?3, '', 1, ?4, NULL)
             ON CONFLICT(scope, workspace_id) DO UPDATE SET content = '', is_auto_generated = 1, generated_at = excluded.generated_at, edited_at = NULL",
            rusqlite::params![id, scope, ws_id, now],
        ).map_err(|e| e.to_string())?;
        return get_memory_summary(state, scope, workspace_id)?
            .ok_or_else(|| "Failed to create summary".to_string());
    }

    // Build context for LLM
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

    let ollama_url = read_ollama_url(&state);
    let Ok(client) = OllamaClient::new(ollama_url) else {
        return Err("Ollama not available".to_string());
    };

    let model = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        get_configured_chat_model(&conn)
    };
    let Some(model) = model else {
        return Err("No chat model configured".to_string());
    };

    let msgs = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];

    let summary_text = client
        .send_message_with_options("memory_summary", &model, msgs, Some("0s"))
        .await
        .map_err(|e| e.to_string())?;

    // Store the generated summary
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let ws_id = if scope == "global" { None } else { workspace_id.clone() };
    snapshot_current_summary(&conn, &scope, ws_id.as_deref())?;
    conn.execute(
        "INSERT INTO memory_summaries (id, scope, workspace_id, content, is_auto_generated, generated_at, edited_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, NULL)
         ON CONFLICT(scope, workspace_id) DO UPDATE SET content = excluded.content, is_auto_generated = 1, generated_at = excluded.generated_at, edited_at = NULL",
        rusqlite::params![id, scope, ws_id, summary_text.trim(), now],
    ).map_err(|e| e.to_string())?;

    get_memory_summary(state, scope, workspace_id)?
        .ok_or_else(|| "Failed to read generated summary".to_string())
}

fn row_to_snapshot(row: &rusqlite::Row) -> rusqlite::Result<MemorySummarySnapshot> {
    Ok(MemorySummarySnapshot {
        id: row.get(0)?,
        summary_id: row.get(1)?,
        scope: row.get(2)?,
        workspace_id: row.get(3)?,
        content: row.get(4)?,
        is_auto_generated: row.get::<_, i32>(5)? != 0,
        snapshotted_at: row.get(6)?,
    })
}

#[tauri::command]
pub fn list_memory_summary_snapshots(
    state: State<DbState>,
    scope: String,
    workspace_id: Option<String>,
) -> Result<Vec<MemorySummarySnapshot>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let cols = "id, summary_id, scope, workspace_id, content, is_auto_generated, snapshotted_at";
    let items: Vec<MemorySummarySnapshot> = if scope == "global" {
        let sql = format!(
            "SELECT {} FROM memory_summary_snapshots WHERE scope = 'global' ORDER BY snapshotted_at DESC",
            cols
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], row_to_snapshot).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    } else {
        let sql = format!(
            "SELECT {} FROM memory_summary_snapshots WHERE scope = 'workspace' AND workspace_id = ?1 ORDER BY snapshotted_at DESC",
            cols
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![workspace_id], row_to_snapshot)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    Ok(items)
}

#[tauri::command]
pub fn restore_memory_summary_snapshot(
    state: State<DbState>,
    snapshot_id: String,
) -> Result<MemorySummary, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    let snap: MemorySummarySnapshot = conn
        .query_row(
            "SELECT id, summary_id, scope, workspace_id, content, is_auto_generated, snapshotted_at
             FROM memory_summary_snapshots WHERE id = ?1",
            rusqlite::params![snapshot_id],
            row_to_snapshot,
        )
        .map_err(|e| e.to_string())?;

    // Snapshot the currently-live summary before overwriting it with the restored content
    snapshot_current_summary(&conn, &snap.scope, snap.workspace_id.as_deref())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let auto = if snap.is_auto_generated { 1 } else { 0 };
    conn.execute(
        "INSERT INTO memory_summaries (id, scope, workspace_id, content, is_auto_generated, generated_at, edited_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(scope, workspace_id) DO UPDATE SET content = excluded.content, is_auto_generated = excluded.is_auto_generated, edited_at = excluded.edited_at",
        rusqlite::params![id, snap.scope, snap.workspace_id, snap.content, auto, now],
    ).map_err(|e| e.to_string())?;

    let cols = "id, scope, workspace_id, content, is_auto_generated, generated_at, edited_at";
    let summary = if snap.scope == "global" {
        conn.query_row(
            &format!("SELECT {} FROM memory_summaries WHERE scope = 'global'", cols),
            [],
            row_to_summary,
        )
    } else {
        conn.query_row(
            &format!("SELECT {} FROM memory_summaries WHERE scope = 'workspace' AND workspace_id = ?1", cols),
            rusqlite::params![snap.workspace_id],
            row_to_summary,
        )
    }.map_err(|e| e.to_string())?;

    Ok(summary)
}
