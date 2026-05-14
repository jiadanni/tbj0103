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
pub fn export_markdown(auth: State<AuthState>, state: State<DbState>, req: ExportRequest) -> Result<String, String> {
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
pub fn export_json(auth: State<AuthState>, state: State<DbState>, req: ExportRequest) -> Result<String, String> {
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
