use crate::db::DbState;
use crate::models::learning_card::{
    CreateCardRequest, ExtractFlashcardsRequest, GenerateCardsRequest, GenerateFromConceptRequest,
    LearningCard, ReviewRequest, ReviewStats,
};
use crate::ollama::client::{OllamaClient, OllamaMessage};
use crate::services::spaced_repetition;
use tauri::State;

fn row_to_card(row: &rusqlite::Row) -> rusqlite::Result<LearningCard> {
    Ok(LearningCard {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        front: row.get(2)?,
        back: row.get(3)?,
        source_type: row.get(4)?,
        source_id: row.get(5)?,
        ease_factor: row.get(6)?,
        interval: row.get(7)?,
        repetitions: row.get(8)?,
        next_review_date: row.get(9)?,
        last_reviewed_at: row.get(10)?,
        created_at: row.get(11)?,
    })
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
    conn.execute(
        "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, source_id, ease_factor, interval, repetitions, next_review_date, last_reviewed_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![card.id, card.workspace_id, card.front, card.back, card.source_type, card.source_id,
                          card.ease_factor, card.interval, card.repetitions, card.next_review_date, card.last_reviewed_at, card.created_at],
    ).map_err(|e| e.to_string())?;
    Ok(card)
}

/// Returns cards due today or overdue, for a given project.
#[tauri::command]
pub fn list_flashcards_due(
    state: State<DbState>,
    workspace_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<LearningCard>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(200).clamp(1, 1000);
    let offset = offset.unwrap_or(0).max(0);
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, front, back, source_type, source_id, ease_factor, interval, repetitions, next_review_date, last_reviewed_at, created_at
         FROM learning_cards WHERE workspace_id = ?1 AND next_review_date <= ?2 ORDER BY next_review_date ASC LIMIT ?3 OFFSET ?4"
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(
            rusqlite::params![workspace_id, today, limit, offset],
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
        "SELECT id, workspace_id, front, back, source_type, source_id, ease_factor, interval, repetitions, next_review_date, last_reviewed_at, created_at
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
    let count = req.count.unwrap_or(5).min(20);
    let prompt = format!(
        "Generate exactly {count} flashcards about: \"{topic}\"\n\n\
        Output ONLY a JSON array of objects, each with \"front\" (question) and \"back\" (answer) keys.\n\
        No markdown, no explanation, no code fences — just the raw JSON array.\n\
        Example: [{{\"front\":\"What is X?\",\"back\":\"X is...\"}}]",
        count = count,
        topic = req.topic,
    );
    let client = OllamaClient::new(req.ollama_url)?;
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    let raw = client.send_message("flashcard", &req.model, messages).await?;

    // Parse the JSON array from the response, stripping any markdown fences
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
        card.source_type = "ai_generated".to_string();
        tx.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, source_id, ease_factor, interval, repetitions, next_review_date, last_reviewed_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![card.id, card.workspace_id, card.front, card.back, card.source_type, card.source_id,
                              card.ease_factor, card.interval, card.repetitions, card.next_review_date, card.last_reviewed_at, card.created_at],
        ).map_err(|e| e.to_string())?;
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
    let raw = client.send_message("flashcard", &req.model, messages).await?;

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
        tx.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, source_id, ease_factor, interval, repetitions, next_review_date, last_reviewed_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![card.id, card.workspace_id, card.front, card.back, card.source_type, card.source_id,
                              card.ease_factor, card.interval, card.repetitions, card.next_review_date, card.last_reviewed_at, card.created_at],
        ).map_err(|e| e.to_string())?;
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
        "SELECT id, workspace_id, front, back, source_type, source_id, ease_factor, interval, repetitions, next_review_date, last_reviewed_at, created_at
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
        "SELECT lc.id, lc.workspace_id, lc.front, lc.back, lc.source_type, lc.source_id,
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
    let raw = client.send_message("flashcard", &req.model, messages).await?;

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
        tx.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, source_id, ease_factor, interval, repetitions, next_review_date, last_reviewed_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![card.id, card.workspace_id, card.front, card.back, card.source_type, card.source_id,
                              card.ease_factor, card.interval, card.repetitions, card.next_review_date, card.last_reviewed_at, card.created_at],
        ).map_err(|e| e.to_string())?;
        cards.push(card);
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(cards)
}
