/// AI-powered knowledge graph analysis commands.
/// analyze_workspace — infers concepts & relationships from workspace content via Ollama.
/// suggest_learning_goals — proposes goals from the existing concept landscape.
use tauri::State;
use crate::db::DbState;
use crate::ollama::client::{OllamaClient, OllamaMessage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct AnalysisResult {
    pub concepts_created: usize,
    pub links_created: usize,
    pub concepts_skipped: usize,
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

/// Collect recent workspace content (notes, daily notes, chat messages) capped at ~16 000 chars.
fn gather_workspace_content(conn: &rusqlite::Connection, workspace_id: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut total_len = 0usize;
    const CAP: usize = 16_000;

    // --- project_notes ---
    if let Ok(mut stmt) = conn.prepare(
        "SELECT title, content FROM project_notes WHERE workspace_id = ?1 \
         ORDER BY updated_at DESC LIMIT 40",
    ) {
        let _ = stmt.query_map(rusqlite::params![workspace_id], |row| {
            let title: String = row.get(0)?;
            let content: String = row.get(1)?;
            Ok((title, content))
        }).map(|rows| {
            for item in rows.flatten() {
                if total_len >= CAP { return; }
                let snippet = if item.1.len() > 300 { &item.1[..300] } else { &item.1 };
                let entry = format!("Note: {}\n{}\n", item.0, snippet);
                total_len += entry.len();
                parts.push(entry);
            }
        });
    }

    // --- daily_notes ---
    if total_len < CAP {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT date, content FROM daily_notes WHERE workspace_id = ?1 \
             ORDER BY date DESC LIMIT 20",
        ) {
            let _ = stmt.query_map(rusqlite::params![workspace_id], |row| {
                let date: String = row.get(0)?;
                let content: String = row.get(1)?;
                Ok((date, content))
            }).map(|rows| {
                for item in rows.flatten() {
                    if total_len >= CAP { return; }
                    let snippet = if item.1.len() > 200 { &item.1[..200] } else { &item.1 };
                    let entry = format!("Daily note ({}): {}\n", item.0, snippet);
                    total_len += entry.len();
                    parts.push(entry);
                }
            });
        }
    }

    // --- chat messages (linked through projects in this workspace) ---
    if total_len < CAP {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT m.content FROM messages m \
             JOIN chat_sessions cs ON m.session_id = cs.id \
             JOIN projects p ON cs.project_id = p.id \
             WHERE p.workspace_id = ?1 AND m.role = 'user' \
             ORDER BY m.created_at DESC LIMIT 30",
        ) {
            let _ = stmt.query_map(rusqlite::params![workspace_id], |row| {
                let content: String = row.get(0)?;
                Ok(content)
            }).map(|rows| {
                for content in rows.flatten() {
                    if total_len >= CAP { return; }
                    let snippet = if content.len() > 150 { &content[..150] } else { &content };
                    let entry = format!("Message: {}\n", snippet);
                    total_len += entry.len();
                    parts.push(entry);
                }
            });
        }
    }

    parts.join("")
}

#[tauri::command]
pub async fn analyze_workspace(
    state: State<'_, DbState>,
    req: AnalyzeWorkspaceRequest,
) -> Result<AnalysisResult, String> {
    // 1. Gather content — acquire + release lock before async call
    let (content, existing_names) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let text = gather_workspace_content(&conn, &req.workspace_id);

        // Load existing concept names (lowercase) for dedup
        let mut names: Vec<String> = Vec::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT LOWER(name) FROM concept_nodes WHERE workspace_id = ?1",
        ) {
            let _ = stmt.query_map(rusqlite::params![req.workspace_id], |row| {
                let n: String = row.get(0)?;
                Ok(n)
            }).map(|rows| {
                names = rows.flatten().collect();
            });
        }
        (text, names)
    };

    if content.trim().is_empty() {
        return Ok(AnalysisResult { concepts_created: 0, links_created: 0, concepts_skipped: 0 });
    }

    // 2. Build prompt
    let focus_clause = req.focus_topic
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|t| format!(" Focus especially on concepts related to: {t}."))
        .unwrap_or_default();

    let prompt = format!(
        "You are a knowledge graph assistant. Analyze the following learning content and extract key concepts and relationships.{focus}\n\n\
        Content:\n{content}\n\n\
        Respond with ONLY valid JSON (no markdown, no explanation):\n\
        {{\"concepts\":[\"concept1\",\"concept2\",...],\"relationships\":[{{\"source\":\"concept1\",\"target\":\"concept2\",\"type\":\"related\"}},...]}}\n\
        - List 5-20 important concepts as strings.\n\
        - List relationships between concepts. Type must be one of: related, part_of, prerequisite, contradicts, supports, example.\n\
        - Only output the raw JSON object.",
        focus = focus_clause,
        content = if content.len() > 15_000 { &content[..15_000] } else { &content },
    );

    // 3. Call Ollama (no DB lock held)
    let client = OllamaClient::new(req.ollama_url);
    let messages = vec![OllamaMessage { role: "user".to_string(), content: prompt }];
    let raw = client.send_message(&req.model, messages).await?;

    // 4. Parse JSON — find first { / last }
    let trimmed = raw.trim();
    let json_str = match (trimmed.find('{'), trimmed.rfind('}')) {
        (Some(s), Some(e)) if e > s => &trimmed[s..=e],
        _ => return Err(format!("AI response did not contain valid JSON. Raw: {}", &raw[..raw.len().min(300)])),
    };

    #[derive(Deserialize)]
    struct AiOutput {
        concepts: Vec<String>,
        #[serde(default)]
        relationships: Vec<AiRelationship>,
    }
    #[derive(Deserialize)]
    struct AiRelationship {
        source: String,
        target: String,
        #[serde(default = "default_rel_type")]
        r#type: String,
    }
    fn default_rel_type() -> String { "related".to_string() }

    let output: AiOutput = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse AI JSON: {e}\nRaw snippet: {json_str}"))?;

    // 5. Insert concepts + relationships — re-acquire lock
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let mut concepts_created = 0usize;
    let mut concepts_skipped = 0usize;
    let mut name_to_id: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    // Load existing concepts into name_to_id map
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, LOWER(name) FROM concept_nodes WHERE workspace_id = ?1",
    ) {
        let _ = stmt.query_map(rusqlite::params![req.workspace_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map(|rows| {
            for (id, lower_name) in rows.flatten() {
                name_to_id.insert(lower_name, id);
            }
        });
    }

    for raw_name in &output.concepts {
        let name = raw_name.trim().to_string();
        if name.is_empty() { continue; }
        let lower = name.to_lowercase();

        if existing_names.contains(&lower) || name_to_id.contains_key(&lower) {
            concepts_skipped += 1;
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            let result = conn.execute(
                "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, '', 'topic', '[]', '[]', '[]', 0.0, 0.0, 0, ?4, ?4)",
                rusqlite::params![id, req.workspace_id, name, now],
            );
            if result.is_ok() {
                name_to_id.insert(lower, id);
                concepts_created += 1;
            }
        }
    }

    let mut links_created = 0usize;
    let valid_types = ["related", "part_of", "prerequisite", "contradicts", "supports", "example"];

    for rel in &output.relationships {
        let src_lower = rel.source.trim().to_lowercase();
        let tgt_lower = rel.target.trim().to_lowercase();
        let link_type = if valid_types.contains(&rel.r#type.as_str()) {
            rel.r#type.as_str()
        } else {
            "related"
        };

        let src_id = match name_to_id.get(&src_lower) { Some(id) => id.clone(), None => continue };
        let tgt_id = match name_to_id.get(&tgt_lower) { Some(id) => id.clone(), None => continue };

        // Check for existing link
        let exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM concept_links WHERE source_id = ?1 AND target_id = ?2",
            rusqlite::params![src_id, tgt_id],
            |row| row.get::<_, i64>(0),
        ).unwrap_or(0) > 0;

        if !exists {
            let link_id = uuid::Uuid::new_v4().to_string();
            if conn.execute(
                "INSERT INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at) \
                 VALUES (?1, ?2, ?3, ?4, 0.7, 'ai_inferred', ?5)",
                rusqlite::params![link_id, src_id, tgt_id, link_type, now],
            ).is_ok() {
                links_created += 1;
            }
        }
    }

    Ok(AnalysisResult { concepts_created, links_created, concepts_skipped })
}

#[tauri::command]
pub async fn suggest_learning_goals(
    state: State<'_, DbState>,
    req: SuggestGoalsRequest,
) -> Result<Vec<SuggestedGoal>, String> {
    // Gather existing concepts and goals
    let (concept_names, existing_goal_titles) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;

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
        if let Ok(mut stmt) = conn.prepare(
            "SELECT title FROM learning_goals WHERE workspace_id = ?1",
        ) {
            let _ = stmt.query_map(rusqlite::params![req.workspace_id], |row| {
                row.get::<_, String>(0)
            }).map(|rows| {
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
        format!("\nAlready existing goals (do NOT repeat): {}", existing_goal_titles.join(", "))
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

    let client = OllamaClient::new(req.ollama_url);
    let messages = vec![OllamaMessage { role: "user".to_string(), content: prompt }];
    let raw = client.send_message(&req.model, messages).await?;

    let trimmed = raw.trim();
    let json_str = match (trimmed.find('['), trimmed.rfind(']')) {
        (Some(s), Some(e)) if e > s => &trimmed[s..=e],
        _ => return Err(format!("AI response did not contain valid JSON array. Raw: {}", &raw[..raw.len().min(300)])),
    };

    let goals: Vec<SuggestedGoal> = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse suggested goals: {e}"))?;

    Ok(goals)
}
