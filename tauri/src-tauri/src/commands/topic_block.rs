use tauri::State;

use crate::db::DbState;
use crate::services::topic_block_service::{self, BlockedTopicRow};

#[derive(serde::Serialize)]
pub struct TopicListItem {
    pub concept_id: Option<String>,
    pub name: String,
    pub normalized_name: String,
    pub is_blocked: bool,
    pub card_count: i64,
    pub review_count: i64,
    pub source: String,
    pub created_at: Option<String>,
}

#[tauri::command]
pub fn block_topic(
    state: State<DbState>,
    workspace_id: String,
    name: String,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    topic_block_service::block_topic(&conn, &workspace_id, &name)
}

#[tauri::command]
pub fn unblock_topic(
    state: State<DbState>,
    workspace_id: String,
    normalized_name: String,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    topic_block_service::unblock_topic(&conn, &workspace_id, &normalized_name)
}

#[tauri::command]
pub fn list_blocked_topics(
    state: State<DbState>,
    workspace_id: String,
) -> Result<Vec<BlockedTopicRow>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    topic_block_service::list_blocked_topics(&conn, &workspace_id)
}

#[tauri::command]
pub fn list_all_topics(
    state: State<DbState>,
    workspace_id: String,
) -> Result<Vec<TopicListItem>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    // Fetch all concept nodes for this workspace, LEFT JOINing blocked_topics
    // and getting card counts through flashcard_topics (by normalized name match).
    let mut stmt = conn
        .prepare(
            "SELECT
                cn.id,
                cn.name,
                lower(trim(cn.name)) AS norm_name,
                CASE WHEN bt.id IS NOT NULL THEN 1 ELSE 0 END AS is_blocked,
                COALESCE(fc.card_count, 0) AS card_count,
                COALESCE(fc.review_count, 0) AS review_count,
                CASE
                    WHEN cn.source_model IS NOT NULL THEN 'ai'
                    ELSE 'heuristic'
                END AS source,
                cn.created_at
             FROM concept_nodes cn
             LEFT JOIN blocked_topics bt
                ON bt.workspace_id = cn.workspace_id
               AND bt.normalized_name = lower(trim(cn.name))
             LEFT JOIN (
                SELECT ft.workspace_id, lower(trim(ft.topic)) AS norm_topic,
                       ft.card_count,
                       COALESCE(SUM(CASE WHEN lc.repetitions > 0 THEN 1 ELSE 0 END), 0) AS review_count
                FROM flashcard_topics ft
                LEFT JOIN learning_cards lc ON lc.topic_id = ft.id
                GROUP BY ft.workspace_id, lower(trim(ft.topic))
             ) fc ON fc.workspace_id = cn.workspace_id AND fc.norm_topic = lower(trim(cn.name))
             WHERE cn.workspace_id = ?1
               AND (cn.superseded_by IS NULL OR cn.superseded_by = '')
             ORDER BY cn.name ASC",
        )
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map(rusqlite::params![workspace_id], |r| {
            Ok(TopicListItem {
                concept_id: r.get(0)?,
                name: r.get(1)?,
                normalized_name: r.get(2)?,
                is_blocked: r.get::<_, i64>(3)? != 0,
                card_count: r.get(4)?,
                review_count: r.get(5)?,
                source: r.get(6)?,
                created_at: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}
