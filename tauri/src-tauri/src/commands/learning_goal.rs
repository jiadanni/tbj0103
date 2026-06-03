use crate::db::DbState;
use crate::models::learning_goal::{
    CreateLearningGoalRequest, LearningGoal, UpdateLearningGoalRequest,
};
use crate::services::workspace_hierarchy::{workspace_filter_sql, ANCESTORS_CTE_PREFIX};
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
    // Existing user databases still carry the dead columns prerequisite_ids,
    // related_chat_ids, concept_id from earlier schemas. Insert harmless
    // defaults for them so the CHECK constraints and FK relationships keep
    // accepting writes; fresh installs simply ignore the unknown column names.
    conn.execute(
        "INSERT INTO learning_goals (id, workspace_id, title, goal_description, progress, is_completed, due_date, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![g.id, g.workspace_id, g.title, g.goal_description, g.progress, g.is_completed as i32, g.due_date, g.created_at, g.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(g)
}

#[tauri::command]
pub fn list_learning_goals(
    state: State<DbState>,
    workspace_id: String,
    include_descendants: Option<bool>,
    include_ancestors: Option<bool>,
) -> Result<Vec<LearningGoal>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let inherit = include_ancestors.unwrap_or(false);
    let (cte, ws_cond) = if inherit {
        (ANCESTORS_CTE_PREFIX, "IN (SELECT id FROM ws_ancestors)")
    } else {
        workspace_filter_sql(include_descendants.unwrap_or(false))
    };
    let sql = format!(
        "{cte}SELECT id, workspace_id, title, goal_description, progress, is_completed, due_date, created_at, updated_at
         FROM learning_goals WHERE workspace_id {ws_cond}
         ORDER BY created_at DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(rusqlite::params![workspace_id], |row| {
            Ok(LearningGoal {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                title: row.get(2)?,
                goal_description: row.get(3)?,
                progress: row.get(4)?,
                is_completed: row.get::<_, i32>(5)? != 0,
                due_date: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
    conn.execute(
        "UPDATE learning_goals SET
            title = COALESCE(?1, title),
            goal_description = COALESCE(?2, goal_description),
            progress = COALESCE(?3, progress),
            is_completed = COALESCE(?4, is_completed),
            due_date = COALESCE(?5, due_date),
            updated_at = ?6
         WHERE id = ?7",
        rusqlite::params![
            req.title,
            req.goal_description,
            req.progress,
            req.is_completed.map(|b| b as i32),
            req.due_date,
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
