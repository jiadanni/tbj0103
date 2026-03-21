use tauri::State;
use crate::db::DbState;
use crate::models::memory::{Memory, CreateMemoryRequest, UpdateMemoryRequest, ExtractMemoriesRequest};
use crate::ollama::client::{OllamaClient, OllamaMessage};

fn row_to_memory(row: &rusqlite::Row) -> rusqlite::Result<Memory> {
    Ok(Memory {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        content: row.get(2)?,
        memory_type: row.get(3)?,
        source_session_id: row.get(4)?,
        is_pinned: row.get::<_, i32>(5)? != 0,
        is_active: row.get::<_, i32>(6)? != 0,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

#[tauri::command]
pub fn create_memory(state: State<DbState>, req: CreateMemoryRequest) -> Result<Memory, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let memory_type = req.memory_type.unwrap_or_else(|| "fact".to_string());
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO memories (id, workspace_id, content, memory_type, source_session_id, is_pinned, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, 1, ?6, ?6)",
        rusqlite::params![id, req.workspace_id, req.content, memory_type, req.source_session_id, now],
    ).map_err(|e| e.to_string())?;

    Ok(Memory {
        id,
        workspace_id: req.workspace_id,
        content: req.content,
        memory_type,
        source_session_id: req.source_session_id,
        is_pinned: false,
        is_active: true,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn list_memories(state: State<DbState>, workspace_id: String) -> Result<Vec<Memory>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, content, memory_type, source_session_id, is_pinned, is_active, created_at, updated_at
         FROM memories WHERE workspace_id = ?1 ORDER BY is_pinned DESC, created_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![workspace_id], row_to_memory)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn update_memory(state: State<DbState>, req: UpdateMemoryRequest) -> Result<Memory, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
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
    ).map_err(|e| e.to_string())?;

    let memory = conn.query_row(
        "SELECT id, workspace_id, content, memory_type, source_session_id, is_pinned, is_active, created_at, updated_at
         FROM memories WHERE id = ?1",
        rusqlite::params![req.id],
        row_to_memory,
    ).map_err(|e| e.to_string())?;

    Ok(memory)
}

#[tauri::command]
pub fn delete_memory(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM memories WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_active_memories(state: State<DbState>, workspace_id: String) -> Result<Vec<Memory>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, content, memory_type, source_session_id, is_pinned, is_active, created_at, updated_at
         FROM memories WHERE workspace_id = ?1 AND is_active = 1 ORDER BY is_pinned DESC, created_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![workspace_id], row_to_memory)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub async fn extract_memories(state: State<'_, DbState>, req: ExtractMemoriesRequest) -> Result<Vec<Memory>, String> {
    // 1. Get existing memories to avoid duplicates
    let existing: Vec<String> = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT content FROM memories WHERE workspace_id = ?1 AND is_active = 1"
        ).map_err(|e| e.to_string())?;
        let results: Vec<String> = stmt.query_map(rusqlite::params![req.workspace_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        results
    };

    // 2. Build extraction prompt
    let conversation = req.messages.iter()
        .map(|m| format!("{}: {}", m.role, m.content))
        .collect::<Vec<_>>()
        .join("\n");

    let existing_list = if existing.is_empty() {
        "None yet.".to_string()
    } else {
        existing.iter().map(|m| format!("- {}", m)).collect::<Vec<_>>().join("\n")
    };

    let prompt = format!(
        r#"Analyze this conversation and extract important facts, preferences, or context about the user that would be useful to remember for future conversations.

Existing memories (do NOT duplicate these):
{existing_list}

Conversation:
{conversation}

Respond with ONLY a JSON array of new memories to add. Each item should have "content" (string) and "memory_type" (one of: "fact", "preference", "context"). If there are no new memories to extract, respond with an empty array [].

Example: [{{"content": "User is studying machine learning", "memory_type": "fact"}}, {{"content": "User prefers concise explanations", "memory_type": "preference"}}]"#
    );

    // 3. Call Ollama
    let client = OllamaClient::new(req.ollama_url);
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    let raw = client.send_message(&req.model, messages).await?;

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

    // 5. Insert new memories
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut created = Vec::new();
    let now = chrono::Utc::now().to_rfc3339();

    for em in extracted {
        let valid_type = match em.memory_type.as_str() {
            "fact" | "preference" | "context" => em.memory_type.clone(),
            _ => "fact".to_string(),
        };
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO memories (id, workspace_id, content, memory_type, source_session_id, is_pinned, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, 1, ?6, ?6)",
            rusqlite::params![id, req.workspace_id, em.content, valid_type, req.session_id, now],
        ).map_err(|e| e.to_string())?;

        created.push(Memory {
            id,
            workspace_id: req.workspace_id.clone(),
            content: em.content,
            memory_type: valid_type,
            source_session_id: Some(req.session_id.clone()),
            is_pinned: false,
            is_active: true,
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }

    Ok(created)
}
