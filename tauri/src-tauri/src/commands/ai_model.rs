use tauri::State;
use crate::db::DbState;
use crate::models::ai_model::{AiModel, AddAiModelRequest, UpdateAiModelRequest};

fn row_to_model(row: &rusqlite::Row) -> rusqlite::Result<AiModel> {
    Ok(AiModel {
        id: row.get(0)?,
        name: row.get(1)?,
        model_id: row.get(2)?,
        provider: row.get(3)?,
        priority: row.get(4)?,
        is_paid: row.get::<_, i32>(5)? != 0,
        enabled: row.get::<_, i32>(6)? != 0,
        tokens_used_total: row.get(7)?,
        created_at: row.get(8)?,
    })
}

#[tauri::command]
pub fn list_ai_models(state: State<DbState>) -> Result<Vec<AiModel>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, model_id, provider, priority, is_paid, enabled, tokens_used_total, created_at
         FROM ai_models ORDER BY priority ASC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map([], |row| row_to_model(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn add_ai_model(state: State<DbState>, req: AddAiModelRequest) -> Result<AiModel, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let provider = req.provider.unwrap_or_else(|| "ollama".to_string());
    let is_paid = req.is_paid.unwrap_or(false);

    let priority: i64 = if let Some(p) = req.priority {
        p
    } else {
        conn.query_row(
            "SELECT COALESCE(MAX(priority) + 1, 0) FROM ai_models",
            [],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?
    };

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO ai_models (id, name, model_id, provider, priority, is_paid, enabled, tokens_used_total, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 0, ?7)",
        rusqlite::params![id, req.name, req.model_id, provider, priority, is_paid as i32, now],
    ).map_err(|e| e.to_string())?;

    Ok(AiModel {
        id,
        name: req.name,
        model_id: req.model_id,
        provider,
        priority,
        is_paid,
        enabled: true,
        tokens_used_total: 0,
        created_at: now,
    })
}

#[tauri::command]
pub fn update_ai_model(state: State<DbState>, req: UpdateAiModelRequest) -> Result<AiModel, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE ai_models SET
            name = COALESCE(?1, name),
            priority = COALESCE(?2, priority),
            is_paid = COALESCE(?3, is_paid),
            enabled = COALESCE(?4, enabled)
         WHERE id = ?5",
        rusqlite::params![
            req.name,
            req.priority,
            req.is_paid.map(|v| v as i32),
            req.enabled.map(|v| v as i32),
            req.id
        ],
    ).map_err(|e| e.to_string())?;

    let model = conn.query_row(
        "SELECT id, name, model_id, provider, priority, is_paid, enabled, tokens_used_total, created_at
         FROM ai_models WHERE id = ?1",
        rusqlite::params![req.id],
        |row| row_to_model(row),
    ).map_err(|e| e.to_string())?;

    Ok(model)
}

#[tauri::command]
pub fn delete_ai_model(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM ai_models WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_default_model(state: State<DbState>) -> Result<AiModel, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, name, model_id, provider, priority, is_paid, enabled, tokens_used_total, created_at
         FROM ai_models WHERE enabled = 1 ORDER BY priority ASC LIMIT 1",
        [],
        |row| row_to_model(row),
    );

    match result {
        Ok(model) => Ok(model),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            // Fall back to preferred_model setting
            let preferred: String = conn.query_row(
                "SELECT value FROM settings WHERE key = 'preferred_model'",
                [],
                |row| row.get(0),
            ).unwrap_or_else(|_| "\"qwen2.5:7b\"".to_string());
            let model_id = preferred.trim_matches('"').to_string();
            Ok(AiModel {
                id: String::new(),
                name: model_id.clone(),
                model_id,
                provider: "ollama".to_string(),
                priority: 0,
                is_paid: false,
                enabled: true,
                tokens_used_total: 0,
                created_at: String::new(),
            })
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn record_model_token_usage(state: State<DbState>, model_id: String, tokens: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE ai_models SET tokens_used_total = tokens_used_total + ?1 WHERE model_id = ?2",
        rusqlite::params![tokens, model_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
