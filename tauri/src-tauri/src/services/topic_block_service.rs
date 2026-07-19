use rusqlite::Connection;
use std::collections::HashSet;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BlockedTopicRow {
    pub id: String,
    pub workspace_id: String,
    pub normalized_name: String,
    pub display_name: String,
    pub blocked_at: String,
}

pub fn normalize_topic_name(name: &str) -> String {
    name.trim().to_lowercase()
}

pub fn block_topic(conn: &Connection, workspace_id: &str, name: &str) -> Result<(), String> {
    let normalized = normalize_topic_name(name);
    let display = name.trim().to_string();
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT OR IGNORE INTO blocked_topics (id, workspace_id, normalized_name, display_name)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, workspace_id, normalized, display],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn unblock_topic(
    conn: &Connection,
    workspace_id: &str,
    normalized_name: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM blocked_topics WHERE workspace_id = ?1 AND normalized_name = ?2",
        rusqlite::params![workspace_id, normalized_name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_blocked_topics(
    conn: &Connection,
    workspace_id: &str,
) -> Result<Vec<BlockedTopicRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, normalized_name, display_name, blocked_at
             FROM blocked_topics WHERE workspace_id = ?1
             ORDER BY blocked_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![workspace_id], |r| {
            Ok(BlockedTopicRow {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                normalized_name: r.get(2)?,
                display_name: r.get(3)?,
                blocked_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn blocked_names_set(
    conn: &Connection,
    workspace_id: &str,
) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("SELECT normalized_name FROM blocked_topics WHERE workspace_id = ?1")
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map(rusqlite::params![workspace_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;

    fn create_workspace(conn: &Connection, id: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO workspaces (id, name, description, icon, is_hidden, created_at, updated_at, order_index)
             VALUES (?1, 'Test', '', '📁', 0, ?2, ?3, 0)",
            rusqlite::params![id, now, now],
        )
        .unwrap();
    }

    #[test]
    fn block_unblock_roundtrip() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        create_workspace(&conn, "ws1");

        // Block two topics
        block_topic(&conn, "ws1", "Main").unwrap();
        block_topic(&conn, "ws1", "Jatto").unwrap();

        // Duplicate block is a no-op
        block_topic(&conn, "ws1", "main").unwrap();

        let blocked = list_blocked_topics(&conn, "ws1").unwrap();
        assert_eq!(blocked.len(), 2);

        let names = blocked_names_set(&conn, "ws1").unwrap();
        assert!(names.contains("main"));
        assert!(names.contains("jatto"));

        // Unblock
        unblock_topic(&conn, "ws1", "main").unwrap();
        let blocked = list_blocked_topics(&conn, "ws1").unwrap();
        assert_eq!(blocked.len(), 1);
        assert_eq!(blocked[0].normalized_name, "jatto");
    }
}
