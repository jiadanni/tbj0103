//! Chat → Note / Document conversion.
//!
//! Loads a chat session's messages, asks an LLM for a structured summary
//! plus a small set of key concepts, wraps those concepts as [[wiki-links]]
//! in the summary, and returns a combined Markdown body (summary + transcript).
//!
//! The caller is responsible for persisting the result (project_notes or sources)
//! and invoking `linking_engine::index_note_links` so the concepts land in the
//! knowledge graph.

use crate::ollama::client::{OllamaClient, OllamaMessage};
use rusqlite::Connection;

/// What was loaded from the DB for a conversion request.
pub struct ChatBundle {
    pub session_id: String,
    pub workspace_id: String,
    pub title: String,
    /// Ordered (role, content) pairs — `<think>` blocks already stripped.
    pub turns: Vec<(String, String)>,
}

/// Final conversion artifact ready to persist.
pub struct ConvertedChat {
    pub title: String,
    pub content: String,
    pub concepts: Vec<String>,
}

/// Load the chat session plus all its messages in the order they occurred.
/// Returns `Err` if the session doesn't exist or has fewer than 2 messages
/// (nothing meaningful to convert).
pub fn load_chat_bundle(conn: &Connection, session_id: &str) -> Result<ChatBundle, String> {
    let (workspace_id, title): (String, String) = conn
        .query_row(
            "SELECT workspace_id, title FROM chat_sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "Chat session not found".to_string(),
            other => other.to_string(),
        })?;

    let mut stmt = conn
        .prepare(
            "SELECT role, content FROM messages \
             WHERE session_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![session_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut turns: Vec<(String, String)> = Vec::new();
    for r in rows {
        let (role, content) = r.map_err(|e| e.to_string())?;
        if role == "system" {
            continue;
        }
        let stripped = strip_think_blocks(&content);
        let trimmed = stripped.trim();
        if trimmed.is_empty() {
            continue;
        }
        turns.push((role, trimmed.to_string()));
    }

    if turns.len() < 2 {
        return Err(
            "Chat is too short to convert — need at least one user and one assistant message."
                .to_string(),
        );
    }

    Ok(ChatBundle {
        session_id: session_id.to_string(),
        workspace_id,
        title,
        turns,
    })
}

/// Strip `<think>...</think>` reasoning blocks from assistant content so they
/// don't leak into saved transcripts or waste the summarization prompt.
/// Handles both `<think>...</think>` and `<think title="...">...</think>`.
fn strip_think_blocks(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let mut cursor = 0;
    while cursor < content.len() {
        let rest = &content[cursor..];
        if rest.starts_with("<think") {
            if let Some(close_rel) = rest.find("</think>") {
                cursor += close_rel + "</think>".len();
                continue;
            } else {
                // Unclosed — drop everything from here on.
                break;
            }
        }
        // Copy the next char (UTF-8 safe) verbatim.
        let next_char = rest.chars().next().expect("cursor < len");
        out.push(next_char);
        cursor += next_char.len_utf8();
    }
    out
}

/// Build a plain Markdown transcript from the loaded turns.
fn render_transcript(turns: &[(String, String)]) -> String {
    let mut s = String::new();
    for (role, content) in turns {
        let heading = match role.as_str() {
            "user" => "## User",
            "assistant" => "## Assistant",
            other => {
                // Unknown role — render verbatim but capitalized.
                let mut chars = other.chars();
                let first = chars
                    .next()
                    .map(|c| c.to_uppercase().to_string())
                    .unwrap_or_default();
                let rest: String = chars.collect();
                s.push_str(&format!("## {first}{rest}\n\n"));
                s.push_str(content);
                s.push_str("\n\n");
                continue;
            }
        };
        s.push_str(heading);
        s.push_str("\n\n");
        s.push_str(content);
        s.push_str("\n\n");
    }
    s.trim_end().to_string()
}

/// Call the LLM to summarize the chat and extract concept names.
/// Returns `(summary_markdown, concept_names)`. If parsing fails, returns
/// degraded output (raw response as summary, empty concept list) rather than
/// failing the whole conversion.
async fn summarize_and_extract(
    client: &OllamaClient,
    model: &str,
    transcript: &str,
) -> Result<(String, Vec<String>), String> {
    let system_prompt =
        "You are summarizing a learning conversation between a user and an assistant. \
Respond in EXACTLY this envelope format and nothing else:\n\n\
<summary>\n\
## Key points\n\
- ...\n\
## Takeaways\n\
- ...\n\
## Open questions\n\
- ...\n\
</summary>\n\
<concepts>[\"concept one\", \"concept two\"]</concepts>\n\n\
Rules:\n\
- 3 to 8 concepts, each a noun phrase 1-4 words.\n\
- Concepts should be ideas a learner would want to revisit, not generic words.\n\
- Concepts must appear (or be clearly referenced) in the summary.\n\
- Output ONLY the two tagged blocks. No prose, no code fences, no commentary.";

    let user_prompt = format!(
        "Summarize the following conversation and extract its key concepts.\n\nConversation:\n{transcript}"
    );

    let messages = vec![
        OllamaMessage {
            role: "system".to_string(),
            content: system_prompt.to_string(),
        },
        OllamaMessage {
            role: "user".to_string(),
            content: user_prompt,
        },
    ];

    let raw = client
        .send_message("chat_conversion", model, messages)
        .await?;
    Ok(parse_envelope(&raw))
}

/// Parse the `<summary>...</summary><concepts>[...]</concepts>` envelope.
/// Falls back gracefully: missing summary → whole raw text; bad concepts JSON → empty list.
fn parse_envelope(raw: &str) -> (String, Vec<String>) {
    let summary = extract_tag(raw, "summary").unwrap_or_else(|| raw.trim().to_string());

    let concepts = extract_tag(raw, "concepts")
        .and_then(|c| serde_json::from_str::<Vec<String>>(c.trim()).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();

    (summary, concepts)
}

fn extract_tag(text: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = text.find(&open)? + open.len();
    let end_rel = text[start..].find(&close)?;
    Some(text[start..start + end_rel].trim().to_string())
}

/// Wrap each concept name with `[[...]]` at its first occurrence in `content`.
/// Case-insensitive, whole-word match. Existing `[[links]]` are preserved.
fn wrap_concepts(content: &str, concepts: &[String]) -> String {
    let mut result = content.to_string();
    for name in concepts {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Skip if already wiki-linked somewhere.
        let already_linked = format!("[[{trimmed}]]");
        if result.contains(&already_linked) {
            continue;
        }
        if let Some((idx, len)) = find_whole_word_ci(&result, trimmed) {
            let matched = &result[idx..idx + len];
            let replacement = format!("[[{matched}]]");
            let mut new_result = String::with_capacity(result.len() + 4);
            new_result.push_str(&result[..idx]);
            new_result.push_str(&replacement);
            new_result.push_str(&result[idx + len..]);
            result = new_result;
        }
    }
    result
}

/// Case-insensitive whole-word search over the original `haystack`. Returns the
/// byte offset and length (in `haystack`) of the first whole-word match, or None.
/// Word boundaries are detected using `char::is_alphanumeric` on the chars adjacent
/// to the match — so this works for unicode text, not just ASCII.
fn find_whole_word_ci(haystack: &str, needle: &str) -> Option<(usize, usize)> {
    let needle_lower: String = needle.to_lowercase();
    if needle_lower.is_empty() {
        return None;
    }
    let needle_chars: Vec<char> = needle_lower.chars().collect();

    let haystack_chars: Vec<(usize, char)> = haystack.char_indices().collect();
    let n = needle_chars.len();

    for start_idx in 0..haystack_chars.len().saturating_sub(n.saturating_sub(1)) {
        if start_idx + n > haystack_chars.len() {
            break;
        }
        // Compare `n` chars starting at start_idx, lowercased, to needle_chars.
        let mut matches = true;
        for j in 0..n {
            let (_, ch) = haystack_chars[start_idx + j];
            // to_lowercase() on a char returns an iterator — compare the first char.
            // (Good enough for the concept-matching use case.)
            let lowered = ch.to_lowercase().next().unwrap_or(ch);
            if lowered != needle_chars[j] {
                matches = false;
                break;
            }
        }
        if !matches {
            continue;
        }

        // Word-boundary check: the character before must not be alphanumeric (or we're at start),
        // and the character after must not be alphanumeric (or we're at end).
        let before_ok = start_idx == 0
            || !haystack_chars[start_idx - 1].1.is_alphanumeric()
                && haystack_chars[start_idx - 1].1 != '_';
        let after_ok = start_idx + n == haystack_chars.len()
            || !haystack_chars[start_idx + n].1.is_alphanumeric()
                && haystack_chars[start_idx + n].1 != '_';
        if !(before_ok && after_ok) {
            continue;
        }

        let start_byte = haystack_chars[start_idx].0;
        let end_byte = if start_idx + n < haystack_chars.len() {
            haystack_chars[start_idx + n].0
        } else {
            haystack.len()
        };
        return Some((start_byte, end_byte - start_byte));
    }
    None
}

/// Full pipeline: render transcript, summarize with LLM, wrap concepts, combine.
pub async fn build_converted_chat(
    client: &OllamaClient,
    model: &str,
    bundle: &ChatBundle,
) -> Result<ConvertedChat, String> {
    let transcript = render_transcript(&bundle.turns);
    let (summary_raw, concepts) = summarize_and_extract(client, model, &transcript).await?;
    let summary_linked = wrap_concepts(&summary_raw, &concepts);

    let content =
        format!("{summary_linked}\n\n---\n\n## Conversation transcript\n\n{transcript}\n");

    Ok(ConvertedChat {
        title: bundle.title.clone(),
        content,
        concepts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_think_removes_blocks() {
        let input = "<think>reasoning here</think>Actual answer.";
        assert_eq!(strip_think_blocks(input), "Actual answer.");
    }

    #[test]
    fn strip_think_with_title() {
        let input = "<think title=\"plan\">reasoning</think>Answer.";
        assert_eq!(strip_think_blocks(input), "Answer.");
    }

    #[test]
    fn strip_think_unclosed_drops_tail() {
        let input = "Before.<think>oops never closed";
        assert_eq!(strip_think_blocks(input), "Before.");
    }

    #[test]
    fn parse_envelope_extracts_both_sections() {
        let raw = "<summary>\n## Key points\n- A\n</summary>\n<concepts>[\"Foo\", \"Bar Baz\"]</concepts>";
        let (summary, concepts) = parse_envelope(raw);
        assert!(summary.contains("Key points"));
        assert_eq!(concepts, vec!["Foo".to_string(), "Bar Baz".to_string()]);
    }

    #[test]
    fn parse_envelope_missing_concepts_gives_empty_list() {
        let raw = "<summary>only summary</summary>";
        let (summary, concepts) = parse_envelope(raw);
        assert_eq!(summary, "only summary");
        assert!(concepts.is_empty());
    }

    #[test]
    fn parse_envelope_bad_concepts_json_gives_empty_list() {
        let raw = "<summary>sum</summary><concepts>not json</concepts>";
        let (_, concepts) = parse_envelope(raw);
        assert!(concepts.is_empty());
    }

    #[test]
    fn wrap_concepts_wraps_first_occurrence_only() {
        let content = "Staff Engineer versus Principal Engineer — Staff Engineer scope...";
        let concepts = vec!["Staff Engineer".to_string()];
        let out = wrap_concepts(content, &concepts);
        assert_eq!(
            out,
            "[[Staff Engineer]] versus Principal Engineer — Staff Engineer scope..."
        );
    }

    #[test]
    fn wrap_concepts_preserves_existing_links() {
        let content = "[[Staff Engineer]] is a role";
        let out = wrap_concepts(content, &["Staff Engineer".to_string()]);
        assert_eq!(out, "[[Staff Engineer]] is a role");
    }

    #[test]
    fn wrap_concepts_case_insensitive() {
        let content = "discussing staff engineer duties";
        let out = wrap_concepts(content, &["Staff Engineer".to_string()]);
        assert_eq!(out, "discussing [[staff engineer]] duties");
    }

    #[test]
    fn wrap_concepts_respects_word_boundary() {
        // "engineer" should NOT match inside "reengineered"
        let content = "reengineered some work";
        let out = wrap_concepts(content, &["engineer".to_string()]);
        assert_eq!(out, "reengineered some work");
    }

    #[test]
    fn render_transcript_includes_role_headings() {
        let turns = vec![
            ("user".to_string(), "hello".to_string()),
            ("assistant".to_string(), "hi".to_string()),
        ];
        let out = render_transcript(&turns);
        assert!(out.contains("## User"));
        assert!(out.contains("## Assistant"));
        assert!(out.contains("hello"));
        assert!(out.contains("hi"));
    }
}
