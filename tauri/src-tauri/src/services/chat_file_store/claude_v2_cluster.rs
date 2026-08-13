// Propose tentative groups for Claude chats that matched no existing project.
//
// Matching answers "which of these 22 projects does this chat belong to?".
// On a real export that question is unanswerable for most chats: ~583 of 988
// were coherent topics ("Docker Image and Compose Workflow", "SQL Comment
// Syntax Troubleshooting") that simply have no corresponding project. No
// threshold fixes that — the missing operation is proposing *new* groups.
//
// Repeated failure to match anything is exactly the signal that a set of chats
// forms its own cluster, so this runs over the matcher's leftovers.
//
// Two strategies:
//   - Embedding clustering (default): semantic, catches groups that share no
//     vocabulary at all.
//   - Lexical clustering (fallback): title token overlap, used when embeddings
//     are unavailable. Weaker, but needs no model.
//
// The groups are staging buckets, not naming decisions: the user drops a whole
// group onto an existing workspace or creates a new one. Nothing is imported
// without confirmation.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use super::claude_v2_match::{chat_context_text, tokenize};
use super::ClaudeConversationPreview;

/// A proposed group of unmatched conversations.
#[derive(Debug, Clone, Serialize)]
pub struct ChatCluster {
    /// Stable within one scan; used by the UI to key selections.
    pub id: String,
    /// Human-readable label. Top shared terms until LLM naming improves it.
    pub label: String,
    /// Terms the members share, most discriminative first. Shown as the
    /// "why these are together" explanation, and fed to LLM naming.
    pub terms: Vec<String>,
    pub conversation_uuids: Vec<String>,
}

/// Minimum members for a group to be worth proposing. Below this the user is
/// better served by the flat unassigned list.
const MIN_CLUSTER_SIZE: usize = 3;

// ── Embedding clustering ─────────────────────────────────────────────────────

/// Cosine floor for joining a cluster, measured against the running centroid.
/// Swept over the real 528-chat unmatched corpus this actually runs on (not the
/// full export — the leftovers are sparser, and thresholds tuned on the whole
/// corpus over-group here): 0.54 grouped 56% but produced blobs, 0.62 grouped
/// only 29%. At 0.56 the largest group is 20 and ~half the leftovers group.
const EMBED_SIMILARITY_MIN: f32 = 0.56;
/// A chat must also resemble the cluster's *seed*, not just its centroid.
/// Without this the centroid drifts as members join and a group slowly wanders
/// off-topic — the same absorption failure seen at the matching layer. This is
/// what splits one 38-chat "AI/career/software" blob into distinct groups.
const EMBED_SEED_SIMILARITY_MIN: f32 = 0.52;

/// Group unmatched conversations by embedding similarity.
///
/// `embeddings` maps conversation UUID → unit-normalised vector; chats without
/// one are skipped. Leader clustering, longest title first so that descriptive
/// chats seed groups rather than a two-word title anchoring one.
///
/// Semantic similarity is what lexical grouping cannot do: "Post salah",
/// "Ju'mah prayer time" and "Mosque prayer timing" are one topic sharing zero
/// words, and score 0.59–0.70 here.
pub fn cluster_by_embedding(
    conversations: &[ClaudeConversationPreview],
    unmatched_uuids: &HashSet<String>,
    embeddings: &HashMap<String, Vec<f32>>,
) -> Vec<ChatCluster> {
    let docs: Vec<ChatDoc> = build_docs(conversations, unmatched_uuids)
        .into_iter()
        .filter(|d| embeddings.contains_key(d.uuid))
        .collect();
    if docs.len() < MIN_CLUSTER_SIZE {
        return Vec::new();
    }

    let vecs: Vec<&Vec<f32>> = docs.iter().map(|d| &embeddings[d.uuid]).collect();

    let mut order: Vec<usize> = (0..docs.len()).collect();
    order.sort_by(|&a, &b| {
        docs[b]
            .title
            .len()
            .cmp(&docs[a].title.len())
            .then_with(|| docs[a].uuid.cmp(docs[b].uuid)) // stable across runs
    });

    struct Group {
        centroid: Vec<f32>,
        seed: usize,
        members: Vec<usize>,
    }
    let mut groups: Vec<Group> = Vec::new();

    for &i in &order {
        let v = vecs[i];
        let mut best: Option<(usize, f32)> = None;
        for (gi, g) in groups.iter().enumerate() {
            // Must resemble both the centroid and the original seed.
            if cosine(v, vecs[g.seed]) < EMBED_SEED_SIMILARITY_MIN {
                continue;
            }
            let sim = cosine(v, &g.centroid);
            if sim >= EMBED_SIMILARITY_MIN && best.is_none_or(|(_, s)| sim > s) {
                best = Some((gi, sim));
            }
        }
        match best {
            Some((gi, _)) => {
                let g = &mut groups[gi];
                g.members.push(i);
                let k = g.members.len() as f32;
                for (d, x) in g.centroid.iter_mut().zip(v.iter()) {
                    *d = (*d * (k - 1.0) + x) / k;
                }
                normalize(&mut g.centroid);
            }
            None => groups.push(Group {
                centroid: v.to_vec(),
                seed: i,
                members: vec![i],
            }),
        }
    }

    let idf = corpus_idf(&docs);
    finish(
        groups
            .into_iter()
            .filter(|g| g.members.len() >= MIN_CLUSTER_SIZE)
            .map(|g| g.members)
            .collect(),
        &docs,
        &idf,
    )
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn normalize(v: &mut [f32]) {
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if n > 0.0 {
        for x in v.iter_mut() {
            *x /= n;
        }
    }
}

/// Text to embed for a conversation.
///
/// Lowercased deliberately: `nomic-embed-text` returns byte-identical vectors
/// for many Title Case inputs — measured on a real export, 61 of 931 titles
/// collapsed into 12 groups of identical vectors, including "SQL Comment Syntax
/// Troubleshooting" and "Hex Data Decoding Challenge". Lowercasing the same
/// strings produces distinct vectors and eliminates every false collapse.
pub fn embedding_input(conv: &ClaudeConversationPreview) -> String {
    conv.name.trim().to_lowercase()
}

// ── Lexical clustering (offline fallback) ────────────────────────────────────

/// Similarity floor for the lexical path. Swept against the real corpus: 0.34
/// grouped 75% but produced blobs of 29 unrelated chats; 0.55 stayed clean but
/// grouped only 22%.
const SIMILARITY_MIN: f32 = 0.45;
/// Titles shorter than this carry too little to group on ("Chat", "Monday 23rd+").
const MIN_TITLE_TOKENS: usize = 2;
/// A cluster stops accepting vocabulary once it reaches this breadth, which
/// prevents one group from drifting into a catch-all.
const MAX_CENTROID_TERMS: usize = 24;
/// Terms in more than this fraction of unmatched chats are conversational
/// filler for *this* corpus and must not drive grouping.
const MAX_DF_RATIO: f32 = 0.18;
/// The df-ratio filter only applies once the corpus is large enough for the
/// ratio to mean anything. In a 6-chat corpus a term shared by 3 chats sits at
/// ratio 0.5 and would be discarded as "filler" when it in fact defines the
/// group.
const DF_RATIO_MIN_CORPUS: usize = 40;
/// How many terms describe a cluster in the UI and to the namer.
const LABEL_TERMS: usize = 6;

/// Group unmatched conversations by shared title vocabulary.
///
/// Used when embeddings are unavailable. Grouping is driven by titles, not full
/// text: two chats obviously on the same topic ("Docker Image and Compose
/// Workflow" / "Docker Daemon Connection Error") share only 0.10–0.30 of their
/// full-text mass, because bodies are incident-specific detail, but 0.31–1.00
/// of their title mass. Bodies only break ties between candidate clusters.
pub fn cluster_unmatched(
    conversations: &[ClaudeConversationPreview],
    unmatched_uuids: &HashSet<String>,
) -> Vec<ChatCluster> {
    let docs = build_docs(conversations, unmatched_uuids);
    if docs.len() < MIN_CLUSTER_SIZE {
        return Vec::new();
    }
    let idf = corpus_idf(&docs);

    let mut order: Vec<usize> = (0..docs.len()).collect();
    order.sort_by(|&a, &b| {
        docs[b]
            .tokens
            .len()
            .cmp(&docs[a].tokens.len())
            .then_with(|| docs[a].uuid.cmp(docs[b].uuid))
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
            let tie = weighted_overlap(&doc.body, &c.terms, &idf);
            if best.is_none_or(|(_, s, t)| sim > s || (sim == s && tie > t)) {
                best = Some((ci, sim, tie));
            }
        }
        match best {
            Some((ci, _, _)) => {
                let c = &mut centroids[ci];
                c.members.push(i);
                if c.terms.len() < MAX_CENTROID_TERMS {
                    for t in &doc.tokens {
                        if idf.contains_key(t) {
                            c.terms.insert(t.clone());
                        }
                    }
                }
            }
            None => centroids.push(Centroid {
                terms: doc
                    .tokens
                    .iter()
                    .filter(|t| idf.contains_key(*t))
                    .cloned()
                    .collect(),
                members: vec![i],
            }),
        }
    }

    finish(
        centroids
            .into_iter()
            .filter(|c| c.members.len() >= MIN_CLUSTER_SIZE)
            .map(|c| c.members)
            .collect(),
        &docs,
        &idf,
    )
}

// ── Shared plumbing ──────────────────────────────────────────────────────────

struct ChatDoc<'a> {
    uuid: &'a str,
    title: &'a str,
    /// Title tokens — the lexical grouping signal.
    tokens: HashSet<String>,
    /// Body tokens, used only to break ties between candidate clusters.
    body: HashSet<String>,
}

fn build_docs<'a>(
    conversations: &'a [ClaudeConversationPreview],
    unmatched_uuids: &HashSet<String>,
) -> Vec<ChatDoc<'a>> {
    conversations
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
        .collect()
}

/// Turn member index lists into labelled, ordered clusters.
fn finish(
    groups: Vec<Vec<usize>>,
    docs: &[ChatDoc],
    idf: &HashMap<String, f32>,
) -> Vec<ChatCluster> {
    let mut out: Vec<ChatCluster> = groups
        .into_iter()
        .map(|members| {
            let terms = ranked_shared_terms(&members, docs, idf);
            let label = if terms.is_empty() {
                fallback_label(&members, docs)
            } else {
                terms.join(", ")
            };
            ChatCluster {
                id: String::new(),
                label,
                terms,
                conversation_uuids: members.iter().map(|&m| docs[m].uuid.to_string()).collect(),
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
/// discriminative terms a chat title can carry. Restricted to all-caps runs of
/// 2–3 characters so it picks up acronyms without readmitting ordinary short
/// words, which are lowercase in practice.
fn short_acronyms(title: &str) -> Vec<String> {
    title
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| {
            let len = w.chars().count();
            (2..=3).contains(&len)
                && w.chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
                && w.chars().any(|c| c.is_ascii_uppercase())
        })
        .map(|w| w.to_lowercase())
        .collect()
}

/// IDF over the unmatched chats themselves, with corpus-wide filler removed.
///
/// A different corpus from the matcher's project-pool IDF: what distinguishes
/// chats from each other is not what distinguishes projects.
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
        .map(|(t, c)| (t, (c as f32 / n) * idf.get(t).copied().unwrap_or(0.0)))
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

/// Last resort when a group shares no rankable vocabulary: name it after a
/// member so the row is still identifiable.
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

/// Generic chat-title scaffolding that must never drive grouping.
///
/// Frequency cannot separate these from real topics: measured on a real export,
/// "understanding" appears in 23 titles and "pendo" in 20 — statistically
/// identical, semantically opposite. Without this list, clusters formed around
/// "technique" and "benefit", pulling "Git file reversion technique" together
/// with "Cold shower health benefits".
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
            summary: String::new(),
            messages: vec![ClaudeMessagePreview {
                role: "user".to_string(),
                content: body.to_string(),
            }],
        }
    }

    fn all(convs: &[ClaudeConversationPreview]) -> HashSet<String> {
        convs.iter().map(|c| c.uuid.clone()).collect()
    }

    /// Build a unit vector pointing mostly along `axis`, with a small offset so
    /// members of one topic are near each other but not identical.
    fn vec_on(axis: usize, jitter: f32) -> Vec<f32> {
        let mut v = [0.0f32; 6];
        v[axis] = 1.0;
        v[(axis + 1) % 6] = jitter;
        let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        v.iter().map(|x| x / n).collect()
    }

    #[test]
    fn embedding_groups_semantically_related_chats() {
        // These share no vocabulary at all — the case lexical clustering cannot
        // solve. Vectors stand in for what the embedding model returns.
        let convs = vec![
            conv("p1", "Mosque prayer timing and rakah guidance", ""),
            conv("p2", "Ju'mah prayer time", ""),
            conv("p3", "Post salah", ""),
            conv("d1", "Docker daemon connection failure", ""),
            conv("d2", "Container image build permissions", ""),
            conv("d3", "Compose volume mounting", ""),
        ];
        let mut emb = HashMap::new();
        for (i, u) in ["p1", "p2", "p3"].iter().enumerate() {
            emb.insert(u.to_string(), vec_on(0, 0.02 * i as f32));
        }
        for (i, u) in ["d1", "d2", "d3"].iter().enumerate() {
            emb.insert(u.to_string(), vec_on(3, 0.02 * i as f32));
        }
        let out = cluster_by_embedding(&convs, &all(&convs), &emb);
        assert_eq!(out.len(), 2, "expected a prayer group and a container group");
        for c in &out {
            let u: HashSet<&str> = c.conversation_uuids.iter().map(String::as_str).collect();
            assert!(
                u.iter().all(|x| x.starts_with('p')) || u.iter().all(|x| x.starts_with('d')),
                "groups must not mix topics: {u:?}"
            );
        }
    }

    #[test]
    fn embedding_skips_chats_without_vectors() {
        let convs = vec![
            conv("a", "Docker daemon connection failure", ""),
            conv("b", "Container image build permissions", ""),
            conv("c", "Compose volume mounting", ""),
        ];
        // Only two have embeddings -> below MIN_CLUSTER_SIZE.
        let mut emb = HashMap::new();
        emb.insert("a".to_string(), vec_on(0, 0.0));
        emb.insert("b".to_string(), vec_on(0, 0.02));
        assert!(cluster_by_embedding(&convs, &all(&convs), &emb).is_empty());
    }

    #[test]
    fn embedding_seed_constraint_prevents_drift() {
        // A chain where each chat is close to the previous one but the ends are
        // far apart. Without the seed check the centroid walks the chain and
        // swallows everything; with it, the far end starts its own group.
        let convs: Vec<_> = (0..6)
            .map(|i| conv(&format!("c{i}"), &format!("chat number {i} about things"), ""))
            .collect();
        let mut emb = HashMap::new();
        for i in 0..6 {
            let mut v = [0.0f32; 6];
            v[0] = 1.0 - 0.16 * i as f32;
            v[1] = 0.16 * i as f32;
            let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
            emb.insert(format!("c{i}"), v.iter().map(|x| x / n).collect());
        }
        let out = cluster_by_embedding(&convs, &all(&convs), &emb);
        for c in &out {
            assert!(
                c.conversation_uuids.len() < 6,
                "a drifting chain must not collapse into one group"
            );
        }
    }

    #[test]
    fn embedding_output_is_deterministic() {
        let mut convs = vec![
            conv("p1", "Mosque prayer timing and rakah guidance", ""),
            conv("p2", "Ju'mah prayer time today", ""),
            conv("p3", "Post salah reflection", ""),
            conv("d1", "Docker daemon connection failure", ""),
            conv("d2", "Container image build permissions", ""),
            conv("d3", "Compose volume mounting issue", ""),
        ];
        let mut emb = HashMap::new();
        for (i, u) in ["p1", "p2", "p3"].iter().enumerate() {
            emb.insert(u.to_string(), vec_on(0, 0.02 * i as f32));
        }
        for (i, u) in ["d1", "d2", "d3"].iter().enumerate() {
            emb.insert(u.to_string(), vec_on(3, 0.02 * i as f32));
        }
        let shape = |v: &[ChatCluster]| -> Vec<Vec<String>> {
            v.iter()
                .map(|c| {
                    let mut u = c.conversation_uuids.clone();
                    u.sort();
                    u
                })
                .collect()
        };
        let first = cluster_by_embedding(&convs, &all(&convs), &emb);
        convs.reverse();
        let second = cluster_by_embedding(&convs, &all(&convs), &emb);
        assert_eq!(shape(&first), shape(&second));
    }

    #[test]
    fn embedding_input_is_lowercased() {
        // nomic-embed-text returns identical vectors for many Title Case inputs;
        // lowercasing is what makes them distinct.
        let c = conv("a", "SQL Comment Syntax Troubleshooting", "");
        assert_eq!(embedding_input(&c), "sql comment syntax troubleshooting");
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
            if uuids.contains("d1") {
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
            conv("d3", "Docker multistage", "docker image multistage layers compose"),
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
