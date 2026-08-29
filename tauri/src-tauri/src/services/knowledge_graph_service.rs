//! knowledge_graph_service — core knowledge-graph domain logic.
//!
//! Extracted from `commands::knowledge_graph` so the Tauri command layer stays
//! thin (validate input, acquire the pool, delegate, return the result). Owns
//! the concept/link/mention row mappers, roadmap-snapshot capture, graph-stat
//! computation, the unreviewed-concept learning-path traversal, heuristic
//! concept extraction, change-proposal application (including cycle detection),
//! and the knowledge-state reset engine. The matching `#[tauri::command]`
//! entry points in `commands::knowledge_graph` call into this module.

use crate::models::knowledge_graph::{
    ConceptLink, ConceptMention, ConceptNode, GraphStatistics, HierarchyLevel,
};
use crate::services::concept_extractor;
use crate::services::concept_hierarchy::normalize_concept_name;
use crate::services::workspace_hierarchy::descendant_workspace_ids;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(crate) fn row_to_concept(row: &rusqlite::Row) -> rusqlite::Result<ConceptNode> {
    let type_str: String = row.get(4)?;
    let tags_json: String = row.get(5)?;
    let aliases_json: String = row.get(6)?;
    let refs_json: String = row.get(7)?;
    let level_str: String = row
        .get::<_, Option<String>>(13)?
        .unwrap_or_else(|| "concept".to_string());
    Ok(ConceptNode {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        name: row.get(2)?,
        concept_description: row.get(3)?,
        concept_type: type_str
            .parse()
            .unwrap_or(crate::models::knowledge_graph::ConceptType::Topic),
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        aliases: serde_json::from_str(&aliases_json).unwrap_or_default(),
        references: serde_json::from_str(&refs_json).unwrap_or_default(),
        x_position: row.get(8)?,
        y_position: row.get(9)?,
        review_count: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        hierarchy_level: level_str.parse().unwrap_or_default(),
    })
}

pub(crate) fn row_to_link(row: &rusqlite::Row) -> rusqlite::Result<ConceptLink> {
    let type_str: String = row.get(3)?;
    Ok(ConceptLink {
        id: row.get(0)?,
        source_id: row.get(1)?,
        target_id: row.get(2)?,
        link_type: type_str
            .parse()
            .unwrap_or(crate::models::knowledge_graph::LinkType::Related),
        strength: row.get(4)?,
        context: row.get(5)?,
        created_at: row.get(6)?,
    })
}

pub(crate) fn row_to_mention(row: &rusqlite::Row) -> rusqlite::Result<ConceptMention> {
    Ok(ConceptMention {
        id: row.get(0)?,
        concept_id: row.get(1)?,
        source_type: row.get(2)?,
        source_id: row.get(3)?,
        context: row.get(4)?,
        created_at: row.get(5)?,
    })
}

/// Maps a `concept_nodes` row (full column set, provenance included) for
/// snapshot capture. Kept separate from [`row_to_concept`], which reads by
/// positional index and is shared with the learning-path and command layers.
fn row_to_snapshot_node(row: &rusqlite::Row) -> rusqlite::Result<SnapshotConceptNode> {
    let tags_json: String = row.get(5)?;
    let aliases_json: String = row.get(6)?;
    let refs_json: String = row.get(7)?;
    let edited_json: String = row.get(16)?;
    Ok(SnapshotConceptNode {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        name: row.get(2)?,
        concept_description: row.get(3)?,
        concept_type: row.get(4)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        aliases: serde_json::from_str(&aliases_json).unwrap_or_default(),
        references: serde_json::from_str(&refs_json).unwrap_or_default(),
        x_position: row.get(8)?,
        y_position: row.get(9)?,
        review_count: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        hierarchy_level: row
            .get::<_, Option<String>>(13)?
            .unwrap_or_else(|| "concept".to_string()),
        source_model: row.get(14)?,
        confidence: row.get(15)?,
        user_edited_fields: serde_json::from_str(&edited_json).unwrap_or_default(),
        superseded_by: row.get(17)?,
        superseded_at: row.get(18)?,
        supersede_reason: row.get(19)?,
        last_modified_by_job: row.get(20)?,
        parent_checked_at: row.get(21)?,
    })
}

/// Maps a `concept_links` row (full column set) for snapshot capture.
fn row_to_snapshot_link(row: &rusqlite::Row) -> rusqlite::Result<SnapshotConceptLink> {
    let edited_json: String = row.get(9)?;
    Ok(SnapshotConceptLink {
        id: row.get(0)?,
        source_id: row.get(1)?,
        target_id: row.get(2)?,
        link_type: row.get(3)?,
        strength: row.get(4)?,
        context: row.get(5)?,
        created_at: row.get(6)?,
        source_model: row.get(7)?,
        confidence: row.get(8)?,
        user_edited_fields: serde_json::from_str(&edited_json).unwrap_or_default(),
        last_modified_by_job: row.get(10)?,
    })
}

/// Snapshot-local mirror of a `concept_nodes` row.
///
/// Deliberately NOT the shared `ConceptNode` model: that struct is the
/// frontend contract and omits the provenance columns (`source_model`,
/// `confidence`, `user_edited_fields`, the supersede chain,
/// `last_modified_by_job`). Snapshotting through it silently reset every one of
/// those to its column default on restore — resetting confidences to 0.5 and
/// erasing the user-edited markers that protect manual edits from the next AI
/// pass. Widening `ConceptNode` instead would push provenance into the IPC
/// payload for no frontend benefit, so the snapshot keeps its own row type.
///
/// Every field added here carries `#[serde(default)]` so payloads written
/// before v80 still deserialize (with the same lossy behaviour they have
/// today, which is no worse than the status quo).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SnapshotConceptNode {
    // Fields present in pre-v80 payloads.
    pub(crate) id: String,
    pub(crate) workspace_id: String,
    pub(crate) name: String,
    pub(crate) concept_description: String,
    pub(crate) concept_type: String,
    pub(crate) tags: Vec<String>,
    pub(crate) aliases: Vec<String>,
    pub(crate) references: Vec<String>,
    pub(crate) x_position: f64,
    pub(crate) y_position: f64,
    pub(crate) review_count: i64,
    pub(crate) hierarchy_level: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    // Added in v80.
    #[serde(default)]
    pub(crate) source_model: Option<String>,
    #[serde(default = "default_confidence")]
    pub(crate) confidence: f64,
    #[serde(default)]
    pub(crate) user_edited_fields: Vec<String>,
    #[serde(default)]
    pub(crate) superseded_by: Option<String>,
    #[serde(default)]
    pub(crate) superseded_at: Option<String>,
    #[serde(default)]
    pub(crate) supersede_reason: Option<String>,
    #[serde(default)]
    pub(crate) last_modified_by_job: Option<String>,
    #[serde(default)]
    pub(crate) parent_checked_at: Option<String>,
}

/// The `concept_nodes.confidence` / `concept_links.confidence` column default.
///
/// Must not be plain `#[serde(default)]`: that yields `0.0` for `f64`, which
/// would silently downgrade every restored legacy concept rather than leaving
/// it at the neutral 0.5 the schema specifies.
fn default_confidence() -> f64 {
    0.5
}

/// Snapshot-local mirror of a `concept_links` row. See [`SnapshotConceptNode`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SnapshotConceptLink {
    pub(crate) id: String,
    pub(crate) source_id: String,
    pub(crate) target_id: String,
    pub(crate) link_type: String,
    pub(crate) strength: f64,
    pub(crate) context: String,
    pub(crate) created_at: String,
    #[serde(default)]
    pub(crate) source_model: Option<String>,
    #[serde(default = "default_confidence")]
    pub(crate) confidence: f64,
    #[serde(default)]
    pub(crate) user_edited_fields: Vec<String>,
    #[serde(default)]
    pub(crate) last_modified_by_job: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RoadmapSnapshotPayload {
    pub(crate) nodes: Vec<SnapshotConceptNode>,
    pub(crate) links: Vec<SnapshotConceptLink>,
    pub(crate) mentions: Vec<ConceptMention>,
    pub(crate) graph_statistics: Option<GraphStatistics>,
}

/// The subset of a payload that defines "has the graph actually changed".
///
/// `graph_statistics.updated_at` is excluded on purpose: `compute_graph_stats`
/// stamps it with `Utc::now()`, so including it would make the content hash
/// differ on every capture and defeat skip-if-unchanged entirely.
#[derive(Serialize)]
struct SnapshotHashView<'a> {
    nodes: &'a [SnapshotConceptNode],
    links: &'a [SnapshotConceptLink],
    mentions: &'a [ConceptMention],
}

/// Why a snapshot was captured. Validated here rather than by a SQL CHECK —
/// see the v80 migration comment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SnapshotReason {
    Analysis,
    Scheduled,
    Manual,
    Drift,
}

impl SnapshotReason {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Analysis => "analysis",
            Self::Scheduled => "scheduled",
            Self::Manual => "manual",
            Self::Drift => "drift",
        }
    }
}

/// Outcome of a capture attempt, so callers can tell "wrote a snapshot" from
/// "deliberately did nothing" and report accordingly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SnapshotOutcome {
    Created(String),
    SkippedEmpty,
    SkippedUnchanged,
}

const DEFAULT_SNAPSHOT_RETENTION_DAYS: i64 = 60;
const DEFAULT_SNAPSHOT_MAX_PER_WORKSPACE: i64 = 40;

pub fn compute_graph_stats(
    conn: &rusqlite::Connection,
    workspace_id: String,
) -> Result<GraphStatistics, String> {
    let total_concepts: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = ?1",
            rusqlite::params![workspace_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let total_links: i64 = conn.query_row(
        "SELECT COUNT(*) FROM concept_links cl JOIN concept_nodes cn ON cl.source_id = cn.id WHERE cn.workspace_id = ?1",
        rusqlite::params![workspace_id], |r| r.get(0)
    ).unwrap_or(0);
    let avg_degree = if total_concepts > 0 {
        (total_links * 2) as f64 / total_concepts as f64
    } else {
        0.0
    };
    let max_links = total_concepts * (total_concepts - 1) / 2;
    let density = if max_links > 0 {
        total_links as f64 / max_links as f64
    } else {
        0.0
    };
    Ok(GraphStatistics {
        id: workspace_id.clone(),
        workspace_id: Some(workspace_id),
        total_concepts,
        total_links,
        avg_degree,
        density,
        updated_at: chrono::Utc::now().to_rfc3339(),
    })
}

fn load_graph_stats(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> Result<Option<GraphStatistics>, String> {
    conn.query_row(
        "SELECT id, workspace_id, total_concepts, total_links, avg_degree, density, updated_at
         FROM graph_statistics WHERE workspace_id = ?1",
        rusqlite::params![workspace_id],
        |row| {
            Ok(GraphStatistics {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                total_concepts: row.get(2)?,
                total_links: row.get(3)?,
                avg_degree: row.get(4)?,
                density: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map(Some)
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.to_string()),
    })
}

fn load_snapshot_payload(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> Result<RoadmapSnapshotPayload, String> {
    // Deterministic ordering is load-bearing: it is what makes the payload hash
    // stable across captures of an identical graph.
    let mut node_stmt = conn
        .prepare(
            "SELECT id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json,
                    x_position, y_position, review_count, created_at, updated_at, hierarchy_level,
                    source_model, confidence, user_edited_fields, superseded_by, superseded_at,
                    supersede_reason, last_modified_by_job, parent_checked_at
             FROM concept_nodes
             WHERE workspace_id = ?1
             ORDER BY created_at ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let nodes = node_stmt
        .query_map(rusqlite::params![workspace_id], row_to_snapshot_node)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut link_stmt = conn
        .prepare(
            "SELECT cl.id, cl.source_id, cl.target_id, cl.link_type, cl.strength, cl.context, cl.created_at,
                    cl.source_model, cl.confidence, cl.user_edited_fields, cl.last_modified_by_job
             FROM concept_links cl
             JOIN concept_nodes cn ON cn.id = cl.source_id
             WHERE cn.workspace_id = ?1
             ORDER BY cl.created_at ASC, cl.id ASC",
        )
        .map_err(|e| e.to_string())?;
    let links = link_stmt
        .query_map(rusqlite::params![workspace_id], row_to_snapshot_link)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut mention_stmt = conn
        .prepare(
            "SELECT cm.id, cm.concept_id, cm.source_type, cm.source_id, cm.context, cm.created_at
             FROM concept_mentions cm
             JOIN concept_nodes cn ON cn.id = cm.concept_id
             WHERE cn.workspace_id = ?1
             ORDER BY cm.created_at ASC, cm.id ASC",
        )
        .map_err(|e| e.to_string())?;
    let mentions = mention_stmt
        .query_map(rusqlite::params![workspace_id], row_to_mention)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(RoadmapSnapshotPayload {
        nodes,
        links,
        mentions,
        graph_statistics: load_graph_stats(conn, workspace_id)?,
    })
}

/// Reads an integer setting, tolerating the codebase's inconsistent quoting of
/// `settings.value` (bare numbers vs JSON-quoted strings).
fn int_setting(conn: &rusqlite::Connection, key: &str, fallback: i64) -> i64 {
    crate::commands::settings::get_setting(conn, key)
        .and_then(|v| v.trim_matches('"').parse::<i64>().ok())
        .unwrap_or(fallback)
}

/// Captures a point-in-time snapshot of a workspace's knowledge map.
///
/// Skips writing when there is nothing worth keeping — an empty graph, or a
/// graph whose content hash matches the newest existing snapshot. Those two
/// guards are what keep a daily cadence from accreting identical rows forever;
/// the age and count prunes bound what remains.
pub(crate) fn capture_workspace_snapshot(
    conn: &rusqlite::Connection,
    workspace_id: &str,
    reason: SnapshotReason,
    source_job_id: Option<&str>,
    source_model: Option<&str>,
) -> Result<SnapshotOutcome, String> {
    // Cheapest guard first: never snapshot a workspace with no concepts. This
    // alone eliminates the dominant bloat case (every workspace never analyzed).
    let node_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = ?1",
            rusqlite::params![workspace_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if node_count == 0 {
        return Ok(SnapshotOutcome::SkippedEmpty);
    }

    let payload = load_snapshot_payload(conn, workspace_id)?;

    // Hash the graph content only (see SnapshotHashView) so a stats timestamp
    // refresh does not read as a change.
    let hash_view = SnapshotHashView {
        nodes: &payload.nodes,
        links: &payload.links,
        mentions: &payload.mentions,
    };
    let hash_json = serde_json::to_string(&hash_view).map_err(|e| e.to_string())?;
    let payload_hash = format!("{:x}", Sha256::digest(hash_json.as_bytes()));

    // Skip-if-unchanged. A manual capture is held to the same rule: an explicit
    // click on an unchanged graph gets a clear "no changes" message, which beats
    // a duplicate row.
    let previous_hash: Option<String> = conn
        .query_row(
            "SELECT payload_hash FROM roadmap_snapshots
             WHERE workspace_id = ?1
             ORDER BY created_at DESC, id DESC
             LIMIT 1",
            rusqlite::params![workspace_id],
            |r| r.get(0),
        )
        .ok();
    if let Some(prev) = previous_hash {
        if !prev.is_empty() && prev == payload_hash {
            return Ok(SnapshotOutcome::SkippedUnchanged);
        }
    }

    let payload_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let snapshot_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO roadmap_snapshots (
            id, workspace_id, source_job_id, source_model, concept_count, link_count,
            payload, created_at, reason, payload_hash
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            snapshot_id,
            workspace_id,
            source_job_id,
            source_model,
            payload.nodes.len() as i64,
            payload.links.len() as i64,
            payload_json,
            now,
            reason.as_str(),
            payload_hash,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Age prune before count prune: reversed, the cap could retain rows the age
    // policy drops anyway, costing an extra write.
    let retention_days = int_setting(
        conn,
        "roadmap_snapshot_retention_days",
        DEFAULT_SNAPSHOT_RETENTION_DAYS,
    );
    if retention_days > 0 {
        conn.execute(
            "DELETE FROM roadmap_snapshots
             WHERE workspace_id = ?1
               AND julianday(created_at) < julianday('now', ?2)",
            rusqlite::params![workspace_id, format!("-{retention_days} days")],
        )
        .map_err(|e| e.to_string())?;
    }

    // A configured 0 (or negative) means "unlimited", never "delete everything".
    let max_per_workspace = int_setting(
        conn,
        "roadmap_snapshot_max_per_workspace",
        DEFAULT_SNAPSHOT_MAX_PER_WORKSPACE,
    );
    if max_per_workspace > 0 {
        conn.execute(
            "DELETE FROM roadmap_snapshots
             WHERE workspace_id = ?1
               AND id NOT IN (
                 SELECT id FROM roadmap_snapshots
                 WHERE workspace_id = ?1
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?2
               )",
            rusqlite::params![workspace_id, max_per_workspace],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(SnapshotOutcome::Created(snapshot_id))
}

/// Back-compat entry point for the post-analysis capture site.
pub(crate) fn snapshot_workspace_roadmap(
    conn: &rusqlite::Connection,
    workspace_id: &str,
    source_job_id: Option<&str>,
    source_model: Option<&str>,
) -> Result<(), String> {
    capture_workspace_snapshot(
        conn,
        workspace_id,
        SnapshotReason::Analysis,
        source_job_id,
        source_model,
    )
    .map(|_| ())
}

/// Replaces a workspace's graph state with the contents of a snapshot payload.
///
/// Lives here rather than inline in the command so tests exercise the real
/// restore path. The previous arrangement — command-only, with the test
/// re-implementing the same SQL — is why the provenance loss went unnoticed.
pub(crate) fn restore_snapshot_inner(
    tx: &rusqlite::Transaction,
    workspace_id: &str,
    payload: &RoadmapSnapshotPayload,
) -> Result<(), String> {
    tx.execute(
        "DELETE FROM concept_change_proposals WHERE workspace_id = ?1",
        rusqlite::params![workspace_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM graph_statistics WHERE workspace_id = ?1",
        rusqlite::params![workspace_id],
    )
    .map_err(|e| e.to_string())?;
    // Cascades to concept_links and concept_mentions.
    tx.execute(
        "DELETE FROM concept_nodes WHERE workspace_id = ?1",
        rusqlite::params![workspace_id],
    )
    .map_err(|e| e.to_string())?;

    // Pass 1: insert every node with a NULL supersede chain. `superseded_by` is
    // a self-FK and foreign keys are enforced on pooled connections, so a node
    // superseded by a later-created one would otherwise reference a row that
    // does not exist yet.
    for node in &payload.nodes {
        let type_str = node
            .concept_type
            .parse::<crate::models::knowledge_graph::ConceptType>()
            .map(|t| t.to_string())
            .unwrap_or_else(|_| "custom".to_string());
        let level_str = node
            .hierarchy_level
            .parse::<HierarchyLevel>()
            .unwrap_or_default()
            .to_string();
        // `unwrap_or_else(.. "[]")`, not `unwrap_or_default()`: the latter
        // yields "" on failure, which violates the json_valid CHECK.
        let tags_json = serde_json::to_string(&node.tags).unwrap_or_else(|_| "[]".to_string());
        let aliases_json =
            serde_json::to_string(&node.aliases).unwrap_or_else(|_| "[]".to_string());
        let refs_json = serde_json::to_string(&node.references).unwrap_or_else(|_| "[]".to_string());
        let edited_json =
            serde_json::to_string(&node.user_edited_fields).unwrap_or_else(|_| "[]".to_string());
        tx.execute(
            "INSERT INTO concept_nodes (
                id, workspace_id, name, concept_description, concept_type, tags, aliases,
                references_json, x_position, y_position, review_count, created_at, updated_at,
                hierarchy_level, source_model, confidence, user_edited_fields,
                last_modified_by_job, parent_checked_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            rusqlite::params![
                &node.id,
                &node.workspace_id,
                &node.name,
                &node.concept_description,
                type_str,
                tags_json,
                aliases_json,
                refs_json,
                node.x_position,
                node.y_position,
                node.review_count,
                &node.created_at,
                &node.updated_at,
                level_str,
                &node.source_model,
                node.confidence,
                edited_json,
                &node.last_modified_by_job,
                &node.parent_checked_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    // Pass 2: now that every id exists, reattach the supersede chain.
    for node in &payload.nodes {
        if node.superseded_by.is_some() {
            tx.execute(
                "UPDATE concept_nodes
                 SET superseded_by = ?1, superseded_at = ?2, supersede_reason = ?3
                 WHERE id = ?4",
                rusqlite::params![
                    &node.superseded_by,
                    &node.superseded_at,
                    &node.supersede_reason,
                    &node.id,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    for link in &payload.links {
        let type_str = link
            .link_type
            .parse::<crate::models::knowledge_graph::LinkType>()
            .map(|t| t.to_string())
            .unwrap_or_else(|_| "related".to_string());
        let edited_json =
            serde_json::to_string(&link.user_edited_fields).unwrap_or_else(|_| "[]".to_string());
        tx.execute(
            "INSERT INTO concept_links (
                id, source_id, target_id, link_type, strength, context, created_at,
                source_model, confidence, user_edited_fields, last_modified_by_job
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                &link.id,
                &link.source_id,
                &link.target_id,
                type_str,
                link.strength,
                &link.context,
                &link.created_at,
                &link.source_model,
                link.confidence,
                edited_json,
                &link.last_modified_by_job,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    for mention in &payload.mentions {
        tx.execute(
            "INSERT INTO concept_mentions (id, concept_id, source_type, source_id, context, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                &mention.id,
                &mention.concept_id,
                &mention.source_type,
                &mention.source_id,
                &mention.context,
                &mention.created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    if let Some(stats) = &payload.graph_statistics {
        tx.execute(
            "INSERT INTO graph_statistics (id, workspace_id, total_concepts, total_links, avg_degree, density, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                &stats.id,
                stats.workspace_id.clone(),
                stats.total_concepts,
                stats.total_links,
                stats.avg_degree,
                stats.density,
                &stats.updated_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// How far the graph has moved since a snapshot, as a fraction of that
/// snapshot's total size. Combined node+link total, so this reads net change
/// rather than churn; the content hash in [`capture_workspace_snapshot`] is the
/// backstop that decides whether anything actually differs.
fn drift_ratio(cur_nodes: i64, cur_links: i64, prev_nodes: i64, prev_links: i64) -> f64 {
    let prev_total = (prev_nodes + prev_links) as f64;
    if prev_total <= 0.0 {
        // No meaningful baseline — the interval trigger owns this case.
        return 0.0;
    }
    let cur_total = (cur_nodes + cur_links) as f64;
    (cur_total - prev_total).abs() / prev_total
}

/// One pass over every workspace, capturing snapshots that are due either by
/// elapsed time or by how much the graph has moved. Returns the workspaces
/// actually captured, with the reason.
pub(crate) fn run_scheduled_snapshot_sweep(
    conn: &rusqlite::Connection,
) -> Vec<(String, &'static str)> {
    let interval_hours = int_setting(conn, "roadmap_snapshot_interval_hours", 24) as f64;
    let drift_threshold = crate::commands::settings::get_setting(conn, "roadmap_snapshot_drift_threshold")
        .and_then(|v| v.trim_matches('"').parse::<f64>().ok())
        .filter(|t| *t > 0.0)
        .unwrap_or(0.15)
        .clamp(0.01, 10.0);

    // One scan for every workspace: live counts, plus the newest snapshot's
    // counts and age. Aggregates are pre-grouped so this stays a single query
    // rather than a per-workspace loop.
    //
    // Age is computed in SQL on purpose: `created_at` is RFC3339 when written by
    // the capture path but 'YYYY-MM-DD HH:MM:SS' when written by the column
    // default, and julianday() tolerates both where a Rust RFC3339 parse would
    // fail on the latter.
    let mut stmt = match conn.prepare(
        "SELECT w.id,
                COALESCE(c.node_count, 0),
                COALESCE(l.link_count, 0),
                COALESCE(s.concept_count, 0),
                COALESCE(s.link_count, 0),
                CASE WHEN s.created_at IS NULL THEN 1
                     WHEN julianday('now') - julianday(s.created_at) >= (?1 / 24.0) THEN 1
                     ELSE 0 END
         FROM workspaces w
         LEFT JOIN (
             SELECT workspace_id, COUNT(*) AS node_count
             FROM concept_nodes GROUP BY workspace_id
         ) c ON c.workspace_id = w.id
         LEFT JOIN (
             SELECT cn.workspace_id, COUNT(*) AS link_count
             FROM concept_links cl
             JOIN concept_nodes cn ON cn.id = cl.source_id
             GROUP BY cn.workspace_id
         ) l ON l.workspace_id = w.id
         LEFT JOIN roadmap_snapshots s ON s.id = (
             SELECT id FROM roadmap_snapshots
             WHERE workspace_id = w.id
             ORDER BY created_at DESC, id DESC
             LIMIT 1
         )
         WHERE COALESCE(c.node_count, 0) > 0
         ORDER BY w.id ASC",
    ) {
        Ok(stmt) => stmt,
        Err(err) => {
            crate::logging::log_buffered(
                "warn",
                "scheduler",
                &format!("[SNAPSHOT] sweep query failed: {err}"),
                "{}",
            );
            return Vec::new();
        }
    };

    let candidates: Vec<(String, i64, i64, i64, i64, bool)> = match stmt.query_map(
        rusqlite::params![interval_hours],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)? == 1,
            ))
        },
    ) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(err) => {
            crate::logging::log_buffered(
                "warn",
                "scheduler",
                &format!("[SNAPSHOT] sweep read failed: {err}"),
                "{}",
            );
            return Vec::new();
        }
    };
    drop(stmt);

    let mut captured = Vec::new();
    for (workspace_id, nodes, links, prev_nodes, prev_links, due_by_interval) in candidates {
        let drifted = drift_ratio(nodes, links, prev_nodes, prev_links) >= drift_threshold;
        if !due_by_interval && !drifted {
            continue;
        }
        let reason = if drifted {
            SnapshotReason::Drift
        } else {
            SnapshotReason::Scheduled
        };
        // One failing workspace must not abort the sweep for the rest.
        match capture_workspace_snapshot(conn, &workspace_id, reason, None, None) {
            Ok(SnapshotOutcome::Created(_)) => captured.push((workspace_id, reason.as_str())),
            Ok(_) => {}
            Err(err) => crate::logging::log_buffered(
                "warn",
                "scheduler",
                &format!("[SNAPSHOT] capture failed for {workspace_id}: {err}"),
                "{}",
            ),
        }
    }
    captured
}

#[derive(Debug, serde::Serialize)]
pub struct LearningPathItem {
    pub concept_id: String,
    pub concept_name: String,
    pub concept_description: String,
    pub hierarchy_path: String,
    pub met_prereqs: usize,
    pub unmet_prereqs: usize,
}

pub fn compute_learning_path(
    conn: &rusqlite::Connection,
    workspace_id: String,
) -> Result<Vec<LearningPathItem>, String> {

    // Load all concept nodes for workspace
    let mut all_nodes: std::collections::HashMap<String, ConceptNode> =
        std::collections::HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, \
                 x_position, y_position, review_count, created_at, updated_at, hierarchy_level \
                 FROM concept_nodes WHERE workspace_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![workspace_id], row_to_concept)
            .map_err(|e| e.to_string())?;
        for node in rows.flatten() {
            all_nodes.insert(node.id.clone(), node);
        }
    }

    // Load all links for this workspace
    let mut links: Vec<(String, String, String)> = Vec::new(); // (id, source_id, target_id, link_type)
    {
        let mut stmt = conn
            .prepare(
                "SELECT cl.id, cl.source_id, cl.target_id, cl.link_type \
                 FROM concept_links cl \
                 JOIN concept_nodes cn ON cl.source_id = cn.id \
                 WHERE cn.workspace_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![workspace_id], |row| {
                Ok((
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            links.push(row);
        }
    }

    // Build parent map from part_of links: child_id -> parent_id
    let mut parent_of: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for (src, tgt, ltype) in &links {
        if ltype == "part_of" {
            parent_of.insert(src.clone(), tgt.clone());
        }
    }

    // For each unreviewed concept node, count met/unmet prerequisites
    let mut items: Vec<LearningPathItem> = Vec::new();
    for (id, node) in &all_nodes {
        if node.review_count > 0 {
            continue;
        }
        if node.hierarchy_level != HierarchyLevel::Concept {
            continue;
        }

        let mut met = 0usize;
        let mut unmet = 0usize;
        for (src, tgt, ltype) in &links {
            if ltype == "prerequisite" && tgt == id {
                // src is a prerequisite of this concept
                if let Some(prereq) = all_nodes.get(src) {
                    if prereq.review_count > 0 {
                        met += 1;
                    } else {
                        unmet += 1;
                    }
                }
            }
        }

        // Build hierarchy_path by walking part_of links
        let mut path_parts: Vec<String> = Vec::new();
        let mut current_id = id.clone();
        let mut depth = 0;
        while let Some(parent_id) = parent_of.get(&current_id) {
            if let Some(parent_node) = all_nodes.get(parent_id) {
                path_parts.push(parent_node.name.clone());
            }
            current_id = parent_id.clone();
            depth += 1;
            if depth > 10 {
                break; // prevent cycles
            }
        }
        path_parts.reverse();
        let hierarchy_path = path_parts.join(" > ");

        items.push(LearningPathItem {
            concept_id: id.clone(),
            concept_name: node.name.clone(),
            concept_description: node.concept_description.clone(),
            hierarchy_path,
            met_prereqs: met,
            unmet_prereqs: unmet,
        });
    }

    // Sort by fewest unmet prereqs, then by name
    items.sort_by(|a, b| {
        a.unmet_prereqs
            .cmp(&b.unmet_prereqs)
            .then(a.concept_name.cmp(&b.concept_name))
    });
    items.truncate(5);

    Ok(items)
}

#[derive(Debug, Deserialize)]
pub struct ExtractConceptsRequest {
    pub workspace_id: String,
    pub text: String,
    pub source_type: String,
    pub source_id: String,
}

#[derive(Debug, Serialize)]
pub struct ExtractConceptsResult {
    pub created: Vec<String>,
    pub existing: Vec<String>,
    pub mentions_recorded: usize,
}

/// Stopwords that the heuristic extractor might pick up as Title-Case phrases
/// but are too generic to be useful concepts.
const EXTRACTION_STOPWORDS: &[&str] = &[
    "the", "this", "that", "with", "from", "have", "will", "would", "should", "could", "about",
    "there", "these", "those", "what", "when", "where", "which", "other", "some", "more", "also",
    "here", "just", "like", "then", "than", "each", "every", "does", "been", "being", "into",
    "over", "only", "very", "after", "before", "between", "through", "under", "above", "below",
    // generic CS/learning noise
    "code", "data", "test", "step", "task", "note", "item", "part", "type", "file", "list", "name",
    "info", "text", "help", "main", "work", "user", "next",
];

fn is_meaningful_concept(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    if lower.chars().count() < 4 {
        return false;
    }
    // Reject single stopwords
    if EXTRACTION_STOPWORDS.contains(&lower.as_str()) {
        return false;
    }
    // Reject if every word in a multi-word phrase is a stopword
    let words: Vec<&str> = lower.split_whitespace().collect();
    if words.len() > 1 && words.iter().all(|w| EXTRACTION_STOPWORDS.contains(w)) {
        return false;
    }
    true
}

/// Extract concepts from text using heuristic patterns ([[wiki-links]], CamelCase,
/// Title Case phrases), upsert them as concept_nodes, and record concept_mentions.
/// This is designed to be called after saving chat messages or notes.
pub fn extract_and_link_concepts(
    conn: &rusqlite::Connection,
    req: ExtractConceptsRequest,
) -> Result<ExtractConceptsResult, String> {

    let candidates = concept_extractor::extract_concepts(&req.text);
    let meaningful: Vec<String> = candidates
        .into_iter()
        .filter(|c| is_meaningful_concept(c))
        .collect();

    if meaningful.is_empty() {
        return Ok(ExtractConceptsResult {
            created: vec![],
            existing: vec![],
            mentions_recorded: 0,
        });
    }

    // Load existing concepts for this workspace (lowercase name -> id)
    let mut existing_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    // Also index aliases
    if let Ok(mut stmt) =
        conn.prepare("SELECT id, LOWER(name), aliases FROM concept_nodes WHERE workspace_id = ?1")
    {
        let _ = stmt
            .query_map(rusqlite::params![req.workspace_id], |row| {
                let id: String = row.get(0)?;
                let lower_name: String = row.get(1)?;
                let aliases_json: String = row.get(2)?;
                Ok((id, lower_name, aliases_json))
            })
            .map(|rows| {
                for (id, lower_name, aliases_json) in rows.flatten() {
                    let normalized = normalize_concept_name(&lower_name);
                    existing_map.insert(lower_name, id.clone());
                    existing_map.insert(normalized, id.clone());
                    if let Ok(aliases) = serde_json::from_str::<Vec<String>>(&aliases_json) {
                        for alias in aliases {
                            let alias_lower = alias.to_lowercase();
                            let alias_norm = normalize_concept_name(&alias);
                            existing_map.insert(alias_lower, id.clone());
                            existing_map.insert(alias_norm, id.clone());
                        }
                    }
                }
            });
    }

    let now = chrono::Utc::now().to_rfc3339();
    let mut created: Vec<String> = Vec::new();
    let mut existing: Vec<String> = Vec::new();
    let mut mentions_recorded = 0usize;

    for name in &meaningful {
        let lower = name.to_lowercase();
        let normalized = normalize_concept_name(name);
        let concept_id = if let Some(id) = existing_map
            .get(&lower)
            .or_else(|| existing_map.get(&normalized))
        {
            existing.push(name.clone());
            // Bump review_count as a lightweight signal of relevance
            let _ = conn.execute(
                "UPDATE concept_nodes SET review_count = review_count + 1, updated_at = ?1 WHERE id = ?2",
                rusqlite::params![now, id],
            );
            id.clone()
        } else {
            // Create new concept node
            let id = uuid::Uuid::new_v4().to_string();
            let result = conn.execute(
                "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level) \
                 VALUES (?1, ?2, ?3, '', 'topic', '[]', '[]', '[]', 0.0, 0.0, 1, ?4, ?4, 'concept')",
                rusqlite::params![id, req.workspace_id, name.trim(), now],
            );
            if result.is_ok() {
                existing_map.insert(lower, id.clone());
                existing_map.insert(normalized, id.clone());
                created.push(name.clone());
                id
            } else {
                continue;
            }
        };

        // Record the mention
        let mention_id = uuid::Uuid::new_v4().to_string();
        if conn
            .execute(
                "INSERT INTO concept_mentions (id, concept_id, source_type, source_id, context, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    mention_id,
                    concept_id,
                    req.source_type,
                    req.source_id,
                    &req.text[..req.text.len().min(200)],
                    now
                ],
            )
            .is_ok()
        {
            mentions_recorded += 1;
        }
    }

    Ok(ExtractConceptsResult {
        created,
        existing,
        mentions_recorded,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChangeProposal {
    pub id: String,
    pub workspace_id: String,
    pub job_id: Option<String>,
    pub proposal_type: String,
    pub target_node_id: Option<String>,
    pub payload: String,
    pub reason: Option<String>,
    pub created_at: String,
}

pub fn apply_change_proposal(conn: &rusqlite::Connection, id: &str) -> Result<(), String> {
    let proposal: ChangeProposal = conn.query_row(
        "SELECT id, workspace_id, job_id, proposal_type, target_node_id, payload, reason, created_at \
         FROM concept_change_proposals WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(ChangeProposal {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            job_id: row.get(2)?,
            proposal_type: row.get(3)?,
            target_node_id: row.get(4)?,
            payload: row.get(5)?,
            reason: row.get(6)?,
            created_at: row.get(7)?,
        })
    ).map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();
    let job_id = proposal.job_id.unwrap_or_default();

    if proposal.proposal_type == "upgrade" {
        if let Some(target_id) = proposal.target_node_id {
            if let Ok(payload_val) = serde_json::from_str::<serde_json::Value>(&proposal.payload) {
                let mut updates = Vec::new();
                let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
                let mut param_idx = 1;

                if let Some(desc) = payload_val
                    .get("concept_description")
                    .and_then(|v| v.as_str())
                {
                    updates.push(format!("concept_description = ?{}", param_idx));
                    params.push(Box::new(desc.to_string()));
                    param_idx += 1;
                }
                if let Some(ctype) = payload_val.get("concept_type").and_then(|v| v.as_str()) {
                    updates.push(format!("concept_type = ?{}", param_idx));
                    params.push(Box::new(ctype.to_string()));
                    param_idx += 1;
                }
                if let Some(level) = payload_val.get("hierarchy_level").and_then(|v| v.as_str()) {
                    updates.push(format!("hierarchy_level = ?{}", param_idx));
                    params.push(Box::new(level.to_string()));
                    param_idx += 1;
                }
                if let Some(source_model) = payload_val.get("source_model").and_then(|v| v.as_str())
                {
                    updates.push(format!("source_model = ?{}", param_idx));
                    params.push(Box::new(source_model.to_string()));
                    param_idx += 1;
                }
                if let Some(confidence) = payload_val.get("confidence").and_then(|v| v.as_f64()) {
                    updates.push(format!("confidence = ?{}", param_idx));
                    params.push(Box::new(confidence));
                    param_idx += 1;
                }

                if !updates.is_empty() {
                    updates.push(format!("updated_at = ?{}", param_idx));
                    params.push(Box::new(now));
                    param_idx += 1;

                    let query = format!(
                        "UPDATE concept_nodes SET {} WHERE id = ?{}",
                        updates.join(", "),
                        param_idx
                    );
                    params.push(Box::new(target_id));

                    let ref_params: Vec<&dyn rusqlite::ToSql> =
                        params.iter().map(|p| p.as_ref()).collect();
                    conn.execute(&query, ref_params.as_slice())
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    } else if proposal.proposal_type == "supersede" || proposal.proposal_type == "merge" {
        if let Some(target_id) = proposal.target_node_id {
            if let Ok(payload_val) = serde_json::from_str::<serde_json::Value>(&proposal.payload) {
                if let Some(successor_id) = payload_val.get("successor_id").and_then(|v| v.as_str())
                {
                    let reason_str = proposal.reason.unwrap_or_else(|| "superseded".to_string());

                    if !would_create_cycle_local(conn, successor_id, &target_id).unwrap_or(true) {
                        conn.execute(
                            "UPDATE concept_nodes \
                             SET superseded_by = ?1, superseded_at = ?2, supersede_reason = ?3, \
                                 last_modified_by_job = ?4, updated_at = ?5 \
                             WHERE id = ?6 AND (superseded_by IS NULL OR superseded_by = '');",
                            rusqlite::params![
                                successor_id,
                                now,
                                reason_str,
                                job_id,
                                now,
                                target_id
                            ],
                        )
                        .map_err(|e| e.to_string())?;

                        conn.execute(
                            "UPDATE concept_nodes \
                             SET review_count = review_count + (SELECT COALESCE(review_count, 0) FROM concept_nodes WHERE id = ?1) \
                             WHERE id = ?2;",
                            rusqlite::params![target_id, successor_id],
                        ).map_err(|e| e.to_string())?;

                        conn.execute(
                            "UPDATE concept_links \
                             SET target_id = ?1, last_modified_by_job = ?2 \
                             WHERE target_id = ?3 AND json_array_length(user_edited_fields) > 0;",
                            rusqlite::params![successor_id, job_id, target_id],
                        )
                        .map_err(|e| e.to_string())?;
                        conn.execute(
                            "UPDATE concept_links \
                             SET source_id = ?1, last_modified_by_job = ?2 \
                             WHERE source_id = ?3 AND json_array_length(user_edited_fields) > 0;",
                            rusqlite::params![successor_id, job_id, target_id],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
    }

    conn.execute(
        "DELETE FROM concept_change_proposals WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn would_create_cycle_local(
    conn: &rusqlite::Connection,
    start_id: &str,
    target_id: &str,
) -> rusqlite::Result<bool> {
    if start_id == target_id {
        return Ok(true);
    }
    let mut current = start_id.to_string();
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeResetScope {
    Workspace,
    WorkspaceWithChildren,
    AllWorkspaces,
}

#[derive(Debug, Clone, Deserialize)]
pub struct KnowledgeResetOptions {
    pub clear_graph: Option<bool>,
    pub clear_topic_signatures: Option<bool>,
    pub clear_prompt_bank: Option<bool>,
    pub clear_analysis_jobs: Option<bool>,
    pub clear_legacy_topics: Option<bool>,
    pub delete_generated_cards: Option<bool>,
}

impl Default for KnowledgeResetOptions {
    fn default() -> Self {
        Self {
            clear_graph: Some(true),
            clear_topic_signatures: Some(true),
            clear_prompt_bank: Some(true),
            clear_analysis_jobs: Some(true),
            clear_legacy_topics: Some(true),
            delete_generated_cards: Some(true),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct KnowledgeResetRequest {
    pub scope: KnowledgeResetScope,
    pub workspace_id: Option<String>,
    pub options: Option<KnowledgeResetOptions>,
    pub dry_run: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct KnowledgeResetResult {
    pub dry_run: bool,
    pub workspace_count: i64,
    pub concept_nodes: i64,
    pub concept_links: i64,
    pub concept_mentions: i64,
    pub graph_statistics: i64,
    pub roadmap_snapshots: i64,
    pub analyze_jobs: i64,
    pub analyze_job_chunks: i64,
    pub change_proposals: i64,
    pub flashcard_topics: i64,
    pub generated_cards_deleted: i64,
    pub generated_cards_detached: i64,
    pub learning_goals_detached: i64,
    pub topic_signatures_cleared: i64,
    pub prompt_bank_prompts: i64,
    pub prompt_bank_jobs: i64,
}

pub fn reset_knowledge_state_inner(
    conn: &mut rusqlite::Connection,
    req: KnowledgeResetRequest,
) -> Result<KnowledgeResetResult, String> {
    let dry_run = req.dry_run.unwrap_or(false);
    let workspace_ids = resolve_reset_workspace_ids(conn, &req)?;
    let options = req.options.unwrap_or_default();
    if workspace_ids.is_empty() {
        return Ok(KnowledgeResetResult {
            dry_run,
            ..Default::default()
        });
    }

    let mut result = preview_knowledge_reset(conn, &workspace_ids, &options)?;
    result.dry_run = dry_run;
    result.workspace_count = workspace_ids.len() as i64;

    if dry_run {
        return Ok(result);
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let applied = apply_knowledge_reset(&tx, &workspace_ids, &options)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(KnowledgeResetResult {
        dry_run: false,
        workspace_count: workspace_ids.len() as i64,
        ..applied
    })
}

fn resolve_reset_workspace_ids(
    conn: &rusqlite::Connection,
    req: &KnowledgeResetRequest,
) -> Result<Vec<String>, String> {
    match req.scope {
        KnowledgeResetScope::Workspace => {
            let id = req
                .workspace_id
                .as_deref()
                .ok_or_else(|| "workspace_id is required for workspace reset".to_string())?;
            Ok(vec![id.to_string()])
        }
        KnowledgeResetScope::WorkspaceWithChildren => {
            let id = req.workspace_id.as_deref().ok_or_else(|| {
                "workspace_id is required for workspace-with-children reset".to_string()
            })?;
            descendant_workspace_ids(conn, id)
        }
        KnowledgeResetScope::AllWorkspaces => {
            let mut stmt = conn
                .prepare("SELECT id FROM workspaces")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())
        }
    }
}

fn placeholders(count: usize) -> String {
    std::iter::repeat_n("?", count)
        .collect::<Vec<_>>()
        .join(",")
}

fn count_sql(
    conn: &rusqlite::Connection,
    sql: &str,
    workspace_ids: &[String],
) -> Result<i64, String> {
    conn.query_row(
        sql,
        rusqlite::params_from_iter(workspace_ids.iter().map(|s| s.as_str())),
        |row| row.get::<_, i64>(0),
    )
    .map_err(|e| e.to_string())
}

fn execute_sql(
    conn: &rusqlite::Connection,
    sql: &str,
    workspace_ids: &[String],
) -> Result<i64, String> {
    conn.execute(
        sql,
        rusqlite::params_from_iter(workspace_ids.iter().map(|s| s.as_str())),
    )
    .map(|count| count as i64)
    .map_err(|e| e.to_string())
}

fn scoped_concept_subquery(in_clause: &str) -> String {
    format!("SELECT id FROM concept_nodes WHERE workspace_id IN ({in_clause})")
}

fn scoped_job_subquery(in_clause: &str) -> String {
    format!("SELECT id FROM analyze_jobs WHERE workspace_id IN ({in_clause})")
}

fn count_by_workspace(
    conn: &rusqlite::Connection,
    table: &str,
    workspace_ids: &[String],
) -> Result<i64, String> {
    let in_clause = placeholders(workspace_ids.len());
    count_sql(
        conn,
        &format!("SELECT COUNT(*) FROM {table} WHERE workspace_id IN ({in_clause})"),
        workspace_ids,
    )
}

fn delete_by_workspace(
    conn: &rusqlite::Connection,
    table: &str,
    workspace_ids: &[String],
) -> Result<i64, String> {
    let in_clause = placeholders(workspace_ids.len());
    execute_sql(
        conn,
        &format!("DELETE FROM {table} WHERE workspace_id IN ({in_clause})"),
        workspace_ids,
    )
}

fn preview_knowledge_reset(
    conn: &rusqlite::Connection,
    workspace_ids: &[String],
    options: &KnowledgeResetOptions,
) -> Result<KnowledgeResetResult, String> {
    let mut result = KnowledgeResetResult::default();
    let in_clause = placeholders(workspace_ids.len());
    let concept_subquery = scoped_concept_subquery(&in_clause);
    let job_subquery = scoped_job_subquery(&in_clause);

    if options.clear_graph.unwrap_or(true) {
        result.concept_nodes = count_by_workspace(conn, "concept_nodes", workspace_ids)?;
        result.concept_links = count_sql(
            conn,
            &format!(
                "WITH scoped_concepts AS ({concept_subquery}) \
                 SELECT COUNT(*) FROM concept_links \
                 WHERE source_id IN (SELECT id FROM scoped_concepts) \
                    OR target_id IN (SELECT id FROM scoped_concepts)"
            ),
            workspace_ids,
        )?;
        result.concept_mentions = count_sql(
            conn,
            &format!(
                "SELECT COUNT(*) FROM concept_mentions WHERE concept_id IN ({concept_subquery})"
            ),
            workspace_ids,
        )?;
        result.graph_statistics = count_by_workspace(conn, "graph_statistics", workspace_ids)?;
        result.roadmap_snapshots = count_by_workspace(conn, "roadmap_snapshots", workspace_ids)?;
        result.change_proposals =
            count_by_workspace(conn, "concept_change_proposals", workspace_ids)?;
        result.learning_goals_detached = count_sql(
            conn,
            &format!(
                "SELECT COUNT(*) FROM learning_goals WHERE concept_id IN ({concept_subquery})"
            ),
            workspace_ids,
        )?;
    }

    if options.clear_analysis_jobs.unwrap_or(true) {
        result.analyze_jobs = count_by_workspace(conn, "analyze_jobs", workspace_ids)?;
        result.analyze_job_chunks = count_sql(
            conn,
            &format!("SELECT COUNT(*) FROM analyze_job_chunks WHERE job_id IN ({job_subquery})"),
            workspace_ids,
        )?;
    }

    if options.clear_legacy_topics.unwrap_or(true) {
        result.flashcard_topics = count_by_workspace(conn, "flashcard_topics", workspace_ids)?;
    }

    if options.delete_generated_cards.unwrap_or(true) {
        result.generated_cards_deleted = count_sql(
            conn,
            &format!(
                "SELECT COUNT(*) FROM learning_cards \
                 WHERE workspace_id IN ({in_clause}) \
                   AND (source_type = 'concept' OR topic_id IS NOT NULL OR source_type = 'chat_topic')"
            ),
            workspace_ids,
        )?;
    } else {
        result.generated_cards_detached = count_sql(
            conn,
            &format!(
                "SELECT COUNT(*) FROM learning_cards \
                 WHERE workspace_id IN ({in_clause}) \
                   AND (source_type = 'concept' OR topic_id IS NOT NULL OR source_type = 'chat_topic')"
            ),
            workspace_ids,
        )?;
    }

    if options.clear_topic_signatures.unwrap_or(true) {
        result.topic_signatures_cleared = count_sql(
            conn,
            &format!(
                "SELECT COUNT(*) FROM workspaces \
                 WHERE id IN ({in_clause}) AND (topic_signature != '{{}}' OR signature_updated_at IS NOT NULL)"
            ),
            workspace_ids,
        )?;
    }

    if options.clear_prompt_bank.unwrap_or(true) {
        result.prompt_bank_prompts =
            count_by_workspace(conn, "workspace_prompt_bank", workspace_ids)?;
        result.prompt_bank_jobs =
            count_by_workspace(conn, "workspace_prompt_bank_jobs", workspace_ids)?;
    }

    Ok(result)
}

fn apply_knowledge_reset(
    conn: &rusqlite::Connection,
    workspace_ids: &[String],
    options: &KnowledgeResetOptions,
) -> Result<KnowledgeResetResult, String> {
    let mut result = KnowledgeResetResult::default();
    let in_clause = placeholders(workspace_ids.len());
    let concept_subquery = scoped_concept_subquery(&in_clause);
    let job_subquery = scoped_job_subquery(&in_clause);

    if options.delete_generated_cards.unwrap_or(true) {
        result.generated_cards_deleted = execute_sql(
            conn,
            &format!(
                "DELETE FROM learning_cards \
                 WHERE workspace_id IN ({in_clause}) \
                   AND (source_type = 'concept' OR topic_id IS NOT NULL OR source_type = 'chat_topic')"
            ),
            workspace_ids,
        )?;
    } else {
        result.generated_cards_detached = execute_sql(
            conn,
            &format!(
                "UPDATE learning_cards \
                 SET source_type = 'manual', source_id = NULL, topic_id = NULL \
                 WHERE workspace_id IN ({in_clause}) \
                   AND (source_type = 'concept' OR topic_id IS NOT NULL OR source_type = 'chat_topic')"
            ),
            workspace_ids,
        )?;
    }

    if options.clear_graph.unwrap_or(true) {
        result.learning_goals_detached = execute_sql(
            conn,
            &format!("UPDATE learning_goals SET concept_id = NULL WHERE concept_id IN ({concept_subquery})"),
            workspace_ids,
        )?;
        result.concept_mentions = execute_sql(
            conn,
            &format!("DELETE FROM concept_mentions WHERE concept_id IN ({concept_subquery})"),
            workspace_ids,
        )?;
        result.concept_links = execute_sql(
            conn,
            &format!(
                "WITH scoped_concepts AS ({concept_subquery}) \
                 DELETE FROM concept_links \
                 WHERE source_id IN (SELECT id FROM scoped_concepts) \
                    OR target_id IN (SELECT id FROM scoped_concepts)"
            ),
            workspace_ids,
        )?;
        result.change_proposals =
            delete_by_workspace(conn, "concept_change_proposals", workspace_ids)?;
        result.graph_statistics = delete_by_workspace(conn, "graph_statistics", workspace_ids)?;
        result.roadmap_snapshots = delete_by_workspace(conn, "roadmap_snapshots", workspace_ids)?;
        result.concept_nodes = delete_by_workspace(conn, "concept_nodes", workspace_ids)?;
    }

    if options.clear_analysis_jobs.unwrap_or(true) {
        result.analyze_job_chunks = execute_sql(
            conn,
            &format!("DELETE FROM analyze_job_chunks WHERE job_id IN ({job_subquery})"),
            workspace_ids,
        )?;
        result.analyze_jobs = delete_by_workspace(conn, "analyze_jobs", workspace_ids)?;
    }

    if options.clear_legacy_topics.unwrap_or(true) {
        result.flashcard_topics = delete_by_workspace(conn, "flashcard_topics", workspace_ids)?;
    }

    if options.clear_topic_signatures.unwrap_or(true) {
        result.topic_signatures_cleared = execute_sql(
            conn,
            &format!(
                "UPDATE workspaces SET topic_signature = '{{}}', signature_updated_at = NULL \
                 WHERE id IN ({in_clause}) AND (topic_signature != '{{}}' OR signature_updated_at IS NOT NULL)"
            ),
            workspace_ids,
        )?;
    }

    if options.clear_prompt_bank.unwrap_or(true) {
        result.prompt_bank_prompts =
            delete_by_workspace(conn, "workspace_prompt_bank", workspace_ids)?;
        result.prompt_bank_jobs =
            delete_by_workspace(conn, "workspace_prompt_bank_jobs", workspace_ids)?;
    }

    Ok(result)
}

#[cfg(test)]
mod knowledge_reset_tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;
    use rusqlite::Connection;

    fn ensure_reset_test_tables(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS analyze_jobs (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                model TEXT NOT NULL,
                total_chunks INTEGER NOT NULL,
                completed_chunks INTEGER NOT NULL DEFAULT 0,
                failed_chunks INTEGER NOT NULL DEFAULT 0,
                chunk_budget INTEGER NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                error TEXT
            );
            CREATE TABLE IF NOT EXISTS analyze_job_chunks (
                job_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                label TEXT NOT NULL,
                char_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                nodes_created INTEGER NOT NULL DEFAULT 0,
                links_created INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                finished_at TEXT,
                PRIMARY KEY (job_id, chunk_index)
            );",
        )
        .unwrap();
        let _ = conn.execute_batch(
            "ALTER TABLE learning_goals ADD COLUMN concept_id TEXT;
             ALTER TABLE learning_cards ADD COLUMN topic_id TEXT;
             ALTER TABLE learning_cards ADD COLUMN source_id TEXT;",
        );
    }

    fn insert_workspace(conn: &Connection, id: &str, parent_id: Option<&str>) {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO workspaces (id, name, description, icon, is_hidden, parent_workspace_id, topic_signature, signature_updated_at, created_at, updated_at, order_index)
             VALUES (?1, ?2, '', '📁', 0, ?3, '{\"auto_detected_tags\":[]}', ?4, ?4, ?4, 0)",
            rusqlite::params![id, id, parent_id, now],
        )
        .unwrap();
    }

    fn insert_reset_fixture(conn: &Connection, workspace_id: &str, suffix: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        let concept_id = format!("concept-{suffix}");
        let concept_2_id = format!("concept-2-{suffix}");
        let link_id = format!("link-{suffix}");
        let mention_id = format!("mention-{suffix}");
        let job_id = format!("job-{suffix}");
        let proposal_id = format!("proposal-{suffix}");
        let topic_id = format!("topic-{suffix}");
        let graph_id = format!("stats-{suffix}");
        let prompt_id = format!("prompt-{suffix}");
        let prompt_job_id = format!("prompt-job-{suffix}");
        let goal_id = format!("goal-{suffix}");
        let card_concept_id = format!("card-concept-{suffix}");
        let card_topic_id = format!("card-topic-{suffix}");
        let card_manual_id = format!("card-manual-{suffix}");
        let note_id = format!("note-{suffix}");
        let snapshot_id = format!("snapshot-{suffix}");

        conn.execute(
            "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, created_at, updated_at, hierarchy_level)
             VALUES (?1, ?2, ?3, '', 'topic', '[]', '[]', '[]', ?4, ?4, 'concept')",
            rusqlite::params![concept_id, workspace_id, format!("Concept {suffix}"), now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, created_at, updated_at, hierarchy_level)
             VALUES (?1, ?2, ?3, '', 'topic', '[]', '[]', '[]', ?4, ?4, 'concept')",
            rusqlite::params![concept_2_id, workspace_id, format!("Concept 2 {suffix}"), now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at)
             VALUES (?1, ?2, ?3, 'related', 0.5, '', ?4)",
            rusqlite::params![link_id, concept_id, concept_2_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO concept_mentions (id, concept_id, source_type, source_id, context, created_at)
             VALUES (?1, ?2, 'note', ?3, '', ?4)",
            rusqlite::params![mention_id, concept_id, note_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO analyze_jobs (id, workspace_id, model, total_chunks, completed_chunks, failed_chunks, chunk_budget, status, started_at)
             VALUES (?1, ?2, 'test-model', 1, 1, 0, 2000, 'completed', ?3)",
            rusqlite::params![job_id, workspace_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO analyze_job_chunks (job_id, chunk_index, label, char_count, status)
             VALUES (?1, 0, 'Batch 1/1', 100, 'completed')",
            rusqlite::params![job_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO concept_change_proposals (id, workspace_id, job_id, proposal_type, target_node_id, payload, created_at)
             VALUES (?1, ?2, ?3, 'upgrade', ?4, '{}', ?5)",
            rusqlite::params![proposal_id, workspace_id, job_id, concept_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO graph_statistics (id, workspace_id, total_concepts, total_links, updated_at)
             VALUES (?1, ?2, 2, 1, ?3)",
            rusqlite::params![graph_id, workspace_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO roadmap_snapshots (id, workspace_id, source_job_id, source_model, concept_count, link_count, payload, created_at)
             VALUES (?1, ?2, ?3, 'test-model', 2, 1, '{\"nodes\":[],\"links\":[],\"mentions\":[],\"graph_statistics\":null}', ?4)",
            rusqlite::params![snapshot_id, workspace_id, job_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO flashcard_topics (id, workspace_id, topic, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![topic_id, workspace_id, format!("Topic {suffix}"), now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, source_id, created_at)
             VALUES (?1, ?2, 'front', 'back', 'concept', ?3, ?4)",
            rusqlite::params![card_concept_id, workspace_id, concept_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, topic_id, created_at)
             VALUES (?1, ?2, 'front', 'back', 'chat_topic', ?3, ?4)",
            rusqlite::params![card_topic_id, workspace_id, topic_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, created_at)
             VALUES (?1, ?2, 'front', 'back', 'manual', ?3)",
            rusqlite::params![card_manual_id, workspace_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO learning_goals (id, workspace_id, title, concept_id, created_at, updated_at)
             VALUES (?1, ?2, 'Goal', ?3, ?4, ?4)",
            rusqlite::params![goal_id, workspace_id, concept_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspace_prompt_bank (id, workspace_id, prompt, normalized_prompt, created_at, updated_at)
             VALUES (?1, ?2, 'Prompt', ?3, ?4, ?4)",
            rusqlite::params![prompt_id, workspace_id, format!("prompt-{suffix}"), now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspace_prompt_bank_jobs (id, workspace_id, status, created_at, updated_at)
             VALUES (?1, ?2, 'completed', ?3, ?3)",
            rusqlite::params![prompt_job_id, workspace_id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO project_notes (id, workspace_id, title, content, created_at, updated_at)
             VALUES (?1, ?2, 'Note', 'Source material', ?3, ?3)",
            rusqlite::params![note_id, workspace_id, now],
        )
        .unwrap();
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get::<_, i64>(0)).unwrap()
    }

    #[test]
    fn reset_workspace_clears_derived_state_and_preserves_source_material() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-1", None);
        insert_workspace(&conn, "ws-2", None);
        insert_reset_fixture(&conn, "ws-1", "one");
        insert_reset_fixture(&conn, "ws-2", "two");

        let preview = reset_knowledge_state_inner(
            &mut conn,
            KnowledgeResetRequest {
                scope: KnowledgeResetScope::Workspace,
                workspace_id: Some("ws-1".to_string()),
                options: None,
                dry_run: Some(true),
            },
        )
        .unwrap();
        assert_eq!(preview.concept_nodes, 2);
        assert_eq!(preview.roadmap_snapshots, 1);
        assert_eq!(preview.generated_cards_deleted, 2);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = 'ws-1'"
            ),
            2
        );

        let result = reset_knowledge_state_inner(
            &mut conn,
            KnowledgeResetRequest {
                scope: KnowledgeResetScope::Workspace,
                workspace_id: Some("ws-1".to_string()),
                options: None,
                dry_run: Some(false),
            },
        )
        .unwrap();
        assert_eq!(result.concept_nodes, 2);
        assert_eq!(result.learning_goals_detached, 1);

        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = 'ws-1'"
            ),
            0
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM analyze_jobs WHERE workspace_id = 'ws-1'"
            ),
            0
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM roadmap_snapshots WHERE workspace_id = 'ws-1'"
            ),
            0
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM workspace_prompt_bank WHERE workspace_id = 'ws-1'"
            ),
            0
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM flashcard_topics WHERE workspace_id = 'ws-1'"
            ),
            0
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM learning_cards WHERE workspace_id = 'ws-1' AND source_type != 'manual'"), 0);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM learning_cards WHERE workspace_id = 'ws-1'"
            ),
            1
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM project_notes WHERE workspace_id = 'ws-1'"
            ),
            1
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM learning_goals WHERE workspace_id = 'ws-1' AND concept_id IS NULL"), 1);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = 'ws-2'"
            ),
            2
        );
    }

    #[test]
    fn reset_workspace_with_children_includes_descendants() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "root", None);
        insert_workspace(&conn, "child", Some("root"));
        insert_workspace(&conn, "sibling", None);
        insert_reset_fixture(&conn, "root", "root");
        insert_reset_fixture(&conn, "child", "child");
        insert_reset_fixture(&conn, "sibling", "sibling");

        let result = reset_knowledge_state_inner(
            &mut conn,
            KnowledgeResetRequest {
                scope: KnowledgeResetScope::WorkspaceWithChildren,
                workspace_id: Some("root".to_string()),
                options: None,
                dry_run: Some(false),
            },
        )
        .unwrap();

        assert_eq!(result.workspace_count, 2);
        assert_eq!(result.concept_nodes, 4);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id IN ('root', 'child')"
            ),
            0
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = 'sibling'"
            ),
            2
        );
    }

    #[test]
    fn reset_can_detach_generated_cards_instead_of_deleting_them() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-1", None);
        insert_reset_fixture(&conn, "ws-1", "one");

        let result = reset_knowledge_state_inner(
            &mut conn,
            KnowledgeResetRequest {
                scope: KnowledgeResetScope::Workspace,
                workspace_id: Some("ws-1".to_string()),
                options: Some(KnowledgeResetOptions {
                    delete_generated_cards: Some(false),
                    ..Default::default()
                }),
                dry_run: Some(false),
            },
        )
        .unwrap();

        assert_eq!(result.generated_cards_deleted, 0);
        assert_eq!(result.generated_cards_detached, 2);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM learning_cards WHERE workspace_id = 'ws-1'"
            ),
            3
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM learning_cards WHERE workspace_id = 'ws-1' AND source_type = 'manual' AND source_id IS NULL AND topic_id IS NULL"), 3);
    }

    #[test]
    fn snapshot_skips_workspace_with_no_concepts() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-empty", None);

        let outcome =
            capture_workspace_snapshot(&conn, "ws-empty", SnapshotReason::Scheduled, None, None)
                .unwrap();

        assert_eq!(outcome, SnapshotOutcome::SkippedEmpty);
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM roadmap_snapshots"),
            0
        );
    }

    #[test]
    fn snapshot_skips_when_payload_unchanged() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-1", None);
        insert_reset_fixture(&conn, "ws-1", "one");
        conn.execute("DELETE FROM roadmap_snapshots", []).unwrap();

        let first =
            capture_workspace_snapshot(&conn, "ws-1", SnapshotReason::Scheduled, None, None)
                .unwrap();
        let second =
            capture_workspace_snapshot(&conn, "ws-1", SnapshotReason::Scheduled, None, None)
                .unwrap();

        assert!(matches!(first, SnapshotOutcome::Created(_)));
        assert_eq!(second, SnapshotOutcome::SkippedUnchanged);
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM roadmap_snapshots WHERE workspace_id = 'ws-1'"),
            1
        );
    }

    #[test]
    fn snapshot_writes_again_after_graph_change() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-1", None);
        insert_reset_fixture(&conn, "ws-1", "one");
        conn.execute("DELETE FROM roadmap_snapshots", []).unwrap();

        capture_workspace_snapshot(&conn, "ws-1", SnapshotReason::Scheduled, None, None).unwrap();
        conn.execute(
            "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, created_at, updated_at, hierarchy_level)
             VALUES ('extra-node', 'ws-1', 'Extra', '', 'topic', '[]', '[]', '[]', datetime('now'), datetime('now'), 'concept')",
            [],
        )
        .unwrap();
        capture_workspace_snapshot(&conn, "ws-1", SnapshotReason::Scheduled, None, None).unwrap();

        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM roadmap_snapshots WHERE workspace_id = 'ws-1'"),
            2
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(DISTINCT payload_hash) FROM roadmap_snapshots WHERE workspace_id = 'ws-1'"
            ),
            2
        );
    }

    #[test]
    fn snapshot_records_reason() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-1", None);
        insert_reset_fixture(&conn, "ws-1", "one");
        conn.execute("DELETE FROM roadmap_snapshots", []).unwrap();

        capture_workspace_snapshot(&conn, "ws-1", SnapshotReason::Manual, None, None).unwrap();

        let reason: String = conn
            .query_row(
                "SELECT reason FROM roadmap_snapshots WHERE workspace_id = 'ws-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(reason, "manual");
    }

    #[test]
    fn snapshot_count_cap_prunes_oldest() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-1", None);
        insert_reset_fixture(&conn, "ws-1", "one");
        conn.execute("DELETE FROM roadmap_snapshots", []).unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('roadmap_snapshot_max_per_workspace', '3')",
            [],
        )
        .unwrap();

        // Mutate between captures so the hash differs each time.
        for i in 0..5 {
            conn.execute(
                "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, created_at, updated_at, hierarchy_level)
                 VALUES (?1, 'ws-1', ?2, '', 'topic', '[]', '[]', '[]', datetime('now'), datetime('now'), 'concept')",
                rusqlite::params![format!("cap-node-{i}"), format!("Cap {i}")],
            )
            .unwrap();
            capture_workspace_snapshot(&conn, "ws-1", SnapshotReason::Scheduled, None, None)
                .unwrap();
        }

        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM roadmap_snapshots WHERE workspace_id = 'ws-1'"),
            3
        );
    }

    #[test]
    fn snapshot_age_prune_removes_old_rows() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-1", None);
        insert_reset_fixture(&conn, "ws-1", "one");
        conn.execute("DELETE FROM roadmap_snapshots", []).unwrap();
        conn.execute(
            "INSERT INTO roadmap_snapshots (id, workspace_id, source_job_id, source_model, concept_count, link_count, payload, created_at, reason, payload_hash)
             VALUES ('ancient', 'ws-1', NULL, NULL, 0, 0, '{}', datetime('now','-90 days'), 'analysis', 'oldhash')",
            [],
        )
        .unwrap();

        capture_workspace_snapshot(&conn, "ws-1", SnapshotReason::Scheduled, None, None).unwrap();

        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM roadmap_snapshots WHERE id = 'ancient'"),
            0
        );
    }

    /// Regression guard for the provenance-loss bug: restoring used to reset
    /// confidence / source_model / user_edited_fields to column defaults.
    #[test]
    fn snapshot_preserves_provenance_through_restore() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-1", None);
        insert_reset_fixture(&conn, "ws-1", "one");
        conn.execute("DELETE FROM roadmap_snapshots", []).unwrap();

        conn.execute(
            "UPDATE concept_nodes
             SET source_model = 'm1', confidence = 0.93,
                 user_edited_fields = '[\"name\"]', last_modified_by_job = 'job-x'
             WHERE id = 'concept-one'",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE concept_links
             SET source_model = 'm2', confidence = 0.71, last_modified_by_job = 'job-y'
             WHERE id = 'link-one'",
            [],
        )
        .unwrap();

        capture_workspace_snapshot(&conn, "ws-1", SnapshotReason::Manual, None, None).unwrap();
        let payload_json: String = conn
            .query_row(
                "SELECT payload FROM roadmap_snapshots WHERE workspace_id = 'ws-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let payload: RoadmapSnapshotPayload = serde_json::from_str(&payload_json).unwrap();

        conn.execute("DELETE FROM concept_nodes WHERE workspace_id = 'ws-1'", [])
            .unwrap();

        let tx = conn.transaction().unwrap();
        restore_snapshot_inner(&tx, "ws-1", &payload).unwrap();
        tx.commit().unwrap();

        let (model, confidence, edited, job): (Option<String>, f64, String, Option<String>) = conn
            .query_row(
                "SELECT source_model, confidence, user_edited_fields, last_modified_by_job
                 FROM concept_nodes WHERE id = 'concept-one'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(model.as_deref(), Some("m1"));
        assert!((confidence - 0.93).abs() < f64::EPSILON);
        assert_eq!(edited, "[\"name\"]");
        assert_eq!(job.as_deref(), Some("job-x"));

        let (link_model, link_conf): (Option<String>, f64) = conn
            .query_row(
                "SELECT source_model, confidence FROM concept_links WHERE id = 'link-one'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(link_model.as_deref(), Some("m2"));
        assert!((link_conf - 0.71).abs() < f64::EPSILON);
    }

    /// `superseded_by` is a self-FK; a node superseded by a later-created one
    /// must not be inserted before its target exists.
    #[test]
    fn snapshot_restore_reattaches_superseded_by() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-1", None);
        insert_reset_fixture(&conn, "ws-1", "one");
        conn.execute("DELETE FROM roadmap_snapshots", []).unwrap();

        // concept-one is older than concept-2-one, so it sorts first and its
        // supersede target is not yet inserted during pass 1.
        conn.execute(
            "UPDATE concept_nodes
             SET superseded_by = 'concept-2-one', superseded_at = datetime('now'),
                 supersede_reason = 'merged'
             WHERE id = 'concept-one'",
            [],
        )
        .unwrap();

        capture_workspace_snapshot(&conn, "ws-1", SnapshotReason::Manual, None, None).unwrap();
        let payload_json: String = conn
            .query_row(
                "SELECT payload FROM roadmap_snapshots WHERE workspace_id = 'ws-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let payload: RoadmapSnapshotPayload = serde_json::from_str(&payload_json).unwrap();

        conn.execute("DELETE FROM concept_nodes WHERE workspace_id = 'ws-1'", [])
            .unwrap();
        let tx = conn.transaction().unwrap();
        restore_snapshot_inner(&tx, "ws-1", &payload).unwrap();
        tx.commit().unwrap();

        let superseded_by: Option<String> = conn
            .query_row(
                "SELECT superseded_by FROM concept_nodes WHERE id = 'concept-one'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(superseded_by.as_deref(), Some("concept-2-one"));
    }

    /// Payloads written before v80 have no provenance fields; they must still
    /// deserialize, and `confidence` must land on the schema default of 0.5
    /// rather than f64's 0.0.
    #[test]
    fn legacy_payload_without_provenance_still_restores() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-1", None);

        let legacy = r#"{
            "nodes": [{
                "id": "legacy-node", "workspace_id": "ws-1", "name": "Legacy",
                "concept_description": "", "concept_type": "topic",
                "tags": [], "aliases": [], "references": [],
                "x_position": 0.0, "y_position": 0.0, "review_count": 0,
                "hierarchy_level": "concept",
                "created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z"
            }],
            "links": [], "mentions": [], "graph_statistics": null
        }"#;

        let payload: RoadmapSnapshotPayload = serde_json::from_str(legacy).unwrap();
        assert_eq!(payload.nodes.len(), 1);
        assert!(payload.nodes[0].source_model.is_none());
        assert!(payload.nodes[0].user_edited_fields.is_empty());
        assert!((payload.nodes[0].confidence - 0.5).abs() < f64::EPSILON);

        let tx = conn.transaction().unwrap();
        restore_snapshot_inner(&tx, "ws-1", &payload).unwrap();
        tx.commit().unwrap();

        let (confidence, edited): (f64, String) = conn
            .query_row(
                "SELECT confidence, user_edited_fields FROM concept_nodes WHERE id = 'legacy-node'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!((confidence - 0.5).abs() < f64::EPSILON);
        // Must be valid JSON, not "" — the column has a json_valid CHECK.
        assert_eq!(edited, "[]");
    }

    #[test]
    fn drift_ratio_handles_empty_baseline() {
        // No baseline: the interval trigger owns this case, so report no drift.
        assert!((drift_ratio(5, 3, 0, 0) - 0.0).abs() < f64::EPSILON);
        assert!((drift_ratio(115, 0, 100, 0) - 0.15).abs() < 1e-9);
        // Shrinkage counts the same as growth.
        assert!((drift_ratio(85, 0, 100, 0) - 0.15).abs() < 1e-9);
    }

    #[test]
    fn scheduled_sweep_skips_empty_and_captures_due_workspaces() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-full", None);
        insert_workspace(&conn, "ws-empty", None);
        insert_reset_fixture(&conn, "ws-full", "one");
        conn.execute("DELETE FROM roadmap_snapshots", []).unwrap();

        let captured = run_scheduled_snapshot_sweep(&conn);

        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0].0, "ws-full");
        assert_eq!(captured[0].1, "scheduled");
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM roadmap_snapshots WHERE workspace_id = 'ws-empty'"),
            0
        );
    }

    #[test]
    fn snapshot_restore_replaces_workspace_graph_state() {
        let pool = setup_test_db();
        let mut conn = pool.get().unwrap();
        ensure_reset_test_tables(&conn);
        insert_workspace(&conn, "ws-1", None);
        insert_reset_fixture(&conn, "ws-1", "one");

        snapshot_workspace_roadmap(&conn, "ws-1", Some("job-one"), Some("test-model")).unwrap();
        let snapshot_id: String = conn
            .query_row(
                "SELECT id FROM roadmap_snapshots WHERE workspace_id = 'ws-1' ORDER BY created_at DESC, id DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        conn.execute("DELETE FROM concept_nodes WHERE workspace_id = 'ws-1'", [])
            .unwrap();
        conn.execute(
            "DELETE FROM graph_statistics WHERE workspace_id = 'ws-1'",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, created_at, updated_at, hierarchy_level)
             VALUES ('replacement-node', 'ws-1', 'Replacement', '', 'topic', '[]', '[]', '[]', datetime('now'), datetime('now'), 'concept')",
            [],
        )
        .unwrap();

        let payload_json: String = conn
            .query_row(
                "SELECT payload FROM roadmap_snapshots WHERE id = ?1",
                rusqlite::params![snapshot_id],
                |row| row.get(0),
            )
            .unwrap();
        let payload: RoadmapSnapshotPayload = serde_json::from_str(&payload_json).unwrap();

        let tx = conn.transaction().unwrap();
        tx.execute(
            "DELETE FROM concept_change_proposals WHERE workspace_id = 'ws-1'",
            [],
        )
        .unwrap();
        tx.execute(
            "DELETE FROM graph_statistics WHERE workspace_id = 'ws-1'",
            [],
        )
        .unwrap();
        tx.execute("DELETE FROM concept_nodes WHERE workspace_id = 'ws-1'", [])
            .unwrap();
        for node in &payload.nodes {
            tx.execute(
                "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                rusqlite::params![
                    &node.id,
                    &node.workspace_id,
                    &node.name,
                    &node.concept_description,
                    node.concept_type.to_string(),
                    serde_json::to_string(&node.tags).unwrap(),
                    serde_json::to_string(&node.aliases).unwrap(),
                    serde_json::to_string(&node.references).unwrap(),
                    node.x_position,
                    node.y_position,
                    node.review_count,
                    &node.created_at,
                    &node.updated_at,
                    node.hierarchy_level.to_string(),
                ],
            )
            .unwrap();
        }
        for link in &payload.links {
            tx.execute(
                "INSERT INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    &link.id,
                    &link.source_id,
                    &link.target_id,
                    link.link_type.to_string(),
                    link.strength,
                    &link.context,
                    &link.created_at,
                ],
            )
            .unwrap();
        }
        for mention in &payload.mentions {
            tx.execute(
                "INSERT INTO concept_mentions (id, concept_id, source_type, source_id, context, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    &mention.id,
                    &mention.concept_id,
                    &mention.source_type,
                    &mention.source_id,
                    &mention.context,
                    &mention.created_at,
                ],
            )
            .unwrap();
        }
        if let Some(stats) = &payload.graph_statistics {
            tx.execute(
                "INSERT INTO graph_statistics (id, workspace_id, total_concepts, total_links, avg_degree, density, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    &stats.id,
                    stats.workspace_id.clone(),
                    stats.total_concepts,
                    stats.total_links,
                    stats.avg_degree,
                    stats.density,
                    &stats.updated_at,
                ],
            )
            .unwrap();
        }
        tx.commit().unwrap();

        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = 'ws-1'"
            ),
            2
        );
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM concept_nodes WHERE workspace_id = 'ws-1' AND name = 'Replacement'"),
            0
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM concept_links"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM concept_mentions"), 1);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM graph_statistics WHERE workspace_id = 'ws-1'"
            ),
            1
        );
    }
}
