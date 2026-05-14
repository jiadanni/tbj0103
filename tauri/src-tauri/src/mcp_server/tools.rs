use crate::db::DbState;
use crate::mcp_server::{CallToolResult, JsonRpcError, Tool, ToolContent};
use serde_json::{json, Value};
use std::sync::Arc;

pub fn search_notes_tool() -> Tool {
    Tool {
        name: "search_notes".to_string(),
        description: "Search for notes by keyword within a workspace".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "workspace_id": {
                    "type": "string",
                    "description": "The workspace ID to search within"
                },
                "query": {
                    "type": "string",
                    "description": "Search query keywords"
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum results to return (default 20)",
                    "default": 20
                }
            },
            "required": ["workspace_id", "query"]
        }),
    }
}

pub fn list_due_flashcards_tool() -> Tool {
    Tool {
        name: "list_due_flashcards".to_string(),
        description: "List flashcards due for review in a workspace".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "workspace_id": {
                    "type": "string",
                    "description": "The workspace ID"
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum cards to return (default 50)",
                    "default": 50
                }
            },
            "required": ["workspace_id"]
        }),
    }
}

pub fn get_concept_neighbors_tool() -> Tool {
    Tool {
        name: "get_concept_neighbors".to_string(),
        description: "Get related concepts (neighbors) in the knowledge graph".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "concept_id": {
                    "type": "string",
                    "description": "The concept node ID"
                }
            },
            "required": ["concept_id"]
        }),
    }
}

pub fn get_learning_goal_progress_tool() -> Tool {
    Tool {
        name: "get_learning_goal_progress".to_string(),
        description: "Get progress status for a learning goal".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "goal_id": {
                    "type": "string",
                    "description": "The learning goal ID"
                }
            },
            "required": ["goal_id"]
        }),
    }
}

pub fn search_chat_messages_tool() -> Tool {
    Tool {
        name: "search_chat_messages".to_string(),
        description: "Search chat messages within a workspace".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "workspace_id": {
                    "type": "string",
                    "description": "The workspace ID"
                },
                "query": {
                    "type": "string",
                    "description": "Search query keywords"
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum results to return (default 20)",
                    "default": 20
                }
            },
            "required": ["workspace_id", "query"]
        }),
    }
}

pub fn get_workspace_stats_tool() -> Tool {
    Tool {
        name: "get_workspace_stats".to_string(),
        description: "Get statistics about a workspace (note count, card count, graph size, etc.)"
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "workspace_id": {
                    "type": "string",
                    "description": "The workspace ID"
                }
            },
            "required": ["workspace_id"]
        }),
    }
}

pub async fn handle_search_notes(
    db_state: &Arc<DbState>,
    arguments: &Value,
) -> Result<CallToolResult, JsonRpcError> {
    let workspace_id = arguments
        .get("workspace_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| JsonRpcError {
            code: -32602,
            message: "Missing or invalid workspace_id".to_string(),
            data: None,
        })?;

    let query = arguments
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or_else(|| JsonRpcError {
            code: -32602,
            message: "Missing or invalid query".to_string(),
            data: None,
        })?;

    let limit = arguments
        .get("limit")
        .and_then(|v| v.as_i64())
        .unwrap_or(20) as usize;

    let conn = db_state.0.get().map_err(|_| JsonRpcError {
        code: -32603,
        message: "Failed to acquire database lock".to_string(),
        data: None,
    })?;

    let pattern = format!("%{}%", query.to_lowercase());
    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, created_at FROM notes
             WHERE workspace_id = ?1 AND (lower(title) LIKE ?2 OR lower(content) LIKE ?2)
             ORDER BY created_at DESC LIMIT ?3",
        )
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?;

    let results: Vec<Value> = stmt
        .query_map(rusqlite::params![workspace_id, pattern, limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "content": row.get::<_, String>(2)?,
                "created_at": row.get::<_, String>(3)?
            }))
        })
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?
        .filter_map(Result::ok)
        .collect();

    Ok(CallToolResult {
        content: vec![ToolContent {
            type_: "text".to_string(),
            text: serde_json::to_string(&results).unwrap_or_else(|_| "[]".to_string()),
        }],
        is_error: Some(false),
    })
}

pub async fn handle_list_due_flashcards(
    db_state: &Arc<DbState>,
    arguments: &Value,
) -> Result<CallToolResult, JsonRpcError> {
    let workspace_id = arguments
        .get("workspace_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| JsonRpcError {
            code: -32602,
            message: "Missing or invalid workspace_id".to_string(),
            data: None,
        })?;

    let limit = arguments
        .get("limit")
        .and_then(|v| v.as_i64())
        .unwrap_or(50) as usize;

    let conn = db_state.0.get().map_err(|_| JsonRpcError {
        code: -32603,
        message: "Failed to acquire database lock".to_string(),
        data: None,
    })?;

    let now = chrono::Utc::now().to_rfc3339();
    let mut stmt = conn
        .prepare(
            "SELECT lc.id, lc.front, lc.back, lc.next_review_at, lc.interval
             FROM learning_cards lc
             JOIN notes n ON lc.note_id = n.id
             WHERE n.workspace_id = ?1 AND lc.next_review_at <= ?2
             ORDER BY lc.next_review_at ASC LIMIT ?3",
        )
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?;

    let results: Vec<Value> = stmt
        .query_map(rusqlite::params![workspace_id, now, limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "front": row.get::<_, String>(1)?,
                "back": row.get::<_, String>(2)?,
                "next_review_at": row.get::<_, String>(3)?,
                "interval": row.get::<_, i64>(4)?
            }))
        })
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?
        .filter_map(Result::ok)
        .collect();

    Ok(CallToolResult {
        content: vec![ToolContent {
            type_: "text".to_string(),
            text: serde_json::to_string(&results).unwrap_or_else(|_| "[]".to_string()),
        }],
        is_error: Some(false),
    })
}

pub async fn handle_get_concept_neighbors(
    db_state: &Arc<DbState>,
    arguments: &Value,
) -> Result<CallToolResult, JsonRpcError> {
    let concept_id = arguments
        .get("concept_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| JsonRpcError {
            code: -32602,
            message: "Missing or invalid concept_id".to_string(),
            data: None,
        })?;

    let conn = db_state.0.get().map_err(|_| JsonRpcError {
        code: -32603,
        message: "Failed to acquire database lock".to_string(),
        data: None,
    })?;

    let mut stmt = conn
        .prepare(
            "SELECT cn.id, cn.name, cl.link_type
             FROM concept_links cl
             JOIN concept_nodes cn ON (
                 (cl.source_id = ?1 AND cl.target_id = cn.id) OR
                 (cl.target_id = ?1 AND cl.source_id = cn.id)
             )
             ORDER BY cn.name",
        )
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?;

    let results: Vec<Value> = stmt
        .query_map(rusqlite::params![concept_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "link_type": row.get::<_, String>(2)?
            }))
        })
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?
        .filter_map(Result::ok)
        .collect();

    Ok(CallToolResult {
        content: vec![ToolContent {
            type_: "text".to_string(),
            text: serde_json::to_string(&results).unwrap_or_else(|_| "[]".to_string()),
        }],
        is_error: Some(false),
    })
}

pub async fn handle_get_learning_goal_progress(
    db_state: &Arc<DbState>,
    arguments: &Value,
) -> Result<CallToolResult, JsonRpcError> {
    let goal_id = arguments
        .get("goal_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| JsonRpcError {
            code: -32602,
            message: "Missing or invalid goal_id".to_string(),
            data: None,
        })?;

    let conn = db_state.0.get().map_err(|_| JsonRpcError {
        code: -32603,
        message: "Failed to acquire database lock".to_string(),
        data: None,
    })?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, description, status, target_date, created_at FROM learning_goals
             WHERE id = ?1",
        )
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?;

    let result = stmt
        .query_row(rusqlite::params![goal_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "description": row.get::<_, String>(2)?,
                "status": row.get::<_, String>(3)?,
                "target_date": row.get::<_, String>(4)?,
                "created_at": row.get::<_, String>(5)?
            }))
        })
        .map_err(|_| JsonRpcError {
            code: -32603,
            message: format!("Learning goal not found: {}", goal_id),
            data: None,
        })?;

    Ok(CallToolResult {
        content: vec![ToolContent {
            type_: "text".to_string(),
            text: serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string()),
        }],
        is_error: Some(false),
    })
}

pub async fn handle_search_chat_messages(
    db_state: &Arc<DbState>,
    arguments: &Value,
) -> Result<CallToolResult, JsonRpcError> {
    let workspace_id = arguments
        .get("workspace_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| JsonRpcError {
            code: -32602,
            message: "Missing or invalid workspace_id".to_string(),
            data: None,
        })?;

    let query = arguments
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or_else(|| JsonRpcError {
            code: -32602,
            message: "Missing or invalid query".to_string(),
            data: None,
        })?;

    let limit = arguments
        .get("limit")
        .and_then(|v| v.as_i64())
        .unwrap_or(20) as usize;

    let conn = db_state.0.get().map_err(|_| JsonRpcError {
        code: -32603,
        message: "Failed to acquire database lock".to_string(),
        data: None,
    })?;

    let pattern = format!("%{}%", query.to_lowercase());
    let mut stmt = conn
        .prepare(
            "SELECT m.id, cs.title, m.content, m.created_at, m.role
             FROM messages m
             JOIN chat_sessions cs ON m.session_id = cs.id
             JOIN folders p ON cs.folder_id = p.id
             WHERE p.workspace_id = ?1 AND lower(m.content) LIKE ?2
             ORDER BY m.created_at DESC LIMIT ?3",
        )
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?;

    let results: Vec<Value> = stmt
        .query_map(rusqlite::params![workspace_id, pattern, limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "session_title": row.get::<_, String>(1)?,
                "content": row.get::<_, String>(2)?,
                "created_at": row.get::<_, String>(3)?,
                "role": row.get::<_, String>(4)?
            }))
        })
        .map_err(|e| JsonRpcError {
            code: -32603,
            message: format!("Database error: {}", e),
            data: None,
        })?
        .filter_map(Result::ok)
        .collect();

    Ok(CallToolResult {
        content: vec![ToolContent {
            type_: "text".to_string(),
            text: serde_json::to_string(&results).unwrap_or_else(|_| "[]".to_string()),
        }],
        is_error: Some(false),
    })
}

pub async fn handle_get_workspace_stats(
    db_state: &Arc<DbState>,
    arguments: &Value,
) -> Result<CallToolResult, JsonRpcError> {
    let workspace_id = arguments
        .get("workspace_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| JsonRpcError {
            code: -32602,
            message: "Missing or invalid workspace_id".to_string(),
            data: None,
        })?;

    let conn = db_state.0.get().map_err(|_| JsonRpcError {
        code: -32603,
        message: "Failed to acquire database lock".to_string(),
        data: None,
    })?;

    let note_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM notes WHERE workspace_id = ?1",
            rusqlite::params![workspace_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let concept_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = ?1",
            rusqlite::params![workspace_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let card_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learning_cards lc
             JOIN notes n ON lc.note_id = n.id
             WHERE n.workspace_id = ?1",
            rusqlite::params![workspace_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let chat_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chat_sessions cs
             JOIN folders p ON cs.folder_id = p.id
             WHERE p.workspace_id = ?1",
            rusqlite::params![workspace_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let result = json!({
        "workspace_id": workspace_id,
        "note_count": note_count,
        "concept_count": concept_count,
        "flashcard_count": card_count,
        "chat_session_count": chat_count
    });

    Ok(CallToolResult {
        content: vec![ToolContent {
            type_: "text".to_string(),
            text: serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string()),
        }],
        is_error: Some(false),
    })
}
