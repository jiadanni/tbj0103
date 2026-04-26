use crate::models::workspace::{
    CreateChildWorkspaceRequest, CreateWorkspaceRequest, UpdateWorkspaceRequest, Workspace,
};
use crate::services::chat_file_store;
use rusqlite::Connection;
use std::path::Path;

fn row_to_workspace(row: &rusqlite::Row<'_>) -> rusqlite::Result<Workspace> {
    let sig_json: String = row.get(4)?;
    let topic_signature = serde_json::from_str(&sig_json).unwrap_or_default();
    let is_hidden: i64 = row.get(6)?;

    Ok(Workspace {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        prompt_instructions: row.get(3)?,
        topic_signature,
        signature_updated_at: row.get(5)?,
        is_hidden: is_hidden != 0,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        parent_workspace_id: row.get(9)?,
        icon: row.get(10)?,
        order_index: row.get(11)?,
        last_message_at: row.get(12)?,
    })
}

fn insert_workspace(conn: &Connection, workspace: &Workspace) -> Result<(), String> {
    let sig_json = serde_json::to_string(&workspace.topic_signature).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO workspaces (id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, parent_workspace_id, icon, order_index, last_message_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            workspace.id,
            workspace.name,
            workspace.description,
            workspace.prompt_instructions,
            sig_json,
            workspace.signature_updated_at,
            workspace.is_hidden as i64,
            workspace.created_at,
            workspace.updated_at,
            workspace.parent_workspace_id,
            workspace.icon,
            workspace.order_index,
            workspace.last_message_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn create(conn: &Connection, req: CreateWorkspaceRequest) -> Result<Workspace, String> {
    let workspace = Workspace::new(req.name, req.description.unwrap_or_default());
    insert_workspace(conn, &workspace)?;
    Ok(workspace)
}

pub fn create_child(
    conn: &Connection,
    req: CreateChildWorkspaceRequest,
) -> Result<Workspace, String> {
    let mut workspace = Workspace::new(req.name, req.description.unwrap_or_default());
    workspace.parent_workspace_id = Some(req.parent_id);
    insert_workspace(conn, &workspace)?;
    Ok(workspace)
}

pub fn list_all(conn: &Connection) -> Result<Vec<Workspace>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, parent_workspace_id, icon, order_index, last_message_at
             FROM workspaces
             WHERE is_hidden = 0
             ORDER BY order_index ASC, name COLLATE NOCASE ASC, created_at ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_workspace).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn list_root(conn: &Connection) -> Result<Vec<Workspace>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, parent_workspace_id, icon, order_index, last_message_at
             FROM workspaces
             WHERE is_hidden = 0 AND parent_workspace_id IS NULL
             ORDER BY order_index ASC, name COLLATE NOCASE ASC, created_at ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_workspace).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn list_children(conn: &Connection, parent_id: &str) -> Result<Vec<Workspace>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, parent_workspace_id, icon, order_index, last_message_at
             FROM workspaces
             WHERE is_hidden = 0 AND parent_workspace_id = ?1
             ORDER BY order_index ASC, name COLLATE NOCASE ASC, created_at ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![parent_id], row_to_workspace)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn list_hidden(conn: &Connection) -> Result<Vec<Workspace>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, parent_workspace_id, icon, order_index, last_message_at
             FROM workspaces
             WHERE is_hidden = 1
             ORDER BY order_index ASC, name COLLATE NOCASE ASC, created_at ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_workspace).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Workspace>, String> {
    let result = conn.query_row(
        "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, parent_workspace_id, icon, order_index, last_message_at FROM workspaces WHERE id = ?1",
        rusqlite::params![id],
        row_to_workspace,
    );
    match result {
        Ok(workspace) => Ok(Some(workspace)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn hide(conn: &Connection, id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE workspaces SET is_hidden = 1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn unhide(conn: &Connection, id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE workspaces SET is_hidden = 0, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update(
    conn: &Connection,
    req: UpdateWorkspaceRequest,
    chats_dir: &Path,
    passphrase: Option<&str>,
) -> Result<(), String> {
    let session_ids = if req.name.trim().is_empty() {
        Vec::new()
    } else {
        let mut stmt = conn
            .prepare("SELECT id FROM chat_sessions WHERE workspace_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![req.id.clone()], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    let previous_paths =
        chat_file_store::capture_session_file_variants(conn, chats_dir, &session_ids);
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE workspaces SET name = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![req.name, now, req.id],
    )
    .map_err(|e| e.to_string())?;

    if let Some(description) = &req.description {
        conn.execute(
            "UPDATE workspaces SET description = ?1 WHERE id = ?2",
            rusqlite::params![description, req.id],
        )
        .map_err(|e| e.to_string())?;
    }

    if let Some(instructions) = &req.prompt_instructions {
        conn.execute(
            "UPDATE workspaces SET prompt_instructions = ?1 WHERE id = ?2",
            rusqlite::params![instructions, req.id],
        )
        .map_err(|e| e.to_string())?;
    }

    if !session_ids.is_empty() {
        chat_file_store::sync_session_files_for_hierarchy_change(
            conn,
            chats_dir,
            &session_ids,
            &previous_paths,
            passphrase,
        )?;
    }

    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM workspaces WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_parent(conn: &Connection, id: &str, parent_id: Option<String>) -> Result<(), String> {
    if let Some(pid) = parent_id {
        if pid == id {
            return Err("A workspace cannot be its own parent.".to_string());
        }

        let parent_of_parent: Option<String> = conn
            .query_row(
                "SELECT parent_workspace_id FROM workspaces WHERE id = ?1",
                rusqlite::params![pid],
                |row| row.get(0),
            )
            .unwrap_or(None);
        if parent_of_parent.as_deref() == Some(id) {
            return Err("Cannot create a circular parent-child relationship.".to_string());
        }

        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE workspaces SET parent_workspace_id = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![pid, now, id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE workspaces SET parent_workspace_id = NULL, updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn update_icon(conn: &Connection, id: &str, icon: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE workspaces SET icon = ?, updated_at = datetime('now') WHERE id = ?",
        rusqlite::params![icon, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn reorder(conn: &Connection, ids: Vec<String>) -> Result<(), String> {
    for (index, id) in ids.into_iter().enumerate() {
        conn.execute(
            "UPDATE workspaces SET order_index = ?1 WHERE id = ?2",
            rusqlite::params![index as i32, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
