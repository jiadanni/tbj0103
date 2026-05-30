use crate::db::DbState;
use crate::models::quiz::{Quiz, QuizAnswer, QuizDetail, QuizQuestion, QuizSummary};
use crate::services::model_settings::{get_model_for_job, get_ollama_base_url};
use crate::services::quiz_service::{generate_questions, grade_answer};
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct CreateQuizRequest {
    pub workspace_id: String,
    pub kind: String,
    pub topic_ids: Vec<String>,
    pub question_count: Option<usize>,
    pub chat_session_id: Option<String>,
    pub title: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SubmitAnswerRequest {
    pub quiz_id: String,
    pub question_id: String,
    pub user_answer: String,
    pub model: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GradedAnswerResponse {
    pub answer: QuizAnswer,
}

fn parse_topic_ids(raw: &str) -> Vec<String> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn parse_topic_labels(raw: &str) -> Vec<String> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn row_to_quiz(row: &rusqlite::Row) -> rusqlite::Result<Quiz> {
    let topic_ids_raw: String = row.get(4)?;
    let topic_labels_raw: String = row.get(5)?;
    Ok(Quiz {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        kind: row.get(2)?,
        title: row.get(3)?,
        topic_ids: parse_topic_ids(&topic_ids_raw),
        topic_labels: parse_topic_labels(&topic_labels_raw),
        status: row.get(6)?,
        score: row.get(7)?,
        question_count: row.get(8)?,
        chat_session_id: row.get(9)?,
        created_at: row.get(10)?,
        completed_at: row.get(11)?,
    })
}

const QUIZ_COLUMNS: &str =
    "id, workspace_id, kind, title, topic_ids, topic_labels, status, score, question_count, chat_session_id, created_at, completed_at";

fn fetch_quiz(conn: &rusqlite::Connection, quiz_id: &str) -> Result<Quiz, String> {
    conn.query_row(
        &format!("SELECT {QUIZ_COLUMNS} FROM quizzes WHERE id = ?1"),
        params![quiz_id],
        row_to_quiz,
    )
    .map_err(|e| format!("Quiz not found: {e}"))
}

fn fetch_questions(
    conn: &rusqlite::Connection,
    quiz_id: &str,
) -> Result<Vec<QuizQuestion>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, quiz_id, position, prompt, expected_answer, rubric, topic, created_at
             FROM quiz_questions WHERE quiz_id = ?1 ORDER BY position ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![quiz_id], |row| {
            Ok(QuizQuestion {
                id: row.get(0)?,
                quiz_id: row.get(1)?,
                position: row.get(2)?,
                prompt: row.get(3)?,
                expected_answer: row.get(4)?,
                rubric: row.get(5)?,
                topic: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn fetch_answers(conn: &rusqlite::Connection, quiz_id: &str) -> Result<Vec<QuizAnswer>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, quiz_id, question_id, user_answer, score, feedback, graded_at, created_at
             FROM quiz_answers WHERE quiz_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![quiz_id], |row| {
            Ok(QuizAnswer {
                id: row.get(0)?,
                quiz_id: row.get(1)?,
                question_id: row.get(2)?,
                user_answer: row.get(3)?,
                score: row.get(4)?,
                feedback: row.get(5)?,
                graded_at: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_quiz(
    state: State<'_, DbState>,
    req: CreateQuizRequest,
) -> Result<QuizDetail, String> {
    if req.kind != "pop" && req.kind != "exam" {
        return Err(format!("Invalid quiz kind: {}", req.kind));
    }
    if req.topic_ids.is_empty() {
        return Err("At least one topic is required".into());
    }

    let target_count = req
        .question_count
        .unwrap_or(if req.kind == "exam" { 12 } else { 4 })
        .clamp(1, 40);

    // Resolve topic labels + ollama_url + model from the DB, then drop the connection
    // before any async work so we don't hold a pool conn across await.
    let (topic_labels, ollama_url, model) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut labels = Vec::with_capacity(req.topic_ids.len());
        for id in &req.topic_ids {
            let topic: Option<String> = conn
                .query_row(
                    "SELECT topic FROM flashcard_topics WHERE id = ?1 AND workspace_id = ?2",
                    params![id, &req.workspace_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(t) = topic {
                labels.push(t);
            }
        }
        if labels.is_empty() {
            return Err("No matching topics found for the supplied IDs".into());
        }
        let model = req
            .model
            .clone()
            .or_else(|| get_model_for_job(&conn, "quiz_model"))
            .ok_or_else(|| "No model configured for quiz generation".to_string())?;
        (labels, get_ollama_base_url(&conn), model)
    };

    let generated = generate_questions(
        ollama_url,
        &model,
        &req.kind,
        &topic_labels,
        target_count,
    )
    .await?;

    let quiz_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let topic_ids_json = serde_json::to_string(&req.topic_ids).unwrap_or_else(|_| "[]".into());
    let topic_labels_json = serde_json::to_string(&topic_labels).unwrap_or_else(|_| "[]".into());
    let title = req.title.clone().unwrap_or_else(|| {
        if topic_labels.len() == 1 {
            topic_labels[0].clone()
        } else {
            format!("{} topics", topic_labels.len())
        }
    });

    let mut conn = state.0.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO quizzes
            (id, workspace_id, kind, title, topic_ids, topic_labels, status, score, question_count, chat_session_id, created_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'in_progress', NULL, ?7, ?8, ?9, NULL)",
        params![
            quiz_id,
            req.workspace_id,
            req.kind,
            title,
            topic_ids_json,
            topic_labels_json,
            generated.len() as i64,
            req.chat_session_id,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    for (idx, q) in generated.iter().enumerate() {
        tx.execute(
            "INSERT INTO quiz_questions
                (id, quiz_id, position, prompt, expected_answer, rubric, topic, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                Uuid::new_v4().to_string(),
                quiz_id,
                idx as i64,
                q.prompt.trim(),
                q.expected_answer.trim(),
                q.rubric.trim(),
                q.topic.trim(),
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    let conn = state.0.get().map_err(|e| e.to_string())?;
    Ok(QuizDetail {
        quiz: fetch_quiz(&conn, &quiz_id)?,
        questions: fetch_questions(&conn, &quiz_id)?,
        answers: vec![],
    })
}

#[tauri::command]
pub fn get_quiz(state: State<DbState>, quiz_id: String) -> Result<QuizDetail, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    Ok(QuizDetail {
        quiz: fetch_quiz(&conn, &quiz_id)?,
        questions: fetch_questions(&conn, &quiz_id)?,
        answers: fetch_answers(&conn, &quiz_id)?,
    })
}

#[tauri::command]
pub fn list_quizzes(
    state: State<DbState>,
    workspace_id: String,
    limit: Option<i64>,
) -> Result<Vec<QuizSummary>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {QUIZ_COLUMNS},
                    (SELECT COUNT(*) FROM quiz_answers a WHERE a.quiz_id = quizzes.id) AS answered,
                    (SELECT AVG(score) FROM quiz_answers a WHERE a.quiz_id = quizzes.id AND score IS NOT NULL) AS avg_score
             FROM quizzes WHERE workspace_id = ?1
             ORDER BY created_at DESC LIMIT ?2"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![workspace_id, limit], |row| {
            let quiz = row_to_quiz(row)?;
            let answered: i64 = row.get(12)?;
            let avg_score: Option<f64> = row.get(13)?;
            Ok(QuizSummary {
                quiz,
                answered_count: answered,
                average_score: avg_score,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn submit_quiz_answer(
    state: State<'_, DbState>,
    req: SubmitAnswerRequest,
) -> Result<QuizAnswer, String> {
    // Pull question + model details, then release the connection before grading.
    let (prompt, expected, rubric, ollama_url, model) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let (prompt, expected, rubric): (String, String, String) = conn
            .query_row(
                "SELECT prompt, expected_answer, rubric FROM quiz_questions WHERE id = ?1 AND quiz_id = ?2",
                params![req.question_id, req.quiz_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|e| format!("Question not found: {e}"))?;
        let model = req
            .model
            .clone()
            .or_else(|| get_model_for_job(&conn, "quiz_model"))
            .ok_or_else(|| "No model configured for quiz grading".to_string())?;
        (prompt, expected, rubric, get_ollama_base_url(&conn), model)
    };

    let graded = grade_answer(
        ollama_url,
        &model,
        &prompt,
        &expected,
        &rubric,
        &req.user_answer,
    )
    .await?;

    let answer_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO quiz_answers
            (id, quiz_id, question_id, user_answer, score, feedback, graded_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(question_id) DO UPDATE SET
            user_answer = excluded.user_answer,
            score = excluded.score,
            feedback = excluded.feedback,
            graded_at = excluded.graded_at",
        params![
            answer_id,
            req.quiz_id,
            req.question_id,
            req.user_answer,
            graded.score,
            graded.feedback,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, quiz_id, question_id, user_answer, score, feedback, graded_at, created_at
         FROM quiz_answers WHERE question_id = ?1",
        params![req.question_id],
        |row| {
            Ok(QuizAnswer {
                id: row.get(0)?,
                quiz_id: row.get(1)?,
                question_id: row.get(2)?,
                user_answer: row.get(3)?,
                score: row.get(4)?,
                feedback: row.get(5)?,
                graded_at: row.get(6)?,
                created_at: row.get(7)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn finalize_quiz(state: State<DbState>, quiz_id: String) -> Result<Quiz, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let avg: Option<f64> = conn
        .query_row(
            "SELECT AVG(score) FROM quiz_answers WHERE quiz_id = ?1 AND score IS NOT NULL",
            params![quiz_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE quizzes SET status = 'completed', score = ?1, completed_at = ?2 WHERE id = ?3",
        params![avg, now, quiz_id],
    )
    .map_err(|e| e.to_string())?;
    fetch_quiz(&conn, &quiz_id)
}

#[tauri::command]
pub fn delete_quiz(state: State<DbState>, quiz_id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM quizzes WHERE id = ?1", params![quiz_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
