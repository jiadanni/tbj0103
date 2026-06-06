use crate::db::DbState;
use crate::models::chat::Message;
use crate::ollama::client::{OllamaClient, OllamaMessage};
use crate::services::model_settings::{get_embedding_model, get_model_for_job};

/// Number of messages prior to the high-water mark that are re-included in
/// each extraction window. Keeps cross-turn facts visible without re-prompting
/// the entire session every tick.
const EXTRACTION_OVERLAP: usize = 2;

/// Default cosine-similarity thresholds used by the dedup pass when no
/// per-user setting is configured. Preferences are kept stricter because they
/// tend to be short, near-synonymous phrases ("prefers concise" vs "wants
/// short answers") and would otherwise collide too aggressively.
const DEFAULT_DEDUP_THRESHOLD_FACT: f32 = 0.85;
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
fn get_extraction_idle_minutes(state: &DbState) -> u32 {
    let conn = match state.0.get() {
        Ok(c) => c,
        Err(_) => return 5,
    };
    crate::commands::settings::get_setting(&conn, "memory_extraction_idle_minutes")
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
            let idle_minutes = get_extraction_idle_minutes(state);
            let sql = format!(
                "SELECT id, workspace_id, folder_id, last_processed_message_count FROM chat_sessions \
                 WHERE datetime(updated_at) > datetime('now', '-{} minutes') \
                 AND is_incognito = 0 \
                 AND exclude_from_analytics = 0 \
                 AND is_imported = 0 \
                 ORDER BY updated_at DESC \
                 LIMIT 5",
                idle_minutes
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            sessions = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
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
                sessions.extend(rows.filter_map(Result::ok));
            }
        }
        sessions
    };

    for (session_id, workspace_id, folder_id, last_count) in sessions {
        let messages = {
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
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            messages
        };

        if !messages.is_empty()
            && messages.len() >= threshold
            && messages.len() > last_count as usize
        {
            // Phase 1: slice from the high-water mark with a small overlap so the
            // extractor sees enough context for facts that span the boundary.
            // Overlap is small to keep the prompt cheap.
            let start = (last_count as usize).saturating_sub(EXTRACTION_OVERLAP);
            let window = &messages[start..];

            if extract_and_store_memories(
                state,
                &workspace_id,
                &folder_id,
                &session_id,
                window,
                ollama_url.clone(),
            )
            .await
            .is_ok()
            {
                if let Ok(conn) = state.0.get() {
                    let _ = conn.execute(
                        "UPDATE chat_sessions SET last_processed_message_count = ?1 WHERE id = ?2",
                        rusqlite::params![messages.len() as i64, session_id],
                    );
                }
            }
        }
    }

    Ok(())
}

pub async fn extract_and_store_memories(
    state: &DbState,
    workspace_id: &str,
    folder_id: &str,
    session_id: &str,
    recent_messages: &[Message],
    ollama_url: Option<String>,
) -> Result<(), String> {
    if recent_messages.is_empty() {
        return Ok(());
    }

    let Ok(client) = OllamaClient::new(ollama_url) else {
        return Ok(());
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
        let existing: Vec<(String, String, String, Vec<f32>)> = conn
            .prepare(
                "SELECT m.id, m.memory_type, m.content, me.embedding FROM memory_embeddings me 
             JOIN memories m ON me.memory_id = m.id 
             WHERE m.workspace_id = ?1 AND m.is_active = 1 AND m.superseded_by IS NULL",
            )
            .ok()
            .map(|mut stmt| {
                stmt.query_map(rusqlite::params![workspace_id], |row| {
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
                .ok()
                .map(|iter| iter.flatten().collect::<Vec<_>>())
                .unwrap_or_default()
            })
            .unwrap_or_default();

        let t_fact = dedup_threshold_for(&conn, "fact");
        let t_pref = dedup_threshold_for(&conn, "preference");

        (model, emb_model, existing, t_fact, t_pref)
    }; // DB lock released here

    let Some(model) = model else {
        return Ok(());
    };
    let Some(embedding_model) = embedding_model else {
        return Ok(());
    };

    if let Ok(response) = client
        .send_message_with_options("memory_pipeline", &model, msgs, Some("0s"))
        .await
    {
        // Parse structured JSON: [{"type":"fact"|"preference","content":"..."}]
        if let Some(start) = response.find('[') {
            if let Some(end) = response.rfind(']') {
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
                                let content = item.content?;
                                let mem_type = match item.memory_type.as_deref() {
                                    Some("preference") => "preference".to_string(),
                                    _ => "fact".to_string(),
                                };
                                Some((content, mem_type))
                            })
                            .collect()
                    } else if let Ok(plain) = serde_json::from_str::<Vec<String>>(json_str) {
                        plain.into_iter().map(|s| (s, "fact".to_string())).collect()
                    } else {
                        vec![]
                    };

                // Post-extraction validation: reject assistant-like content
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
                    let embedding = if let Ok(emb) = client
                        .generate_embedding_with_options(
                            "memory_pipeline",
                            &embedding_model,
                            &content,
                            Some("0s"),
                        )
                        .await
                    {
                        emb
                    } else {
                        continue;
                    };

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
                                    if let Some(verdict) =
                                        judge_supersedes(&client, &model, &old_content, &content)
                                            .await
                                    {
                                        superseded_old = Some((old_id, verdict));
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
                if !new_memories.is_empty() || !reinforced_ids.is_empty() {
                    let conn = state.0.get().map_err(|e| e.to_string())?;
                    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
                    let now = chrono::Utc::now().to_rfc3339();
                    for (content, memory_type, id, embedding_bytes) in &new_memories {
                        let _ = conn.execute(
                            "INSERT INTO memories (id, workspace_id, folder_id, content, memory_type, scope, source_session_id, is_pinned, is_active, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, 'workspace', ?6, 0, 1, ?7, ?8)",
                            rusqlite::params![id, workspace_id, folder_id, content, memory_type, session_id, now, now],
                        );
                        let _ = conn.execute(
                            "INSERT INTO memory_embeddings (memory_id, embedding, model, created_at)
                             VALUES (?1, ?2, ?3, ?4)",
                            rusqlite::params![id, embedding_bytes, embedding_model, now],
                        );
                    }
                    for id in &reinforced_ids {
                        let _ = conn.execute(
                            "UPDATE memories
                               SET reinforcement_count = reinforcement_count + 1,
                                   last_reinforced_at = ?1,
                                   updated_at = ?1
                             WHERE id = ?2",
                            rusqlite::params![now, id],
                        );
                    }
                    for (new_id, old_id, verdict) in &supersessions {
                        let _ = conn.execute(
                            "UPDATE memories
                               SET is_active = 0,
                                   superseded_by = ?1,
                                   superseded_at = ?2,
                                   superseded_reason = ?3,
                                   updated_at = ?2
                             WHERE id = ?4",
                            rusqlite::params![new_id, now, verdict, old_id],
                        );
                    }
                    let _ = conn.execute_batch("COMMIT");

                    // Auto-regenerate workspace summary only when new memories
                    // were inserted — reinforcement alone does not change the
                    // set of facts and would just burn tokens.
                    if !new_memories.is_empty() {
                        let should_regen: bool = conn
                            .query_row(
                                "SELECT is_auto_generated FROM memory_summaries WHERE scope = 'workspace' AND workspace_id = ?1",
                                rusqlite::params![workspace_id],
                                |row| row.get::<_, i32>(0).map(|v| v != 0),
                            )
                            .unwrap_or(true); // If no summary exists yet, generate one

                        if should_regen {
                            // Trigger summary regeneration (best-effort, don't fail extraction)
                            let _ = auto_regenerate_summary(
                                state,
                                "workspace",
                                Some(workspace_id),
                                &client,
                                &model,
                            )
                            .await;
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

/// Phase 4: ask the configured memory-extraction model whether `new_content`
/// semantically supersedes `old_content`. Returns the raw verdict (`"SUPERSEDES"`)
/// when the model agrees, or `None` otherwise — including the timeout / error
/// case, which we treat as "do not supersede" to fail safe.
async fn judge_supersedes(
    client: &OllamaClient,
    model: &str,
    old_content: &str,
    new_content: &str,
) -> Option<String> {
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
        // Network error or timeout — fail safe by treating as NEITHER.
        _ => return None,
    };
    let verdict = response.trim().to_uppercase();
    // Strict parsing: only the first word of the response is considered, and
    // it must be SUPERSEDES. Anything else (including hallucinated extras) is
    // treated as NEITHER.
    let first = verdict.split_whitespace().next().unwrap_or("");
    if first == "SUPERSEDES" {
        Some("SUPERSEDES".to_string())
    } else {
        None
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
        // but WOULD dedupe at the 0.85 fact threshold.
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
        let pool = crate::db::test_utils::tests::setup_test_db();
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
        let pool = crate::db::test_utils::tests::setup_test_db();
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
