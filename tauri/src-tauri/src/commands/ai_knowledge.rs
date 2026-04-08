use crate::db::DbState;
use crate::ollama::client::{OllamaClient, OllamaMessage};
use serde::{Deserialize, Serialize};
use serde_json::Value;
/// AI-powered knowledge graph analysis commands.
/// analyze_workspace — infers concepts & relationships from workspace content via Ollama.
/// suggest_learning_goals — proposes goals from the existing concept landscape.
use tauri::State;

#[derive(Debug, Serialize)]
pub struct AnalysisResult {
    pub concepts_created: usize,
    pub links_created: usize,
    pub concepts_skipped: usize,
    pub chapters_created: usize,
    pub sections_created: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SuggestedGoal {
    pub title: String,
    pub description: String,
    pub related_concepts: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct AnalyzeWorkspaceRequest {
    pub workspace_id: String,
    pub model: String,
    pub ollama_url: Option<String>,
    pub focus_topic: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SuggestGoalsRequest {
    pub workspace_id: String,
    pub model: String,
    pub ollama_url: Option<String>,
}

struct WorkspaceContentSnapshot {
    text: String,
    source_items: usize,
}

const GENERIC_CONCEPTS: &[&str] = &[
    "algorithm",
    "artifact",
    "attribute",
    "bug",
    "code",
    "condition",
    "constraint",
    "data",
    "details",
    "error",
    "evaluation",
    "example",
    "function",
    "functions",
    "implementation",
    "input",
    "method",
    "methods",
    "output",
    "phase",
    "process",
    "programming",
    "question",
    "questions",
    "result",
    "results",
    "step",
    "steps",
    "system",
    "task",
    "tasks",
    "test",
    "tests",
    "topic",
    "topics",
    "variable",
    "variables",
];

fn is_specific_concept(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    if lower.chars().count() < 4 {
        return false;
    }
    if GENERIC_CONCEPTS.contains(&lower.as_str()) {
        return false;
    }
    true
}

fn repair_truncated_json_object(input: &str) -> Option<String> {
    let mut in_string = false;
    let mut escaped = false;
    let mut object_depth = 0usize;
    let mut array_depth = 0usize;

    for ch in input.chars() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            match ch {
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => object_depth += 1,
            '}' => object_depth = object_depth.saturating_sub(1),
            '[' => array_depth += 1,
            ']' => array_depth = array_depth.saturating_sub(1),
            _ => {}
        }
    }

    let mut repaired = input.trim_end().to_string();
    if repaired.is_empty() {
        return None;
    }

    loop {
        let trimmed = repaired.trim_end();
        if trimmed.is_empty() {
            return None;
        }

        let Some(last) = trimmed.chars().last() else {
            return None;
        };

        if matches!(last, ',' | ':' | '{' | '[') {
            repaired = trimmed[..trimmed.len() - last.len_utf8()].to_string();
            continue;
        }
        break;
    }

    if in_string {
        repaired.push('"');
    }

    repaired.push_str(&"]".repeat(array_depth));
    repaired.push_str(&"}".repeat(object_depth));

    serde_json::from_str::<Value>(&repaired).ok()?;
    Some(repaired)
}

/// Collect recent workspace content (notes, daily notes, chat messages, docs, web) capped at ~16 000 chars.
fn gather_workspace_content(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> WorkspaceContentSnapshot {
    let mut parts: Vec<String> = Vec::new();
    let mut total_len = 0usize;
    let mut source_items = 0usize;
    const CAP: usize = 16_000;

    fn safe_truncate(s: &str, max_chars: usize) -> &str {
        match s.char_indices().nth(max_chars) {
            Some((idx, _)) => &s[..idx],
            None => s,
        }
    }

    // --- project_notes ---
    if let Ok(mut stmt) = conn.prepare(
        "SELECT title, content FROM project_notes WHERE workspace_id = ?1 \
         ORDER BY updated_at DESC LIMIT 40",
    ) {
        let _ = stmt
            .query_map(rusqlite::params![workspace_id], |row| {
                let title: String = row.get(0)?;
                let content: String = row.get(1)?;
                Ok((title, content))
            })
            .map(|rows| {
                for item in rows.flatten() {
                    if total_len >= CAP {
                        return;
                    }
                    let snippet = safe_truncate(&item.1, 400);
                    let entry = format!("Note: {}\n{}\n", item.0, snippet);
                    total_len += entry.len();
                    parts.push(entry);
                    source_items += 1;
                }
            });
    }

    // --- daily_notes ---
    if total_len < CAP {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT date, content FROM daily_notes WHERE workspace_id = ?1 \
             ORDER BY date DESC LIMIT 20",
        ) {
            let _ = stmt
                .query_map(rusqlite::params![workspace_id], |row| {
                    let date: String = row.get(0)?;
                    let content: String = row.get(1)?;
                    Ok((date, content))
                })
                .map(|rows| {
                    for item in rows.flatten() {
                        if total_len >= CAP {
                            return;
                        }
                        let snippet = safe_truncate(&item.1, 300);
                        let entry = format!("Daily note ({}): {}\n", item.0, snippet);
                        total_len += entry.len();
                        parts.push(entry);
                        source_items += 1;
                    }
                });
        }
    }

    // --- chat messages (any session in this workspace) ---
    if total_len < CAP {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT m.content FROM messages m \
             JOIN chat_sessions cs ON m.session_id = cs.id \
             WHERE cs.workspace_id = ?1 AND m.role = 'user' AND cs.is_incognito = 0 AND cs.exclude_from_analytics = 0 AND cs.is_deleted = 0 \
             ORDER BY m.created_at DESC LIMIT 40",
        ) {
            let _ = stmt.query_map(rusqlite::params![workspace_id], |row| {
                let content: String = row.get(0)?;
                Ok(content)
            }).map(|rows| {
                for content in rows.flatten() {
                    if total_len >= CAP { return; }
                    let snippet = safe_truncate(&content, 200);
                    let entry = format!("Message: {}\n", snippet);
                    total_len += entry.len();
                    parts.push(entry);
                    source_items += 1;
                }
            });
        }
    }

    // --- sources (unified documents + web captures) ---
    if total_len < CAP {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT source_type, title, content, summary FROM sources WHERE workspace_id = ?1 \
             ORDER BY updated_at DESC LIMIT 30",
        ) {
            let _ = stmt
                .query_map(rusqlite::params![workspace_id], |row| {
                    let source_type: String = row.get(0)?;
                    let title: String = row.get(1)?;
                    let content: String = row.get(2)?;
                    let summary: Option<String> = row.get(3)?;
                    Ok((source_type, title, content, summary))
                })
                .map(|rows| {
                    for (source_type, title, content, summary) in rows.flatten() {
                        if total_len >= CAP {
                            return;
                        }
                        let text = summary.unwrap_or(content);
                        let snippet = safe_truncate(&text, 500);
                        let label = if source_type == "document" {
                            "Document"
                        } else {
                            "Web Capture"
                        };
                        let entry = format!("{} ({}): {}\n", label, title, snippet);
                        total_len += entry.len();
                        parts.push(entry);
                        source_items += 1;
                    }
                });
        }
    }

    WorkspaceContentSnapshot {
        text: parts.join(""),
        source_items,
    }
}

#[tauri::command]
pub async fn analyze_workspace(
    state: State<'_, DbState>,
    req: AnalyzeWorkspaceRequest,
) -> Result<AnalysisResult, String> {
    // 1. Gather content — acquire + release lock before async call
    let snapshot = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        gather_workspace_content(&conn, &req.workspace_id)
    };

    if snapshot.text.trim().is_empty() {
        return Err("No content found in this workspace to analyze. Please add some notes, documents, or chat messages first.".to_string());
    }
    if snapshot.source_items < 6 || snapshot.text.len() < 1200 {
        return Err("Not enough workspace material yet to build a useful graph. Add a bit more chat, notes, or documents, then analyze again.".to_string());
    }

    // 2. Build prompt
    let focus_clause = req
        .focus_topic
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|t| format!(" Focus especially on concepts related to: {t}."))
        .unwrap_or_default();

    let content = if snapshot.text.len() > 15_000 {
        &snapshot.text[..15_000]
    } else {
        &snapshot.text
    };

    let prompt = format!(
        "You are a knowledge graph assistant. Analyze this learning content and organize it like a textbook.{focus}\n\n\
        Content:\n{content}\n\n\
        Respond with ONLY raw JSON:\n\
        {{\"chapters\":[{{\"name\":\"...\",\"description\":\"...\",\"sections\":[{{\"name\":\"...\",\"description\":\"...\",\"concepts\":[{{\"name\":\"...\",\"description\":\"...\",\"type\":\"definition\"}}]}}]}}],\"relationships\":[{{\"source\":\"exact concept name\",\"target\":\"exact concept name\",\"type\":\"prerequisite\",\"description\":\"why\"}}]}}\n\n\
        Rules:\n\
        - 2-4 chapters, 2-3 sections per chapter, 3-6 concepts per section\n\
        - concept type: topic, definition, technology, insight, question, resource\n\
        - relationship type: related, prerequisite, supports, contradicts, example\n\
        - source/target MUST be the exact concept name as listed in the hierarchy above\n\
        - No markdown, only raw JSON",
        focus = focus_clause,
        content = content,
    );

    // 3. Call Ollama (no DB lock held)
    let client = OllamaClient::new(req.ollama_url)?;
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    let raw = client.send_message(&req.model, messages).await?;

    // 4. Parse JSON — find first { / last }
    let trimmed = raw.trim();
    let json_str = match (trimmed.find('{'), trimmed.rfind('}')) {
        (Some(s), Some(e)) if e > s => &trimmed[s..=e],
        _ => {
            return Err(format!(
                "AI response did not contain valid JSON. Raw: {}",
                &raw[..raw.len().min(300)]
            ))
        }
    };

    #[derive(Deserialize)]
    struct AiConcept {
        name: String,
        description: Option<String>,
        #[serde(rename = "type")]
        concept_type: Option<String>,
    }
    #[derive(Deserialize)]
    struct AiSection {
        name: String,
        description: Option<String>,
        #[serde(default)]
        concepts: Vec<AiConcept>,
    }
    #[derive(Deserialize)]
    struct AiChapter {
        name: String,
        description: Option<String>,
        #[serde(default)]
        sections: Vec<AiSection>,
    }
    #[derive(Deserialize)]
    struct AiRelationship {
        source: String,
        target: String,
        #[serde(rename = "type", default = "default_rel_type")]
        r#type: String,
        description: Option<String>,
        strength: Option<f64>,
    }
    fn default_rel_type() -> String {
        "related".to_string()
    }
    #[derive(Deserialize)]
    struct AiHierarchicalOutput {
        #[serde(default)]
        chapters: Vec<AiChapter>,
        #[serde(default)]
        relationships: Vec<AiRelationship>,
    }

    let output: AiHierarchicalOutput = match serde_json::from_str(json_str) {
        Ok(parsed) => parsed,
        Err(parse_error) => {
            let repaired = repair_truncated_json_object(json_str)
                .ok_or_else(|| format!("Failed to parse AI JSON: {parse_error}\nRaw snippet: {json_str}"))?;
            serde_json::from_str(&repaired).map_err(|e| {
                format!("Failed to parse AI JSON after repair: {e}\nRaw snippet: {json_str}")
            })?
        }
    };

    // 5. Insert hierarchy + relationships — re-acquire lock
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let mut name_to_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    // Load existing concepts into name_to_id map (lowercase key)
    if let Ok(mut stmt) =
        conn.prepare("SELECT id, LOWER(name) FROM concept_nodes WHERE workspace_id = ?1")
    {
        let _ = stmt
            .query_map(rusqlite::params![req.workspace_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map(|rows| {
                for (id, lower_name) in rows.flatten() {
                    name_to_id.insert(lower_name, id);
                }
            });
    }

    // Fuzzy name lookup: exact match first, then substring fallback
    fn fuzzy_lookup(
        name_to_id: &std::collections::HashMap<String, String>,
        query: &str,
    ) -> Option<String> {
        let q = query.trim().to_lowercase();
        if let Some(id) = name_to_id.get(&q) {
            return Some(id.clone());
        }
        name_to_id
            .iter()
            .filter(|(k, _)| k.len() >= 4)
            .find(|(k, _)| k.contains(q.as_str()) || q.contains(k.as_str()))
            .map(|(_, v)| v.clone())
    }

    // Upsert helper: returns existing id or inserts new node
    let upsert_node = |name: &str,
                       description: &str,
                       concept_type: &str,
                       hierarchy_level: &str,
                       name_to_id: &mut std::collections::HashMap<String, String>|
     -> Option<String> {
        let lower = name.trim().to_lowercase();
        if lower.is_empty() {
            return None;
        }
        if let Some(existing_id) = name_to_id.get(&lower) {
            return Some(existing_id.clone());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let result = conn.execute(
            "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level) \
             VALUES (?1, ?2, ?3, ?4, ?5, '[]', '[]', '[]', 0.0, 0.0, 0, ?6, ?6, ?7)",
            rusqlite::params![id, req.workspace_id, name.trim(), description, concept_type, now, hierarchy_level],
        );
        if result.is_ok() {
            name_to_id.insert(lower, id.clone());
            Some(id)
        } else {
            None
        }
    };

    // Link upsert helper
    let upsert_link = |source_id: &str, target_id: &str, link_type: &str, strength: f64, context: &str| {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM concept_links WHERE source_id = ?1 AND target_id = ?2",
                rusqlite::params![source_id, target_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if !exists {
            let link_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![link_id, source_id, target_id, link_type, strength, context, now],
            ).is_ok()
        } else {
            false
        }
    };

    let mut chapters_created = 0usize;
    let mut sections_created = 0usize;
    let mut concepts_created = 0usize;
    let mut concepts_skipped = 0usize;
    let mut links_created = 0usize;

    for chapter in &output.chapters {
        let ch_name = chapter.name.trim();
        if ch_name.is_empty() {
            continue;
        }
        let ch_desc = chapter.description.as_deref().unwrap_or("");
        let ch_id_opt = upsert_node(ch_name, ch_desc, "topic", "chapter", &mut name_to_id);
        let ch_id = match ch_id_opt {
            Some(id) => {
                chapters_created += 1;
                id
            }
            None => continue,
        };

        for section in &chapter.sections {
            let sec_name = section.name.trim();
            if sec_name.is_empty() {
                continue;
            }
            let sec_desc = section.description.as_deref().unwrap_or("");
            let sec_id_opt = upsert_node(sec_name, sec_desc, "topic", "section", &mut name_to_id);
            let sec_id = match sec_id_opt {
                Some(id) => {
                    sections_created += 1;
                    id
                }
                None => continue,
            };

            // section part_of chapter
            if upsert_link(&sec_id, &ch_id, "part_of", 1.0, "hierarchy") {
                links_created += 1;
            }

            for concept in &section.concepts {
                let con_name = concept.name.trim();
                if con_name.is_empty() || !is_specific_concept(con_name) {
                    concepts_skipped += 1;
                    continue;
                }
                let con_desc = concept.description.as_deref().unwrap_or("");
                let con_type = concept.concept_type.as_deref().unwrap_or("topic");
                let valid_types = ["topic", "definition", "technology", "insight", "question", "resource"];
                let con_type = if valid_types.contains(&con_type) { con_type } else { "topic" };

                let con_id_opt = upsert_node(con_name, con_desc, con_type, "concept", &mut name_to_id);
                match con_id_opt {
                    Some(con_id) => {
                        concepts_created += 1;
                        // concept part_of section
                        if upsert_link(&con_id, &sec_id, "part_of", 1.0, "hierarchy") {
                            links_created += 1;
                        }
                    }
                    None => {
                        concepts_skipped += 1;
                    }
                }
            }
        }
    }

    for rel in &output.relationships {
        let src_id = match fuzzy_lookup(&name_to_id, &rel.source) {
            Some(id) => id,
            None => continue,
        };
        let tgt_id = match fuzzy_lookup(&name_to_id, &rel.target) {
            Some(id) => id,
            None => continue,
        };

        let valid_rel_types = ["related", "prerequisite", "supports", "contradicts", "example"];
        let link_type = if valid_rel_types.contains(&rel.r#type.as_str()) {
            rel.r#type.as_str()
        } else {
            "related"
        };
        let strength = rel.strength.unwrap_or(0.7).clamp(0.0, 1.0);
        let context = rel.description.as_deref().unwrap_or("ai_inferred");

        if upsert_link(&src_id, &tgt_id, link_type, strength, context) {
            links_created += 1;
        }
    }

    Ok(AnalysisResult {
        concepts_created,
        links_created,
        concepts_skipped,
        chapters_created,
        sections_created,
    })
}

#[tauri::command]
pub async fn suggest_learning_goals(
    state: State<'_, DbState>,
    req: SuggestGoalsRequest,
) -> Result<Vec<SuggestedGoal>, String> {
    // Gather existing concepts and goals
    let (concept_names, existing_goal_titles) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;

        let mut concepts: Vec<String> = Vec::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT name FROM concept_nodes WHERE workspace_id = ?1 ORDER BY review_count DESC, created_at DESC LIMIT 50",
        ) {
            let _ = stmt.query_map(rusqlite::params![req.workspace_id], |row| {
                row.get::<_, String>(0)
            }).map(|rows| {
                concepts = rows.flatten().collect();
            });
        }

        let mut goals: Vec<String> = Vec::new();
        if let Ok(mut stmt) =
            conn.prepare("SELECT title FROM learning_goals WHERE workspace_id = ?1")
        {
            let _ = stmt
                .query_map(rusqlite::params![req.workspace_id], |row| {
                    row.get::<_, String>(0)
                })
                .map(|rows| {
                    goals = rows.flatten().collect();
                });
        }

        (concepts, goals)
    };

    if concept_names.is_empty() {
        return Ok(vec![]);
    }

    let existing_clause = if existing_goal_titles.is_empty() {
        String::new()
    } else {
        format!(
            "\nAlready existing goals (do NOT repeat): {}",
            existing_goal_titles.join(", ")
        )
    };

    let prompt = format!(
        "You are a learning coach. Based on the following concepts a learner has been studying, suggest 3-5 concrete learning goals.\n\
        Concepts: {concepts}{existing}\n\n\
        Respond with ONLY valid JSON array (no markdown):\n\
        [{{\"title\":\"...\",\"description\":\"...\",\"related_concepts\":[\"...\",\"...\"]}}]\n\
        - title: actionable goal (start with a verb)\n\
        - description: 1-2 sentences\n\
        - related_concepts: 2-4 concepts from the list above",
        concepts = concept_names.join(", "),
        existing = existing_clause,
    );

    let client = OllamaClient::new(req.ollama_url)?;
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    let raw = client.send_message(&req.model, messages).await?;

    let trimmed = raw.trim();
    let json_str = match (trimmed.find('['), trimmed.rfind(']')) {
        (Some(s), Some(e)) if e > s => &trimmed[s..=e],
        _ => {
            return Err(format!(
                "AI response did not contain valid JSON array. Raw: {}",
                &raw[..raw.len().min(300)]
            ))
        }
    };

    let goals: Vec<SuggestedGoal> = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse suggested goals: {e}"))?;

    Ok(goals)
}

#[cfg(test)]
mod tests {
    use super::repair_truncated_json_object;

    #[test]
    fn repairs_truncated_concepts_array() {
        let broken = r#"{"concepts":["Data Structure","Algorithm","Database"]"#;
        let repaired = repair_truncated_json_object(broken).expect("should repair");
        assert_eq!(
            repaired,
            r#"{"concepts":["Data Structure","Algorithm","Database"]}"#
        );
    }

    #[test]
    fn repairs_truncated_relationships_array() {
        let broken = r#"{"concepts":["API"],"relationships":[{"source":"API","target":"REST","type":"related"}"#;
        let repaired = repair_truncated_json_object(broken).expect("should repair");
        assert_eq!(
            repaired,
            r#"{"concepts":["API"],"relationships":[{"source":"API","target":"REST","type":"related"}]}"#
        );
    }
}
