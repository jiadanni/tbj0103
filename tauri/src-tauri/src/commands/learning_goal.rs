use crate::db::DbState;
use crate::models::learning_goal::{
    CreateLearningGoalRequest, LearningGoal, UpdateLearningGoalRequest,
};
use crate::services::workspace_hierarchy::workspace_filter_sql;
use tauri::State;

#[tauri::command]
pub fn create_learning_goal(
    state: State<DbState>,
    req: CreateLearningGoalRequest,
) -> Result<LearningGoal, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut g = LearningGoal::new(req.workspace_id, req.title);
    if let Some(d) = req.goal_description {
        g.goal_description = d;
    }
    if let Some(date) = req.due_date {
        g.due_date = Some(date);
    }
    if let Some(prereqs) = req.prerequisite_ids {
        g.prerequisite_ids = prereqs;
    }
    let prereq_json = serde_json::to_string(&g.prerequisite_ids).unwrap_or_default();
    let chat_json = serde_json::to_string(&g.related_chat_ids).unwrap_or_default();
    conn.execute(
        "INSERT INTO learning_goals (id, workspace_id, title, goal_description, progress, is_completed, due_date, prerequisite_ids, related_chat_ids, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![g.id, g.workspace_id, g.title, g.goal_description, g.progress, g.is_completed as i32, g.due_date, prereq_json, chat_json, g.created_at, g.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(g)
}

#[tauri::command]
pub fn list_learning_goals(
    state: State<DbState>,
    workspace_id: String,
    include_descendants: Option<bool>,
) -> Result<Vec<LearningGoal>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let (cte, ws_cond) = workspace_filter_sql(include_descendants.unwrap_or(false));
    let sql = format!(
        "{cte}SELECT id, workspace_id, title, goal_description, progress, is_completed, due_date, prerequisite_ids, related_chat_ids, created_at, updated_at
         FROM learning_goals WHERE workspace_id {ws_cond} ORDER BY created_at DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(rusqlite::params![workspace_id], |row| {
            let prereq_json: String = row.get(7)?;
            let chat_json: String = row.get(8)?;
            Ok(LearningGoal {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                title: row.get(2)?,
                goal_description: row.get(3)?,
                progress: row.get(4)?,
                is_completed: row.get::<_, i32>(5)? != 0,
                due_date: row.get(6)?,
                prerequisite_ids: serde_json::from_str(&prereq_json).unwrap_or_default(),
                related_chat_ids: serde_json::from_str(&chat_json).unwrap_or_default(),
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn update_learning_goal(
    state: State<DbState>,
    req: UpdateLearningGoalRequest,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let prereq_json = req
        .prerequisite_ids
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_default());
    conn.execute(
        "UPDATE learning_goals SET
            title = COALESCE(?1, title),
            goal_description = COALESCE(?2, goal_description),
            progress = COALESCE(?3, progress),
            is_completed = COALESCE(?4, is_completed),
            due_date = COALESCE(?5, due_date),
            prerequisite_ids = COALESCE(?6, prerequisite_ids),
            updated_at = ?7
         WHERE id = ?8",
        rusqlite::params![
            req.title,
            req.goal_description,
            req.progress,
            req.is_completed.map(|b| b as i32),
            req.due_date,
            prereq_json,
            now,
            req.id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_learning_goal(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM learning_goals WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
