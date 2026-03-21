use rusqlite::Connection;
use crate::models::workspace::{TopicSignature, TopicTag};
use crate::services::ai_content_generator::generate_tags;

pub fn collect_workspace_text(conn: &Connection, workspace_id: &str) -> Result<(String, u64), String> {
    let mut stmt = conn.prepare(
        "SELECT m.content 
         FROM messages m
         JOIN chat_sessions s ON m.session_id = s.id
         WHERE s.workspace_id = ?1 AND m.role = 'user' AND s.is_incognito = 0 AND s.exclude_from_analytics = 0
         ORDER BY m.created_at DESC
         LIMIT 500"
    ).map_err(|e| e.to_string())?;
    
    let mut text = String::new();
    let mut count = 0;
    
    let rows = stmt.query_map([workspace_id], |row| {
        let content: String = row.get(0)?;
        Ok(content)
    }).map_err(|e| e.to_string())?;
    
    for content in rows.flatten() {
        text.push_str(&content);
        text.push('\n');
        count += 1;
    }
    
    Ok((text, count))
}

pub fn recompute_workspace_signature(conn: &Connection, workspace_id: &str) -> Result<TopicSignature, String> {
    let existing_json: String = conn.query_row(
        "SELECT topic_signature FROM workspaces WHERE id = ?1",
        rusqlite::params![workspace_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    let existing: TopicSignature = serde_json::from_str(&existing_json).unwrap_or_default();

    let (text, count) = collect_workspace_text(conn, workspace_id)?;
    let mut sig = if count == 0 {
        TopicSignature::default()
    } else {
        let mut generated = generate_heuristic(&text);
        generated.message_count_at_gen = Some(count);
        generated
    };

    sig.manual_tags = existing.manual_tags;
    sig.ignored_tags = existing.ignored_tags;
    let now = chrono::Utc::now().to_rfc3339();
    let sig_json = serde_json::to_string(&sig).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE workspaces SET topic_signature = ?1, signature_updated_at = ?2 WHERE id = ?3",
        rusqlite::params![sig_json, now, workspace_id],
    ).map_err(|e| e.to_string())?;

    Ok(sig)
}

pub fn generate_heuristic(text: &str) -> TopicSignature {
    let tags = generate_tags(text, 20);
    let mut domain_tags = Vec::new();
    for (i, tag) in tags.into_iter().enumerate() {
        domain_tags.push(TopicTag {
            tag,
            weight: (20 - i) as u32,
            source: "heuristic".to_string(),
        });
    }
    
    let mut intent_patterns = Vec::new();
    let lower = text.to_lowercase();
    if lower.contains("how ") || lower.contains("what ") || lower.contains("why ") {
        intent_patterns.push("learning".to_string());
    }
    if lower.contains("error") || lower.contains("bug") || lower.contains("fix") || lower.contains("issue") {
        intent_patterns.push("debugging".to_string());
    }
    if lower.contains("tutorial") || lower.contains("guide") {
        intent_patterns.push("tutorial".to_string());
    }
    if lower.contains("compare") || lower.contains("vs") || lower.contains("review") {
        intent_patterns.push("code-review".to_string());
    }
    
    TopicSignature {
        domain_tags,
        manual_tags: Vec::new(),
        ignored_tags: Vec::new(),
        intent_patterns,
        generated_at: Some(chrono::Utc::now().to_rfc3339()),
        message_count_at_gen: None, 
        ollama_enriched: false,
    }
}

pub async fn enrich_with_ollama(heuristic: TopicSignature, _text: &str, _model: &str, _ollama_url: &str) -> TopicSignature {
    heuristic
}

pub fn compute_match_score(message: &str, signature: &TopicSignature) -> f64 {
    let msg_tags = generate_tags(message, 10);
    if msg_tags.is_empty() {
        return 0.0;
    }
    
    let mut match_count = 0;
    for tag in &msg_tags {
        // Skip if this tag is in the ignored list
        if signature.ignored_tags.contains(tag) {
            continue;
        }

        // Check heuristic or manual tags
        if signature.domain_tags.iter().any(|t| &t.tag == tag) || signature.manual_tags.contains(tag) {
            match_count += 1;
        }
    }
    
    match_count as f64 / (msg_tags.len() as f64)
}

pub fn find_best_workspace(conn: &Connection, message: &str, exclude_workspace_id: &str, threshold: f64) -> Option<(String, String, f64)> {
    let mut stmt = conn.prepare("SELECT id, name, topic_signature FROM workspaces WHERE id != ?1 AND topic_signature != '{}'").ok()?;
    
    let mut best_match = None;
    let mut highest_score = 0.0;
    
    let rows = stmt.query_map([exclude_workspace_id], |row| {
        let id: String = row.get(0)?;
        let name: String = row.get(1)?;
        let sig_json: String = row.get(2)?;
        Ok((id, name, sig_json))
    }).ok()?;
    
    for row in rows.flatten() {
        let (id, name, sig_json) = row;
        if let Ok(sig) = serde_json::from_str::<TopicSignature>(&sig_json) {
            let score = compute_match_score(message, &sig);
            if score >= threshold && score > highest_score {
                highest_score = score;
                best_match = Some((id, name, score));
            }
        }
    }
    
    best_match
}
