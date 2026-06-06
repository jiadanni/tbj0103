use crate::db::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct LogEntry {
    pub id: i64,
    pub timestamp: String,
    pub level: String,
    pub source: String,
    pub message: String,
    pub metadata: String,
}

#[derive(Debug, Deserialize)]
pub struct GetLogsRequest {
    pub level: Option<String>,
    pub source: Option<String>,
    pub search: Option<String>,
    pub before: Option<String>,
    pub after: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct LogFrontendEventRequest {
    pub level: String,
    pub source: String,
    pub message: String,
    pub metadata: Option<String>,
}

#[tauri::command]
pub fn get_logs(state: State<DbState>, req: GetLogsRequest) -> Result<Vec<LogEntry>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    if let Some(ref level) = req.level {
        conditions.push(format!("level = ?{idx}"));
        params.push(Box::new(level.clone()));
        idx += 1;
    }
    if let Some(ref source) = req.source {
        conditions.push(format!("source = ?{idx}"));
        params.push(Box::new(source.clone()));
        idx += 1;
    }
    if let Some(ref search) = req.search {
        conditions.push(format!("message LIKE ?{idx}"));
        params.push(Box::new(format!("%{search}%")));
        idx += 1;
    }
    if let Some(ref after) = req.after {
        conditions.push(format!("timestamp >= ?{idx}"));
        params.push(Box::new(after.clone()));
        idx += 1;
    }
    if let Some(ref before) = req.before {
        conditions.push(format!("timestamp <= ?{idx}"));
        params.push(Box::new(before.clone()));
        idx += 1;
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let limit = req.limit.unwrap_or(500).min(5000);
    let offset = req.offset.unwrap_or(0);

    let sql = format!(
        "SELECT id, timestamp, level, source, message, metadata FROM app_logs {where_clause} ORDER BY id DESC LIMIT ?{idx} OFFSET ?{}",
        idx + 1
    );

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params
        .iter()
        .map(|p| p.as_ref())
        .chain(std::iter::once(&limit as &dyn rusqlite::types::ToSql))
        .chain(std::iter::once(&offset as &dyn rusqlite::types::ToSql))
        .collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(LogEntry {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                level: row.get(2)?,
                source: row.get(3)?,
                message: row.get(4)?,
                metadata: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
pub fn get_log_sources(state: State<DbState>) -> Result<Vec<String>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT source FROM app_logs ORDER BY source")
        .map_err(|e| e.to_string())?;
    let sources = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(sources)
}

#[tauri::command]
pub fn clear_logs(state: State<DbState>, before: Option<String>) -> Result<u64, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let deleted = if let Some(ref before) = before {
        conn.execute(
            "DELETE FROM app_logs WHERE timestamp <= ?1",
            rusqlite::params![before],
        )
    } else {
        conn.execute("DELETE FROM app_logs", [])
    }
    .map_err(|e| e.to_string())?;
    Ok(deleted as u64)
}

#[tauri::command]
pub fn set_log_level(level: String) -> Result<(), String> {
    match level.as_str() {
        "debug" | "info" | "warn" | "error" => {
            crate::logging::set_min_log_level(&level);
            Ok(())
        }
        other => Err(format!(
            "Invalid log level '{other}'. Must be debug, info, warn, or error."
        )),
    }
}

#[tauri::command]
pub async fn get_log_level() -> Result<String, String> {
    Ok(crate::logging::get_min_log_level())
}

#[tauri::command]
pub async fn log_frontend_event(
    state: State<'_, DbState>,
    req: LogFrontendEventRequest,
) -> Result<(), String> {
    // Clone the pool handle so the closure owns it on the blocking thread.
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let level = match req.level.as_str() {
            "debug" | "info" | "warn" | "error" => req.level.as_str(),
            _ => "info",
        };
        let metadata = req.metadata.as_deref().unwrap_or("{}");
        let conn = pool.get().map_err(|e| e.to_string())?;
        crate::logging::log_with_conn(&conn, level, &req.source, &req.message, metadata);
        Ok(())
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
}

#[derive(Debug, Deserialize)]
pub struct LogFrontendEventBatchRequest {
    pub events: Vec<LogFrontendEventRequest>,
}

#[tauri::command]
pub async fn log_frontend_events_batch(req: LogFrontendEventBatchRequest) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let entries: Vec<(String, String, String, String, String)> = req
            .events
            .iter()
            .map(|e| {
                let level = match e.level.as_str() {
                    "debug" | "info" | "warn" | "error" => e.level.clone(),
                    _ => "info".to_string(),
                };
                let metadata = e.metadata.clone().unwrap_or_else(|| "{}".to_string());
                let ts = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
                (ts, level, e.source.clone(), e.message.clone(), metadata)
            })
            .collect();
        crate::logging::persist_batch(&entries);
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))
}
