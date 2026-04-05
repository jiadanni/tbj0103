use crate::db::DbState;
use crate::mcp_server::{JsonRpcError, ReadResourceResult, ToolContent};
use serde_json::{json, Value};
use std::sync::Arc;

pub async fn handle_read_resource(
    db_state: &Arc<DbState>,
    uri: &str,
) -> Result<ReadResourceResult, JsonRpcError> {
    // Parse URI patterns
    if uri == "aetherium://workspace" {
        return read_workspaces(db_state).await;
    }

    if let Some(workspace_id) = uri
        .strip_prefix("aetherium://workspace/")
        .and_then(|s| s.split('/').next())
    {
        if uri.ends_with("/notes") {
            return read_workspace_notes(db_state, workspace_id).await;
        }
        if uri.ends_with("/concepts") {
            return read_workspace_concepts(db_state, workspace_id).await;
        }
    }

    if let Some(note_id) = uri.strip_prefix("aetherium://note/") {
        return read_note(db_state, note_id).await;
    }

    if let Some(concept_id) = uri.strip_prefix("aetherium://concept/") {
        return read_concept(db_state, concept_id).await;
    }

    Err(JsonRpcError {
        code: -32602,
        message: format!("Unknown resource URI: {}", uri),
        data: None,
    })
}

async fn read_workspaces(db_state: &Arc<DbState>) -> Result<ReadResourceResult, JsonRpcError> {
    let conn = db_state.0.get().map_err(|_| JsonRpcError {
        code: -32603,
        message: "Failed to acquire database lock".to_string(),
        data: None,
    })?;

    let mut stmt = conn
        .prepare("SELECT id, name FROM workspaces ORDER BY name")
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?;

    let workspaces: Vec<Value> = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?
            }))
        })
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?
        .filter_map(Result::ok)
        .collect();

    Ok(ReadResourceResult {
        mime_type: Some("application/json".to_string()),
        contents: vec![ToolContent {
            type_: "text".to_string(),
            text: serde_json::to_string(&workspaces).unwrap_or_else(|_| "[]".to_string()),
        }],
    })
}

async fn read_workspace_notes(
    db_state: &Arc<DbState>,
    workspace_id: &str,
) -> Result<ReadResourceResult, JsonRpcError> {
    let conn = db_state.0.get().map_err(|_| JsonRpcError {
        code: -32603,
        message: "Failed to acquire database lock".to_string(),
        data: None,
    })?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, created_at, updated_at FROM notes
             WHERE workspace_id = ?1 ORDER BY updated_at DESC",
        )
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?;

    let notes: Vec<Value> = stmt
        .query_map(rusqlite::params![workspace_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "created_at": row.get::<_, String>(2)?,
                "updated_at": row.get::<_, String>(3)?
            }))
        })
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?
        .filter_map(Result::ok)
        .collect();

    Ok(ReadResourceResult {
        mime_type: Some("application/json".to_string()),
        contents: vec![ToolContent {
            type_: "text".to_string(),
            text: serde_json::to_string(&notes).unwrap_or_else(|_| "[]".to_string()),
        }],
    })
}

async fn read_workspace_concepts(
    db_state: &Arc<DbState>,
    workspace_id: &str,
) -> Result<ReadResourceResult, JsonRpcError> {
    let conn = db_state.0.get().map_err(|_| JsonRpcError {
        code: -32603,
        message: "Failed to acquire database lock".to_string(),
        data: None,
    })?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, concept_description FROM concept_nodes
             WHERE workspace_id = ?1 ORDER BY name",
        )
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?;

    let concepts: Vec<Value> = stmt
        .query_map(rusqlite::params![workspace_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, String>(2)?
            }))
        })
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?
        .filter_map(Result::ok)
        .collect();

    Ok(ReadResourceResult {
        mime_type: Some("application/json".to_string()),
        contents: vec![ToolContent {
            type_: "text".to_string(),
            text: serde_json::to_string(&concepts).unwrap_or_else(|_| "[]".to_string()),
        }],
    })
}

async fn read_note(
    db_state: &Arc<DbState>,
    note_id: &str,
) -> Result<ReadResourceResult, JsonRpcError> {
    let conn = db_state.0.get().map_err(|_| JsonRpcError {
        code: -32603,
        message: "Failed to acquire database lock".to_string(),
        data: None,
    })?;

    let mut stmt = conn
        .prepare("SELECT id, title, content, created_at, updated_at FROM notes WHERE id = ?1")
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?;

    let content = stmt
        .query_row(rusqlite::params![note_id], |row| {
            Ok(format!(
                "# {}\n\n{}\n\nCreated: {}\nUpdated: {}",
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?
            ))
        })
        .map_err(|_| JsonRpcError {
            code: -32603,
            message: format!("Note not found: {}", note_id),
            data: None,
        })?;

    Ok(ReadResourceResult {
        mime_type: Some("text/markdown".to_string()),
        contents: vec![ToolContent {
            type_: "text".to_string(),
            text: content,
        }],
    })
}

async fn read_concept(
    db_state: &Arc<DbState>,
    concept_id: &str,
) -> Result<ReadResourceResult, JsonRpcError> {
    let conn = db_state.0.get().map_err(|_| JsonRpcError {
        code: -32603,
        message: "Failed to acquire database lock".to_string(),
        data: None,
    })?;

    let mut stmt = conn
        .prepare("SELECT id, name, concept_description FROM concept_nodes WHERE id = ?1")
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?;

    let concept = stmt
        .query_row(rusqlite::params![concept_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, String>(2)?
            }))
        })
        .map_err(|_| JsonRpcError {
            code: -32603,
            message: format!("Concept not found: {}", concept_id),
            data: None,
        })?;

    Ok(ReadResourceResult {
        mime_type: Some("application/json".to_string()),
        contents: vec![ToolContent {
            type_: "text".to_string(),
            text: serde_json::to_string(&concept).unwrap_or_else(|_| "{}".to_string()),
        }],
    })
}
