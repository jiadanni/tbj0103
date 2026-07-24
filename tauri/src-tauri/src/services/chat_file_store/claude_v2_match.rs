// Suggest a target project for each orphan Claude conversation.
//
// Claude Desktop's v2 export strips the project link from conversations.json
// (every chat has `project: null`). The only remaining signals are the chat's
// title, its first user message, and the project's name + prompt_template.
//
// Two strategies, selected at call time:
//   - Keyword coverage (fast, no Ollama required): used during the initial
//     scan, or as a fallback when Ollama is unreachable.
//   - LLM classification (accurate): triggered on demand from the import UI.
//     The LLM receives a numbered project list and assigns each conversation
//     to a project number (or 0 = no match). Batched in groups of 10.
//
// The frontend shows all suggestions and the user confirms before import —
// we never auto-route.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use super::{ClaudeConversationPreview, ClaudeProjectPreview};

#[derive(Debug, Clone, Serialize)]
pub struct MatchSuggestion {
    pub conversation_uuid: String,
    pub project_uuid: Option<String>,
    pub score: f32,
    pub reason: &'static str, // "title" | "keywords" | "topics" | "llm" | "none"
}

/// Minimum fraction of the chat's *IDF mass* that must be covered by the winning
/// project's vocabulary. Coverage = Σidf(chat ∩ project) / Σidf(chat), so a chat
/// that matches one rare, discriminative term scores higher than one matching
/// three terms every project shares. Insensitive to project vocabulary size.
const COVERAGE_MIN: f32 = 0.25;
/// The top-scoring project must beat the runner-up by at least this margin,
/// otherwise the chat is generic enough to overlap multiple projects equally
/// and assigning it to any one would be a guess.
const MARGIN_MIN: f32 = 0.08;
/// Chats with fewer significant tokens than this are too short to discriminate.
const MIN_CHAT_TOKENS: usize = 4;
const MIN_TOKEN_LEN: usize = 4;
/// Project names shorter than this are too generic to trust as a title match
/// ("40", "Misc"). They still participate in keyword/topic scoring.
const MIN_TITLE_MATCH_NAME_LEN: usize = 4;
/// Weight applied to tokens sourced from an LLM-generated topic list. Topics are
/// distilled and on-topic by construction, unlike prompt boilerplate, so a topic
/// hit is stronger evidence than a prompt-text hit.
const TOPIC_WEIGHT: f32 = 1.6;
/// How many leading user messages contribute to a chat's matchable text. Chats
/// that open with "quick question" need more than the first turn to score.
const CHAT_CONTEXT_MESSAGES: usize = 3;
/// Character budget for the concatenated chat context.
const CHAT_CONTEXT_CHARS: usize = 700;

/// A project's matchable vocabulary: base tokens (name/prompt/description/memory)
/// and, when available, LLM-distilled topic tokens which score at `TOPIC_WEIGHT`.
struct ProjectVocab {
    uuid: String,
    base: HashSet<String>,
    topics: HashSet<String>,
}

impl ProjectVocab {
    fn is_empty(&self) -> bool {
        self.base.is_empty() && self.topics.is_empty()
    }

    /// Weight for a chat token against this project: topic hits outrank base hits,
    /// and a token present in both counts once at the higher weight.
    fn weight_for(&self, token: &str) -> f32 {
        if self.topics.contains(token) {
            TOPIC_WEIGHT
        } else if self.base.contains(token) {
            1.0
        } else {
            0.0
        }
    }
}

pub fn suggest_project_for_conversations(
    conversations: &[ClaudeConversationPreview],
    projects: &[ClaudeProjectPreview],
    memories_by_project: &HashMap<String, String>,
) -> Vec<MatchSuggestion> {
    suggest_project_for_conversations_with_topics(
        conversations,
        projects,
        memories_by_project,
        &HashMap::new(),
    )
}

/// As `suggest_project_for_conversations`, but with an optional per-project topic
/// list (project UUID → topic terms) produced by `generate_project_topics`.
///
/// Topics are additive: when absent for a project, that project scores exactly as
/// it would without them, so matching degrades cleanly if Ollama is unavailable.
pub fn suggest_project_for_conversations_with_topics(
    conversations: &[ClaudeConversationPreview],
    projects: &[ClaudeProjectPreview],
    memories_by_project: &HashMap<String, String>,
    topics_by_project: &HashMap<String, Vec<String>>,
) -> Vec<MatchSuggestion> {
    let vocabs = build_vocabs(projects, memories_by_project, topics_by_project);

    // Inverse document frequency over the project pool. A token in 1 of 20
    // projects is discriminative; one in 18 of 20 is scaffolding ("assistant",
    // "code", "explain") and must not decide the match. This is what stops a
    // project with a long prompt from absorbing unrelated chats by surface area.
    let idf = build_idf(&vocabs);

    let title_candidates = title_match_candidates(projects);

    conversations
        .iter()
        .map(|conv| score_conversation(conv, &title_candidates, &vocabs, &idf))
        .collect()
}

fn build_vocabs(
    projects: &[ClaudeProjectPreview],
    memories_by_project: &HashMap<String, String>,
    topics_by_project: &HashMap<String, Vec<String>>,
) -> Vec<ProjectVocab> {
    projects
        .iter()
        .map(|p| {
            let memory = memories_by_project
                .get(&p.uuid)
                .map(String::as_str)
                .unwrap_or("");
            let mut text = String::with_capacity(
                p.name.len() + p.prompt_template.len() + p.description.len() + memory.len() + 3,
            );
            // Include the project name so that projects with empty prompts still
            // match conversations that mention the topic by name.
            text.push_str(&p.name);
            text.push(' ');
            text.push_str(&p.prompt_template);
            text.push(' ');
            text.push_str(&p.description);
            text.push(' ');
            text.push_str(memory);

            let topics = topics_by_project
                .get(&p.uuid)
                .map(|ts| tokenize(&ts.join(" ")))
                .unwrap_or_default();

            ProjectVocab {
                uuid: p.uuid.clone(),
                base: tokenize(&text),
                topics,
            }
        })
        .collect()
}

/// Project names eligible for whole-word title matching, longest first so that
/// "Java Advanced" wins over "Java" instead of the winner depending on
/// `read_dir` order.
fn title_match_candidates(projects: &[ClaudeProjectPreview]) -> Vec<(String, String)> {
    let mut candidates: Vec<(String, String)> = projects
        .iter()
        .map(|p| (p.uuid.clone(), p.name.trim().to_lowercase()))
        .filter(|(_, name)| name.chars().count() >= MIN_TITLE_MATCH_NAME_LEN)
        .collect();
    candidates.sort_by(|a, b| b.1.chars().count().cmp(&a.1.chars().count()));
    candidates
}

/// idf(t) = ln(1 + N / df(t)), computed over base ∪ topic vocabulary.
fn build_idf(vocabs: &[ProjectVocab]) -> HashMap<String, f32> {
    let n = vocabs.len().max(1) as f32;
    let mut df: HashMap<String, usize> = HashMap::new();
    for v in vocabs {
        // Count each token once per project, regardless of which source it came from.
        for token in v.base.union(&v.topics) {
            *df.entry(token.clone()).or_insert(0) += 1;
        }
    }
    df.into_iter()
        .map(|(token, count)| {
            let idf = (1.0 + n / count as f32).ln();
            (token, idf)
        })
        .collect()
}

fn score_conversation(
    conv: &ClaudeConversationPreview,
    title_candidates: &[(String, String)],
    vocabs: &[ProjectVocab],
    idf: &HashMap<String, f32>,
) -> MatchSuggestion {
    score_conversation_inner(conv, title_candidates, vocabs, idf, COVERAGE_MIN, MARGIN_MIN)
}

fn score_conversation_inner(
    conv: &ClaudeConversationPreview,
    title_candidates: &[(String, String)],
    vocabs: &[ProjectVocab],
    idf: &HashMap<String, f32>,
    coverage_min: f32,
    margin_min: f32,
) -> MatchSuggestion {
    let title_lower = conv.name.trim().to_lowercase();

    // 1. Title-substring match: project name appears as a whole word in the title.
    if !title_lower.is_empty() {
        for (uuid, name_lower) in title_candidates {
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

    // 2. IDF-weighted coverage: what share of the chat's discriminative mass does
    //    each project's vocabulary account for?
    let chat_tokens = tokenize(&chat_context_text(conv));
    let chat_n = chat_tokens.len();
    if chat_n < MIN_CHAT_TOKENS {
        return no_match(conv);
    }

    // Denominator: total IDF mass of the chat. Unknown tokens (present in no
    // project) still count against coverage — a chat that is mostly off-topic
    // for every project should not score highly for the one word it shares.
    let total_mass: f32 = chat_tokens
        .iter()
        .map(|t| idf.get(t).copied().unwrap_or_else(|| unknown_token_idf(vocabs)))
        .sum();
    if total_mass <= 0.0 {
        return no_match(conv);
    }

    let mut scored: Vec<(&str, f32, bool)> = Vec::with_capacity(vocabs.len());
    for vocab in vocabs {
        if vocab.is_empty() {
            continue;
        }
        let mut matched_mass = 0.0f32;
        let mut hit_topic = false;
        for token in &chat_tokens {
            let w = vocab.weight_for(token);
            if w > 0.0 {
                if w > 1.0 {
                    hit_topic = true;
                }
                matched_mass += w * idf.get(token).copied().unwrap_or(0.0);
            }
        }
        // TOPIC_WEIGHT can push coverage above 1.0; clamp so the threshold and
        // margin comparisons stay on a 0..1 scale.
        let coverage = (matched_mass / total_mass).min(1.0);
        scored.push((vocab.uuid.as_str(), coverage, hit_topic));
    }

    // Sort descending and take the top two. Doing this explicitly (rather than
    // tracking best/runner-up inline) keeps the margin check correct when two
    // projects tie exactly — previously a tie left runner_up at 0.0 and the
    // ambiguity guard failed open, confidently assigning the coin-flip winner.
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let Some(&(top_uuid, top_score, top_hit_topic)) = scored.first() else {
        return no_match(conv);
    };
    let runner_up = scored.get(1).map(|s| s.1).unwrap_or(0.0);

    if top_score >= coverage_min && (top_score - runner_up) >= margin_min {
        return MatchSuggestion {
            conversation_uuid: conv.uuid.clone(),
            project_uuid: Some(top_uuid.to_string()),
            score: top_score.min(0.85),
            reason: if top_hit_topic { "topics" } else { "keywords" },
        };
    }

    no_match(conv)
}

fn no_match(conv: &ClaudeConversationPreview) -> MatchSuggestion {
    MatchSuggestion {
        conversation_uuid: conv.uuid.clone(),
        project_uuid: None,
        score: 0.0,
        reason: "none",
    }
}

/// IDF for a token that appears in no project's vocabulary. Treated as maximally
/// rare (df = 1) so off-topic chat text dilutes coverage rather than being free.
fn unknown_token_idf(vocabs: &[ProjectVocab]) -> f32 {
    (1.0 + vocabs.len().max(1) as f32).ln()
}

/// Text used to represent a chat for matching: title plus the first few user
/// messages, capped. Falls back to `first_user_message` when the full transcript
/// isn't loaded (the LLM command reconstructs previews without `messages`).
fn chat_context_text(conv: &ClaudeConversationPreview) -> String {
    let mut out = String::with_capacity(conv.name.len() + CHAT_CONTEXT_CHARS);
    out.push_str(&conv.name);

    let mut budget = CHAT_CONTEXT_CHARS;
    let mut taken = 0usize;
    for msg in conv.messages.iter().filter(|m| m.role == "user") {
        if taken >= CHAT_CONTEXT_MESSAGES || budget == 0 {
            break;
        }
        out.push(' ');
        for ch in msg.content.chars().take(budget) {
            out.push(ch);
            budget -= 1;
        }
        taken += 1;
    }

    if taken == 0 && !conv.first_user_message.is_empty() {
        out.push(' ');
        out.push_str(&conv.first_user_message);
    }

    out
}

// ── Topic distillation ───────────────────────────────────────────────────────

/// Max projects described in a single topic-generation call.
const TOPIC_BATCH_SIZE: usize = 5;
/// Character budget per project for the source text sent to the model.
const TOPIC_SOURCE_CHARS: usize = 1200;
/// Upper bound on topics kept per project.
const MAX_TOPICS_PER_PROJECT: usize = 30;

/// Distil each project's prompt/description/memory into a list of topic terms.
///
/// This is the cheap half of the cost asymmetry: a Claude export has ~20 projects
/// but can have ~1000 conversations, so paying for inference on the *project*
/// side costs a handful of calls, while the per-chat matching stays deterministic.
///
/// Two effects on match quality:
///   - Denoising: replaces several hundred tokens of instruction boilerplate
///     ("you are an assistant that…", "always format…") with a few dozen
///     on-topic terms, so a verbose project stops absorbing unrelated chats.
///   - Expansion: the model names adjacent vocabulary the source text never
///     spells out, so a DJing project can match "mixer" or "beatmatching"
///     without those words appearing in its prompt.
///
/// Returns project UUID → topic terms. Projects the model fails on are simply
/// absent from the map; matching then falls back to their base vocabulary.
pub async fn generate_project_topics(
    projects: &[ClaudeProjectPreview],
    memories_by_project: &HashMap<String, String>,
    ollama: &crate::ollama::client::OllamaClient,
    model: &str,
) -> HashMap<String, Vec<String>> {
    use crate::ollama::client::OllamaMessage;

    const SYSTEM_PROMPT: &str = "You extract topic keywords that describe what a project is about.\n\
         For each numbered project, reply with ONE line in this exact format:\n\
         <project_number>: term, term, term\n\
         Give 10-25 lowercase terms per project: subject areas, technologies, tools, \
         and domain vocabulary someone would actually use when chatting about it. \
         Include closely related terms even if not present in the source text. \
         Ignore instructions about tone, formatting, or response style — describe the \
         SUBJECT, not how to answer. No explanations, no extra lines.";

    let mut out: HashMap<String, Vec<String>> = HashMap::new();

    for chunk in projects.chunks(TOPIC_BATCH_SIZE) {
        let mut user_msg = String::new();
        for (i, proj) in chunk.iter().enumerate() {
            let memory = memories_by_project
                .get(&proj.uuid)
                .map(String::as_str)
                .unwrap_or("");
            let source: String = format!("{} {} {}", proj.prompt_template, proj.description, memory)
                .chars()
                .take(TOPIC_SOURCE_CHARS)
                .collect();
            user_msg.push_str(&format!(
                "{}. Name: \"{}\"\nSource: {}\n\n",
                i + 1,
                proj.name.replace('"', "'"),
                if source.trim().is_empty() {
                    "(no description)"
                } else {
                    source.trim()
                },
            ));
        }

        let messages = vec![
            OllamaMessage {
                role: "system".to_string(),
                content: SYSTEM_PROMPT.to_string(),
            },
            OllamaMessage {
                role: "user".to_string(),
                content: user_msg.trim_end().to_string(),
            },
        ];

        let Ok(reply) = ollama
            .send_message_with_options("claude_import_topics", model, messages, Some("5m"))
            .await
        else {
            // A failed batch just means those projects match on base vocabulary.
            continue;
        };

        for line in reply.lines() {
            let line = line.trim();
            let Some((left, right)) = line.split_once(':') else {
                continue;
            };
            let Ok(batch_pos) = left.trim().parse::<usize>() else {
                continue;
            };
            let Some(proj) = batch_pos.checked_sub(1).and_then(|i| chunk.get(i)) else {
                continue;
            };
            let terms: Vec<String> = right
                .split(',')
                .filter_map(|t| {
                    let term = t.trim().trim_matches(['"', '*', '-', '.']).to_lowercase();
                    if term.is_empty() || term.chars().count() > 40 {
                        return None;
                    }
                    Some(term)
                })
                .take(MAX_TOPICS_PER_PROJECT)
                .collect();
            if !terms.is_empty() {
                out.insert(proj.uuid.clone(), terms);
            }
        }
    }

    out
}

// ── LLM-based classifier ─────────────────────────────────────────────────────

const LLM_BATCH_SIZE: usize = 10;

/// Suggest projects using an LLM chat model.
///
/// Projects are numbered 1..N. For each batch of conversations the LLM
/// receives a system prompt listing all projects, then a user message with
/// the conversation titles + first messages. It replies with one line per
/// conversation: `<conv_index>: <project_number>` (or 0 for no match).
///
/// Falls back to keyword matcher for any conversation the LLM response
/// cannot be parsed for, or if the Ollama call fails entirely.
pub async fn suggest_project_with_llm(
    conversations: &[ClaudeConversationPreview],
    projects: &[ClaudeProjectPreview],
    memories_by_project: &HashMap<String, String>,
    ollama: &crate::ollama::client::OllamaClient,
    model: &str,
) -> Vec<MatchSuggestion> {
    use crate::ollama::client::OllamaMessage;

    // Title-match lookup — same fast pre-pass as the keyword path.
    let title_candidates = title_match_candidates(projects);

    // Build the numbered project list for the system prompt (once, reused for every batch).
    let mut project_list = String::new();
    for (i, proj) in projects.iter().enumerate() {
        let memory = memories_by_project
            .get(&proj.uuid)
            .map(String::as_str)
            .unwrap_or("");
        // Truncate prompt + memory so the context doesn't blow up.
        let context: String = format!("{} {} {}", proj.prompt_template, proj.description, memory)
            .chars()
            .take(300)
            .collect();
        project_list.push_str(&format!(
            "{}. {}{}\n",
            i + 1,
            proj.name,
            if context.trim().is_empty() {
                String::new()
            } else {
                format!(" — {}", context.trim())
            },
        ));
    }

    let system_prompt = format!(
        "You are categorising imported AI chat conversations into projects.\n\
         Reply with ONLY one line per conversation in this exact format:\n\
         <conversation_number>: <project_number>\n\
         Use 0 if no project is a good fit. No explanations.\n\n\
         Projects:\n{}",
        project_list.trim_end()
    );

    // Pre-allocate results; we fill in as we process.
    let mut results: Vec<Option<MatchSuggestion>> = vec![None; conversations.len()];

    // Title-match pass first (cheap, no LLM needed).
    let mut needs_llm: Vec<usize> = Vec::new();
    for (idx, conv) in conversations.iter().enumerate() {
        let title_lower = conv.name.trim().to_lowercase();
        if !title_lower.is_empty() {
            let mut hit = None;
            for (uuid, name_lower) in &title_candidates {
                if contains_whole_word(&title_lower, name_lower) {
                    hit = Some(uuid.clone());
                    break;
                }
            }
            if let Some(uuid) = hit {
                results[idx] = Some(MatchSuggestion {
                    conversation_uuid: conv.uuid.clone(),
                    project_uuid: Some(uuid),
                    score: 0.9,
                    reason: "title",
                });
                continue;
            }
        }
        needs_llm.push(idx);
    }

    // LLM pass — batched.
    let mut llm_failed = false;
    for chunk in needs_llm.chunks(LLM_BATCH_SIZE) {
        if llm_failed { break; }

        // Build the user message listing conversations in this batch.
        let mut user_msg = String::new();
        for (batch_pos, &conv_idx) in chunk.iter().enumerate() {
            let conv = &conversations[conv_idx];
            let first_msg: String = conv.first_user_message.chars().take(200).collect();
            user_msg.push_str(&format!(
                "{}. Title: \"{}\" | First message: \"{}\"\n",
                batch_pos + 1,
                conv.name.replace('"', "'"),
                first_msg.replace('"', "'"),
            ));
        }

        let messages = vec![
            OllamaMessage { role: "system".to_string(), content: system_prompt.clone() },
            OllamaMessage { role: "user".to_string(), content: user_msg.trim_end().to_string() },
        ];

        match ollama
            .send_message_with_options("claude_import_match", model, messages, Some("5m"))
            .await
        {
            Ok(reply) => {
                // Parse lines of the form "<n>: <m>".
                let mut parsed: HashMap<usize, usize> = HashMap::new();
                for line in reply.lines() {
                    let line = line.trim();
                    if let Some((left, right)) = line.split_once(':') {
                        if let (Ok(batch_pos), Ok(proj_num)) = (
                            left.trim().parse::<usize>(),
                            right.trim().parse::<usize>(),
                        ) {
                            parsed.insert(batch_pos, proj_num);
                        }
                    }
                }
                for (batch_pos, &conv_idx) in chunk.iter().enumerate() {
                    let conv = &conversations[conv_idx];
                    let proj_num = parsed.get(&(batch_pos + 1)).copied().unwrap_or(0);
                    if proj_num >= 1 && proj_num <= projects.len() {
                        let proj = &projects[proj_num - 1];
                        results[conv_idx] = Some(MatchSuggestion {
                            conversation_uuid: conv.uuid.clone(),
                            project_uuid: Some(proj.uuid.clone()),
                            score: 0.8,
                            reason: "llm",
                        });
                    } else {
                        // LLM said no match (0) or parse failed — keyword fallback per conv.
                        let kw = suggest_project_for_conversations(
                            std::slice::from_ref(conv),
                            projects,
                            memories_by_project,
                        );
                        results[conv_idx] = kw.into_iter().next();
                    }
                }
            }
            Err(_) => {
                llm_failed = true;
            }
        }
    }

    // If the LLM failed entirely, fall back to keyword matcher for everything that wasn't title-matched.
    if llm_failed {
        let remaining_indices: Vec<usize> = needs_llm
            .iter()
            .copied()
            .filter(|&i| results[i].is_none())
            .collect();
        let remaining: Vec<ClaudeConversationPreview> = remaining_indices
            .iter()
            .map(|&i| conversations[i].clone())
            .collect();
        let fallback =
            suggest_project_for_conversations(&remaining, projects, memories_by_project);
        for (fb, &conv_idx) in fallback.into_iter().zip(remaining_indices.iter()) {
            results[conv_idx] = Some(fb);
        }
    }

    // Any remaining None slots (shouldn't happen) get a no-match entry.
    conversations
        .iter()
        .enumerate()
        .map(|(i, conv)| {
            results[i].take().unwrap_or(MatchSuggestion {
                conversation_uuid: conv.uuid.clone(),
                project_uuid: None,
                score: 0.0,
                reason: "none",
            })
        })
        .collect()
}

fn contains_whole_word(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() || needle.len() > haystack.len() {
        return false;
    }
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
            if lower.len() < MIN_TOKEN_LEN {
                return None;
            }
            if is_stopword(&lower) {
                return None;
            }
            Some(lower)
        })
        .collect()
}

fn is_stopword(w: &str) -> bool {
    matches!(
        w,
        "this"
            | "that"
            | "with"
            | "from"
            | "have"
            | "been"
            | "were"
            | "their"
            | "they"
            | "them"
            | "would"
            | "could"
            | "should"
            | "what"
            | "when"
            | "where"
            | "which"
            | "while"
            | "your"
            | "yours"
            | "about"
            | "into"
            | "than"
            | "then"
            | "there"
            | "these"
            | "those"
            | "some"
            | "such"
            | "only"
            | "very"
            | "much"
            | "many"
            | "more"
            | "most"
            | "also"
            | "after"
            | "before"
            | "between"
            | "because"
            | "being"
            | "doing"
            | "does"
            | "done"
            | "just"
            | "like"
            | "make"
            | "made"
            | "want"
            | "will"
            | "well"
            | "over"
            | "under"
            | "above"
            | "below"
            | "again"
            | "ever"
            | "every"
            | "each"
            | "other"
            | "another"
            | "even"
            | "here"
            | "hers"
            | "himself"
            | "herself"
            | "itself"
            | "yourself"
            | "ourselves"
            | "myself"
            | "always"
            | "really"
            | "still"
            | "back"
            | "down"
            | "onto"
            | "upon"
            | "around"
            | "through"
            | "without"
            | "within"
            | "must"
            | "shall"
            | "thing"
            | "things"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    use super::super::ClaudeMessagePreview;

    fn conv(uuid: &str, name: &str, msg: &str) -> ClaudeConversationPreview {
        ClaudeConversationPreview {
            uuid: uuid.to_string(),
            name: name.to_string(),
            message_count: 1,
            created_at: String::new(),
            updated_at: String::new(),
            project_uuid: None,
            first_user_message: msg.to_string(),
            messages: vec![],
        }
    }

    /// Conversation carrying a full transcript, as produced by a real scan.
    fn conv_with_messages(uuid: &str, name: &str, turns: &[(&str, &str)]) -> ClaudeConversationPreview {
        let messages: Vec<ClaudeMessagePreview> = turns
            .iter()
            .map(|(role, content)| ClaudeMessagePreview {
                role: role.to_string(),
                content: content.to_string(),
            })
            .collect();
        let first_user_message = turns
            .iter()
            .find(|(r, _)| *r == "user")
            .map(|(_, c)| c.to_string())
            .unwrap_or_default();
        ClaudeConversationPreview {
            uuid: uuid.to_string(),
            name: name.to_string(),
            message_count: messages.len(),
            created_at: String::new(),
            updated_at: String::new(),
            project_uuid: None,
            first_user_message,
            messages,
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
        let projects = vec![proj("p1", "Java", ""), proj("p2", "Dutch", "")];
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
        let projects = vec![proj(
            "p1",
            "Java",
            "object oriented programming jvm collections",
        )];
        let convs = vec![conv("c1", "Quick", "help")];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(out[0].project_uuid, None);
        assert_eq!(out[0].reason, "none");
    }

    #[test]
    fn ambiguous_chat_returns_none_without_margin() {
        // Chat tokens overlap two projects roughly equally → margin rule rejects.
        let projects = vec![
            proj(
                "p1",
                "Frontend",
                "react component javascript browser typescript",
            ),
            proj(
                "p2",
                "Backend",
                "react component javascript browser typescript",
            ),
        ];
        let convs = vec![conv(
            "c1",
            "Untitled",
            "javascript typescript react component browser question",
        )];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(
            out[0].project_uuid, None,
            "ambiguous chat should not be auto-assigned"
        );
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
        let convs = vec![conv(
            "c1",
            "Recipe ideas",
            "What can I cook with leftover rice",
        )];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(out[0].project_uuid, None);
        assert_eq!(out[0].reason, "none");
    }

    #[test]
    fn exact_tie_is_not_assigned() {
        // Two projects scoring identically is the ambiguity MARGIN_MIN exists to
        // catch. Guards the sort-based top/runner-up selection, which replaced
        // equivalent inline tracking — behaviour here must not drift.
        // Distinct vocabularies, each covering exactly half the chat's tokens.
        let projects = vec![
            proj("p1", "Alpha", "kubernetes helm ingress"),
            proj("p2", "Bravo", "postgres replication vacuum"),
        ];
        let convs = vec![conv(
            "c1",
            "Infra question",
            "kubernetes helm ingress postgres replication vacuum",
        )];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(
            out[0].project_uuid, None,
            "an exact tie must fall through to Unassigned, not pick a winner"
        );
        assert_eq!(out[0].reason, "none");
    }

    #[test]
    fn longest_project_name_wins_title_match() {
        // "Java Advanced" is more specific than "Java"; ordering in the projects
        // vec (which mirrors read_dir order in production) must not decide it.
        let projects = vec![proj("p1", "Java", ""), proj("p2", "Java Advanced", "")];
        let convs = vec![conv("c1", "Java Advanced generics deep dive", "")];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(out[0].project_uuid.as_deref(), Some("p2"));
        assert_eq!(out[0].reason, "title");

        // Reversed input order must produce the same winner.
        let reversed = vec![proj("p2", "Java Advanced", ""), proj("p1", "Java", "")];
        let out = suggest_project_for_conversations(&convs, &reversed, &HashMap::new());
        assert_eq!(out[0].project_uuid.as_deref(), Some("p2"));
    }

    #[test]
    fn short_generic_project_name_does_not_title_match() {
        // A project literally named "40" must not claim every chat with "40" in
        // the title at score 0.9.
        let projects = vec![proj("p1", "40", "")];
        let convs = vec![conv("c1", "Top 40 chart history", "")];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(out[0].project_uuid, None);
    }

    #[test]
    fn idf_downweights_vocabulary_shared_by_every_project() {
        // Every project talks about "programming/code/debugging"; only one is
        // about perovskite solar cells. A chat using the shared scaffolding plus
        // one rare term must land on the project owning the rare term.
        let shared = "programming code debugging software";
        let projects = vec![
            proj("p1", "Alpha", &format!("{shared} frontend layout")),
            proj("p2", "Bravo", &format!("{shared} database indexes")),
            proj("p3", "Charlie", &format!("{shared} perovskite photovoltaics")),
        ];
        let convs = vec![conv(
            "c1",
            "Question",
            "debugging code software perovskite behaviour",
        )];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(
            out[0].project_uuid.as_deref(),
            Some("p3"),
            "the rare discriminative term should decide the match"
        );
    }

    #[test]
    fn verbose_project_does_not_absorb_unrelated_chat() {
        // Mirrors the observed failure: a long-prompt project ("Beach stage")
        // swallowing an unrelated chat ("Bauxite import and export process")
        // purely through vocabulary surface area.
        let verbose = "dj controller cdjs mixer house music recordbox vinyl tracks beatmatching \
                       decks headphones speakers monitors cables adapters lighting festival \
                       booking promoter setlist crowd energy transitions harmonic mixing keys \
                       tempo phrasing loops cues samples effects reverb delay filter";
        let projects = vec![
            proj("p1", "Beach stage", verbose),
            proj("p2", "Minerals", "bauxite alumina refining smelting ore export tariffs"),
        ];
        let convs = vec![conv(
            "c1",
            "Bauxite import and export process",
            "How does bauxite ore get refined into alumina before export",
        )];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(out[0].project_uuid.as_deref(), Some("p2"));
    }

    #[test]
    fn topics_expand_matching_beyond_source_text() {
        // The project's prompt never says "mixer" or "beatmatching"; the topic
        // list supplies that vocabulary, so the chat matches on expansion alone.
        let projects = vec![
            proj("p1", "Beach stage", "weekend sets at the shore"),
            proj("p2", "Taxes", "self assessment deductions receipts invoices"),
        ];
        let mut topics = HashMap::new();
        topics.insert(
            "p1".to_string(),
            vec![
                "mixer".to_string(),
                "beatmatching".to_string(),
                "turntable".to_string(),
                "house music".to_string(),
            ],
        );
        let convs = vec![conv(
            "c1",
            "Xone 92 mixer technical exploration",
            "Comparing beatmatching on a turntable setup",
        )];

        let without = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(
            without[0].project_uuid, None,
            "precondition: unmatched without topics"
        );

        let with = suggest_project_for_conversations_with_topics(
            &convs,
            &projects,
            &HashMap::new(),
            &topics,
        );
        assert_eq!(with[0].project_uuid.as_deref(), Some("p1"));
        assert_eq!(with[0].reason, "topics");
    }

    #[test]
    fn absent_topics_leave_scoring_unchanged() {
        // Topic support must be strictly additive: a project with no topics
        // scores exactly as it did before, so an Ollama failure degrades cleanly.
        let projects = vec![
            proj("p1", "Beach stage", "dj controller cdjs mixer house music recordbox"),
            proj("p2", "Cooking", "recipes ingredients pasta sauce kitchen"),
        ];
        let convs = vec![conv(
            "c1",
            "Untitled",
            "How do I beatmatch tracks on my CDJS mixer for a house music set",
        )];
        let base = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        let empty_topics = suggest_project_for_conversations_with_topics(
            &convs,
            &projects,
            &HashMap::new(),
            &HashMap::new(),
        );
        assert_eq!(base[0].project_uuid, empty_topics[0].project_uuid);
        assert_eq!(base[0].reason, empty_topics[0].reason);
    }

    #[test]
    fn later_user_messages_rescue_a_vague_opener() {
        // "2nd brains"-style opener: too short to score on its own, but the
        // following user turns carry the discriminative vocabulary.
        let projects = vec![
            proj("p1", "Notes", "obsidian logseq zettelkasten markdown backlinks linking"),
            proj("p2", "Fitness", "squat deadlift macros protein training programme"),
        ];
        let vague = conv("c1", "Chat", "quick q");
        let out = suggest_project_for_conversations(&[vague], &projects, &HashMap::new());
        assert_eq!(
            out[0].project_uuid, None,
            "precondition: first message alone is too thin"
        );

        let rich = conv_with_messages(
            "c1",
            "Chat",
            &[
                ("user", "quick q"),
                ("assistant", "Sure, what's up?"),
                (
                    "user",
                    "comparing obsidian and logseq for zettelkasten backlinks in markdown",
                ),
            ],
        );
        let out = suggest_project_for_conversations(&[rich], &projects, &HashMap::new());
        assert_eq!(out[0].project_uuid.as_deref(), Some("p1"));
    }

    #[test]
    fn chat_context_prefers_transcript_but_falls_back() {
        // The LLM command rebuilds previews without `messages`; that path must
        // still see the first user message.
        let no_transcript = conv("c1", "Title here", "body text about kubernetes");
        assert!(chat_context_text(&no_transcript).contains("kubernetes"));

        let with_transcript = conv_with_messages(
            "c2",
            "Title here",
            &[("user", "body text about kubernetes"), ("user", "and helm")],
        );
        let text = chat_context_text(&with_transcript);
        assert!(text.contains("kubernetes") && text.contains("helm"));
    }
}
