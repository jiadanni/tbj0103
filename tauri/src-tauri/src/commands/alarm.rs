use tauri::State;
use serde::{Deserialize, Serialize};
use crate::db::DbState;
use crate::models::alarm::{CalendarAlarm, CreateAlarmRequest};

#[tauri::command]
pub fn create_alarm(state: State<DbState>, req: CreateAlarmRequest) -> Result<CalendarAlarm, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let alarm = CalendarAlarm {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id: req.workspace_id,
        title: req.title,
        fire_date: req.fire_date,
        duration_seconds: req.duration_seconds.unwrap_or(0.0),
        input_prompt: req.input_prompt.unwrap_or_default(),
        is_dismissed: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    conn.execute(
        "INSERT INTO calendar_alarms (id, workspace_id, title, fire_date, duration_seconds, input_prompt, is_dismissed, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
        rusqlite::params![alarm.id, alarm.workspace_id, alarm.title, alarm.fire_date, alarm.duration_seconds, alarm.input_prompt, alarm.created_at],
    ).map_err(|e| e.to_string())?;
    Ok(alarm)
}

#[tauri::command]
pub fn list_alarms(state: State<DbState>, workspace_id: Option<String>) -> Result<Vec<CalendarAlarm>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let query = if workspace_id.is_some() {
        "SELECT id, workspace_id, title, fire_date, duration_seconds, input_prompt, is_dismissed, created_at
         FROM calendar_alarms WHERE workspace_id = ?1 AND is_dismissed = 0 ORDER BY fire_date ASC"
    } else {
        "SELECT id, workspace_id, title, fire_date, duration_seconds, input_prompt, is_dismissed, created_at
         FROM calendar_alarms WHERE is_dismissed = 0 ORDER BY fire_date ASC"
    };
    let ws_id = workspace_id.unwrap_or_default();
    let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
    let items = stmt.query_map(rusqlite::params![ws_id], |row| {
        Ok(CalendarAlarm {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            title: row.get(2)?,
            fire_date: row.get(3)?,
            duration_seconds: row.get(4)?,
            input_prompt: row.get(5)?,
            is_dismissed: row.get::<_, i32>(6)? != 0,
            created_at: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn delete_alarm(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE calendar_alarms SET is_dismissed = 1 WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
