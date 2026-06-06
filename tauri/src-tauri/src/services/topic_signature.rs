use crate::db::DbState;
use crate::models::workspace::{TopicSignature, TopicTag};
use crate::ollama::client::{OllamaClient, OllamaMessage, RequestContext};
use crate::services::ai_content_generator::generate_tags;
use crate::services::model_settings::{get_model_for_job, get_ollama_base_url};
use rusqlite::Connection;
use std::collections::HashMap;
use std::time::Duration;

const GENERIC_TOPIC_TAGS: &[&str] = &[
    "code",
    "coding",
    "function",
    "functions",
    "method",
    "methods",
    "class",
    "classes",
    "object",
    "objects",
    "variable",
    "variables",
    "example",
    "examples",
    "question",
    "questions",
    "answer",
    "answers",
    "what",
    "when",
    "where",
    "why",
    "how",
    "who",
    "mean",
    "means",
    "help",
    "explain",
    "explaining",
    "understand",
    "understanding",
    "learn",
    "learning",
    "guide",
    "tutorial",
    "details",
    "detail",
    "issue",
    "issues",
    "problem",
    "problems",
    "error",
    "errors",
    "fix",
    "debug",
    "implementation",
    "implement",
    "dependency",
    "dependencies",
    "management",
    "feature",
    "features",
    "system",
    "systems",
    "programming",
    "language",
    "languages",
    "memory",
    "space",
    "abstraction",
    "allocation",
    "collection",
    "collections",
    "using",
    "used",
    "use",
    "make",
    "build",
    "create",
    "need",
    "want",
    "trying",
    "works",
    "work",
    "thing",
    "things",
    "stuff",
    "project",
    "folders",
    "app",
    "apps",
    "line",
    "lines",
    "file",
    "files",
    "folder",
    "folders",
    "module",
    "modules",
    "import",
    "imports",
    "command",
    "commands",
    "data",
    "core",
    "load",
    "loads",
    "loaded",
    "loading",
    "print",
    "output",
    "input",
    "step",
    "steps",
    "part",
    "parts",
    "last",
    "first",
    "second",
    "third",
    "four",
    "five",
    "minute",
    "minutes",
    "hour",
    "hours",
    "day",
    "days",
    "start",
    "started",
    "starting",
    "run",
    "runs",
    "running",
    "process",
    "processes",
    "message",
    "messages",
    "chat",
    "chats",
    "text",
    "texts",
    "content",
    "result",
    "results",
    "current",
    "previous",
    "next",
    "new",
    "old",
    "already",
    "generic",
    "either",
    "consuming",
    "consumed",
];

const SPECIFIC_SHORT_TAGS: &[&str] = &[
    "api", "sql", "css", "html", "rust", "java", "swift", "linux",
];

fn is_specific_topic_tag(tag: &str) -> bool {
    if GENERIC_TOPIC_TAGS.contains(&tag) {
        return false;
    }

    if SPECIFIC_SHORT_TAGS.contains(&tag) {
        return true;
    }

    if tag.chars().all(|ch| ch.is_ascii_digit()) {
        return false;
    }

    if tag.ends_with("ing") && tag.len() <= 10 {
        return false;
    }

    tag.len() >= 4
}

fn extract_specific_tags(text: &str, max: usize) -> Vec<String> {
    let mut scores: HashMap<String, usize> = HashMap::new();
    let mut document_frequency: HashMap<String, usize> = HashMap::new();

    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let line_tags = generate_tags(line, 8);
        let mut seen_in_line = std::collections::HashSet::new();

        for (idx, tag) in line_tags.into_iter().enumerate() {
            if !is_specific_topic_tag(&tag) {
                continue;
            }

            let positional_weight = 10usize.saturating_sub(idx);
            let specificity_bonus = tag.len().min(12);
            *scores.entry(tag.clone()).or_default() += positional_weight + specificity_bonus;

            if seen_in_line.insert(tag.clone()) {
                *document_frequency.entry(tag).or_default() += 1;
            }
        }
    }

    let mut ranked: Vec<(String, usize, usize)> = scores
        .into_iter()
        .map(|(tag, score)| {
            let df = document_frequency.get(&tag).copied().unwrap_or(0);
            (tag, score, df)
        })
        .collect();

    ranked.sort_by(|a, b| {
        b.2.cmp(&a.2)
            .then(b.1.cmp(&a.1))
            .then(b.0.len().cmp(&a.0.len()))
            .then(a.0.cmp(&b.0))
    });

    ranked
        .into_iter()
        .take(max)
        .map(|(tag, _, _)| tag)
        .collect()
}

fn normalize_topic_label(tag: &str) -> Option<String> {
    let normalized = tag
        .trim()
        .trim_matches(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '+')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();

    if normalized.is_empty() || normalized.len() > 40 {
        return None;
    }

    let word_count = normalized.split_whitespace().count();
    if word_count > 4 {
        return None;
    }

    if word_count == 1 {
        is_specific_topic_tag(&normalized).then_some(normalized)
    } else {
        let has_specific_word = normalized.split_whitespace().any(is_specific_topic_tag);
        has_specific_word.then_some(normalized)
    }
}

fn merge_topic_tags(primary: Vec<TopicTag>, secondary: Vec<TopicTag>, max: usize) -> Vec<TopicTag> {
    let mut merged = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for tag in primary.into_iter().chain(secondary) {
        let Some(normalized) = normalize_topic_label(&tag.tag) else {
            continue;
        };

        // Check for semantic duplicates via synonym table
        let is_duplicate = seen
            .iter()
            .any(|existing: &String| tags_match_fuzzy(existing, &normalized));

        if !is_duplicate && seen.insert(normalized.clone()) {
            merged.push(TopicTag {
                tag: normalized,
                weight: tag.weight,
                source: tag.source,
            });
        }
        if merged.len() >= max {
            break;
        }
    }

    merged
}

fn extract_json_object(s: &str) -> Option<String> {
    let start = s.find('{')?;
    let mut depth = 0;
    let mut in_string = false;
    let mut escape_next = false;

    for (i, ch) in s[start..].char_indices() {
        if escape_next {
            escape_next = false;
            continue;
        }
        match ch {
            '\\' if in_string => escape_next = true,
            '"' => in_string = !in_string,
            '{' if !in_string => depth += 1,
            '}' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    return Some(s[start..start + i + 1].to_string());
                }
            }
            _ => {}
        }
    }

    None
}

pub fn collect_workspace_text(
    conn: &Connection,
    workspace_id: &str,
) -> Result<(String, u64), String> {
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

    let rows = stmt
        .query_map([workspace_id], |row| {
            let content: String = row.get(0)?;
            Ok(content)
        })
        .map_err(|e| e.to_string())?;

    for content in rows.flatten() {
        text.push_str(&content);
        text.push('\n');
        count += 1;
    }

    Ok((text, count))
}

pub fn recompute_workspace_signature(
    conn: &Connection,
    workspace_id: &str,
) -> Result<TopicSignature, String> {
    let existing_json: String = conn
        .query_row(
            "SELECT topic_signature FROM workspaces WHERE id = ?1",
            rusqlite::params![workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let existing: TopicSignature = serde_json::from_str(&existing_json).unwrap_or_default();

    let (text, count) = collect_workspace_text(conn, workspace_id)?;
    let mut sig = if count == 0 {
        TopicSignature::default()
    } else {
        let mut generated = generate_heuristic(&text);
        generated.message_count_at_gen = Some(count);
        generated
    };

    sig.custom_tags = existing.custom_tags;
    sig.excluded_tags = existing.excluded_tags;
    sig.auto_detected_tags
        .retain(|t| !sig.excluded_tags.contains(&t.tag));
    let now = chrono::Utc::now().to_rfc3339();
    let sig_json = serde_json::to_string(&sig).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE workspaces SET topic_signature = ?1, signature_updated_at = ?2 WHERE id = ?3",
        rusqlite::params![sig_json, now, workspace_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(sig)
}

pub fn generate_heuristic(text: &str) -> TopicSignature {
    let tags = {
        let specific = extract_specific_tags(text, 20);
        if specific.is_empty() {
            generate_tags(text, 20)
                .into_iter()
                .filter(|tag| is_specific_topic_tag(tag))
                .collect()
        } else {
            specific
        }
    };
    let mut auto_detected_tags = Vec::new();
    for (i, tag) in tags.into_iter().enumerate() {
        auto_detected_tags.push(TopicTag {
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
    if lower.contains("error")
        || lower.contains("bug")
        || lower.contains("fix")
        || lower.contains("issue")
    {
        intent_patterns.push("debugging".to_string());
    }
    if lower.contains("tutorial") || lower.contains("guide") {
        intent_patterns.push("tutorial".to_string());
    }
    if lower.contains("compare") || lower.contains("vs") || lower.contains("review") {
        intent_patterns.push("code-review".to_string());
    }

    TopicSignature {
        auto_detected_tags,
        custom_tags: Vec::new(),
        excluded_tags: Vec::new(),
        intent_patterns,
        generated_at: Some(chrono::Utc::now().to_rfc3339()),
        message_count_at_gen: None,
        ollama_enriched: false,
        suggested_prompts: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{extract_specific_tags, is_specific_topic_tag};

    #[test]
    fn filters_generic_log_words() {
        assert!(!is_specific_topic_tag("line"));
        assert!(!is_specific_topic_tag("module"));
        assert!(!is_specific_topic_tag("consuming"));
    }

    #[test]
    fn keeps_real_domain_terms() {
        assert!(is_specific_topic_tag("anaconda"));
        assert!(is_specific_topic_tag("linux"));
        assert!(is_specific_topic_tag("java"));
        assert!(is_specific_topic_tag("rust"));
        assert!(is_specific_topic_tag("cargo"));
    }

    #[test]
    fn prefers_specific_topics_over_generic_noise() {
        let text = "\
error loading module line line line data import command\n\
anaconda environment on linux with java sdk setup\n\
fixing anaconda path issue on linux for java tooling\n";

        let tags = extract_specific_tags(text, 10);

        assert!(tags.iter().any(|tag| tag == "anaconda"));
        assert!(tags.iter().any(|tag| tag == "linux"));
        assert!(tags.iter().any(|tag| tag == "java"));
        assert!(!tags.iter().any(|tag| tag == "line"));
        assert!(!tags.iter().any(|tag| tag == "module"));
        assert!(!tags.iter().any(|tag| tag == "command"));
    }

    #[test]
    fn rejects_question_words_and_roadmap_noise() {
        assert!(!is_specific_topic_tag("what"));
        assert!(!is_specific_topic_tag("programming"));
        assert!(!is_specific_topic_tag("language"));
        assert!(!is_specific_topic_tag("memory"));
        assert!(!is_specific_topic_tag("space"));

        let text = "\
what what what programming language memory space abstraction allocation collections\n\
rust cargo toml ownership borrow checker cargo dependency management\n";

        let tags = extract_specific_tags(text, 10);

        assert!(tags.iter().any(|tag| tag == "rust"));
        assert!(tags.iter().any(|tag| tag == "cargo"));
        assert!(!tags.iter().any(|tag| tag == "what"));
        assert!(!tags.iter().any(|tag| tag == "programming"));
        assert!(!tags.iter().any(|tag| tag == "language"));
        assert!(!tags.iter().any(|tag| tag == "memory"));
        assert!(!tags.iter().any(|tag| tag == "space"));
        assert!(!tags.iter().any(|tag| tag == "abstraction"));
        assert!(!tags.iter().any(|tag| tag == "allocation"));
        assert!(!tags.iter().any(|tag| tag == "collections"));
    }

    #[test]
    fn fuzzy_matches_synonyms() {
        use super::tags_match_fuzzy;

        assert!(tags_match_fuzzy("kubernetes", "k8s"));
        assert!(tags_match_fuzzy("k8s", "kubernetes"));
        assert!(tags_match_fuzzy("javascript", "js"));
        assert!(tags_match_fuzzy("machine learning", "ml"));
        assert!(!tags_match_fuzzy("rust", "python"));
    }

    #[test]
    fn fuzzy_matches_substring() {
        use super::tags_match_fuzzy;

        assert!(tags_match_fuzzy("react", "react native"));
        assert!(tags_match_fuzzy("react native", "react"));
        assert!(!tags_match_fuzzy("go", "golang")); // too short for substring match
    }

    #[test]
    fn extract_json_with_nested_objects() {
        use super::extract_json_object;

        let input =
            r#"Here is the result: {"topics":["rust","python"],"nested":{"key":"val"}} extra text"#;
        let result = extract_json_object(input).unwrap();
        assert_eq!(
            result,
            r#"{"topics":["rust","python"],"nested":{"key":"val"}}"#
        );
    }

    #[test]
    fn extract_json_with_strings_containing_braces() {
        use super::extract_json_object;

        let input = r#"{"topics":["test {thing}"]}"#;
        let result = extract_json_object(input).unwrap();
        assert_eq!(result, input);
    }

    #[test]
    fn dedup_merges_synonyms() {
        use super::{merge_topic_tags, TopicTag};

        let primary = vec![TopicTag {
            tag: "kubernetes".to_string(),
            weight: 30,
            source: "ollama".to_string(),
        }];
        let secondary = vec![TopicTag {
            tag: "k8s".to_string(),
            weight: 20,
            source: "heuristic".to_string(),
        }];
        let merged = merge_topic_tags(primary, secondary, 12);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].tag, "kubernetes");
    }
}

pub async fn enrich_with_ollama(
    heuristic: TopicSignature,
    text: &str,
    model: &str,
    ollama_url: &str,
    mut cancel_rx: Option<tokio::sync::watch::Receiver<u64>>,
) -> TopicSignature {
    #[derive(serde::Deserialize)]
    struct EnrichmentPayload {
        topics: Vec<String>,
        intent_patterns: Option<Vec<String>>,
    }

    let sample = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(120)
        .collect::<Vec<_>>()
        .join("\n");

    if sample.trim().is_empty() {
        return heuristic;
    }

    let prompt = format!(
        "Analyze these workspace chat excerpts and infer the most specific recurring subject areas.\n\
Return ONLY a JSON object with this exact shape:\n\
{{\"topics\":[\"topic one\",\"topic two\"],\"intent_patterns\":[\"learning\",\"debugging\"]}}\n\
Rules:\n\
- topics must be 2 to 4 words when possible\n\
- prefer concrete domains, libraries, tools, frameworks, languages, environments, and problem areas\n\
- avoid generic words like system, module, data, import, file, line, command, issue, question\n\
- return 6 to 12 topics max\n\
- intent_patterns can only contain: learning, debugging, tutorial, code-review\n\
- no markdown, no explanation\n\n\
Chat excerpts:\n{sample}"
    );

    let Ok(client) = OllamaClient::new(Some(ollama_url.to_string())) else {
        return heuristic;
    };
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];

    // Background task: use a short timeout so a busy Ollama instance doesn't
    // block for 300s, and keep_alive="0s" so the model unloads immediately
    // after the call and doesn't compete with user-initiated inference.
    let ctx = RequestContext {
        source: Some("topic_signature"),
        timeout_override: Some(Duration::from_secs(90)),
        ..Default::default()
    };

    // Race the HTTP call against the user-chat cancel signal so the background
    // task yields the Ollama queue the moment a user sends a message.
    let raw = if let Some(ref mut rx) = cancel_rx {
        let gen_before = *rx.borrow();
        tokio::select! {
            result = client.send_message_with_options_observed(model, messages, Some("0s"), &ctx) => {
                match result {
                    Ok(r) => r,
                    Err(_) => return heuristic,
                }
            }
            _ = async {
                // Wait for a generation bump (user chat starting)
                loop {
                    let _ = rx.changed().await;
                    if *rx.borrow() != gen_before { break; }
                }
            } => {
                return heuristic; // cancelled — user chat takes priority
            }
        }
    } else {
        match client
            .send_message_with_options_observed(model, messages, Some("0s"), &ctx)
            .await
        {
            Ok(r) => r,
            Err(_) => return heuristic,
        }
    };
    let Some(json_str) = extract_json_object(&raw) else {
        return heuristic;
    };
    let Ok(payload) = serde_json::from_str::<EnrichmentPayload>(&json_str) else {
        return heuristic;
    };

    let ollama_tags = payload
        .topics
        .into_iter()
        .filter_map(|topic| normalize_topic_label(&topic))
        .enumerate()
        .map(|(idx, tag)| TopicTag {
            tag,
            weight: (30usize.saturating_sub(idx * 2)) as u32,
            source: "ollama".to_string(),
        })
        .collect::<Vec<_>>();

    let mut intent_patterns = payload.intent_patterns.unwrap_or_default();
    intent_patterns.retain(|intent| {
        matches!(
            intent.as_str(),
            "learning" | "debugging" | "tutorial" | "code-review"
        )
    });
    intent_patterns.sort();
    intent_patterns.dedup();

    let mut enriched = heuristic;
    enriched.auto_detected_tags = merge_topic_tags(ollama_tags, enriched.auto_detected_tags, 12);
    if !intent_patterns.is_empty() {
        enriched.intent_patterns = intent_patterns;
    }
    enriched.ollama_enriched = true;
    enriched
}

pub async fn recompute_workspace_signature_with_ai(
    state: &DbState,
    workspace_id: &str,
    model_override: Option<String>,
    ollama_url_override: Option<String>,
    cancel_rx: Option<tokio::sync::watch::Receiver<u64>>,
) -> Result<TopicSignature, String> {
    let (existing, text, count, model, ollama_url) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let existing_json: String = conn
            .query_row(
                "SELECT topic_signature FROM workspaces WHERE id = ?1",
                rusqlite::params![workspace_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let existing: TopicSignature = serde_json::from_str(&existing_json).unwrap_or_default();
        let (text, count) = collect_workspace_text(&conn, workspace_id)?;
        let model = model_override.or_else(|| get_model_for_job(&conn, "topic_signature_model"));
        let ollama_url = ollama_url_override.or_else(|| get_ollama_base_url(&conn));
        (existing, text, count, model, ollama_url)
    };

    if count == 0 {
        return Ok(existing);
    }

    // Skip recompute if no new messages since last generation
    if let Some(prev_count) = existing.message_count_at_gen {
        if count == prev_count && existing.ollama_enriched {
            return Ok(existing);
        }
    }

    let mut sig = generate_heuristic(&text);
    sig.message_count_at_gen = Some(count);

    if let (Some(model), Some(ollama_url)) = (model, ollama_url) {
        sig = enrich_with_ollama(sig, &text, &model, &ollama_url, cancel_rx).await;
    }

    sig.custom_tags = existing.custom_tags;
    sig.excluded_tags = existing.excluded_tags;
    sig.suggested_prompts = existing.suggested_prompts;
    sig.auto_detected_tags
        .retain(|t| !sig.excluded_tags.contains(&t.tag));

    let now = chrono::Utc::now().to_rfc3339();
    sig.generated_at = Some(now.clone());
    let sig_json = serde_json::to_string(&sig).map_err(|e| e.to_string())?;

    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE workspaces SET topic_signature = ?1, signature_updated_at = ?2 WHERE id = ?3",
        rusqlite::params![sig_json, now, workspace_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(sig)
}

/// Common abbreviation/synonym pairs for fuzzy topic matching.
const TOPIC_SYNONYMS: &[&[&str]] = &[
    &["kubernetes", "k8s"],
    &["javascript", "js"],
    &["typescript", "ts"],
    &["python", "py"],
    &["machine learning", "ml"],
    &["artificial intelligence", "ai"],
    &["database", "db"],
    &["postgresql", "postgres"],
    &["continuous integration", "ci"],
    &["continuous deployment", "cd"],
    &["react native", "rn"],
    &["operating system", "os"],
    &["natural language processing", "nlp"],
    &["application programming interface", "api"],
    &["graphql", "gql"],
    &["elasticsearch", "elastic"],
    &["mongodb", "mongo"],
    &["configuration", "config"],
    &["authentication", "auth"],
    &["authorization", "authz"],
];

fn tags_match_fuzzy(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }

    // Check synonym table (bidirectional)
    for group in TOPIC_SYNONYMS {
        if group.contains(&a) && group.contains(&b) {
            return true;
        }
    }

    // Check if one tag contains the other (e.g. "react" matches "react native")
    if a.len() >= 4 && b.len() >= 4 && (a.contains(b) || b.contains(a)) {
        return true;
    }

    false
}

pub fn compute_match_score(message: &str, signature: &TopicSignature) -> f64 {
    let msg_tags = generate_tags(message, 10);
    if msg_tags.is_empty() {
        return 0.0;
    }

    let mut match_count = 0;
    for tag in &msg_tags {
        // Skip if this tag is in the ignored list
        if signature.excluded_tags.contains(tag) {
            continue;
        }

        // Check auto-detected or custom tags with fuzzy matching
        let matched = signature
            .auto_detected_tags
            .iter()
            .any(|t| tags_match_fuzzy(&t.tag, tag))
            || signature
                .custom_tags
                .iter()
                .any(|t| tags_match_fuzzy(t, tag));

        if matched {
            match_count += 1;
        }
    }

    match_count as f64 / (msg_tags.len() as f64)
}

pub fn find_best_workspace(
    conn: &Connection,
    message: &str,
    exclude_workspace_id: &str,
    threshold: f64,
) -> Option<(String, String, f64)> {
    let mut stmt = conn.prepare("SELECT id, name, topic_signature FROM workspaces WHERE id != ?1 AND topic_signature != '{}' AND is_hidden = 0").ok()?;

    let mut best_match = None;
    let mut highest_score = 0.0;

    let rows = stmt
        .query_map([exclude_workspace_id], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let sig_json: String = row.get(2)?;
            Ok((id, name, sig_json))
        })
        .ok()?;

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
