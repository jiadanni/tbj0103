use crate::db::DbState;
use crate::models::ai_model::{AddAiModelRequest, AiModel, ModelSpeedStat, UpdateAiModelRequest};
use tauri::State;

fn row_to_model(row: &rusqlite::Row) -> rusqlite::Result<AiModel> {
    let role_tags_json: String = row.get(4)?;
    Ok(AiModel {
        id: row.get(0)?,
        name: row.get(1)?,
        model_id: row.get(2)?,
        provider: row.get(3)?,
        role_tags: serde_json::from_str(&role_tags_json).unwrap_or_default(),
        priority: row.get(5)?,
        is_paid: row.get::<_, i32>(6)? != 0,
        enabled: row.get::<_, i32>(7)? != 0,
        tokens_used_total: row.get(8)?,
        created_at: row.get(9)?,
    })
}

#[tauri::command]
pub fn list_ai_models(state: State<DbState>) -> Result<Vec<AiModel>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, model_id, provider, role_tags, priority, is_paid, enabled, tokens_used_total, created_at
         FROM ai_models ORDER BY priority ASC"
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([], row_to_model)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn add_ai_model(state: State<DbState>, req: AddAiModelRequest) -> Result<AiModel, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let provider = req.provider.unwrap_or_else(|| "ollama".to_string());
    let role_tags = req.role_tags.unwrap_or_default();
    let is_paid = req.is_paid.unwrap_or(false);
    let enabled = req.enabled.unwrap_or(true);

    let priority: i64 = if let Some(p) = req.priority {
        p
    } else {
        conn.query_row(
            "SELECT COALESCE(MAX(priority) + 1, 0) FROM ai_models",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?
    };

    let now = chrono::Utc::now().to_rfc3339();
    let role_tags_json = serde_json::to_string(&role_tags).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO ai_models (id, name, model_id, provider, role_tags, priority, is_paid, enabled, tokens_used_total, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)",
        rusqlite::params![id, req.name, req.model_id, provider, role_tags_json, priority, is_paid as i32, enabled as i32, now],
    ).map_err(|e| e.to_string())?;

    Ok(AiModel {
        id,
        name: req.name,
        model_id: req.model_id,
        provider,
        role_tags,
        priority,
        is_paid,
        enabled,
        tokens_used_total: 0,
        created_at: now,
    })
}

#[tauri::command]
pub fn update_ai_model(
    state: State<DbState>,
    req: UpdateAiModelRequest,
) -> Result<AiModel, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let role_tags_json = req
        .role_tags
        .as_ref()
        .map(|tags| serde_json::to_string(tags).map_err(|e| e.to_string()))
        .transpose()?;
    conn.execute(
        "UPDATE ai_models SET
            name = COALESCE(?1, name),
            role_tags = COALESCE(?2, role_tags),
            priority = COALESCE(?3, priority),
            is_paid = COALESCE(?4, is_paid),
            enabled = COALESCE(?5, enabled)
         WHERE id = ?6",
        rusqlite::params![
            req.name,
            role_tags_json,
            req.priority,
            req.is_paid.map(|v| v as i32),
            req.enabled.map(|v| v as i32),
            req.id,
        ],
    )
    .map_err(|e| e.to_string())?;

    let model = conn.query_row(
        "SELECT id, name, model_id, provider, role_tags, priority, is_paid, enabled, tokens_used_total, created_at
         FROM ai_models WHERE id = ?1",
        rusqlite::params![req.id],
        row_to_model,
    ).map_err(|e| e.to_string())?;

    Ok(model)
}

#[tauri::command]
pub fn delete_ai_model(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM ai_models WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_default_model(state: State<DbState>) -> Result<AiModel, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, name, model_id, provider, role_tags, priority, is_paid, enabled, tokens_used_total, created_at
         FROM ai_models WHERE enabled = 1 ORDER BY priority ASC LIMIT 1",
        [],
        row_to_model,
    );

    match result {
        Ok(model) => Ok(model),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            // Fall back to preferred_model setting
            let preferred: String = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = 'preferred_model'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or_else(|_| "".to_string());
            let model_id = preferred.trim_matches('"').to_string();
            Ok(AiModel {
                id: String::new(),
                name: model_id.clone(),
                model_id,
                provider: "ollama".to_string(),
                role_tags: vec!["chat".to_string()],
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
pub fn record_model_token_usage(
    state: State<DbState>,
    model_id: String,
    provider: String,
    tokens: i64,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE ai_models SET tokens_used_total = tokens_used_total + ?1 WHERE model_id = ?2 AND provider = ?3",
        rusqlite::params![tokens, model_id, provider],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_model_speed_stats(state: State<DbState>) -> Result<Vec<ModelSpeedStat>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT model_name,
                    AVG(chat_tokens_per_second) AS avg_chat_tokens_per_second,
                    CAST(SUM(chat_tokens) AS REAL) / (SUM(chat_duration_ms) / 1000.0) AS weighted_tokens_per_second,
                    COUNT(*) AS chat_count
             FROM (
                 SELECT model_name,
                        session_id,
                        SUM(tokens_used) AS chat_tokens,
                        SUM(duration_ms) AS chat_duration_ms,
                        CAST(SUM(tokens_used) AS REAL) / (SUM(duration_ms) / 1000.0) AS chat_tokens_per_second
                 FROM messages
                 WHERE role = 'assistant'
                   AND model_name IS NOT NULL
                   AND TRIM(model_name) <> ''
                   AND tokens_used IS NOT NULL
                   AND duration_ms IS NOT NULL
                   AND duration_ms > 0
                 GROUP BY model_name, session_id
                 HAVING SUM(tokens_used) > 0 AND SUM(duration_ms) > 0
             )
             GROUP BY model_name
             ORDER BY model_name ASC",
        )
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([], |row| {
            Ok(ModelSpeedStat {
                model_name: row.get(0)?,
                avg_chat_tokens_per_second: row.get(1)?,
                weighted_tokens_per_second: row.get(2)?,
                chat_count: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}
