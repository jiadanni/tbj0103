use crate::commands::security::{require_auth, AuthState};
use crate::db::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportRequest {
    pub workspace_id: String,
    pub folder_id: Option<String>,
    pub include_chats: Option<bool>,
    pub include_notes: Option<bool>,
    pub include_concepts: Option<bool>,
}

#[tauri::command]
pub fn export_markdown(
    auth: State<AuthState>,
    state: State<DbState>,
    req: ExportRequest,
) -> Result<String, String> {
    require_auth(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut output = String::new();

    // Workspace header
    let (name,): (String,) = conn
        .query_row(
            "SELECT name FROM workspaces WHERE id = ?1",
            rusqlite::params![req.workspace_id],
            |r| Ok((r.get(0)?,)),
        )
        .map_err(|e| e.to_string())?;
    output.push_str(&format!("# {name}\n\n"));

    // Notes (workspace-scoped)
    if req.include_notes.unwrap_or(true) {
        let mut stmt = conn
            .prepare(
                "SELECT title, content FROM project_notes WHERE workspace_id = ?1 ORDER BY title",
            )
            .map_err(|e| e.to_string())?;
        let notes: Vec<(String, String)> = stmt
            .query_map(rusqlite::params![req.workspace_id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        if !notes.is_empty() {
            output.push_str("## Notes\n\n");
            for (title, content) in notes {
                output.push_str(&format!("### {title}\n\n{content}\n\n---\n\n"));
            }
        }
    }

    // Chats (all workspace sessions, or filtered by optional project)
    if req.include_chats.unwrap_or(true) {
        // Single JOIN query instead of N+1 (1 session fetch + N message fetches)
        let sql = if req.folder_id.is_some() {
            "SELECT cs.id, cs.title, m.role, m.content
             FROM chat_sessions cs
             LEFT JOIN messages m ON m.session_id = cs.id
             WHERE cs.folder_id = ?1
             ORDER BY cs.created_at, m.created_at"
        } else {
            "SELECT cs.id, cs.title, m.role, m.content
             FROM chat_sessions cs
             JOIN folders p ON cs.folder_id = p.id
             LEFT JOIN messages m ON m.session_id = cs.id
             WHERE p.workspace_id = ?1
             ORDER BY cs.created_at, m.created_at"
        };
        let param = if let Some(ref pid) = req.folder_id {
            pid
        } else {
            &req.workspace_id
        };
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows: Vec<(String, String, Option<String>, Option<String>)> = stmt
            .query_map(rusqlite::params![param], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();

        if !rows.is_empty() {
            output.push_str("## Chat Sessions\n\n");
            let mut current_session_id = String::new();
            for (session_id, title, role, content) in &rows {
                if *session_id != current_session_id {
                    if !current_session_id.is_empty() {
                        output.push_str("---\n\n");
                    }
                    output.push_str(&format!("### {title}\n\n"));
                    current_session_id = session_id.clone();
                }
                if let (Some(role), Some(content)) = (role, content) {
                    let label = if role == "user" {
                        "**You**"
                    } else {
                        "**Assistant**"
                    };
                    output.push_str(&format!("{label}: {content}\n\n"));
                }
            }
            output.push_str("---\n\n");
        }
    }

    Ok(output)
}

#[tauri::command]
pub fn export_json(
    auth: State<AuthState>,
    state: State<DbState>,
    req: ExportRequest,
) -> Result<String, String> {
    require_auth(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let workspace: serde_json::Value = conn
        .query_row(
            "SELECT id, name FROM workspaces WHERE id = ?1",
            rusqlite::params![req.workspace_id],
            |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, String>(0)?,
                    "name": r.get::<_, String>(1)?,
                }))
            },
        )
        .map_err(|e| e.to_string())?;

    let json = serde_json::json!({
        "export_version": "1.0",
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "workspace": workspace
    });
    serde_json::to_string_pretty(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_obsidian_vault(
    auth: State<AuthState>,
    state: State<DbState>,
    req: ExportRequest,
) -> Result<Vec<serde_json::Value>, String> {
    require_auth(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut files: Vec<serde_json::Value> = Vec::new();

    // Concepts as individual markdown files with YAML frontmatter
    let mut stmt = conn
        .prepare(
            "SELECT id, name, concept_description, concept_type, tags
         FROM concept_nodes WHERE workspace_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let concepts = stmt
        .query_map(rusqlite::params![req.workspace_id], |r| {
            let tags_json: String = r.get(4)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok((
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                tags,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok);

    for (name, desc, concept_type, tags) in concepts {
        let tags_yaml = tags
            .iter()
            .map(|t| format!("  - {t}"))
            .collect::<Vec<_>>()
            .join("\n");
        let content =
            format!("---\ntags:\n{tags_yaml}\ntype: {concept_type}\n---\n\n# {name}\n\n{desc}\n");
        files
            .push(serde_json::json!({ "path": format!("Concepts/{name}.md"), "content": content }));
    }

    // Notes (workspace-scoped)
    let mut stmt2 = conn
        .prepare("SELECT title, content FROM project_notes WHERE workspace_id = ?1")
        .map_err(|e| e.to_string())?;
    let notes = stmt2
        .query_map(rusqlite::params![req.workspace_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok);

    for (title, content) in notes {
        files.push(serde_json::json!({ "path": format!("Notes/{title}.md"), "content": content }));
    }

    Ok(files)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedDeckRequest {
    pub workspace_ids: Vec<String>,
}

pub(crate) fn build_feed_deck(
    conn: &rusqlite::Connection,
    workspace_ids: &[String],
) -> Result<String, String> {
    if workspace_ids.is_empty() {
        return Err("No workspaces selected".to_string());
    }

    let mut workspaces: Vec<serde_json::Value> = Vec::new();
    let mut cards: Vec<serde_json::Value> = Vec::new();

    let mut card_stmt = conn
        .prepare(
            "SELECT lc.id, lc.front, lc.back, ft.topic
             FROM learning_cards lc
             LEFT JOIN flashcard_topics ft ON ft.id = lc.topic_id
             WHERE lc.workspace_id = ?1
             ORDER BY lc.created_at",
        )
        .map_err(|e| e.to_string())?;

    for workspace_id in workspace_ids {
        let (ws_id, ws_name): (String, String) = conn
            .query_row(
                "SELECT id, name FROM workspaces WHERE id = ?1",
                rusqlite::params![workspace_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;

        let ws_cards: Vec<serde_json::Value> = card_stmt
            .query_map(rusqlite::params![workspace_id], |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, String>(0)?,
                    "kind": "flashcard",
                    "front": r.get::<_, String>(1)?,
                    "back": r.get::<_, String>(2)?,
                    "topic": r.get::<_, Option<String>>(3)?,
                    "workspace_id": ws_id,
                }))
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();

        workspaces.push(serde_json::json!({
            "id": ws_id,
            "name": ws_name,
            "card_count": ws_cards.len(),
        }));
        cards.extend(ws_cards);
    }

    if cards.is_empty() {
        return Err("No flashcards in the selected workspaces".to_string());
    }

    let deck = serde_json::json!({
        "format": "aetherium.boomscroll.deck",
        "version": 2,
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "workspaces": workspaces,
        "card_count": cards.len(),
        "cards": cards,
    });
    serde_json::to_string_pretty(&deck).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_feed_deck(
    auth: State<AuthState>,
    state: State<DbState>,
    req: FeedDeckRequest,
) -> Result<String, String> {
    require_auth(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    build_feed_deck(&conn, &req.workspace_ids)
}

#[cfg(test)]
mod feed_deck_tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;

    fn insert_workspace(conn: &rusqlite::Connection, id: &str, name: &str) {
        conn.execute(
            "INSERT OR IGNORE INTO workspaces (id, name, created_at, updated_at)
             VALUES (?1, ?2, datetime('now'), datetime('now'))",
            rusqlite::params![id, name],
        )
        .unwrap();
    }

    fn insert_card(conn: &rusqlite::Connection, id: &str, workspace_id: &str, topic_id: Option<&str>) {
        conn.execute(
            crate::commands::flashcard::INSERT_CARD_SQL,
            rusqlite::params![
                id,
                workspace_id,
                format!("Front {id}"),
                format!("Back {id}"),
                "manual",
                Option::<String>::None,
                topic_id,
                2.5_f64,
                0_i64,
                0_i64,
                "2026-01-01",
                Option::<String>::None,
                format!("2026-01-01T00:00:0{}Z", id.len() % 10),
                Option::<String>::None
            ],
        )
        .unwrap();
    }

    #[test]
    fn builds_multi_workspace_deck_with_topic_join() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_workspace(&conn, "ws_a", "Rust Study");
        insert_workspace(&conn, "ws_b", "Biology");
        conn.execute(
            "INSERT INTO flashcard_topics (id, workspace_id, topic) VALUES ('t1', 'ws_a', 'Ownership')",
            [],
        )
        .unwrap();
        insert_card(&conn, "c1", "ws_a", Some("t1"));
        insert_card(&conn, "c2", "ws_a", None);
        insert_card(&conn, "c3", "ws_b", None);

        let json =
            build_feed_deck(&conn, &["ws_a".to_string(), "ws_b".to_string()]).unwrap();
        let deck: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(deck["format"], "aetherium.boomscroll.deck");
        assert_eq!(deck["version"], 2);
        assert_eq!(deck["card_count"], 3);
        let workspaces = deck["workspaces"].as_array().unwrap();
        assert_eq!(workspaces.len(), 2);
        assert_eq!(workspaces[0]["name"], "Rust Study");
        assert_eq!(workspaces[0]["card_count"], 2);
        assert_eq!(workspaces[1]["name"], "Biology");
        let cards = deck["cards"].as_array().unwrap();
        assert_eq!(cards.len(), 3);
        assert_eq!(cards[0]["kind"], "flashcard");
        assert_eq!(cards[0]["topic"], "Ownership");
        assert_eq!(cards[0]["workspace_id"], "ws_a");
        assert!(cards[1]["topic"].is_null());
        assert_eq!(cards[2]["workspace_id"], "ws_b");
    }

    #[test]
    fn skips_nothing_but_errors_when_all_empty() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        insert_workspace(&conn, "ws_empty", "Empty WS");
        let err = build_feed_deck(&conn, &["ws_empty".to_string()]).unwrap_err();
        assert!(err.contains("No flashcards"));
    }

    #[test]
    fn empty_selection_errors() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        let err = build_feed_deck(&conn, &[]).unwrap_err();
        assert!(err.contains("No workspaces selected"));
    }
}
