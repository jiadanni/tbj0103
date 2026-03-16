//! Bidirectional linking engine.
//! Extracts [[concept]] links from note/chat content, auto-creates concept nodes,
//! and records mentions in the `concept_mentions` table.

use rusqlite::Connection;
use crate::services::link_parser::extract_concept_names;

/// Extract [[wiki-links]] from `content`, upsert corresponding concept_nodes
/// (workspace-scoped), delete stale mentions for this source, insert fresh ones.
/// Returns the list of concept names found.
pub fn index_note_links(
    conn: &Connection,
    source_type: &str,  // "note", "daily_note", "chat_message"
    source_id: &str,
    workspace_id: &str,
    content: &str,
) -> Result<Vec<String>, String> {
    let names = extract_concept_names(content);
    if names.is_empty() {
        // Still clean up old mentions if content was cleared
        conn.execute(
            "DELETE FROM concept_mentions WHERE source_type = ?1 AND source_id = ?2",
            rusqlite::params![source_type, source_id],
        ).map_err(|e| e.to_string())?;
        return Ok(vec![]);
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Delete previous mentions for this source so we can re-index cleanly
    conn.execute(
        "DELETE FROM concept_mentions WHERE source_type = ?1 AND source_id = ?2",
        rusqlite::params![source_type, source_id],
    ).map_err(|e| e.to_string())?;

    for name in &names {
        // Look up or create the concept_node
        let concept_id: String = {
            let res = conn.query_row(
                "SELECT id FROM concept_nodes WHERE workspace_id = ?1 AND lower(name) = lower(?2)",
                rusqlite::params![workspace_id, name],
                |r| r.get(0),
            );
            match res {
                Ok(id) => id,
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    let new_id = uuid::Uuid::new_v4().to_string();
                    conn.execute(
                        "INSERT INTO concept_nodes (id, workspace_id, name, concept_type, \
                         concept_description, tags, created_at, updated_at) \
                         VALUES (?1, ?2, ?3, 'note_link', '', '[]', ?4, ?4)",
                        rusqlite::params![new_id, workspace_id, name, now],
                    ).map_err(|e| e.to_string())?;
                    new_id
                }
                Err(e) => return Err(e.to_string()),
            }
        };

        let mention_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO concept_mentions \
             (id, concept_id, source_type, source_id, context, created_at) \
             VALUES (?1, ?2, ?3, ?4, '', ?5)",
            rusqlite::params![mention_id, concept_id, source_type, source_id, now],
        ).map_err(|e| e.to_string())?;
    }

    Ok(names)
}

/// Get all notes that link to a concept by its name.
pub fn get_backlinks_for_concept(
    conn: &Connection,
    workspace_id: &str,
    concept_name: &str,
) -> Result<Vec<BacklinkEntry>, String> {
    let mut stmt = conn.prepare(
        "SELECT cm.source_type, cm.source_id, cm.context, cn.name
         FROM concept_mentions cm
         JOIN concept_nodes cn ON cm.concept_id = cn.id
         WHERE cn.workspace_id = ?1 AND lower(cn.name) = lower(?2)"
    ).map_err(|e| e.to_string())?;
    let entries = stmt.query_map(rusqlite::params![workspace_id, concept_name], |row| {
        Ok(BacklinkEntry {
            source_type: row.get(0)?,
            source_id: row.get(1)?,
            context: row.get(2)?,
            concept_name: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?
    .filter_map(Result::ok)
    .collect();
    Ok(entries)
}

/// Get all concept names mentioned in a specific source.
pub fn get_outbound_links(
    conn: &Connection,
    source_type: &str,
    source_id: &str,
) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare(
        "SELECT cn.name FROM concept_mentions cm
         JOIN concept_nodes cn ON cm.concept_id = cn.id
         WHERE cm.source_type = ?1 AND cm.source_id = ?2"
    ).map_err(|e| e.to_string())?;
    let names = stmt.query_map(rusqlite::params![source_type, source_id], |row| {
        row.get::<_, String>(0)
    }).map_err(|e| e.to_string())?
    .filter_map(Result::ok)
    .collect();
    Ok(names)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BacklinkEntry {
    pub source_type: String,
    pub source_id: String,
    pub context: String,
    pub concept_name: String,
}
