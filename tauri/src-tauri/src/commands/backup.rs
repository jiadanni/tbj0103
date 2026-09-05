use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rusqlite::{
    params_from_iter,
    types::{ToSql, Value, ValueRef},
    Connection,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::security::{require_auth, require_auth_for_destructive_ops, AuthState};
use crate::db::DbState;
use crate::services::chat_file_store::validate_session_id;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    pub id: String,
    pub created_at: String,
    pub filename: String,
    pub size_bytes: i64,
    pub folder_count: i64,
    pub chat_count: i64,
}

/// User-facing selective-import categories, each owning a set of backup tables.
///
/// Dependent tables always travel with their parent so a selection can never
/// orphan rows (e.g. `messages` FK to `chat_sessions`, so both live in `chats`).
/// Every table in `RESTORE_TABLE_ORDER` must appear in exactly one category —
/// `every_restore_table_has_a_category` enforces that.
const BACKUP_CATEGORIES: [(&str, &str, &[&str]); 7] = [
    (
        "chats",
        "Chats & messages",
        &[
            "folders",
            "chat_sessions",
            "messages",
            "citations",
            "context_snapshots",
            "conversation_summaries",
            "artifacts",
        ],
    ),
    (
        "notes",
        "Notes & templates",
        &["project_notes", "daily_notes", "note_templates"],
    ),
    (
        "sources",
        "Sources & documents",
        &["sources", "source_chunks", "audio_transcriptions"],
    ),
    (
        "flashcards",
        "Flashcards & goals",
        &["learning_cards", "learning_goals"],
    ),
    (
        "concepts",
        "Concepts & links",
        &["concept_nodes", "concept_links", "concept_mentions"],
    ),
    ("memories", "Memories", &["memories"]),
    (
        "queue",
        "Thought queue & alarms",
        &["thought_queue", "calendar_alarms"],
    ),
];

fn category_for_table(table: &str) -> Option<&'static str> {
    BACKUP_CATEGORIES
        .iter()
        .find(|(_, _, tables)| tables.contains(&table))
        .map(|(id, _, _)| *id)
}

/// Conflict strategy for a row insert during restore or selective import.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OnConflict {
    /// Backup rows win over local rows (full restore semantics).
    Replace,
    /// Local rows win; the backup only fills in what is missing (merge).
    Ignore,
}

impl OnConflict {
    fn sql(self) -> &'static str {
        match self {
            OnConflict::Replace => "INSERT OR REPLACE",
            OnConflict::Ignore => "INSERT OR IGNORE",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupCategoryCount {
    pub id: String,
    pub label: String,
    pub row_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupWorkspacePreview {
    pub id: String,
    pub name: String,
    pub exists_locally: bool,
    pub categories: Vec<BackupCategoryCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupPreview {
    pub is_global: bool,
    pub created_at: String,
    pub app_version: Option<String>,
    pub workspaces: Vec<BackupWorkspacePreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectiveImportResult {
    pub workspace_ids: Vec<String>,
    pub rows_imported: usize,
    pub per_category: Vec<BackupCategoryCount>,
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
    // Restore deletes and replaces existing workspaces, so it must clear
    // the destructive-ops gate that strict auth mode installs.
    require_auth_for_destructive_ops(&auth, &state)?;
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    restore_backup_data(&mut conn, &backup_json)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn restore_backup_data(conn: &mut Connection, backup_json: &str) -> Result<String, String> {
    let _relocation = crate::services::chat_move_sync::lock_relocations()?;
    let backup: serde_json::Value =
        serde_json::from_str(backup_json).map_err(|e| format!("Invalid backup JSON: {e}"))?;
    validate_backup_session_ids(&backup)?;

    if backup.get("data").is_none() {
        return restore_legacy_backup(conn, &backup);
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
        OnConflict::Replace,
    )?;

    for table in RESTORE_TABLE_ORDER {
        if let Some(rows) = data.get(table) {
            insert_json_rows(&tx, table, rows, OnConflict::Replace)?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(workspace_id)
}

#[tauri::command]
pub fn delete_backup(auth: State<AuthState>, state: State<DbState>, _id: String) -> Result<(), String> {
    require_auth_for_destructive_ops(&auth, &state)?;
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
            insert_value_object(&tx, "folders", folder, OnConflict::Replace)?;
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

fn validate_backup_session_row(row: &serde_json::Value) -> Result<(), String> {
    let id = row
        .get("id")
        .and_then(serde_json::Value::as_str)
        .ok_or("Backup chat session is missing a string id")?;
    validate_session_id(id).map_err(|error| format!("Invalid backup chat session: {error}"))
}

/// Check every workspace in a global backup before any restore transaction mutates data.
fn validate_backup_session_ids(backup: &serde_json::Value) -> Result<(), String> {
    match backup.get("data") {
        Some(serde_json::Value::Array(workspaces)) => {
            for workspace in workspaces {
                validate_backup_session_ids(workspace)?;
            }
        }
        Some(serde_json::Value::Object(data)) => {
            if let Some(rows) = data.get("chat_sessions") {
                let rows = rows
                    .as_array()
                    .ok_or("Backup table 'chat_sessions' is not an array")?;
                for row in rows {
                    validate_backup_session_row(row)?;
                }
            }
        }
        // Legacy backups only restore the workspace and its folders.
        _ => {}
    }
    Ok(())
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
    on_conflict: OnConflict,
) -> Result<usize, String> {
    let rows = rows
        .as_array()
        .ok_or_else(|| format!("Backup table '{table_name}' is not an array"))?;

    let mut inserted = 0;
    for row in rows {
        inserted += insert_value_object(conn, table_name, row, on_conflict)?;
    }

    Ok(inserted)
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
    on_conflict: OnConflict,
) -> Result<usize, String> {
    if table_name == "chat_sessions" {
        validate_backup_session_row(row)?;
    }
    let object = row
        .as_object()
        .ok_or_else(|| format!("Backup row for '{table_name}' is not an object"))?;

    if object.is_empty() {
        return Ok(0);
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
        return Ok(0);
    }

    let placeholders = vec!["?"; columns.len()].join(", ");
    let verb = on_conflict.sql();
    let sql = format!(
        "{verb} INTO {table_name} ({}) VALUES ({placeholders})",
        columns.join(", "),
    );

    let values: Vec<Value> = columns
        .iter()
        .map(|column| json_to_sql_value(object.get(*column).unwrap_or(&serde_json::Value::Null)))
        .collect::<Result<Vec<_>, _>>()?;
    let params: Vec<&dyn ToSql> = values.iter().map(|value| value as &dyn ToSql).collect();

    let changed = conn
        .execute(&sql, params_from_iter(params))
        .map_err(|e| format!("Failed to restore row into '{table_name}': {e}"))?;

    Ok(changed)
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
    // Restore deletes and replaces existing workspaces, so it must clear
    // the destructive-ops gate that strict auth mode installs.
    require_auth_for_destructive_ops(&auth, &state)?;
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    restore_global_backup_data(&mut conn, &backup_json)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn restore_global_backup_data(conn: &mut Connection, backup_json: &str) -> Result<Vec<String>, String> {
    let _relocation = crate::services::chat_move_sync::lock_relocations()?;
    let backup: serde_json::Value =
        serde_json::from_str(backup_json).map_err(|e| format!("Invalid backup JSON: {e}"))?;
    validate_backup_session_ids(&backup)?;

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
            OnConflict::Replace,
        )?;

        // Restore tables in order
        for table in RESTORE_TABLE_ORDER {
            if let Some(rows) = data.get(table) {
                insert_json_rows(&tx, table, rows, OnConflict::Replace)?;
            }
        }

        restored_ids.push(workspace_id);
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(restored_ids)
}

type JsonObject = serde_json::Map<String, serde_json::Value>;

/// One backup entry: the workspace row plus its table data.
type BackupEntry = (JsonObject, JsonObject);

/// Normalize either backup envelope into `(workspace_object, table_data_object)`
/// pairs. Per-workspace backups carry `data` as an object; global backups mark
/// `is_global` and carry `data` as an array of `{workspace, data}` entries.
fn backup_workspace_entries(backup: &serde_json::Value) -> Result<Vec<BackupEntry>, String> {
    let is_global = backup
        .get("is_global")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);

    let mut entries = Vec::new();
    if is_global {
        let workspaces = backup
            .get("data")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| "Backup is missing workspace data".to_string())?;
        for entry in workspaces {
            let workspace = entry
                .get("workspace")
                .and_then(serde_json::Value::as_object)
                .ok_or_else(|| "Backup entry is missing workspace object".to_string())?;
            let data = entry
                .get("data")
                .and_then(serde_json::Value::as_object)
                .ok_or_else(|| "Backup workspace is missing table data".to_string())?;
            entries.push((workspace.clone(), data.clone()));
        }
    } else {
        let workspace = backup
            .get("workspace")
            .and_then(serde_json::Value::as_object)
            .ok_or_else(|| "Backup is missing workspace data".to_string())?;
        let data = backup
            .get("data")
            .and_then(serde_json::Value::as_object)
            .ok_or_else(|| "Backup is missing table data".to_string())?;
        entries.push((workspace.clone(), data.clone()));
    }

    Ok(entries)
}

fn workspace_id_of(workspace: &JsonObject) -> Result<String, String> {
    workspace
        .get("id")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Backup workspace is missing an id".to_string())
}

/// Inspect a backup file without writing anything, so the UI can offer a
/// selective import instead of an all-or-nothing restore.
#[tauri::command]
pub async fn preview_backup(
    auth: State<'_, AuthState>,
    state: State<'_, DbState>,
    backup_json: String,
) -> Result<BackupPreview, String> {
    require_auth(&auth, &state)?;
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let backup: serde_json::Value =
            serde_json::from_str(&backup_json).map_err(|e| format!("Invalid backup JSON: {e}"))?;
        validate_backup_session_ids(&backup)?;

        let is_global = backup
            .get("is_global")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);

        let mut workspaces = Vec::new();
        for (workspace, data) in backup_workspace_entries(&backup)? {
            let id = workspace_id_of(&workspace)?;
            let name = workspace
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("Untitled workspace")
                .to_string();

            let exists_locally = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = ?1)",
                    [&id],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|e| e.to_string())?
                != 0;

            let categories = BACKUP_CATEGORIES
                .iter()
                .map(|(category_id, label, tables)| {
                    let row_count = tables
                        .iter()
                        .filter_map(|table| data.get(*table))
                        .filter_map(serde_json::Value::as_array)
                        .map(Vec::len)
                        .sum();
                    BackupCategoryCount {
                        id: (*category_id).to_string(),
                        label: (*label).to_string(),
                        row_count,
                    }
                })
                .collect();

            workspaces.push(BackupWorkspacePreview {
                id,
                name,
                exists_locally,
                categories,
            });
        }

        Ok(BackupPreview {
            is_global,
            created_at: backup
                .get("created_at")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string(),
            app_version: backup
                .get("app_version")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
            workspaces,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Import only the selected workspaces and data categories from a backup.
///
/// `mode` is `"merge"` (default, never deletes — local rows win) or
/// `"replace"` (deletes the workspace first, matching `restore_backup`).
#[tauri::command]
pub async fn import_backup_selective(
    auth: State<'_, AuthState>,
    state: State<'_, DbState>,
    backup_json: String,
    workspace_ids: Vec<String>,
    category_ids: Vec<String>,
    mode: String,
) -> Result<SelectiveImportResult, String> {
    require_auth_for_destructive_ops(&auth, &state)?;
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        import_selective_data(&mut conn, &backup_json, &workspace_ids, &category_ids, &mode)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn import_selective_data(
    conn: &mut Connection,
    backup_json: &str,
    workspace_ids: &[String],
    category_ids: &[String],
    mode: &str,
) -> Result<SelectiveImportResult, String> {
    let _relocation = crate::services::chat_move_sync::lock_relocations()?;
    let backup: serde_json::Value =
        serde_json::from_str(backup_json).map_err(|e| format!("Invalid backup JSON: {e}"))?;
    validate_backup_session_ids(&backup)?;

    let on_conflict = match mode {
        "merge" => OnConflict::Ignore,
        "replace" => OnConflict::Replace,
        other => return Err(format!("Unknown import mode '{other}'")),
    };

    if workspace_ids.is_empty() {
        return Err("Select at least one workspace to import".to_string());
    }
    if category_ids.is_empty() {
        return Err("Select at least one data category to import".to_string());
    }

    for category_id in category_ids {
        if !BACKUP_CATEGORIES
            .iter()
            .any(|(id, _, _)| id == category_id)
        {
            return Err(format!("Unknown import category '{category_id}'"));
        }
    }

    let entries = backup_workspace_entries(&backup)?;
    let mut selected = Vec::new();
    for (workspace, data) in entries {
        let id = workspace_id_of(&workspace)?;
        if workspace_ids.contains(&id) {
            selected.push((id, workspace, data));
        }
    }

    for requested in workspace_ids {
        if !selected.iter().any(|(id, _, _)| id == requested) {
            return Err(format!(
                "Workspace '{requested}' is not present in this backup"
            ));
        }
    }

    // Only restore tables belonging to a selected category, but keep the
    // canonical RESTORE_TABLE_ORDER so foreign keys always land in order.
    let tables: Vec<&str> = RESTORE_TABLE_ORDER
        .iter()
        .copied()
        .filter(|table| {
            category_for_table(table)
                .is_some_and(|category| category_ids.iter().any(|id| id == category))
        })
        .collect();

    let mut per_category: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    let mut rows_imported = 0;
    let mut restored_ids = Vec::new();

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (workspace_id, workspace, data) in &selected {
        if on_conflict == OnConflict::Replace {
            tx.execute("DELETE FROM workspaces WHERE id = ?1", [workspace_id])
                .map_err(|e| e.to_string())?;
        }

        // In merge mode this is INSERT OR IGNORE, so an existing local
        // workspace keeps its own name, about_you and survey_data.
        insert_value_object(
            &tx,
            "workspaces",
            &serde_json::Value::Object(workspace.clone()),
            on_conflict,
        )?;

        for table in &tables {
            if let Some(rows) = data.get(*table) {
                let inserted = insert_json_rows(&tx, table, rows, on_conflict)?;
                rows_imported += inserted;
                if let Some(category) = category_for_table(table) {
                    *per_category.entry(category).or_default() += inserted;
                }
            }
        }

        restored_ids.push(workspace_id.clone());
    }
    tx.commit().map_err(|e| e.to_string())?;

    let per_category = BACKUP_CATEGORIES
        .iter()
        .filter(|(id, _, _)| category_ids.iter().any(|selected| selected == id))
        .map(|(id, label, _)| BackupCategoryCount {
            id: (*id).to_string(),
            label: (*label).to_string(),
            row_count: per_category.get(id).copied().unwrap_or(0),
        })
        .collect();

    Ok(SelectiveImportResult {
        workspace_ids: restored_ids,
        rows_imported,
        per_category,
    })
}

#[cfg(test)]
mod path_validation_tests {
    use super::*;

    #[test]
    fn storage_restore_waits_for_in_flight_tombstone_cleanup() {
        use crate::services::{chat_file_store, chat_move_sync};
        use std::sync::mpsc;
        use std::time::Duration;

        for global in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("restore-race.sqlite");
            let pool = crate::db::initialize_database(&path).unwrap();
            let conn = pool.get().unwrap();
            let chats = dir.path().join("chats");
            let variants = chat_file_store::SessionFileVariants {
                plain: chats.join("Restored/reused.json"),
                encrypted: chats.join("Restored/reused.json.enc"),
            };
            std::fs::create_dir_all(variants.plain.parent().unwrap()).unwrap();
            std::fs::write(&variants.plain, b"old data").unwrap();
            let tx = conn.unchecked_transaction().unwrap();
            chat_move_sync::enqueue_deletion(
                &tx,
                &std::collections::HashMap::from([("reused".into(), variants.clone())]),
            ).unwrap();
            tx.commit().unwrap();

            // Pause deletion after observing the ID is absent. Restore must
            // not commit a replacement until the cleanup lock is released.
            let relocation = chat_move_sync::lock_relocations().unwrap();
            assert_eq!(conn.query_row("SELECT COUNT(*) FROM chat_sessions WHERE id = 'reused'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
            let backup = serde_json::json!({
                "workspace": {"id": "ws", "name": "Restored"},
                "data": {"chat_sessions": [{"id": "reused", "workspace_id": "ws", "title": "Replacement"}]}
            });
            let backup = if global {
                serde_json::json!({"is_global": true, "data": [backup]})
            } else {
                backup
            }.to_string();
            let (started_tx, started_rx) = mpsc::channel();
            let (done_tx, done_rx) = mpsc::channel();
            let worker_pool = pool.clone();
            let worker = std::thread::spawn(move || {
                let mut conn = worker_pool.get().unwrap();
                started_tx.send(()).unwrap();
                let result = if global {
                    restore_global_backup_data(&mut conn, &backup).map(|_| ())
                } else {
                    restore_backup_data(&mut conn, &backup).map(|_| ())
                };
                done_tx.send(result).unwrap();
            });
            started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(matches!(done_rx.recv_timeout(Duration::from_millis(100)), Err(mpsc::RecvTimeoutError::Timeout)));
            chat_move_sync::sync_deletions(&conn, &chats).unwrap();
            assert!(!variants.plain.exists());
            drop(relocation);
            done_rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
            worker.join().unwrap();
            chat_file_store::write_session_file(&conn, &chats, "reused", None).unwrap();
            let _relocation = chat_move_sync::lock_relocations().unwrap();
            chat_move_sync::sync_deletions(&conn, &chats).unwrap();
            let replacement = chat_file_store::read_session_file(&variants.plain, None).unwrap();
            assert_eq!(replacement.title, "Replacement");
            assert_eq!(conn.query_row("SELECT COUNT(*) FROM chat_file_delete_outbox", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        }
    }

    #[test]
    fn backup_session_ids_allow_demo_and_legacy_identifiers() {
        for id in ["demo-chat-1", "legacy_session.2", "550e8400-e29b-41d4-a716-446655440000"] {
            let backup = serde_json::json!({"data": {"chat_sessions": [{"id": id}]}});
            assert!(validate_backup_session_ids(&backup).is_ok());
        }
        assert!(validate_backup_session_ids(&serde_json::json!({
            "workspace": {"id": "legacy", "folders": []}
        })).is_ok());
    }

    #[test]
    fn backup_session_ids_reject_traversal_and_non_string_ids() {
        for id in [
            serde_json::json!("../outside"),
            serde_json::json!("/absolute"),
            serde_json::json!("..\\outside"),
            serde_json::json!("C:\\outside"),
            serde_json::json!("session:stream"),
            serde_json::json!(""),
            serde_json::json!(null),
            serde_json::json!(12),
        ] {
            let backup = serde_json::json!({"data": {"chat_sessions": [{"id": id}]}});
            assert!(validate_backup_session_ids(&backup).is_err(), "{id}");
        }
    }

    #[test]
    fn global_backup_preflights_later_workspaces() {
        let backup = serde_json::json!({"is_global": true, "data": [
            {"data": {"chat_sessions": [{"id": "demo-safe"}]}},
            {"data": {"chat_sessions": [{"id": "../../outside"}]}}
        ]});
        assert!(validate_backup_session_ids(&backup).is_err());
    }

    #[test]
    fn backup_insert_rejects_unsafe_session_before_sql() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE chat_sessions (id TEXT PRIMARY KEY);").unwrap();
        let error = insert_value_object(
            &conn,
            "chat_sessions",
            &serde_json::json!({"id": "../outside"}),
            OnConflict::Replace,
        ).unwrap_err();
        assert!(error.contains("Invalid backup chat session"));
        assert_eq!(
            conn.query_row("SELECT COUNT(id) FROM chat_sessions", [], |row| row.get::<_, i64>(0)).unwrap(),
            0
        );
    }
}

#[cfg(test)]
mod selective_import_tests {
    use super::*;

    fn test_conn() -> (tempfile::TempDir, r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::initialize_database(&dir.path().join("selective.sqlite")).unwrap();
        let conn = pool.get().unwrap();
        (dir, conn)
    }

    /// A backup of workspace `ws` holding one chat session and one project note.
    fn sample_backup() -> String {
        serde_json::json!({
            "version": "2.0",
            "created_at": "2026-01-01T00:00:00Z",
            "workspace": {"id": "ws", "name": "Backup Name"},
            "data": {
                "chat_sessions": [
                    {"id": "backup-chat", "workspace_id": "ws", "title": "From backup"}
                ],
                "project_notes": [
                    {"id": "backup-note", "workspace_id": "ws", "title": "Note", "content": "body"}
                ]
            }
        })
        .to_string()
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get::<_, i64>(0)).unwrap()
    }

    #[test]
    fn every_restore_table_has_exactly_one_category() {
        for table in RESTORE_TABLE_ORDER {
            let owners: Vec<&str> = BACKUP_CATEGORIES
                .iter()
                .filter(|(_, _, tables)| tables.contains(&table))
                .map(|(id, _, _)| *id)
                .collect();
            assert_eq!(
                owners.len(),
                1,
                "table '{table}' should belong to exactly one category, found {owners:?}"
            );
        }

        // And no category claims a table that is never restored.
        for (id, _, tables) in BACKUP_CATEGORIES {
            for table in tables {
                assert!(
                    RESTORE_TABLE_ORDER.contains(table),
                    "category '{id}' claims unknown table '{table}'"
                );
            }
        }
    }

    #[test]
    fn merge_mode_keeps_local_rows_and_adds_missing_ones() {
        let (_dir, mut conn) = test_conn();
        conn.execute(
            "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('ws', 'Local Name', 'now', 'now')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chat_sessions (id, workspace_id, title) VALUES ('local-chat', 'ws', 'Local chat')",
            [],
        )
        .unwrap();

        let result = import_selective_data(
            &mut conn,
            &sample_backup(),
            &["ws".to_string()],
            &["chats".to_string(), "notes".to_string()],
            "merge",
        )
        .unwrap();

        // The pre-existing local chat survives, and the backup's chat is added.
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM chat_sessions"), 2);
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM chat_sessions WHERE id = 'local-chat'"),
            1
        );
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM chat_sessions WHERE id = 'backup-chat'"),
            1
        );
        // Merge must not clobber the local workspace's own name.
        let name: String = conn
            .query_row("SELECT name FROM workspaces WHERE id = 'ws'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "Local Name");
        assert_eq!(result.rows_imported, 2);
    }

    #[test]
    fn merge_mode_does_not_overwrite_a_locally_edited_row() {
        let (_dir, mut conn) = test_conn();
        conn.execute(
            "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('ws', 'Local', 'now', 'now')",
            [],
        )
        .unwrap();
        // Same id as the backup row, but locally renamed.
        conn.execute(
            "INSERT INTO chat_sessions (id, workspace_id, title) VALUES ('backup-chat', 'ws', 'Locally edited')",
            [],
        )
        .unwrap();

        import_selective_data(
            &mut conn,
            &sample_backup(),
            &["ws".to_string()],
            &["chats".to_string()],
            "merge",
        )
        .unwrap();

        let title: String = conn
            .query_row(
                "SELECT title FROM chat_sessions WHERE id = 'backup-chat'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(title, "Locally edited");
    }

    #[test]
    fn replace_mode_deletes_existing_workspace_data() {
        let (_dir, mut conn) = test_conn();
        conn.execute(
            "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('ws', 'Local Name', 'now', 'now')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chat_sessions (id, workspace_id, title) VALUES ('local-chat', 'ws', 'Local chat')",
            [],
        )
        .unwrap();

        import_selective_data(
            &mut conn,
            &sample_backup(),
            &["ws".to_string()],
            &["chats".to_string()],
            "replace",
        )
        .unwrap();

        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM chat_sessions WHERE id = 'local-chat'"),
            0
        );
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM chat_sessions WHERE id = 'backup-chat'"),
            1
        );
        let name: String = conn
            .query_row("SELECT name FROM workspaces WHERE id = 'ws'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "Backup Name");
    }

    #[test]
    fn unselected_categories_are_not_imported() {
        let (_dir, mut conn) = test_conn();

        let result = import_selective_data(
            &mut conn,
            &sample_backup(),
            &["ws".to_string()],
            &["notes".to_string()],
            "merge",
        )
        .unwrap();

        assert_eq!(count(&conn, "SELECT COUNT(*) FROM chat_sessions"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM project_notes"), 1);
        let notes = result
            .per_category
            .iter()
            .find(|c| c.id == "notes")
            .unwrap();
        assert_eq!(notes.row_count, 1);
        assert!(result.per_category.iter().all(|c| c.id != "chats"));
    }

    #[test]
    fn global_backup_imports_only_the_selected_workspace() {
        let (_dir, mut conn) = test_conn();
        let backup = serde_json::json!({
            "is_global": true,
            "created_at": "2026-01-01T00:00:00Z",
            "data": [
                {
                    "workspace": {"id": "ws-a", "name": "Alpha"},
                    "data": {"chat_sessions": [{"id": "chat-a", "workspace_id": "ws-a", "title": "A"}]}
                },
                {
                    "workspace": {"id": "ws-b", "name": "Beta"},
                    "data": {"chat_sessions": [{"id": "chat-b", "workspace_id": "ws-b", "title": "B"}]}
                }
            ]
        })
        .to_string();

        import_selective_data(
            &mut conn,
            &backup,
            &["ws-a".to_string()],
            &["chats".to_string()],
            "merge",
        )
        .unwrap();

        assert_eq!(count(&conn, "SELECT COUNT(*) FROM workspaces WHERE id = 'ws-a'"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM workspaces WHERE id = 'ws-b'"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM chat_sessions"), 1);
    }

    #[test]
    fn selective_import_rejects_bad_input() {
        let (_dir, mut conn) = test_conn();
        let backup = sample_backup();

        let empty_workspaces =
            import_selective_data(&mut conn, &backup, &[], &["chats".into()], "merge").unwrap_err();
        assert!(empty_workspaces.contains("at least one workspace"));

        let empty_categories =
            import_selective_data(&mut conn, &backup, &["ws".into()], &[], "merge").unwrap_err();
        assert!(empty_categories.contains("at least one data category"));

        let bad_mode =
            import_selective_data(&mut conn, &backup, &["ws".into()], &["chats".into()], "wipe")
                .unwrap_err();
        assert!(bad_mode.contains("Unknown import mode"));

        let bad_category =
            import_selective_data(&mut conn, &backup, &["ws".into()], &["nope".into()], "merge")
                .unwrap_err();
        assert!(bad_category.contains("Unknown import category"));

        let missing_workspace =
            import_selective_data(&mut conn, &backup, &["ghost".into()], &["chats".into()], "merge")
                .unwrap_err();
        assert!(missing_workspace.contains("not present in this backup"));
    }

    #[test]
    fn selective_import_rejects_unsafe_session_ids() {
        let (_dir, mut conn) = test_conn();
        let backup = serde_json::json!({
            "workspace": {"id": "ws", "name": "W"},
            "data": {"chat_sessions": [{"id": "../escape", "workspace_id": "ws"}]}
        })
        .to_string();

        assert!(import_selective_data(
            &mut conn,
            &backup,
            &["ws".into()],
            &["chats".into()],
            "merge",
        )
        .is_err());
    }

    #[test]
    fn backup_entries_normalize_both_envelope_shapes() {
        let per_workspace: serde_json::Value =
            serde_json::from_str(&sample_backup()).unwrap();
        let entries = backup_workspace_entries(&per_workspace).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(workspace_id_of(&entries[0].0).unwrap(), "ws");

        let global = serde_json::json!({
            "is_global": true,
            "data": [
                {"workspace": {"id": "ws-a", "name": "A"}, "data": {}},
                {"workspace": {"id": "ws-b", "name": "B"}, "data": {}}
            ]
        });
        let entries = backup_workspace_entries(&global).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(workspace_id_of(&entries[1].0).unwrap(), "ws-b");
    }
}
