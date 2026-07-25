// Propose tentative groups for Claude chats that matched no existing project.
//
// Matching answers "which of these 22 projects does this chat belong to?".
// On a real export that question is unanswerable for most chats: ~600 of 988
// were coherent topics ("Docker Image and Compose Workflow", "CSS Print Media
// Query Styling") that simply have no corresponding project. No threshold fixes
// that — the missing operation is proposing *new* groups.
//
// Repeated failure to match anything is exactly the signal that a set of chats
// forms its own cluster, so this runs over the matcher's leftovers.
//
// The groups are staging buckets, not naming decisions: the user drops a whole
// group onto an existing workspace or creates a new one. Mediocre clustering is
// still a large win, because it turns reviewing 600 chats into reviewing ~40
// groups. Nothing is imported without confirmation.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use super::claude_v2_match::{chat_context_text, tokenize};
use super::ClaudeConversationPreview;

/// A proposed group of unmatched conversations.
#[derive(Debug, Clone, Serialize)]
pub struct ChatCluster {
    /// Stable within one scan; used by the UI to key selections.
    pub id: String,
    /// Human-readable label. Top shared terms until `name_clusters` improves it.
    pub label: String,
    /// Terms the members share, most discriminative first. Shown as the
    /// "why these are together" explanation, and fed to LLM naming.
    pub terms: Vec<String>,
    pub conversation_uuids: Vec<String>,
}

/// Minimum members for a group to be worth proposing. Below this the user is
/// better served by the flat unassigned list.
const MIN_CLUSTER_SIZE: usize = 3;
/// Similarity floor for joining a cluster. Deliberately high: smaller, tighter
/// groups are preferable because merging two groups onto one destination is a
/// single action, whereas splitting a group that swallowed unrelated chats is
/// not possible in the UI at all.
/// Swept against a real 583-chat corpus: 0.34 grouped 75% but produced blobs of
/// 29 unrelated chats; 0.55 kept groups clean but grouped only 22%. At 0.45 the
/// largest group is 13 chats and roughly half the corpus is grouped.
const SIMILARITY_MIN: f32 = 0.45;
/// Titles shorter than this carry too little to group on ("Chat", "Monday 23rd+").
/// Lower than the matcher's MIN_CHAT_TOKENS because titles are short by nature —
/// two solid terms ("Docker Compose") is a real signal.
const MIN_TITLE_TOKENS: usize = 2;
/// A cluster stops accepting members once its own vocabulary grows past this,
/// which prevents the "one broad group absorbs everything" failure that
/// verbose projects showed at the matching layer.
const MAX_CENTROID_TERMS: usize = 24;
/// Terms in more than this fraction of unmatched chats are conversational
/// filler for *this* corpus and must not drive grouping.
const MAX_DF_RATIO: f32 = 0.18;
/// The df-ratio filter only applies once the corpus is large enough for the
/// ratio to mean anything. In a 6-chat corpus a term shared by 3 chats is at
/// ratio 0.5 and would be discarded as "filler" — when it is in fact the term
/// that defines the group. Below this size, keep every shared term.
const DF_RATIO_MIN_CORPUS: usize = 40;
/// How many terms describe a cluster in the UI and to the namer.
const LABEL_TERMS: usize = 6;

/// Generic chat-title scaffolding that must never drive grouping.
///
/// Frequency cannot separate these from real topics: measured on a real export,
/// "understanding" appears in 23 titles and "pendo" in 20 — statistically
/// identical, semantically opposite. Without this list, clusters formed around
/// "technique" and "benefit", pulling "Git file reversion technique" together
/// with "Cold shower health benefits".
///
/// These are title-shaped words (what a chat *is* — a guide, an overview, an
/// error) rather than what it is *about*, which is why they are listed here
/// instead of in the matcher's prose stopword list.
fn is_title_filler(w: &str) -> bool {
    matches!(
        w,
        "understanding"
            | "understand"
            | "overview"
            | "explained"
            | "explain"
            | "guide"
            | "basic"
            | "fundamental"
            | "introduction"
            | "comparison"
            | "compare"
            | "review"
            | "summary"
            | "strategy"
            | "approach"
            | "technique"
            | "method"
            | "benefit"
            | "issue"
            | "problem"
            | "error"
            | "troubleshooting"
            | "question"
            | "help"
            | "advice"
            | "recommendation"
            | "option"
            | "alternative"
            | "consideration"
            | "concern"
            | "impact"
            | "insight"
            | "lesson"
            | "tips"
            | "best"
            | "better"
            | "improving"
            | "improvement"
            | "optimizing"
            | "optimization"
            | "getting"
            | "started"
            | "starting"
            | "setup"
            | "learning"
            | "learn"
            | "mastery"
            | "mastering"
            | "exploring"
            | "exploration"
            | "planning"
            | "checking"
            | "creating"
            | "building"
            | "designing"
            | "choosing"
            | "finding"
            | "using"
            | "working"
            | "general"
            | "quick"
            | "simple"
            | "detail"
            | "example"
            | "requirement"
            | "process"
            | "workflow"
            | "routine"
    )
}

struct ChatDoc<'a> {
    uuid: &'a str,
    title: &'a str,
    /// Title tokens — the primary grouping signal.
    tokens: HashSet<String>,
    /// Body tokens, used only to break ties between candidate clusters.
    body: HashSet<String>,
}

/// Group unmatched conversations by shared vocabulary.
///
/// Single-pass leader clustering against IDF-weighted centroids: O(n·k) with no
/// LLM, so it runs during the scan and works offline. Chats are processed
/// longest-first so that content-rich chats seed clusters and short ones join
/// them, rather than a two-token chat defining a group.
///
/// Grouping is driven by **titles**, not full text. Measured on a real export:
/// two chats that are obviously the same topic ("Docker Image and Compose
/// Workflow" / "Docker Daemon Connection Error") share only 0.10–0.30 of their
/// full-text mass, because the bodies are incident-specific detail that differs
/// completely. The same pair shares 0.31–1.00 of its *title* mass. Titles are
/// short, deliberate topic labels; bodies are noise for this purpose, so they
/// only break ties between otherwise-equal candidate clusters.
pub fn cluster_unmatched(
    conversations: &[ClaudeConversationPreview],
    unmatched_uuids: &HashSet<String>,
) -> Vec<ChatCluster> {
    let docs: Vec<ChatDoc> = conversations
        .iter()
        .filter(|c| unmatched_uuids.contains(&c.uuid))
        .map(|c| {
            let body = tokenize(&chat_context_text(c));
            let mut tokens = tokenize(&c.name);
            tokens.retain(|t| !is_title_filler(t));
            tokens.extend(short_acronyms(&c.name));
            ChatDoc {
                uuid: c.uuid.as_str(),
                title: c.name.as_str(),
                tokens,
                body,
            }
        })
        .filter(|d| d.tokens.len() >= MIN_TITLE_TOKENS)
        .collect();

    if docs.len() < MIN_CLUSTER_SIZE {
        return Vec::new();
    }

    let idf = corpus_idf(&docs);

    // Longest first: a chat with rich vocabulary makes a better cluster seed
    // than a four-token one, which would anchor a group on almost nothing.
    let mut order: Vec<usize> = (0..docs.len()).collect();
    order.sort_by(|&a, &b| {
        docs[b]
            .tokens
            .len()
            .cmp(&docs[a].tokens.len())
            .then_with(|| docs[a].uuid.cmp(docs[b].uuid)) // stable across runs
    });

    struct Centroid {
        terms: HashSet<String>,
        members: Vec<usize>,
    }
    let mut centroids: Vec<Centroid> = Vec::new();

    for &i in &order {
        let doc = &docs[i];
        let mut best: Option<(usize, f32, f32)> = None;
        for (ci, c) in centroids.iter().enumerate() {
            let sim = weighted_overlap(&doc.tokens, &c.terms, &idf);
            if sim < SIMILARITY_MIN {
                continue;
            }
            // Body overlap only separates clusters the titles rate equally.
            let tie = weighted_overlap(&doc.body, &c.terms, &idf);
            if best.is_none_or(|(_, s, t)| sim > s || (sim == s && tie > t)) {
                best = Some((ci, sim, tie));
            }
        }
        match best {
            Some((ci, _, _)) => {
                let c = &mut centroids[ci];
                c.members.push(i);
                // Only grow the centroid while it is still tight; an unbounded
                // centroid drifts and starts matching everything.
                if c.terms.len() < MAX_CENTROID_TERMS {
                    for t in &doc.tokens {
                        if idf.contains_key(t) {
                            c.terms.insert(t.clone());
                        }
                    }
                }
            }
            None => centroids.push(Centroid {
                terms: doc.tokens.iter().filter(|t| idf.contains_key(*t)).cloned().collect(),
                members: vec![i],
            }),
        }
    }

    let mut out: Vec<ChatCluster> = centroids
        .into_iter()
        .filter(|c| c.members.len() >= MIN_CLUSTER_SIZE)
        .map(|c| {
            let terms = ranked_shared_terms(&c.members, &docs, &idf);
            let label = if terms.is_empty() {
                fallback_label(&c.members, &docs)
            } else {
                terms.join(", ")
            };
            ChatCluster {
                id: String::new(), // assigned below, after ordering
                label,
                terms,
                conversation_uuids: c.members.iter().map(|&m| docs[m].uuid.to_string()).collect(),
            }
        })
        .collect();

    // Largest first — the biggest wins are at the top of the user's list.
    out.sort_by(|a, b| {
        b.conversation_uuids
            .len()
            .cmp(&a.conversation_uuids.len())
            .then_with(|| a.label.cmp(&b.label))
    });
    for (i, c) in out.iter_mut().enumerate() {
        c.id = format!("cluster-{i}");
    }
    out
}

/// Recover short technical acronyms that the shared tokenizer discards.
///
/// `tokenize` drops anything under 4 characters, which is right for prose but
/// wrong here: "CSS", "SQL", "AWS", "API", "SSH", "JWT" are among the most
/// discriminative terms a chat title can carry. Without this, three chats
/// titled "CSS Print Media Query", "CSS grid alignment" and "CSS custom
/// properties" share *nothing* and never group.
///
/// Restricted to all-caps runs of 2–3 characters so it picks up acronyms
/// without readmitting ordinary short words ("the", "and", "for"), which are
/// lowercase in practice and carry no grouping signal.
fn short_acronyms(title: &str) -> Vec<String> {
    title
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| {
            let len = w.chars().count();
            (2..=3).contains(&len)
                && w.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
                && w.chars().any(|c| c.is_ascii_uppercase())
        })
        .map(|w| w.to_lowercase())
        .collect()
}

/// IDF over the unmatched chats themselves, with corpus-wide filler removed.
///
/// Note this is a *different* corpus from the matcher's project-pool IDF: what
/// distinguishes chats from each other is not what distinguishes projects.
fn corpus_idf(docs: &[ChatDoc]) -> HashMap<String, f32> {
    let n = docs.len().max(1) as f32;
    let mut df: HashMap<&str, usize> = HashMap::new();
    for d in docs {
        for t in &d.tokens {
            *df.entry(t.as_str()).or_insert(0) += 1;
        }
    }
    let apply_ratio = docs.len() >= DF_RATIO_MIN_CORPUS;
    df.into_iter()
        .filter(|(_, c)| {
            // Drop both extremes: terms in almost every chat carry no grouping
            // signal, and hapax terms can't be *shared* by definition.
            *c >= 2 && (!apply_ratio || (*c as f32 / n) <= MAX_DF_RATIO)
        })
        .map(|(t, c)| (t.to_string(), (1.0 + n / c as f32).ln()))
        .collect()
}

/// Share of the chat's discriminative mass covered by the centroid.
fn weighted_overlap(
    tokens: &HashSet<String>,
    centroid: &HashSet<String>,
    idf: &HashMap<String, f32>,
) -> f32 {
    let mut total = 0.0f32;
    let mut shared = 0.0f32;
    for t in tokens {
        let Some(w) = idf.get(t) else { continue };
        total += w;
        if centroid.contains(t) {
            shared += w;
        }
    }
    if total <= 0.0 {
        return 0.0;
    }
    shared / total
}

/// Terms most members share, ranked by how much grouping signal they carry.
fn ranked_shared_terms(
    members: &[usize],
    docs: &[ChatDoc],
    idf: &HashMap<String, f32>,
) -> Vec<String> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for &m in members {
        for t in &docs[m].tokens {
            if idf.contains_key(t) {
                *counts.entry(t.as_str()).or_insert(0) += 1;
            }
        }
    }
    let n = members.len() as f32;
    let mut ranked: Vec<(&str, f32)> = counts
        .into_iter()
        // A term in only one member of a group does not describe the group.
        .filter(|(_, c)| *c >= 2)
        .map(|(t, c)| {
            let share = c as f32 / n;
            (t, share * idf.get(t).copied().unwrap_or(0.0))
        })
        .collect();
    ranked.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.cmp(b.0))
    });
    ranked
        .into_iter()
        .take(LABEL_TERMS)
        .map(|(t, _)| t.to_string())
        .collect()
}

/// Last resort when a group shares no rankable vocabulary: name it after its
/// largest member so the row is still identifiable.
fn fallback_label(members: &[usize], docs: &[ChatDoc]) -> String {
    members
        .iter()
        .map(|&m| docs[m].title)
        .find(|t| !t.trim().is_empty())
        .unwrap_or("Untitled group")
        .chars()
        .take(48)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::chat_file_store::ClaudeMessagePreview;

    fn conv(uuid: &str, name: &str, body: &str) -> ClaudeConversationPreview {
        ClaudeConversationPreview {
            uuid: uuid.to_string(),
            name: name.to_string(),
            message_count: 1,
            created_at: String::new(),
            updated_at: String::new(),
            project_uuid: None,
            first_user_message: body.to_string(),
            messages: vec![ClaudeMessagePreview {
                role: "user".to_string(),
                content: body.to_string(),
            }],
        }
    }

    fn all(convs: &[ClaudeConversationPreview]) -> HashSet<String> {
        convs.iter().map(|c| c.uuid.clone()).collect()
    }

    #[test]
    fn groups_chats_sharing_a_topic() {
        let convs = vec![
            conv("d1", "Docker Image and Compose Workflow", "building docker compose image layers registry"),
            conv("d2", "Docker volume permissions", "docker compose volume mount permissions registry"),
            conv("d3", "Docker multistage build", "docker image multistage build layers compose"),
            conv("c1", "CSS Print Media Query Styling", "css print media query stylesheet layout"),
            conv("c2", "CSS grid alignment", "css grid layout stylesheet media query"),
            conv("c3", "CSS custom properties", "css stylesheet custom properties layout grid"),
        ];
        let out = cluster_unmatched(&convs, &all(&convs));
        assert_eq!(out.len(), 2, "expected a docker group and a css group");
        for c in &out {
            assert_eq!(c.conversation_uuids.len(), 3);
            let uuids: HashSet<&str> = c.conversation_uuids.iter().map(String::as_str).collect();
            let is_docker = uuids.contains("d1");
            if is_docker {
                assert!(uuids.contains("d2") && uuids.contains("d3"));
            } else {
                assert!(uuids.contains("c1") && uuids.contains("c2") && uuids.contains("c3"));
            }
        }
    }

    #[test]
    fn ignores_already_matched_chats() {
        let convs = vec![
            conv("d1", "Docker compose", "docker compose image registry layers"),
            conv("d2", "Docker volumes", "docker compose volume registry layers"),
            conv("d3", "Dockerfile builds", "docker image build registry layers"),
        ];
        // Only two are unmatched -> below MIN_CLUSTER_SIZE, so nothing proposed.
        let mut unmatched = HashSet::new();
        unmatched.insert("d1".to_string());
        unmatched.insert("d2".to_string());
        let out = cluster_unmatched(&convs, &unmatched);
        assert!(out.is_empty());
    }

    #[test]
    fn singletons_are_not_proposed() {
        let convs = vec![
            conv("a", "Docker compose networking", "docker compose network bridge overlay"),
            conv("b", "Sourdough hydration", "sourdough starter hydration crumb bake"),
            conv("c", "Tax return deadlines", "tax return deadline invoice receipts"),
        ];
        let out = cluster_unmatched(&convs, &all(&convs));
        assert!(out.is_empty(), "unrelated one-offs must not be grouped");
    }

    #[test]
    fn output_is_deterministic_across_input_order() {
        let mut convs = vec![
            conv("d1", "Docker Image and Compose", "docker compose image layers registry"),
            conv("d2", "Docker volume permissions", "docker compose volume permissions registry"),
            conv("d3", "Dockerfile multistage", "docker image multistage layers compose"),
            conv("k1", "Kubernetes ingress routing", "kubernetes ingress service mesh routing"),
            conv("k2", "Kubernetes pod evictions", "kubernetes pod eviction scheduler service"),
            conv("k3", "Kubernetes secrets", "kubernetes secret configmap service mesh"),
        ];
        let first = cluster_unmatched(&convs, &all(&convs));
        convs.reverse();
        let second = cluster_unmatched(&convs, &all(&convs));
        let shape = |v: &[ChatCluster]| -> Vec<(String, Vec<String>)> {
            v.iter()
                .map(|c| {
                    let mut u = c.conversation_uuids.clone();
                    u.sort();
                    (c.label.clone(), u)
                })
                .collect()
        };
        assert_eq!(shape(&first), shape(&second));
    }

    #[test]
    fn label_describes_shared_vocabulary() {
        // Titles carry the grouping signal, so fixtures must have realistic ones.
        let convs = vec![
            conv("d1", "Docker compose image registry", "layers and tags"),
            conv("d2", "Docker compose volume registry", "mount permissions"),
            conv("d3", "Docker compose image layers", "multistage build"),
        ];
        let out = cluster_unmatched(&convs, &all(&convs));
        assert_eq!(out.len(), 1);
        assert!(
            out[0].terms.iter().any(|t| t == "docker"),
            "expected shared vocabulary in label terms, got {:?}",
            out[0].terms
        );
    }
}
