use crate::db::DbState;
use crate::models::workspace::TopicSignature;
use crate::ollama::client::{cosine_similarity, OllamaClient, OllamaMessage, RequestContext};
use crate::services::model_settings::{get_embedding_model, get_model_for_job, get_ollama_base_url};
use crate::services::vector_index::{bytes_to_f32_vec, f32_vec_to_bytes};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashSet;
use std::time::Duration;

const DEFAULT_TARGET_COUNT: i64 = 30;
const REFILL_WATERMARK: i64 = 15;
const BATCH_SIZE: usize = 20;

#[derive(Debug, Clone, Serialize)]
pub struct PromptSuggestion {
    pub id: String,
    pub prompt: String,
    pub tags: Vec<String>,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PromptBankJob {
    pub id: String,
    pub workspace_id: String,
    pub status: String,
    pub target_count: i64,
    pub generated_count: i64,
    pub model: String,
    pub error: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PromptBankStatus {
    pub prompt_count: i64,
    pub active_job: Option<PromptBankJob>,
    pub latest_job: Option<PromptBankJob>,
}

#[derive(Debug, Clone)]
struct WorkspacePromptContext {
    workspace_id: String,
    workspace_name: String,
    survey_data: Option<String>,
    topic_text: String,
    tags: Vec<String>,
    model: String,
    embedding_model: Option<String>,
    ollama_url: String,
}

#[derive(Debug, Deserialize)]
struct GeneratedPrompt {
    prompt: String,
    #[serde(default)]
    tags: Vec<String>,
}

pub fn normalize_prompt(prompt: &str) -> String {
    let lowered = prompt.trim().to_lowercase();
    let mut out = String::new();
    let mut last_space = false;
    for ch in lowered.chars() {
        if ch.is_alphanumeric() {
            out.push(ch);
            last_space = false;
        } else if ch.is_whitespace() && !last_space {
            out.push(' ');
            last_space = true;
        }
    }
    out.trim().to_string()
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn parse_tags(json: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(json).unwrap_or_default()
}

fn topic_context(sig: &TopicSignature, workspace_name: &str, survey_data: Option<&str>) -> (String, Vec<String>) {
    let mut tags: Vec<String> = sig
        .auto_detected_tags
        .iter()
        .filter(|tag| !sig.excluded_tags.contains(&tag.tag))
        .map(|tag| tag.tag.clone())
        .collect();
    for tag in &sig.custom_tags {
        if !sig.excluded_tags.contains(tag) && !tags.contains(tag) {
            tags.push(tag.clone());
        }
    }

    let mut parts = vec![workspace_name.to_string()];
    if !tags.is_empty() {
        parts.push(tags.join(", "));
    }
    if let Some(survey) = survey_data.filter(|s| !s.trim().is_empty()) {
        parts.push(survey.trim().to_string());
    }
    (parts.join("\n"), tags)
}

fn load_context(conn: &Connection, workspace_id: &str) -> Result<WorkspacePromptContext, String> {
    let (name, survey_data, sig_json): (String, Option<String>, String) = conn
        .query_row(
            "SELECT name, survey_data, topic_signature FROM workspaces WHERE id = ?1",
            params![workspace_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    let sig: TopicSignature = serde_json::from_str(&sig_json).unwrap_or_default();
    let (topic_text, tags) = topic_context(&sig, &name, survey_data.as_deref());
    let model = get_model_for_job(conn, "topic_signature_model")
        .ok_or_else(|| "No background model configured".to_string())?;
    let ollama_url = get_ollama_base_url(conn).unwrap_or_else(|| "http://localhost:11434".to_string());
    Ok(WorkspacePromptContext {
        workspace_id: workspace_id.to_string(),
        workspace_name: name,
        survey_data,
        topic_text,
        tags,
        model,
        embedding_model: get_embedding_model(conn),
        ollama_url,
    })
}

fn job_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PromptBankJob> {
    Ok(PromptBankJob {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        status: row.get(2)?,
        target_count: row.get(3)?,
        generated_count: row.get(4)?,
        model: row.get(5)?,
        error: row.get(6)?,
        started_at: row.get(7)?,
        completed_at: row.get(8)?,
    })
}

pub fn get_status(db: &DbState, workspace_id: &str) -> Result<PromptBankStatus, String> {
    let conn = db.0.get().map_err(|e| e.to_string())?;
    let prompt_count = conn
        .query_row(
            "SELECT COUNT(*) FROM workspace_prompt_bank WHERE workspace_id = ?1 AND dismissed_at IS NULL",
            params![workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let active_job = conn
        .query_row(
            "SELECT id, workspace_id, status, target_count, generated_count, model, error, started_at, completed_at
             FROM workspace_prompt_bank_jobs
             WHERE workspace_id = ?1 AND status IN ('queued','running')
             ORDER BY created_at DESC LIMIT 1",
            params![workspace_id],
            job_from_row,
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let latest_job = conn
        .query_row(
            "SELECT id, workspace_id, status, target_count, generated_count, model, error, started_at, completed_at
             FROM workspace_prompt_bank_jobs
             WHERE workspace_id = ?1
             ORDER BY created_at DESC LIMIT 1",
            params![workspace_id],
            job_from_row,
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(PromptBankStatus { prompt_count, active_job, latest_job })
}

pub async fn list_suggestions(db: &DbState, workspace_id: &str, limit: usize) -> Result<Vec<PromptSuggestion>, String> {
    let limit = limit.clamp(1, 24);
    let (context, rows) = {
        let conn = db.0.get().map_err(|e| e.to_string())?;
        let context = load_context(&conn, workspace_id)?;
        let mut stmt = conn
            .prepare(
                "SELECT id, prompt, tags_json, embedding, quality_score, used_count
                 FROM workspace_prompt_bank
                 WHERE workspace_id = ?1 AND dismissed_at IS NULL",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![workspace_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<Vec<u8>>>(3)?,
                    row.get::<_, f64>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        (context, rows)
    };

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let query_embedding = if let Some(model) = context.embedding_model.as_deref() {
        let client = OllamaClient::new(Some(context.ollama_url.clone()))?;
        client
            .generate_embedding_with_options("prompt_bank_rank", model, &context.topic_text, Some("0s"))
            .await
            .ok()
    } else {
        None
    };
    let query_terms = context
        .topic_text
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|term| term.len() > 2)
        .map(|term| term.to_lowercase())
        .collect::<HashSet<_>>();

    let mut scored = rows
        .into_iter()
        .map(|(id, prompt, tags_json, embedding, quality_score, used_count)| {
            let tags = parse_tags(&tags_json);
            let embedding_score = query_embedding.as_ref().and_then(|query| {
                embedding
                    .as_ref()
                    .map(|bytes| cosine_similarity(query, &bytes_to_f32_vec(bytes)) as f64)
            });
            let text_score = tags
                .iter()
                .filter(|tag| query_terms.contains(&tag.to_lowercase()))
                .count() as f64
                + prompt
                    .split(|ch: char| !ch.is_alphanumeric())
                    .filter(|term| query_terms.contains(&term.to_lowercase()))
                    .count() as f64
                    * 0.2;
            let score = embedding_score.unwrap_or(text_score) + quality_score - (used_count as f64 * 0.01);
            PromptSuggestion { id, prompt, tags, score }
        })
        .collect::<Vec<_>>();

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal));
    scored.truncate(limit);
    Ok(scored)
}

pub fn create_job(db: &DbState, workspace_id: &str, target_count: i64) -> Result<PromptBankJob, String> {
    let conn = db.0.get().map_err(|e| e.to_string())?;
    create_job_with_conn(&conn, workspace_id, target_count)
}

fn create_job_with_conn(conn: &Connection, workspace_id: &str, target_count: i64) -> Result<PromptBankJob, String> {
    if let Some(job) = conn
        .query_row(
            "SELECT id, workspace_id, status, target_count, generated_count, model, error, started_at, completed_at
             FROM workspace_prompt_bank_jobs
             WHERE workspace_id = ?1 AND status IN ('queued','running')
             ORDER BY created_at DESC LIMIT 1",
            params![workspace_id],
            job_from_row,
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        return Ok(job);
    }

    let context = load_context(conn, workspace_id)?;
    let id = uuid::Uuid::new_v4().to_string();
    let target_count = target_count.max(1);
    conn.execute(
        "INSERT INTO workspace_prompt_bank_jobs
         (id, workspace_id, status, target_count, generated_count, model, created_at, updated_at)
         VALUES (?1, ?2, 'queued', ?3, 0, ?4, ?5, ?5)",
        params![id, workspace_id, target_count, context.model, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(PromptBankJob {
        id,
        workspace_id: workspace_id.to_string(),
        status: "queued".to_string(),
        target_count,
        generated_count: 0,
        model: context.model,
        error: None,
        started_at: None,
        completed_at: None,
    })
}

pub async fn run_job_by_id(pool: Pool<SqliteConnectionManager>, job_id: String) -> Result<(), String> {
    let (workspace_id, target_count) = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT workspace_id, target_count FROM workspace_prompt_bank_jobs WHERE id = ?1",
            params![job_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|e| e.to_string())?
    };
    run_generation(pool, &job_id, &workspace_id, target_count).await
}

pub async fn tick(db: &DbState) -> Result<Option<PromptBankJob>, String> {
    let maybe_job = {
        let conn = db.0.get().map_err(|e| e.to_string())?;
        let queued = conn
            .query_row(
                "SELECT id, workspace_id, status, target_count, generated_count, model, error, started_at, completed_at
                 FROM workspace_prompt_bank_jobs
                 WHERE status = 'queued'
                 ORDER BY created_at ASC LIMIT 1",
                [],
                job_from_row,
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if queued.is_some() {
            queued
        } else {
            let workspace_id = conn
                .query_row(
                    "SELECT w.id
                     FROM workspaces w
                     LEFT JOIN workspace_prompt_bank p ON p.workspace_id = w.id AND p.dismissed_at IS NULL
                     LEFT JOIN workspace_prompt_bank_jobs j ON j.workspace_id = w.id AND j.status IN ('queued','running')
                     WHERE w.is_hidden = 0 AND j.id IS NULL
                     GROUP BY w.id
                     HAVING COUNT(p.id) < ?1
                     ORDER BY COALESCE(w.last_message_at, w.updated_at) DESC
                     LIMIT 1",
                    params![REFILL_WATERMARK],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            match workspace_id {
                Some(id) => Some(create_job_with_conn(&conn, &id, DEFAULT_TARGET_COUNT)?),
                None => None,
            }
        }
    };

    if let Some(job) = maybe_job {
        if let Err(error) = run_generation(db.0.clone(), &job.id, &job.workspace_id, job.target_count).await {
            mark_job_failed(&db.0, &job.id, &error);
            return Err(error);
        }
        Ok(Some(job))
    } else {
        Ok(None)
    }
}

async fn run_generation(
    pool: Pool<SqliteConnectionManager>,
    job_id: &str,
    workspace_id: &str,
    target_count: i64,
) -> Result<(), String> {
    let context = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        load_context(&conn, workspace_id)?
    };

    {
        let conn = pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE workspace_prompt_bank_jobs
             SET status = 'running', started_at = COALESCE(started_at, ?1), updated_at = ?1
             WHERE id = ?2",
            params![now(), job_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let client = OllamaClient::new(Some(context.ollama_url.clone()))?;
    let mut generated_total = 0_i64;

    loop {
        let current_count: i64 = {
            let conn = pool.get().map_err(|e| e.to_string())?;
            conn.query_row(
                "SELECT COUNT(*) FROM workspace_prompt_bank WHERE workspace_id = ?1 AND dismissed_at IS NULL",
                params![workspace_id],
                |row| row.get(0),
            )
            .unwrap_or(0)
        };
        if current_count >= target_count {
            break;
        }

        let needed = ((target_count - current_count) as usize).min(BATCH_SIZE);
        let prompts = generate_batch(&client, &context, needed).await?;
        if prompts.is_empty() {
            break;
        }

        let mut inserted = 0_i64;
        for item in prompts {
            if insert_prompt(&pool, &client, &context, item).await? {
                inserted += 1;
            }
        }
        generated_total += inserted;
        {
            let conn = pool.get().map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE workspace_prompt_bank_jobs
                 SET generated_count = generated_count + ?1, updated_at = ?2
                 WHERE id = ?3",
                params![inserted, now(), job_id],
            )
            .map_err(|e| e.to_string())?;
        }
        if inserted == 0 {
            break;
        }
    }

    let final_count: i64 = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT COUNT(*) FROM workspace_prompt_bank WHERE workspace_id = ?1 AND dismissed_at IS NULL",
            params![workspace_id],
            |row| row.get(0),
        )
        .unwrap_or(generated_total)
    };
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE workspace_prompt_bank_jobs
         SET status = 'completed', generated_count = ?1, completed_at = ?2, updated_at = ?2
         WHERE id = ?3",
        params![final_count, now(), job_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

async fn generate_batch(
    client: &OllamaClient,
    context: &WorkspacePromptContext,
    count: usize,
) -> Result<Vec<GeneratedPrompt>, String> {
    let mut prompt = format!(
        "Generate {count} unique, natural starter questions for an AI learning companion workspace.\n\
         Workspace: {}\n\
         Topics/tags: {}\n",
        context.workspace_name,
        context.tags.join(", ")
    );
    if let Some(survey) = context.survey_data.as_deref().filter(|s| !s.trim().is_empty()) {
        prompt.push_str(&format!("Learner goals/context: {}\n", survey.trim()));
    }
    prompt.push_str(
        "Return ONLY a JSON array. Each item must be an object with keys \"prompt\" and \"tags\". \
         Prompts must be questions, under 120 characters, non-overlapping in wording and intent.",
    );

    let ctx = RequestContext {
        source: Some("workspace_prompt_bank"),
        timeout_override: Some(Duration::from_secs(60)),
        ..Default::default()
    };
    let response = client
        .send_message_with_options_observed(
            &context.model,
            vec![OllamaMessage { role: "user".to_string(), content: prompt }],
            Some("0s"),
            &ctx,
        )
        .await?;
    let json = if let (Some(start), Some(end)) = (response.find('['), response.rfind(']')) {
        if end > start { &response[start..=end] } else { &response }
    } else {
        &response
    };
    let parsed = serde_json::from_str::<Vec<GeneratedPrompt>>(json)
        .or_else(|_| serde_json::from_str::<Vec<String>>(json).map(|items| {
            items
                .into_iter()
                .map(|prompt| GeneratedPrompt { prompt, tags: context.tags.iter().take(3).cloned().collect() })
                .collect()
        }))
        .map_err(|e| format!("Failed to parse generated prompts: {e}"))?;
    Ok(parsed)
}

async fn insert_prompt(
    pool: &Pool<SqliteConnectionManager>,
    client: &OllamaClient,
    context: &WorkspacePromptContext,
    item: GeneratedPrompt,
) -> Result<bool, String> {
    let prompt = item.prompt.trim().trim_matches('"').to_string();
    if prompt.len() < 8 {
        return Ok(false);
    }
    let normalized = normalize_prompt(&prompt);
    if normalized.is_empty() {
        return Ok(false);
    }

    let (embedding, embedding_model) = if let Some(model) = context.embedding_model.as_deref() {
        match client
            .generate_embedding_with_options("workspace_prompt_bank", model, &prompt, Some("0s"))
            .await
        {
            Ok(vec) => (Some(f32_vec_to_bytes(&vec)), Some(model.to_string())),
            Err(_) => (None, None),
        }
    } else {
        (None, None)
    };

    let tags = if item.tags.is_empty() {
        context.tags.iter().take(3).cloned().collect::<Vec<_>>()
    } else {
        item.tags
    };
    let tags_json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
    let conn = pool.get().map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "INSERT OR IGNORE INTO workspace_prompt_bank
             (id, workspace_id, prompt, normalized_prompt, tags_json, source, embedding, embedding_model, quality_score, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'ai', ?6, ?7, 0.5, ?8, ?8)",
            params![
                uuid::Uuid::new_v4().to_string(),
                context.workspace_id,
                prompt,
                normalized,
                tags_json,
                embedding,
                embedding_model,
                now(),
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(changed > 0)
}

pub fn mark_job_failed(pool: &Pool<SqliteConnectionManager>, job_id: &str, error: &str) {
    if let Ok(conn) = pool.get() {
        let _ = conn.execute(
            "UPDATE workspace_prompt_bank_jobs
             SET status = 'failed', error = ?1, completed_at = ?2, updated_at = ?2
             WHERE id = ?3",
            params![error, now(), job_id],
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::workspace::TopicTag;

    #[test]
    fn normalize_prompt_collapses_case_spacing_and_punctuation() {
        assert_eq!(
            normalize_prompt("  What is Rust's ownership system?  "),
            normalize_prompt("what is rusts ownership system")
        );
    }

    #[test]
    fn topic_context_excludes_excluded_tags_and_keeps_custom_tags() {
        let sig = TopicSignature {
            auto_detected_tags: vec![
                TopicTag { tag: "Rust".to_string(), weight: 1, source: "auto".to_string() },
                TopicTag { tag: "React".to_string(), weight: 1, source: "auto".to_string() },
            ],
            custom_tags: vec!["Tauri".to_string()],
            excluded_tags: vec!["React".to_string()],
            ..TopicSignature::default()
        };

        let (text, tags) = topic_context(&sig, "Systems", Some("desktop app learning"));

        assert_eq!(tags, vec!["Rust".to_string(), "Tauri".to_string()]);
        assert!(text.contains("Systems"));
        assert!(text.contains("desktop app learning"));
        assert!(!text.contains("React"));
    }
}
