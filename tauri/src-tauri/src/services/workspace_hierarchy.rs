//! Workspace hierarchy helpers for the "bubble-up" feature.
//!
//! Content created in any descendant workspace appears in its ancestors' lists,
//! but descendants do NOT see ancestor content.
//!
//! Deliberately non-bubbling surfaces (keep exact-scope):
//! - services/topic_signature.rs
//! - services/memory_pipeline.rs
//! - commands/memory.rs
//! - services/context_assembler.rs
//! - commands/backup.rs
//! - commands/ai_knowledge.rs
//! - mcp_server/tools.rs, mcp_server/resources.rs
//! - services/quick_search_service.rs (FTS bubbling is a separate effort)

use rusqlite::Connection;

/// Reusable recursive CTE fragment yielding all descendant workspace IDs
/// (root included). Bind `?1` to the root workspace ID.
/// Can be used as a subquery: `WHERE workspace_id IN ({DESCENDANTS_CTE_SUBQUERY})`
pub const DESCENDANTS_CTE_SUBQUERY: &str = "\
    WITH RECURSIVE ws_tree(id) AS (\
        SELECT id FROM workspaces WHERE id = ?1 \
        UNION ALL \
        SELECT w.id FROM workspaces w \
        JOIN ws_tree t ON w.parent_workspace_id = t.id\
    ) \
    SELECT id FROM ws_tree";

/// CTE prefix to prepend to a full query. After this prefix, use
/// `workspace_id IN (SELECT id FROM ws_tree)` in the WHERE clause.
/// Bind `?1` to the root workspace ID.
pub const DESCENDANTS_CTE_PREFIX: &str = "\
WITH RECURSIVE ws_tree(id) AS (\
    SELECT id FROM workspaces WHERE id = ?1 \
    UNION ALL \
    SELECT w.id FROM workspaces w \
    JOIN ws_tree t ON w.parent_workspace_id = t.id\
) ";

/// Return all descendant workspace IDs (including the root itself).
pub fn descendant_workspace_ids(conn: &Connection, root_id: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE ws_tree(id) AS (
                SELECT id FROM workspaces WHERE id = ?1
                UNION ALL
                SELECT w.id FROM workspaces w
                JOIN ws_tree t ON w.parent_workspace_id = t.id
            )
            SELECT id FROM ws_tree",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![root_id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Returns `(sql_prefix, ws_condition)` for building workspace-filtered queries.
///
/// - When `false`: `("", "= ?1")`
/// - When `true`: `(DESCENDANTS_CTE_PREFIX, "IN (SELECT id FROM ws_tree)")`
///
/// Usage:
/// ```ignore
/// let (cte, ws_cond) = workspace_filter_sql(include_descendants);
/// let sql = format!("{cte}SELECT ... WHERE workspace_id {ws_cond} AND ...");
/// ```
pub fn workspace_filter_sql(include_descendants: bool) -> (&'static str, &'static str) {
    if include_descendants {
        (DESCENDANTS_CTE_PREFIX, "IN (SELECT id FROM ws_tree)")
    } else {
        ("", "= ?1")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;

    fn create_workspace(conn: &Connection, id: &str, name: &str, parent_id: Option<&str>) {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO workspaces (id, name, description, icon, is_hidden, parent_workspace_id, created_at, updated_at, order_index)
             VALUES (?1, ?2, '', '📁', 0, ?3, ?4, ?5, 0)",
            rusqlite::params![id, name, parent_id, now, now],
        )
        .unwrap();
    }

    #[test]
    fn test_descendant_workspace_ids_three_levels() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        create_workspace(&conn, "root", "Root", None);
        create_workspace(&conn, "child1", "Child 1", Some("root"));
        create_workspace(&conn, "child2", "Child 2", Some("root"));
        create_workspace(&conn, "grandchild1", "Grandchild 1", Some("child1"));

        let ids = descendant_workspace_ids(&conn, "root").unwrap();
        assert_eq!(ids.len(), 4);
        assert!(ids.contains(&"root".to_string()));
        assert!(ids.contains(&"child1".to_string()));
        assert!(ids.contains(&"child2".to_string()));
        assert!(ids.contains(&"grandchild1".to_string()));
    }

    #[test]
    fn test_descendant_isolated_workspace_returns_self() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        create_workspace(&conn, "isolated", "Isolated", None);

        let ids = descendant_workspace_ids(&conn, "isolated").unwrap();
        assert_eq!(ids, vec!["isolated".to_string()]);
    }

    #[test]
    fn test_descendant_does_not_leak_to_siblings() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        create_workspace(&conn, "root", "Root", None);
        create_workspace(&conn, "child1", "Child 1", Some("root"));
        create_workspace(&conn, "child2", "Child 2", Some("root"));
        create_workspace(&conn, "gc_of_child1", "GC1", Some("child1"));

        let ids = descendant_workspace_ids(&conn, "child1").unwrap();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"child1".to_string()));
        assert!(ids.contains(&"gc_of_child1".to_string()));
        assert!(!ids.contains(&"root".to_string()));
        assert!(!ids.contains(&"child2".to_string()));
    }
}
