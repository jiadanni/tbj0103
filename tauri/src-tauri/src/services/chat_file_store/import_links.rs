//! Import source identity (v79) — persistence helpers that link imported
//! chats, memories, and destinations back to their source-export identifiers
//! (e.g., the Claude conversation UUID) so re-imports merge into existing
//! records instead of duplicating them.

use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// `source` value for Claude (claude.ai) exports.
pub const SOURCE_CLAUDE: &str = "claude";
/// Sentinel `source_project_uuid` for the destination of unassigned chats.
pub const ORPHANS_KEY: &str = "__orphans__";

/// A previously imported chat, joined to where it currently lives in-app.
#[derive(Debug, Clone, Serialize)]
pub struct LinkedSessionInfo {
    pub session_id: String,
    pub source_conversation_uuid: String,
    pub title: String,
    pub workspace_id: String,
    pub workspace_name: String,
    pub folder_id: String,
    pub folder_name: String,
}

/// A remembered import destination for a source project (or `ORPHANS_KEY`).
#[derive(Debug, Clone, Serialize)]
pub struct KnownDestination {
    pub source_project_uuid: String,
    pub source_project_name: String,
    pub workspace_id: String,
    pub workspace_name: String,
    pub folder_id: String,
    pub folder_name: String,
}

/// All links for `source`, keyed by source conversation UUID, joined to live
/// (non-deleted) sessions. Sessions removed in-app disappear via FK CASCADE.
pub fn load_links(
    conn: &Connection,
    source: &str,
) -> Result<HashMap<String, LinkedSessionInfo>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT l.source_conversation_uuid, l.chat_session_id, s.title,
                    s.workspace_id, w.name, s.folder_id, COALESCE(f.name, '')
             FROM import_source_links l
             JOIN chat_sessions s ON s.id = l.chat_session_id AND s.is_deleted = 0
             JOIN workspaces w ON w.id = s.workspace_id
             LEFT JOIN folders f ON f.id = s.folder_id
             WHERE l.source = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([source], |row| {
            Ok(LinkedSessionInfo {
                source_conversation_uuid: row.get(0)?,
                session_id: row.get(1)?,
                title: row.get(2)?,
                workspace_id: row.get(3)?,
                workspace_name: row.get(4)?,
                folder_id: row.get(5)?,
                folder_name: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut map = HashMap::new();
    for row in rows {
        let info = row.map_err(|e| e.to_string())?;
        map.insert(info.source_conversation_uuid.clone(), info);
    }
    Ok(map)
}

/// Insert or re-point the link for a source conversation.
pub fn upsert_link(
    conn: &Connection,
    source: &str,
    conversation_uuid: &str,
    session_id: &str,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO import_source_links
             (id, source, source_conversation_uuid, chat_session_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(source, source_conversation_uuid)
         DO UPDATE SET chat_session_id = excluded.chat_session_id,
                       updated_at = excluded.updated_at",
        rusqlite::params![
            uuid::Uuid::new_v4().to_string(),
            source,
            conversation_uuid,
            session_id,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// All remembered destinations for `source`, keyed by source project UUID
/// (including `ORPHANS_KEY`). Rows whose workspace vanished are gone via FK
/// CASCADE; rows pointing at a since-deleted folder are dropped here.
pub fn load_destinations(
    conn: &Connection,
    source: &str,
) -> Result<HashMap<String, KnownDestination>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT d.source_project_uuid, d.source_project_name, d.workspace_id,
                    w.name, d.folder_id, COALESCE(f.name, '')
             FROM import_destinations d
             JOIN workspaces w ON w.id = d.workspace_id
             LEFT JOIN folders f ON f.id = d.folder_id
             WHERE d.source = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([source], |row| {
            Ok(KnownDestination {
                source_project_uuid: row.get(0)?,
                source_project_name: row.get(1)?,
                workspace_id: row.get(2)?,
                workspace_name: row.get(3)?,
                folder_id: row.get(4)?,
                folder_name: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut map = HashMap::new();
    for row in rows {
        let dest = row.map_err(|e| e.to_string())?;
        // A non-empty folder_id whose folder no longer exists is stale.
        if !dest.folder_id.is_empty() && dest.folder_name.is_empty() {
            continue;
        }
        map.insert(dest.source_project_uuid.clone(), dest);
    }
    Ok(map)
}

/// Insert or update the remembered destination for a source project.
pub fn upsert_destination(
    conn: &Connection,
    source: &str,
    project_uuid: &str,
    project_name: &str,
    workspace_id: &str,
    folder_id: &str,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO import_destinations
             (id, source, source_project_uuid, source_project_name,
              workspace_id, folder_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(source, source_project_uuid)
         DO UPDATE SET source_project_name = excluded.source_project_name,
                       workspace_id = excluded.workspace_id,
                       folder_id = excluded.folder_id,
                       updated_at = excluded.updated_at",
        rusqlite::params![
            uuid::Uuid::new_v4().to_string(),
            source,
            project_uuid,
            project_name,
            workspace_id,
            folder_id,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// All memory links for `source`: source project UUID → (memory id, content hash).
/// Memories deleted in-app disappear via FK CASCADE.
pub fn load_memory_links(
    conn: &Connection,
    source: &str,
) -> Result<HashMap<String, (String, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT source_project_uuid, memory_id, content_hash
             FROM import_memory_links WHERE source = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([source], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut map = HashMap::new();
    for row in rows {
        let (project_uuid, memory_id, hash) = row.map_err(|e| e.to_string())?;
        map.insert(project_uuid, (memory_id, hash));
    }
    Ok(map)
}

/// Insert or update the memory link for a source project.
pub fn upsert_memory_link(
    conn: &Connection,
    source: &str,
    project_uuid: &str,
    memory_id: &str,
    content_hash: &str,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO import_memory_links
             (id, source, source_project_uuid, memory_id, content_hash, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(source, source_project_uuid)
         DO UPDATE SET memory_id = excluded.memory_id,
                       content_hash = excluded.content_hash,
                       updated_at = excluded.updated_at",
        rusqlite::params![
            uuid::Uuid::new_v4().to_string(),
            source,
            project_uuid,
            memory_id,
            content_hash,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Pick the dedup candidate for an unlinked chat from the sessions sharing its
/// (title, created_at): the one already at the resolved destination wins;
/// otherwise a candidate is only trusted when it is unambiguous (exactly one —
/// clones share title+created_at, so ambiguity means "no match").
/// Candidates are `(session_id, workspace_id, folder_id)` tuples.
pub fn pick_dedup_candidate<'a>(
    candidates: &'a [(String, String, String)],
    workspace_id: &str,
    folder_id: &str,
) -> Option<&'a str> {
    candidates
        .iter()
        .find(|(_, ws, fid)| ws == workspace_id && fid == folder_id)
        .or_else(|| {
            if candidates.len() == 1 {
                candidates.first()
            } else {
                None
            }
        })
        .map(|(sid, _, _)| sid.as_str())
}

/// Hex SHA-256 of memory content, used to skip unchanged memories on re-import.
pub fn memory_content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;

    fn seed_workspace(conn: &Connection, id: &str, name: &str) {
        conn.execute(
            "INSERT INTO workspaces (id, name) VALUES (?1, ?2)",
            rusqlite::params![id, name],
        )
        .unwrap();
    }

    fn seed_folder(conn: &Connection, id: &str, workspace_id: &str, name: &str) {
        conn.execute(
            "INSERT INTO folders (id, workspace_id, name) VALUES (?1, ?2, ?3)",
            rusqlite::params![id, workspace_id, name],
        )
        .unwrap();
    }

    fn seed_session(conn: &Connection, id: &str, workspace_id: &str, folder_id: &str, title: &str) {
        conn.execute(
            "INSERT INTO chat_sessions (id, workspace_id, folder_id, title, is_imported)
             VALUES (?1, ?2, ?3, ?4, 1)",
            rusqlite::params![id, workspace_id, folder_id, title],
        )
        .unwrap();
    }

    #[test]
    fn upsert_link_twice_keeps_one_row_with_latest_session() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        seed_workspace(&conn, "w1", "Workspace");
        seed_session(&conn, "s1", "w1", "", "Chat A");
        seed_session(&conn, "s2", "w1", "", "Chat B");

        upsert_link(&conn, SOURCE_CLAUDE, "conv-1", "s1", "2026-01-01T00:00:00Z").unwrap();
        upsert_link(&conn, SOURCE_CLAUDE, "conv-1", "s2", "2026-01-02T00:00:00Z").unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM import_source_links", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);

        let links = load_links(&conn, SOURCE_CLAUDE).unwrap();
        assert_eq!(links.get("conv-1").unwrap().session_id, "s2");
    }

    #[test]
    fn load_links_excludes_deleted_and_cascaded_sessions() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        seed_workspace(&conn, "w1", "Workspace");
        seed_folder(&conn, "f1", "w1", "Folder");
        seed_session(&conn, "s1", "w1", "f1", "Kept");
        seed_session(&conn, "s2", "w1", "", "Soft deleted");
        seed_session(&conn, "s3", "w1", "", "Hard deleted");
        let now = "2026-01-01T00:00:00Z";
        upsert_link(&conn, SOURCE_CLAUDE, "conv-1", "s1", now).unwrap();
        upsert_link(&conn, SOURCE_CLAUDE, "conv-2", "s2", now).unwrap();
        upsert_link(&conn, SOURCE_CLAUDE, "conv-3", "s3", now).unwrap();

        conn.execute("UPDATE chat_sessions SET is_deleted = 1 WHERE id = 's2'", [])
            .unwrap();
        conn.execute("DELETE FROM chat_sessions WHERE id = 's3'", [])
            .unwrap();

        let links = load_links(&conn, SOURCE_CLAUDE).unwrap();
        assert_eq!(links.len(), 1);
        let info = links.get("conv-1").unwrap();
        assert_eq!(info.session_id, "s1");
        assert_eq!(info.workspace_name, "Workspace");
        assert_eq!(info.folder_name, "Folder");
    }

    #[test]
    fn load_destinations_drops_stale_folders_and_upserts_in_place() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        seed_workspace(&conn, "w1", "Workspace");
        seed_folder(&conn, "f1", "w1", "Folder");
        let now = "2026-01-01T00:00:00Z";
        upsert_destination(&conn, SOURCE_CLAUDE, "proj-1", "Project", "w1", "f1", now).unwrap();
        upsert_destination(&conn, SOURCE_CLAUDE, ORPHANS_KEY, "", "w1", "", now).unwrap();
        // Re-point proj-1 to the workspace root; single row per project.
        upsert_destination(&conn, SOURCE_CLAUDE, "proj-1", "Project", "w1", "", now).unwrap();

        let dests = load_destinations(&conn, SOURCE_CLAUDE).unwrap();
        assert_eq!(dests.len(), 2);
        assert_eq!(dests.get("proj-1").unwrap().folder_id, "");
        assert!(dests.contains_key(ORPHANS_KEY));

        // A destination pointing at a deleted folder is dropped as stale.
        upsert_destination(&conn, SOURCE_CLAUDE, "proj-2", "Other", "w1", "f1", now).unwrap();
        conn.execute("DELETE FROM folders WHERE id = 'f1'", []).unwrap();
        let dests = load_destinations(&conn, SOURCE_CLAUDE).unwrap();
        assert!(!dests.contains_key("proj-2"));
    }

    #[test]
    fn memory_links_upsert_and_hash() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        seed_workspace(&conn, "w1", "Workspace");
        conn.execute(
            "INSERT INTO memories (id, workspace_id, content) VALUES ('m1', 'w1', 'remember this')",
            [],
        )
        .unwrap();
        let hash = memory_content_hash("remember this");
        upsert_memory_link(&conn, SOURCE_CLAUDE, "proj-1", "m1", &hash, "2026-01-01T00:00:00Z")
            .unwrap();
        let links = load_memory_links(&conn, SOURCE_CLAUDE).unwrap();
        assert_eq!(links.get("proj-1").unwrap(), &("m1".to_string(), hash.clone()));

        let hash2 = memory_content_hash("remember this, updated");
        assert_ne!(hash, hash2);
        upsert_memory_link(&conn, SOURCE_CLAUDE, "proj-1", "m1", &hash2, "2026-01-02T00:00:00Z")
            .unwrap();
        let links = load_memory_links(&conn, SOURCE_CLAUDE).unwrap();
        assert_eq!(links.get("proj-1").unwrap().1, hash2);
        assert_eq!(links.len(), 1);

        // Deleting the memory cascades the link away.
        conn.execute("DELETE FROM memories WHERE id = 'm1'", []).unwrap();
        assert!(load_memory_links(&conn, SOURCE_CLAUDE).unwrap().is_empty());
    }

    #[test]
    fn pick_dedup_candidate_prefers_scoped_then_unique_global() {
        let cands = vec![
            ("s1".to_string(), "w1".to_string(), "f1".to_string()),
            ("s2".to_string(), "w2".to_string(), "".to_string()),
        ];
        // Scoped match wins even with multiple candidates.
        assert_eq!(pick_dedup_candidate(&cands, "w2", ""), Some("s2"));
        // No scoped match + ambiguity → no candidate.
        assert_eq!(pick_dedup_candidate(&cands, "w3", ""), None);
        // No scoped match + exactly one candidate → unique-global match.
        let single = vec![("s1".to_string(), "w1".to_string(), "f1".to_string())];
        assert_eq!(pick_dedup_candidate(&single, "w3", ""), Some("s1"));
        assert_eq!(pick_dedup_candidate(&[], "w1", "f1"), None);
    }

    fn chat_data(
        id: &str,
        title: &str,
        messages: &[(&str, &str)],
    ) -> crate::services::chat_file_store::ChatFileData {
        crate::services::chat_file_store::ChatFileData {
            id: id.to_string(),
            title: title.to_string(),
            model: String::new(),
            system_prompt: String::new(),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: "2026-01-01T01:00:00.000Z".to_string(),
            messages: messages
                .iter()
                .enumerate()
                .map(|(i, (role, content))| crate::services::chat_file_store::ChatFileMessage {
                    id: format!("m{i}"),
                    role: role.to_string(),
                    content: content.to_string(),
                    model: None,
                    tokens_used: None,
                    duration_ms: None,
                    timestamp: format!("2026-01-01T00:0{i}:00.000Z"),
                })
                .collect(),
        }
    }

    #[test]
    fn reimport_after_inapp_rename_and_move_merges_via_link() {
        use crate::services::chat_file_store::{
            import_chat_data, reconcile_chat_data, ReconcileOutcome,
        };
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        seed_workspace(&conn, "w1", "Original");
        seed_workspace(&conn, "w2", "Elsewhere");
        let now = "2026-01-01T00:00:00Z";

        let data = chat_data("conv-1", "Original title", &[("user", "hi"), ("assistant", "hello")]);
        let sid = import_chat_data(&conn, &data, "w1", "").unwrap();
        upsert_link(&conn, SOURCE_CLAUDE, &data.id, &sid, now).unwrap();

        // User renames and moves the chat in-app.
        conn.execute(
            "UPDATE chat_sessions SET title = 'Renamed', workspace_id = 'w2' WHERE id = ?1",
            rusqlite::params![sid],
        )
        .unwrap();

        // Re-import resolves the same session through the link despite the
        // rename/move that breaks (workspace, folder, title, created_at) dedup.
        let links = load_links(&conn, SOURCE_CLAUDE).unwrap();
        let info = links.get("conv-1").expect("link survives rename/move");
        assert_eq!(info.session_id, sid);
        assert_eq!(info.workspace_id, "w2");
        assert!(matches!(
            reconcile_chat_data(&conn, &data, &info.session_id).unwrap(),
            ReconcileOutcome::Identical
        ));

        // A later export with an appended tail merges in place.
        let grown = chat_data(
            "conv-1",
            "Original title",
            &[("user", "hi"), ("assistant", "hello"), ("user", "one more")],
        );
        assert!(matches!(
            reconcile_chat_data(&conn, &grown, &info.session_id).unwrap(),
            ReconcileOutcome::Appended { new: 1 }
        ));
    }
}
