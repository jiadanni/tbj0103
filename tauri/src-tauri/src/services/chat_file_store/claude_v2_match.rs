// Suggest a target project for each orphan Claude conversation.
//
// Claude Desktop's v2 export strips the project link from conversations.json
// (every chat has `project: null`). The only remaining signals are the chat's
// title, its first user message, and the project's name + prompt_template.
//
// This module is a pure scoring function. The frontend shows suggestions and
// the user confirms before import — we never auto-route.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use super::{ClaudeConversationPreview, ClaudeProjectPreview};

#[derive(Debug, Clone, Serialize)]
pub struct MatchSuggestion {
    pub conversation_uuid: String,
    pub project_uuid: Option<String>,
    pub score: f32,
    pub reason: &'static str, // "title" | "keywords" | "none"
}

/// Minimum fraction of chat tokens that must overlap with the winning project's
/// vocabulary. Coverage = |chat ∩ project| / |chat|. Insensitive to project pool
/// size (memory blows that up to hundreds of tokens), so this stays meaningful.
const COVERAGE_MIN: f32 = 0.25;
/// The top-scoring project must beat the runner-up by at least this margin,
/// otherwise the chat is generic enough to overlap multiple projects equally
/// and assigning it to any one would be a guess.
const MARGIN_MIN: f32 = 0.08;
/// Chats with fewer significant tokens than this are too short to discriminate.
const MIN_CHAT_TOKENS: usize = 4;
const MIN_TOKEN_LEN: usize = 4;

pub fn suggest_project_for_conversations(
    conversations: &[ClaudeConversationPreview],
    projects: &[ClaudeProjectPreview],
    memories_by_project: &HashMap<String, String>,
) -> Vec<MatchSuggestion> {
    let project_keywords: Vec<(String, HashSet<String>)> = projects
        .iter()
        .map(|p| {
            let memory = memories_by_project.get(&p.uuid).map(String::as_str).unwrap_or("");
            let mut text = String::with_capacity(
                p.prompt_template.len() + p.description.len() + memory.len() + 2,
            );
            text.push_str(&p.prompt_template);
            text.push(' ');
            text.push_str(&p.description);
            text.push(' ');
            text.push_str(memory);
            (p.uuid.clone(), tokenize(&text))
        })
        .collect();

    let project_names_lower: Vec<(String, String)> = projects
        .iter()
        .map(|p| (p.uuid.clone(), p.name.trim().to_lowercase()))
        .collect();

    conversations
        .iter()
        .map(|conv| score_conversation(conv, &project_names_lower, &project_keywords))
        .collect()

    // TODO: when local matching returns `None` for a chat, optionally call Ollama
    // with project names + descriptions + chat snippet to pick a best-fit project.
    // Gated behind a settings flag (off by default), since it's slow over 100s of chats.
}

fn score_conversation(
    conv: &ClaudeConversationPreview,
    project_names_lower: &[(String, String)],
    project_keywords: &[(String, HashSet<String>)],
) -> MatchSuggestion {
    let title_lower = conv.name.trim().to_lowercase();

    // 1. Title-substring match: project name appears as a whole word in the title.
    if !title_lower.is_empty() {
        for (uuid, name_lower) in project_names_lower {
            if name_lower.is_empty() { continue; }
            if contains_whole_word(&title_lower, name_lower) {
                return MatchSuggestion {
                    conversation_uuid: conv.uuid.clone(),
                    project_uuid: Some(uuid.clone()),
                    score: 0.9,
                    reason: "title",
                };
            }
        }
    }

    // 2. Coverage match: how much of the chat's vocabulary is covered by each
    //    project's prompt + description + memory?
    //
    //    Coverage handles asymmetric set sizes (small chat ~10–40 tokens vs.
    //    large project pool ~200–650 tokens with memory) correctly, where
    //    Jaccard would crush the score to ~0.01.
    let chat_tokens = {
        let mut t = String::with_capacity(conv.name.len() + conv.first_user_message.len() + 1);
        t.push_str(&conv.name);
        t.push(' ');
        t.push_str(&conv.first_user_message);
        tokenize(&t)
    };
    let chat_n = chat_tokens.len();
    if chat_n >= MIN_CHAT_TOKENS {
        let mut top: Option<(String, f32)> = None;
        let mut runner_up: f32 = 0.0;
        for (uuid, kws) in project_keywords {
            if kws.is_empty() { continue; }
            let overlap = chat_tokens.intersection(kws).count() as f32;
            let coverage = overlap / chat_n as f32;
            match &top {
                Some((_, best)) if coverage > *best => {
                    runner_up = *best;
                    top = Some((uuid.clone(), coverage));
                }
                Some((_, best)) if coverage > runner_up && coverage <= *best => {
                    runner_up = coverage;
                }
                None => {
                    top = Some((uuid.clone(), coverage));
                }
                _ => {}
            }
        }
        if let Some((uuid, score)) = top {
            if score >= COVERAGE_MIN && (score - runner_up) >= MARGIN_MIN {
                return MatchSuggestion {
                    conversation_uuid: conv.uuid.clone(),
                    project_uuid: Some(uuid),
                    score: score.min(0.85),
                    reason: "keywords",
                };
            }
        }
    }

    MatchSuggestion {
        conversation_uuid: conv.uuid.clone(),
        project_uuid: None,
        score: 0.0,
        reason: "none",
    }
}

fn contains_whole_word(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() || needle.len() > haystack.len() { return false; }
    let mut start = 0;
    while let Some(pos) = haystack[start..].find(needle) {
        let abs = start + pos;
        let before_ok = abs == 0
            || !haystack[..abs]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric());
        let after_ok = {
            let end = abs + needle.len();
            end == haystack.len()
                || !haystack[end..]
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_alphanumeric())
        };
        if before_ok && after_ok {
            return true;
        }
        start = abs + needle.len();
    }
    false
}

fn tokenize(text: &str) -> HashSet<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter_map(|w| {
            let lower = w.trim().to_lowercase();
            if lower.len() < MIN_TOKEN_LEN { return None; }
            if is_stopword(&lower) { return None; }
            Some(lower)
        })
        .collect()
}

fn is_stopword(w: &str) -> bool {
    matches!(
        w,
        "this" | "that" | "with" | "from" | "have" | "been" | "were" | "their"
        | "they" | "them" | "would" | "could" | "should" | "what" | "when"
        | "where" | "which" | "while" | "your" | "yours" | "about" | "into"
        | "than" | "then" | "there" | "these" | "those" | "some" | "such"
        | "only" | "very" | "much" | "many" | "more" | "most" | "also"
        | "after" | "before" | "between" | "because" | "being" | "doing"
        | "does" | "done" | "just" | "like" | "make" | "made" | "want"
        | "will" | "well" | "over" | "under" | "above" | "below" | "again"
        | "ever" | "every" | "each" | "other" | "another" | "even"
        | "here" | "hers" | "himself" | "herself" | "itself" | "yourself"
        | "ourselves" | "myself" | "always" | "really" | "still"
        | "back" | "down" | "onto" | "upon" | "around" | "through"
        | "without" | "within" | "must" | "shall" | "thing" | "things"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conv(uuid: &str, name: &str, msg: &str) -> ClaudeConversationPreview {
        ClaudeConversationPreview {
            uuid: uuid.to_string(),
            name: name.to_string(),
            message_count: 1,
            created_at: String::new(),
            updated_at: String::new(),
            project_uuid: None,
            first_user_message: msg.to_string(),
        }
    }

    fn proj(uuid: &str, name: &str, prompt: &str) -> ClaudeProjectPreview {
        ClaudeProjectPreview {
            uuid: uuid.to_string(),
            name: name.to_string(),
            description: String::new(),
            has_prompt: !prompt.is_empty(),
            doc_count: 0,
            conversation_count: 0,
            has_memory: false,
            prompt_template: prompt.to_string(),
        }
    }

    #[test]
    fn title_match_wins() {
        let projects = vec![
            proj("p1", "Java", ""),
            proj("p2", "Dutch", ""),
        ];
        let convs = vec![conv("c1", "Learning Java collections", "")];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(out[0].project_uuid.as_deref(), Some("p1"));
        assert_eq!(out[0].reason, "title");
    }

    #[test]
    fn title_match_is_whole_word_only() {
        // "Javascript" should NOT match project "Java"
        let projects = vec![proj("p1", "Java", "")];
        let convs = vec![conv("c1", "Javascript closures", "")];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(out[0].project_uuid, None);
        assert_eq!(out[0].reason, "none");
    }

    #[test]
    fn keyword_coverage_match() {
        let prompt = "DJ controller CDJS mixer house music recordbox vinyl tracks beatmatching";
        let projects = vec![
            proj("p1", "Beach stage", prompt),
            proj("p2", "Cooking", "recipes ingredients pasta sauce kitchen"),
        ];
        let convs = vec![conv(
            "c1",
            "Untitled",
            "How do I beatmatch tracks on my CDJS mixer for a house music set",
        )];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(out[0].project_uuid.as_deref(), Some("p1"));
        assert_eq!(out[0].reason, "keywords");
    }

    #[test]
    fn too_short_chat_returns_none() {
        // 2-token chat ("Recipe ideas" — both pass len ≥ 4 but only 2 tokens) is
        // below MIN_CHAT_TOKENS, so keyword scoring is skipped.
        let projects = vec![proj("p1", "Java", "object oriented programming jvm collections")];
        let convs = vec![conv("c1", "Quick", "help")];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(out[0].project_uuid, None);
        assert_eq!(out[0].reason, "none");
    }

    #[test]
    fn ambiguous_chat_returns_none_without_margin() {
        // Chat tokens overlap two projects roughly equally → margin rule rejects.
        let projects = vec![
            proj("p1", "Frontend", "react component javascript browser typescript"),
            proj("p2", "Backend", "react component javascript browser typescript"),
        ];
        let convs = vec![conv(
            "c1",
            "Untitled",
            "javascript typescript react component browser question",
        )];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(out[0].project_uuid, None, "ambiguous chat should not be auto-assigned");
        assert_eq!(out[0].reason, "none");
    }

    #[test]
    fn memory_contributes_to_keyword_match() {
        // Project has a generic name/prompt but rich memory.
        let projects = vec![proj("p1", "Lab notes", "general notes scratchpad")];
        let mut memories = HashMap::new();
        memories.insert(
            "p1".to_string(),
            "Photovoltaic perovskite solar cells hysteresis bandgap tandem".to_string(),
        );
        let convs = vec![conv(
            "c1",
            "Question",
            "What causes hysteresis in perovskite tandem solar cells",
        )];
        let out = suggest_project_for_conversations(&convs, &projects, &memories);
        assert_eq!(out[0].project_uuid.as_deref(), Some("p1"));
        assert_eq!(out[0].reason, "keywords");
    }

    #[test]
    fn no_match_returns_none() {
        let projects = vec![proj("p1", "Java", "object oriented programming jvm")];
        let convs = vec![conv("c1", "Recipe ideas", "What can I cook with leftover rice")];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(out[0].project_uuid, None);
        assert_eq!(out[0].reason, "none");
    }
}
