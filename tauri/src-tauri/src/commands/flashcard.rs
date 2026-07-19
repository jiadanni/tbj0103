use crate::db::DbState;
use crate::models::learning_card::{
    CreateCardRequest, ExtractFlashcardsRequest, FlashcardTopic, GenerateCardsRequest,
    GenerateForTopicRequest, GenerateFromConceptRequest, LearningCard, ReviewRequest, ReviewStats,
};
use crate::ollama::client::{OllamaClient, OllamaMessage};
use crate::services::spaced_repetition;
use crate::services::workspace_hierarchy::workspace_filter_sql;
use tauri::State;

fn row_to_card(row: &rusqlite::Row) -> rusqlite::Result<LearningCard> {
    Ok(LearningCard {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        front: row.get(2)?,
        back: row.get(3)?,
        source_type: row.get(4)?,
        source_id: row.get(5)?,
        topic_id: row.get(6)?,
        ease_factor: row.get(7)?,
        interval: row.get(8)?,
        repetitions: row.get(9)?,
        next_review_date: row.get(10)?,
        last_reviewed_at: row.get(11)?,
        created_at: row.get(12)?,
        generated_by_model: row.get(13)?,
    })
}

pub(crate) const INSERT_CARD_SQL: &str = "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, source_id, topic_id, ease_factor, interval, repetitions, next_review_date, last_reviewed_at, created_at, generated_by_model)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)";

/// Difficulty levels used when crafting a generation prompt.
#[derive(Debug, Clone, Copy)]
pub(crate) enum CardDifficulty {
    Introductory,
    Applied,
    Synthesis,
}

impl CardDifficulty {
    pub(crate) fn from_mastery(mastery: f64) -> Self {
        if mastery < 0.3 {
            Self::Introductory
        } else if mastery < 0.7 {
            Self::Applied
        } else {
            Self::Synthesis
        }
    }

    fn descriptor(self) -> &'static str {
        match self {
            Self::Introductory => "introductory, definitional, single-fact",
            Self::Applied => "applied, scenario-based, requiring practical understanding",
            Self::Synthesis => "synthesis, edge cases, comparison and tradeoffs",
        }
    }
}

/// Calls Ollama with a topic + difficulty descriptor and returns parsed front/back pairs.
/// Used by both the manual `generate_flashcards` command and the background topic service.
/// `existing_fronts` are questions the topic already has — the model is told to
/// cover new ground instead of repeating them.
pub(crate) async fn generate_card_pairs(
    topic: &str,
    model: &str,
    count: u32,
    difficulty: CardDifficulty,
    existing_fronts: &[String],
    ollama_url: Option<String>,
) -> Result<Vec<(String, String)>, String> {
    let count = count.clamp(1, 20);
    let mut prompt = format!(
        "Generate exactly {count} {difficulty} flashcards about: \"{topic}\"\n\n\
        Output ONLY a JSON array of objects, each with \"front\" (question) and \"back\" (answer) keys.\n\
        No markdown, no explanation, no code fences — just the raw JSON array.\n\
        Example: [{{\"front\":\"What is X?\",\"back\":\"X is...\"}}]",
        count = count,
        difficulty = difficulty.descriptor(),
        topic = topic,
    );
    if !existing_fronts.is_empty() {
        let list = existing_fronts
            .iter()
            .take(30)
            .map(|front| {
                let truncated: String = front.chars().take(100).collect();
                format!("- {truncated}")
            })
            .collect::<Vec<_>>()
            .join("\n");
        prompt.push_str(&format!(
            "\n\nThese flashcards already exist for this topic. Do NOT repeat or trivially rephrase any of them — cover different facts, angles, or edge cases:\n{list}"
        ));
    }
    let client = OllamaClient::new(ollama_url)?;
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    let raw = client.send_message("flashcard", model, messages).await?;
    let trimmed = raw.trim();
    let json_str = if let Some(start) = trimmed.find('[') {
        if let Some(end) = trimmed.rfind(']') {
            &trimmed[start..=end]
        } else {
            return Err("AI response did not contain a valid JSON array".to_string());
        }
    } else {
        return Err("AI response did not contain a JSON array".to_string());
    };

    #[derive(serde::Deserialize)]
    struct CardPair {
        front: String,
        back: String,
    }
    let pairs: Vec<CardPair> = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse AI-generated cards: {e}\nRaw: {json_str}"))?;
    Ok(pairs
        .into_iter()
        .filter(|p| !p.front.trim().is_empty() && !p.back.trim().is_empty())
        .map(|p| (p.front, p.back))
        .collect())
}

pub(crate) fn insert_card(
    conn: &rusqlite::Connection,
    card: &LearningCard,
) -> rusqlite::Result<()> {
    conn.execute(
        INSERT_CARD_SQL,
        rusqlite::params![
            card.id,
            card.workspace_id,
            card.front,
            card.back,
            card.source_type,
            card.source_id,
            card.topic_id,
            card.ease_factor,
            card.interval,
            card.repetitions,
            card.next_review_date,
            card.last_reviewed_at,
            card.created_at,
            card.generated_by_model
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub fn create_flashcard(
    state: State<DbState>,
    req: CreateCardRequest,
) -> Result<LearningCard, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut card = LearningCard::new(req.workspace_id, req.front, req.back);
    if let Some(st) = req.source_type {
        card.source_type = st;
    }
    card.source_id = req.source_id;
    insert_card(&conn, &card).map_err(|e| e.to_string())?;
    Ok(card)
}

/// Returns cards due today or overdue, for a given folder.
/// Optionally filter to a single concept (`source_type = 'concept' AND source_id = ?`).
#[tauri::command]
pub fn list_flashcards_due(
    state: State<DbState>,
    workspace_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
    include_descendants: Option<bool>,
    concept_id: Option<String>,
) -> Result<Vec<LearningCard>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(200).clamp(1, 1000);
    let offset = offset.unwrap_or(0).max(0);
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let (cte, ws_cond) = workspace_filter_sql(include_descendants.unwrap_or(false));
    let sql = format!(
        "{cte}SELECT id, workspace_id, front, back, source_type, source_id, topic_id, ease_factor, interval, repetitions, next_review_date, last_reviewed_at, created_at, generated_by_model
         FROM learning_cards WHERE workspace_id {ws_cond}
           AND next_review_date <= ?2
           AND (?5 IS NULL OR (source_type = 'concept' AND source_id = ?5))
         ORDER BY next_review_date ASC LIMIT ?3 OFFSET ?4"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(
            rusqlite::params![workspace_id, today, limit, offset, concept_id],
            row_to_card,
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

/// Apply SM-2 review and update the card.
#[tauri::command]
pub fn review_flashcard(state: State<DbState>, req: ReviewRequest) -> Result<LearningCard, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    // Fetch current card
    let card = conn.query_row(
        "SELECT id, workspace_id, front, back, source_type, source_id, topic_id, ease_factor, interval, repetitions, next_review_date, last_reviewed_at, created_at, generated_by_model
         FROM learning_cards WHERE id = ?1",
        rusqlite::params![req.card_id],
        row_to_card,
    ).map_err(|e| e.to_string())?;
    // Compute new SM-2 values
    let result = spaced_repetition::review_card(&card, req.quality);
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE learning_cards SET ease_factor = ?1, interval = ?2, repetitions = ?3, next_review_date = ?4, last_reviewed_at = ?5 WHERE id = ?6",
        rusqlite::params![result.ease_factor, result.interval, result.repetitions, result.next_review_date, now, req.card_id],
    ).map_err(|e| e.to_string())?;
    // Sync review_count on linked concept node
    if card.source_type == "concept" {
        if let Some(ref concept_id) = card.source_id {
            let _ = conn.execute(
                "UPDATE concept_nodes SET review_count = review_count + 1, updated_at = ?1 WHERE id = ?2",
                rusqlite::params![now, concept_id],
            );
        }
    }
    if let Some(ref topic_id) = card.topic_id {
        crate::services::flashcard_topic_service::on_card_reviewed(&conn, topic_id);
    }
    let updated_card = LearningCard {
        ease_factor: result.ease_factor,
        interval: result.interval,
        repetitions: result.repetitions,
        next_review_date: result.next_review_date,
        last_reviewed_at: Some(now.clone()),
        ..card
    };
    Ok(updated_card)
}

#[tauri::command]
pub fn get_review_stats(
    state: State<DbState>,
    workspace_id: String,
) -> Result<ReviewStats, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let total_cards: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learning_cards WHERE workspace_id = ?1",
            rusqlite::params![workspace_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let due_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM learning_cards WHERE workspace_id = ?1 AND next_review_date <= ?2",
        rusqlite::params![workspace_id, today], |r| r.get(0)
    ).unwrap_or(0);
    let learned: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learning_cards WHERE workspace_id = ?1 AND repetitions > 0",
            rusqlite::params![workspace_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let avg_ease: f64 = conn
        .query_row(
            "SELECT COALESCE(AVG(ease_factor), 2.5) FROM learning_cards WHERE workspace_id = ?1",
            rusqlite::params![workspace_id],
            |r| r.get(0),
        )
        .unwrap_or(2.5);
    Ok(ReviewStats {
        total_cards,
        due_today,
        learned,
        avg_ease,
    })
}

/// Use an LLM to generate flashcards from a topic, then bulk-insert them.
#[tauri::command]
pub async fn generate_flashcards(
    state: State<'_, DbState>,
    req: GenerateCardsRequest,
) -> Result<Vec<LearningCard>, String> {
    let count = req.count.unwrap_or(5);
    let existing_fronts: Vec<String> = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT front FROM learning_cards
                 WHERE workspace_id = ?1
                   AND (
                     topic_id IN (SELECT id FROM flashcard_topics
                                  WHERE workspace_id = ?1 AND LOWER(topic) = LOWER(?2))
                     OR (topic_id IS NULL AND source_type = 'ai_generated')
                   )
                 ORDER BY created_at DESC
                 LIMIT 30",
            )
            .map_err(|e| e.to_string())?;
        let fronts: Vec<String> = stmt
            .query_map(rusqlite::params![req.workspace_id, req.topic], |r| {
                r.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        fronts
    };
    let pairs = generate_card_pairs(
        &req.topic,
        &req.model,
        count,
        CardDifficulty::Applied,
        &existing_fronts,
        req.ollama_url,
    )
    .await?;

    let mut conn = state.0.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut cards = Vec::new();
    for (front, back) in pairs {
        let mut card = LearningCard::new(req.workspace_id.clone(), front, back);
        card.source_type = "ai_generated".to_string();
        card.generated_by_model = Some(req.model.clone());
        tx.execute(
            INSERT_CARD_SQL,
            rusqlite::params![
                card.id,
                card.workspace_id,
                card.front,
                card.back,
                card.source_type,
                card.source_id,
                card.topic_id,
                card.ease_factor,
                card.interval,
                card.repetitions,
                card.next_review_date,
                card.last_reviewed_at,
                card.created_at,
                card.generated_by_model
            ],
        )
        .map_err(|e| e.to_string())?;
        cards.push(card);
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(cards)
}

/// Generate flashcards from an existing concept node.
#[tauri::command]
pub async fn generate_flashcards_from_concept(
    state: State<'_, DbState>,
    req: GenerateFromConceptRequest,
) -> Result<Vec<LearningCard>, String> {
    // Fetch the concept
    let (concept_name, concept_desc) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let row = conn
            .query_row(
                "SELECT name, concept_description FROM concept_nodes WHERE id = ?1",
                rusqlite::params![req.concept_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .map_err(|e| format!("Concept not found: {e}"))?;
        row
    };

    let topic = if concept_desc.is_empty() {
        concept_name.clone()
    } else {
        format!("{concept_name}: {concept_desc}")
    };

    let count = req.count.unwrap_or(5).min(20);
    let prompt = format!(
        "Generate exactly {count} flashcards about: \"{topic}\"\n\n\
        Output ONLY a JSON array of objects, each with \"front\" (question) and \"back\" (answer) keys.\n\
        No markdown, no explanation, no code fences — just the raw JSON array.\n\
        Example: [{{\"front\":\"What is X?\",\"back\":\"X is...\"}}]",
        count = count,
        topic = topic,
    );
    let client = OllamaClient::new(req.ollama_url)?;
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    let raw = client
        .send_message("flashcard", &req.model, messages)
        .await?;

    let trimmed = raw.trim();
    let json_str = if let Some(start) = trimmed.find('[') {
        if let Some(end) = trimmed.rfind(']') {
            &trimmed[start..=end]
        } else {
            return Err("AI response did not contain a valid JSON array".to_string());
        }
    } else {
        return Err("AI response did not contain a JSON array".to_string());
    };

    #[derive(serde::Deserialize)]
    struct CardPair {
        front: String,
        back: String,
    }

    let pairs: Vec<CardPair> = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse AI-generated cards: {e}\nRaw: {json_str}"))?;

    let mut conn = state.0.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut cards = Vec::new();
    for pair in pairs {
        if pair.front.trim().is_empty() || pair.back.trim().is_empty() {
            continue;
        }
        let mut card = LearningCard::new(req.workspace_id.clone(), pair.front, pair.back);
        card.source_type = "concept".to_string();
        card.source_id = Some(req.concept_id.clone());
        card.generated_by_model = Some(req.model.clone());
        tx.execute(
            INSERT_CARD_SQL,
            rusqlite::params![
                card.id,
                card.workspace_id,
                card.front,
                card.back,
                card.source_type,
                card.source_id,
                card.topic_id,
                card.ease_factor,
                card.interval,
                card.repetitions,
                card.next_review_date,
                card.last_reviewed_at,
                card.created_at,
                card.generated_by_model
            ],
        )
        .map_err(|e| e.to_string())?;
        cards.push(card);
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(cards)
}

/// List all flashcards linked to a specific concept node.
#[tauri::command]
pub fn list_flashcards_by_concept(
    state: State<DbState>,
    concept_id: String,
) -> Result<Vec<LearningCard>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, front, back, source_type, source_id, topic_id, ease_factor, interval, repetitions, next_review_date, last_reviewed_at, created_at, generated_by_model
         FROM learning_cards WHERE source_type = 'concept' AND source_id = ?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(rusqlite::params![concept_id], row_to_card)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

/// List all concept-linked flashcards for a workspace so they can be shown in the graph.
#[tauri::command]
pub fn list_graph_flashcards(
    state: State<DbState>,
    workspace_id: String,
) -> Result<Vec<LearningCard>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT lc.id, lc.workspace_id, lc.front, lc.back, lc.source_type, lc.source_id, lc.topic_id,
                lc.ease_factor, lc.interval, lc.repetitions, lc.next_review_date, lc.last_reviewed_at, lc.created_at
         FROM learning_cards lc
         JOIN concept_nodes cn ON cn.id = lc.source_id
         WHERE lc.workspace_id = ?1
           AND lc.source_type = 'concept'
           AND cn.workspace_id = ?1
         ORDER BY lc.created_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(rusqlite::params![workspace_id], row_to_card)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

/// Extract flashcards from arbitrary text content (chat response, note, etc.).
/// Uses the LLM to identify key Q&A pairs worth remembering.
#[tauri::command]
pub async fn extract_flashcards_from_content(
    state: State<'_, DbState>,
    req: ExtractFlashcardsRequest,
) -> Result<Vec<LearningCard>, String> {
    let content = req.content.trim().to_string();
    if content.len() < 50 {
        return Ok(vec![]); // Too short to extract meaningful cards
    }

    // Truncate to avoid overwhelming the LLM
    let text: String = content.chars().take(3000).collect();

    let prompt = format!(
        "Read the following text and extract 1-5 flashcards for key facts, concepts, or definitions worth remembering.\n\
        Only extract cards if the text contains educational or factual content. If the text is casual conversation, return an empty array.\n\n\
        Text:\n\"{text}\"\n\n\
        Output ONLY a JSON array of objects, each with \"front\" (question) and \"back\" (answer) keys.\n\
        If nothing is worth making a flashcard for, return: []\n\
        No markdown, no explanation, no code fences — just the raw JSON array."
    );

    let client = OllamaClient::new(req.ollama_url)?;
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    let raw = client
        .send_message("flashcard", &req.model, messages)
        .await?;

    let trimmed = raw.trim();
    let json_str = if let Some(start) = trimmed.find('[') {
        if let Some(end) = trimmed.rfind(']') {
            &trimmed[start..=end]
        } else {
            return Ok(vec![]);
        }
    } else {
        return Ok(vec![]);
    };

    #[derive(serde::Deserialize)]
    struct CardPair {
        front: String,
        back: String,
    }

    let pairs: Vec<CardPair> = serde_json::from_str(json_str).unwrap_or_default();
    if pairs.is_empty() {
        return Ok(vec![]);
    }

    let mut conn = state.0.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut cards = Vec::new();
    for pair in pairs {
        if pair.front.trim().is_empty() || pair.back.trim().is_empty() {
            continue;
        }
        let mut card = LearningCard::new(req.workspace_id.clone(), pair.front, pair.back);
        card.source_type = req.source_type.clone();
        card.source_id = req.source_id.clone();
        card.generated_by_model = Some(req.model.clone());
        tx.execute(
            INSERT_CARD_SQL,
            rusqlite::params![
                card.id,
                card.workspace_id,
                card.front,
                card.back,
                card.source_type,
                card.source_id,
                card.topic_id,
                card.ease_factor,
                card.interval,
                card.repetitions,
                card.next_review_date,
                card.last_reviewed_at,
                card.created_at,
                card.generated_by_model
            ],
        )
        .map_err(|e| e.to_string())?;
        cards.push(card);
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(cards)
}

/// List flashcard topics for a workspace that currently have at least one card
/// (derived from chat topic signatures; empty/stale topics are excluded).
#[tauri::command]
pub fn list_flashcard_topics(
    state: State<DbState>,
    workspace_id: String,
    include_descendants: Option<bool>,
) -> Result<Vec<FlashcardTopic>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let (cte, ws_cond) = workspace_filter_sql(include_descendants.unwrap_or(false));
    let sql = format!(
        "{cte}SELECT id, workspace_id, topic, source, mastery_score, last_generated_at, card_count, parent_topic_id
         FROM flashcard_topics WHERE workspace_id {ws_cond} AND card_count > 0
         ORDER BY mastery_score ASC, card_count DESC, topic ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![workspace_id], |r| {
            Ok(FlashcardTopic {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                topic: r.get(2)?,
                source: r.get(3)?,
                mastery_score: r.get(4)?,
                last_generated_at: r.get(5)?,
                card_count: r.get(6)?,
                parent_topic_id: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Generate one batch of flashcards for a specific topic, respecting current mastery for difficulty.
#[tauri::command]
pub async fn generate_flashcards_for_topic(
    state: State<'_, DbState>,
    req: GenerateForTopicRequest,
) -> Result<Vec<LearningCard>, String> {
    let topic_row = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, workspace_id, topic, mastery_score, last_generated_at, card_count
             FROM flashcard_topics WHERE id = ?1",
            rusqlite::params![req.topic_id],
            |r| {
                Ok(
                    crate::services::flashcard_topic_service::FlashcardTopicRow {
                        id: r.get(0)?,
                        workspace_id: r.get(1)?,
                        topic: r.get(2)?,
                        mastery_score: r.get(3)?,
                        last_generated_at: r.get(4)?,
                        card_count: r.get(5)?,
                    },
                )
            },
        )
        .map_err(|e| format!("Topic not found: {e}"))?
    };
    let count = req.count.unwrap_or(5);
    crate::services::flashcard_topic_service::generate_for_topic(
        &state,
        &topic_row,
        &req.model,
        count,
        req.ollama_url,
    )
    .await
}

#[derive(serde::Serialize)]
pub struct SuggestedTopic {
    pub topic: FlashcardTopic,
    pub reason: String,
    pub due_count: i64,
}

/// Pick the next topic the user should review.
/// 1. Topic with the most due cards (overdue/today).
/// 2. Topic with cards and the lowest mastery_score.
/// 3. Most recently generated topic.
#[tauri::command]
pub fn suggest_next_topic(
    state: State<DbState>,
    workspace_id: String,
    include_descendants: Option<bool>,
) -> Result<Option<SuggestedTopic>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let (cte, ws_cond) = workspace_filter_sql(include_descendants.unwrap_or(false));
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    // 1. most due
    let sql_due = format!(
        "{cte}SELECT t.id, t.workspace_id, t.topic, t.source, t.mastery_score, t.last_generated_at, t.card_count, t.parent_topic_id,
                COUNT(c.id) AS due
         FROM flashcard_topics t
         JOIN learning_cards c ON c.topic_id = t.id AND c.next_review_date <= ?2
         WHERE t.workspace_id {ws_cond}
         GROUP BY t.id
         ORDER BY due DESC, t.mastery_score ASC
         LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql_due).map_err(|e| e.to_string())?;
    let row: Option<(FlashcardTopic, i64)> = stmt
        .query_row(rusqlite::params![workspace_id, today], |r| {
            Ok((
                FlashcardTopic {
                    id: r.get(0)?,
                    workspace_id: r.get(1)?,
                    topic: r.get(2)?,
                    source: r.get(3)?,
                    mastery_score: r.get(4)?,
                    last_generated_at: r.get(5)?,
                    card_count: r.get(6)?,
                    parent_topic_id: r.get(7)?,
                },
                r.get::<_, i64>(8)?,
            ))
        })
        .ok();
    if let Some((topic, due_count)) = row {
        if due_count > 0 {
            return Ok(Some(SuggestedTopic {
                topic,
                reason: format!(
                    "{due_count} card{} due",
                    if due_count == 1 { "" } else { "s" }
                ),
                due_count,
            }));
        }
    }

    // 2. lowest mastery with cards
    let sql_weak = format!(
        "{cte}SELECT id, workspace_id, topic, source, mastery_score, last_generated_at, card_count, parent_topic_id
         FROM flashcard_topics WHERE workspace_id {ws_cond} AND card_count > 0
         ORDER BY mastery_score ASC, card_count DESC
         LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql_weak).map_err(|e| e.to_string())?;
    let weak: Option<FlashcardTopic> = stmt
        .query_row(rusqlite::params![workspace_id], |r| {
            Ok(FlashcardTopic {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                topic: r.get(2)?,
                source: r.get(3)?,
                mastery_score: r.get(4)?,
                last_generated_at: r.get(5)?,
                card_count: r.get(6)?,
                parent_topic_id: r.get(7)?,
            })
        })
        .ok();
    if let Some(topic) = weak {
        let mastery_pct = (topic.mastery_score * 100.0).round() as i64;
        return Ok(Some(SuggestedTopic {
            reason: format!("Weakest topic ({mastery_pct}% mastery)"),
            topic,
            due_count: 0,
        }));
    }

    // 3. most recently created
    let sql_recent = format!(
        "{cte}SELECT id, workspace_id, topic, source, mastery_score, last_generated_at, card_count, parent_topic_id
         FROM flashcard_topics WHERE workspace_id {ws_cond}
         ORDER BY created_at DESC
         LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql_recent).map_err(|e| e.to_string())?;
    let recent: Option<FlashcardTopic> = stmt
        .query_row(rusqlite::params![workspace_id], |r| {
            Ok(FlashcardTopic {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                topic: r.get(2)?,
                source: r.get(3)?,
                mastery_score: r.get(4)?,
                last_generated_at: r.get(5)?,
                card_count: r.get(6)?,
                parent_topic_id: r.get(7)?,
            })
        })
        .ok();
    Ok(recent.map(|topic| SuggestedTopic {
        topic,
        reason: "New topic".to_string(),
        due_count: 0,
    }))
}

#[derive(serde::Serialize)]
pub struct SuggestedConcept {
    pub concept_id: String,
    pub concept_name: String,
    pub hierarchy_level: String,
    pub reason: String,
    pub due_count: i64,
    pub avg_ease: f64,
    pub card_count: i64,
}

/// Pick the next concept the user should review, mirroring `suggest_next_topic`
/// but operating on the unified `concept_nodes` + `learning_cards (source_type='concept')` model.
/// 1. Concept with the most due cards (today or overdue).
/// 2. Concept with cards and the lowest average ease_factor.
/// 3. Most recently created concept that has cards.
#[tauri::command]
pub fn suggest_next_concept(
    state: State<DbState>,
    workspace_id: String,
    include_descendants: Option<bool>,
) -> Result<Option<SuggestedConcept>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let (cte, ws_cond) = workspace_filter_sql(include_descendants.unwrap_or(false));
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    // 1. Most due.
    let sql_due = format!(
        "{cte}SELECT cn.id, cn.name, cn.hierarchy_level,
                COUNT(c.id) AS due,
                COALESCE(AVG(c.ease_factor), 2.5) AS avg_ease,
                (SELECT COUNT(*) FROM learning_cards
                   WHERE source_type='concept' AND source_id=cn.id) AS total
         FROM concept_nodes cn
         JOIN learning_cards c
           ON c.source_type='concept' AND c.source_id = cn.id AND c.next_review_date <= ?2
         WHERE cn.workspace_id {ws_cond}
         GROUP BY cn.id
         ORDER BY due DESC, avg_ease ASC
         LIMIT 1"
    );
    let row: Option<(String, String, String, i64, f64, i64)> = conn
        .query_row(&sql_due, rusqlite::params![workspace_id, today], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get::<_, Option<String>>(2)?
                    .unwrap_or_else(|| "concept".to_string()),
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
            ))
        })
        .ok();
    if let Some((id, name, level, due_count, avg_ease, total)) = row {
        if due_count > 0 {
            return Ok(Some(SuggestedConcept {
                concept_id: id,
                concept_name: name,
                hierarchy_level: level,
                reason: format!(
                    "{due_count} card{} due",
                    if due_count == 1 { "" } else { "s" }
                ),
                due_count,
                avg_ease,
                card_count: total,
            }));
        }
    }

    // 2. Weakest by avg ease, with cards.
    let sql_weak = format!(
        "{cte}SELECT cn.id, cn.name, cn.hierarchy_level,
                COALESCE(AVG(c.ease_factor), 2.5) AS avg_ease,
                COUNT(c.id) AS total
         FROM concept_nodes cn
         JOIN learning_cards c ON c.source_type='concept' AND c.source_id = cn.id
         WHERE cn.workspace_id {ws_cond}
         GROUP BY cn.id
         HAVING total > 0
         ORDER BY avg_ease ASC, total DESC
         LIMIT 1"
    );
    let weak: Option<(String, String, String, f64, i64)> = conn
        .query_row(&sql_weak, rusqlite::params![workspace_id], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get::<_, Option<String>>(2)?
                    .unwrap_or_else(|| "concept".to_string()),
                r.get(3)?,
                r.get(4)?,
            ))
        })
        .ok();
    if let Some((id, name, level, avg_ease, total)) = weak {
        // Mastery proxy: normalise ease factor (range ~1.3–2.5+) to 0..1.
        let mastery = ((avg_ease - 1.3) / 1.5).clamp(0.0, 1.0);
        let pct = (mastery * 100.0).round() as i64;
        return Ok(Some(SuggestedConcept {
            concept_id: id,
            concept_name: name,
            hierarchy_level: level,
            reason: format!("Weakest concept ({pct}% mastery)"),
            due_count: 0,
            avg_ease,
            card_count: total,
        }));
    }

    // 3. Most recently created concept.
    let sql_recent = format!(
        "{cte}SELECT cn.id, cn.name, cn.hierarchy_level
         FROM concept_nodes cn
         WHERE cn.workspace_id {ws_cond}
         ORDER BY cn.created_at DESC
         LIMIT 1"
    );
    let recent: Option<(String, String, String)> = conn
        .query_row(&sql_recent, rusqlite::params![workspace_id], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get::<_, Option<String>>(2)?
                    .unwrap_or_else(|| "concept".to_string()),
            ))
        })
        .ok();
    Ok(recent.map(|(id, name, level)| SuggestedConcept {
        concept_id: id,
        concept_name: name,
        hierarchy_level: level,
        reason: "New concept".to_string(),
        due_count: 0,
        avg_ease: 2.5,
        card_count: 0,
    }))
}
