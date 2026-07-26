//! concept_hierarchy_service — LLM-assisted parent detection and topic-group
//! synthesis for `concept_nodes`.
//!
//! Two passes per tick:
//! 1. For each unparented `concept_nodes` row not recently evaluated, ask
//!    the configured background model to nominate a parent from its
//!    existing workspace peers. Accepted suggestions are written as a
//!    single `concept_links` row (`link_type='part_of'`,
//!    `source_id=child, target_id=parent`), which the sidebar tree code
//!    (`buildForest` in `src/lib/conceptTree.ts`) then renders as nesting.
//! 2. For concepts still unparented afterwards (no suitable existing peer),
//!    `synthesize_topic_groups` asks the model to cluster them into new
//!    named topic groups and materializes each as a real chapter/section
//!    pair, so a refresh can build structure even in a workspace with no
//!    pre-existing groups. Whatever still can't be placed falls through to
//!    `sweep_orphan_concepts`'s flat "Uncategorized" bucket as a last resort.
//!
//! Designed to be invoked from the background scheduler — see
//! `services::background_scheduler` — and to be safe to run alongside the
//! flashcard and summarization ticks. All DB work runs inside
//! `tokio::task::spawn_blocking` so the async runtime is never blocked.

use crate::db::DbState;
use crate::models::workspace::TopicSignature;
use crate::ollama::client::{OllamaClient, OllamaMessage};
use crate::services::concept_hierarchy::is_valid_parent_pair;
use crate::services::model_settings::{get_model_for_job, get_string_setting};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Max concepts considered per tick across all workspaces. Keeps total LLM
/// cost bounded even when many workspaces have backlog after first install.
const MAX_CANDIDATES_PER_TICK: usize = 20;
/// Max sibling concept names included in the prompt as candidate parents.
/// Workspaces are usually well under this; the cap exists as a guard rail.
const MAX_PROMPT_PEERS: usize = 200;
/// Max still-orphaned concept names sent to the group-synthesis prompt per
/// workspace per tick. Keeps the prompt small and the response fast; any
/// remainder is picked up by `sweep_orphan_concepts` and re-considered on a
/// later tick once earlier orphans have groups.
const MAX_GROUP_SYNTHESIS_CANDIDATES: usize = 40;

/// Lightweight summary of work performed in one tick. Surfaced through the
/// scheduler's `emit_task` lifecycle event so the Activity panel reflects
/// progress without leaking per-concept detail.
#[derive(Debug, Default, Clone, Serialize)]
pub struct TickReport {
    pub considered: usize,
    pub linked: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone)]
struct Candidate {
    id: String,
    workspace_id: String,
    name: String,
    hierarchy_level: String,
}

#[derive(Debug, Clone)]
struct Peer {
    id: String,
    name: String,
    hierarchy_level: String,
}

// `expected_parent_level` and `is_valid_parent_pair` come from the shared
// `concept_hierarchy` module so the chat extractor, the LLM extractor, the
// background hierarchy job (here) and the read-side tree builder all share
// the same rules.

/// Resolve the model to use for this job. Falls back to the topic-signature
/// model first (similar workload, same context-size profile), then to the
/// generic background model, then to `preferred_model`.
fn resolve_model(conn: &Connection) -> Option<String> {
    if let Some(m) = get_model_for_job(conn, "concept_hierarchy_model") {
        return Some(m);
    }
    // The plan calls for explicit fallback to the topic-signature model
    // when no per-job override is set.
    if let Some(m) = get_string_setting(conn, "topic_signature_model") {
        return Some(m);
    }
    None
}

/// Select up to `MAX_CANDIDATES_PER_TICK` unparented concepts that have not
/// been evaluated since the most recent concept was added to their workspace.
/// Concepts evaluated *before* a peer was added are re-evaluated so a parent
/// added after the child can still get linked.
fn collect_candidates(
    conn: &Connection,
    workspace_filter: Option<&[String]>,
) -> rusqlite::Result<Vec<Candidate>> {
    // Prefer concepts in the active workspace (and its parent if user is in
    // a sub-workspace) so the user sees hierarchy links forming where they're
    // working. Other workspaces still drip through after active ones are
    // exhausted within MAX_CANDIDATES_PER_TICK.
    let current_workspace_id =
        crate::services::model_settings::get_current_workspace_id(conn).unwrap_or_default();
    let mut stmt = conn.prepare(
        "SELECT cn.id, cn.workspace_id, cn.name, cn.hierarchy_level
         FROM concept_nodes cn
         WHERE NOT EXISTS (
             SELECT 1 FROM concept_links cl
             WHERE cl.source_id = cn.id AND cl.link_type = 'part_of'
         )
         AND (
             cn.parent_checked_at IS NULL
             OR cn.parent_checked_at < (
                 SELECT MAX(cn2.created_at) FROM concept_nodes cn2
                 WHERE cn2.workspace_id = cn.workspace_id
             )
         )
         ORDER BY
           CASE WHEN cn.workspace_id = ?2 THEN 0
                WHEN cn.workspace_id = (SELECT parent_workspace_id FROM workspaces WHERE id = ?2) THEN 1
                ELSE 2 END ASC,
           cn.parent_checked_at IS NULL DESC,
           cn.created_at ASC
         LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(
            rusqlite::params![MAX_CANDIDATES_PER_TICK as i64, current_workspace_id],
            |r| {
                Ok(Candidate {
                    id: r.get(0)?,
                    workspace_id: r.get(1)?,
                    name: r.get(2)?,
                    hierarchy_level: r.get(3)?,
                })
            },
        )?
        .filter(|row| match (row, workspace_filter) {
            (Ok(candidate), Some(filter)) => filter.iter().any(|ws| ws == &candidate.workspace_id),
            (Ok(_), None) => true,
            (Err(_), _) => true,
        })
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// Load every other concept in the same workspace as candidate parents.
/// Capped at `MAX_PROMPT_PEERS` (by recency) to bound prompt size.
fn load_peers(
    conn: &Connection,
    workspace_id: &str,
    exclude_id: &str,
) -> rusqlite::Result<Vec<Peer>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, hierarchy_level FROM concept_nodes
         WHERE workspace_id = ?1 AND id != ?2
         ORDER BY created_at DESC
         LIMIT ?3",
    )?;
    let rows = stmt
        .query_map(
            rusqlite::params![workspace_id, exclude_id, MAX_PROMPT_PEERS as i64],
            |r| {
                Ok(Peer {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    hierarchy_level: r.get(2)?,
                })
            },
        )?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// Walk the `part_of` chain upward from `start_id`; returns true if
/// `target_id` is reachable. Used to prevent introducing a cycle when
/// inserting `child -> parent`.
fn would_create_cycle(
    conn: &Connection,
    start_id: &str,
    target_id: &str,
) -> rusqlite::Result<bool> {
    if start_id == target_id {
        return Ok(true);
    }
    let mut current = start_id.to_string();
    // Guard against pre-existing cycles by capping iterations.
    for _ in 0..64 {
        let next: Option<String> = conn
            .query_row(
                "SELECT target_id FROM concept_links
                 WHERE source_id = ?1 AND link_type = 'part_of'
                 LIMIT 1",
                rusqlite::params![current],
                |r| r.get(0),
            )
            .ok();
        match next {
            None => return Ok(false),
            Some(parent) => {
                if parent == target_id {
                    return Ok(true);
                }
                current = parent;
            }
        }
    }
    Ok(true)
}

/// Match an LLM reply to one of the supplied peer concepts. Match is
/// case-insensitive on `name`. Lowest `created_at` wins on ties (handled by
/// the caller's load order). Returns `None` for "NONE" / empty / unmatched.
fn match_peer_by_name(reply: &str, peers: &[Peer]) -> Option<Peer> {
    let trimmed = reply
        .trim()
        .trim_matches(|c: char| c.is_ascii_punctuation() && c != '.' && c != '+' && c != '#');
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("NONE") {
        return None;
    }
    // Prefer exact (case-insensitive) match.
    if let Some(p) = peers.iter().find(|p| p.name.eq_ignore_ascii_case(trimmed)) {
        return Some(p.clone());
    }
    // Fall back to a tolerant match: the reply may include a leading phrase
    // like "Parent: cargo" — pull the last quoted or bare token.
    if let Some(p) = peers
        .iter()
        .find(|p| trimmed.to_lowercase().contains(&p.name.to_lowercase()))
    {
        return Some(p.clone());
    }
    None
}

/// Build the user prompt for one candidate. Asks the model to pick a parent
/// strictly from `peers` or reply `NONE`. The constraint is enforced
/// post-hoc by `match_peer_by_name` — the prompt is just the soft cue.
fn build_prompt(child: &str, child_level: &str, peers: &[Peer]) -> String {
    let joined = peers
        .iter()
        .map(|p| format!("{} (level: {})", p.name, p.hierarchy_level))
        .collect::<Vec<String>>()
        .join("\n - ");
    format!(
        "You are organising a knowledge map. Given the node named \"{child}\" at hierarchy level \"{child_level}\", which of the following concepts (if any) is the most natural BROADER PARENT category for it?\n\n\
         Candidate parents:\n - {joined}\n\n\
         Rules:\n\
         - A concept's parent must be a section.\n\
         - A section's parent must be a chapter.\n\
         - A chapter's parent must be NONE.\n\
         - If no peer satisfies the level rule, reply NONE.\n\
         - Reply with EXACTLY one candidate NAME (without the level annotation).\n\
         - If none of them is a clearly broader category, reply with the single word NONE.\n\
         - Do not invent new names. Do not add explanation. Do not include quotes."
    )
}

/// Persist the accepted `child -> parent` `part_of` link and stamp
/// `parent_checked_at` on the child so we don't re-evaluate it on the next
/// tick. The link insert uses `INSERT OR IGNORE` to be safe under the
/// unique index added in migration v63.
fn persist_link(conn: &Connection, child_id: &str, parent_id: &str) -> rusqlite::Result<bool> {
    let child_level: String = conn.query_row(
        "SELECT hierarchy_level FROM concept_nodes WHERE id = ?1",
        rusqlite::params![child_id],
        |r| r.get(0),
    )?;
    let parent_level: String = conn.query_row(
        "SELECT hierarchy_level FROM concept_nodes WHERE id = ?1",
        rusqlite::params![parent_id],
        |r| r.get(0),
    )?;

    if !is_valid_parent_pair(&child_level, &parent_level) {
        return Ok(false);
    }

    let new_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let inserted = conn.execute(
        "INSERT OR IGNORE INTO concept_links
            (id, source_id, target_id, link_type, strength, context, created_at)
         VALUES (?1, ?2, ?3, 'part_of', 0.7, 'auto: hierarchy job', ?4)",
        rusqlite::params![new_id, child_id, parent_id, now],
    )?;
    Ok(inserted > 0)
}

fn stamp_checked(conn: &Connection, child_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE concept_nodes SET parent_checked_at = datetime('now') WHERE id = ?1",
        rusqlite::params![child_id],
    )?;
    Ok(())
}

fn ensure_node(
    conn: &Connection,
    workspace_id: &str,
    name: &str,
    hierarchy_level: &str,
    concept_type: &str,
    description: &str,
) -> rusqlite::Result<String> {
    if let Ok(id) = conn.query_row(
        "SELECT id FROM concept_nodes
         WHERE workspace_id = ?1 AND name = ?2 AND hierarchy_level = ?3
         LIMIT 1",
        rusqlite::params![workspace_id, name, hierarchy_level],
        |r| r.get::<_, String>(0),
    ) {
        return Ok(id);
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO concept_nodes
            (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level)
         VALUES (?1, ?2, ?3, ?4, ?5, '[]', '[]', '[]', 0.0, 0.0, 0, ?6, ?6, ?7)",
        rusqlite::params![
            id,
            workspace_id,
            name,
            description,
            concept_type,
            now,
            hierarchy_level
        ],
    )?;
    Ok(id)
}

fn ensure_part_of_link(
    conn: &Connection,
    child_id: &str,
    parent_id: &str,
    context: &str,
) -> rusqlite::Result<bool> {
    let new_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let inserted = conn.execute(
        "INSERT OR IGNORE INTO concept_links
            (id, source_id, target_id, link_type, strength, context, created_at)
         VALUES (?1, ?2, ?3, 'part_of', 1.0, ?4, ?5)",
        rusqlite::params![new_id, child_id, parent_id, context, now],
    )?;
    Ok(inserted > 0)
}

#[derive(Debug, Deserialize)]
struct ProposedGroup {
    name: String,
    #[serde(default)]
    concepts: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ProposedGroups {
    #[serde(default)]
    groups: Vec<ProposedGroup>,
    /// Entries the model judged to be noise or unplaceable. Left unlinked so
    /// the orphan sweep files them under Uncategorized instead of inventing a
    /// thematic parent for them.
    #[serde(default)]
    unclassifiable: Vec<String>,
}

/// Reject group names that are themselves noise, so a model that ignores the
/// "unclassifiable" instruction can't smuggle junk in as a chapter heading.
fn is_usable_group_name(name: &str) -> bool {
    let n = name.trim();
    if n.len() < 3 || n.len() > 60 {
        return false;
    }
    if n.eq_ignore_ascii_case("uncategorized")
        || n.eq_ignore_ascii_case("unclassifiable")
        || n.eq_ignore_ascii_case("other")
        || n.eq_ignore_ascii_case("miscellaneous")
        || n.eq_ignore_ascii_case("misc")
    {
        return false;
    }
    // A real topic label contains a letter and isn't a bare identifier.
    n.chars().any(|c| c.is_alphabetic()) && !n.contains('_') && !n.starts_with('-')
}

fn strip_code_fences(input: &str) -> &str {
    let trimmed = input.trim();
    if let Some(rest) = trimmed.strip_prefix("```") {
        let rest = rest
            .trim_start_matches(|c: char| c.is_alphanumeric())
            .trim_start_matches('\n');
        if let Some(end) = rest.rfind("```") {
            return rest[..end].trim();
        }
        return rest.trim();
    }
    trimmed
}

/// Load up to `MAX_GROUP_SYNTHESIS_CANDIDATES` concepts in `workspace_id`
/// that still have no `part_of` link — i.e. the per-candidate nomination
/// pass above found no suitable existing parent for them.
fn collect_still_orphaned(
    conn: &Connection,
    workspace_id: &str,
) -> rusqlite::Result<Vec<Candidate>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, name, hierarchy_level
         FROM concept_nodes
         WHERE workspace_id = ?1
           AND hierarchy_level = 'concept'
           AND NOT EXISTS (
               SELECT 1 FROM concept_links cl
               WHERE cl.source_id = concept_nodes.id AND cl.link_type = 'part_of'
           )
         ORDER BY created_at ASC
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(
            rusqlite::params![workspace_id, MAX_GROUP_SYNTHESIS_CANDIDATES as i64],
            |r| {
                Ok(Candidate {
                    id: r.get(0)?,
                    workspace_id: r.get(1)?,
                    name: r.get(2)?,
                    hierarchy_level: r.get(3)?,
                })
            },
        )?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

fn build_group_synthesis_prompt(names: &[String]) -> String {
    let joined = names
        .iter()
        .map(|n| format!("- {n}"))
        .collect::<Vec<String>>()
        .join("\n");
    format!(
        "You are organising a knowledge map. Group the following concepts into a small \
         number of clearly named topic groups (2-6 words each, e.g. \"Databases\", \
         \"Python Fundamentals\"). Group only concepts that are genuinely related to each \
         other; prefer fewer, broader groups over many narrow ones.\n\n\
         Some entries will be noise — variable names, CLI flags, file or person names, or \
         terms too vague to be a subject. Put every such entry, and anything you cannot \
         confidently place with related concepts, in \"unclassifiable\". Never invent a \
         thematic group to house an entry that does not fit one; assigning an unrelated \
         concept to a plausible-sounding group is worse than leaving it unclassified.\n\n\
         Concepts:\n{joined}\n\n\
         Reply with ONLY a JSON object of this exact shape, no explanation, no markdown \
         fences:\n\
         {{\"groups\": [{{\"name\": \"Group Name\", \"concepts\": [\"concept 1\", \"concept 2\"]}}], \
         \"unclassifiable\": [\"noise 1\"]}}"
    )
}

/// Ask the LLM to cluster still-unparented concepts in `workspace_id` into
/// named topic groups, then materialize each proposed group as a real
/// chapter + section pair and link the matched concepts underneath.
///
/// This is what lets "Refresh Knowledge Map" build actual structure instead
/// of only being able to sort concepts under groups a human (or the old
/// single-shot Analyze flow) already created. Concepts the model doesn't
/// place, or that don't match by name, are left for `sweep_orphan_concepts`
/// to catch so nothing silently disappears from the map.
async fn synthesize_topic_groups(
    state: &DbState,
    ollama_url: Option<String>,
    workspace_id: &str,
    model: &str,
) -> Result<usize, String> {
    let orphans = {
        let pool = state.0.clone();
        let ws = workspace_id.to_string();
        tokio::task::spawn_blocking(move || -> rusqlite::Result<Vec<Candidate>> {
            let conn = pool.get().map_err(|e| {
                rusqlite::Error::InvalidParameterName(e.to_string())
            })?;
            collect_still_orphaned(&conn, &ws)
        })
        .await
        .map_err(|e| format!("spawn_blocking join error: {e}"))?
        .map_err(|e| e.to_string())?
    };

    if orphans.len() < 2 {
        // Not enough ungrouped concepts to justify a synthesis call — a
        // single leftover concept goes to the Uncategorized sweep instead.
        return Ok(0);
    }

    let names: Vec<String> = orphans.iter().map(|c| c.name.clone()).collect();
    let prompt = build_group_synthesis_prompt(&names);
    let client = OllamaClient::new(ollama_url)?;
    let msgs = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    let reply = client
        .send_message_with_options("concept_hierarchy_service_groups", model, msgs, Some("0s"))
        .await
        .map_err(|e| e.to_string())?;

    let cleaned = strip_code_fences(&reply);
    let parsed: ProposedGroups = serde_json::from_str(cleaned)
        .map_err(|e| format!("could not parse group synthesis reply: {e}"))?;

    if parsed.groups.is_empty() {
        return Ok(0);
    }

    let by_name: std::collections::HashMap<String, String> = orphans
        .into_iter()
        .map(|c| (c.name.trim().to_lowercase(), c.id))
        .collect();

    let pool = state.0.clone();
    let workspace_id = workspace_id.to_string();
    let linked = tokio::task::spawn_blocking(move || -> rusqlite::Result<usize> {
        let conn = pool.get().map_err(|e| {
            rusqlite::Error::InvalidParameterName(e.to_string())
        })?;
        // Entries the model flagged as noise are skipped entirely; the orphan
        // sweep files them under Uncategorized.
        let unclassifiable: std::collections::HashSet<String> = parsed
            .unclassifiable
            .iter()
            .map(|n| n.trim().to_lowercase())
            .collect();

        let mut linked = 0usize;
        for group in &parsed.groups {
            let group_name = group.name.trim();
            if !is_usable_group_name(group_name) {
                continue;
            }
            let matched: Vec<&String> = group
                .concepts
                .iter()
                .filter(|name| !unclassifiable.contains(&name.trim().to_lowercase()))
                .filter_map(|name| by_name.get(&name.trim().to_lowercase()))
                .collect();
            // A "group" holding one concept is usually the model shoehorning an
            // unrelated entry somewhere rather than a real theme.
            if matched.len() < 2 {
                continue;
            }

            let chapter_id = ensure_node(
                &conn,
                &workspace_id,
                group_name,
                "chapter",
                "topic",
                "",
            )?;
            let section_id = ensure_node(
                &conn,
                &workspace_id,
                group_name,
                "section",
                "topic",
                "",
            )?;
            let _ = ensure_part_of_link(
                &conn,
                &section_id,
                &chapter_id,
                "auto: hierarchy group synthesis",
            )?;
            for concept_id in matched {
                if ensure_part_of_link(
                    &conn,
                    concept_id,
                    &section_id,
                    "auto: hierarchy group synthesis",
                )? {
                    linked += 1;
                }
            }
        }
        Ok(linked)
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
    .map_err(|e| e.to_string())?;

    Ok(linked)
}

fn sweep_orphan_concepts(conn: &Connection, workspace_id: &str) -> rusqlite::Result<usize> {
    let chapter_id = ensure_node(
        conn,
        workspace_id,
        "Uncategorized",
        "chapter",
        "topic",
        "Concepts that have not yet been organized into a chapter.",
    )?;
    let section_id = ensure_node(
        conn,
        workspace_id,
        "Topics",
        "section",
        "topic",
        "Auto-grouped uncategorized concepts.",
    )?;

    let _ = ensure_part_of_link(
        conn,
        &section_id,
        &chapter_id,
        "auto: hierarchy orphan sweep",
    )?;

    let mut stmt = conn.prepare(
        "SELECT n.id
         FROM concept_nodes n
         WHERE n.workspace_id = ?1
           AND n.hierarchy_level = 'concept'
           AND NOT EXISTS (
               SELECT 1 FROM concept_links l
               WHERE l.source_id = n.id AND l.link_type = 'part_of'
           )",
    )?;
    let orphan_ids: Vec<String> = stmt
        .query_map(rusqlite::params![workspace_id], |r| r.get::<_, String>(0))?
        .filter_map(Result::ok)
        .collect();

    let mut linked = 0usize;
    for orphan_id in orphan_ids {
        if ensure_part_of_link(
            conn,
            &orphan_id,
            &section_id,
            "auto: hierarchy orphan sweep",
        )? {
            linked += 1;
        }
    }
    Ok(linked)
}

/// Rebuild the heuristic topic signature for `workspace_id` when the stored
/// one has no tags to seed from.
///
/// A knowledge reset (Data Controls) clears `workspaces.topic_signature`, and
/// nothing else in the graph-scoped refresh path recreates it. The heuristic
/// rebuild here is pure text processing over existing chat messages, so it
/// runs on every tick regardless of Ollama reachability and still feeds
/// prompts/UI immediately. Actually upgrading the signature to Ollama-backed
/// tags (which is what makes it eligible to publish as roadmap topics \u2014 see
/// `flashcard_topic_service::sync_concepts_from_signatures`) is handled
/// separately and rate-limited by
/// `topic_signature::ensure_ai_enriched_signature`, called earlier in this
/// same tick.
fn ensure_signature_seed(conn: &Connection, workspace_id: &str) {
    let sig_json: String = match conn.query_row(
        "SELECT topic_signature FROM workspaces WHERE id = ?1",
        rusqlite::params![workspace_id],
        |r| r.get(0),
    ) {
        Ok(s) => s,
        Err(_) => return,
    };
    let sig: TopicSignature = serde_json::from_str(&sig_json).unwrap_or_default();
    if sig.auto_detected_tags.is_empty() && sig.custom_tags.is_empty() {
        let _ = crate::services::topic_signature::recompute_workspace_signature(conn, workspace_id);
    }
}

/// Background scheduler tick. Picks up to `MAX_CANDIDATES_PER_TICK`
/// unparented concepts (across all workspaces) and asks the configured
/// model for a parent for each. Resilient to LLM failures — a failed call
/// for one candidate doesn't abort the rest, and the candidate's
/// `parent_checked_at` is *not* stamped on transport errors so the tick
/// will retry it next time.
pub async fn tick(state: &DbState, ollama_url: Option<String>) -> Result<TickReport, String> {
    tick_for_workspaces(state, ollama_url, None).await
}

pub async fn tick_for_workspaces(
    state: &DbState,
    ollama_url: Option<String>,
    workspace_filter: Option<&[String]>,
) -> Result<TickReport, String> {
    let mut report = TickReport::default();
    let mut touched_workspaces: HashSet<String> = HashSet::new();
    let workspace_filter = workspace_filter.map(|ids| ids.to_vec());

    // Auto-upgrade never-enriched workspaces via background AI enrichment
    // (silent no-op when Ollama is unreachable or rate-limited) before the
    // signature-seeding / concept-sync loop below runs against the signature.
    let enrichment_ws_ids: Vec<String> = match workspace_filter.as_deref() {
        Some(ids) => ids.to_vec(),
        None => {
            let pool = state.0.clone();
            tokio::task::spawn_blocking(move || -> Vec<String> {
                let Ok(conn) = pool.get() else {
                    return Vec::new();
                };
                conn.prepare("SELECT id FROM workspaces WHERE is_hidden = 0")
                    .and_then(|mut stmt| {
                        stmt.query_map([], |r| r.get::<_, String>(0))?
                            .collect::<Result<Vec<_>, _>>()
                    })
                    .unwrap_or_default()
            })
            .await
            .unwrap_or_default()
        }
    };
    for ws_id in &enrichment_ws_ids {
        crate::services::topic_signature::ensure_ai_enriched_signature(state, ws_id).await;
    }

    type CandidateGatherResult = Result<(Vec<Candidate>, Option<String>, Vec<String>), String>;

    let (candidates, model, ws_ids) = {
        let pool = state.0.clone();
        let workspace_filter = workspace_filter.clone();
        tokio::task::spawn_blocking(
            move || -> CandidateGatherResult {
                let conn = pool.get().map_err(|e| e.to_string())?;
                // Seed concept nodes from each workspace's topic signature
                // before collecting candidates, so a graph-scoped refresh
                // creates nodes and proposes links in the same pass instead
                // of depending on the flashcard tick having run first.
                let ws_ids: Vec<String> = match workspace_filter.as_deref() {
                    Some(ids) => ids.to_vec(),
                    None => {
                        let mut stmt = conn
                            .prepare("SELECT id FROM workspaces WHERE is_hidden = 0")
                            .map_err(|e| e.to_string())?;
                        let ids = stmt
                            .query_map([], |r| r.get::<_, String>(0))
                            .map_err(|e| e.to_string())?
                            .filter_map(Result::ok)
                            .collect();
                        ids
                    }
                };
                for ws_id in &ws_ids {
                    ensure_signature_seed(&conn, ws_id);
                    let _ = crate::services::flashcard_topic_service::sync_concepts_from_signatures(
                        &conn, ws_id,
                    );
                }
                let model = resolve_model(&conn);
                let cands = collect_candidates(&conn, workspace_filter.as_deref())
                    .map_err(|e| e.to_string())?;
                Ok((cands, model, ws_ids))
            },
        )
        .await
        .map_err(|e| format!("spawn_blocking join error: {e}"))??
    };

    let Some(model) = model else {
        return Ok(report);
    };

    // Even when every concept has already been checked for a parent (so
    // `candidates` is empty), a workspace can still have orphaned concepts
    // that never made it into a topic group — e.g. group synthesis found
    // fewer than two orphans on a prior tick, or an earlier synthesis call
    // failed silently. Always run synthesis + the Uncategorized sweep for
    // every workspace in scope, not just ones touched by the nomination
    // loop below, so "Refresh Knowledge Map" can't report success while
    // leaving concepts permanently unplaced.
    if candidates.is_empty() {
        return sweep_and_synthesize(state, ollama_url, &ws_ids, &model, report).await;
    }

    let ollama_url_for_synthesis = ollama_url.clone();
    let Ok(client) = OllamaClient::new(ollama_url) else {
        return Ok(report);
    };

    for cand in candidates {
        report.considered += 1;
        touched_workspaces.insert(cand.workspace_id.clone());

        // Load peers (per workspace) on the blocking pool.
        let peers = {
            let pool = state.0.clone();
            let ws = cand.workspace_id.clone();
            let id = cand.id.clone();
            tokio::task::spawn_blocking(move || -> Result<Vec<Peer>, String> {
                let conn = pool.get().map_err(|e| e.to_string())?;
                load_peers(&conn, &ws, &id).map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| format!("spawn_blocking join error: {e}"))??
        };
        if peers.is_empty() {
            // No siblings — stamp and move on so we don't reconsider every tick.
            let pool = state.0.clone();
            let id = cand.id.clone();
            let _ = tokio::task::spawn_blocking(move || -> Result<(), String> {
                let conn = pool.get().map_err(|e| e.to_string())?;
                stamp_checked(&conn, &id).map_err(|e| e.to_string())
            })
            .await;
            report.skipped += 1;
            continue;
        }

        let prompt = build_prompt(&cand.name, &cand.hierarchy_level, &peers);
        let msgs = vec![OllamaMessage {
            role: "user".to_string(),
            content: prompt,
        }];

        let reply = match client
            .send_message_with_options("concept_hierarchy_service", &model, msgs, Some("0s"))
            .await
        {
            Ok(r) => r,
            Err(_) => {
                // Transport / model error: leave parent_checked_at alone so
                // we try again next tick.
                continue;
            }
        };

        let chosen = match_peer_by_name(&reply, &peers);

        let cand_id = cand.id.clone();
        let chosen_id = chosen.as_ref().map(|p| p.id.clone());

        let outcome = {
            let pool = state.0.clone();
            tokio::task::spawn_blocking(move || -> Result<bool, String> {
                let conn = pool.get().map_err(|e| e.to_string())?;
                let did_link = if let Some(parent_id) = &chosen_id {
                    if would_create_cycle(&conn, parent_id, &cand_id).map_err(|e| e.to_string())? {
                        false
                    } else {
                        persist_link(&conn, &cand_id, parent_id).map_err(|e| e.to_string())?
                    }
                } else {
                    false
                };
                stamp_checked(&conn, &cand_id).map_err(|e| e.to_string())?;
                Ok(did_link)
            })
            .await
            .map_err(|e| format!("spawn_blocking join error: {e}"))?
        };

        match outcome {
            Ok(true) => report.linked += 1,
            Ok(false) => report.skipped += 1,
            Err(_) => report.skipped += 1,
        }
    }

    if !touched_workspaces.is_empty() {
        let workspaces: Vec<String> = touched_workspaces.into_iter().collect();
        return sweep_and_synthesize(state, ollama_url_for_synthesis, &workspaces, &model, report)
            .await;
    }

    Ok(report)
}

/// Cluster still-unparented concepts into real topic groups, then dump
/// whatever's left into the flat "Uncategorized" bucket. Shared by the
/// per-candidate nomination path above and the early-out path taken when
/// every concept has already been checked for a parent but some were never
/// placed into a group (see the `candidates.is_empty()` branch above).
async fn sweep_and_synthesize(
    state: &DbState,
    ollama_url: Option<String>,
    workspaces: &[String],
    model: &str,
    report: TickReport,
) -> Result<TickReport, String> {
    for ws in workspaces {
        let _ = synthesize_topic_groups(state, ollama_url.clone(), ws, model).await;
    }

    let pool = state.0.clone();
    let workspaces = workspaces.to_vec();
    let _ = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        for ws in &workspaces {
            let _ = sweep_orphan_concepts(&conn, ws);
        }
        Ok(())
    })
    .await;

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;

    #[test]
    fn rejects_placeholder_and_identifier_group_names() {
        assert!(is_usable_group_name("Databases"));
        assert!(is_usable_group_name("Python Fundamentals"));
        assert!(!is_usable_group_name("Uncategorized"));
        assert!(!is_usable_group_name("misc"));
        assert!(!is_usable_group_name("Other"));
        assert!(!is_usable_group_name("db_conn"));
        assert!(!is_usable_group_name("--verbose"));
        assert!(!is_usable_group_name("x"));
        assert!(!is_usable_group_name("   "));
    }

    #[test]
    fn synthesis_prompt_offers_an_escape_hatch() {
        // Regression: the old prompt required every concept to land in a
        // group, which forced unrelated entries under plausible-sounding
        // parents (e.g. "psql" filed under "GPU Computing").
        let prompt = build_group_synthesis_prompt(&["psql".to_string(), "cuda".to_string()]);
        assert!(prompt.contains("unclassifiable"));
        assert!(!prompt.contains("must appear in exactly one group"));
    }

    #[test]
    fn unclassifiable_entries_are_not_linked_into_groups() {
        let reply = r#"{"groups":[{"name":"GPU Computing","concepts":["cuda","kernels","psql"]}],
                        "unclassifiable":["psql"]}"#;
        let parsed: ProposedGroups = serde_json::from_str(reply).unwrap();
        let unclassifiable: std::collections::HashSet<String> = parsed
            .unclassifiable
            .iter()
            .map(|n| n.trim().to_lowercase())
            .collect();
        let kept: Vec<&String> = parsed.groups[0]
            .concepts
            .iter()
            .filter(|n| !unclassifiable.contains(&n.trim().to_lowercase()))
            .collect();
        assert_eq!(kept.len(), 2);
        assert!(!kept.iter().any(|n| n.as_str() == "psql"));
    }

    #[test]
    fn missing_unclassifiable_key_still_parses() {
        // Older/smaller models may omit the field entirely.
        let parsed: ProposedGroups =
            serde_json::from_str(r#"{"groups":[{"name":"Databases","concepts":["a","b"]}]}"#)
                .unwrap();
        assert!(parsed.unclassifiable.is_empty());
        assert_eq!(parsed.groups.len(), 1);
    }

    fn insert_ws(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT OR IGNORE INTO workspaces (id, name, created_at, updated_at)
             VALUES (?1, 'WS', datetime('now'), datetime('now'))",
            rusqlite::params![id],
        )
        .unwrap();
    }

    fn insert_concept(conn: &Connection, id: &str, ws: &str, name: &str) {
        conn.execute(
            "INSERT INTO concept_nodes
                (id, workspace_id, name, concept_description, concept_type, tags, aliases,
                 references_json, x_position, y_position, review_count, hierarchy_level,
                 created_at, updated_at)
             VALUES (?1, ?2, ?3, '', 'topic', '[]', '[]', '[]', 0.0, 0.0, 0,
                     'concept', datetime('now'), datetime('now'))",
            rusqlite::params![id, ws, name],
        )
        .unwrap();
    }

    fn insert_node_at_level(conn: &Connection, id: &str, ws: &str, name: &str, level: &str) {
        conn.execute(
            "INSERT INTO concept_nodes
                (id, workspace_id, name, concept_description, concept_type, tags, aliases,
                 references_json, x_position, y_position, review_count, hierarchy_level,
                 created_at, updated_at)
             VALUES (?1, ?2, ?3, '', 'topic', '[]', '[]', '[]', 0.0, 0.0, 0,
                     ?4, datetime('now'), datetime('now'))",
            rusqlite::params![id, ws, name, level],
        )
        .unwrap();
    }

    fn insert_part_of(conn: &Connection, child: &str, parent: &str) {
        conn.execute(
            "INSERT INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at)
             VALUES (?1, ?2, ?3, 'part_of', 0.5, '', datetime('now'))",
            rusqlite::params![uuid::Uuid::new_v4().to_string(), child, parent],
        )
        .unwrap();
    }

    #[test]
    fn ensure_signature_seed_rebuilds_cleared_signature_from_chat_text() {
        // Regression: after a knowledge reset wipes `topic_signature` to '{}',
        // the graph refresh must be able to rebuild the seed on its own
        // instead of waiting for the periodic AI signature loop.
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_ws(&conn, "w1");
        conn.execute(
            "INSERT INTO chat_sessions (id, workspace_id) VALUES ('s1', 'w1')",
            [],
        )
        .unwrap();
        for (id, content) in [
            ("m1", "How do I tune postgresql indexes for large tables?"),
            ("m2", "Explain postgresql vacuum and autovacuum tuning"),
            ("m3", "Set up postgresql replication and failover"),
        ] {
            conn.execute(
                "INSERT INTO messages (id, session_id, role, content) VALUES (?1, 's1', 'user', ?2)",
                rusqlite::params![id, content],
            )
            .unwrap();
        }

        ensure_signature_seed(&conn, "w1");

        let sig_json: String = conn
            .query_row(
                "SELECT topic_signature FROM workspaces WHERE id = 'w1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let sig: TopicSignature = serde_json::from_str(&sig_json).unwrap();
        assert!(
            !sig.auto_detected_tags.is_empty(),
            "heuristic signature should be rebuilt from chat text"
        );

        // Heuristic-only tags never become roadmap topics (too noisy without
        // Ollama enrichment) — sync should seed nothing until enrichment runs.
        crate::services::flashcard_topic_service::sync_concepts_from_signatures(&conn, "w1")
            .unwrap();
        let seeded: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = 'w1' AND hierarchy_level = 'concept'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            seeded, 0,
            "heuristic-only signature should not publish concept nodes"
        );
    }

    #[test]
    fn ensure_signature_seed_leaves_populated_signature_alone() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_ws(&conn, "w1");
        let populated = serde_json::to_string(&TopicSignature {
            auto_detected_tags: vec![crate::models::workspace::TopicTag {
                tag: "rust".to_string(),
                weight: 5,
                source: "heuristic".to_string(),
            }],
            ..TopicSignature::default()
        })
        .unwrap();
        conn.execute(
            "UPDATE workspaces SET topic_signature = ?1 WHERE id = 'w1'",
            rusqlite::params![populated],
        )
        .unwrap();

        ensure_signature_seed(&conn, "w1");

        let sig_json: String = conn
            .query_row(
                "SELECT topic_signature FROM workspaces WHERE id = 'w1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sig_json, populated, "populated signatures must not be recomputed");
    }

    #[test]
    fn collect_candidates_skips_already_linked_concepts() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_ws(&conn, "w1");
        insert_concept(&conn, "c_cargo", "w1", "cargo");
        insert_concept(&conn, "c_toml", "w1", "cargo.toml");
        insert_part_of(&conn, "c_toml", "c_cargo");

        let cands = collect_candidates(&conn, None).unwrap();
        let names: Vec<_> = cands.iter().map(|c| c.name.as_str()).collect();
        assert!(
            names.contains(&"cargo"),
            "unparented concepts should be candidates"
        );
        assert!(
            !names.contains(&"cargo.toml"),
            "concepts with an existing part_of link must be excluded"
        );
    }

    #[test]
    fn would_create_cycle_detects_loops() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_ws(&conn, "w1");
        insert_concept(&conn, "a", "w1", "A");
        insert_concept(&conn, "b", "w1", "B");
        // a -> b
        insert_part_of(&conn, "a", "b");
        // Trying to add b -> a would create a cycle.
        assert!(would_create_cycle(&conn, "a", "b").unwrap());
        assert!(!would_create_cycle(&conn, "b", "a").unwrap()); // walking up from b finds nothing
    }

    #[test]
    fn match_peer_by_name_accepts_case_insensitive_and_none() {
        let peers = vec![
            Peer {
                id: "1".into(),
                name: "Cargo".into(),
                hierarchy_level: "section".into(),
            },
            Peer {
                id: "2".into(),
                name: "Rust".into(),
                hierarchy_level: "section".into(),
            },
        ];
        assert_eq!(
            match_peer_by_name("cargo", &peers).map(|p| p.id),
            Some("1".into())
        );
        assert_eq!(
            match_peer_by_name(" RUST ", &peers).map(|p| p.id),
            Some("2".into())
        );
        assert!(match_peer_by_name("NONE", &peers).is_none());
        assert!(match_peer_by_name("", &peers).is_none());
        assert!(match_peer_by_name("Python", &peers).is_none());
    }

    #[test]
    fn persist_link_is_idempotent_under_unique_index() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_ws(&conn, "w1");
        // Child must be a section if parent is a chapter — the level guard
        // added in `persist_link` enforces the chapter/section/concept rules.
        insert_node_at_level(&conn, "child", "w1", "cargo.toml", "section");
        insert_node_at_level(&conn, "parent", "w1", "cargo", "chapter");

        assert!(persist_link(&conn, "child", "parent").unwrap());
        // Second call must not insert a duplicate row.
        assert!(!persist_link(&conn, "child", "parent").unwrap());
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM concept_links WHERE source_id = 'child' AND target_id = 'parent' AND link_type = 'part_of'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn stamp_checked_updates_parent_checked_at() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_ws(&conn, "w1");
        insert_concept(&conn, "c1", "w1", "thing");
        stamp_checked(&conn, "c1").unwrap();
        let value: Option<String> = conn
            .query_row(
                "SELECT parent_checked_at FROM concept_nodes WHERE id = 'c1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            value.is_some(),
            "parent_checked_at should be populated after stamp"
        );
    }

    #[test]
    fn strip_code_fences_removes_markdown_wrapping() {
        let wrapped = "```json\n{\"groups\": []}\n```";
        assert_eq!(strip_code_fences(wrapped), "{\"groups\": []}");
        assert_eq!(strip_code_fences("{\"groups\": []}"), "{\"groups\": []}");
    }

    #[test]
    fn parses_proposed_groups_json() {
        let raw = r#"{"groups": [{"name": "Databases", "concepts": ["postgresql", "psql"]}]}"#;
        let parsed: ProposedGroups = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.groups.len(), 1);
        assert_eq!(parsed.groups[0].name, "Databases");
        assert_eq!(parsed.groups[0].concepts, vec!["postgresql", "psql"]);
    }

    #[test]
    fn collect_still_orphaned_only_returns_unparented_concepts() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_ws(&conn, "w1");
        insert_concept(&conn, "c_orphan", "w1", "postgresql");
        insert_concept(&conn, "c_linked", "w1", "cargo.toml");
        insert_node_at_level(&conn, "parent", "w1", "cargo", "section");
        insert_part_of(&conn, "c_linked", "parent");

        let orphans = collect_still_orphaned(&conn, "w1").unwrap();
        let names: Vec<_> = orphans.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"postgresql"));
        assert!(!names.contains(&"cargo.toml"));
    }

    #[test]
    fn stamped_but_ungrouped_concepts_stay_visible_to_orphan_sweep() {
        // Regression test: a concept that has already been checked for a
        // parent (stamp_checked, e.g. because no suitable peer existed) but
        // never got linked into any group must still surface as a candidate
        // for group synthesis / the Uncategorized sweep. Before this fix,
        // `tick_for_workspaces` bailed out entirely once `collect_candidates`
        // was empty — permanently stranding concepts like this one with no
        // parent link and no Uncategorized bucket, even though a "refresh"
        // reported success.
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_ws(&conn, "w1");
        insert_concept(&conn, "c_orphan", "w1", "postgresql");
        stamp_checked(&conn, "c_orphan").unwrap();

        // Already checked and stamped, so the per-tick nomination pass has
        // nothing left to do...
        let cands = collect_candidates(&conn, None).unwrap();
        assert!(
            cands.is_empty(),
            "concept should be excluded from re-nomination once stamped"
        );

        // ...but it was never actually placed into a group, so it must
        // still be found by the synthesis/sweep pass.
        let orphans = collect_still_orphaned(&conn, "w1").unwrap();
        let names: Vec<_> = orphans.iter().map(|c| c.name.as_str()).collect();
        assert!(
            names.contains(&"postgresql"),
            "stamped-but-unplaced concepts must remain visible to sweep/synthesis"
        );
    }

    #[test]
    fn group_synthesis_materializes_chapter_section_and_links() {
        // Exercises the DB-writing half of `synthesize_topic_groups` directly
        // (the LLM call itself isn't exercised here — no Ollama in tests) by
        // replicating its matching + materialization logic against a fixed
        // parsed response, the same way the function does after parsing.
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_ws(&conn, "w1");
        insert_concept(&conn, "c1", "w1", "postgresql");
        insert_concept(&conn, "c2", "w1", "psql");

        let parsed: ProposedGroups = serde_json::from_str(
            r#"{"groups": [{"name": "Databases", "concepts": ["postgresql", "psql"]}]}"#,
        )
        .unwrap();

        let by_name: std::collections::HashMap<String, String> = [
            ("postgresql".to_string(), "c1".to_string()),
            ("psql".to_string(), "c2".to_string()),
        ]
        .into_iter()
        .collect();

        for group in &parsed.groups {
            let group_name = group.name.trim();
            let matched: Vec<&String> = group
                .concepts
                .iter()
                .filter_map(|name| by_name.get(&name.trim().to_lowercase()))
                .collect();
            assert!(!matched.is_empty());

            let chapter_id = ensure_node(&conn, "w1", group_name, "chapter", "topic", "").unwrap();
            let section_id = ensure_node(&conn, "w1", group_name, "section", "topic", "").unwrap();
            ensure_part_of_link(&conn, &section_id, &chapter_id, "test").unwrap();
            for concept_id in matched {
                ensure_part_of_link(&conn, concept_id, &section_id, "test").unwrap();
            }
        }

        let chapter_name: String = conn
            .query_row(
                "SELECT name FROM concept_nodes WHERE workspace_id = 'w1' AND hierarchy_level = 'chapter'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(chapter_name, "Databases");

        let linked_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM concept_links cl
                 JOIN concept_nodes cn ON cn.id = cl.source_id
                 WHERE cn.workspace_id = 'w1' AND cl.link_type = 'part_of' AND cn.hierarchy_level = 'concept'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(linked_count, 2, "both concepts should be linked under the new section");
    }
}
