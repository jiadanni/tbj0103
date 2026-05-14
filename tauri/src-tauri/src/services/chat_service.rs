use crate::models::chat::{
    AddMessageRequest, ChatSession, CreateChatSessionRequest, Message, MessageRole,
};
use crate::models::folder::Folder;
use crate::services::chat_file_store;
use crate::services::workspace_hierarchy::workspace_filter_sql;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct BatchMoveSessionsOutcome {
    pub sessions_moved: usize,
    pub folders_created: Vec<String>,
    pub folder_mapping: HashMap<String, String>,
}

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatSession> {
    Ok(ChatSession {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        folder_id: row.get(2)?,
        title: row.get(3)?,
        model_name: row.get(4)?,
        system_prompt: row.get(5)?,
        is_pinned: row.get::<_, i32>(6)? != 0,
        is_incognito: row.get::<_, i32>(7)? != 0,
        exclude_from_analytics: row.get::<_, i32>(8)? != 0,
        is_deleted: row.get::<_, i32>(9)? != 0,
        deleted_at: row.get(10)?,
        last_accessed_at: row.get(11)?,
        last_processed_message_count: row.get(12)?,
        is_imported: row.get::<_, i32>(13)? != 0,
        parent_session_id: row.get(14)?,
        branch_message_id: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        message_count: row.get(18)?,
    })
}

fn row_to_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<Message> {
    let role_str: String = row.get(2)?;
    let role = role_str.parse::<MessageRole>().unwrap_or(MessageRole::User);

    Ok(Message {
        id: row.get(0)?,
        session_id: row.get(1)?,
        role,
        content: row.get(3)?,
        model_name: row.get(4)?,
        tokens_used: row.get(5)?,
        duration_ms: row.get(6)?,
        variant_group_id: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        name: row.get(2)?,
        folder_description: row.get(3)?,
        custom_instructions: row.get(4)?,
        color: row.get(5)?,
        icon: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

pub fn create_session(
    conn: &Connection,
    req: CreateChatSessionRequest,
) -> Result<ChatSession, String> {
    let mut session = ChatSession::new(req.workspace_id, req.folder_id);
    if let Some(title) = req.title {
        session.title = title;
    }
    if let Some(model_name) = req.model_name {
        session.model_name = model_name;
    }
    if let Some(system_prompt) = req.system_prompt {
        session.system_prompt = system_prompt;
    }
    session.is_incognito = req.is_incognito.unwrap_or(false);
    session.exclude_from_analytics = req.exclude_from_analytics.unwrap_or(false);
    session.parent_session_id = req.parent_session_id;
    session.branch_message_id = req.branch_message_id;

    conn.execute(
        "INSERT INTO chat_sessions (
            id, workspace_id, folder_id, title, model_name, system_prompt,
            is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at,
            last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
            created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        rusqlite::params![
            session.id,
            session.workspace_id,
            session.folder_id,
            session.title,
            session.model_name,
            session.system_prompt,
            session.is_pinned as i32,
            session.is_incognito as i32,
            session.exclude_from_analytics as i32,
            session.is_deleted as i32,
            session.deleted_at,
            session.last_accessed_at,
            session.last_processed_message_count,
            session.is_imported as i32,
            session.parent_session_id,
            session.branch_message_id,
            session.created_at,
            session.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(session)
}

pub fn list_sessions(
    conn: &Connection,
    workspace_id: &str,
    folder_id: &str,
    limit: Option<i64>,
    offset: Option<i64>,
    include_descendants: bool,
) -> Result<Vec<ChatSession>, String> {
    let limit = limit.unwrap_or(200).clamp(1, 1000);
    let offset = offset.unwrap_or(0).max(0);
    let (cte, ws_cond) = workspace_filter_sql(include_descendants);
    let sql = if folder_id.is_empty() {
        format!(
            "{cte}SELECT id, workspace_id, folder_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
                created_at, updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = chat_sessions.id) AS message_count
         FROM chat_sessions
         WHERE workspace_id {ws_cond} AND is_deleted = 0
         ORDER BY is_pinned DESC, updated_at DESC
         LIMIT ?2 OFFSET ?3"
        )
    } else {
        format!(
            "{cte}SELECT id, workspace_id, folder_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
                created_at, updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = chat_sessions.id) AS message_count
         FROM chat_sessions
         WHERE workspace_id {ws_cond} AND folder_id = ?2 AND is_deleted = 0
         ORDER BY is_pinned DESC, updated_at DESC
         LIMIT ?3 OFFSET ?4"
        )
    };

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = if folder_id.is_empty() {
        stmt.query_map(rusqlite::params![workspace_id, limit, offset], row_to_session)
    } else {
        stmt.query_map(
            rusqlite::params![workspace_id, folder_id, limit, offset],
            row_to_session,
        )
    }
    .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn search_sessions(
    conn: &Connection,
    workspace_id: &str,
    folder_id: Option<&str>,
    query: &str,
    include_descendants: bool,
) -> Result<Vec<ChatSession>, String> {
    let pattern = format!("%{}%", query.trim());
    let (cte, ws_cond) = workspace_filter_sql(include_descendants);
    let sql = if folder_id.unwrap_or_default().is_empty() {
        format!(
            "{cte}SELECT id, workspace_id, folder_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
                created_at, updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = chat_sessions.id) AS message_count
         FROM chat_sessions
         WHERE workspace_id {ws_cond} AND is_deleted = 0
           AND (title LIKE ?2 OR model_name LIKE ?2)
         ORDER BY is_pinned DESC, updated_at DESC"
        )
    } else {
        format!(
            "{cte}SELECT id, workspace_id, folder_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
                created_at, updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = chat_sessions.id) AS message_count
         FROM chat_sessions
         WHERE workspace_id {ws_cond} AND folder_id = ?2 AND is_deleted = 0
           AND (title LIKE ?3 OR model_name LIKE ?3)
         ORDER BY is_pinned DESC, updated_at DESC"
        )
    };

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = if let Some(folder_id) = folder_id.filter(|id| !id.is_empty()) {
        stmt.query_map(
            rusqlite::params![workspace_id, folder_id, pattern],
            row_to_session,
        )
    } else {
        stmt.query_map(rusqlite::params![workspace_id, pattern], row_to_session)
    }
    .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_session(conn: &Connection, id: &str) -> Result<Option<ChatSession>, String> {
    let result = conn.query_row(
        "SELECT id, workspace_id, folder_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
                created_at, updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = chat_sessions.id) AS message_count
         FROM chat_sessions WHERE id = ?1",
        rusqlite::params![id],
        row_to_session,
    );

    match result {
        Ok(session) => Ok(Some(session)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn soft_delete(conn: &Connection, id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE chat_sessions
         SET is_deleted = 1, deleted_at = ?1, updated_at = ?1
         WHERE id = ?2",
        rusqlite::params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn hard_delete(conn: &Connection, workspace_id: &str, id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM chat_sessions WHERE id = ?1 AND workspace_id = ?2",
        rusqlite::params![id, workspace_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_deleted(
    conn: &Connection,
    workspace_id: &str,
    include_descendants: bool,
) -> Result<Vec<ChatSession>, String> {
    let (cte, ws_cond) = workspace_filter_sql(include_descendants);
    let sql = format!(
        "{cte}SELECT id, workspace_id, folder_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
                created_at, updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = chat_sessions.id) AS message_count
         FROM chat_sessions
         WHERE workspace_id {ws_cond} AND is_deleted = 1
         ORDER BY deleted_at DESC, updated_at DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![workspace_id], row_to_session)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn restore(conn: &Connection, workspace_id: &str, id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE chat_sessions
         SET is_deleted = 0, deleted_at = NULL, updated_at = ?1
         WHERE id = ?2 AND workspace_id = ?3",
        rusqlite::params![now, id, workspace_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn empty_recycle_bin(conn: &Connection, workspace_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM chat_sessions WHERE workspace_id = ?1 AND is_deleted = 1",
        rusqlite::params![workspace_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn move_sessions(
    conn: &Connection,
    session_ids: &[String],
    target_workspace_id: &str,
    target_folder_id: Option<&str>,
    chats_dir: &Path,
    passphrase: Option<&str>,
) -> Result<(), String> {
    if session_ids.is_empty() {
        return Ok(());
    }

    let previous_paths = chat_file_store::capture_session_file_variants(conn, chats_dir, session_ids);
    let target_folder_id = target_folder_id.unwrap_or_default();

    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;
    let result = (|| {
        let placeholders = session_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 3))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "UPDATE chat_sessions SET workspace_id = ?1, folder_id = ?2 WHERE id IN ({})",
            placeholders
        );
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> =
            Vec::with_capacity(2 + session_ids.len());
        params.push(Box::new(target_workspace_id.to_string()));
        params.push(Box::new(target_folder_id.to_string()));
        for session_id in session_ids {
            params.push(Box::new(session_id.clone()));
        }
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|param| param.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())
            .map_err(|e| e.to_string())?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            chat_file_store::sync_session_files_for_hierarchy_change(
                conn,
                chats_dir,
                session_ids,
                &previous_paths,
                passphrase,
            )?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

pub fn batch_move_sessions(
    conn: &Connection,
    session_ids: &[String],
    target_workspace_id: &str,
    preserve_folder_structure: bool,
    chats_dir: &Path,
    passphrase: Option<&str>,
) -> Result<BatchMoveSessionsOutcome, String> {
    if session_ids.is_empty() {
        return Ok(BatchMoveSessionsOutcome::default());
    }

    let previous_paths = chat_file_store::capture_session_file_variants(conn, chats_dir, session_ids);
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;

    let result = (|| -> Result<BatchMoveSessionsOutcome, String> {
        let mut outcome = BatchMoveSessionsOutcome::default();
        let placeholders = session_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT id, folder_id FROM chat_sessions WHERE id IN ({})",
            placeholders
        );
        let params: Vec<&dyn rusqlite::types::ToSql> = session_ids
            .iter()
            .map(|session_id| session_id as &dyn rusqlite::types::ToSql)
            .collect();

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let session_project_pairs = stmt
            .query_map(params.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1).unwrap_or_default(),
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        if preserve_folder_structure {
            let source_folder_ids: HashSet<String> = session_project_pairs
                .iter()
                .filter(|(_, folder_id)| !folder_id.is_empty())
                .map(|(_, folder_id)| folder_id.clone())
                .collect();

            let mut source_projects: HashMap<String, Folder> = HashMap::new();
            for folder_id in &source_folder_ids {
                let project = conn
                    .query_row(
                        "SELECT id, workspace_id, name, folder_description, custom_instructions, color, icon, created_at, updated_at
                         FROM folders WHERE id = ?1",
                        rusqlite::params![folder_id],
                        row_to_project,
                    )
                    .ok();
                if let Some(project) = project {
                    source_projects.insert(folder_id.clone(), project);
                }
            }

            let existing_folders: Vec<(String, String)> = conn
                .prepare("SELECT id, name FROM folders WHERE workspace_id = ?1")
                .map_err(|e| e.to_string())?
                .query_map(rusqlite::params![target_workspace_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;

            let existing_by_name: HashMap<String, String> = existing_folders
                .iter()
                .map(|(id, name)| (name.trim().to_lowercase(), id.clone()))
                .collect();

            for (source_folder_id, source_project) in &source_projects {
                let normalized_name = source_project.name.trim().to_lowercase();
                let target_folder_id =
                    if let Some(existing_id) = existing_by_name.get(&normalized_name) {
                        existing_id.clone()
                    } else {
                        let new_project =
                            Folder::new(target_workspace_id.to_string(), source_project.name.clone());
                        conn.execute(
                            "INSERT INTO folders (id, workspace_id, name, folder_description, custom_instructions, color, icon, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                            rusqlite::params![
                                new_project.id,
                                new_project.workspace_id,
                                new_project.name,
                                source_project.folder_description,
                                source_project.custom_instructions,
                                source_project.color,
                                source_project.icon,
                                new_project.created_at,
                                new_project.updated_at
                            ],
                        )
                        .map_err(|e| e.to_string())?;
                        outcome.folders_created.push(new_project.id.clone());
                        new_project.id
                    };
                outcome
                    .folder_mapping
                    .insert(source_folder_id.clone(), target_folder_id);
            }

            for (session_id, source_folder_id) in &session_project_pairs {
                let target_folder_id = if source_folder_id.is_empty() {
                    String::new()
                } else {
                    outcome
                        .folder_mapping
                        .get(source_folder_id)
                        .cloned()
                        .unwrap_or_default()
                };

                conn.execute(
                    "UPDATE chat_sessions SET workspace_id = ?1, folder_id = ?2 WHERE id = ?3",
                    rusqlite::params![target_workspace_id, target_folder_id, session_id],
                )
                .map_err(|e| e.to_string())?;
            }
        } else {
            let sql = format!(
                "UPDATE chat_sessions SET workspace_id = ?1, folder_id = ?2 WHERE id IN ({})",
                placeholders
            );
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> =
                Vec::with_capacity(2 + session_ids.len());
            params.push(Box::new(target_workspace_id.to_string()));
            params.push(Box::new(String::new()));
            for session_id in session_ids {
                params.push(Box::new(session_id.clone()));
            }
            let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|param| param.as_ref()).collect();
            conn.execute(&sql, param_refs.as_slice())
                .map_err(|e| e.to_string())?;
        }

        outcome.sessions_moved = session_project_pairs.len();
        chat_file_store::sync_session_files_for_hierarchy_change(
            conn,
            chats_dir,
            session_ids,
            &previous_paths,
            passphrase,
        )?;

        Ok(outcome)
    })();

    match result {
        Ok(outcome) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(outcome)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

pub fn add_message(conn: &Connection, req: AddMessageRequest) -> Result<Message, String> {
    let message = Message {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: req.session_id.clone(),
        role: req.role,
        content: req.content,
        model_name: req.model_name,
        tokens_used: req.tokens_used,
        duration_ms: req.duration_ms,
        variant_group_id: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let role_str = message.role.to_string();

    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, model_name, tokens_used, duration_ms, variant_group_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            message.id,
            message.session_id,
            role_str,
            message.content,
            message.model_name,
            message.tokens_used,
            message.duration_ms,
            message.variant_group_id,
            message.created_at
        ],
    )
    .map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();
    let _ = conn.execute(
        "UPDATE chat_sessions SET updated_at = ?1, is_imported = 0 WHERE id = ?2",
        rusqlite::params![now, req.session_id],
    );

    Ok(message)
}

pub fn get_messages(
    conn: &Connection,
    session_id: &str,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<Message>, String> {
    let limit = limit.unwrap_or(200).clamp(1, 2000);
    let offset = offset.unwrap_or(0).max(0);
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, model_name, tokens_used, duration_ms, variant_group_id, created_at
             FROM messages WHERE session_id = ?1 ORDER BY created_at ASC
             LIMIT ?2 OFFSET ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![session_id, limit, offset], row_to_message)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn update_session(
    conn: &Connection,
    id: &str,
    title: Option<String>,
    is_pinned: Option<bool>,
    system_prompt: Option<String>,
    model_name: Option<String>,
    exclude_from_analytics: Option<bool>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE chat_sessions SET
            title = COALESCE(?1, title),
            is_pinned = COALESCE(?2, is_pinned),
            system_prompt = COALESCE(?3, system_prompt),
            model_name = COALESCE(?4, model_name),
            exclude_from_analytics = COALESCE(?5, exclude_from_analytics),
            updated_at = ?6
         WHERE id = ?7",
        rusqlite::params![
            title,
            is_pinned.map(|value| value as i32),
            system_prompt,
            model_name,
            exclude_from_analytics.map(|v| v as i32),
            now,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_token_usage_by_date(
    conn: &Connection,
    workspace_id: &str,
    days: Option<i64>,
) -> Result<Vec<(String, i64)>, String> {
    let days = days.unwrap_or(30).max(1);
    let mut stmt = conn
        .prepare(
            "SELECT substr(m.created_at, 1, 10) AS day, COALESCE(SUM(m.tokens_used), 0) AS total_tokens
             FROM messages m
             JOIN chat_sessions s ON s.id = m.session_id
             WHERE s.workspace_id = ?1
               AND m.tokens_used IS NOT NULL
               AND datetime(m.created_at) >= datetime('now', '-' || ?2 || ' days')
             GROUP BY substr(m.created_at, 1, 10)
             ORDER BY day ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![workspace_id, days], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn touch_accessed(conn: &Connection, session_id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE chat_sessions SET last_accessed_at = ?1 WHERE id = ?2",
        rusqlite::params![now, session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_recent(
    conn: &Connection,
    workspace_id: &str,
    limit: Option<i64>,
    include_descendants: bool,
) -> Result<Vec<ChatSession>, String> {
    let limit = limit.unwrap_or(10).clamp(1, 100);
    let (cte, ws_cond) = workspace_filter_sql(include_descendants);
    let sql = format!(
        "{cte}SELECT id, workspace_id, folder_id, title, model_name, system_prompt, is_pinned,
                is_incognito, exclude_from_analytics, is_deleted, deleted_at,
                last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id,
                created_at, updated_at,
                (SELECT COUNT(*) FROM messages WHERE session_id = chat_sessions.id) AS message_count
         FROM chat_sessions
         WHERE workspace_id {ws_cond} AND is_deleted = 0
         ORDER BY last_accessed_at DESC
         LIMIT ?2"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![workspace_id, limit], row_to_session)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn refresh_message(
    conn: &Connection,
    session_id: &str,
    message_id: &str,
    model_id: &str,
) -> Result<Message, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, model_name, tokens_used, duration_ms, variant_group_id, created_at
             FROM messages WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let original_message = stmt
        .query_row(rusqlite::params![message_id], row_to_message)
        .map_err(|e| e.to_string())?;

    if original_message.role != MessageRole::Assistant {
        return Err("Only assistant messages can be refreshed".to_string());
    }

    let variant_group_id = if let Some(existing_group) = original_message.variant_group_id {
        existing_group
    } else {
        let new_group_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "UPDATE messages SET variant_group_id = ?1 WHERE id = ?2",
            rusqlite::params![new_group_id, original_message.id],
        )
        .map_err(|e| e.to_string())?;
        new_group_id
    };

    let new_message = Message {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
        role: MessageRole::Assistant,
        content: String::new(),
        model_name: Some(model_id.to_string()),
        tokens_used: None,
        duration_ms: None,
        variant_group_id: Some(variant_group_id),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, model_name, tokens_used, duration_ms, variant_group_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            new_message.id,
            new_message.session_id,
            new_message.role.to_string(),
            new_message.content,
            new_message.model_name,
            new_message.tokens_used,
            new_message.duration_ms,
            new_message.variant_group_id,
            new_message.created_at
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(new_message)
}

pub fn get_message_variants(conn: &Connection, message_id: &str) -> Result<Vec<Message>, String> {
    let mut stmt = conn
        .prepare("SELECT variant_group_id FROM messages WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let variant_group_id: Option<String> = stmt
        .query_row(rusqlite::params![message_id], |row| row.get(0))
        .ok();

    if let Some(group_id) = variant_group_id {
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, role, content, model_name, tokens_used, duration_ms, variant_group_id, created_at
                 FROM messages WHERE variant_group_id = ?1
                 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![group_id], row_to_message)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, role, content, model_name, tokens_used, duration_ms, variant_group_id, created_at
                 FROM messages WHERE id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let message = stmt
            .query_row(rusqlite::params![message_id], row_to_message)
            .map_err(|e| e.to_string())?;
        Ok(vec![message])
    }
}


/// Returns a map of child workspace ID → session count for all direct and
/// indirect descendants of `parent_workspace_id`. The parent itself is excluded.
pub fn count_sessions_per_child_workspace(
    conn: &Connection,
    parent_workspace_id: &str,
) -> Result<std::collections::HashMap<String, i64>, String> {
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE ws_tree(id) AS (
                SELECT id FROM workspaces WHERE parent_workspace_id = ?1
                UNION ALL
                SELECT w.id FROM workspaces w JOIN ws_tree t ON w.parent_workspace_id = t.id
            )
            SELECT cs.workspace_id, COUNT(*) AS cnt
            FROM chat_sessions cs
            WHERE cs.workspace_id IN (SELECT id FROM ws_tree)
              AND cs.is_deleted = 0
            GROUP BY cs.workspace_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![parent_workspace_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<std::collections::HashMap<_, _>, _>>()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;
    use crate::services::workspace_service;
    use crate::models::workspace::CreateWorkspaceRequest;

    fn setup_workspace(conn: &Connection) -> String {
        let ws = workspace_service::create(conn, CreateWorkspaceRequest {
            name: "Test Workspace".to_string(),
            description: None,
        }).unwrap();
        ws.id
    }

    #[test]
    fn test_create_and_get_session() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        let ws_id = setup_workspace(&conn);
        
        let req = CreateChatSessionRequest {
            workspace_id: ws_id.clone(),
            folder_id: "".to_string(),
            title: Some("Test Chat".to_string()),
            model_name: Some("gpt-4".to_string()),
            system_prompt: None,
            is_incognito: None,
            exclude_from_analytics: None,
            parent_session_id: None,
            branch_message_id: None,
        };
        
        let created = create_session(&conn, req).unwrap();
        assert_eq!(created.title, "Test Chat");
        
        let fetched = get_session(&conn, &created.id).unwrap().unwrap();
        assert_eq!(fetched.id, created.id);
        assert_eq!(fetched.workspace_id, ws_id);
    }

    #[test]
    fn test_list_and_search_sessions() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        let ws_id = setup_workspace(&conn);
        
        create_session(&conn, CreateChatSessionRequest {
            workspace_id: ws_id.clone(),
            folder_id: "".to_string(),
            title: Some("Apple".to_string()),
            model_name: None,
            system_prompt: None,
            is_incognito: None,
            exclude_from_analytics: None,
            parent_session_id: None,
            branch_message_id: None,
        }).unwrap();
        
        create_session(&conn, CreateChatSessionRequest {
            workspace_id: ws_id.clone(),
            folder_id: "".to_string(),
            title: Some("Banana".to_string()),
            model_name: None,
            system_prompt: None,
            is_incognito: None,
            exclude_from_analytics: None,
            parent_session_id: None,
            branch_message_id: None,
        }).unwrap();
        
        let all = list_sessions(&conn, &ws_id, "", None, None, false).unwrap();
        assert_eq!(all.len(), 2);
        
        let search = search_sessions(&conn, &ws_id, None, "App", false).unwrap();
        assert_eq!(search.len(), 1);
        assert_eq!(search[0].title, "Apple");
    }

    #[test]
    fn test_soft_delete_and_restore() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        let ws_id = setup_workspace(&conn);
        
        let s = create_session(&conn, CreateChatSessionRequest {
            workspace_id: ws_id.clone(),
            folder_id: "".to_string(),
            title: Some("To be deleted".to_string()),
            model_name: None,
            system_prompt: None,
            is_incognito: None,
            exclude_from_analytics: None,
            parent_session_id: None,
            branch_message_id: None,
        }).unwrap();
        
        soft_delete(&conn, &s.id).unwrap();
        assert_eq!(list_sessions(&conn, &ws_id, "", None, None, false).unwrap().len(), 0);
        assert_eq!(list_deleted(&conn, &ws_id, false).unwrap().len(), 1);
        
        restore(&conn, &ws_id, &s.id).unwrap();
        assert_eq!(list_sessions(&conn, &ws_id, "", None, None, false).unwrap().len(), 1);
    }

    #[test]
    fn test_add_and_get_messages() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        let ws_id = setup_workspace(&conn);
        
        let s = create_session(&conn, CreateChatSessionRequest {
            workspace_id: ws_id.clone(),
            folder_id: "".to_string(),
            title: None,
            model_name: None,
            system_prompt: None,
            is_incognito: None,
            exclude_from_analytics: None,
            parent_session_id: None,
            branch_message_id: None,
        }).unwrap();
        
        add_message(&conn, AddMessageRequest {
            workspace_id: ws_id.clone(),
            session_id: s.id.clone(),
            role: MessageRole::User,
            content: "Hello".to_string(),
            model_name: None,
            tokens_used: None,
            duration_ms: None,
        }).unwrap();
        
        add_message(&conn, AddMessageRequest {
            workspace_id: ws_id.clone(),
            session_id: s.id.clone(),
            role: MessageRole::Assistant,
            content: "Hi there!".to_string(),
            model_name: Some("gpt-4".to_string()),
            tokens_used: Some(10),
            duration_ms: Some(500),
        }).unwrap();
        
        let messages = get_messages(&conn, &s.id, None, None).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, MessageRole::User);
        assert_eq!(messages[1].role, MessageRole::Assistant);
        assert_eq!(messages[1].content, "Hi there!");
        assert_eq!(messages[1].tokens_used, Some(10));
    }

    #[test]
    fn test_list_sessions_with_include_descendants_true() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        // Parent workspace with a child
        let parent_id = setup_workspace(&conn);
        let child = workspace_service::create_child(&conn, crate::models::workspace::CreateChildWorkspaceRequest {
            parent_id: parent_id.clone(),
            name: "Child WS".to_string(),
            description: None,
        }).unwrap();
        // Create a session in the child workspace
        create_session(&conn, CreateChatSessionRequest {
            workspace_id: child.id.clone(),
            folder_id: "".to_string(),
            title: Some("Child Session".to_string()),
            model_name: None,
            system_prompt: None,
            is_incognito: None,
            exclude_from_analytics: None,
            parent_session_id: None,
            branch_message_id: None,
        }).unwrap();
        // Without bubbling: parent sees 0 sessions
        let exact = list_sessions(&conn, &parent_id, "", None, None, false).unwrap();
        assert_eq!(exact.len(), 0, "parent should not see child sessions without bubbling");
        // With bubbling: parent sees the child's session
        let bubbled = list_sessions(&conn, &parent_id, "", None, None, true).unwrap();
        assert_eq!(bubbled.len(), 1, "parent should see child sessions with bubbling");
        assert_eq!(bubbled[0].title, "Child Session");
    }

    #[test]
    fn test_list_sessions_does_not_bubble_down() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();
        let parent_id = setup_workspace(&conn);
        let child = workspace_service::create_child(&conn, crate::models::workspace::CreateChildWorkspaceRequest {
            parent_id: parent_id.clone(),
            name: "Child WS".to_string(),
            description: None,
        }).unwrap();
        // Create a session in the parent workspace
        create_session(&conn, CreateChatSessionRequest {
            workspace_id: parent_id.clone(),
            folder_id: "".to_string(),
            title: Some("Parent Session".to_string()),
            model_name: None,
            system_prompt: None,
            is_incognito: None,
            exclude_from_analytics: None,
            parent_session_id: None,
            branch_message_id: None,
        }).unwrap();
        // Child with bubbling should only see its own sessions (none), not the parent's
        let child_view = list_sessions(&conn, &child.id, "", None, None, true).unwrap();
        assert_eq!(child_view.len(), 0, "child should never see parent sessions even with bubbling");
    }
}
