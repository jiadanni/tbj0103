use crate::commands::settings::get_setting;
use crate::db::DbState;
use crate::logging;
use crate::models::dashboard::{
    DashboardContinueLearning, DashboardLayout, DashboardLayoutSection, DashboardOverview,
    DashboardReviewSummary, DashboardRoute, DashboardSummary, ReviewTopic,
};
use crate::services::workspace_hierarchy::workspace_filter_sql;
use rusqlite::params;
use tauri::State;

const DEFAULT_LAYOUT_KEY: &str = "dashboard.layout.default";
const LEARNING_ACTIVITY_SECTION_ID: &str = "learning_activity";
const LEGACY_ACTIVITY_SECTION_IDS: [&str; 2] = ["continue_learning", "recent_activity"];

fn workspace_layout_key(workspace_id: &str) -> String {
    format!("dashboard.layout.workspace.{workspace_id}")
}

fn default_layout() -> DashboardLayout {
    DashboardLayout {
        version: 1,
        sections: vec![DashboardLayoutSection {
            id: LEARNING_ACTIVITY_SECTION_ID.into(),
            hidden: false,
        }],
    }
}

fn normalize_dashboard_layout(mut layout: DashboardLayout) -> DashboardLayout {
    let legacy_sections: Vec<&DashboardLayoutSection> = layout
        .sections
        .iter()
        .filter(|section| LEGACY_ACTIVITY_SECTION_IDS.contains(&section.id.as_str()))
        .collect();
    let legacy_hidden = if legacy_sections.len() > 1 {
        legacy_sections.iter().all(|section| section.hidden)
    } else {
        legacy_sections
            .first()
            .map(|section| section.hidden)
            .unwrap_or(false)
    };

    let mut inserted_learning_activity = false;
    let mut normalized = Vec::with_capacity(layout.sections.len() + 1);

    for section in std::mem::take(&mut layout.sections) {
        if LEGACY_ACTIVITY_SECTION_IDS.contains(&section.id.as_str()) {
            if !inserted_learning_activity {
                normalized.push(DashboardLayoutSection {
                    id: LEARNING_ACTIVITY_SECTION_ID.into(),
                    hidden: legacy_hidden,
                });
                inserted_learning_activity = true;
            }
            continue;
        }

        if section.id == LEARNING_ACTIVITY_SECTION_ID {
            if !inserted_learning_activity {
                normalized.push(section);
                inserted_learning_activity = true;
            }
            continue;
        }

        // Drop any retired section ids (quiz_topics, goals, suggestions,
        // weak_concepts, knowledge_health) — they no longer have renderers.
        match section.id.as_str() {
            "quiz_topics" | "goals" | "suggestions" | "weak_concepts" | "knowledge_health" => {
                continue;
            }
            _ => normalized.push(section),
        }
    }

    layout.sections = normalized;
    layout
}

fn parse_layout(raw: &str) -> Option<DashboardLayout> {
    serde_json::from_str::<DashboardLayout>(raw)
        .ok()
        .map(|layout| {
            let mut layout = normalize_dashboard_layout(layout);
            let default = default_layout();
            let known: std::collections::HashSet<String> =
                layout.sections.iter().map(|s| s.id.clone()).collect();
            for section in default.sections {
                if !known.contains(&section.id) {
                    layout.sections.push(section);
                }
            }
            layout
        })
}

#[tauri::command]
pub fn get_dashboard_layout(
    state: State<DbState>,
    workspace_id: String,
) -> Result<DashboardLayout, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    if let Some(raw) = get_setting(&conn, &workspace_layout_key(&workspace_id)) {
        if let Some(layout) = parse_layout(&raw) {
            return Ok(layout);
        }
    }
    if let Some(raw) = get_setting(&conn, DEFAULT_LAYOUT_KEY) {
        if let Some(layout) = parse_layout(&raw) {
            return Ok(layout);
        }
    }
    Ok(default_layout())
}

#[tauri::command]
pub fn set_dashboard_layout(
    state: State<DbState>,
    workspace_id: String,
    layout: DashboardLayout,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let value = serde_json::to_string(&layout).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![workspace_layout_key(&workspace_id), value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn reset_dashboard_layout(
    state: State<DbState>,
    workspace_id: String,
) -> Result<DashboardLayout, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM settings WHERE key = ?1",
        params![workspace_layout_key(&workspace_id)],
    )
    .map_err(|e| e.to_string())?;
    if let Some(raw) = get_setting(&conn, DEFAULT_LAYOUT_KEY) {
        if let Some(layout) = parse_layout(&raw) {
            return Ok(layout);
        }
    }
    Ok(default_layout())
}

fn route(path: impl Into<String>, state: Option<serde_json::Value>) -> DashboardRoute {
    DashboardRoute {
        path: path.into(),
        state,
    }
}

fn snippet(raw: String, max_chars: usize) -> String {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > max_chars {
        let truncated: String = collapsed
            .chars()
            .take(max_chars.saturating_sub(1))
            .collect();
        format!("{truncated}…")
    } else {
        collapsed
    }
}

#[tauri::command]
pub fn get_dashboard_summary(
    state: State<DbState>,
    workspace_id: String,
    include_descendants: Option<bool>,
) -> Result<DashboardSummary, String> {
    let started = std::time::Instant::now();
    let result = get_dashboard_summary_inner(state, workspace_id, include_descendants);
    let ms = started.elapsed().as_millis();
    if ms >= 16 {
        logging::log_debug("perf", format!("get_dashboard_summary {}ms", ms));
    }
    result
}

#[allow(clippy::type_complexity)]
fn get_dashboard_summary_inner(
    state: State<DbState>,
    workspace_id: String,
    include_descendants: Option<bool>,
) -> Result<DashboardSummary, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let (cte, ws_cond) = workspace_filter_sql(include_descendants.unwrap_or(false));

    let workspace_name: String = conn
        .query_row(
            "SELECT name FROM workspaces WHERE id = ?1",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // A topic is "due for review" if any of its flashcards are due today.
    // The dashboard used to also factor in quiz scores and at-risk learning
    // goals (linked via learning_goals.concept_id), but both branches were
    // removed when the AI-scored dashboard panels were retired and the
    // concept_id linkage on goals was dropped.
    let due_topic_predicate = "EXISTS (
        SELECT 1
        FROM learning_cards lc
        WHERE lc.workspace_id = cn.workspace_id
          AND lower(lc.topic_id) = lower(cn.id)
          AND lc.next_review_date <= date('now')
    )";

    let counts_sql = format!(
        "{cte}SELECT
            cs.chat_sessions,
            pn.notes,
            s.sources,
            cn.topics,
            lc.flashcards,
            lg.active_goals,
            lg.completed_goals,
            lc.total_cards,
            lc.due_today,
            lc.learned,
            lc.avg_ease,
            td.topics_due_for_review,
            tdn.top_due_topic
        FROM
            (SELECT COUNT(*) AS chat_sessions FROM chat_sessions WHERE workspace_id {ws_cond} AND is_deleted = 0 AND is_incognito = 0 AND exclude_from_analytics = 0) cs,
            (SELECT COUNT(*) AS notes FROM project_notes WHERE workspace_id {ws_cond}) pn,
            (SELECT COUNT(*) AS sources FROM sources WHERE workspace_id {ws_cond}) s,
            (SELECT COUNT(*) AS topics FROM concept_nodes WHERE workspace_id {ws_cond} AND (superseded_by IS NULL OR superseded_by = '')) cn,
            (SELECT
                COUNT(*) AS flashcards,
                COUNT(*) AS total_cards,
                COALESCE(SUM(CASE WHEN next_review_date <= date('now') THEN 1 ELSE 0 END), 0) AS due_today,
                COALESCE(SUM(CASE WHEN repetitions > 0 THEN 1 ELSE 0 END), 0) AS learned,
                COALESCE(AVG(ease_factor), 2.5) AS avg_ease
             FROM learning_cards WHERE workspace_id {ws_cond}) lc,
            (SELECT
                COALESCE(SUM(CASE WHEN is_completed = 0 THEN 1 ELSE 0 END), 0) AS active_goals,
                COALESCE(SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END), 0) AS completed_goals
             FROM learning_goals WHERE workspace_id {ws_cond}) lg,
            (SELECT COUNT(DISTINCT cn.id) AS topics_due_for_review
             FROM concept_nodes cn
             WHERE cn.workspace_id {ws_cond}
               AND (cn.superseded_by IS NULL OR cn.superseded_by = '')
               AND {due_topic_predicate}) td,
            (SELECT (
                SELECT cn.name
                FROM concept_nodes cn
                WHERE cn.workspace_id {ws_cond}
                  AND (cn.superseded_by IS NULL OR cn.superseded_by = '')
                  AND {due_topic_predicate}
                ORDER BY cn.updated_at ASC, cn.name ASC
                LIMIT 1
             ) AS top_due_topic) tdn"
    );

    let (
        chat_sessions,
        notes,
        sources,
        topics,
        flashcards,
        active_goals,
        completed_goals,
        total_cards,
        due_today,
        learned,
        avg_ease,
        topics_due_for_review,
        top_due_topic,
    ): (
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        f64,
        i64,
        Option<String>,
    ) = conn
        .query_row(&counts_sql, params![&workspace_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                row.get(9)?,
                row.get(10)?,
                row.get(11)?,
                row.get(12)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut continue_learning_stmt = conn
        .prepare(&format!(
            "{cte}SELECT s.id,
                    s.title,
                    NULLIF(s.folder_id, ''),
                    p.name,
                    COALESCE(s.last_accessed_at, s.updated_at) AS last_seen,
                    COALESCE(s.message_count, 0) AS msg_count,
                    (SELECT m.content FROM messages m
                       WHERE m.session_id = s.id
                       ORDER BY m.created_at DESC LIMIT 1) AS last_content,
                    (SELECT m.role FROM messages m
                       WHERE m.session_id = s.id
                       ORDER BY m.created_at DESC LIMIT 1) AS last_role
             FROM chat_sessions s
             LEFT JOIN folders p ON p.id = s.folder_id
             WHERE s.workspace_id {ws_cond}
               AND s.is_deleted = 0
               AND s.is_incognito = 0
               AND s.exclude_from_analytics = 0
             ORDER BY last_seen DESC
             LIMIT 12"
        ))
        .map_err(|e| e.to_string())?;
    let continue_learning = continue_learning_stmt
        .query_map(params![&workspace_id], |row| {
            let session_id = row.get::<_, String>(0)?;
            let raw_snippet: Option<String> = row.get(6)?;
            let last_snippet = raw_snippet.map(|s| snippet(s, 160));
            Ok(DashboardContinueLearning {
                session_id: session_id.clone(),
                title: row.get(1)?,
                folder_id: row.get(2)?,
                folder_name: row.get(3)?,
                updated_at: row.get(4)?,
                message_count: row.get(5)?,
                last_snippet,
                last_role: row.get(7)?,
                route: route(format!("/chat/{session_id}"), None),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(DashboardSummary {
        workspace_id,
        workspace_name,
        overview: DashboardOverview {
            chat_sessions,
            notes,
            sources,
            topics,
            flashcards,
            active_goals,
            completed_goals,
        },
        continue_learning,
        review: DashboardReviewSummary {
            due_today,
            total_cards,
            learned,
            avg_ease,
            route: route("/review-topics", None),
            topics_due_for_review,
            top_due_topic,
        },
    })
}

#[tauri::command]
pub fn get_review_topics(
    state: State<DbState>,
    workspace_id: String,
    include_descendants: Option<bool>,
) -> Result<Vec<ReviewTopic>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let (cte, ws_cond) = workspace_filter_sql(include_descendants.unwrap_or(false));

    // After the AI-scored review surface was removed, "due for review" is
    // simply: a topic has at least one flashcard due today.
    let sql = format!(
        "{cte}SELECT
            cn.id,
            cn.name,
            CAST((julianday('now') - julianday(cn.updated_at)) AS INTEGER) AS days_since_seen
         FROM concept_nodes cn
         WHERE cn.workspace_id {ws_cond}
           AND EXISTS (
             SELECT 1
             FROM learning_cards lc
             WHERE lc.workspace_id = cn.workspace_id
               AND lower(lc.topic_id) = lower(cn.id)
               AND lc.next_review_date <= date('now')
           )
         ORDER BY cn.updated_at ASC, cn.name ASC"
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![&workspace_id], |row| {
            let concept_id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let days_since_seen: i64 = row.get(2)?;

            let detail = if days_since_seen <= 1 {
                "flashcards due today".to_string()
            } else {
                format!("flashcards due, last seen {days_since_seen}d ago")
            };

            Ok(ReviewTopic {
                concept_id,
                name,
                reason_kind: "stale".to_string(),
                detail,
                priority: 2,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}
