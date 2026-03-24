//! Tauri commands for file-based chat storage and optional encryption.

use tauri::State;
use crate::db::DbState;
use crate::models::chat::ChatSession;
use crate::services::chat_file_store;

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
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
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
    let count =
        chat_file_store::reencrypt_all_files(&chats_dir_state.0, pass.as_deref(), None)?;

    keyring_delete();
    *crypto.0.lock().map_err(|e| e.to_string())? = None;

    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
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
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
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
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    let session_id = chat_file_store::import_session_from_file(
        &conn,
        std::path::Path::new(&path),
        &workspace_id,
        project_id.as_deref().unwrap_or(""),
        passphrase.as_deref(),
    )?;

    let pass = crypto.0.lock().ok().and_then(|g| g.clone());
    let _ = chat_file_store::write_session_file(&conn, &chats_dir_state.0, &session_id, pass.as_deref());

    conn.query_row(
        "SELECT id, workspace_id, project_id, title, model_name, system_prompt, is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at, parent_session_id, branch_message_id, created_at, updated_at
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
                parent_session_id: row.get(11)?,
                branch_message_id: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
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
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    let folder = std::path::Path::new(&folder_path);
    if !folder.is_dir() {
        return Err(format!("{} is not a directory", folder_path));
    }

    // Root folder name becomes the workspace name
    let workspace_name = folder.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Imported Chats")
        .to_string();

    let workspace_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO workspaces (id, name, description, prompt_instructions, topic_signature, created_at, updated_at)
         VALUES (?1, ?2, '', '', '{}', ?3, ?3)",
        rusqlite::params![workspace_id, workspace_name, now],
    ).map_err(|e| e.to_string())?;

    // Discover all conversation files with their subfolder names
    let conversations = chat_file_store::discover_lmstudio_conversations(folder)?;
    if conversations.is_empty() {
        return Err("No .conversation.json files found in the selected folder.".to_string());
    }

    // Build project map: subfolder name → project ID
    let mut project_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    let mut session_ids = Vec::new();
    let mut errors = Vec::new();

    for conv in &conversations {
        // Create project for subfolder if we haven't yet
        let project_id = if conv.subfolder.is_empty() {
            String::new() // root-level conversations have no project
        } else {
            let pid = project_map.entry(conv.subfolder.clone()).or_insert_with(|| {
                let id = uuid::Uuid::new_v4().to_string();
                let _ = conn.execute(
                    "INSERT INTO projects (id, workspace_id, name, project_description, custom_instructions, color, icon, created_at, updated_at)
                     VALUES (?1, ?2, ?3, '', '', '#007AFF', 'folder', ?4, ?4)",
                    rusqlite::params![id, workspace_id, conv.subfolder, now],
                );
                id
            });
            pid.clone()
        };

        match std::fs::read(&conv.path) {
            Ok(bytes) => match chat_file_store::parse_lmstudio_conversation(&bytes) {
                Ok(data) => {
                    match chat_file_store::import_chat_data(&conn, &data, &workspace_id, &project_id) {
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

    Ok(serde_json::json!({
        "imported": session_ids.len(),
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "projects_created": project_map.len(),
        "errors": errors.len(),
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
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
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
pub fn load_crypto_state_from_keyring(
    conn: &rusqlite::Connection,
) -> Option<String> {
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
