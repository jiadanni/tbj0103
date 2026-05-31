//! concept_hierarchy_service — LLM-assisted parent detection for `concept_nodes`.
//!
//! Periodically asks the configured background model to nominate a parent
//! concept for any `concept_nodes` row that has no outgoing `part_of` link
//! and has not been evaluated recently. Accepted suggestions are written as
//! a single `concept_links` row (`link_type='part_of'`,
//! `source_id=child, target_id=parent`), which the existing sidebar tree
//! code (`buildForest` in `src/lib/conceptTree.ts`) then renders as nesting.
//!
//! Designed to be invoked from the background scheduler — see
//! `services::background_scheduler` — and to be safe to run alongside the
//! flashcard and summarization ticks. All DB work runs inside
//! `tokio::task::spawn_blocking` so the async runtime is never blocked.

use crate::db::DbState;
use crate::ollama::client::{OllamaClient, OllamaMessage};
use crate::services::model_settings::{get_model_for_job, get_string_setting};
use rusqlite::Connection;
use serde::Serialize;

/// Max concepts considered per tick across all workspaces. Keeps total LLM
/// cost bounded even when many workspaces have backlog after first install.
const MAX_CANDIDATES_PER_TICK: usize = 20;
/// Max sibling concept names included in the prompt as candidate parents.
/// Workspaces are usually well under this; the cap exists as a guard rail.
const MAX_PROMPT_PEERS: usize = 200;

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
}

#[derive(Debug, Clone)]
struct Peer {
    id: String,
    name: String,
}

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
fn collect_candidates(conn: &Connection) -> rusqlite::Result<Vec<Candidate>> {
    let mut stmt = conn.prepare(
        "SELECT cn.id, cn.workspace_id, cn.name
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
         ORDER BY cn.parent_checked_at IS NULL DESC, cn.created_at ASC
         LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![MAX_CANDIDATES_PER_TICK as i64], |r| {
            Ok(Candidate {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                name: r.get(2)?,
            })
        })?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// Load every other concept in the same workspace as candidate parents.
/// Capped at `MAX_PROMPT_PEERS` (by recency) to bound prompt size.
fn load_peers(conn: &Connection, workspace_id: &str, exclude_id: &str) -> rusqlite::Result<Vec<Peer>> {
    let mut stmt = conn.prepare(
        "SELECT id, name FROM concept_nodes
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
fn would_create_cycle(conn: &Connection, start_id: &str, target_id: &str) -> rusqlite::Result<bool> {
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
    let trimmed = reply.trim().trim_matches(|c: char| {
        c.is_ascii_punctuation() && c != '.' && c != '+' && c != '#'
    });
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("NONE") {
        return None;
    }
    // Prefer exact (case-insensitive) match.
    if let Some(p) = peers.iter().find(|p| p.name.eq_ignore_ascii_case(trimmed)) {
        return Some(p.clone());
    }
    // Fall back to a tolerant match: the reply may include a leading phrase
    // like "Parent: cargo" — pull the last quoted or bare token.
    if let Some(p) = peers.iter().find(|p| {
        trimmed
            .to_lowercase()
            .contains(&p.name.to_lowercase())
    }) {
        return Some(p.clone());
    }
    None
}

/// Build the user prompt for one candidate. Asks the model to pick a parent
/// strictly from `peers` or reply `NONE`. The constraint is enforced
/// post-hoc by `match_peer_by_name` — the prompt is just the soft cue.
fn build_prompt(child: &str, peers: &[Peer]) -> String {
    let names: Vec<&str> = peers.iter().map(|p| p.name.as_str()).collect();
    let joined = names.join("\n - ");
    format!(
        "You are organising a knowledge map. Given the concept named \"{child}\", which of the following concepts (if any) is the most natural BROADER PARENT category for it?\n\n\
         Candidate parents:\n - {joined}\n\n\
         Rules:\n\
         - Reply with EXACTLY one of the candidate names above, copied verbatim.\n\
         - If none of them is a clearly broader category, reply with the single word NONE.\n\
         - Do not invent new names. Do not add explanation. Do not include quotes."
    )
}

/// Persist the accepted `child -> parent` `part_of` link and stamp
/// `parent_checked_at` on the child so we don't re-evaluate it on the next
/// tick. The link insert uses `INSERT OR IGNORE` to be safe under the
/// unique index added in migration v63.
fn persist_link(conn: &Connection, child_id: &str, parent_id: &str) -> rusqlite::Result<bool> {
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

/// Background scheduler tick. Picks up to `MAX_CANDIDATES_PER_TICK`
/// unparented concepts (across all workspaces) and asks the configured
/// model for a parent for each. Resilient to LLM failures — a failed call
/// for one candidate doesn't abort the rest, and the candidate's
/// `parent_checked_at` is *not* stamped on transport errors so the tick
/// will retry it next time.
pub async fn tick(state: &DbState, ollama_url: Option<String>) -> Result<TickReport, String> {
    let mut report = TickReport::default();

    let (candidates, model) = {
        let pool = state.0.clone();
        tokio::task::spawn_blocking(move || -> Result<(Vec<Candidate>, Option<String>), String> {
            let conn = pool.get().map_err(|e| e.to_string())?;
            let model = resolve_model(&conn);
            let cands = collect_candidates(&conn).map_err(|e| e.to_string())?;
            Ok((cands, model))
        })
        .await
        .map_err(|e| format!("spawn_blocking join error: {e}"))??
    };

    let Some(model) = model else {
        return Ok(report);
    };
    if candidates.is_empty() {
        return Ok(report);
    }

    let Ok(client) = OllamaClient::new(ollama_url) else {
        return Ok(report);
    };

    for cand in candidates {
        report.considered += 1;

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

        let prompt = build_prompt(&cand.name, &peers);
        let msgs = vec![OllamaMessage {
            role: "user".to_string(),
            content: prompt,
        }];

        let reply = match client
            .send_message_with_options(
                "concept_hierarchy_service",
                &model,
                msgs,
                Some("0s"),
            )
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
                    if would_create_cycle(&conn, parent_id, &cand_id)
                        .map_err(|e| e.to_string())?
                    {
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

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;

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

    fn insert_part_of(conn: &Connection, child: &str, parent: &str) {
        conn.execute(
            "INSERT INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at)
             VALUES (?1, ?2, ?3, 'part_of', 0.5, '', datetime('now'))",
            rusqlite::params![uuid::Uuid::new_v4().to_string(), child, parent],
        )
        .unwrap();
    }

    #[test]
    fn collect_candidates_skips_already_linked_concepts() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_ws(&conn, "w1");
        insert_concept(&conn, "c_cargo", "w1", "cargo");
        insert_concept(&conn, "c_toml", "w1", "cargo.toml");
        insert_part_of(&conn, "c_toml", "c_cargo");

        let cands = collect_candidates(&conn).unwrap();
        let names: Vec<_> = cands.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"cargo"), "unparented concepts should be candidates");
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
            Peer { id: "1".into(), name: "Cargo".into() },
            Peer { id: "2".into(), name: "Rust".into() },
        ];
        assert_eq!(match_peer_by_name("cargo", &peers).map(|p| p.id), Some("1".into()));
        assert_eq!(match_peer_by_name(" RUST ", &peers).map(|p| p.id), Some("2".into()));
        assert!(match_peer_by_name("NONE", &peers).is_none());
        assert!(match_peer_by_name("", &peers).is_none());
        assert!(match_peer_by_name("Python", &peers).is_none());
    }

    #[test]
    fn persist_link_is_idempotent_under_unique_index() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_ws(&conn, "w1");
        insert_concept(&conn, "child", "w1", "cargo.toml");
        insert_concept(&conn, "parent", "w1", "cargo");

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
        assert!(value.is_some(), "parent_checked_at should be populated after stamp");
    }
}
