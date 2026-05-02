use crate::db::DbState;
use crate::ollama::client::{OllamaClient, OllamaMessage};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use serde::{Deserialize, Serialize};
use serde_json::Value;
/// AI-powered knowledge graph analysis commands.
/// analyze_workspace — infers concepts & relationships from workspace content via Ollama.
/// suggest_learning_goals — proposes goals from the existing concept landscape.
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, Serialize)]
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
    pub survey_context: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SuggestGoalsRequest {
    pub workspace_id: String,
    pub model: String,
    pub ollama_url: Option<String>,
    pub survey_context: Option<String>,
}

struct WorkspaceContentSnapshot {
    text: String,
    source_items: usize,
}

const GENERIC_CONCEPTS: &[&str] = &[
    "algorithm",
    "approach",
    "architecture",
    "artifact",
    "attribute",
    "bug",
    "category",
    "challenge",
    "code",
    "component",
    "concept",
    "concepts",
    "condition",
    "configuration",
    "constraint",
    "context",
    "data",
    "design",
    "details",
    "element",
    "error",
    "evaluation",
    "event",
    "example",
    "factor",
    "feature",
    "framework",
    "function",
    "functions",
    "idea",
    "implementation",
    "information",
    "input",
    "issue",
    "item",
    "level",
    "logic",
    "mechanism",
    "method",
    "methods",
    "model",
    "module",
    "note",
    "object",
    "operation",
    "optimization",
    "option",
    "output",
    "overview",
    "parameter",
    "part",
    "pattern",
    "phase",
    "point",
    "practice",
    "principle",
    "problem",
    "procedure",
    "process",
    "programming",
    "property",
    "question",
    "questions",
    "reference",
    "requirement",
    "resource",
    "result",
    "results",
    "review",
    "rule",
    "scenario",
    "section",
    "service",
    "setup",
    "solution",
    "state",
    "step",
    "steps",
    "strategy",
    "structure",
    "summary",
    "system",
    "task",
    "tasks",
    "technique",
    "term",
    "test",
    "tests",
    "thing",
    "tool",
    "topic",
    "topics",
    "type",
    "update",
    "value",
    "variable",
    "variables",
    "version",
    "workflow",
];

fn is_specific_concept(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    if lower.chars().count() < 4 {
        return false;
    }
    if GENERIC_CONCEPTS.contains(&lower.as_str()) {
        return false;
    }
    // Reject multi-word names where every word is generic
    let words: Vec<&str> = lower.split_whitespace().collect();
    if words.len() > 1 && words.iter().all(|w| GENERIC_CONCEPTS.contains(w)) {
        return false;
    }
    // Reject vague heading-style names
    let vague_prefixes = [
        "key ", "main ", "basic ", "common ", "general ", "important ",
        "various ", "other ", "additional ", "core ", "fundamental ",
    ];
    for prefix in &vague_prefixes {
        if lower.starts_with(prefix) {
            return false;
        }
    }
    let vague_suffixes = [
        " overview", " summary", " basics", " details", " concepts",
        " ideas", " topics", " notes", " items", " things",
    ];
    for suffix in &vague_suffixes {
        if lower.ends_with(suffix) {
            return false;
        }
    }
    true
}

/// Normalize a concept name for deduplication: lowercase, collapse whitespace,
/// strip trailing 's' for simple plural handling.
fn normalize_concept_name(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    let collapsed: String = lower.split_whitespace().collect::<Vec<_>>().join(" ");
    // Simple singular form — strip trailing 's' if word is > 4 chars
    if collapsed.len() > 4 && collapsed.ends_with('s') && !collapsed.ends_with("ss") {
        collapsed[..collapsed.len() - 1].to_string()
    } else {
        collapsed
    }
}

/// Extract the first complete JSON object `{...}` from `input` by tracking
/// brace depth, skipping string contents.  Returns `None` if no complete
/// object is found.
fn extract_first_json_object(input: &str) -> Option<&str> {
    extract_first_json_container(input, '{', '}')
}

/// Extract the first complete JSON array `[...]` from `input` by tracking
/// bracket depth, skipping string contents.  Returns `None` if no complete
/// array is found.
fn extract_first_json_array(input: &str) -> Option<&str> {
    extract_first_json_container(input, '[', ']')
}

fn extract_first_json_container(input: &str, open: char, close: char) -> Option<&str> {
    let start_byte = input.find(open)?;
    let mut in_string = false;
    let mut escaped = false;
    let mut depth = 0usize;
    for (i, ch) in input[start_byte..].char_indices() {
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
        if ch == open {
            depth += 1;
        } else if ch == close {
            depth -= 1;
            if depth == 0 {
                let end_byte = start_byte + i + ch.len_utf8();
                return Some(&input[start_byte..end_byte]);
            }
        } else if ch == '"' {
            in_string = true;
        }
    }
    None
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

        let last = trimmed.chars().last()?;

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

/// Collect recent workspace content (notes, daily notes, chat messages, docs, web) capped at ~24 000 chars.
fn gather_workspace_content(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> WorkspaceContentSnapshot {
    let mut parts: Vec<String> = Vec::new();
    let mut total_len = 0usize;
    let mut source_items = 0usize;
    const CAP: usize = 24_000;

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
             ORDER BY m.created_at DESC LIMIT 60",
        ) {
            let _ = stmt.query_map(rusqlite::params![workspace_id], |row| {
                let content: String = row.get(0)?;
                Ok(content)
            }).map(|rows| {
                for content in rows.flatten() {
                    if total_len >= CAP { return; }
                    let snippet = safe_truncate(&content, 500);
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
    analyze_workspace_impl(&state.0, req).await
}

pub async fn analyze_workspace_impl(
    pool: &Pool<SqliteConnectionManager>,
    req: AnalyzeWorkspaceRequest,
) -> Result<AnalysisResult, String> {
    // 1. Gather content — acquire + release lock before async call
    let snapshot = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        gather_workspace_content(&conn, &req.workspace_id)
    };

    if snapshot.text.trim().is_empty() && req.survey_context.is_none() {
        return Err("No content found in this workspace to analyze. Please add some notes, documents, or chat messages first.".to_string());
    }
    if req.survey_context.is_none() && (snapshot.source_items < 6 || snapshot.text.len() < 1200) {
        return Err("Not enough workspace material yet to build a useful graph. Add a bit more chat, notes, or documents, then analyze again.".to_string());
    }

    // 2. Build prompt
    let focus_clause = req
        .focus_topic
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|t| format!(" Focus especially on concepts related to: {t}."))
        .unwrap_or_default();

    let survey_clause = req
        .survey_context
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\n\nLearner context (use to guide concept relevance):\n{s}"))
        .unwrap_or_default();

    let content = if snapshot.text.len() > 22_000 {
        &snapshot.text[..22_000]
    } else {
        &snapshot.text
    };

    // When the workspace is sparse but we have survey context, use the survey as primary material.
    let (content_section, source_label) = if content.trim().is_empty() {
        (String::new(), String::new())
    } else {
        (format!("Content:\n{content}\n\n"), String::new())
    };
    let _ = source_label;

    let prompt = format!(
        "You are a knowledge graph assistant helping a learner build a personal knowledge base. \
Analyze the content below and extract SPECIFIC, NAMED concepts — not generic categories.{focus}{survey}\n\n\
{content_section}\
Respond with ONLY raw JSON:\n\
{{\"chapters\":[{{\"name\":\"...\",\"description\":\"...\",\"sections\":[{{\"name\":\"...\",\"description\":\"...\",\"concepts\":[{{\"name\":\"...\",\"description\":\"one clear sentence\",\"type\":\"definition\"}}]}}]}}],\"relationships\":[{{\"source\":\"exact concept name\",\"target\":\"exact concept name\",\"type\":\"prerequisite\",\"description\":\"why\"}}]}}\n\n\
Rules:\n\
- 2-4 chapters, 2-3 sections per chapter, 3-6 concepts per section\n\
- concept type: topic, definition, technology, insight, question, resource\n\
- relationship type: related, prerequisite, supports, contradicts, example\n\
- source/target MUST be the exact concept name as listed in the hierarchy\n\
- Every concept MUST be specific and named: use proper nouns, library names, theorem names, algorithm names, named techniques, or domain-specific terms\n\
- NEVER use vague concepts like \"Key Ideas\", \"Best Practices\", \"Common Patterns\", \"Important Concepts\", \"Overview\", \"Summary\"\n\
- Prefer concrete terms over abstractions: \"Binary Search Tree\" not \"Data Structure\", \"React Hooks\" not \"Framework Feature\"\n\
- Each description should define the concept in one clear sentence, not just restate the name\n\
- No markdown, only raw JSON",
        focus = focus_clause,
        survey = survey_clause,
        content_section = content_section,
    );

    // 3. Call Ollama (no DB lock held)
    let client = OllamaClient::new(req.ollama_url)?;
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    let raw = client.send_message("ai_knowledge", &req.model, messages).await?;

    // 4. Parse JSON — extract first complete { } object by depth-tracking
    let trimmed = raw.trim();
    let json_str = match extract_first_json_object(trimmed) {
        Some(s) => s,
        None => {
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

    // Deserialize via serde_json::Value first so that duplicate keys produced
    // by some models (e.g. a second "sections" field in the same object) are
    // handled gracefully (last-value-wins) instead of causing a hard parse
    // error.  Then convert from Value → typed struct.
    let parse_via_value = |s: &str| -> Result<AiHierarchicalOutput, String> {
        let v: Value = serde_json::from_str(s)
            .map_err(|e| format!("Failed to parse AI JSON: {e}\nRaw snippet: {s}"))?;
        serde_json::from_value(v)
            .map_err(|e| format!("Failed to convert AI JSON to expected shape: {e}\nRaw snippet: {s}"))
    };

    let output: AiHierarchicalOutput = match parse_via_value(json_str) {
        Ok(parsed) => parsed,
        Err(parse_error) => {
            let repaired = repair_truncated_json_object(json_str)
                .ok_or_else(|| format!("Failed to parse AI JSON: {parse_error}\nRaw snippet: {json_str}"))?;
            parse_via_value(&repaired).map_err(|e| {
                format!("Failed to parse AI JSON after repair: {e}\nRaw snippet: {json_str}")
            })?
        }
    };

    // 5. Insert hierarchy + relationships — re-acquire lock
    let conn = pool.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let mut name_to_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    // Load existing concepts into name_to_id map (normalized key + aliases)
    if let Ok(mut stmt) =
        conn.prepare("SELECT id, name, aliases FROM concept_nodes WHERE workspace_id = ?1")
    {
        let _ = stmt
            .query_map(rusqlite::params![req.workspace_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            })
            .map(|rows| {
                for (id, name, aliases_json) in rows.flatten() {
                    name_to_id.insert(name.to_lowercase(), id.clone());
                    name_to_id.insert(normalize_concept_name(&name), id.clone());
                    if let Ok(aliases) = serde_json::from_str::<Vec<String>>(&aliases_json) {
                        for alias in aliases {
                            name_to_id.insert(alias.to_lowercase(), id.clone());
                            name_to_id.insert(normalize_concept_name(&alias), id.clone());
                        }
                    }
                }
            });
    }

    // Fuzzy name lookup: exact → normalized → substring fallback
    fn fuzzy_lookup(
        name_to_id: &std::collections::HashMap<String, String>,
        query: &str,
    ) -> Option<String> {
        let q = query.trim().to_lowercase();
        if let Some(id) = name_to_id.get(&q) {
            return Some(id.clone());
        }
        let normalized = normalize_concept_name(query);
        if let Some(id) = name_to_id.get(&normalized) {
            return Some(id.clone());
        }
        name_to_id
            .iter()
            .filter(|(k, _)| k.len() >= 4)
            .find(|(k, _)| k.contains(q.as_str()) || q.contains(k.as_str()))
            .map(|(_, v)| v.clone())
    }

    // Upsert helper: returns existing id or inserts new node.
    // Checks both exact lowercase and normalized (plural-collapsed) forms.
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
        let normalized = normalize_concept_name(name);
        if let Some(existing_id) = name_to_id.get(&normalized).cloned() {
            // Store the new spelling as an alias lookup
            name_to_id.insert(lower, existing_id.clone());
            return Some(existing_id);
        }
        let id = uuid::Uuid::new_v4().to_string();
        let result = conn.execute(
            "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level) \
             VALUES (?1, ?2, ?3, ?4, ?5, '[]', '[]', '[]', 0.0, 0.0, 0, ?6, ?6, ?7)",
            rusqlite::params![id, req.workspace_id, name.trim(), description, concept_type, now, hierarchy_level],
        );
        if result.is_ok() {
            name_to_id.insert(lower, id.clone());
            name_to_id.insert(normalized, id.clone());
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

#[derive(Debug, Deserialize)]
pub struct AnalyzeDescendantsRequest {
    pub workspace_id: String,
    pub model: String,
    pub ollama_url: Option<String>,
    pub focus_topic: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DescendantAnalysisProgress {
    pub workspace_id: String,
    pub workspace_name: String,
    pub index: usize,
    pub total: usize,
    pub status: String, // "started" | "completed" | "skipped" | "failed"
    pub error: Option<String>,
    pub result: Option<AnalysisResult>,
}

#[tauri::command]
pub async fn analyze_descendants(
    app: AppHandle,
    state: State<'_, DbState>,
    req: AnalyzeDescendantsRequest,
) -> Result<Vec<DescendantAnalysisProgress>, String> {
    use crate::commands::ollama::BackgroundInferenceCancel;

    // Get direct child workspaces
    let children: Vec<(String, String)> = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name FROM workspaces WHERE parent_workspace_id = ?1 ORDER BY order_index, name",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params![req.workspace_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
        rows
    };

    if children.is_empty() {
        return Err("No child workspaces found to analyze.".to_string());
    }

    let total = children.len();
    let mut results: Vec<DescendantAnalysisProgress> = Vec::with_capacity(total);

    // Subscribe to cancellation — yield if user starts chatting
    let cancel_rx = app
        .state::<BackgroundInferenceCancel>()
        .0
        .subscribe();

    for (index, (ws_id, ws_name)) in children.iter().enumerate() {
        // Check cancellation before each child
        if cancel_rx.has_changed().unwrap_or(false) {
            // User started chatting — stop analysis
            let progress = DescendantAnalysisProgress {
                workspace_id: ws_id.clone(),
                workspace_name: ws_name.clone(),
                index,
                total,
                status: "skipped".to_string(),
                error: Some("Yielded to active chat".to_string()),
                result: None,
            };
            let _ = app.emit("descendant-analysis-progress", &progress);
            results.push(progress);
            break;
        }

        // Emit started
        let started = DescendantAnalysisProgress {
            workspace_id: ws_id.clone(),
            workspace_name: ws_name.clone(),
            index,
            total,
            status: "started".to_string(),
            error: None,
            result: None,
        };
        let _ = app.emit("descendant-analysis-progress", &started);

        // Run analysis for this child
        let child_req = AnalyzeWorkspaceRequest {
            workspace_id: ws_id.clone(),
            model: req.model.clone(),
            ollama_url: req.ollama_url.clone(),
            focus_topic: req.focus_topic.clone(),
            survey_context: None,
        };

        match analyze_workspace_impl(&state.0, child_req).await {
            Ok(result) => {
                let progress = DescendantAnalysisProgress {
                    workspace_id: ws_id.clone(),
                    workspace_name: ws_name.clone(),
                    index,
                    total,
                    status: "completed".to_string(),
                    error: None,
                    result: Some(result),
                };
                let _ = app.emit("descendant-analysis-progress", &progress);
                results.push(progress);
            }
            Err(err) => {
                let progress = DescendantAnalysisProgress {
                    workspace_id: ws_id.clone(),
                    workspace_name: ws_name.clone(),
                    index,
                    total,
                    status: if err.contains("No content found") || err.contains("Not enough workspace material") {
                        "skipped".to_string()
                    } else {
                        "failed".to_string()
                    },
                    error: Some(err),
                    result: None,
                };
                let _ = app.emit("descendant-analysis-progress", &progress);
                results.push(progress);
            }
        }
    }

    Ok(results)
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

    if concept_names.is_empty() && req.survey_context.is_none() {
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

    let prompt = if concept_names.is_empty() {
        // Survey-only path: generate goals purely from the learner context
        let survey = req.survey_context.as_deref().unwrap_or("");
        format!(
            "You are a learning coach helping a learner set their first goals for a new workspace.\n\
            Learner context:\n{survey}{existing}\n\n\
            Suggest 3-5 concrete, actionable learning goals tailored to this learner.\n\
            Respond with ONLY valid JSON array (no markdown):\n\
            [{{\"title\":\"...\",\"description\":\"...\",\"related_concepts\":[\"...\",\"...\"]}}]\n\
            - title: actionable goal (start with a verb)\n\
            - description: 1-2 sentences\n\
            - related_concepts: 2-4 specific topics from the learner context",
            survey = survey,
            existing = existing_clause,
        )
    } else {
        let survey_clause = req
            .survey_context
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(|s| format!("\nLearner context:\n{s}\n"))
            .unwrap_or_default();
        format!(
            "You are a learning coach. Based on the following concepts a learner has been studying, suggest 3-5 concrete learning goals.\n\
            Concepts: {concepts}{survey}{existing}\n\n\
            Respond with ONLY valid JSON array (no markdown):\n\
            [{{\"title\":\"...\",\"description\":\"...\",\"related_concepts\":[\"...\",\"...\"]}}]\n\
            - title: actionable goal (start with a verb)\n\
            - description: 1-2 sentences\n\
            - related_concepts: 2-4 concepts from the list above",
            concepts = concept_names.join(", "),
            survey = survey_clause,
            existing = existing_clause,
        )
    };

    let client = OllamaClient::new(req.ollama_url)?;
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    let raw = client.send_message("ai_knowledge", &req.model, messages).await?;

    let trimmed = raw.trim();
    let json_str = match extract_first_json_array(trimmed) {
        Some(s) => s,
        None => {
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
