//! Tauri commands for file-based chat storage and optional encryption.

use crate::db::DbState;
use crate::models::chat::ChatSession;
use crate::services::chat_file_store;
use std::process::Command;
#[cfg(target_os = "linux")]
use std::path::Path;
use tauri::State;

/// In-memory passphrase state — populated at startup from keyring if
/// encryption is enabled, or when the user calls `setup_chat_encryption`.
pub struct ChatCryptoState(pub std::sync::Mutex<Option<String>>);

/// Immutable path to the chats directory (app_data/chats/).
pub struct ChatsDirState(pub std::path::PathBuf);

// ── Keyring helpers ─────────────────────────────────────────────────────────

const KEYRING_SERVICE: &str = "aetherium";
const KEYRING_USER: &str = "chat_encryption";

fn keyring_store(passphrase: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| e.to_string())?
        .set_password(passphrase)
        .map_err(|e| e.to_string())
}

fn keyring_load() -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .ok()?
        .get_password()
        .ok()
}

fn keyring_delete() {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.delete_credential();
    }
}

#[cfg(target_os = "linux")]
fn try_linux_file_selection(reveal_path: &Path) -> Result<(), String> {
    let file_uri = format!("file://{}", reveal_path.to_string_lossy());

    let gdbus_status = Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--dest",
            "org.freedesktop.FileManager1",
            "--object-path",
            "/org/freedesktop/FileManager1",
            "--method",
            "org.freedesktop.FileManager1.ShowItems",
            &format!("[\"{file_uri}\"]"),
            "\"\"",
        ])
        .status();

    if matches!(gdbus_status, Ok(status) if status.success()) {
        return Ok(());
    }

    let dolphin_status = Command::new("dolphin")
        .arg("--select")
        .arg(reveal_path)
        .status();

    if matches!(dolphin_status, Ok(status) if status.success()) {
        return Ok(());
    }

    let parent = reveal_path
        .parent()
        .ok_or_else(|| "Chat folder not found".to_string())?;

    Command::new("xdg-open")
        .arg(parent)
        .status()
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Return information about the chat file store.
#[tauri::command]
pub fn get_chat_file_info(
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
) -> Result<serde_json::Value, String> {
    let encrypted = crypto.0.lock().map_err(|e| e.to_string())?.is_some();
    let chats_dir = chats_dir_state.0.to_string_lossy().to_string();
    Ok(serde_json::json!({
        "chats_dir": chats_dir,
        "encryption_enabled": encrypted,
    }))
}

#[tauri::command]
pub fn reveal_chat_file(
    session_id: String,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<(), String> {
    let conn = db_state.0.get().map_err(|e| e.to_string())?;
    let encrypted = crypto.0.lock().map_err(|e| e.to_string())?.is_some();
    // Try the workspace/project subdirectory path first
    let path = chat_file_store::session_file_path_for_session(&conn, &chats_dir_state.0, &session_id, encrypted);
    let fallback_path = chat_file_store::session_file_path_for_session(&conn, &chats_dir_state.0, &session_id, !encrypted);
    // Legacy flat-directory paths as final fallback
    let legacy_path = chat_file_store::session_file_path(&chats_dir_state.0, &session_id, encrypted);
    let legacy_fallback = chat_file_store::session_file_path(&chats_dir_state.0, &session_id, !encrypted);
    let reveal_path = if path.exists() {
        path
    } else if fallback_path.exists() {
        fallback_path
    } else if legacy_path.exists() {
        legacy_path
    } else {
        legacy_fallback
    };

    if !reveal_path.exists() {
        return Err("Chat file not found on disk".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&reveal_path)
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg("/select,")
            .arg(&reveal_path)
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        try_linux_file_selection(&reveal_path)?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Show in explorer is not supported on this platform".to_string())
}

/// Enable (or rotate) encryption for all chat JSON files.
/// Stores the passphrase in the system keychain.
#[tauri::command]
pub fn setup_chat_encryption(
    passphrase: String,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<usize, String> {
    if passphrase.is_empty() {
        return Err("Passphrase must not be empty".to_string());
    }
    // Get old passphrase to re-encrypt existing files
    let old_pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();

    // Re-encrypt / encrypt all existing files
    let count = chat_file_store::reencrypt_all_files(
        &chats_dir_state.0,
        old_pass.as_deref(),
        Some(&passphrase),
    )?;

    // Persist new passphrase
    keyring_store(&passphrase)?;

    // Update in-memory state
    *crypto.0.lock().map_err(|e| e.to_string())? = Some(passphrase.clone());

    // Persist flag in settings DB
    let conn = db_state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('chat_encryption_enabled', 'true')",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Sync any sessions that don't yet have a file
    sync_all_to_files_internal(&conn, &chats_dir_state.0, Some(&passphrase))?;

    Ok(count)
}

/// Disable encryption — decrypt all files and clear the keychain entry.
#[tauri::command]
pub fn disable_chat_encryption(
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<usize, String> {
    let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
    let count = chat_file_store::reencrypt_all_files(&chats_dir_state.0, pass.as_deref(), None)?;

    keyring_delete();
    *crypto.0.lock().map_err(|e| e.to_string())? = None;

    let conn = db_state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('chat_encryption_enabled', 'false')",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(count)
}

/// Export a single chat session to a specific file path (always plaintext).
#[tauri::command]
pub fn export_chat_as_json(
    session_id: String,
    dest_path: String,
    db_state: State<DbState>,
) -> Result<(), String> {
    let conn = db_state.0.get().map_err(|e| e.to_string())?;
    let dest = std::path::Path::new(&dest_path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    chat_file_store::write_session_file(&conn, dest.parent().unwrap_or(dest), &session_id, None)?;
    // The above writes to parent/<session_id>.json — rename to dest_path
    let auto_path = dest
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join(format!("{}.json", session_id));
    if auto_path != dest {
        std::fs::rename(&auto_path, dest).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Import a chat JSON (plain or encrypted) into the database.
/// Returns the imported chat session.
#[tauri::command]
pub fn import_chat_from_json(
    path: String,
    workspace_id: String,
    project_id: Option<String>,
    passphrase: Option<String>,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<ChatSession, String> {
    let conn = db_state.0.get().map_err(|e| e.to_string())?;
    let session_id = chat_file_store::import_session_from_file(
        &conn,
        std::path::Path::new(&path),
        &workspace_id,
        project_id.as_deref().unwrap_or(""),
        passphrase.as_deref(),
    )?;

    let pass = crypto.0.lock().ok().and_then(|g| g.clone());
    let _ = chat_file_store::write_session_file(
        &conn,
        &chats_dir_state.0,
        &session_id,
        pass.as_deref(),
    );

    conn.query_row(
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at, last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id, created_at, updated_at
         FROM chat_sessions WHERE id = ?1",
        rusqlite::params![session_id],
        |row| {
            Ok(ChatSession {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                project_id: row.get(2)?,
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
            })
        },
    )
    .map_err(|e| e.to_string())
}

/// Import all LM Studio `.conversation.json` files from a folder (recursively).
/// Root folder name → workspace, subfolders → projects, conversations → sessions.
/// Returns the workspace ID and count of imported sessions.
#[tauri::command]
pub fn import_lmstudio_folder(
    folder_path: String,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<serde_json::Value, String> {
    let conn = db_state.0.get().map_err(|e| e.to_string())?;
    let folder = std::path::Path::new(&folder_path);
    if !folder.is_dir() {
        return Err(format!("{} is not a directory", folder_path));
    }

    // Root folder name becomes the workspace name.
    let workspace_name = folder
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Imported Chats")
        .to_string();

    // Discover all conversation files with their subfolder names
    let conversations = chat_file_store::discover_lmstudio_conversations(folder)?;
    if conversations.is_empty() {
        return Err("No .conversation.json files found in the selected folder.".to_string());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let normalized_workspace_name = workspace_name.trim();
    let existing_workspace_id = conn
        .query_row(
            "SELECT id FROM workspaces WHERE lower(trim(name)) = lower(trim(?1)) LIMIT 1",
            rusqlite::params![normalized_workspace_name],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let mut workspace_id: Option<String> = existing_workspace_id;
    let mut created_workspace = false;

    // Build project map lazily: subfolder name -> project ID.
    let mut project_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    let mut session_ids = Vec::new();
    let mut errors = Vec::new();

    for conv in &conversations {
        match std::fs::read(&conv.path) {
            Ok(bytes) => match chat_file_store::parse_lmstudio_conversation(&bytes) {
                Ok(data) => {
                    let workspace_id = if let Some(id) = &workspace_id {
                        id.clone()
                    } else {
                        let new_workspace_id = uuid::Uuid::new_v4().to_string();
                        conn.execute(
                            "INSERT INTO workspaces (id, name, description, prompt_instructions, topic_signature, created_at, updated_at)
                             VALUES (?1, ?2, '', '', '{}', ?3, ?3)",
                            rusqlite::params![new_workspace_id, workspace_name, now],
                        ).map_err(|e| e.to_string())?;
                        created_workspace = true;
                        workspace_id = Some(new_workspace_id.clone());
                        new_workspace_id
                    };

                    let project_id = if conv.subfolder.is_empty() {
                        String::new()
                    } else if let Some(existing_project_id) = project_map.get(&conv.subfolder) {
                        existing_project_id.clone()
                    } else {
                        let normalized_project_name = conv.subfolder.trim();
                        let project_id = if let Ok(existing_project_id) = conn.query_row(
                            "SELECT id FROM projects WHERE workspace_id = ?1 AND lower(trim(name)) = lower(trim(?2)) LIMIT 1",
                            rusqlite::params![workspace_id, normalized_project_name],
                            |row| row.get::<_, String>(0),
                        ) {
                            existing_project_id
                        } else {
                            let id = uuid::Uuid::new_v4().to_string();
                            conn.execute(
                                "INSERT INTO projects (id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at)
                                 VALUES (?1, ?2, ?3, '', '', '#007AFF', 'folder', ?4, ?4)",
                                rusqlite::params![id, workspace_id, conv.subfolder, now],
                            ).map_err(|e| e.to_string())?;
                            id
                        };
                        project_map.insert(conv.subfolder.clone(), project_id.clone());
                        project_id
                    };

                    match chat_file_store::import_chat_data(
                        &conn,
                        &data,
                        &workspace_id,
                        &project_id,
                    ) {
                        Ok(sid) => session_ids.push(sid),
                        Err(e) => errors.push(format!("{}: {e}", conv.path.display())),
                    }
                }
                Err(e) => errors.push(format!("{}: {e}", conv.path.display())),
            },
            Err(e) => errors.push(format!("{}: {e}", conv.path.display())),
        }
    }

    // Sync imported sessions to chat files (best-effort)
    let pass = crypto.0.lock().ok().and_then(|g| g.clone());
    for id in &session_ids {
        let _ = chat_file_store::write_session_file(&conn, &chats_dir_state.0, id, pass.as_deref());
    }

    if session_ids.is_empty() {
        if created_workspace {
            if let Some(workspace_id) = workspace_id.as_ref() {
                let _ = conn.execute(
                    "DELETE FROM workspaces WHERE id = ?1",
                    rusqlite::params![workspace_id],
                );
            }
        }

        let mut message =
            "LM Studio import found conversation files, but none contained importable messages."
                .to_string();
        if !errors.is_empty() {
            let sample = errors
                .iter()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            message.push_str("\n\nExamples:\n");
            message.push_str(&sample);
            if errors.len() > 3 {
                message.push_str(&format!("\n… and {} more.", errors.len() - 3));
            }
        }
        return Err(message);
    }

    Ok(serde_json::json!({
        "imported": session_ids.len(),
        "workspace_id": workspace_id.unwrap_or_default(),
        "workspace_name": workspace_name,
        "projects_created": project_map.len(),
        "errors": errors.len(),
        "error_messages": errors.iter().take(10).cloned().collect::<Vec<_>>(),
    }))
}

/// Import a Gemini Takeout folder into a new or existing "Gemini Apps" workspace.
/// Searches for `My Activity.html` within the folder.
#[tauri::command]
pub fn import_gemini_takeout(
    folder_path: String,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<serde_json::Value, String> {
    let conn = db_state.0.get().map_err(|e| e.to_string())?;
    let folder = std::path::Path::new(&folder_path);
    if !folder.is_dir() {
        return Err(format!("{} is not a directory", folder_path));
    }

    // Try to find My Activity.html
    let mut html_path = folder.join("My Activity.html");
    if !html_path.exists() {
        // Search one level deeper (Common in Takeout extracts)
        if let Ok(entries) = std::fs::read_dir(folder) {
            for entry in entries.flatten() {
                let p = entry.path().join("Gemini Apps").join("My Activity.html");
                if p.exists() {
                    html_path = p;
                    break;
                }
                let p2 = entry.path().join("My Activity.html");
                if p2.exists() {
                    html_path = p2;
                    break;
                }
            }
        }
    }

    if !html_path.exists() {
        return Err("Could not find 'My Activity.html' in the selected folder.".to_string());
    }

    let html_bytes = std::fs::read(&html_path).map_err(|e| format!("Failed to read file: {}", e))?;
    let html = String::from_utf8_lossy(&html_bytes).to_string();

    let sessions = chat_file_store::parse_gemini_takeout(&html)?;
    if sessions.is_empty() {
        return Err("No Gemini conversations found in the selected HTML file.".to_string());
    }

    let workspace_name = "Gemini Apps".to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let existing_workspace_id = conn
        .query_row(
            "SELECT id FROM workspaces WHERE lower(trim(name)) = lower(trim(?1)) LIMIT 1",
            rusqlite::params!["gemini apps"],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let workspace_id = if let Some(id) = existing_workspace_id {
        id
    } else {
        let new_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO workspaces (id, name, description, prompt_instructions, topic_signature, created_at, updated_at)
             VALUES (?1, ?2, '', '', '{}', ?3, ?3)",
            rusqlite::params![new_id, workspace_name, now],
        ).map_err(|e| e.to_string())?;
        new_id
    };

    let mut session_ids = Vec::new();
    let mut messages_count = 0;

    for data in sessions {
        // Check if session ID already exists to avoid duplicates if re-importing
        let exists: bool = conn.query_row(
            "SELECT 1 FROM chat_sessions WHERE id = ?1",
            rusqlite::params![data.id],
            |_| Ok(true)
        ).unwrap_or(false);

        if exists { continue; }

        conn.execute(
            "INSERT INTO chat_sessions (
                id, workspace_id, project_id, title, model_name, system_prompt,
                is_pinned, is_incognito, exclude_from_analytics, is_deleted,
                is_imported, created_at, updated_at
            ) VALUES (?1, ?2, '', ?3, ?4, ?5, 0, 0, 0, 0, 1, ?6, ?6)",
            rusqlite::params![
                data.id,
                workspace_id,
                data.title,
                data.model,
                data.system_prompt,
                data.created_at
            ],
        )
        .map_err(|e| e.to_string())?;

        for fmsg in &data.messages {
            conn.execute(
                "INSERT INTO chat_messages (
                    id, session_id, role, content, model_name,
                    tokens_used, is_deleted, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)",
                rusqlite::params![
                    fmsg.id,
                    data.id,
                    fmsg.role,
                    fmsg.content,
                    fmsg.model,
                    fmsg.tokens_used,
                    fmsg.timestamp,
                ],
            )
            .map_err(|e| e.to_string())?;
            messages_count += 1;
        }
        session_ids.push(data.id.clone());
    }

    // Write to disk for file-based consistency
    let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
    for id in &session_ids {
        let _ = chat_file_store::write_session_file(&conn, &chats_dir_state.0, id, pass.as_deref());
    }

    Ok(serde_json::json!({
        "imported_sessions": session_ids.len(),
        "imported_messages": messages_count,
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
    }))
}

/// Import a Claude Desktop export folder containing conversations.json and
/// optionally projects.json. Since the Claude export does not link conversations
/// to projects, all conversations go into a single workspace. Projects from
/// projects.json are created as empty project containers within that workspace.
#[tauri::command]
pub fn import_claude_desktop(
    folder_path: String,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<serde_json::Value, String> {
    let conn = db_state.0.get().map_err(|e| e.to_string())?;
    let folder = std::path::Path::new(&folder_path);
    if !folder.is_dir() {
        return Err(format!("{} is not a directory", folder_path));
    }

    // Find conversations.json
    let conv_path = folder.join("conversations.json");
    if !conv_path.exists() {
        return Err(
            "Could not find 'conversations.json' in the selected folder.".to_string(),
        );
    }

    let conv_bytes =
        std::fs::read(&conv_path).map_err(|e| format!("Failed to read conversations.json: {e}"))?;
    let chat_data_list = chat_file_store::parse_claude_conversations(&conv_bytes)?;
    if chat_data_list.is_empty() {
        return Err("No conversations with messages found in the Claude Desktop export.".to_string());
    }

    let workspace_name = "Claude Desktop".to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Get or create workspace
    let existing_workspace_id = conn
        .query_row(
            "SELECT id FROM workspaces WHERE lower(trim(name)) = lower(trim(?1)) LIMIT 1",
            rusqlite::params!["claude desktop"],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let workspace_id = if let Some(id) = existing_workspace_id {
        id
    } else {
        let new_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO workspaces (id, name, description, prompt_instructions, topic_signature, created_at, updated_at)
             VALUES (?1, ?2, '', '', '{}', ?3, ?3)",
            rusqlite::params![new_id, workspace_name, now],
        )
        .map_err(|e| e.to_string())?;
        new_id
    };

    // Import projects from projects.json if present
    let mut projects_created = 0usize;
    let projects_path = folder.join("projects.json");
    let mut project_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    if projects_path.exists() {
        if let Ok(proj_bytes) = std::fs::read(&projects_path) {
            if let Ok(projects) = chat_file_store::parse_claude_projects(&proj_bytes) {
                for (proj_uuid, proj_name, proj_description, proj_prompt) in &projects {
                    let normalized = proj_name.trim();
                    let existing_project_id = conn
                        .query_row(
                            "SELECT id FROM projects WHERE workspace_id = ?1 AND lower(trim(name)) = lower(trim(?2)) LIMIT 1",
                            rusqlite::params![workspace_id, normalized],
                            |row| row.get::<_, String>(0),
                        )
                        .ok();

                    let project_id = if let Some(id) = existing_project_id {
                        id
                    } else {
                        let id = uuid::Uuid::new_v4().to_string();
                        conn.execute(
                            "INSERT INTO projects (id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, '#007AFF', 'folder', ?6, ?6)",
                            rusqlite::params![id, workspace_id, proj_name, proj_description, proj_prompt, now],
                        )
                        .map_err(|e| e.to_string())?;
                        projects_created += 1;
                        id
                    };
                    project_map.insert(proj_uuid.clone(), project_id);
                }
            }
        }
    }

    // Import conversations (no project link — Claude export doesn't have one)
    let mut session_ids = Vec::new();
    let mut errors = Vec::new();

    for data in &chat_data_list {
        // Check for duplicate by Claude UUID
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM chat_sessions WHERE id = ?1",
                rusqlite::params![data.id],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if exists {
            continue;
        }

        match chat_file_store::import_chat_data(&conn, data, &workspace_id, "") {
            Ok(sid) => session_ids.push(sid),
            Err(e) => errors.push(format!("{}: {e}", data.title)),
        }
    }

    // Sync to disk
    let pass = crypto.0.lock().ok().and_then(|g| g.clone());
    for id in &session_ids {
        let _ =
            chat_file_store::write_session_file(&conn, &chats_dir_state.0, id, pass.as_deref());
    }

    if session_ids.is_empty() {
        return Err(
            "Claude Desktop import found conversations, but none contained importable messages."
                .to_string(),
        );
    }

    Ok(serde_json::json!({
        "imported": session_ids.len(),
        "skipped": chat_data_list.len() - session_ids.len() - errors.len(),
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "projects_created": projects_created,
        "errors": errors.len(),
        "error_messages": errors.iter().take(10).cloned().collect::<Vec<_>>(),
    }))
}


/// Sync every session in the DB to the chats directory.
/// Useful after a cold start to ensure files are up to date.
#[tauri::command]
pub fn sync_all_chats_to_files(
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<usize, String> {
    let conn = db_state.0.get().map_err(|e| e.to_string())?;
    let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
    sync_all_to_files_internal(&conn, &chats_dir_state.0, pass.as_deref())
}

// ── Internal helpers ─────────────────────────────────────────────────────────

fn sync_all_to_files_internal(
    conn: &rusqlite::Connection,
    chats_dir: &std::path::Path,
    passphrase: Option<&str>,
) -> Result<usize, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM chat_sessions")
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let mut count = 0usize;
    for id in &ids {
        if chat_file_store::write_session_file(conn, chats_dir, id, passphrase).is_ok() {
            count += 1;
        }
    }
    Ok(count)
}

/// Called by lib.rs during app setup.
pub fn load_crypto_state_from_keyring(conn: &rusqlite::Connection) -> Option<String> {
    // Check if encryption is marked as enabled in settings
    let enabled: bool = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'chat_encryption_enabled'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .map(|v| v == "true")
        .unwrap_or(false);

    if enabled {
        keyring_load()
    } else {
        None
    }
}
