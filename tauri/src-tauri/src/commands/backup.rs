use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rusqlite::{
    params_from_iter,
    types::{ToSql, Value, ValueRef},
    Connection,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::security::{require_auth, AuthState};
use crate::db::DbState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    pub id: String,
    pub created_at: String,
    pub filename: String,
    pub size_bytes: i64,
    pub folder_count: i64,
    pub chat_count: i64,
}

const BACKUP_TABLES: [(&str, &str); 15] = [
    (
        "folders",
        "SELECT id, workspace_id, name, folder_description, custom_instructions, color, icon, created_at, updated_at
         FROM folders
         WHERE workspace_id = ?1
         ORDER BY created_at ASC",
    ),
    (
        "chat_sessions",
        "SELECT id, workspace_id, folder_id, title, model_name, system_prompt, is_pinned, is_incognito,
                exclude_from_analytics, is_deleted, deleted_at, last_accessed_at, last_processed_message_count,
                is_imported, parent_session_id, branch_message_id, is_unread, created_at, updated_at
         FROM chat_sessions
         WHERE workspace_id = ?1
         ORDER BY created_at ASC",
    ),
    (
        "messages",
        "SELECT id, session_id, role, content, model_name, tokens_used, duration_ms, created_at
         FROM messages
         WHERE session_id IN (SELECT id FROM chat_sessions WHERE workspace_id = ?1)
         ORDER BY created_at ASC",
    ),
    (
        "citations",
        "SELECT id, message_id, source_id, source_type, excerpt, relevance_score, created_at
         FROM citations
         WHERE message_id IN (
             SELECT id FROM messages
             WHERE session_id IN (SELECT id FROM chat_sessions WHERE workspace_id = ?1)
         )
         ORDER BY created_at ASC",
    ),
    (
        "learning_goals",
        "SELECT id, workspace_id, title, goal_description, progress, is_completed, due_date,
                created_at, updated_at
         FROM learning_goals
         WHERE workspace_id = ?1
         ORDER BY created_at ASC",
    ),
    (
        "concept_nodes",
        "SELECT id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json,
                x_position, y_position, review_count, created_at, updated_at
         FROM concept_nodes
         WHERE workspace_id = ?1
         ORDER BY created_at ASC",
    ),
    (
        "concept_links",
        "SELECT id, source_id, target_id, link_type, strength, context, created_at
         FROM concept_links
         WHERE source_id IN (SELECT id FROM concept_nodes WHERE workspace_id = ?1)
            OR target_id IN (SELECT id FROM concept_nodes WHERE workspace_id = ?1)
         ORDER BY created_at ASC",
    ),
    (
        "concept_mentions",
        "SELECT id, concept_id, source_type, source_id, context, created_at
         FROM concept_mentions
         WHERE concept_id IN (SELECT id FROM concept_nodes WHERE workspace_id = ?1)
         ORDER BY created_at ASC",
    ),
    (
        "note_templates",
        "SELECT id, workspace_id, name, template_description, content, icon, is_built_in, variables, created_at, updated_at
         FROM note_templates
         WHERE workspace_id = ?1
         ORDER BY created_at ASC",
    ),
    (
        "daily_notes",
        "SELECT id, workspace_id, date, content, mood, productivity, template_id, created_at, updated_at
         FROM daily_notes
         WHERE workspace_id = ?1
         ORDER BY date ASC",
    ),
    (
        "learning_cards",
        "SELECT id, workspace_id, front, back, source_type, source_id, ease_factor, interval, repetitions,
                next_review_date, last_reviewed_at, created_at
         FROM learning_cards
         WHERE workspace_id = ?1
         ORDER BY created_at ASC",
    ),
    (
        "sources",
        "SELECT id, workspace_id, source_type, title, filename, file_type, file_size, url, content, summary,
                favicon_data, is_processed, folder, token_count, created_at, updated_at
         FROM sources
         WHERE workspace_id = ?1
         ORDER BY created_at ASC",
    ),
    (
        "source_chunks",
        "SELECT id, source_id, content, chunk_index, created_at
         FROM source_chunks
         WHERE source_id IN (SELECT id FROM sources WHERE workspace_id = ?1)
         ORDER BY chunk_index ASC, created_at ASC",
    ),
    (
        "audio_transcriptions",
        "SELECT id, workspace_id, folder_id, filename, transcript, duration_seconds, is_processed, created_at
         FROM audio_transcriptions
         WHERE workspace_id = ?1
         ORDER BY created_at ASC",
    ),
    (
        "project_notes",
        "SELECT id, workspace_id, title, content, note_type, tags, created_at, updated_at
         FROM project_notes
         WHERE workspace_id = ?1
         ORDER BY updated_at ASC",
    ),
];

const OPTIONAL_BACKUP_TABLES: [(&str, &str); 6] = [
    (
        "calendar_alarms",
        "SELECT id, workspace_id, title, fire_date, duration_seconds, input_prompt, is_dismissed, created_at
         FROM calendar_alarms
         WHERE workspace_id = ?1
         ORDER BY fire_date ASC, created_at ASC",
    ),
    (
        "thought_queue",
        "SELECT id, workspace_id, content, status, process_at, model_name, prompt_prefix, result, result_at,
                session_id, created_at, updated_at
         FROM thought_queue
         WHERE workspace_id = ?1
         ORDER BY created_at ASC",
    ),
    (
        "memories",
        "SELECT id, workspace_id, folder_id, content, memory_type, scope, source_session_id, is_pinned, is_active,
                reinforcement_count, last_reinforced_at, superseded_by, superseded_at, superseded_reason,
                created_at, updated_at
         FROM memories
         WHERE workspace_id = ?1
         ORDER BY created_at ASC",
    ),
    (
        "artifacts",
        "SELECT id, workspace_id, session_id, message_id, title, artifact_type, language, content, description,
                tags, is_pinned, version, parent_artifact_id, token_count, created_at, updated_at
         FROM artifacts
         WHERE workspace_id = ?1
         ORDER BY (parent_artifact_id IS NOT NULL) ASC, version ASC, created_at ASC",
    ),
    (
        "conversation_summaries",
        "SELECT id, session_id, workspace_id, summary_type, content, key_topics, message_range_start,
                message_range_end, token_count, created_at, updated_at
         FROM conversation_summaries
         WHERE workspace_id = ?1
         ORDER BY created_at ASC",
    ),
    (
        "context_snapshots",
        "SELECT id, session_id, message_id, assembled_context, token_budget, tokens_used, sources_json, created_at
         FROM context_snapshots
         WHERE session_id IN (SELECT id FROM chat_sessions WHERE workspace_id = ?1)
         ORDER BY created_at ASC",
    ),
];

const RESTORE_TABLE_ORDER: [&str; 21] = [
    "folders",
    "chat_sessions",
    "messages",
    "citations",
    "learning_goals",
    "concept_nodes",
    "concept_links",
    "concept_mentions",
    "note_templates",
    "daily_notes",
    "learning_cards",
    "sources",
    "source_chunks",
    "audio_transcriptions",
    "project_notes",
    "calendar_alarms",
    "thought_queue",
    "memories",
    "artifacts",
    "conversation_summaries",
    "context_snapshots",
];

#[tauri::command]
pub async fn create_backup(
    auth: State<'_, AuthState>,
    state: State<'_, DbState>,
    workspace_id: String,
) -> Result<String, String> {
    require_auth(&auth, &state)?;
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let workspace = query_optional_json_row(
        &conn,
        "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, about_you, survey_data
         FROM workspaces
         WHERE id = ?1",
        &workspace_id,
    )?
    .ok_or_else(|| "Workspace not found".to_string())?;

    let mut data = serde_json::Map::new();
    for (table, query) in BACKUP_TABLES {
        data.insert(
            table.to_string(),
            query_rows_as_json(&conn, query, &workspace_id)?,
        );
    }

    for (table, query) in OPTIONAL_BACKUP_TABLES {
        if table_exists(&conn, table)? {
            data.insert(
                table.to_string(),
                query_rows_as_json(&conn, query, &workspace_id)?,
            );
        }
    }

    let backup = serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "version": "2.0",
        "created_at": chrono::Utc::now().to_rfc3339(),
        "workspace": workspace,
        "data": data,
        "stats": {
            "folder_count": data.get("folders").and_then(|rows| rows.as_array()).map_or(0, |rows| rows.len()),
            "chat_count": data.get("chat_sessions").and_then(|rows| rows.as_array()).map_or(0, |rows| rows.len()),
            "message_count": data.get("messages").and_then(|rows| rows.as_array()).map_or(0, |rows| rows.len()),
            "note_count": data.get("project_notes").and_then(|rows| rows.as_array()).map_or(0, |rows| rows.len()),
            "source_count": data.get("sources").and_then(|rows| rows.as_array()).map_or(0, |rows| rows.len()),
            "artifact_count": data.get("artifacts").and_then(|rows| rows.as_array()).map_or(0, |rows| rows.len()),
        }
    });

    serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn list_backups(_state: State<DbState>) -> Result<Vec<BackupInfo>, String> {
    Ok(vec![])
}

#[tauri::command]
pub async fn restore_backup(
    auth: State<'_, AuthState>,
    state: State<'_, DbState>,
    backup_json: String,
) -> Result<String, String> {
    require_auth(&auth, &state)?;
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let backup: serde_json::Value =
        serde_json::from_str(&backup_json).map_err(|e| format!("Invalid backup JSON: {e}"))?;

    if backup.get("data").is_none() {
        return restore_legacy_backup(&mut conn, &backup);
    }

    let workspace = backup
        .get("workspace")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "Backup is missing workspace data".to_string())?;

    let workspace_id = workspace
        .get("id")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Backup workspace is missing an id".to_string())?
        .to_string();

    let data = backup
        .get("data")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "Backup is missing table data".to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM workspaces WHERE id = ?1", [&workspace_id])
        .map_err(|e| e.to_string())?;

    insert_value_object(
        &tx,
        "workspaces",
        &serde_json::Value::Object(workspace.clone()),
    )?;

    for table in RESTORE_TABLE_ORDER {
        if let Some(rows) = data.get(table) {
            insert_json_rows(&tx, table, rows)?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(workspace_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn delete_backup(_id: String) -> Result<(), String> {
    Ok(())
}

fn restore_legacy_backup(
    conn: &mut Connection,
    backup: &serde_json::Value,
) -> Result<String, String> {
    let workspace = backup
        .get("workspace")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "Backup is missing workspace data".to_string())?;

    let workspace_id = workspace
        .get("id")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Backup workspace is missing an id".to_string())?
        .to_string();

    let workspace_name = workspace
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("Restored Workspace");

    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM workspaces WHERE id = ?1", [&workspace_id])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![workspace_id, workspace_name, now, now],
    )
    .map_err(|e| e.to_string())?;

    if let Some(folders) = workspace.get("folders").and_then(|value| value.as_array()) {
        for folder in folders {
            insert_value_object(&tx, "folders", folder)?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(workspace_id)
}

fn table_exists(conn: &Connection, table_name: &str) -> Result<bool, String> {
    let exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            [table_name],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(exists != 0)
}

fn query_optional_json_row(
    conn: &Connection,
    query: &str,
    workspace_id: &str,
) -> Result<Option<serde_json::Value>, String> {
    let rows = query_rows_as_json(conn, query, workspace_id)?;
    match rows {
        serde_json::Value::Array(mut rows) => Ok(rows.pop()),
        _ => Ok(None),
    }
}

fn query_rows_as_json(
    conn: &Connection,
    query: &str,
    workspace_id: &str,
) -> Result<serde_json::Value, String> {
    let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
    let column_names: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|name| (*name).to_string())
        .collect();
    let mut rows = stmt.query([workspace_id]).map_err(|e| e.to_string())?;
    let mut items = Vec::new();

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut object = serde_json::Map::new();
        for (index, column_name) in column_names.iter().enumerate() {
            let value = row.get_ref(index).map_err(|e| e.to_string())?;
            object.insert(column_name.clone(), sql_ref_to_json(value));
        }
        items.push(serde_json::Value::Object(object));
    }

    Ok(serde_json::Value::Array(items))
}

fn sql_ref_to_json(value: ValueRef<'_>) -> serde_json::Value {
    match value {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Integer(value) => serde_json::json!(value),
        ValueRef::Real(value) => serde_json::json!(value),
        ValueRef::Text(value) => {
            serde_json::Value::String(String::from_utf8_lossy(value).into_owned())
        }
        ValueRef::Blob(value) => serde_json::json!({
            "__type": "blob_base64",
            "value": B64.encode(value),
        }),
    }
}

fn insert_json_rows(
    conn: &Connection,
    table_name: &str,
    rows: &serde_json::Value,
) -> Result<(), String> {
    let rows = rows
        .as_array()
        .ok_or_else(|| format!("Backup table '{table_name}' is not an array"))?;

    for row in rows {
        insert_value_object(conn, table_name, row)?;
    }

    Ok(())
}

fn get_table_columns(conn: &Connection, table_name: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table_name})"))
        .map_err(|e| format!("Failed to inspect table '{table_name}': {e}"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed to read columns for '{table_name}': {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect columns for '{table_name}': {e}"))?;
    Ok(columns)
}

fn insert_value_object(
    conn: &Connection,
    table_name: &str,
    row: &serde_json::Value,
) -> Result<(), String> {
    let object = row
        .as_object()
        .ok_or_else(|| format!("Backup row for '{table_name}' is not an object"))?;

    if object.is_empty() {
        return Ok(());
    }

    let valid_columns = get_table_columns(conn, table_name)?;

    // Only include keys that correspond to real columns, preventing SQL injection
    // via crafted JSON keys in a backup file.
    let columns: Vec<&str> = object
        .keys()
        .map(String::as_str)
        .filter(|k| valid_columns.iter().any(|c| c == k))
        .collect();

    if columns.is_empty() {
        return Ok(());
    }

    let placeholders = vec!["?"; columns.len()].join(", ");
    let sql = format!(
        "INSERT OR REPLACE INTO {table_name} ({}) VALUES ({placeholders})",
        columns.join(", "),
    );

    let values: Vec<Value> = columns
        .iter()
        .map(|column| json_to_sql_value(object.get(*column).unwrap_or(&serde_json::Value::Null)))
        .collect::<Result<Vec<_>, _>>()?;
    let params: Vec<&dyn ToSql> = values.iter().map(|value| value as &dyn ToSql).collect();

    conn.execute(&sql, params_from_iter(params))
        .map_err(|e| format!("Failed to restore row into '{table_name}': {e}"))?;

    Ok(())
}

fn json_to_sql_value(value: &serde_json::Value) -> Result<Value, String> {
    match value {
        serde_json::Value::Null => Ok(Value::Null),
        serde_json::Value::Bool(value) => Ok(Value::Integer(i64::from(*value))),
        serde_json::Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                Ok(Value::Integer(value))
            } else if let Some(value) = value.as_u64() {
                i64::try_from(value).map(Value::Integer).map_err(|_| {
                    "Backup contains an integer that is too large to restore".to_string()
                })
            } else if let Some(value) = value.as_f64() {
                Ok(Value::Real(value))
            } else {
                Err("Backup contains an unsupported numeric value".to_string())
            }
        }
        serde_json::Value::String(value) => Ok(Value::Text(value.clone())),
        serde_json::Value::Array(_) => Ok(Value::Text(value.to_string())),
        serde_json::Value::Object(object) => {
            if object.get("__type").and_then(|value| value.as_str()) == Some("blob_base64") {
                let encoded = object
                    .get("value")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| "Backup blob is missing its payload".to_string())?;
                let bytes = B64
                    .decode(encoded)
                    .map_err(|e| format!("Failed to decode backup blob: {e}"))?;
                Ok(Value::Blob(bytes))
            } else {
                Ok(Value::Text(
                    serde_json::to_string(value).map_err(|e| e.to_string())?,
                ))
            }
        }
    }
}

/// Create a global backup containing all workspaces
#[tauri::command]
pub async fn create_global_backup(
    auth: State<'_, AuthState>,
    state: State<'_, DbState>,
) -> Result<String, String> {
    require_auth(&auth, &state)?;
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || {
    let conn = pool.get().map_err(|e| e.to_string())?;

    // Get all workspaces
    let mut stmt = conn
        .prepare("SELECT id FROM workspaces ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let workspace_ids: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut workspaces = Vec::new();
    for workspace_id in workspace_ids {
        let workspace = match query_optional_json_row(
            &conn,
            "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, about_you, survey_data
             FROM workspaces
             WHERE id = ?1",
            &workspace_id,
        ) {
            Ok(Some(w)) => w,
            _ => continue,
        };

        let mut data = serde_json::Map::new();
        for (table, query) in BACKUP_TABLES {
            data.insert(
                table.to_string(),
                query_rows_as_json(&conn, query, &workspace_id)?,
            );
        }

        for (table, query) in OPTIONAL_BACKUP_TABLES {
            if table_exists(&conn, table)? {
                data.insert(
                    table.to_string(),
                    query_rows_as_json(&conn, query, &workspace_id)?,
                );
            }
        }

        let folder_count = data
            .get("folders")
            .and_then(|rows| rows.as_array())
            .map_or(0, |rows| rows.len());
        let chat_count = data
            .get("chat_sessions")
            .and_then(|rows| rows.as_array())
            .map_or(0, |rows| rows.len());

        workspaces.push(serde_json::json!({
            "workspace": workspace,
            "data": data,
            "folder_count": folder_count,
            "chat_count": chat_count,
        }));
    }

    // Get app settings (from settings table if it exists)
    let settings = if table_exists(&conn, "settings")? {
        let mut stmt = conn
            .prepare("SELECT key, value FROM settings ORDER BY key ASC")
            .map_err(|e| e.to_string())?;
        let mut settings_map = serde_json::Map::new();
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let key: String = row.get(0).map_err(|e| e.to_string())?;
            let value: String = row.get(1).map_err(|e| e.to_string())?;
            settings_map.insert(key, serde_json::Value::String(value));
        }
        serde_json::Value::Object(settings_map)
    } else {
        serde_json::json!({})
    };

    let total_folders: usize = workspaces
        .iter()
        .filter_map(|w| w.get("folder_count").and_then(|c| c.as_u64()))
        .map(|c| c as usize)
        .sum();
    let total_chats: usize = workspaces
        .iter()
        .filter_map(|w| w.get("chat_count").and_then(|c| c.as_u64()))
        .map(|c| c as usize)
        .sum();

    let backup = serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "version": "2.0",
        "created_at": chrono::Utc::now().to_rfc3339(),
        "app_version": env!("CARGO_PKG_VERSION"),
        "is_global": true,
        "workspaces": workspaces.iter().filter_map(|w| w.get("workspace")).collect::<Vec<_>>(),
        "data": workspaces,
        "settings": settings,
        "stats": {
            "workspace_count": workspaces.len(),
            "total_folder_count": total_folders,
            "total_chat_count": total_chats,
        }
    });

    serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Restore from a global backup (all workspaces)
#[tauri::command]
pub async fn restore_global_backup(
    auth: State<'_, AuthState>,
    state: State<'_, DbState>,
    backup_json: String,
) -> Result<Vec<String>, String> {
    require_auth(&auth, &state)?;
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let backup: serde_json::Value =
        serde_json::from_str(&backup_json).map_err(|e| format!("Invalid backup JSON: {e}"))?;

    let is_global = backup
        .get("is_global")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !is_global {
        return Err("This backup is not marked as a global backup".to_string());
    }

    let workspaces_data = backup
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Backup is missing workspace data".to_string())?;

    let mut restored_ids = Vec::new();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for workspace_data in workspaces_data {
        let workspace = workspace_data
            .get("workspace")
            .and_then(|v| v.as_object())
            .ok_or_else(|| "Backup entry is missing workspace object".to_string())?;

        let workspace_id = workspace
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|v| !v.is_empty())
            .ok_or_else(|| "Backup workspace is missing an id".to_string())?
            .to_string();

        let data = workspace_data
            .get("data")
            .and_then(|v| v.as_object())
            .ok_or_else(|| "Backup workspace is missing table data".to_string())?;

        // Delete existing workspace
        tx.execute("DELETE FROM workspaces WHERE id = ?1", [&workspace_id])
            .map_err(|e| e.to_string())?;

        // Insert workspace
        insert_value_object(
            &tx,
            "workspaces",
            &serde_json::Value::Object(workspace.clone()),
        )?;

        // Restore tables in order
        for table in RESTORE_TABLE_ORDER {
            if let Some(rows) = data.get(table) {
                insert_json_rows(&tx, table, rows)?;
            }
        }

        restored_ids.push(workspace_id);
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(restored_ids)
    })
    .await
    .map_err(|e| e.to_string())?
}
