use crate::db::DbState;
use crate::models::chat::Message;
use crate::ollama::client::{OllamaClient, OllamaMessage};
use crate::services::model_settings::{get_embedding_model, get_model_for_job};
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[derive(Debug)]
pub enum ExtractionOutcome {
    Completed,
    CompletedWithWarnings(String),
    Rejected(String),
}

// Persist the response and completed candidates together with memory writes so
// a retry cannot lose failed candidates or reinforce a successful one twice.
#[derive(serde::Serialize, serde::Deserialize)]
struct ExtractionProgress {
    window: String,
    message_count: usize,
    response: String,
    completed: HashSet<String>,
}

fn window_fingerprint(messages: &[Message]) -> Result<String, String> {
    let input = messages
        .iter()
        .map(|m| (&m.id, &m.role, &m.content))
        .collect::<Vec<_>>();
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&input).map_err(|e| e.to_string())?)
    ))
}

fn load_extraction_progress(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Option<ExtractionProgress>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [format!("memory_extraction_progress:{session_id}")],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(|value| serde_json::from_str(&value))
        .transpose()
        .map_err(|e| e.to_string())
}

/// Number of messages prior to the high-water mark that are re-included in
/// each extraction window. Keeps cross-turn facts visible without re-prompting
/// the entire session every tick.
const EXTRACTION_OVERLAP: usize = 2;

/// Default cosine-similarity thresholds used by the dedup pass when no
/// per-user setting is configured. Preferences are kept stricter because they
/// tend to be short, near-synonymous phrases ("prefers concise" vs "wants
/// short answers") and would otherwise collide too aggressively.
const DEFAULT_DEDUP_THRESHOLD_FACT: f32 = 0.80;
const DEFAULT_DEDUP_THRESHOLD_PREFERENCE: f32 = 0.92;

/// Cosine similarity at or above this point is treated as a pure duplicate
/// and silently dropped, matching the historical behavior. Matches strictly
/// between the type threshold and this ceiling reinforce the existing memory.
const REINFORCE_DUPLICATE_CEILING: f32 = 0.97;

/// Cosine band in which two memories are "related but not duplicate" — close
/// enough that one might replace the other, but not so close that they are the
/// same statement. The contradiction judge only runs on pairs in this band.
const CONTRADICTION_BAND_MIN: f32 = 0.70;
const CONTRADICTION_BAND_MAX: f32 = 0.85;

/// Hard cap on judge LLM calls per extraction run. Keeps a chatty extraction
/// from stalling the background scheduler when many candidates fall in the
/// contradiction band.
const CONTRADICTION_JUDGE_MAX_CALLS: usize = 3;

/// Per-call timeout (seconds) for the judge LLM. Small local models can hang
/// on malformed prompts; the budget should not be open-ended.
const CONTRADICTION_JUDGE_TIMEOUT_SECS: u64 = 5;

/// Read a configurable threshold from settings (default: 5).
fn get_extraction_threshold(state: &DbState) -> usize {
    let conn = match state.0.get() {
        Ok(c) => c,
        Err(_) => return 5,
    };
    crate::commands::settings::get_setting(&conn, "memory_extraction_threshold")
        .and_then(|v| v.parse().ok())
        .unwrap_or(5)
}

/// Read a configurable idle window from settings (default: 5 minutes).
fn get_extraction_idle_minutes(conn: &rusqlite::Connection) -> u32 {
    crate::commands::settings::get_setting(conn, "memory_extraction_idle_minutes")
        .and_then(|v| v.parse().ok())
        .unwrap_or(5)
}

/// Pick the dedup threshold for a given memory type, falling back to the
/// hardcoded default if no override exists or the stored value is malformed.
fn dedup_threshold_for(conn: &rusqlite::Connection, memory_type: &str) -> f32 {
    let (key, default) = match memory_type {
        "preference" => (
            "memory_dedup_threshold_preference",
            DEFAULT_DEDUP_THRESHOLD_PREFERENCE,
        ),
        _ => ("memory_dedup_threshold_fact", DEFAULT_DEDUP_THRESHOLD_FACT),
    };
    crate::commands::settings::get_setting(conn, key)
        .and_then(|v| v.parse::<f32>().ok())
        .filter(|v| (0.0..=1.0).contains(v))
        .unwrap_or(default)
}

/// Auto-extract memories if the session has new unextracted messages.
pub async fn process_auto_memory_extraction(
    state: &DbState,
    ollama_url: Option<String>,
) -> Result<(), String> {
    process_memory_extraction_for_workspaces(state, &[], false, ollama_url).await
}

pub async fn process_memory_extraction_for_workspaces(
    state: &DbState,
    workspace_ids: &[String],
    include_imported: bool,
    ollama_url: Option<String>,
) -> Result<(), String> {
    let threshold = get_extraction_threshold(state);
    let sessions = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut sessions = Vec::new();
        if workspace_ids.is_empty() {
            let idle_minutes = get_extraction_idle_minutes(&conn);
            let sql = format!(
                "SELECT s.id, s.workspace_id, s.folder_id, s.last_processed_message_count FROM chat_sessions s \
                 LEFT JOIN settings retry ON retry.key = 'memory_extraction_retry:' || s.id \
                 WHERE (datetime(s.updated_at) > datetime('now', '-{} minutes') OR retry.key IS NOT NULL) \
                 AND s.is_incognito = 0 \
                 AND s.exclude_from_analytics = 0 \
                 AND s.is_imported = 0 \
                 AND s.message_count > s.last_processed_message_count \
                 AND s.message_count >= ?1 \
                 ORDER BY retry.key IS NULL, retry.value ASC, s.updated_at DESC \
                 LIMIT 5",
                idle_minutes
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            sessions = stmt
                .query_map([i64::try_from(threshold).unwrap_or(i64::MAX)], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
        } else {
            let imported_clause = if include_imported {
                ""
            } else {
                "AND is_imported = 0"
            };
            let sql = format!(
                "SELECT id, workspace_id, folder_id, last_processed_message_count FROM chat_sessions
                 WHERE workspace_id = ?1
                   AND is_incognito = 0
                   AND exclude_from_analytics = 0
                   {imported_clause}
                 ORDER BY updated_at DESC"
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            for workspace_id in workspace_ids {
                let rows = stmt
                    .query_map(rusqlite::params![workspace_id], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    })
                    .map_err(|e| e.to_string())?;
                sessions.extend(
                    rows.collect::<Result<Vec<_>, _>>()
                        .map_err(|e| e.to_string())?,
                );
            }
        }
        sessions
    };

    let mut failures = Vec::new();
    for (session_id, workspace_id, folder_id, last_count) in sessions {
        if crate::services::background_scheduler::is_cancelled("memory_extraction") {
            return Err("cancelled".to_string());
        }
        let (messages, pending) = {
            let conn = state.0.get().map_err(|e| e.to_string())?;
            let mut msg_stmt = conn.prepare(
                "SELECT id, role, content FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
            ).map_err(|e| e.to_string())?;

            let messages = msg_stmt
                .query_map(rusqlite::params![session_id], |row| {
                    Ok(Message {
                        id: row.get(0)?,
                        session_id: session_id.clone(),
                        role: row
                            .get::<_, String>(1)?
                            .parse()
                            .unwrap_or(crate::models::chat::MessageRole::User),
                        content: row.get(2)?,
                        model_name: Some("".to_string()),
                        tokens_used: None,
                        duration_ms: None,
                        variant_group_id: None,
                        created_at: "".to_string(),
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            (messages, load_extraction_progress(&conn, &session_id)?)
        };

        if !messages.is_empty()
            && messages.len() >= threshold
            && messages.len() > last_count as usize
        {
            // Phase 1: slice from the high-water mark with a small overlap so the
            // extractor sees enough context for facts that span the boundary.
            // Overlap is small to keep the prompt cheap.
            let start = (last_count as usize).saturating_sub(EXTRACTION_OVERLAP);
            // Finish a failed window before extracting messages appended during
            // the outage. Otherwise a new response could omit pending candidates.
            let mut end = messages.len();
            if let Some(pending) = pending {
                if pending.message_count > 0 && pending.message_count <= messages.len() - start {
                    let pending_end = start + pending.message_count;
                    if window_fingerprint(&messages[start..pending_end])? == pending.window {
                        end = pending_end;
                    }
                }
            }
            let window = &messages[start..end];

            // Mark before inference so missing configuration, outages, cancellation
            // and checkpoint-write failures remain discoverable after the idle horizon.
            {
                let conn = state.0.get().map_err(|e| e.to_string())?;
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?1, ?2)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    rusqlite::params![
                        format!("memory_extraction_retry:{session_id}"),
                        chrono::Utc::now().to_rfc3339()
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            let outcome = extract_and_store_memories(
                state,
                &workspace_id,
                &folder_id,
                &session_id,
                window,
                ollama_url.clone(),
            )
            .await;
            match outcome {
                Ok(outcome) => {
                    let mut conn = state.0.get().map_err(|e| e.to_string())?;
                    let tx = conn.transaction().map_err(|e| e.to_string())?;
                    tx.execute(
                        "UPDATE chat_sessions SET last_processed_message_count = ?1 WHERE id = ?2",
                        rusqlite::params![end as i64, session_id],
                    )
                    .map_err(|e| e.to_string())?;
                    tx.execute(
                        "DELETE FROM settings WHERE key = ?1",
                        [format!("memory_extraction_progress:{session_id}")],
                    )
                    .map_err(|e| e.to_string())?;
                    if end == messages.len() {
                        tx.execute(
                            "DELETE FROM settings WHERE key = ?1",
                            [format!("memory_extraction_retry:{session_id}")],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                    tx.commit().map_err(|e| e.to_string())?;
                    match outcome {
                        ExtractionOutcome::Rejected(reason) => {
                            failures.push(format!("{session_id}: rejected extraction: {reason}"));
                        }
                        ExtractionOutcome::CompletedWithWarnings(warnings) => {
                            failures.push(format!(
                                "{session_id}: extraction completed with warnings: {warnings}"
                            ));
                        }
                        ExtractionOutcome::Completed => {}
                    }
                }
                Err(error) => failures.push(format!("{session_id}: {error}")),
            }
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

pub async fn extract_and_store_memories(
    state: &DbState,
    workspace_id: &str,
    folder_id: &str,
    session_id: &str,
    recent_messages: &[Message],
    ollama_url: Option<String>,
) -> Result<ExtractionOutcome, String> {
    if recent_messages.is_empty() {
        return Ok(ExtractionOutcome::Completed);
    }

    let client = OllamaClient::new(ollama_url)?;
    let progress_key = format!("memory_extraction_progress:{session_id}");
    let window = window_fingerprint(recent_messages)?;
    let mut progress = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        load_extraction_progress(&conn, session_id)?.filter(|p| p.window == window)
    };

    let mut conversation_text = String::new();
    for msg in recent_messages {
        // Only include user messages to prevent the LLM from parroting assistant responses
        if msg.role == crate::models::chat::MessageRole::User {
            conversation_text.push_str(&format!("User: {}\n", msg.content));
        }
    }

    let prompt = format!(
        "You are a memory extraction system. Read the user's messages below and extract ONLY short statements about the user.\n\n\
        OUTPUT FORMAT: A JSON array of objects, each with \"type\" (\"fact\" or \"preference\") and \"content\" (string).\n\n\
        TYPES:\n\
        - \"fact\": Objective information about the user (what they know, own, do, are working on, their background).\n\
        - \"preference\": How the user wants to be communicated with or what they prefer.\n\n\
        RULES:\n\
        - Each \"content\" must be a single concise sentence (under 20 words).\n\
        - Write statements ABOUT THE USER, not explanations of topics.\n\
        - NEVER copy or paraphrase AI assistant responses.\n\
        - NEVER include explanations, definitions, or educational content.\n\
        - NEVER start with \"You are\", \"That's\", \"Great\", \"Let me\", \"Here's\", \"I \", \"In Python\", \"The\".\n\
        - Good fact: \"User is learning Python\"\n\
        - Good fact: \"User has an M1 MacBook Pro\"\n\
        - Good preference: \"User prefers concise explanations\"\n\
        - Bad: \"In Python, keyword arguments are evaluated before positional arguments.\"\n\
        - Bad: \"You are absolutely correct about function call semantics.\"\n\
        - Bad: \"The user asked about Python.\"\n\
        - If there is nothing worth remembering, return []\n\n\
        User messages:\n{}\n\n\
        Output ONLY a JSON array, nothing else. Example: [{{\"type\":\"fact\",\"content\":\"User is studying machine learning\"}}]",
        conversation_text
    );

    let msgs = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];

    // Fetch model config and existing embeddings in a SINGLE lock acquisition
    let (model, embedding_model, existing_embeddings, threshold_fact, threshold_pref) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let model = get_model_for_job(&conn, "memory_extraction_model");
        let emb_model = get_embedding_model(&conn);

        // Pre-fetch all existing memory embeddings for dedup (avoids per-fact lock).
        // Phase 2: include memory_type so dedup can partition by type and apply
        // type-specific cosine thresholds.
        // Phase 3: also fetch the memory id so a near-duplicate match can
        // reinforce the existing row instead of being silently dropped.
        // Phase 4: also fetch content (needed for the contradiction judge
        // prompt) and skip rows that are already superseded.
        let mut stmt = conn
            .prepare(
                "SELECT m.id, m.memory_type, m.content, me.embedding FROM memory_embeddings me 
             JOIN memories m ON me.memory_id = m.id 
             WHERE m.workspace_id = ?1 AND m.is_active = 1 AND m.superseded_by IS NULL",
            )
            .map_err(|e| e.to_string())?;
        let existing: Vec<(String, String, String, Vec<f32>)> = stmt
            .query_map(rusqlite::params![workspace_id], |row| {
                let id: String = row.get(0)?;
                let memory_type: String = row.get(1)?;
                let content: String = row.get(2)?;
                let bytes: Vec<u8> = row.get(3)?;
                Ok((
                    id,
                    memory_type,
                    content,
                    crate::services::vector_index::bytes_to_f32_vec(&bytes),
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let t_fact = dedup_threshold_for(&conn, "fact");
        let t_pref = dedup_threshold_for(&conn, "preference");

        (model, emb_model, existing, t_fact, t_pref)
    }; // DB lock released here

    let model = model.ok_or("No memory extraction model configured")?;
    let embedding_model = embedding_model.ok_or("No embedding model configured")?;

    let response = if let Some(saved) = &progress {
        saved.response.clone()
    } else {
        client
            .send_message_with_options("memory_pipeline", &model, msgs, Some("0s"))
            .await
            .map_err(|e| format!("Memory inference failed: {e}"))?
    };
    if progress.is_none() {
        progress = Some(ExtractionProgress {
            window,
            message_count: recent_messages.len(),
            response: response.clone(),
            completed: HashSet::new(),
        });
    }
    let mut progress = progress.ok_or("Missing extraction progress")?;
    let mut rejected_items = 0;
    let mut embedding_failures = Vec::new();
    let mut warnings = Vec::new();
    // Keep the structured/legacy parsing paths, but distinguish rejection from
    // a valid empty extraction. Rejection is terminal for this message window.
    {
        // Parse structured JSON: [{"type":"fact"|"preference","content":"..."}]
        if let Some(start) = response.find('[') {
            if let Some(end) = response.rfind(']').filter(|end| *end >= start) {
                let json_str = &response[start..=end];

                #[derive(serde::Deserialize)]
                struct ExtractedItem {
                    #[serde(rename = "type")]
                    memory_type: Option<String>,
                    content: Option<String>,
                }

                // Try structured format first, fall back to plain strings
                let items: Vec<(String, String)> =
                    if let Ok(structured) = serde_json::from_str::<Vec<ExtractedItem>>(json_str) {
                        structured
                            .into_iter()
                            .filter_map(|item| {
                                let Some(content) = item.content else {
                                    rejected_items += 1;
                                    return None;
                                };
                                let mem_type = match item.memory_type.as_deref() {
                                    Some("preference") => "preference".to_string(),
                                    Some("fact") | None => "fact".to_string(),
                                    Some(_) => {
                                        rejected_items += 1;
                                        return None;
                                    }
                                };
                                Some((content, mem_type))
                            })
                            .collect()
                    } else if let Ok(plain) = serde_json::from_str::<Vec<String>>(json_str) {
                        plain.into_iter().map(|s| (s, "fact".to_string())).collect()
                    } else {
                        return Ok(ExtractionOutcome::Rejected("Malformed memory JSON".into()));
                    };

                // Post-extraction validation: reject assistant-like content
                let item_count = items.len();
                let validated: Vec<(String, String)> = items
                    .into_iter()
                    .filter(|(content, _)| {
                        let trimmed = content.trim();
                        let word_count = trimmed.split_whitespace().count();

                        // Reject overly long statements (likely paraphrased responses)
                        if word_count > 30 {
                            return false;
                        }

                        // Reject empty or trivial
                        if word_count < 3 {
                            return false;
                        }

                        // Reject statements starting with common assistant phrases
                        let lower = trimmed.to_lowercase();
                        let bad_prefixes = [
                            "you are",
                            "that's",
                            "great ",
                            "let me",
                            "here's",
                            "i can",
                            "i will",
                            "i'll",
                            "in python",
                            "in rust",
                            "in javascript",
                            "the ",
                            "this is",
                            "sure,",
                            "of course",
                            "absolutely",
                            "certainly",
                            "indeed",
                            "note that",
                            "remember that",
                            "it's worth",
                            "it is worth",
                            "keep in mind",
                        ];
                        if bad_prefixes.iter().any(|p| lower.starts_with(p)) {
                            return false;
                        }

                        // Reject if it contains a question mark (likely a question, not a fact)
                        if trimmed.contains('?') {
                            return false;
                        }

                        true
                    })
                    .collect();
                rejected_items += item_count - validated.len();

                // Generate embeddings and check dedup OUTSIDE the lock
                let mut new_memories: Vec<(String, String, String, Vec<u8>)> = Vec::new();
                // Phase 3: ids of existing memories that should have their
                // reinforcement counter bumped because a near-duplicate was
                // re-extracted.
                let mut reinforced_ids: Vec<String> = Vec::new();
                // Phase 4: (new_id, old_id, verdict) — the new memory replaces
                // the old one, which gets marked superseded after insert.
                let mut supersessions: Vec<(String, String, String)> = Vec::new();
                let mut judge_calls_used: usize = 0;
                for (content, memory_type) in validated {
                    let content = content.trim().to_string();
                    let candidate_key = serde_json::to_string(&(&memory_type, &content))
                        .map_err(|e| e.to_string())?;
                    if progress.completed.contains(&candidate_key) {
                        continue;
                    }
                    let embedding = match client
                        .generate_embedding_with_options(
                            "memory_pipeline",
                            &embedding_model,
                            &content,
                            Some("0s"),
                        )
                        .await
                    {
                        Ok(emb)
                            if !emb.is_empty()
                                && emb.iter().all(|v| v.is_finite())
                                && emb.iter().any(|v| *v != 0.0) =>
                        {
                            emb
                        }
                        Ok(_) => {
                            embedding_failures
                                .push("Invalid empty, zero or non-finite embedding".to_string());
                            continue;
                        }
                        Err(error) => {
                            embedding_failures.push(format!("Memory embedding failed: {error}"));
                            continue;
                        }
                    };
                    progress.completed.insert(candidate_key);

                    // Semantic deduplication — CPU work with NO lock held.
                    // Phase 2: only compare against existing memories of the same type
                    // and use a type-specific threshold so preferences and facts can
                    // be tuned independently.
                    // Phase 3: pick the best match so we can either drop (>= 0.97
                    // pure duplicate) or reinforce (> threshold && < 0.97) the
                    // existing memory. A miss inserts a new memory as before.
                    let threshold = if memory_type == "preference" {
                        threshold_pref
                    } else {
                        threshold_fact
                    };
                    let best_match: Option<(&String, f32)> = existing_embeddings
                        .iter()
                        .filter(|(_, t, _, _)| t == &memory_type)
                        .map(|(id, _, _, existing_emb)| {
                            (
                                id,
                                crate::services::vector_index::cosine_similarity(
                                    &embedding,
                                    existing_emb,
                                ),
                            )
                        })
                        .fold(None, |acc, (id, score)| match acc {
                            Some((_, best)) if best >= score => acc,
                            _ => Some((id, score)),
                        });

                    match best_match {
                        Some((_, score)) if score >= REINFORCE_DUPLICATE_CEILING => {
                            // Pure duplicate — drop silently as before.
                        }
                        Some((id, score)) if score > threshold => {
                            // Near-duplicate — reinforce the existing memory.
                            reinforced_ids.push((*id).clone());
                            let _ = score; // silence unused
                        }
                        _ => {
                            // Phase 4: before treating this as a new independent
                            // memory, check whether it semantically replaces an
                            // existing same-type memory in the "related but not
                            // duplicate" cosine band. Cap total judge calls so a
                            // chatty extraction cannot stall the scheduler.
                            let new_id = uuid::Uuid::new_v4().to_string();
                            let mut superseded_old: Option<(String, String)> = None;

                            if judge_calls_used < CONTRADICTION_JUDGE_MAX_CALLS {
                                // Top-1 candidate by cosine within the band.
                                let candidate = existing_embeddings
                                    .iter()
                                    .filter(|(_, t, _, _)| t == &memory_type)
                                    .map(|(id, _, c, e)| {
                                        (
                                            id.clone(),
                                            c.clone(),
                                            crate::services::vector_index::cosine_similarity(
                                                &embedding, e,
                                            ),
                                        )
                                    })
                                    .filter(|(_, _, s)| {
                                        *s >= CONTRADICTION_BAND_MIN && *s < CONTRADICTION_BAND_MAX
                                    })
                                    .fold(None, |acc, (id, c, s)| match acc {
                                        Some((_, _, best)) if best >= s => acc,
                                        _ => Some((id, c, s)),
                                    });

                                if let Some((old_id, old_content, _)) = candidate {
                                    judge_calls_used += 1;
                                    match judge_supersedes(&client, &model, &old_content, &content)
                                        .await {
                                        Ok(Some(verdict)) => superseded_old = Some((old_id, verdict)),
                                        Ok(None) => {}
                                        Err(error) => warnings.push(format!("Contradiction judge failed; kept both memories: {error}")),
                                    }
                                }
                            }

                            let embedding_bytes =
                                crate::services::vector_index::f32_vec_to_bytes(&embedding);
                            new_memories.push((
                                content,
                                memory_type,
                                new_id.clone(),
                                embedding_bytes,
                            ));
                            if let Some((old_id, verdict)) = superseded_old {
                                supersessions.push((new_id, old_id, verdict));
                            }
                        }
                    }
                }

                // Write all new memories in a SINGLE lock + transaction.
                // Phase 3: also bump reinforcement_count + last_reinforced_at
                // for memories that matched a re-extracted near-duplicate.
                // Phase 4: also mark superseded old memories as inactive and
                // link them to the new memory that replaced them.
                let should_regen = {
                    let mut conn = state.0.get().map_err(|e| e.to_string())?;
                    let tx = conn.transaction().map_err(|e| e.to_string())?;
                    let now = chrono::Utc::now().to_rfc3339();
                    for (content, memory_type, id, embedding_bytes) in &new_memories {
                        tx.execute(
                            "INSERT INTO memories (id, workspace_id, folder_id, content, memory_type, scope, source_session_id, is_pinned, is_active, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, 'workspace', ?6, 0, 1, ?7, ?8)",
                            rusqlite::params![id, workspace_id, folder_id, content, memory_type, session_id, now, now],
                        ).map_err(|e| e.to_string())?;
                        tx.execute(
                            "INSERT INTO memory_embeddings (memory_id, embedding, model, created_at)
                             VALUES (?1, ?2, ?3, ?4)",
                            rusqlite::params![id, embedding_bytes, embedding_model, now],
                        ).map_err(|e| e.to_string())?;
                    }
                    for id in &reinforced_ids {
                        tx.execute(
                            "UPDATE memories
                               SET reinforcement_count = reinforcement_count + 1,
                                   last_reinforced_at = ?1,
                                   updated_at = ?1
                             WHERE id = ?2",
                            rusqlite::params![now, id],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                    for (new_id, old_id, verdict) in &supersessions {
                        tx.execute(
                            "UPDATE memories
                               SET is_active = 0,
                                   superseded_by = ?1,
                                   superseded_at = ?2,
                                   superseded_reason = ?3,
                                   updated_at = ?2
                             WHERE id = ?4",
                            rusqlite::params![new_id, now, verdict, old_id],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                    tx.execute(
                        "INSERT INTO settings (key, value) VALUES (?1, ?2)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        rusqlite::params![
                            progress_key,
                            serde_json::to_string(&progress).map_err(|e| e.to_string())?
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    tx.commit().map_err(|e| e.to_string())?;

                    // Auto-regenerate workspace summary only when new memories
                    // were inserted — reinforcement alone does not change the
                    // set of facts and would just burn tokens.
                    if !new_memories.is_empty() {
                        conn
                            .query_row(
                                "SELECT is_auto_generated FROM memory_summaries WHERE scope = 'workspace' AND workspace_id = ?1",
                                rusqlite::params![workspace_id],
                                |row| row.get::<_, i32>(0).map(|v| v != 0),
                            )
                            .unwrap_or(true) // If no summary exists yet, generate one
                    } else {
                        false
                    }
                }; // Release the transaction and pooled connection before inference.
                if should_regen {
                    // Optional enrichment must not roll back or retry completed base work.
                    if let Err(error) = auto_regenerate_summary(
                        state,
                        "workspace",
                        Some(workspace_id),
                        &client,
                        &model,
                    )
                    .await
                    {
                        warnings.push(format!("Summary regeneration failed: {error}"));
                    }
                }
            } else {
                return Ok(ExtractionOutcome::Rejected("Missing JSON array end".into()));
            }
        } else {
            return Ok(ExtractionOutcome::Rejected("Missing JSON array".into()));
        }
    }

    if !embedding_failures.is_empty() {
        embedding_failures.extend(warnings);
        Err(embedding_failures.join("; "))
    } else if rejected_items > 0 {
        warnings.push(format!("{rejected_items} invalid memory candidates"));
        Ok(ExtractionOutcome::Rejected(warnings.join("; ")))
    } else if !warnings.is_empty() {
        Ok(ExtractionOutcome::CompletedWithWarnings(
            warnings.join("; "),
        ))
    } else {
        Ok(ExtractionOutcome::Completed)
    }
}

/// Phase 4: ask the configured memory-extraction model whether `new_content`
/// semantically supersedes `old_content`. Returns the raw verdict (`"SUPERSEDES"`)
/// when the model agrees, or `None` for NEITHER. Errors are diagnostic-only:
/// callers keep both memories rather than superseding either one.
async fn judge_supersedes(
    client: &OllamaClient,
    model: &str,
    old_content: &str,
    new_content: &str,
) -> Result<Option<String>, String> {
    let prompt = format!(
        "Decide whether statement B replaces or contradicts statement A about the same user.\n\n\
        A: {}\n\
        B: {}\n\n\
        Reply with exactly one word, no punctuation:\n\
        - SUPERSEDES (B replaces or contradicts A)\n\
        - NEITHER (B is an independent statement)\n",
        old_content, new_content
    );
    let msgs = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    let call = client.send_message_with_options("memory_judge", model, msgs, Some("0s"));
    let response = match tokio::time::timeout(
        std::time::Duration::from_secs(CONTRADICTION_JUDGE_TIMEOUT_SECS),
        call,
    )
    .await
    {
        Ok(Ok(r)) => r,
        Ok(Err(error)) => return Err(error),
        Err(_) => return Err("judge timed out".to_string()),
    };
    let verdict = response.trim().to_uppercase();
    // Strict parsing: only the first word of the response is considered, and
    // it must be SUPERSEDES. Anything else (including hallucinated extras) is
    // treated as NEITHER.
    let first = verdict.split_whitespace().next().unwrap_or("");
    match first {
        "SUPERSEDES" => Ok(Some("SUPERSEDES".to_string())),
        "NEITHER" => Ok(None),
        _ => Err("unrecognized judge verdict".to_string()),
    }
}

/// Best-effort summary regeneration after new memories are extracted.
async fn auto_regenerate_summary(
    state: &DbState,
    scope: &str,
    workspace_id: Option<&str>,
    client: &OllamaClient,
    model: &str,
) -> Result<(), String> {
    // Gather facts + preferences
    let memories: Vec<(String, String)> = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut items = Vec::new();
        if scope == "global" {
            let mut stmt = conn.prepare(
                "SELECT content, memory_type FROM memories WHERE scope = 'global' AND is_active = 1 ORDER BY created_at ASC"
            ).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            items = rows.flatten().collect();
        } else if let Some(ws_id) = workspace_id {
            let mut stmt = conn.prepare(
                "SELECT content, memory_type FROM memories WHERE scope = 'workspace' AND workspace_id = ?1 AND is_active = 1 ORDER BY created_at ASC"
            ).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params![ws_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            items = rows.flatten().collect();
        }
        items
    };

    if memories.is_empty() {
        return Ok(());
    }

    let facts_text: Vec<String> = memories
        .iter()
        .filter(|(_, t)| t == "fact")
        .map(|(c, _)| format!("- {}", c))
        .collect();
    let prefs_text: Vec<String> = memories
        .iter()
        .filter(|(_, t)| t == "preference")
        .map(|(c, _)| format!("- {}", c))
        .collect();

    let mut context = String::new();
    if !facts_text.is_empty() {
        context.push_str("Facts:\n");
        context.push_str(&facts_text.join("\n"));
        context.push('\n');
    }
    if !prefs_text.is_empty() {
        context.push_str("\nPreferences:\n");
        context.push_str(&prefs_text.join("\n"));
        context.push('\n');
    }

    let prompt = format!(
        "Write a concise summary paragraph (under 100 words) about this person based on the following facts and preferences. \
        Write in third person. Be direct and factual. Do not add information that isn't in the facts.\n\n{}\n\nOutput ONLY the summary paragraph, nothing else.",
        context
    );

    let msgs = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];

    let summary_text = client
        .send_message_with_options("memory_summary", model, msgs, Some("0s"))
        .await
        .map_err(|e| e.to_string())?;

    let conn = state.0.get().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO memory_summaries (id, scope, workspace_id, content, is_auto_generated, generated_at, edited_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, NULL)
         ON CONFLICT(scope, workspace_id) DO UPDATE SET content = excluded.content, is_auto_generated = 1, generated_at = excluded.generated_at, edited_at = NULL",
        rusqlite::params![id, scope, workspace_id, summary_text.trim(), now],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::EXTRACTION_OVERLAP;
    use super::{DEFAULT_DEDUP_THRESHOLD_FACT, DEFAULT_DEDUP_THRESHOLD_PREFERENCE};
    use crate::db::DbState;
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn test_state() -> DbState {
        let pool = r2d2::Pool::builder()
            .max_size(1)
            .connection_timeout(Duration::from_millis(250))
            .build(r2d2_sqlite::SqliteConnectionManager::memory())
            .unwrap();
        pool.get()
            .unwrap()
            .execute_batch(include_str!("../schema.sql"))
            .unwrap();
        DbState(pool)
    }

    fn extraction_state() -> DbState {
        let state = test_state();
        state
            .0
            .get()
            .unwrap()
            .execute_batch(
                "INSERT INTO workspaces (id, name) VALUES ('ws', 'Test');
             INSERT INTO chat_sessions (id, workspace_id) VALUES ('session', 'ws');
             INSERT INTO messages (id, session_id, role, content)
                 VALUES ('message', 'session', 'user', 'I enjoy Rust and own a bicycle.');
             INSERT OR REPLACE INTO settings (key, value) VALUES
                 ('memory_extraction_threshold', '1'),
                 ('memory_extraction_model', 'memory:7b'),
                 ('embedding_model', 'embed');",
            )
            .unwrap();
        state
    }

    fn scalar(state: &DbState, sql: &str) -> i64 {
        state
            .0
            .get()
            .unwrap()
            .query_row(sql, [], |r| r.get(0))
            .unwrap()
    }

    fn checkpoint(state: &DbState) -> i64 {
        scalar(
            state,
            "SELECT last_processed_message_count FROM chat_sessions WHERE id = 'session'",
        )
    }

    struct FakeOllama {
        url: String,
        task: tokio::task::JoinHandle<()>,
    }

    impl Drop for FakeOllama {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    impl FakeOllama {
        async fn start(handler: impl Fn(&str, Value) -> (u16, Value) + Send + 'static) -> Self {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let task = tokio::spawn(async move {
                loop {
                    let (mut stream, _) = listener.accept().await.unwrap();
                    let mut bytes = Vec::new();
                    let mut buffer = [0; 4096];
                    let header_end = loop {
                        let count = stream.read(&mut buffer).await.unwrap();
                        assert_ne!(count, 0);
                        bytes.extend_from_slice(&buffer[..count]);
                        if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                            break end + 4;
                        }
                    };
                    let headers = String::from_utf8(bytes[..header_end].to_vec()).unwrap();
                    let path = headers.split_whitespace().nth(1).unwrap();
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    while bytes.len() < header_end + length {
                        let count = stream.read(&mut buffer).await.unwrap();
                        assert_ne!(count, 0);
                        bytes.extend_from_slice(&buffer[..count]);
                    }
                    let body = if length == 0 {
                        Value::Null
                    } else {
                        serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap()
                    };
                    let (status, response) = if path == "/api/tags" {
                        (
                            200,
                            json!({"models": [{"name": "memory:7b"}, {"name": "embed"}]}),
                        )
                    } else if path == "/api/show" {
                        (200, json!({"capabilities": ["completion", "embedding"]}))
                    } else {
                        handler(path, body)
                    };
                    let response = response.to_string();
                    let wire = format!(
                        "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",
                        response.len()
                    );
                    stream.write_all(wire.as_bytes()).await.unwrap();
                }
            });
            Self { url, task }
        }
    }

    fn chat(content: &str) -> (u16, Value) {
        (
            200,
            json!({"model": "memory:7b", "message": {"role": "assistant", "content": content}, "done": true}),
        )
    }

    async fn run(state: &DbState, server: &FakeOllama) -> Result<(), String> {
        tokio::time::timeout(
            Duration::from_secs(3),
            super::process_auto_memory_extraction(state, Some(server.url.clone())),
        )
        .await
        .expect("extraction must not exhaust the single-connection pool")
    }

    #[tokio::test]
    async fn missing_models_and_failed_inference_do_not_checkpoint() {
        let calls = Arc::new(Mutex::new(0));
        let seen = calls.clone();
        let server = FakeOllama::start(move |path, _| {
            assert_eq!(path, "/api/chat");
            let mut count = seen.lock().unwrap();
            *count += 1;
            if *count == 1 {
                (503, json!({"error": "offline"}))
            } else {
                chat("[]")
            }
        })
        .await;
        for key in ["memory_extraction_model", "embedding_model"] {
            let state = extraction_state();
            state
                .0
                .get()
                .unwrap()
                .execute("DELETE FROM settings WHERE key = ?1", [key])
                .unwrap();
            assert!(run(&state, &server)
                .await
                .unwrap_err()
                .contains("configured"));
            assert_eq!(checkpoint(&state), 0);
        }
        assert_eq!(*calls.lock().unwrap(), 0);
        let state = extraction_state();
        assert!(run(&state, &server)
            .await
            .unwrap_err()
            .contains("inference failed"));
        assert_eq!(checkpoint(&state), 0);
        run(&state, &server).await.unwrap();
        assert_eq!(checkpoint(&state), 1);
        assert_eq!(*calls.lock().unwrap(), 2);
    }

    #[tokio::test]
    async fn malformed_extractions_are_reported_once_and_checkpointed() {
        for response in [
            "not JSON",
            "][",
            "[{}]",
            "[1]",
            r#"[{"type":"fact","content":"The sky is blue"}]"#,
        ] {
            let calls = Arc::new(Mutex::new(0));
            let seen = calls.clone();
            let server = FakeOllama::start(move |_, _| {
                *seen.lock().unwrap() += 1;
                chat(response)
            })
            .await;
            let state = extraction_state();
            assert!(run(&state, &server)
                .await
                .unwrap_err()
                .contains("rejected extraction"));
            assert_eq!(checkpoint(&state), 1);
            assert_eq!(scalar(&state, "SELECT COUNT(*) FROM memories"), 0);
            run(&state, &server).await.unwrap();
            assert_eq!(*calls.lock().unwrap(), 1);
        }
    }

    #[tokio::test]
    async fn partial_embedding_retry_preserves_inserts_and_reinforcement_and_releases_pool() {
        let state = extraction_state();
        {
            let conn = state.0.get().unwrap();
            conn.execute(
                "INSERT INTO memories (id, workspace_id, content) VALUES ('old', 'ws', 'User enjoys programming')", []
            ).unwrap();
            conn.execute(
                "INSERT INTO memory_embeddings (memory_id, embedding, model) VALUES ('old', ?1, 'embed')",
                [crate::services::vector_index::f32_vec_to_bytes(&[1.0, 0.0, 0.0])],
            ).unwrap();
        }
        let counts = Arc::new(Mutex::new([0; 5]));
        let seen = counts.clone();
        let pool = state.0.clone();
        let server = FakeOllama::start(move |path, body| {
            let mut counts = seen.lock().unwrap();
            if path == "/api/chat" {
                let prompt = body["messages"][0]["content"].as_str().unwrap();
                if prompt.starts_with("Write a concise summary") {
                    assert!(
                        pool.try_get().is_some(),
                        "summary inference must not hold a pool connection"
                    );
                    counts[4] += 1;
                    // Optional summary failure must not undo durable extraction.
                    return (503, json!({"error": "summary unavailable"}));
                }
                counts[0] += 1;
                if counts[0] > 1 {
                    return chat("[]");
                }
                return chat(
                    r#"[
                    {"type":"fact","content":"User enjoys Rust"},
                    {"type":"fact","content":"User owns a bicycle"},
                    {"type":"fact","content":"User owns a bicycle"},
                    {"type":"fact","content":"User lives in Oslo"}
                ]"#,
                );
            }
            assert_eq!(path, "/api/embed");
            match body["input"].as_str().unwrap() {
                "User enjoys Rust" => {
                    counts[1] += 1;
                    (200, json!({"embeddings": [[0.9, 0.435, 0.0]]}))
                }
                "User owns a bicycle" => {
                    counts[2] += 1;
                    (200, json!({"embeddings": [[0.0, 0.0, 1.0]]}))
                }
                "User lives in Oslo" => {
                    counts[3] += 1;
                    if counts[3] == 1 {
                        (503, json!({"error": "busy"}))
                    } else {
                        (200, json!({"embeddings": [[-1.0, 0.0, 0.0]]}))
                    }
                }
                other => panic!("Unexpected candidate {other}"),
            }
        })
        .await;
        let partial_error = run(&state, &server).await.unwrap_err();
        assert!(partial_error.contains("embedding failed"));
        assert!(partial_error.contains("Summary regeneration failed"));
        assert_eq!(checkpoint(&state), 0);
        assert_eq!(scalar(&state, "SELECT COUNT(*) FROM memories"), 2);
        assert_eq!(
            scalar(
                &state,
                "SELECT reinforcement_count FROM memories WHERE id = 'old'"
            ),
            2
        );
        assert_eq!(
            scalar(
                &state,
                "SELECT COUNT(*) FROM settings WHERE key LIKE 'memory_extraction_progress:%'"
            ),
            1
        );
        state
            .0
            .get()
            .unwrap()
            .execute(
                "INSERT INTO messages (id, session_id, role, content, created_at)
             VALUES ('message2', 'session', 'assistant', 'Noted.', datetime('now', '+1 second'))",
                [],
            )
            .unwrap();
        // A fresh state wrapper has no in-memory receipt. Even with new messages,
        // finish the pending window first rather than dropping its failed item.
        let restarted = DbState(state.0.clone());
        let completed_warning = run(&restarted, &server).await.unwrap_err();
        assert!(completed_warning.contains("extraction completed with warnings"));
        assert!(completed_warning.contains("Summary regeneration failed"));
        assert_eq!(checkpoint(&state), 1);
        assert_eq!(scalar(&state, "SELECT COUNT(*) FROM memories"), 3);
        assert_eq!(scalar(&state, "SELECT COUNT(*) FROM memory_embeddings"), 3);
        assert_eq!(
            scalar(
                &state,
                "SELECT reinforcement_count FROM memories WHERE id = 'old'"
            ),
            2
        );
        assert_eq!(
            scalar(
                &state,
                "SELECT COUNT(*) FROM settings WHERE key LIKE 'memory_extraction_progress:%'"
            ),
            0
        );
        assert_eq!(*counts.lock().unwrap(), [1, 1, 1, 2, 2]);
        run(&state, &server).await.unwrap();
        assert_eq!(checkpoint(&state), 2);
        assert_eq!(*counts.lock().unwrap(), [2, 1, 1, 2, 2]);
    }

    #[tokio::test]
    async fn automatic_retries_survive_idle_horizon_and_completed_recent_sessions() {
        let state = extraction_state();
        state
            .0
            .get()
            .unwrap()
            .execute(
                "DELETE FROM settings WHERE key = 'memory_extraction_model'",
                [],
            )
            .unwrap();
        let counts = Arc::new(Mutex::new([0; 3]));
        let seen = counts.clone();
        let server = FakeOllama::start(move |path, body| {
            let mut counts = seen.lock().unwrap();
            if path == "/api/embed" {
                if body["input"] == "User enjoys Rust" {
                    counts[1] += 1;
                    (200, json!({"embeddings": [[1.0, 0.0]]}))
                } else {
                    counts[2] += 1;
                    if counts[2] == 1 {
                        (503, json!({"error": "embedding offline"}))
                    } else {
                        (200, json!({"embeddings": [[0.0, 1.0]]}))
                    }
                }
            } else if body["messages"][0]["content"]
                .as_str()
                .unwrap()
                .starts_with("Write a concise summary")
            {
                chat("User enjoys Rust and owns a bicycle.")
            } else {
                counts[0] += 1;
                if counts[0] == 1 {
                    (503, json!({"error": "inference offline"}))
                } else {
                    chat(r#"["User enjoys Rust", "User owns a bicycle"]"#)
                }
            }
        })
        .await;
        assert!(run(&state, &server)
            .await
            .unwrap_err()
            .contains("configured"));
        assert_eq!(
            scalar(
                &state,
                "SELECT COUNT(*) FROM settings WHERE key = 'memory_extraction_retry:session'"
            ),
            1
        );
        {
            let conn = state.0.get().unwrap();
            conn.execute_batch(
                "UPDATE chat_sessions SET updated_at = datetime('now', '-1 day') WHERE id = 'session';
                 INSERT INTO settings (key, value) VALUES ('memory_extraction_model', 'memory:7b');"
            ).unwrap();
            // These five newer, completed sessions used to consume the entire LIMIT.
            for index in 0..5 {
                let id = format!("complete-{index}");
                conn.execute(
                    "INSERT INTO chat_sessions (id, workspace_id, last_processed_message_count)
                     VALUES (?1, 'ws', 1)",
                    [&id],
                )
                .unwrap();
                conn.execute(
                    "INSERT INTO messages (id, session_id, role, content)
                     VALUES (?1, ?1, 'user', 'Already processed')",
                    [&id],
                )
                .unwrap();
            }
        }
        assert!(run(&state, &server)
            .await
            .unwrap_err()
            .contains("inference failed"));
        assert_eq!(checkpoint(&state), 0);
        assert!(run(&state, &server)
            .await
            .unwrap_err()
            .contains("embedding failed"));
        assert_eq!(scalar(&state, "SELECT COUNT(*) FROM memories"), 1);
        assert_eq!(checkpoint(&state), 0);
        run(&state, &server).await.unwrap();
        assert_eq!(checkpoint(&state), 1);
        assert_eq!(scalar(&state, "SELECT COUNT(*) FROM memories"), 2);
        assert_eq!(scalar(&state, "SELECT COUNT(*) FROM memory_embeddings"), 2);
        assert_eq!(
            scalar(
                &state,
                "SELECT COUNT(*) FROM settings WHERE key = 'memory_extraction_retry:session'"
            ),
            0
        );
        run(&state, &server).await.unwrap();
        assert_eq!(*counts.lock().unwrap(), [2, 1, 2]);
    }

    #[tokio::test]
    async fn optional_judge_and_summary_failures_checkpoint_and_preserve_base_memories() {
        for malformed_judge in [false, true] {
            let state = extraction_state();
            {
                let conn = state.0.get().unwrap();
                conn.execute_batch(
                    "INSERT INTO memories (id, workspace_id, content) VALUES ('old', 'ws', 'User enjoys running');
                     INSERT INTO memory_summaries (id, scope, workspace_id, content)
                     VALUES ('summary', 'workspace', 'ws', 'Existing summary');"
                ).unwrap();
                conn.execute(
                    "INSERT INTO memory_embeddings (memory_id, embedding, model) VALUES ('old', ?1, 'embed')",
                    [crate::services::vector_index::f32_vec_to_bytes(&[1.0, 0.0])],
                ).unwrap();
            }
            let calls = Arc::new(Mutex::new(0));
            let seen = calls.clone();
            let server = FakeOllama::start(move |path, body| {
                *seen.lock().unwrap() += 1;
                if path == "/api/embed" {
                    return (200, json!({"embeddings": [[0.75, 0.6614]]}));
                }
                let prompt = body["messages"][0]["content"].as_str().unwrap();
                if prompt.starts_with("Decide whether") {
                    if malformed_judge {
                        chat("I cannot decide.")
                    } else {
                        (503, json!({"error": "judge offline"}))
                    }
                } else if prompt.starts_with("Write a concise summary") {
                    (503, json!({"error": "summary offline"}))
                } else {
                    chat(r#"["User switched to cycling"]"#)
                }
            })
            .await;
            let error = run(&state, &server).await.unwrap_err();
            assert!(error.contains("extraction completed with warnings"));
            assert!(error.contains("Contradiction judge failed; kept both memories"));
            assert!(error.contains("Summary regeneration failed"));
            assert_eq!(checkpoint(&state), 1);
            assert_eq!(
                scalar(
                    &state,
                    "SELECT COUNT(*) FROM memories WHERE is_active = 1 AND superseded_by IS NULL"
                ),
                2
            );
            assert_eq!(
                scalar(
                    &state,
                    "SELECT COUNT(*) FROM memory_summaries WHERE content = 'Existing summary'"
                ),
                1
            );
            assert_eq!(
                scalar(
                    &state,
                    "SELECT COUNT(*) FROM settings WHERE key = 'memory_extraction_retry:session'"
                ),
                0
            );
            run(&state, &server).await.unwrap();
            assert_eq!(*calls.lock().unwrap(), 4);
        }
    }

    #[tokio::test]
    async fn database_write_failure_rolls_back_and_does_not_checkpoint() {
        let state = extraction_state();
        state
            .0
            .get()
            .unwrap()
            .execute_batch(
                "CREATE TRIGGER fail_embedding BEFORE INSERT ON memory_embeddings
             BEGIN SELECT RAISE(ABORT, 'embedding write failed'); END;",
            )
            .unwrap();
        let server = FakeOllama::start(|path, body| {
            if path == "/api/embed" {
                (200, json!({"embeddings": [[1.0, 0.0]]}))
            } else if body["messages"][0]["content"]
                .as_str()
                .unwrap()
                .starts_with("Write a concise summary")
            {
                chat("User enjoys Rust.")
            } else {
                chat(r#"["User enjoys Rust"]"#)
            }
        })
        .await;
        assert!(run(&state, &server)
            .await
            .unwrap_err()
            .contains("embedding write failed"));
        assert_eq!(checkpoint(&state), 0);
        assert_eq!(scalar(&state, "SELECT COUNT(*) FROM memories"), 0);
        state
            .0
            .get()
            .unwrap()
            .execute_batch("DROP TRIGGER fail_embedding;")
            .unwrap();
        run(&state, &server).await.unwrap();
        assert_eq!(checkpoint(&state), 1);
        assert_eq!(scalar(&state, "SELECT COUNT(*) FROM memories"), 1);
        assert_eq!(scalar(&state, "SELECT COUNT(*) FROM memory_summaries"), 1);
    }

    #[tokio::test]
    async fn invalid_embeddings_and_failed_checkpoint_remain_retryable() {
        let state = extraction_state();
        let counts = Arc::new(Mutex::new([0; 2]));
        let seen = counts.clone();
        let server = FakeOllama::start(move |path, body| {
            let mut counts = seen.lock().unwrap();
            if path == "/api/embed" {
                counts[1] += 1;
                return if counts[1] == 1 {
                    (200, json!({"embeddings": [[]]}))
                } else {
                    (200, json!({"embeddings": [[1.0, 0.0]]}))
                };
            }
            if body["messages"][0]["content"]
                .as_str()
                .unwrap()
                .starts_with("Write a concise summary")
            {
                chat("User enjoys Rust.")
            } else {
                counts[0] += 1;
                chat(r#"["User enjoys Rust"]"#)
            }
        })
        .await;
        state
            .0
            .get()
            .unwrap()
            .execute(
                "UPDATE settings SET value = 'not-installed' WHERE key = 'embedding_model'",
                [],
            )
            .unwrap();
        assert!(run(&state, &server)
            .await
            .unwrap_err()
            .contains("not available locally"));
        assert_eq!(checkpoint(&state), 0);
        state
            .0
            .get()
            .unwrap()
            .execute(
                "UPDATE settings SET value = 'embed' WHERE key = 'embedding_model'",
                [],
            )
            .unwrap();
        assert!(run(&state, &server)
            .await
            .unwrap_err()
            .contains("Invalid empty"));
        assert_eq!(checkpoint(&state), 0);
        state.0.get().unwrap().execute_batch(
            "CREATE TRIGGER fail_checkpoint BEFORE UPDATE OF last_processed_message_count ON chat_sessions
             BEGIN SELECT RAISE(ABORT, 'checkpoint failed'); END;"
        ).unwrap();
        assert!(run(&state, &server)
            .await
            .unwrap_err()
            .contains("checkpoint failed"));
        assert_eq!(checkpoint(&state), 0);
        assert_eq!(scalar(&state, "SELECT COUNT(*) FROM memories"), 1);
        state
            .0
            .get()
            .unwrap()
            .execute_batch("DROP TRIGGER fail_checkpoint;")
            .unwrap();
        run(&state, &server).await.unwrap();
        assert_eq!(checkpoint(&state), 1);
        assert_eq!(scalar(&state, "SELECT COUNT(*) FROM memories"), 1);
        assert_eq!(*counts.lock().unwrap(), [1, 2]);
    }

    #[tokio::test]
    async fn imported_sessions_remain_opt_in_and_manual_summaries_and_snapshots_survive() {
        let state = extraction_state();
        state
            .0
            .get()
            .unwrap()
            .execute_batch(
                "UPDATE chat_sessions SET is_imported = 1 WHERE id = 'session';
             INSERT INTO memory_summaries (id, scope, workspace_id, content, is_auto_generated)
                 VALUES ('summary', 'workspace', 'ws', 'Hand edited summary', 0);
             INSERT INTO memory_summary_snapshots (id, summary_id, scope, workspace_id, content)
                 VALUES ('snapshot', 'summary', 'workspace', 'ws', 'Previous summary');",
            )
            .unwrap();
        let calls = Arc::new(Mutex::new(0));
        let seen = calls.clone();
        let server = FakeOllama::start(move |path, body| {
            *seen.lock().unwrap() += 1;
            if path == "/api/embed" {
                (200, json!({"embeddings": [[1.0, 0.0]]}))
            } else {
                assert!(!body["messages"][0]["content"]
                    .as_str()
                    .unwrap()
                    .starts_with("Write a concise summary"));
                chat(r#"["User enjoys Rust"]"#)
            }
        })
        .await;
        run(&state, &server).await.unwrap();
        assert_eq!(checkpoint(&state), 0);
        assert_eq!(*calls.lock().unwrap(), 0);
        super::process_memory_extraction_for_workspaces(
            &state,
            &["ws".to_string()],
            true,
            Some(server.url.clone()),
        )
        .await
        .unwrap();
        assert_eq!(checkpoint(&state), 1);
        assert_eq!(scalar(&state, "SELECT COUNT(*) FROM memories"), 1);
        assert_eq!(scalar(&state, "SELECT COUNT(*) FROM memory_summaries WHERE content = 'Hand edited summary' AND is_auto_generated = 0"), 1);
        assert_eq!(
            scalar(
                &state,
                "SELECT COUNT(*) FROM memory_summary_snapshots WHERE content = 'Previous summary'"
            ),
            1
        );
    }

    /// Mirrors the slicing math in `process_auto_memory_extraction` so
    /// off-by-one errors surface in unit tests instead of at runtime.
    fn extraction_window_start(last_count: i64) -> usize {
        (last_count as usize).saturating_sub(EXTRACTION_OVERLAP)
    }

    #[test]
    fn first_extraction_starts_at_zero() {
        // Brand-new session, no messages processed yet.
        assert_eq!(extraction_window_start(0), 0);
    }

    #[test]
    fn overlap_clamps_when_below_window() {
        // Only one message processed before — saturating_sub keeps start at 0.
        assert_eq!(extraction_window_start(1), 0);
        assert_eq!(extraction_window_start(2), 0);
    }

    #[test]
    fn overlap_reaches_back_two_messages() {
        // After 10 processed messages we re-include indices 8 and 9 plus everything new.
        assert_eq!(extraction_window_start(10), 8);
    }

    #[test]
    fn slice_only_includes_new_plus_overlap() {
        // 12 total messages, watermark at 10 → window is messages[8..12] (4 items).
        let messages: Vec<usize> = (0..12).collect();
        let start = extraction_window_start(10);
        let window = &messages[start..];
        assert_eq!(window, &[8, 9, 10, 11]);
    }

    /// Mirrors the dedup partitioning logic in `extract_and_store_memories`.
    /// Returns true when the candidate would be rejected as a duplicate of an
    /// existing memory of the same type.
    fn is_duplicate(
        candidate_type: &str,
        candidate_emb: &[f32],
        existing: &[(String, Vec<f32>)],
        threshold_fact: f32,
        threshold_pref: f32,
    ) -> bool {
        let threshold = if candidate_type == "preference" {
            threshold_pref
        } else {
            threshold_fact
        };
        existing
            .iter()
            .filter(|(t, _)| t == candidate_type)
            .any(|(_, e)| {
                crate::services::vector_index::cosine_similarity(candidate_emb, e) > threshold
            })
    }

    #[test]
    fn dedup_ignores_other_type_even_if_identical() {
        let emb = vec![1.0_f32, 0.0, 0.0];
        // Identical embedding exists, but as a fact — a preference candidate
        // must not be rejected by it.
        let existing = vec![("fact".to_string(), emb.clone())];
        assert!(!is_duplicate(
            "preference",
            &emb,
            &existing,
            DEFAULT_DEDUP_THRESHOLD_FACT,
            DEFAULT_DEDUP_THRESHOLD_PREFERENCE,
        ));
    }

    #[test]
    fn dedup_applies_stricter_threshold_for_preferences() {
        // Two preferences that are similar (~0.9 cosine) but distinct.
        // a should NOT dedupe b at the 0.92 preference threshold,
        // but WOULD dedupe at the 0.80 fact threshold.
        let a = vec![1.0_f32, 0.0];
        let b = vec![0.9_f32, 0.435]; // cosine ≈ 0.9 with a
        let existing = vec![("preference".to_string(), a)];
        assert!(!is_duplicate(
            "preference",
            &b,
            &existing,
            DEFAULT_DEDUP_THRESHOLD_FACT,
            DEFAULT_DEDUP_THRESHOLD_PREFERENCE,
        ));
        // If the same vectors were facts, they WOULD collide.
        let existing_facts = vec![("fact".to_string(), vec![1.0_f32, 0.0])];
        assert!(is_duplicate(
            "fact",
            &b,
            &existing_facts,
            DEFAULT_DEDUP_THRESHOLD_FACT,
            DEFAULT_DEDUP_THRESHOLD_PREFERENCE,
        ));
    }

    #[test]
    fn dedup_rejects_near_identical_same_type() {
        let a = vec![1.0_f32, 0.0, 0.0];
        let b = vec![0.999_f32, 0.001, 0.0];
        let existing = vec![("fact".to_string(), a)];
        assert!(is_duplicate(
            "fact",
            &b,
            &existing,
            DEFAULT_DEDUP_THRESHOLD_FACT,
            DEFAULT_DEDUP_THRESHOLD_PREFERENCE,
        ));
    }

    /// Verifies the v61 schema migration applied and the reinforcement
    /// UPDATE statement used by the pipeline runs against the real DB.
    #[test]
    fn reinforcement_update_bumps_count_and_timestamp() {
        let pool = test_state().0;
        let conn = pool.get().expect("get conn");

        // Workspace + memory with default reinforcement_count=1, no last_reinforced_at.
        conn.execute(
            "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            rusqlite::params!["ws1", "Test", "2025-01-01T00:00:00Z"],
        )
        .expect("insert workspace");
        conn.execute(
            "INSERT INTO memories (id, workspace_id, content, memory_type, scope, is_pinned, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'fact', 'workspace', 0, 1, ?4, ?4)",
            rusqlite::params!["m1", "ws1", "User likes Rust", "2025-01-01T00:00:00Z"],
        )
        .expect("insert memory");

        // Sanity: defaults
        let (count, last): (i64, Option<String>) = conn
            .query_row(
                "SELECT reinforcement_count, last_reinforced_at FROM memories WHERE id = 'm1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("read row");
        assert_eq!(count, 1);
        assert!(last.is_none());

        // Reinforce, mirroring the SQL the pipeline issues.
        let now = "2025-02-02T12:34:56Z";
        conn.execute(
            "UPDATE memories
               SET reinforcement_count = reinforcement_count + 1,
                   last_reinforced_at = ?1,
                   updated_at = ?1
             WHERE id = ?2",
            rusqlite::params![now, "m1"],
        )
        .expect("reinforce");

        let (count, last, updated): (i64, Option<String>, String) = conn
            .query_row(
                "SELECT reinforcement_count, last_reinforced_at, updated_at FROM memories WHERE id = 'm1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("read row");
        assert_eq!(count, 2);
        assert_eq!(last.as_deref(), Some(now));
        assert_eq!(updated, now);
    }

    /// Verifies the v62 schema migration applied and the supersession UPDATE
    /// statement used by the pipeline runs against the real DB. Mirrors the
    /// "User is learning Python" → "User switched from Python to Rust"
    /// scenario from the plan.
    #[test]
    fn supersession_update_marks_old_inactive_and_links_new() {
        let pool = test_state().0;
        let conn = pool.get().expect("get conn");

        conn.execute(
            "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            rusqlite::params!["ws1", "Test", "2025-01-01T00:00:00Z"],
        )
        .expect("insert workspace");
        // First extraction: original fact.
        conn.execute(
            "INSERT INTO memories (id, workspace_id, content, memory_type, scope, is_pinned, is_active, created_at, updated_at)
             VALUES ('old', 'ws1', 'User is learning Python', 'fact', 'workspace', 0, 1, ?1, ?1)",
            rusqlite::params!["2025-01-01T00:00:00Z"],
        )
        .expect("insert old");
        // Second extraction: replacement fact.
        conn.execute(
            "INSERT INTO memories (id, workspace_id, content, memory_type, scope, is_pinned, is_active, created_at, updated_at)
             VALUES ('new', 'ws1', 'User switched from Python to Rust', 'fact', 'workspace', 0, 1, ?1, ?1)",
            rusqlite::params!["2025-02-01T00:00:00Z"],
        )
        .expect("insert new");

        // Pipeline-equivalent supersession UPDATE.
        let now = "2025-02-01T00:00:00Z";
        conn.execute(
            "UPDATE memories
               SET is_active = 0,
                   superseded_by = ?1,
                   superseded_at = ?2,
                   superseded_reason = ?3,
                   updated_at = ?2
             WHERE id = ?4",
            rusqlite::params!["new", now, "SUPERSEDES", "old"],
        )
        .expect("supersede");

        let (is_active, by, at, reason): (i64, Option<String>, Option<String>, Option<String>) =
            conn.query_row(
                "SELECT is_active, superseded_by, superseded_at, superseded_reason FROM memories WHERE id = 'old'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .expect("read old");
        assert_eq!(is_active, 0, "old memory must be deactivated");
        assert_eq!(by.as_deref(), Some("new"));
        assert_eq!(at.as_deref(), Some(now));
        assert_eq!(reason.as_deref(), Some("SUPERSEDES"));

        // The new memory must remain active and unaffected.
        let new_is_active: i64 = conn
            .query_row("SELECT is_active FROM memories WHERE id = 'new'", [], |r| {
                r.get(0)
            })
            .expect("read new");
        assert_eq!(new_is_active, 1);

        // get_active_memories-style query must exclude the superseded row.
        let active_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM memories WHERE is_active = 1 AND workspace_id = 'ws1'",
                [],
                |r| r.get(0),
            )
            .expect("count");
        assert_eq!(active_count, 1);
    }
}
