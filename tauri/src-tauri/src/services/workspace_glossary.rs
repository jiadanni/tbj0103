use crate::db::DbState;
use crate::models::glossary::{
    ResolvedWorkspaceGlossaryTerm, UpsertWorkspaceGlossaryTermRequest, WorkspaceGlossaryTerm,
};
use crate::models::workspace::TopicSignature;
use crate::ollama::client::{OllamaClient, OllamaMessage};
use crate::services::ai_content_generator::generate_tags;
use crate::services::model_settings::{get_model_for_job, get_ollama_base_url};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use tauri::{AppHandle, Runtime};

const GENERIC_TERMS: &[&str] = &[
    "about", "above", "across", "adjacent", "after", "afterwards", "again", "against", "all",
    "almost", "alone", "along", "already", "also", "although", "always", "amid", "amidst",
    "among", "amongst", "amount", "another", "answer", "any", "anyhow", "anyone", "anything",
    "anyway", "anywhere", "app", "around", "assistant", "back", "base", "based", "became",
    "because", "become", "becomes", "becoming", "been", "before", "beforehand", "behind", "being",
    "below", "beneath", "beside", "besides", "between", "beyond", "both", "bottom", "build",
    "cannot", "change", "chat", "code", "come", "comes", "coming", "complete", "completed",
    "completing", "concerning", "considering", "content", "context", "could", "data", "debug", "definition",
    "despite", "details", "does", "doing", "done", "down", "during", "each", "either",
    "else", "elsewhere", "empty", "enough", "every", "everyone", "everything", "everywhere", "example",
    "except", "excepting", "excluding", "feature", "file", "files", "first", "five", "fix",
    "following", "former", "formerly", "found", "four", "from", "front", "full", "function",
    "further", "gave", "generic", "give", "given", "giving", "goes", "going", "gone",
    "half", "hardly", "have", "having", "help", "hence", "hereafter", "hereby", "herein",
    "hereupon", "hers", "herself", "himself", "however", "hundred", "implement", "implementation", "indeed",
    "inside", "instead", "into", "issue", "items", "itself", "just", "keep", "keeps",
    "kept", "last", "latter", "latterly", "least", "less", "like", "little", "look",
    "looking", "looks", "many", "maybe", "meanwhile", "message", "messages", "might", "model",
    "more", "moreover", "most", "mostly", "much", "must", "myself", "namely", "near",
    "neither", "never", "nevertheless", "next", "nine", "nobody", "none", "noone", "nor",
    "note", "notes", "nothing", "nowhere", "often", "once", "only", "onto", "opposite",
    "other", "others", "otherwise", "ought", "ourselves", "output", "outside", "over", "overall",
    "parallel", "past", "perhaps", "please", "plus", "possible", "possibly", "probably", "problem",
    "project", "question", "quite", "rather", "really", "regarding", "response", "result", "round",
    "same", "seem", "seemed", "seeming", "seems", "seldom", "session", "settings", "several",
    "shall", "should", "since", "some", "somehow", "someone", "something", "sometime", "sometimes",
    "somewhere", "still", "such", "summary", "system", "task", "ten", "text", "than",
    "that", "their", "theirs", "them", "themselves", "then", "thence", "there", "thereafter",
    "thereby", "therefore", "therein", "thereupon", "these", "they", "thing", "things", "think",
    "thinks", "third", "this", "those", "though", "three", "through", "throughout", "thru",
    "thus", "together", "toward", "towards", "twelve", "twenty", "under", "underneath", "unless",
    "unlike", "until", "update", "upon", "user", "using", "usually", "versus", "very",
    "view", "was", "were", "what", "whatever", "when", "whence", "whenever", "where",
    "whereafter", "whereas", "whereby", "wherein", "whereupon", "wherever", "whether", "which", "while",
    "whither", "who", "whoever", "whole", "whom", "whose", "why", "will", "with",
    "within", "without", "work", "workspace", "would", "yet", "you", "your", "yours",
    "yourself", "yourselves",
];
const SHORT_TECH_TERMS: &[&str] = &["api", "css", "html", "http", "json", "sql", "ssh", "url"];

static TOKEN_RE: OnceLock<Regex> = OnceLock::new();
static CODE_FENCE_RE: OnceLock<Regex> = OnceLock::new();
static SENTENCE_TERM_RE: OnceLock<Regex> = OnceLock::new();

fn token_re() -> &'static Regex {
    TOKEN_RE.get_or_init(|| {
        Regex::new(r"[A-Za-z0-9][A-Za-z0-9.+#/_-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.+#/_-]*){0,3}")
            .expect("valid glossary token regex")
    })
}

fn code_fence_re() -> &'static Regex {
    CODE_FENCE_RE.get_or_init(|| Regex::new(r"(?s)```.*?```|`[^`\n]+`").expect("valid code regex"))
}

fn sentence_term_re() -> &'static Regex {
    SENTENCE_TERM_RE.get_or_init(|| {
        Regex::new(r"\b[a-z][a-z0-9.+#/_-]{1,}\b").expect("valid sentence regex")
    })
}

fn strip_code_blocks(text: &str) -> String {
    code_fence_re().replace_all(text, " ").to_string()
}

pub fn normalize_term(term: &str) -> Option<String> {
    let normalized = term
        .trim()
        .trim_matches(|ch: char| !ch.is_alphanumeric() && !matches!(ch, '+' | '#' | '.' | '/' | '-' | ' '))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();

    if normalized.is_empty() || normalized.len() > 80 {
        return None;
    }

    let word_count = normalized.split_whitespace().count();
    if word_count == 0 || word_count > 4 {
        return None;
    }

    Some(normalized)
}

fn normalize_aliases(aliases: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    aliases
        .iter()
        .filter_map(|alias| normalize_term(alias))
        .filter(|alias| seen.insert(alias.clone()))
        .collect()
}

fn looks_like_domain_term(term: &str) -> bool {
    let lower = term.to_lowercase();
    if lower.is_empty() || lower.len() > 80 || GENERIC_TERMS.contains(&lower.as_str()) {
        return false;
    }

    let words = lower.split_whitespace().collect::<Vec<_>>();
    if words.is_empty() || words.len() > 4 {
        return false;
    }

    if words.len() == 1 {
        let word = words[0];
        if SHORT_TECH_TERMS.contains(&word) {
            return true;
        }
        if word.chars().all(|ch| ch.is_ascii_digit()) || word.len() < 4 {
            return false;
        }
    }

    lower.contains('-')
        || lower.contains('.')
        || lower.contains('/')
        || lower.contains('#')
        || lower.contains('+')
        || words.len() > 1
        || lower.len() >= 5
}

fn ancestor_workspace_ids(conn: &Connection, workspace_id: &str) -> Result<Vec<String>, String> {
    let mut ids = Vec::new();
    let mut current = Some(workspace_id.to_string());
    let mut seen = HashSet::new();

    while let Some(id) = current {
        if !seen.insert(id.clone()) {
            break;
        }
        ids.push(id.clone());
        current = conn
            .query_row(
                "SELECT parent_workspace_id FROM workspaces WHERE id = ?1",
                params![id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
    }

    Ok(ids)
}

fn workspace_names_by_id(
    conn: &Connection,
    workspace_ids: &[String],
) -> Result<HashMap<String, String>, String> {
    let mut names = HashMap::new();
    for workspace_id in workspace_ids {
        if let Some(name) = conn
            .query_row(
                "SELECT name FROM workspaces WHERE id = ?1",
                params![workspace_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        {
            names.insert(workspace_id.clone(), name);
        }
    }
    Ok(names)
}

fn row_to_term(
    row: &rusqlite::Row<'_>,
    workspace_names: &HashMap<String, String>,
    base_workspace_id: &str,
) -> rusqlite::Result<WorkspaceGlossaryTerm> {
    let workspace_id: String = row.get(1)?;
    let aliases_json: String = row.get(5)?;
    let aliases = serde_json::from_str(&aliases_json).unwrap_or_default();
    let is_inherited = workspace_id != base_workspace_id;
    Ok(WorkspaceGlossaryTerm {
        id: row.get(0)?,
        workspace_id: workspace_id.clone(),
        workspace_name: workspace_names.get(&workspace_id).cloned(),
        term: row.get(2)?,
        normalized_term: row.get(3)?,
        definition: row.get(4)?,
        aliases,
        source_kind: row.get(6)?,
        source_session_id: row.get(7)?,
        is_user_edited: row.get::<_, i64>(8)? != 0,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        is_inherited,
        inherited_from_workspace_id: is_inherited.then_some(workspace_id.clone()),
        inherited_from_workspace_name: if is_inherited {
            workspace_names.get(&workspace_id).cloned()
        } else {
            None
        },
    })
}

pub fn list_terms(
    conn: &Connection,
    workspace_id: &str,
    include_inherited: bool,
) -> Result<Vec<WorkspaceGlossaryTerm>, String> {
    let workspace_ids = if include_inherited {
        ancestor_workspace_ids(conn, workspace_id)?
    } else {
        vec![workspace_id.to_string()]
    };
    let workspace_names = workspace_names_by_id(conn, &workspace_ids)?;
    let mut seen_terms = HashSet::new();
    let mut results = Vec::new();

    for scoped_workspace_id in &workspace_ids {
        let mut stmt = conn
            .prepare(
                "SELECT id, workspace_id, term, normalized_term, definition, aliases_json, source_kind,
                        source_session_id, is_user_edited, created_at, updated_at
                 FROM workspace_glossary_terms
                 WHERE workspace_id = ?1
                 ORDER BY lower(term) ASC, updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![scoped_workspace_id], |row| {
                row_to_term(row, &workspace_names, workspace_id)
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let term = row.map_err(|e| e.to_string())?;
            if seen_terms.insert(term.normalized_term.clone()) {
                results.push(term);
            }
        }
    }

    Ok(results)
}

pub fn resolve_term<R: Runtime>(
    app: &AppHandle<R>,
    conn: &Connection,
    workspace_id: &str,
    candidates: &[String],
) -> Result<Option<ResolvedWorkspaceGlossaryTerm>, String> {
    let workspace_ids = ancestor_workspace_ids(conn, workspace_id)?;
    let workspace_names = workspace_names_by_id(conn, &workspace_ids)?;

    // 1. Try resolving custom workspace glossary term first
    for candidate in candidates {
        let Some(normalized) = normalize_term(candidate) else {
            continue;
        };
        for scoped_workspace_id in &workspace_ids {
            let row = conn
                .query_row(
                    "SELECT term, normalized_term, definition, aliases_json, source_kind, workspace_id
                     FROM workspace_glossary_terms
                     WHERE workspace_id = ?1 AND normalized_term = ?2",
                    params![scoped_workspace_id, normalized],
                    |row| {
                        Ok(ResolvedWorkspaceGlossaryTerm {
                            term: row.get(0)?,
                            normalized_term: row.get(1)?,
                            definition: row.get(2)?,
                            aliases: serde_json::from_str::<Vec<String>>(&row.get::<_, String>(3)?)
                                .unwrap_or_default(),
                            source_kind: row.get(4)?,
                            workspace_id: row.get(5)?,
                            workspace_name: None,
                        })
                    },
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(mut resolved) = row {
                resolved.workspace_name = workspace_names.get(&resolved.workspace_id).cloned();
                return Ok(Some(resolved));
            }
        }
    }

    // 2. Fall back to offline dictionary query
    for candidate in candidates {
        if let Some(resolved) = crate::services::dictionary_service::lookup_word(app, candidate)? {
            return Ok(Some(resolved));
        }
    }

    Ok(None)
}

pub fn upsert_term(
    conn: &Connection,
    req: UpsertWorkspaceGlossaryTermRequest,
) -> Result<WorkspaceGlossaryTerm, String> {
    let normalized_term =
        normalize_term(&req.term).ok_or_else(|| "Glossary term is invalid".to_string())?;
    let definition = req.definition.trim().to_string();
    if definition.is_empty() {
        return Err("Glossary definition cannot be empty".to_string());
    }

    let aliases = normalize_aliases(&req.aliases)
        .into_iter()
        .filter(|alias| alias != &normalized_term)
        .collect::<Vec<_>>();
    let aliases_json = serde_json::to_string(&aliases).map_err(|e| e.to_string())?;
    let source_kind = req
        .source_kind
        .unwrap_or_else(|| "manual".to_string())
        .trim()
        .to_string();
    let is_user_edited = source_kind == "manual";
    let now = chrono::Utc::now().to_rfc3339();
    let existing_id = if let Some(id) = req.id.clone() {
        Some(id)
    } else {
        conn.query_row(
            "SELECT id FROM workspace_glossary_terms WHERE workspace_id = ?1 AND normalized_term = ?2",
            params![req.workspace_id, normalized_term],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    let term_id = existing_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    if conn
        .query_row(
            "SELECT COUNT(*) FROM workspace_glossary_terms WHERE id = ?1",
            params![term_id.clone()],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        > 0
    {
        conn.execute(
            "UPDATE workspace_glossary_terms
             SET term = ?1,
                 normalized_term = ?2,
                 definition = ?3,
                 aliases_json = ?4,
                 source_kind = ?5,
                 source_session_id = ?6,
                 is_user_edited = ?7,
                 updated_at = ?8
             WHERE id = ?9",
            params![
                req.term.trim(),
                normalized_term,
                definition,
                aliases_json,
                source_kind,
                req.source_session_id,
                if is_user_edited { 1 } else { 0 },
                now,
                term_id,
            ],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO workspace_glossary_terms (
                id, workspace_id, term, normalized_term, definition, aliases_json,
                source_kind, source_session_id, is_user_edited, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![
                term_id,
                req.workspace_id,
                req.term.trim(),
                normalized_term,
                definition,
                aliases_json,
                source_kind,
                req.source_session_id,
                if is_user_edited { 1 } else { 0 },
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    let mut items = list_terms(conn, &req.workspace_id, false)?;
    items.retain(|item| item.id == term_id);
    items
        .into_iter()
        .next()
        .ok_or_else(|| "Failed to load saved glossary term".to_string())
}

pub fn delete_term(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM workspace_glossary_terms WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn assistant_message_count_for_workspace(conn: &Connection, workspace_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*)
         FROM messages m
         JOIN chat_sessions cs ON cs.id = m.session_id
         WHERE cs.workspace_id = ?1
           AND m.role = 'assistant'
           AND cs.is_incognito = 0
           AND cs.exclude_from_analytics = 0
           AND cs.is_imported = 0",
        params![workspace_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn assistant_message_count_for_session(conn: &Connection, session_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM messages WHERE session_id = ?1 AND role = 'assistant'",
        params![session_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn load_workspace_topic_seed_terms(conn: &Connection, workspace_id: &str) -> Result<Vec<String>, String> {
    let raw = conn
        .query_row(
            "SELECT topic_signature FROM workspaces WHERE id = ?1",
            params![workspace_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };

    let signature = serde_json::from_str::<TopicSignature>(&raw).unwrap_or_default();
    let mut terms = Vec::new();
    for tag in signature.custom_tags {
        if let Some(normalized) = normalize_term(&tag) {
            if looks_like_domain_term(&normalized) {
                terms.push(normalized);
            }
        }
    }
    for tag in signature.auto_detected_tags {
        if let Some(normalized) = normalize_term(&tag.tag) {
            if looks_like_domain_term(&normalized) {
                terms.push(normalized);
            }
        }
    }
    Ok(terms)
}

fn extract_candidate_terms(texts: &[String], max_terms: usize) -> Vec<String> {
    let mut scores: HashMap<String, usize> = HashMap::new();

    for text in texts {
        let text = strip_code_blocks(text);
        for tag in generate_tags(&text, 24) {
            if let Some(normalized) = normalize_term(&tag) {
                if looks_like_domain_term(&normalized) {
                    *scores.entry(normalized).or_default() += 4;
                }
            }
        }

        for capture in token_re().find_iter(&text) {
            let Some(normalized) = normalize_term(capture.as_str()) else {
                continue;
            };
            if !looks_like_domain_term(&normalized) {
                continue;
            }
            let weight = if normalized.split_whitespace().count() > 1 { 5 } else { 2 };
            *scores.entry(normalized).or_default() += weight;
        }

        for token in sentence_term_re().find_iter(&text.to_lowercase()) {
            let word = token.as_str();
            if looks_like_domain_term(word) {
                *scores.entry(word.to_string()).or_default() += 1;
            }
        }
    }

    let mut ranked = scores.into_iter().collect::<Vec<_>>();
    ranked.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then(
                b.0.split_whitespace()
                    .count()
                    .cmp(&a.0.split_whitespace().count()),
            )
            .then(b.0.len().cmp(&a.0.len()))
            .then(a.0.cmp(&b.0))
    });
    ranked.into_iter().take(max_terms).map(|(term, _)| term).collect()
}

fn fetch_workspace_corpus(conn: &Connection, workspace_id: &str) -> Result<Vec<String>, String> {
    let mut texts = Vec::new();

    let workspace_meta = conn
        .query_row(
            "SELECT name, description, prompt_instructions FROM workspaces WHERE id = ?1",
            params![workspace_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((name, description, prompt)) = workspace_meta {
        texts.push(name);
        if !description.trim().is_empty() {
            texts.push(description);
        }
        if !prompt.trim().is_empty() {
            texts.push(prompt);
        }
    }

    let sources = [
        "SELECT title || '\n' || content FROM project_notes WHERE workspace_id = ?1 ORDER BY updated_at DESC LIMIT 40",
        "SELECT content FROM daily_notes WHERE workspace_id = ?1 ORDER BY updated_at DESC LIMIT 20",
        "SELECT content FROM memories WHERE workspace_id = ?1 AND scope = 'workspace' ORDER BY updated_at DESC LIMIT 30",
        "SELECT m.content
         FROM messages m
         JOIN chat_sessions cs ON cs.id = m.session_id
         WHERE cs.workspace_id = ?1
           AND m.role = 'assistant'
           AND cs.is_incognito = 0
           AND cs.exclude_from_analytics = 0
           AND cs.is_imported = 0
         ORDER BY m.created_at DESC
         LIMIT 80",
    ];

    for sql in sources {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![workspace_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let value = row.map_err(|e| e.to_string())?;
            if !value.trim().is_empty() {
                texts.push(value);
            }
        }
    }

    texts.extend(load_workspace_topic_seed_terms(conn, workspace_id)?);
    Ok(texts)
}

fn known_terms_for_workspace(conn: &Connection, workspace_id: &str) -> Result<HashSet<String>, String> {
    Ok(list_terms(conn, workspace_id, true)?
        .into_iter()
        .map(|item| item.normalized_term)
        .collect())
}

fn extract_json_array(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    match (trimmed.find('['), trimmed.rfind(']')) {
        (Some(start), Some(end)) if end > start => Some(&trimmed[start..=end]),
        _ => None,
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
struct GlossaryResponseEntry {
    term: String,
    definition: String,
    #[serde(default)]
    aliases: Vec<String>,
}

async fn generate_glossary_entries(
    model: &str,
    ollama_url: &str,
    workspace_name: &str,
    seed_terms: &[String],
    context_snippets: &[String],
) -> Result<Vec<GlossaryResponseEntry>, String> {
    if seed_terms.is_empty() {
        return Ok(Vec::new());
    }

    let prompt = format!(
        "You are building a workspace glossary for a local knowledge app.\n\
         Return ONLY a JSON array. Each item must be an object with keys: term, definition, aliases.\n\
         Definitions must be concise, plain English, and specific to the workspace context.\n\
         Include only terms that are genuinely domain-specific or workspace-specific.\n\
         Terms must be SINGLE WORDS only — no spaces, no multi-word phrases.\n\
         Skip ordinary English words. Aliases should be a short array and can be empty.\n\n\
         Workspace: {workspace_name}\n\
         Candidate terms:\n- {}\n\n\
         Context excerpts:\n{}\n",
        seed_terms.join("\n- "),
        context_snippets
            .iter()
            .take(12)
            .map(|snippet| format!("- {}", snippet.replace('\n', " ").chars().take(240).collect::<String>()))
            .collect::<Vec<_>>()
            .join("\n")
    );

    let client = OllamaClient::new(Some(ollama_url.to_string()))?;
    let raw = client
        .send_message_with_options(
            "workspace_glossary",
            model,
            vec![OllamaMessage {
                role: "user".to_string(),
                content: prompt,
            }],
            Some("0s"),
        )
        .await?;
    let Some(json_str) = extract_json_array(&raw) else {
        return Ok(Vec::new());
    };
    serde_json::from_str::<Vec<GlossaryResponseEntry>>(json_str).map_err(|e| e.to_string())
}

fn save_generated_entries(
    conn: &Connection,
    workspace_id: &str,
    source_kind: &str,
    source_session_id: Option<&str>,
    entries: Vec<GlossaryResponseEntry>,
) -> Result<Vec<WorkspaceGlossaryTerm>, String> {
    let mut saved = Vec::new();
    for entry in entries {
        let Some(normalized_term) = normalize_term(&entry.term) else {
            continue;
        };
        if !looks_like_domain_term(&normalized_term) || entry.definition.trim().is_empty() {
            continue;
        }

        let existing = conn
            .query_row(
                "SELECT id, is_user_edited FROM workspace_glossary_terms
                 WHERE workspace_id = ?1 AND normalized_term = ?2",
                params![workspace_id, normalized_term],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? != 0)),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if existing.as_ref().is_some_and(|(_, is_user_edited)| *is_user_edited) {
            continue;
        }

        let saved_term = upsert_term(
            conn,
            UpsertWorkspaceGlossaryTermRequest {
                id: existing.map(|(id, _)| id),
                workspace_id: workspace_id.to_string(),
                term: entry.term,
                definition: entry.definition,
                aliases: entry.aliases,
                source_kind: Some(source_kind.to_string()),
                source_session_id: source_session_id.map(|value| value.to_string()),
            },
        )?;
        saved.push(saved_term);
    }

    Ok(saved)
}

pub async fn refresh_workspace_glossary(
    state: &DbState,
    workspace_id: &str,
) -> Result<Vec<WorkspaceGlossaryTerm>, String> {
    let (workspace_name, corpus, seed_terms, model, ollama_url, assistant_count) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let workspace_name = conn
            .query_row(
                "SELECT name FROM workspaces WHERE id = ?1",
                params![workspace_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| e.to_string())?;
        let corpus = fetch_workspace_corpus(&conn, workspace_id)?;
        let known = known_terms_for_workspace(&conn, workspace_id)?;
        let mut seed_terms = extract_candidate_terms(&corpus, 24);
        seed_terms.retain(|term| !known.contains(term));
        let model = get_model_for_job(&conn, "glossary_model");
        let ollama_url = get_ollama_base_url(&conn);
        let assistant_count = assistant_message_count_for_workspace(&conn, workspace_id)?;
        (workspace_name, corpus, seed_terms, model, ollama_url, assistant_count)
    };

    let Some(model) = model else {
        return Ok(Vec::new());
    };
    let Some(ollama_url) = ollama_url else {
        return Ok(Vec::new());
    };

    let generated =
        generate_glossary_entries(&model, &ollama_url, &workspace_name, &seed_terms, &corpus).await?;
    let now = chrono::Utc::now().to_rfc3339();
    let saved = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let saved = save_generated_entries(&conn, workspace_id, "glossary_seed", None, generated)?;
        conn.execute(
            "INSERT INTO workspace_glossary_state (workspace_id, last_seeded_at, assistant_message_count_at_seed, updated_at)
             VALUES (?1, ?2, ?3, ?2)
             ON CONFLICT(workspace_id) DO UPDATE SET
                 last_seeded_at = excluded.last_seeded_at,
                 assistant_message_count_at_seed = excluded.assistant_message_count_at_seed,
                 updated_at = excluded.updated_at",
            params![workspace_id, now, assistant_count],
        )
        .map_err(|e| e.to_string())?;
        saved
    };

    Ok(saved)
}

pub async fn refresh_due_workspaces(state: &DbState) -> Result<usize, String> {
    // Active-workspace preference: refresh the user's current workspace if
    // it's due, plus at most one other workspace per tick (drip). The drip
    // prevents stale workspaces from going completely dark but keeps the
    // per-tick LLM cost bounded.
    let workspace_ids = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let current_workspace_id =
            crate::services::model_settings::get_current_workspace_id(&conn);
        let mut stmt = conn
            .prepare(
                "SELECT w.id
                 FROM workspaces w
                 LEFT JOIN workspace_glossary_state s ON s.workspace_id = w.id
                 WHERE w.is_hidden = 0
                   AND (
                     s.workspace_id IS NULL
                     OR COALESCE(s.assistant_message_count_at_seed, 0) < (
                       SELECT COUNT(*)
                       FROM messages m
                       JOIN chat_sessions cs ON cs.id = m.session_id
                       WHERE cs.workspace_id = w.id
                         AND m.role = 'assistant'
                         AND cs.is_incognito = 0
                         AND cs.exclude_from_analytics = 0
                         AND cs.is_imported = 0
                     )
                     OR datetime(COALESCE((
                       SELECT MAX(updated_at) FROM (
                         SELECT w.updated_at AS updated_at
                         UNION ALL
                         SELECT pn.updated_at
                         FROM project_notes pn
                         WHERE pn.workspace_id = w.id
                         UNION ALL
                         SELECT dn.updated_at
                         FROM daily_notes dn
                         WHERE dn.workspace_id = w.id
                         UNION ALL
                         SELECT mem.updated_at
                         FROM memories mem
                         WHERE mem.workspace_id = w.id AND mem.scope = 'workspace'
                         UNION ALL
                         SELECT d.updated_at
                         FROM documents d
                         WHERE d.workspace_id = w.id
                         UNION ALL
                         SELECT wc.created_at
                         FROM web_captures wc
                         WHERE wc.workspace_id = w.id
                         UNION ALL
                         SELECT m.created_at
                         FROM messages m
                         JOIN chat_sessions cs ON cs.id = m.session_id
                         WHERE cs.workspace_id = w.id
                           AND cs.is_incognito = 0
                           AND cs.exclude_from_analytics = 0
                           AND cs.is_imported = 0
                       )
                     ), '1970-01-01T00:00:00Z')) > datetime(COALESCE(s.updated_at, '1970-01-01T00:00:00Z'))
                   )
                 ORDER BY
                   CASE WHEN w.id = ?1 THEN 0
                        WHEN w.id = (SELECT parent_workspace_id FROM workspaces WHERE id = ?1) THEN 1
                        ELSE 2 END ASC,
                   datetime(COALESCE(s.last_seeded_at, '1970-01-01T00:00:00Z')) ASC
                 LIMIT 2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![current_workspace_id.unwrap_or_default()], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let mut refreshed = 0usize;
    for workspace_id in workspace_ids {
        if refresh_workspace_glossary(state, &workspace_id).await.is_ok() {
            refreshed += 1;
        }
    }
    Ok(refreshed)
}

fn session_scan_needed(conn: &Connection, session_id: &str, current_count: i64) -> Result<bool, String> {
    let last_count = conn
        .query_row(
            "SELECT last_scanned_assistant_count FROM session_glossary_scan_state WHERE session_id = ?1",
            params![session_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(0);
    Ok(current_count > last_count)
}

async fn scan_session_for_missing_terms(
    state: &DbState,
    workspace_id: &str,
    session_id: &str,
    model: &str,
    ollama_url: &str,
) -> Result<usize, String> {
    let (workspace_name, assistant_count, message_texts, known_terms) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let workspace_name = conn
            .query_row(
                "SELECT name FROM workspaces WHERE id = ?1",
                params![workspace_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| e.to_string())?;
        let assistant_count = assistant_message_count_for_session(&conn, session_id)?;
        if !session_scan_needed(&conn, session_id, assistant_count)? {
            return Ok(0);
        }
        let mut stmt = conn
            .prepare(
                "SELECT content
                 FROM messages
                 WHERE session_id = ?1 AND role = 'assistant'
                 ORDER BY created_at DESC
                 LIMIT 40",
            )
            .map_err(|e| e.to_string())?;
        let message_texts = stmt
            .query_map(params![session_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let known_terms = known_terms_for_workspace(&conn, workspace_id)?;
        (workspace_name, assistant_count, message_texts, known_terms)
    };

    let mut candidates = extract_candidate_terms(&message_texts, 12);
    candidates.retain(|term| !known_terms.contains(term));
    if candidates.is_empty() {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO session_glossary_scan_state (session_id, last_scanned_assistant_count, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(session_id) DO UPDATE SET
                 last_scanned_assistant_count = excluded.last_scanned_assistant_count,
                 updated_at = excluded.updated_at",
            params![session_id, assistant_count, now],
        )
        .map_err(|e| e.to_string())?;
        return Ok(0);
    }

    let generated =
        generate_glossary_entries(model, ollama_url, &workspace_name, &candidates, &message_texts)
            .await?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let saved = save_generated_entries(&conn, workspace_id, "ai_scan", Some(session_id), generated)?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO session_glossary_scan_state (session_id, last_scanned_assistant_count, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET
             last_scanned_assistant_count = excluded.last_scanned_assistant_count,
             updated_at = excluded.updated_at",
        params![session_id, assistant_count, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(saved.len())
}

pub async fn scan_recent_sessions_for_missing_terms(state: &DbState) -> Result<usize, String> {
    let (enabled, max_sessions, model, ollama_url, sessions) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let enabled = crate::commands::settings::get_setting(&conn, "hover_definition_scan_enabled")
            .map(|value| value == "true")
            .unwrap_or(true);
        let max_sessions =
            crate::commands::settings::get_setting(&conn, "hover_definition_scan_max_sessions")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(3);
        let model = get_model_for_job(&conn, "glossary_model");
        let ollama_url = get_ollama_base_url(&conn);
        let current_workspace_id =
            crate::services::model_settings::get_current_workspace_id(&conn);
        // Prefer sessions in the active workspace (or its parent if user is
        // in a sub-workspace) so the scan results are visible where the user
        // actually is.
        let mut stmt = conn
            .prepare(
                "SELECT cs.id, cs.workspace_id
                 FROM chat_sessions cs
                 WHERE cs.is_incognito = 0
                   AND cs.exclude_from_analytics = 0
                   AND cs.is_imported = 0
                 ORDER BY
                   CASE WHEN cs.workspace_id = ?2 THEN 0
                        WHEN cs.workspace_id = (SELECT parent_workspace_id FROM workspaces WHERE id = ?2) THEN 1
                        ELSE 2 END ASC,
                   cs.updated_at DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let sessions = stmt
            .query_map(params![max_sessions as i64, current_workspace_id.unwrap_or_default()], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        (enabled, max_sessions, model, ollama_url, sessions)
    };

    if !enabled || max_sessions == 0 {
        return Ok(0);
    }
    let Some(model) = model else {
        return Ok(0);
    };
    let Some(ollama_url) = ollama_url else {
        return Ok(0);
    };

    let mut total_saved = 0usize;
    for (session_id, workspace_id) in sessions {
        total_saved +=
            scan_session_for_missing_terms(state, &workspace_id, &session_id, &model, &ollama_url)
                .await
                .unwrap_or(0);
    }
    Ok(total_saved)
}
