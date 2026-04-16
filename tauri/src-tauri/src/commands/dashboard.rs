use crate::db::DbState;
use crate::models::dashboard::{
    DashboardActivity, DashboardConceptFocus, DashboardContinueLearning, DashboardGoalSummary,
    DashboardKnowledgeHealth, DashboardOverview, DashboardReviewSummary, DashboardRoute,
    DashboardSuggestion, DashboardSummary,
};
use crate::models::workspace::TopicSignature;
use rusqlite::params;
use tauri::State;

fn route(path: impl Into<String>, state: Option<serde_json::Value>) -> DashboardRoute {
    DashboardRoute {
        path: path.into(),
        state,
    }
}

#[tauri::command]
pub fn get_dashboard_summary(
    state: State<DbState>,
    workspace_id: String,
) -> Result<DashboardSummary, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    let (workspace_name, topic_signature_json): (String, String) = conn
        .query_row(
            "SELECT name, topic_signature FROM workspaces WHERE id = ?1",
            params![&workspace_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let topic_signature: TopicSignature =
        serde_json::from_str(&topic_signature_json).unwrap_or_default();
    let active_topic_tags = topic_signature
        .domain_tags
        .iter()
        .take(6)
        .map(|tag| tag.tag.clone())
        .collect::<Vec<_>>();

    let chat_sessions: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM chat_sessions
             WHERE workspace_id = ?1
               AND is_deleted = 0
               AND is_incognito = 0
               AND exclude_from_analytics = 0",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let notes: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM project_notes WHERE workspace_id = ?1",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let sources: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sources WHERE workspace_id = ?1",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let concepts: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = ?1",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let flashcards: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learning_cards WHERE workspace_id = ?1",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let active_goals: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM learning_goals
             WHERE workspace_id = ?1 AND is_completed = 0",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let completed_goals: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM learning_goals
             WHERE workspace_id = ?1 AND is_completed = 1",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let total_cards: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learning_cards WHERE workspace_id = ?1",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let due_today: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM learning_cards
             WHERE workspace_id = ?1
               AND next_review_date <= date('now')",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let learned: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM learning_cards
             WHERE workspace_id = ?1 AND repetitions > 0",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let avg_ease: f64 = conn
        .query_row(
            "SELECT COALESCE(AVG(ease_factor), 2.5)
             FROM learning_cards
             WHERE workspace_id = ?1",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let under_reviewed_concepts: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM concept_nodes
             WHERE workspace_id = ?1
               AND review_count <= 1",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let mut weak_concepts_stmt = conn
        .prepare(
            "SELECT id, name, review_count
             FROM concept_nodes
             WHERE workspace_id = ?1
               AND review_count <= 1
             ORDER BY review_count ASC, updated_at DESC
             LIMIT 4",
        )
        .map_err(|e| e.to_string())?;
    let weak_concepts = weak_concepts_stmt
        .query_map(params![&workspace_id], |row| {
            let concept_id = row.get::<_, String>(0)?;
            let name = row.get::<_, String>(1)?;
            let review_count = row.get::<_, i64>(2)?;
            let reason = if review_count == 0 {
                "Not reinforced yet".to_string()
            } else {
                "Needs another review pass".to_string()
            };

            Ok(DashboardConceptFocus {
                concept_id: concept_id.clone(),
                name,
                review_count,
                reason,
                route: route("/graph", None),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let continue_learning = conn
        .query_row(
            "SELECT s.id,
                    s.title,
                    NULLIF(s.project_id, ''),
                    p.name,
                    COALESCE(s.last_accessed_at, s.updated_at) AS last_seen
             FROM chat_sessions s
             LEFT JOIN projects p ON p.id = s.project_id
             WHERE s.workspace_id = ?1
               AND s.is_deleted = 0
               AND s.is_incognito = 0
               AND s.exclude_from_analytics = 0
             ORDER BY last_seen DESC
             LIMIT 1",
            params![&workspace_id],
            |row| {
                let session_id = row.get::<_, String>(0)?;
                Ok(DashboardContinueLearning {
                    session_id: session_id.clone(),
                    title: row.get(1)?,
                    project_id: row.get(2)?,
                    project_name: row.get(3)?,
                    updated_at: row.get(4)?,
                    route: route(format!("/chat/{session_id}"), None),
                })
            },
        )
        .ok();

    let mut goals_stmt = conn
        .prepare(
            "SELECT id, title, progress, is_completed, due_date, updated_at
             FROM learning_goals
             WHERE workspace_id = ?1
             ORDER BY is_completed ASC, progress ASC, updated_at DESC
             LIMIT 4",
        )
        .map_err(|e| e.to_string())?;
    let goals = goals_stmt
        .query_map(params![&workspace_id], |row| {
            Ok(DashboardGoalSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                progress: row.get(2)?,
                is_completed: row.get::<_, i64>(3)? != 0,
                due_date: row.get(4)?,
                updated_at: row.get(5)?,
                route: route("/learning", None),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let stalled_goals: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM learning_goals
             WHERE workspace_id = ?1
               AND is_completed = 0
               AND substr(updated_at, 1, 10) <= date('now', '-14 days')",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let unprocessed_sources: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM sources
             WHERE workspace_id = ?1
               AND is_processed = 0",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let isolated_concepts: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM concept_nodes c
             WHERE c.workspace_id = ?1
               AND NOT EXISTS (
                   SELECT 1
                   FROM concept_links l
                   WHERE l.source_id = c.id OR l.target_id = c.id
               )",
            params![&workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let mut activity_stmt = conn
        .prepare(
            "SELECT *
             FROM (
                SELECT n.id AS id,
                       n.title AS title,
                       'note' AS kind,
                       COALESCE(n.note_type, '') AS subtitle,
                       n.updated_at AS timestamp
                FROM project_notes n
                WHERE n.workspace_id = ?1

                UNION ALL

                SELECT c.id AS id,
                       c.name AS title,
                       'concept' AS kind,
                       COALESCE(c.concept_type, '') AS subtitle,
                       c.updated_at AS timestamp
                FROM concept_nodes c
                WHERE c.workspace_id = ?1

                UNION ALL

                SELECT s.id AS id,
                       s.title AS title,
                       'chat' AS kind,
                       COALESCE(p.name, '') AS subtitle,
                       s.updated_at AS timestamp
                FROM chat_sessions s
                LEFT JOIN projects p ON p.id = s.project_id
                WHERE s.workspace_id = ?1
                  AND s.is_deleted = 0
                  AND s.is_incognito = 0
                  AND s.exclude_from_analytics = 0

                UNION ALL

                SELECT src.id AS id,
                       src.title AS title,
                       'source' AS kind,
                       COALESCE(src.source_type, '') AS subtitle,
                       src.updated_at AS timestamp
                FROM sources src
                WHERE src.workspace_id = ?1
             )
             ORDER BY timestamp DESC
             LIMIT 6",
        )
        .map_err(|e| e.to_string())?;
    let recent_activity = activity_stmt
        .query_map(params![&workspace_id], |row| {
            let id = row.get::<_, String>(0)?;
            let kind = row.get::<_, String>(2)?;
            let route = match kind.as_str() {
                "chat" => route(format!("/chat/{id}"), None),
                "concept" => route("/graph", None),
                "source" => route("/documents", None),
                _ => route("/notes", None),
            };

            Ok(DashboardActivity {
                id,
                title: row.get(1)?,
                kind,
                subtitle: row.get(3)?,
                timestamp: row.get(4)?,
                route,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut progression = Vec::new();

    if let Some(continue_item) = &continue_learning {
        progression.push(DashboardSuggestion {
            id: "continue-thread".to_string(),
            kind: "continue".to_string(),
            title: "Continue your latest thread".to_string(),
            description: format!(
                "Jump back into \"{}\" and keep building on your current context.",
                continue_item.title
            ),
            route: continue_item.route.clone(),
        });
    }

    if due_today > 0 {
        progression.push(DashboardSuggestion {
            id: "review-due".to_string(),
            kind: "review".to_string(),
            title: "Review what is due now".to_string(),
            description: format!(
                "{} flashcard{} {} ready for reinforcement.",
                due_today,
                if due_today == 1 { "" } else { "s" },
                if due_today == 1 { "is" } else { "are" }
            ),
            route: route("/flashcards", None),
        });
    }

    if active_goals == 0 && concepts >= 3 {
        let goal_hint = active_topic_tags
            .first()
            .cloned()
            .unwrap_or_else(|| "your current topics".to_string());
        progression.push(DashboardSuggestion {
            id: "first-goal".to_string(),
            kind: "goal".to_string(),
            title: "Turn exploration into a learning goal".to_string(),
            description: format!(
                "You already have concept coverage around {}. Capture a goal so progress becomes visible.",
                goal_hint
            ),
            route: route("/learning", None),
        });
    }

    if flashcards == 0 && concepts > 0 {
        progression.push(DashboardSuggestion {
            id: "starter-review-set".to_string(),
            kind: "review".to_string(),
            title: "Create a starter review set".to_string(),
            description: "Your knowledge graph is growing, but none of it is scheduled for recall yet.".to_string(),
            route: route("/flashcards", None),
        });
    }

    if unprocessed_sources > 0 {
        progression.push(DashboardSuggestion {
            id: "process-sources".to_string(),
            kind: "source".to_string(),
            title: "Process new sources".to_string(),
            description: format!(
                "{} source{} still need{} processing before they fully support retrieval and review.",
                unprocessed_sources,
                if unprocessed_sources == 1 { "" } else { "s" },
                if unprocessed_sources == 1 { "s" } else { "" }
            ),
            route: route("/documents", None),
        });
    }

    if isolated_concepts > 0 {
        progression.push(DashboardSuggestion {
            id: "link-concepts".to_string(),
            kind: "graph".to_string(),
            title: "Strengthen concept connections".to_string(),
            description: format!(
                "{} concept{} {} still isolated in the graph.",
                isolated_concepts,
                if isolated_concepts == 1 { "" } else { "s" },
                if isolated_concepts == 1 { "is" } else { "are" }
            ),
            route: route("/graph", None),
        });
    }

    if progression.is_empty() {
        progression.push(DashboardSuggestion {
            id: "start-searching".to_string(),
            kind: "continue".to_string(),
            title: "Start with search".to_string(),
            description: "Ask a question or search your material. Aetherium will turn that activity into review and progression over time.".to_string(),
            route: route("/chat", None),
        });
    }

    progression.truncate(5);

    Ok(DashboardSummary {
        workspace_id,
        workspace_name,
        overview: DashboardOverview {
            chat_sessions,
            notes,
            sources,
            concepts,
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
            under_reviewed_concepts,
            weak_concepts,
            route: route("/flashcards", None),
        },
        goals,
        progression,
        knowledge_health: DashboardKnowledgeHealth {
            stalled_goals,
            unprocessed_sources,
            isolated_concepts,
            active_topic_tags,
        },
        recent_activity,
    })
}
