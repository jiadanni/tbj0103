use crate::db::DbState;
use crate::models::memory::{
    CreateMemoryRequest, ExtractMemoriesRequest, Memory, UpdateMemoryRequest,
};
use crate::ollama::client::{OllamaClient, OllamaMessage};
use crate::services::model_settings::{get_embedding_model, get_ollama_base_url};
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
            "fact" | "preference" | "context" => em.memory_type.clone(),
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
