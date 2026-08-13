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

/// Result of `generate_project_topics`, carrying failure stats so callers can
/// surface degraded batches instead of silently falling back.
pub struct TopicGenerationOutcome {
    /// Project UUID → distilled topic terms. Projects from failed batches are
    /// simply absent and match on base vocabulary.
    pub topics: HashMap<String, Vec<String>>,
    pub batches_total: usize,
    pub batches_failed: usize,
    /// Error string from the last failed Ollama call, if any.
    pub last_error: Option<String>,
}

/// Result of `suggest_project_with_llm`. `suggestions` always covers every
/// input conversation — conversations from batches after `llm_error` occurred
/// carry keyword-fallback suggestions instead of LLM ones.
pub struct LlmMatchOutcome {
    pub suggestions: Vec<MatchSuggestion>,
    pub batches_total: usize,
    /// LLM batches that completed before an error (or all of them on success).
    pub batches_completed: usize,
    /// Error string from the Ollama call that aborted the LLM pass, if any.
    pub llm_error: Option<String>,
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
/// Weight applied to *discriminative* tokens from an LLM-generated topic list.
/// Topics are distilled and on-topic, so a topic hit is stronger evidence than a
/// prompt-text hit — but only when the term actually separates projects. See
/// `TOPIC_BOOST_MAX_DF_RATIO`.
const TOPIC_WEIGHT: f32 = 1.6;
/// A topic term is only boosted when it appears in at most this fraction of
/// projects. Distilling ~20 projects of one person's life produces recurring
/// cross-cutting terms — locations they live ("amsterdam"), their field
/// ("software engineering") — which describe the *user*, not any one project.
/// Boosting those amplifies precisely what IDF exists to suppress, and was the
/// mechanism behind off-topic matches (a peak-oil chat landing in a driving
/// project on shared "netherlands" mass). Above this ratio a topic term still
/// counts, at plain base weight.
const TOPIC_BOOST_MAX_DF_RATIO: f32 = 0.25;
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
    /// Divisor applied to this project's matched mass, damping projects whose
    /// vocabulary is far larger than the pool median. See `build_vocabs`.
    breadth_damping: f32,
}

impl ProjectVocab {
    fn is_empty(&self) -> bool {
        self.base.is_empty() && self.topics.is_empty()
    }

    /// Weight for a chat token against this project. A topic hit outranks a base
    /// hit only when the term is discriminative (`boostable`); cross-cutting
    /// topic terms fall back to base weight so they can't dominate scoring.
    fn weight_for(&self, token: &str, boostable: &HashSet<String>) -> f32 {
        if self.topics.contains(token) {
            if boostable.contains(token) {
                TOPIC_WEIGHT
            } else {
                1.0
            }
        } else if self.base.contains(token) {
            1.0
        } else {
            0.0
        }
    }
}

/// Topic terms rare enough across the project pool to earn the topic boost.
fn boostable_topic_tokens(vocabs: &[ProjectVocab]) -> HashSet<String> {
    let n = vocabs.len().max(1) as f32;
    let mut df: HashMap<&str, usize> = HashMap::new();
    for v in vocabs {
        for token in &v.topics {
            *df.entry(token.as_str()).or_insert(0) += 1;
        }
    }
    df.into_iter()
        .filter(|(_, count)| (*count as f32 / n) <= TOPIC_BOOST_MAX_DF_RATIO)
        .map(|(token, _)| token.to_string())
        .collect()
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
    let boostable = boostable_topic_tokens(&vocabs);

    let title_candidates = title_match_candidates(projects);

    conversations
        .iter()
        .map(|conv| score_conversation(conv, &title_candidates, &vocabs, &idf, &boostable))
        .collect()
}

fn build_vocabs(
    projects: &[ClaudeProjectPreview],
    memories_by_project: &HashMap<String, String>,
    topics_by_project: &HashMap<String, Vec<String>>,
) -> Vec<ProjectVocab> {
    let mut vocabs: Vec<ProjectVocab> = projects
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
                breadth_damping: 1.0, // filled in below, once all sizes are known
            }
        })
        .collect();

    apply_breadth_damping(&mut vocabs);
    vocabs
}

/// Penalise projects whose vocabulary is far broader than the pool median.
///
/// IDF suppresses vocabulary *shared* across projects, but not vocabulary that
/// is merely voluminous and unique. A project whose instructions are a long
/// personal narrative rather than a topic description contributes hundreds of
/// df=1 tokens — each scoring maximum IDF — covering generic life and planning
/// vocabulary that appears in almost any reflective chat. Measured on a real
/// export: one project held 178 base tokens while 13 of 22 held 5 or fewer, and
/// it captured 255 of 539 matches, including chats about height loss, XSS, and
/// bitcoin.
///
/// Dividing matched mass by `(size / median)^0.5` removes that surface-area
/// advantage without punishing projects that are merely well-described: projects
/// at or below the median are untouched.
fn apply_breadth_damping(vocabs: &mut [ProjectVocab]) {
    let mut sizes: Vec<usize> = vocabs
        .iter()
        .map(|v| v.base.union(&v.topics).count())
        .collect();
    if sizes.is_empty() {
        return;
    }
    sizes.sort_unstable();
    let median = sizes[sizes.len() / 2].max(1) as f32;

    for v in vocabs.iter_mut() {
        let size = v.base.union(&v.topics).count().max(1) as f32;
        v.breadth_damping = if size > median {
            (size / median).sqrt()
        } else {
            1.0
        };
    }
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
    boostable: &HashSet<String>,
) -> MatchSuggestion {
    score_conversation_inner(
        conv,
        title_candidates,
        vocabs,
        idf,
        boostable,
        COVERAGE_MIN,
        MARGIN_MIN,
    )
}

#[allow(clippy::too_many_arguments)]
fn score_conversation_inner(
    conv: &ClaudeConversationPreview,
    title_candidates: &[(String, String)],
    vocabs: &[ProjectVocab],
    idf: &HashMap<String, f32>,
    boostable: &HashSet<String>,
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

    // 2. IDF-weighted coverage on the base text (title + transcript).
    if let Some(hit) = coverage_suggestion(
        conv,
        &chat_context_text(conv),
        vocabs,
        idf,
        boostable,
        coverage_min,
        margin_min,
    ) {
        return hit;
    }

    // 3. Summary rescue: the export's Claude-written overview is distilled,
    //    high-signal text, but its verbose prose dilutes IDF coverage when
    //    concatenated unconditionally — measured on a real 924-chat export,
    //    always-on summaries *lost* 53 previously-confident matches. So the
    //    summary only enters for chats the base text couldn't place, where a
    //    new confident match is a strict gain.
    let summary = conv.summary.trim();
    if !summary.is_empty() {
        let with_summary = format!("{} {}", chat_context_text(conv), summary);
        if let Some(hit) = coverage_suggestion(
            conv,
            &with_summary,
            vocabs,
            idf,
            boostable,
            coverage_min,
            margin_min,
        ) {
            return hit;
        }
    }

    no_match(conv)
}

/// IDF-weighted coverage scoring for one chat text against every project
/// vocabulary. Returns `None` unless one project passes both the coverage
/// threshold and the runner-up margin.
#[allow(clippy::too_many_arguments)]
fn coverage_suggestion(
    conv: &ClaudeConversationPreview,
    text: &str,
    vocabs: &[ProjectVocab],
    idf: &HashMap<String, f32>,
    boostable: &HashSet<String>,
    coverage_min: f32,
    margin_min: f32,
) -> Option<MatchSuggestion> {
    let chat_tokens = tokenize(text);
    let chat_n = chat_tokens.len();
    if chat_n < MIN_CHAT_TOKENS {
        return None;
    }

    // Denominator: total IDF mass of the chat. Unknown tokens (present in no
    // project) still count against coverage — a chat that is mostly off-topic
    // for every project should not score highly for the one word it shares.
    let total_mass: f32 = chat_tokens
        .iter()
        .map(|t| idf.get(t).copied().unwrap_or(UNKNOWN_TOKEN_IDF))
        .sum();
    if total_mass <= 0.0 {
        return None;
    }

    let mut scored: Vec<(&str, f32, bool)> = Vec::with_capacity(vocabs.len());
    for vocab in vocabs {
        if vocab.is_empty() {
            continue;
        }
        let mut matched_mass = 0.0f32;
        let mut hit_topic = false;
        for token in &chat_tokens {
            let w = vocab.weight_for(token, boostable);
            if w > 0.0 {
                if w > 1.0 {
                    hit_topic = true;
                }
                matched_mass += w * idf.get(token).copied().unwrap_or(0.0);
            }
        }
        // TOPIC_WEIGHT can push coverage above 1.0; clamp so the threshold and
        // margin comparisons stay on a 0..1 scale.
        let coverage = ((matched_mass / vocab.breadth_damping) / total_mass).min(1.0);
        scored.push((vocab.uuid.as_str(), coverage, hit_topic));
    }

    // Sort descending and take the top two, so the margin check reads directly
    // off the two best scores.
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let &(top_uuid, top_score, top_hit_topic) = scored.first()?;
    let runner_up = scored.get(1).map(|s| s.1).unwrap_or(0.0);

    if top_score >= coverage_min && (top_score - runner_up) >= margin_min {
        return Some(MatchSuggestion {
            conversation_uuid: conv.uuid.clone(),
            project_uuid: Some(top_uuid.to_string()),
            score: top_score.min(0.85),
            reason: if top_hit_topic { "topics" } else { "keywords" },
        });
    }

    None
}

fn no_match(conv: &ClaudeConversationPreview) -> MatchSuggestion {
    MatchSuggestion {
        conversation_uuid: conv.uuid.clone(),
        project_uuid: None,
        score: 0.0,
        reason: "none",
    }
}

/// Denominator contribution for a chat token that appears in no project.
///
/// Charging these full rarity (they *are* rare, by df) is backwards: most are
/// conversational filler — "understand", "explain", "start", "nature" — common
/// in chats but absent from project vocabularies, which describe subjects rather
/// than how people talk. Weighting them as maximally discriminative meant every
/// extra sentence of context *lowered* coverage, so widening the chat window
/// actively destroyed matches it was meant to rescue (measured: a chat scoring
/// 1.00 on its title alone fell to 0.20 across three messages).
///
/// They still cost something — a chat that is mostly off-topic everywhere should
/// not score highly on one shared word — but a small fixed floor, not the max.
const UNKNOWN_TOKEN_IDF: f32 = 0.35;

/// Text used to represent a chat for matching: title plus the first few user
/// messages, capped. Falls back to `first_user_message` when the full transcript
/// isn't loaded (the LLM command reconstructs previews without `messages`).
pub(super) fn chat_context_text(conv: &ClaudeConversationPreview) -> String {
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

/// Build the per-project source text for the LLM passes, memory first.
///
/// Project memory is distilled subject matter ("user is building X, cares
/// about Y") while prompt templates are mostly tone/format instructions the
/// topic prompt tells the model to ignore. Concatenating memory *last* (the
/// old behavior) let a verbose template crowd the memory out of the budget
/// entirely — measured on a real 18-project export, only 2 projects got more
/// than half their memory through. Memory now gets first claim on the budget
/// minus whatever description + prompt actually need, and the head's share is
/// itself capped at 1/4 of the budget — so memory is never squeezed below 3/4
/// even by a verbose template, and a short (or empty) head costs memory
/// nothing. Projects without memory give the head the whole budget.
pub(super) fn project_source_text(
    prompt_template: &str,
    description: &str,
    memory: &str,
    budget: usize,
) -> String {
    let head = format!("{} {}", description.trim(), prompt_template.trim());
    let head = head.trim();
    let mem_cap = budget - head.chars().count().min(budget / 4);
    let mem: String = memory.trim().chars().take(mem_cap).collect();
    let head_take: String = head.chars().take(budget - mem.chars().count()).collect();
    format!("{} {}", mem.trim(), head_take.trim()).trim().to_string()
}

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
    // Called after each batch finishes (success or failure) with
    // (batches_done, batches_total). Used to emit progress events.
    mut on_progress: impl FnMut(usize, usize),
) -> TopicGenerationOutcome {
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
    let batches_total = projects.len().div_ceil(TOPIC_BATCH_SIZE);
    let mut batches_done = 0usize;
    let mut batches_failed = 0usize;
    let mut last_error: Option<String> = None;

    for chunk in projects.chunks(TOPIC_BATCH_SIZE) {
        let mut user_msg = String::new();
        for (i, proj) in chunk.iter().enumerate() {
            let memory = memories_by_project
                .get(&proj.uuid)
                .map(String::as_str)
                .unwrap_or("");
            let source = project_source_text(
                &proj.prompt_template,
                &proj.description,
                memory,
                TOPIC_SOURCE_CHARS,
            );
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

        let reply = match ollama
            .send_message_with_options("claude_import_topics", model, messages, Some("5m"))
            .await
        {
            Ok(reply) => reply,
            Err(e) => {
                // A failed batch just means those projects match on base
                // vocabulary — but record it so the caller can tell the user.
                eprintln!(
                    "[claude_import_topics] batch {}/{} failed: {}",
                    batches_done + 1,
                    batches_total,
                    e
                );
                batches_failed += 1;
                last_error = Some(e);
                batches_done += 1;
                on_progress(batches_done, batches_total);
                continue;
            }
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
        batches_done += 1;
        on_progress(batches_done, batches_total);
    }

    TopicGenerationOutcome {
        topics: out,
        batches_total,
        batches_failed,
        last_error,
    }
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
/// cannot be parsed for, or if the Ollama call fails entirely. Results from
/// batches that completed before a failure are kept — only the remainder
/// falls back to keywords.
pub async fn suggest_project_with_llm(
    conversations: &[ClaudeConversationPreview],
    projects: &[ClaudeProjectPreview],
    memories_by_project: &HashMap<String, String>,
    ollama: &crate::ollama::client::OllamaClient,
    model: &str,
    // Called after each batch finishes with (batches_done, batches_total).
    mut on_progress: impl FnMut(usize, usize),
) -> LlmMatchOutcome {
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
        // Truncate so the context doesn't blow up, memory first — see
        // `project_source_text`.
        let context = project_source_text(&proj.prompt_template, &proj.description, memory, 300);
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

    // LLM pass — batched, sequential. Aborts on the first Ollama error (a
    // timeout at batch N would very likely repeat for every later batch) but
    // keeps the results of batches that already completed.
    let batches_total = needs_llm.len().div_ceil(LLM_BATCH_SIZE);
    let mut batches_completed = 0usize;
    let mut llm_error: Option<String> = None;
    for chunk in needs_llm.chunks(LLM_BATCH_SIZE) {
        if llm_error.is_some() { break; }

        // Build the user message listing conversations in this batch.
        let mut user_msg = String::new();
        for (batch_pos, &conv_idx) in chunk.iter().enumerate() {
            let conv = &conversations[conv_idx];
            // Prefer the export's distilled summary over the raw opener —
            // it describes the whole chat, not just how it started.
            let gist_label = if conv.summary.trim().is_empty() { "First message" } else { "Summary" };
            let gist: String = if conv.summary.trim().is_empty() {
                conv.first_user_message.chars().take(200).collect()
            } else {
                conv.summary.trim().chars().take(300).collect()
            };
            user_msg.push_str(&format!(
                "{}. Title: \"{}\" | {}: \"{}\"\n",
                batch_pos + 1,
                conv.name.replace('"', "'"),
                gist_label,
                gist.replace('"', "'"),
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
                batches_completed += 1;
                on_progress(batches_completed, batches_total);
            }
            Err(e) => {
                eprintln!(
                    "[claude_import_match] batch {}/{} failed: {}",
                    batches_completed + 1,
                    batches_total,
                    e
                );
                llm_error = Some(e);
            }
        }
    }

    // If the LLM pass aborted, fall back to keyword matcher for everything not
    // already resolved by a title match or a completed batch.
    if llm_error.is_some() {
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
    let suggestions = conversations
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
        .collect();

    LlmMatchOutcome {
        suggestions,
        batches_total,
        batches_completed,
        llm_error,
    }
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

pub(super) fn tokenize(text: &str) -> HashSet<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter_map(|w| {
            let lower = w.trim().to_lowercase();
            if lower.len() < MIN_TOKEN_LEN {
                return None;
            }
            if is_stopword(&lower) {
                return None;
            }
            Some(stem(&lower))
        })
        .collect()
}

/// Collapse trailing plural / possessive forms to a common stem.
///
/// Splitting on non-alphanumerics turns "Hubbert's" into "hubbert" + "s", and a
/// title repeated as "Hubberts peak" then yields both "hubbert" and "hubberts"
/// as distinct tokens. That double-counts one word, which both inflates a chat's
/// apparent length past MIN_CHAT_TOKENS and splits its IDF mass across two
/// entries. Deliberately minimal — not a general stemmer, just the suffixes that
/// arise from possessives and plurals in chat titles.
fn stem(word: &str) -> String {
    for suffix in ["'s", "es", "s"] {
        if let Some(base) = word.strip_suffix(suffix) {
            if base.len() >= MIN_TOKEN_LEN {
                return base.to_string();
            }
        }
    }
    word.to_string()
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
            summary: String::new(),
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
            summary: String::new(),
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

    /// The export's Claude-written summary must participate in matching: a
    /// chat with a generic title and vague opener still matches when its
    /// summary carries the project's vocabulary.
    #[test]
    fn summary_rescues_vague_title_and_opener() {
        let projects = vec![
            proj(
                "p1",
                "Beach stage",
                "DJ controller CDJS mixer house music recordbox vinyl tracks beatmatching",
            ),
            proj("p2", "Cooking", "recipes ingredients pasta sauce kitchen"),
        ];
        let mut c = conv("c1", "Untitled", "hey can you help me with something");
        // Without a summary, this chat has nothing to match on.
        let none = suggest_project_for_conversations(
            std::slice::from_ref(&c),
            &projects,
            &HashMap::new(),
        );
        assert_eq!(none[0].project_uuid, None);

        c.summary = "The user asked about beatmatching tracks on their CDJS \
                     mixer while preparing a house music set."
            .to_string();
        let out = suggest_project_for_conversations(
            std::slice::from_ref(&c),
            &projects,
            &HashMap::new(),
        );
        assert_eq!(out[0].project_uuid.as_deref(), Some("p1"));
        assert_eq!(out[0].reason, "keywords");
    }

    /// Regression: a long prompt template must not crowd project memory out
    /// of the LLM source text — memory gets first claim on the budget.
    #[test]
    fn source_text_is_memory_first() {
        let prompt = "instruction boilerplate ".repeat(100); // 2400 chars
        let memory = "jvm collections generics streams ".repeat(40); // 1360 chars
        let source = project_source_text(&prompt, "", &memory, 1200);
        assert!(source.chars().count() <= 1200);
        // Memory fills its 3/4 share (900), the prompt only the remainder.
        assert!(source.starts_with("jvm collections"));
        assert!(source.contains("instruction boilerplate"));
        let mem_part = source.find("instruction").unwrap();
        assert!(mem_part >= 800, "memory share was {mem_part} chars");
    }

    #[test]
    fn source_text_without_memory_keeps_full_budget_for_prompt() {
        let prompt = "a".repeat(2000);
        let source = project_source_text(&prompt, "", "", 1200);
        assert_eq!(source.chars().count(), 1200);
    }

    #[test]
    fn source_text_without_prompt_gives_memory_full_budget() {
        let memory = "b".repeat(2000);
        let source = project_source_text("", "", &memory, 1200);
        assert_eq!(source.chars().count(), 1200);
    }

    #[test]
    fn source_text_short_inputs_pass_through() {
        let source = project_source_text("prompt", "desc", "memory", 1200);
        assert_eq!(source, "memory desc prompt");
    }

    /// Regression: an Ollama failure mid-LLM-pass must be reported, not
    /// swallowed. Every conversation still gets a suggestion (keyword
    /// fallback), and the outcome carries the error + batch stats so the UI
    /// can tell the user the run degraded.
    #[tokio::test]
    async fn llm_failure_is_surfaced_not_swallowed() {
        // Loopback port 9 (discard) — connection refused immediately, no
        // Ollama needed.
        let ollama = crate::ollama::client::OllamaClient::new(Some("http://127.0.0.1:9".to_string()))
            .expect("loopback base URL is valid");
        let projects = vec![proj("p1", "Java", "object oriented programming jvm collections")];
        let convs = vec![
            // Title-matches "Java" without the LLM.
            conv("c1", "Learning Java collections", ""),
            // Needs the LLM, which will fail → keyword/none fallback.
            conv("c2", "Untitled", "what should I cook tonight"),
        ];
        let mut progress_calls = 0usize;
        let outcome = suggest_project_with_llm(
            &convs,
            &projects,
            &HashMap::new(),
            &ollama,
            "test-model",
            |_, _| progress_calls += 1,
        )
        .await;

        assert!(outcome.llm_error.is_some(), "connection error must be reported");
        assert_eq!(outcome.batches_completed, 0);
        assert_eq!(outcome.batches_total, 1);
        assert_eq!(progress_calls, 0, "no batch completed, so no progress ticks");
        // Suggestions still cover every conversation.
        assert_eq!(outcome.suggestions.len(), 2);
        assert_eq!(outcome.suggestions[0].project_uuid.as_deref(), Some("p1"));
        assert_eq!(outcome.suggestions[0].reason, "title");
        assert_ne!(outcome.suggestions[1].reason, "llm");
    }

    /// Regression: topic generation reports failed batches instead of
    /// silently returning an empty map.
    #[tokio::test]
    async fn topic_generation_failure_is_counted() {
        let ollama = crate::ollama::client::OllamaClient::new(Some("http://127.0.0.1:9".to_string()))
            .expect("loopback base URL is valid");
        let projects = vec![proj("p1", "Java", "jvm collections")];
        let mut progress_calls = 0usize;
        let outcome = generate_project_topics(
            &projects,
            &HashMap::new(),
            &ollama,
            "test-model",
            |_, _| progress_calls += 1,
        )
        .await;

        assert!(outcome.topics.is_empty());
        assert_eq!(outcome.batches_total, 1);
        assert_eq!(outcome.batches_failed, 1);
        assert!(outcome.last_error.is_some());
        assert_eq!(progress_calls, 1, "failed batches still tick progress");
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
        // Needs a realistic pool size: the topic boost only applies to terms in
        // <= TOPIC_BOOST_MAX_DF_RATIO of projects, so a 2-project fixture would
        // put every term above the ratio and exercise nothing.
        let projects = vec![
            proj("p1", "Beach stage", "weekend sets at the shore"),
            proj("p2", "Taxes", "self assessment deductions receipts invoices"),
            proj("p3", "Gardening", "compost seedlings pruning greenhouse"),
            proj("p4", "Cooking", "recipes braising stock seasoning"),
            proj("p5", "Cycling", "cadence commuting panniers drivetrain"),
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
    fn cross_cutting_topic_terms_are_not_boosted() {
        // Distilling one person's projects yields recurring life-context terms —
        // where they live, their field — that describe the *user*, not a project.
        // Observed for real: "netherlands" in 6/21 projects, "amsterdam" in 5.
        // Boosting those let a peak-oil chat land in a driving-licence project on
        // shared location mass. A term that common must not outrank a rare one.
        let projects = vec![
            proj("p1", "Driving", "cbr theory exam road rules hazard perception"),
            proj("p2", "Economics", "markets inflation commodities monetary policy"),
            proj("p3", "Housing", "mortgage rental tenancy deposit"),
            proj("p4", "Language", "grammar conjugation vocabulary pronunciation"),
        ];
        let mut topics = HashMap::new();
        // "netherlands" is shared by 3 of 4 projects (ratio 0.75, well above the
        // boost cap); "commodities"/"hubbert" are unique to Economics.
        topics.insert(
            "p1".to_string(),
            vec!["netherlands".to_string(), "amsterdam".to_string()],
        );
        topics.insert(
            "p2".to_string(),
            vec![
                "netherlands".to_string(),
                "commodities".to_string(),
                "hubbert".to_string(),
                "depletion".to_string(),
            ],
        );
        topics.insert(
            "p3".to_string(),
            vec!["netherlands".to_string(), "amsterdam".to_string()],
        );

        let convs = vec![conv(
            "c1",
            "Hubbert peak theory",
            "Explain hubbert depletion curves for commodities in the netherlands",
        )];
        let out = suggest_project_for_conversations_with_topics(
            &convs,
            &projects,
            &HashMap::new(),
            &topics,
        );
        assert_eq!(
            out[0].project_uuid.as_deref(),
            Some("p2"),
            "the rare on-topic terms must win over shared location vocabulary"
        );
    }

    #[test]
    fn possessive_variants_do_not_inflate_chat_length() {
        // Observed for real: "Hubbert's peak theory" / "Hubberts peak" tokenised
        // to {hubbert, hubberts, peak, theory} — 4 tokens for a 2-word chat,
        // scraping past MIN_CHAT_TOKENS and letting one weak shared token
        // ("theory") decide the match. Stemming collapses the duplicate.
        assert_eq!(
            tokenize("Hubbert's peak theory Hubberts peak").len(),
            3,
            "possessive and plural forms of one word must count once"
        );

        let projects = vec![
            proj("p1", "Driving", "cbr theory exam road rules hazard perception"),
            proj("p2", "Economics", "markets inflation commodities monetary policy"),
            proj("p3", "Housing", "mortgage rental tenancy deposit"),
            proj("p4", "Language", "grammar conjugation vocabulary pronunciation"),
        ];
        let convs = vec![conv("c1", "Hubbert's peak theory", "Hubberts peak")];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_eq!(
            out[0].project_uuid, None,
            "a two-word chat sharing one generic token must not be assigned"
        );
    }

    #[test]
    fn narrative_project_does_not_absorb_unrelated_chats() {
        // Observed for real: a project whose instructions were a long personal
        // narrative held 178 base tokens against a pool median of 25, and won
        // 255 of 539 matches — chats about XSS, height loss and bitcoin all
        // landed in it. IDF cannot suppress this: the tokens are unique to that
        // project (df=1), so they score *maximum* IDF. Breadth damping does.
        let narrative = "isolation community marriage motivation consistency progress \
             realization pattern avoidance foundation obligation requirement practice \
             restarting hiatus barrier concrete action weekly complexity worth social \
             settings friends fear rejection provider homeowner theology acceptance \
             struggling performance detour diagnostic attempt";
        let projects = vec![
            proj("p1", "Narrative", narrative),
            proj("p2", "Security", "xss csrf injection"),
            proj("p3", "Fitness", "squat deadlift macros"),
            proj("p4", "Crypto", "bitcoin ledger halving"),
        ];
        // A chat that shares generic reflective vocabulary with the narrative
        // project but is really about something else.
        let convs = vec![conv(
            "c1",
            "Cross-site scripting vulnerability",
            "Understanding xss injection patterns and the practice of avoidance",
        )];
        let out = suggest_project_for_conversations(&convs, &projects, &HashMap::new());
        assert_ne!(
            out[0].project_uuid.as_deref(),
            Some("p1"),
            "a verbose narrative project must not win on vocabulary surface area"
        );
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
