use crate::db::DbState;
use crate::logging;
use crate::models::dashboard::{
    DashboardActivity, DashboardConceptFocus, DashboardContinueLearning, DashboardGoalSummary,
    DashboardKnowledgeHealth, DashboardOverview, DashboardReviewSummary, DashboardRoute,
    DashboardSuggestion, DashboardSummary, ReviewTopic,
};
use crate::models::workspace::TopicSignature;
use crate::services::workspace_hierarchy::workspace_filter_sql;
use rusqlite::params;
use tauri::State;

fn route(path: impl Into<String>, state: Option<serde_json::Value>) -> DashboardRoute {
    DashboardRoute {
        path: path.into(),
        state,
    }
}

#[tauri::command]
#[allow(clippy::type_complexity)]
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
        .auto_detected_tags
        .iter()
        .take(6)
        .map(|tag| tag.tag.clone())
        .collect::<Vec<_>>();

    // Predicate identifying concept_nodes that need review (used both for the
    // count aggregate below and the get_review_topics list command). A topic is
    // due if any of these hold:
    //   1. Failing recent grade: a quiz_answers row for this concept (matched
    //      via quiz_questions.topic case-insensitively against concept_nodes.name)
    //      with score < 0.7 in the last 30 days.
    //   2. Stale + under-reinforced: review_count <= 2 AND updated_at older
    //      than 7 days.
    //   3. At-risk learning goal: linked goal that is not completed and
    //      either due within 7 days or under 50% progress and stalled 14 days.
    //
    // Note: `quizzes.topic_ids` stores `flashcard_topics.id` values, not
    // concept_nodes.id, so we resolve the link via the free-text
    // `quiz_questions.topic` label rather than json_each(topic_ids).
    let due_topic_predicate = "(
        EXISTS (
            SELECT 1
            FROM quiz_answers qa
            JOIN quiz_questions qq ON qq.id = qa.question_id
            JOIN quizzes q ON q.id = qq.quiz_id
            WHERE q.workspace_id = cn.workspace_id
              AND qa.score IS NOT NULL
              AND qa.score < 0.7
              AND qa.created_at >= datetime('now', '-30 days')
              AND lower(qq.topic) = lower(cn.name)
        )
        OR (
            cn.review_count <= 2
            AND cn.updated_at < datetime('now', '-7 days')
        )
        OR EXISTS (
            SELECT 1
            FROM learning_goals lg
            WHERE lg.concept_id = cn.id
              AND lg.is_completed = 0
              AND (
                (lg.due_date IS NOT NULL AND lg.due_date <= date('now', '+7 days'))
                OR (lg.progress < 0.5 AND lg.updated_at < datetime('now', '-14 days'))
              )
        )
    )";

    // Priority CASE expression: 0 = failing grade, 1 = at-risk goal, 2 = stale.
    // Lower priority value sorts first.
    let due_topic_priority = "CASE
        WHEN EXISTS (
            SELECT 1
            FROM quiz_answers qa
            JOIN quiz_questions qq ON qq.id = qa.question_id
            JOIN quizzes q ON q.id = qq.quiz_id
            WHERE q.workspace_id = cn.workspace_id
              AND qa.score IS NOT NULL
              AND qa.score < 0.7
              AND qa.created_at >= datetime('now', '-30 days')
              AND lower(qq.topic) = lower(cn.name)
        ) THEN 0
        WHEN EXISTS (
            SELECT 1
            FROM learning_goals lg
            WHERE lg.concept_id = cn.id
              AND lg.is_completed = 0
              AND (
                (lg.due_date IS NOT NULL AND lg.due_date <= date('now', '+7 days'))
                OR (lg.progress < 0.5 AND lg.updated_at < datetime('now', '-14 days'))
              )
        ) THEN 1
        ELSE 2
    END";

    // ── Batch all simple COUNT / aggregate queries into one statement ──
    let counts_sql = format!(
        "{cte}SELECT
            cs.chat_sessions,
            pn.notes,
            s.sources,
            cn.concepts,
            lc.flashcards,
            lg.active_goals,
            lg.completed_goals,
            lc.total_cards,
            lc.due_today,
            lc.learned,
            lc.avg_ease,
            cn.under_reviewed_concepts,
            lg.stalled_goals,
            s.unprocessed_sources,
            cn.isolated_concepts,
            td.topics_due_for_review,
            tdn.top_due_topic
        FROM
            (SELECT COUNT(*) AS chat_sessions FROM chat_sessions WHERE workspace_id {ws_cond} AND is_deleted = 0 AND is_incognito = 0 AND exclude_from_analytics = 0) cs,
            (SELECT COUNT(*) AS notes FROM project_notes WHERE workspace_id {ws_cond}) pn,
            (SELECT
                COUNT(*) AS sources,
                COALESCE(SUM(CASE WHEN is_processed = 0 THEN 1 ELSE 0 END), 0) AS unprocessed_sources
             FROM sources WHERE workspace_id {ws_cond}) s,
            (SELECT
                COUNT(*) AS concepts,
                COALESCE(SUM(CASE WHEN review_count <= 1 THEN 1 ELSE 0 END), 0) AS under_reviewed_concepts,
                COALESCE(SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM concept_links l WHERE l.source_id = c.id OR l.target_id = c.id) THEN 1 ELSE 0 END), 0) AS isolated_concepts
             FROM concept_nodes c WHERE workspace_id {ws_cond}) cn,
            (SELECT
                COUNT(*) AS flashcards,
                COUNT(*) AS total_cards,
                COALESCE(SUM(CASE WHEN next_review_date <= date('now') THEN 1 ELSE 0 END), 0) AS due_today,
                COALESCE(SUM(CASE WHEN repetitions > 0 THEN 1 ELSE 0 END), 0) AS learned,
                COALESCE(AVG(ease_factor), 2.5) AS avg_ease
             FROM learning_cards WHERE workspace_id {ws_cond}) lc,
            (SELECT
                COALESCE(SUM(CASE WHEN is_completed = 0 THEN 1 ELSE 0 END), 0) AS active_goals,
                COALESCE(SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END), 0) AS completed_goals,
                COALESCE(SUM(CASE WHEN is_completed = 0 AND substr(updated_at, 1, 10) <= date('now', '-14 days') THEN 1 ELSE 0 END), 0) AS stalled_goals
             FROM learning_goals WHERE workspace_id {ws_cond}) lg,
            (SELECT COUNT(DISTINCT cn.id) AS topics_due_for_review
             FROM concept_nodes cn
             WHERE cn.workspace_id {ws_cond}
               AND {due_topic_predicate}) td,
            (SELECT (
                SELECT cn.name
                FROM concept_nodes cn
                WHERE cn.workspace_id {ws_cond}
                  AND {due_topic_predicate}
                ORDER BY {due_topic_priority} ASC, cn.updated_at ASC, cn.name ASC
                LIMIT 1
             ) AS top_due_topic) tdn"
    );

    let (
        chat_sessions, notes, sources, concepts, flashcards,
        active_goals, completed_goals, total_cards, due_today,
        learned, avg_ease, under_reviewed_concepts,
        stalled_goals, unprocessed_sources, isolated_concepts,
        topics_due_for_review, top_due_topic,
    ): (i64, i64, i64, i64, i64, i64, i64, i64, i64, i64, f64, i64, i64, i64, i64, i64, Option<String>) = conn
        .query_row(&counts_sql, params![&workspace_id], |row| {
            Ok((
                row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?,
                row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?,
                row.get(10)?, row.get(11)?, row.get(12)?, row.get(13)?, row.get(14)?,
                row.get(15)?, row.get(16)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    // Topic-based "weak topics" list: the same due predicate that powers
    // topics_due_for_review, ordered by priority (grade > goal > stale). This
    // surfaces actual review pressure rather than a static review_count
    // threshold tied to flashcards.
    let weak_topics_sql = format!(
        "{cte}SELECT cn.id, cn.name, cn.review_count, {due_topic_priority} AS priority
         FROM concept_nodes cn
         WHERE cn.workspace_id {ws_cond}
           AND {due_topic_predicate}
         ORDER BY priority ASC, cn.updated_at ASC, cn.name ASC
         LIMIT 4"
    );
    let mut weak_concepts_stmt = conn
        .prepare(&weak_topics_sql)
        .map_err(|e| e.to_string())?;
    let weak_concepts = weak_concepts_stmt
        .query_map(params![&workspace_id], |row| {
            let concept_id = row.get::<_, String>(0)?;
            let name = row.get::<_, String>(1)?;
            let review_count = row.get::<_, i64>(2)?;
            let priority = row.get::<_, i64>(3)?;
            let reason = match priority {
                0 => "Recent quiz scored low".to_string(),
                1 => "Linked goal is at risk".to_string(),
                _ => "Hasn't been revisited recently".to_string(),
            };

            Ok(DashboardConceptFocus {
                concept_id: concept_id.clone(),
                name,
                review_count,
                reason,
                route: route("/learning", Some(serde_json::json!({ "focusConceptId": concept_id }))),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut continue_learning_stmt = conn
        .prepare(&format!(
            "{cte}SELECT s.id,
                    s.title,
                    NULLIF(s.folder_id, ''),
                    p.name,
                    COALESCE(s.last_accessed_at, s.updated_at) AS last_seen
             FROM chat_sessions s
             LEFT JOIN folders p ON p.id = s.folder_id
             WHERE s.workspace_id {ws_cond}
               AND s.is_deleted = 0
               AND s.is_incognito = 0
               AND s.exclude_from_analytics = 0
             ORDER BY last_seen DESC
             LIMIT 3"
        ))
        .map_err(|e| e.to_string())?;
    let continue_learning = continue_learning_stmt
        .query_map(params![&workspace_id], |row| {
            let session_id = row.get::<_, String>(0)?;
            Ok(DashboardContinueLearning {
                session_id: session_id.clone(),
                title: row.get(1)?,
                folder_id: row.get(2)?,
                folder_name: row.get(3)?,
                updated_at: row.get(4)?,
                route: route(format!("/chat/{session_id}"), None),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut goals_stmt = conn
        .prepare(
            &format!("{cte}SELECT id, title, progress, is_completed, due_date, updated_at
             FROM learning_goals
             WHERE workspace_id {ws_cond}
             ORDER BY is_completed ASC, progress ASC, updated_at DESC
             LIMIT 4"),
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

    let mut activity_stmt = conn
        .prepare(
            &format!("{cte}SELECT *
             FROM (
                SELECT * FROM (
                    SELECT n.id AS id,
                           n.title AS title,
                           'note' AS kind,
                           COALESCE(n.note_type, '') AS subtitle,
                           n.updated_at AS timestamp
                    FROM project_notes n
                    WHERE n.workspace_id {ws_cond}
                    ORDER BY n.updated_at DESC
                    LIMIT 6
                )

                UNION ALL

                SELECT * FROM (
                    SELECT s.id AS id,
                           s.title AS title,
                           'chat' AS kind,
                           COALESCE(p.name, '') AS subtitle,
                           s.updated_at AS timestamp
                    FROM chat_sessions s
                    LEFT JOIN folders p ON p.id = s.folder_id
                    WHERE s.workspace_id {ws_cond}
                      AND s.is_deleted = 0
                      AND s.is_incognito = 0
                      AND s.exclude_from_analytics = 0
                    ORDER BY s.updated_at DESC
                    LIMIT 6
                )

                UNION ALL

                SELECT * FROM (
                    SELECT src.id AS id,
                           src.title AS title,
                           'source' AS kind,
                           COALESCE(src.source_type, '') AS subtitle,
                           src.updated_at AS timestamp
                    FROM sources src
                    WHERE src.workspace_id {ws_cond}
                    ORDER BY src.updated_at DESC
                    LIMIT 6
                )
             )
             ORDER BY timestamp DESC
             LIMIT 6"),
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


    if topics_due_for_review > 0 {
        let n = topics_due_for_review;
        let body = if n == 1 {
            "1 topic needs another review pass.".to_string()
        } else {
            format!("{n} topics need another review pass.")
        };
        let description = match top_due_topic.as_deref() {
            Some(name) if !name.is_empty() => format!("{body} Start with \"{name}\"."),
            _ => body,
        };
        progression.push(DashboardSuggestion {
            id: "review-due".to_string(),
            kind: "review".to_string(),
            title: "Review what is due now".to_string(),
            description,
            route: route("/review-topics", None),
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
                "You already have topic coverage around {}. Capture a goal so progress becomes visible.",
                goal_hint
            ),
            route: route("/learning", None),
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
            title: "Strengthen topic connections".to_string(),
            description: format!(
                "{} topic{} {} still isolated in the graph.",
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
            route: route("/review-topics", None),
            topics_due_for_review,
            top_due_topic,
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

#[tauri::command]
pub fn get_review_topics(
    state: State<DbState>,
    workspace_id: String,
    include_descendants: Option<bool>,
) -> Result<Vec<ReviewTopic>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let (cte, ws_cond) = workspace_filter_sql(include_descendants.unwrap_or(false));

    // Per-row aggregates as scalar sub-selects so the row builds in a single
    // SELECT (no N+1). Same three-branch predicate as get_dashboard_summary.
    // Priority: 0 = grade, 1 = goal, 2 = stale.
    let sql = format!(
        "{cte}SELECT
            cn.id,
            cn.name,
            (
                SELECT qa.score
                FROM quiz_answers qa
                JOIN quiz_questions qq ON qq.id = qa.question_id
                JOIN quizzes q ON q.id = qq.quiz_id
                WHERE q.workspace_id = cn.workspace_id
                  AND qa.score IS NOT NULL
                  AND qa.score < 0.7
                  AND qa.created_at >= datetime('now', '-30 days')
                  AND lower(qq.topic) = lower(cn.name)
                ORDER BY qa.created_at DESC
                LIMIT 1
            ) AS latest_score,
            (
                SELECT lg.title
                FROM learning_goals lg
                WHERE lg.concept_id = cn.id
                  AND lg.is_completed = 0
                  AND (
                    (lg.due_date IS NOT NULL AND lg.due_date <= date('now', '+7 days'))
                    OR (lg.progress < 0.5 AND lg.updated_at < datetime('now', '-14 days'))
                  )
                ORDER BY
                    CASE WHEN lg.due_date IS NOT NULL THEN 0 ELSE 1 END,
                    lg.due_date ASC,
                    lg.updated_at ASC
                LIMIT 1
            ) AS goal_title,
            (
                SELECT lg.due_date
                FROM learning_goals lg
                WHERE lg.concept_id = cn.id
                  AND lg.is_completed = 0
                  AND (
                    (lg.due_date IS NOT NULL AND lg.due_date <= date('now', '+7 days'))
                    OR (lg.progress < 0.5 AND lg.updated_at < datetime('now', '-14 days'))
                  )
                ORDER BY
                    CASE WHEN lg.due_date IS NOT NULL THEN 0 ELSE 1 END,
                    lg.due_date ASC,
                    lg.updated_at ASC
                LIMIT 1
            ) AS goal_due_date,
            CASE
                WHEN cn.review_count <= 2 AND cn.updated_at < datetime('now', '-7 days')
                    THEN CAST((julianday('now') - julianday(cn.updated_at)) AS INTEGER)
                ELSE NULL
            END AS stale_days
        FROM concept_nodes cn
        WHERE cn.workspace_id {ws_cond}
          AND (
            EXISTS (
                SELECT 1
                FROM quiz_answers qa
                JOIN quiz_questions qq ON qq.id = qa.question_id
                JOIN quizzes q ON q.id = qq.quiz_id
                WHERE q.workspace_id = cn.workspace_id
                  AND qa.score IS NOT NULL
                  AND qa.score < 0.7
                  AND qa.created_at >= datetime('now', '-30 days')
                  AND lower(qq.topic) = lower(cn.name)
            )
            OR (
                cn.review_count <= 2
                AND cn.updated_at < datetime('now', '-7 days')
            )
            OR EXISTS (
                SELECT 1
                FROM learning_goals lg
                WHERE lg.concept_id = cn.id
                  AND lg.is_completed = 0
                  AND (
                    (lg.due_date IS NOT NULL AND lg.due_date <= date('now', '+7 days'))
                    OR (lg.progress < 0.5 AND lg.updated_at < datetime('now', '-14 days'))
                  )
            )
          )
        ORDER BY
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM quiz_answers qa
                    JOIN quiz_questions qq ON qq.id = qa.question_id
                    JOIN quizzes q ON q.id = qq.quiz_id
                    WHERE q.workspace_id = cn.workspace_id
                      AND qa.score IS NOT NULL
                      AND qa.score < 0.7
                      AND qa.created_at >= datetime('now', '-30 days')
                      AND lower(qq.topic) = lower(cn.name)
                ) THEN 0
                WHEN EXISTS (
                    SELECT 1 FROM learning_goals lg
                    WHERE lg.concept_id = cn.id
                      AND lg.is_completed = 0
                      AND (
                        (lg.due_date IS NOT NULL AND lg.due_date <= date('now', '+7 days'))
                        OR (lg.progress < 0.5 AND lg.updated_at < datetime('now', '-14 days'))
                      )
                ) THEN 1
                ELSE 2
            END ASC,
            cn.updated_at ASC,
            cn.name ASC"
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![&workspace_id], |row| {
            let concept_id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let latest_score: Option<f64> = row.get(2)?;
            let goal_title: Option<String> = row.get(3)?;
            let goal_due_date: Option<String> = row.get(4)?;
            let stale_days: Option<i64> = row.get(5)?;

            let (reason_kind, detail, priority) = if let Some(score) = latest_score {
                (
                    "grade".to_string(),
                    format!("failing grade {score:.2}"),
                    0,
                )
            } else if let Some(title) = goal_title {
                let detail = match goal_due_date.as_deref() {
                    Some(due) if !due.is_empty() => format!("goal \"{title}\" due {due}"),
                    _ => format!("goal \"{title}\" stalled"),
                };
                ("goal".to_string(), detail, 1)
            } else if let Some(days) = stale_days {
                (
                    "stale".to_string(),
                    format!("under-reinforced, last seen {days}d ago"),
                    2,
                )
            } else {
                (
                    "stale".to_string(),
                    "needs another review pass".to_string(),
                    2,
                )
            };

            Ok(ReviewTopic {
                concept_id,
                name,
                reason_kind,
                detail,
                priority,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[cfg(test)]
mod tests {
    use crate::db::test_utils::tests::setup_test_db;
    use rusqlite::params;

    /// Seeds a workspace with two concepts:
    ///   A — failing recent quiz score
    ///   B — at-risk learning goal
    /// and asserts the topics_due_for_review aggregate counts both, and that
    /// `top_due_topic` resolves to the higher-priority "grade" concept.
    #[test]
    fn topic_review_aggregate_counts_and_orders_by_priority() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();

        // Workspace
        conn.execute(
            "INSERT INTO workspaces (id, name, description, icon, is_hidden, parent_workspace_id, created_at, updated_at, order_index)
             VALUES ('ws-1', 'WS', '', '', 0, NULL, datetime('now'), datetime('now'), 0)",
            [],
        ).unwrap();

        // Concept A — will be matched by failing grade.
        // Use a recent updated_at so the staleness branch alone wouldn't fire.
        conn.execute(
            "INSERT INTO concept_nodes (id, workspace_id, name, review_count, created_at, updated_at)
             VALUES ('A', 'ws-1', 'Alpha', 5, datetime('now'), datetime('now'))",
            [],
        ).unwrap();
        // Concept B — only matched by at-risk goal.
        conn.execute(
            "INSERT INTO concept_nodes (id, workspace_id, name, review_count, created_at, updated_at)
             VALUES ('B', 'ws-1', 'Beta', 5, datetime('now'), datetime('now'))",
            [],
        ).unwrap();

        // Quiz + question + low-score answer for Alpha.
        conn.execute(
            "INSERT INTO quizzes (id, workspace_id, kind, title, topic_ids, topic_labels, status, question_count, created_at)
             VALUES ('q1', 'ws-1', 'pop', 'Quiz', '[]', '[]', 'completed', 1, datetime('now'))",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO quiz_questions (id, quiz_id, position, prompt, expected_answer, rubric, topic, created_at)
             VALUES ('qq1', 'q1', 0, 'p', '', '', 'Alpha', datetime('now'))",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO quiz_answers (id, quiz_id, question_id, user_answer, score, feedback, graded_at, created_at)
             VALUES ('qa1', 'q1', 'qq1', 'ans', 0.4, '', datetime('now'), datetime('now'))",
            [],
        ).unwrap();

        // At-risk learning goal pointing at Beta.
        conn.execute(
            "INSERT INTO learning_goals (id, workspace_id, title, goal_description, progress, is_completed, due_date, concept_id, created_at, updated_at)
             VALUES ('g1', 'ws-1', 'Master Beta', '', 0.1, 0, date('now', '+1 day'), 'B', datetime('now'), datetime('now'))",
            [],
        ).unwrap();

        // Run the same predicate as the dashboard aggregate, scoped to ws-1.
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT cn.id)
                 FROM concept_nodes cn
                 WHERE cn.workspace_id = ?1
                   AND (
                     EXISTS (
                         SELECT 1 FROM quiz_answers qa
                         JOIN quiz_questions qq ON qq.id = qa.question_id
                         JOIN quizzes q ON q.id = qq.quiz_id
                         WHERE q.workspace_id = cn.workspace_id
                           AND qa.score IS NOT NULL
                           AND qa.score < 0.7
                           AND qa.created_at >= datetime('now', '-30 days')
                           AND lower(qq.topic) = lower(cn.name)
                     )
                     OR (cn.review_count <= 2 AND cn.updated_at < datetime('now', '-7 days'))
                     OR EXISTS (
                         SELECT 1 FROM learning_goals lg
                         WHERE lg.concept_id = cn.id
                           AND lg.is_completed = 0
                           AND ((lg.due_date IS NOT NULL AND lg.due_date <= date('now', '+7 days'))
                                OR (lg.progress < 0.5 AND lg.updated_at < datetime('now', '-14 days')))
                     )
                   )",
                params!["ws-1"],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(count, 2, "both Alpha (grade) and Beta (goal) should match");

        // Top due topic — grade priority must win.
        let top: Option<String> = conn
            .query_row(
                "SELECT cn.name FROM concept_nodes cn
                 WHERE cn.workspace_id = ?1
                   AND (
                     EXISTS (
                         SELECT 1 FROM quiz_answers qa
                         JOIN quiz_questions qq ON qq.id = qa.question_id
                         JOIN quizzes q ON q.id = qq.quiz_id
                         WHERE q.workspace_id = cn.workspace_id
                           AND qa.score IS NOT NULL
                           AND qa.score < 0.7
                           AND qa.created_at >= datetime('now', '-30 days')
                           AND lower(qq.topic) = lower(cn.name)
                     )
                     OR (cn.review_count <= 2 AND cn.updated_at < datetime('now', '-7 days'))
                     OR EXISTS (
                         SELECT 1 FROM learning_goals lg
                         WHERE lg.concept_id = cn.id
                           AND lg.is_completed = 0
                           AND ((lg.due_date IS NOT NULL AND lg.due_date <= date('now', '+7 days'))
                                OR (lg.progress < 0.5 AND lg.updated_at < datetime('now', '-14 days')))
                     )
                   )
                 ORDER BY
                   CASE
                     WHEN EXISTS (
                         SELECT 1 FROM quiz_answers qa
                         JOIN quiz_questions qq ON qq.id = qa.question_id
                         JOIN quizzes q ON q.id = qq.quiz_id
                         WHERE q.workspace_id = cn.workspace_id
                           AND qa.score IS NOT NULL
                           AND qa.score < 0.7
                           AND qa.created_at >= datetime('now', '-30 days')
                           AND lower(qq.topic) = lower(cn.name)
                     ) THEN 0
                     WHEN EXISTS (
                         SELECT 1 FROM learning_goals lg
                         WHERE lg.concept_id = cn.id
                           AND lg.is_completed = 0
                           AND ((lg.due_date IS NOT NULL AND lg.due_date <= date('now', '+7 days'))
                                OR (lg.progress < 0.5 AND lg.updated_at < datetime('now', '-14 days')))
                     ) THEN 1
                     ELSE 2
                   END ASC,
                   cn.updated_at ASC,
                   cn.name ASC
                 LIMIT 1",
                params!["ws-1"],
                |row| row.get::<_, String>(0),
            )
            .ok();
        assert_eq!(top.as_deref(), Some("Alpha"));
    }
}
