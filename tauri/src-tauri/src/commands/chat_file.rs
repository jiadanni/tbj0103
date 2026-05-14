//! Tauri commands for file-based chat storage and optional encryption.

use crate::commands::security::{require_auth, AuthState};
use crate::db::DbState;
use crate::models::chat::ChatSession;
use crate::services::chat_file_store;
use serde::Serialize;
use std::process::Command;
#[cfg(target_os = "linux")]
use std::path::Path;
use tauri::State;

/// In-memory passphrase state — populated at startup from keyring if
/// encryption is enabled, or when the user calls `setup_chat_encryption`.
pub struct ChatCryptoState(pub std::sync::Mutex<Option<String>>);

/// Immutable path to the chats directory (app_data/chats/).
pub struct ChatsDirState(pub std::path::PathBuf);

/// Validates and canonicalizes a user-provided file path.
/// Resolves symlinks and `..` components to prevent path traversal attacks.
/// For read operations: the file must exist.
/// For write operations: the parent directory must exist (or be creatable).
fn validate_user_path(raw: &str, must_exist: bool) -> Result<std::path::PathBuf, String> {
    let path = std::path::Path::new(raw);

    // Reject obviously suspicious patterns before canonicalization
    let normalized = raw.replace('\\', "/");
    if normalized.contains("/../") || normalized.ends_with("/..") || normalized.starts_with("../") {
        return Err("Path traversal is not allowed.".to_string());
    }

    if must_exist {
        // Canonicalize resolves symlinks and `..`
        std::fs::canonicalize(path).map_err(|e| format!("Invalid path '{}': {}", raw, e))
    } else {
        // For write targets: canonicalize the parent, then append the filename
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Cannot create directory for '{}': {}", raw, e))?;
                let canon_parent = std::fs::canonicalize(parent)
                    .map_err(|e| format!("Invalid parent path '{}': {}", raw, e))?;
                if let Some(filename) = path.file_name() {
                    Ok(canon_parent.join(filename))
                } else {
                    Err("Path has no filename component.".to_string())
                }
            } else {
                Ok(path.to_path_buf())
            }
        } else {
            Ok(path.to_path_buf())
        }
    }
}

#[derive(Serialize)]
struct LmStudioConversationPreview {
    uuid: String,
    name: String,
    message_count: usize,
    created_at: String,
    updated_at: String,
    folder_id: Option<String>,
    folder_name: Option<String>,
    source_path: String,
}

#[derive(Serialize)]
struct LmStudioFolderPreview {
    uuid: String,
    name: String,
    conversation_count: usize,
    message_count: usize,
}

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

fn lmstudio_preview_id(root: &std::path::Path, path: &std::path::Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn lmstudio_selection_matches(
    preview_id: &str,
    subfolder: &str,
    selected_ids: Option<&std::collections::HashSet<&str>>,
    selected_folder_ids: Option<&std::collections::HashSet<&str>>,
) -> bool {
    if let Some(filter) = selected_ids {
        if !filter.contains(preview_id) {
            return false;
        }
    }

    if let Some(filter) = selected_folder_ids {
        if !subfolder.is_empty() && !filter.contains(subfolder) {
            return false;
        }
    }

    true
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
    // Try the workspace/folder subdirectory path first
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
    auth: State<AuthState>,
    passphrase: String,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<usize, String> {
    require_auth(&auth, &db_state)?;
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
    auth: State<AuthState>,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<usize, String> {
    require_auth(&auth, &db_state)?;
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
    auth: State<AuthState>,
    session_id: String,
    dest_path: String,
    db_state: State<DbState>,
) -> Result<(), String> {
    require_auth(&auth, &db_state)?;
    let dest = validate_user_path(&dest_path, false)?;
    let conn = db_state.0.get().map_err(|e| e.to_string())?;
    chat_file_store::write_session_file(&conn, dest.parent().unwrap_or(&dest), &session_id, None)?;
    // The above writes to parent/<session_id>.json — rename to dest_path
    let auto_path = dest
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join(format!("{}.json", session_id));
    if auto_path != dest {
        std::fs::rename(&auto_path, &dest).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Import a chat JSON (plain or encrypted) into the database.
/// Returns the imported chat session.
#[tauri::command]
pub fn import_chat_from_json(
    auth: State<AuthState>,
    path: String,
    workspace_id: String,
    folder_id: Option<String>,
    passphrase: Option<String>,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<ChatSession, String> {
    require_auth(&auth, &db_state)?;
    let validated_path = validate_user_path(&path, true)?;
    let conn = db_state.0.get().map_err(|e| e.to_string())?;
    let session_id = chat_file_store::import_session_from_file(
        &conn,
        &validated_path,
        &workspace_id,
        folder_id.as_deref().unwrap_or(""),
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
        "SELECT id, workspace_id, folder_id, title, model_name, system_prompt, is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at, last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id, created_at, updated_at
         FROM chat_sessions WHERE id = ?1",
        rusqlite::params![session_id],
        |row| {
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
                message_count: 0,
            })
        },
    )
    .map_err(|e| e.to_string())
}

/// Import all LM Studio `.conversation.json` files from a folder (recursively).
/// Root folder name → workspace, subfolders → folders, conversations → sessions.
/// Returns the workspace ID and count of imported sessions.
#[tauri::command]
pub fn preview_lmstudio_folder(folder_path: String) -> Result<serde_json::Value, String> {
    let folder = validate_user_path(&folder_path, true)?;
    if !folder.is_dir() {
        return Err(format!("{} is not a directory", folder_path));
    }

    let conversations = chat_file_store::discover_lmstudio_conversations(&folder)?;
    if conversations.is_empty() {
        return Err("No .conversation.json files found in the selected folder.".to_string());
    }

    let mut previews = Vec::new();
    let mut folder_counts: std::collections::BTreeMap<String, (usize, usize)> =
        std::collections::BTreeMap::new();
    let mut errors = Vec::new();

    for conv in &conversations {
        let preview_id = lmstudio_preview_id(&folder, &conv.path);
        match std::fs::read(&conv.path) {
            Ok(bytes) => match chat_file_store::parse_lmstudio_conversation(&bytes) {
                Ok(data) => {
                    let folder_id = (!conv.subfolder.is_empty()).then(|| conv.subfolder.clone());
                    let folder_name = folder_id.clone();
                    let message_count = data.messages.len();

                    if let Some(folder_key) = folder_id.as_ref() {
                        let entry = folder_counts.entry(folder_key.clone()).or_insert((0, 0));
                        entry.0 += 1;
                        entry.1 += message_count;
                    }

                    previews.push(LmStudioConversationPreview {
                        uuid: preview_id.clone(),
                        name: data.title,
                        message_count,
                        created_at: data.created_at,
                        updated_at: data.updated_at,
                        folder_id,
                        folder_name,
                        source_path: preview_id,
                    });
                }
                Err(e) => errors.push(format!("{preview_id}: {e}")),
            },
            Err(e) => errors.push(format!("{preview_id}: {e}")),
        }
    }

    if previews.is_empty() {
        let mut message =
            "LM Studio scan found conversation files, but none contained importable messages."
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

    previews.sort_by(|left, right| {
        left.folder_name
            .cmp(&right.folder_name)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.created_at.cmp(&right.created_at))
            .then_with(|| left.uuid.cmp(&right.uuid))
    });

    let folders = folder_counts
        .into_iter()
        .map(|(name, (conversation_count, message_count))| LmStudioFolderPreview {
            uuid: name.clone(),
            name,
            conversation_count,
            message_count,
        })
        .collect::<Vec<_>>();

    Ok(serde_json::json!({
        "conversations": previews,
        "total": previews.len(),
        "folders": folders,
        "errors": errors.len(),
        "error_messages": errors.iter().take(10).cloned().collect::<Vec<_>>(),
    }))
}

#[tauri::command]
pub fn import_lmstudio_folder(
    folder_path: String,
    workspace_name: Option<String>,
    selected_ids: Option<Vec<String>>,
    selected_folder_ids: Option<Vec<String>>,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<serde_json::Value, String> {
    let conn = db_state.0.get().map_err(|e| e.to_string())?;
    let folder = validate_user_path(&folder_path, true)?;
    if !folder.is_dir() {
        return Err(format!("{} is not a directory", folder_path));
    }

    // Use override name if provided, otherwise root folder name.
    let workspace_name = workspace_name.unwrap_or_else(|| {
        folder
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Imported Chats")
            .to_string()
    });

    // Discover all conversation files with their subfolder names
    let conversations = chat_file_store::discover_lmstudio_conversations(&folder)?;
    if conversations.is_empty() {
        return Err("No .conversation.json files found in the selected folder.".to_string());
    }

    let selected_id_filter: Option<std::collections::HashSet<&str>> = selected_ids
        .as_ref()
        .map(|ids| ids.iter().map(|id| id.as_str()).collect());
    let selected_folder_filter: Option<std::collections::HashSet<&str>> = selected_folder_ids
        .as_ref()
        .map(|ids| ids.iter().map(|id| id.as_str()).collect());

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

    // Build folder map lazily: subfolder name -> folder ID.
    let mut folder_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    let mut session_ids = Vec::new();
    let mut errors = Vec::new();
    let mut skipped = 0usize;
    let mut matched_selection = 0usize;

    for conv in &conversations {
        let preview_id = lmstudio_preview_id(&folder, &conv.path);
        if !lmstudio_selection_matches(
            &preview_id,
            &conv.subfolder,
            selected_id_filter.as_ref(),
            selected_folder_filter.as_ref(),
        ) {
            continue;
        }

        matched_selection += 1;
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

                    let folder_id = if conv.subfolder.is_empty() {
                        String::new()
                    } else if let Some(existing_folder_id) = folder_map.get(&conv.subfolder) {
                        existing_folder_id.clone()
                    } else {
                        let normalized_folder_name = conv.subfolder.trim();
                        let folder_id = if let Ok(existing_folder_id) = conn.query_row(
                            "SELECT id FROM folders WHERE workspace_id = ?1 AND lower(trim(name)) = lower(trim(?2)) LIMIT 1",
                            rusqlite::params![workspace_id, normalized_folder_name],
                            |row| row.get::<_, String>(0),
                        ) {
                            existing_folder_id
                        } else {
                            let id = uuid::Uuid::new_v4().to_string();
                            conn.execute(
                                "INSERT INTO folders (id, workspace_id, name, folder_description, custom_instructions, color, icon, created_at, updated_at)
                                 VALUES (?1, ?2, ?3, '', '', '#007AFF', 'folder', ?4, ?4)",
                                rusqlite::params![id, workspace_id, conv.subfolder, now],
                            ).map_err(|e| e.to_string())?;
                            id
                        };
                        folder_map.insert(conv.subfolder.clone(), folder_id.clone());
                        folder_id
                    };

                    // Skip duplicate: same title + created_at in same workspace/folder
                    let duplicate: bool = conn.query_row(
                        "SELECT 1 FROM chat_sessions WHERE workspace_id = ?1 AND folder_id = ?2 AND title = ?3 AND created_at = ?4 AND is_imported = 1 LIMIT 1",
                        rusqlite::params![workspace_id, folder_id, data.title, data.created_at],
                        |_| Ok(true),
                    ).unwrap_or(false);

                    if duplicate {
                        skipped += 1;
                        continue;
                    }

                    match chat_file_store::import_chat_data(
                        &conn,
                        &data,
                        &workspace_id,
                        &folder_id,
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

    if matched_selection == 0 {
        return Err("No conversations were selected for import.".to_string());
    }

    // Sync imported sessions to chat files (best-effort)
    let pass = crypto.0.lock().ok().and_then(|g| g.clone());
    for id in &session_ids {
        let _ = chat_file_store::write_session_file(&conn, &chats_dir_state.0, id, pass.as_deref());
    }

    if session_ids.is_empty() && skipped == 0 {
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
        "skipped": skipped,
        "workspace_id": workspace_id.unwrap_or_default(),
        "workspace_name": workspace_name,
        "folders_created": folder_map.len(),
        "errors": errors.len(),
        "error_messages": errors.iter().take(10).cloned().collect::<Vec<_>>(),
    }))
}

/// Import multiple folders as separate workspaces.
/// Each folder becomes its own workspace with the folder name.
#[tauri::command]
pub fn import_multiple_folders(
    folder_paths: Vec<String>,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<serde_json::Value, String> {
    if folder_paths.is_empty() {
        return Err("No folders selected".to_string());
    }

    let conn = db_state.0.get().map_err(|e| e.to_string())?;
    let total_folder_count = folder_paths.len();
    let mut results = Vec::new();
    let mut total_imported = 0;
    let mut total_skipped = 0;
    let mut total_errors = 0;

    for folder_path in folder_paths {
        let folder = match validate_user_path(&folder_path, true) {
            Ok(p) => p,
            Err(e) => {
                results.push(serde_json::json!({
                    "folder_path": folder_path,
                    "status": "error",
                    "message": e,
                }));
                total_errors += 1;
                continue;
            }
        };
        if !folder.is_dir() {
            results.push(serde_json::json!({
                "folder_path": folder_path,
                "status": "error",
                "message": format!("{} is not a directory", folder_path),
            }));
            continue;
        }

        // Use folder name as workspace name
        let workspace_name = folder
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Imported Chats")
            .to_string();

        // Try to discover .conversation.json files
        match chat_file_store::discover_lmstudio_conversations(&folder) {
            Ok(conversations) => {
                if conversations.is_empty() {
                    results.push(serde_json::json!({
                        "folder_path": folder_path,
                        "workspace_name": workspace_name,
                        "status": "warning",
                        "message": "No .conversation.json files found",
                        "imported": 0,
                    }));
                    continue;
                }

                let now = chrono::Utc::now().to_rfc3339();
                let normalized_workspace_name = workspace_name.trim();

                // Check if workspace already exists
                let existing_workspace_id = conn
                    .query_row(
                        "SELECT id FROM workspaces WHERE lower(trim(name)) = lower(trim(?1)) LIMIT 1",
                        rusqlite::params![normalized_workspace_name],
                        |row| row.get::<_, String>(0),
                    )
                    .ok();

                let workspace_id = if let Some(id) = existing_workspace_id {
                    id
                } else {
                    let new_id = uuid::Uuid::new_v4().to_string();
                    if let Err(e) = conn.execute(
                        "INSERT INTO workspaces (id, name, description, prompt_instructions, topic_signature, created_at, updated_at)
                         VALUES (?1, ?2, '', '', '{}', ?3, ?3)",
                        rusqlite::params![new_id, workspace_name, now],
                    ) {
                        results.push(serde_json::json!({
                            "folder_path": folder_path,
                            "workspace_name": workspace_name,
                            "status": "error",
                            "message": format!("Failed to create workspace: {}", e),
                        }));
                        continue;
                    }
                    new_id
                };

                let mut folder_map: std::collections::HashMap<String, String> =
                    std::collections::HashMap::new();
                let mut session_ids = Vec::new();
                let mut import_errors = Vec::new();
                let mut skipped = 0usize;

                for conv in &conversations {
                    match std::fs::read(&conv.path) {
                        Ok(bytes) => match chat_file_store::parse_lmstudio_conversation(&bytes) {
                            Ok(data) => {
                                let folder_id = if conv.subfolder.is_empty() {
                                    String::new()
                                } else if let Some(existing_folder_id) = folder_map.get(&conv.subfolder) {
                                    existing_folder_id.clone()
                                } else {
                                    let normalized_folder_name = conv.subfolder.trim();
                                    let folder_id = if let Ok(existing_folder_id) = conn.query_row(
                                        "SELECT id FROM folders WHERE workspace_id = ?1 AND lower(trim(name)) = lower(trim(?2)) LIMIT 1",
                                        rusqlite::params![workspace_id, normalized_folder_name],
                                        |row| row.get::<_, String>(0),
                                    ) {
                                        existing_folder_id
                                    } else {
                                        let id = uuid::Uuid::new_v4().to_string();
                                        if let Err(e) = conn.execute(
                                            "INSERT INTO folders (id, workspace_id, name, folder_description, custom_instructions, color, icon, created_at, updated_at)
                                             VALUES (?1, ?2, ?3, '', '', '#007AFF', 'folder', ?4, ?4)",
                                            rusqlite::params![id, workspace_id, conv.subfolder, now],
                                        ) {
                                            import_errors.push(format!("{}: Failed to create folder: {}", conv.path.display(), e));
                                            continue;
                                        }
                                        id
                                    };
                                    folder_map.insert(conv.subfolder.clone(), folder_id.clone());
                                    folder_id
                                };

                                // Check for duplicates
                                let duplicate: bool = conn.query_row(
                                    "SELECT 1 FROM chat_sessions WHERE workspace_id = ?1 AND folder_id = ?2 AND title = ?3 AND created_at = ?4 AND is_imported = 1 LIMIT 1",
                                    rusqlite::params![workspace_id, folder_id, data.title, data.created_at],
                                    |_| Ok(true),
                                ).unwrap_or(false);

                                if duplicate {
                                    skipped += 1;
                                    continue;
                                }

                                match chat_file_store::import_chat_data(&conn, &data, &workspace_id, &folder_id) {
                                    Ok(sid) => session_ids.push(sid),
                                    Err(e) => import_errors.push(format!("{}: {}", conv.path.display(), e)),
                                }
                            }
                            Err(e) => import_errors.push(format!("{}: {}", conv.path.display(), e)),
                        },
                        Err(e) => import_errors.push(format!("{}: {}", conv.path.display(), e)),
                    }
                }

                // Sync imported sessions to chat files
                let pass = crypto.0.lock().ok().and_then(|g| g.clone());
                for id in &session_ids {
                    let _ = chat_file_store::write_session_file(&conn, &chats_dir_state.0, id, pass.as_deref());
                }

                total_imported += session_ids.len();
                total_skipped += skipped;
                total_errors += import_errors.len();

                results.push(serde_json::json!({
                    "folder_path": folder_path,
                    "workspace_id": workspace_id,
                    "workspace_name": workspace_name,
                    "status": "success",
                    "imported": session_ids.len(),
                    "skipped": skipped,
                    "folders_created": folder_map.len(),
                    "errors": import_errors.len(),
                }));
            }
            Err(e) => {
                results.push(serde_json::json!({
                    "folder_path": folder_path,
                    "status": "error",
                    "message": format!("Failed to scan folder: {}", e),
                }));
            }
        }
    }

    Ok(serde_json::json!({
        "total_folders": total_folder_count,
        "successful": results.iter().filter(|r| r.get("status").and_then(|s| s.as_str()) == Some("success")).count(),
        "total_imported": total_imported,
        "total_skipped": total_skipped,
        "total_errors": total_errors,
        "results": results,
    }))
}

/// Import a Gemini Takeout folder into a new or existing "Gemini Apps" workspace.
/// Searches for `My Activity.html` within the folder.
#[tauri::command]
pub fn import_gemini_takeout(
    file_path: String,
    workspace_name: Option<String>,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<serde_json::Value, String> {
    let conn = db_state.0.get().map_err(|e| e.to_string())?;
    let html_file = validate_user_path(&file_path, true)?;
    if !html_file.is_file() {
        return Err(format!("{} is not a file", file_path));
    }

    let html_bytes = std::fs::read(&html_file).map_err(|e| format!("Failed to read file: {}", e))?;
    let html = String::from_utf8_lossy(&html_bytes).to_string();

    let sessions = chat_file_store::parse_gemini_takeout(&html)?;
    if sessions.is_empty() {
        return Err("No Gemini conversations found in the selected HTML file.".to_string());
    }

    let workspace_name = workspace_name.unwrap_or_else(|| "Gemini Apps".to_string());
    let now = chrono::Utc::now().to_rfc3339();

    let existing_workspace_id = conn
        .query_row(
            "SELECT id FROM workspaces WHERE lower(trim(name)) = lower(trim(?1)) LIMIT 1",
            rusqlite::params![workspace_name.trim()],
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
                id, workspace_id, folder_id, title, model_name, system_prompt,
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

/// Preview Claude Desktop export files. Each path is optional and read independently —
/// the user picks which combination of conversations.json / projects.json / memories.json
/// they want to scan. Files may live in different folders.
#[tauri::command]
pub fn preview_claude_files(
    conversations_path: Option<String>,
    projects_path: Option<String>,
    memories_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let read_optional = |path: Option<String>, label: &str| -> Result<Option<Vec<u8>>, String> {
        match path {
            None => Ok(None),
            Some(p) => {
                let resolved = validate_user_path(&p, true)?;
                if !resolved.is_file() {
                    return Err(format!("{} is not a file", p));
                }
                let bytes = std::fs::read(&resolved)
                    .map_err(|e| format!("Failed to read {label}: {e}"))?;
                Ok(Some(bytes))
            }
        }
    };

    let conv_bytes = read_optional(conversations_path, "conversations.json")?;
    let proj_bytes = read_optional(projects_path, "projects.json")?;
    let mem_bytes = read_optional(memories_path, "memories.json")?;

    if conv_bytes.is_none() && proj_bytes.is_none() && mem_bytes.is_none() {
        return Err("Provide at least one of conversations.json, projects.json, or memories.json.".to_string());
    }

    let conversations = conv_bytes
        .as_deref()
        .map(chat_file_store::preview_claude_conversations)
        .transpose()?
        .unwrap_or_default();

    let claude_projects = proj_bytes
        .as_deref()
        .map(chat_file_store::preview_claude_projects)
        .transpose()?
        .unwrap_or_default();

    let memories = mem_bytes
        .as_deref()
        .map(|b| chat_file_store::preview_claude_memories(b, proj_bytes.as_deref()))
        .transpose()?;

    Ok(serde_json::json!({
        "conversations": conversations,
        "total": conversations.len(),
        "folders": claude_projects,
        "memories": memories,
    }))
}

/// Resolve which Aetherium folder a Claude conversation should land in.
///
/// Inputs:
///   - `conversation_project_uuid`: the `project_uuid` recorded on the conversation
///     in conversations.json (None if the chat had no folder in the source export).
///   - `folder_map`: UUID → Aetherium folder_id for folders that were created
///     during this import (populated only if projects.json was supplied and the
///     project was selected).
///   - `workspace_id`: target workspace.
///   - `unassigned_folder_id`: lazy-init slot for the placeholder
///     "Unassigned Imports" folder. The first time orphan handling needs it, the
///     closure should create the folder row and cache its id here.
///
/// Returns the folder_id string to write into chat_sessions.folder_id
/// (empty string means "loose chat in workspace, no folder").
fn resolve_folder_id_for_import(
    conversation_project_uuid: Option<&str>,
    folder_map: &std::collections::HashMap<String, String>,
    workspace_id: &str,
    unassigned_folder_id: &mut Option<String>,
    conn: &rusqlite::Connection,
    now: &str,
) -> Result<String, String> {
    let Some(uuid) = conversation_project_uuid else {
        return Ok(String::new());
    };
    if let Some(mapped) = folder_map.get(uuid) {
        return Ok(mapped.clone());
    }
    if let Some(id) = unassigned_folder_id.as_ref() {
        return Ok(id.clone());
    }
    let existing = conn
        .query_row(
            "SELECT id FROM folders WHERE workspace_id = ?1 AND name = ?2 LIMIT 1",
            rusqlite::params![workspace_id, "Unassigned Imports"],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let id = if let Some(id) = existing {
        id
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO folders (id, workspace_id, name, folder_description, custom_instructions, color, icon, created_at, updated_at)
             VALUES (?1, ?2, 'Unassigned Imports', '', '', '#8E8E93', 'inbox', ?3, ?3)",
            rusqlite::params![id, workspace_id, now],
        )
        .map_err(|e| e.to_string())?;
        id
    };
    *unassigned_folder_id = Some(id.clone());
    Ok(id)
}

/// Import Claude Desktop data from any combination of conversations.json,
/// projects.json, and memories.json. Files are independent — they can live in
/// different folders. All selected files contribute to a single workspace.
///
/// Linking: if both conversations.json and projects.json are imported, each
/// conversation's `project_uuid` is used to attach it to the corresponding
/// project. Conversations whose folder was not imported go to a placeholder
/// folder per `resolve_folder_id_for_import`.
///
/// Use `preview_claude_files` first to populate the picker UI.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn import_claude_files(
    workspace_name: Option<String>,
    conversations_path: Option<String>,
    projects_path: Option<String>,
    memories_path: Option<String>,
    selected_ids: Option<Vec<String>>,
    selected_folder_ids: Option<Vec<String>>,
    import_memories: Option<bool>,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
    db_state: State<DbState>,
) -> Result<serde_json::Value, String> {
    let conn = db_state.0.get().map_err(|e| e.to_string())?;

    let read_optional = |path: Option<&String>, label: &str| -> Result<Option<Vec<u8>>, String> {
        match path {
            None => Ok(None),
            Some(p) => {
                let resolved = validate_user_path(p, true)?;
                if !resolved.is_file() {
                    return Err(format!("{} is not a file", p));
                }
                Ok(Some(
                    std::fs::read(&resolved)
                        .map_err(|e| format!("Failed to read {label}: {e}"))?,
                ))
            }
        }
    };

    let conv_bytes = read_optional(conversations_path.as_ref(), "conversations.json")?;
    let proj_bytes = read_optional(projects_path.as_ref(), "projects.json")?;
    let mem_bytes = read_optional(memories_path.as_ref(), "memories.json")?;

    if conv_bytes.is_none() && proj_bytes.is_none() && mem_bytes.is_none() {
        return Err("Provide at least one of conversations.json, projects.json, or memories.json.".to_string());
    }

    let chat_data_list: Vec<(chat_file_store::ChatFileData, Option<String>)> = match conv_bytes
        .as_deref()
    {
        Some(bytes) => chat_file_store::parse_claude_conversations_filtered(
            bytes,
            selected_ids.as_deref().unwrap_or(&[]),
        )?,
        None => Vec::new(),
    };

    let workspace_name = workspace_name.unwrap_or_else(|| "Claude Desktop".to_string());
    let now = chrono::Utc::now().to_rfc3339();

    // Get or create workspace
    let existing_workspace_id = conn
        .query_row(
            "SELECT id FROM workspaces WHERE lower(trim(name)) = lower(trim(?1)) LIMIT 1",
            rusqlite::params![workspace_name.trim()],
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

    // Create folders from projects.json (if supplied), filtered by selection.
    let mut folders_created = 0usize;
    let mut folder_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let folder_id_filter: Option<std::collections::HashSet<&str>> = selected_folder_ids
        .as_ref()
        .map(|ids| ids.iter().map(|s| s.as_str()).collect());

    if let Some(bytes) = proj_bytes.as_deref() {
        let claude_projects = chat_file_store::parse_claude_projects(bytes)?;
        for (proj_uuid, proj_name, proj_description, proj_prompt) in &claude_projects {
            if let Some(ref filter) = folder_id_filter {
                if !filter.contains(proj_uuid.as_str()) {
                    continue;
                }
            }
            let normalized = proj_name.trim();
            let existing_folder_id = conn
                .query_row(
                    "SELECT id FROM folders WHERE workspace_id = ?1 AND lower(trim(name)) = lower(trim(?2)) LIMIT 1",
                    rusqlite::params![workspace_id, normalized],
                    |row| row.get::<_, String>(0),
                )
                .ok();

            let folder_id = if let Some(id) = existing_folder_id {
                id
            } else {
                let id = uuid::Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO folders (id, workspace_id, name, folder_description, custom_instructions, color, icon, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, '#007AFF', 'folder', ?6, ?6)",
                    rusqlite::params![id, workspace_id, proj_name, proj_description, proj_prompt, now],
                )
                .map_err(|e| e.to_string())?;
                folders_created += 1;
                id
            };
            folder_map.insert(proj_uuid.clone(), folder_id);
        }
    }

    // Import conversations, routing each to a folder via resolve_folder_id_for_import.
    let mut session_ids = Vec::new();
    let mut errors = Vec::new();
    let mut unassigned_folder_id: Option<String> = None;

    for (data, conversation_project_uuid) in &chat_data_list {
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

        let folder_id = resolve_folder_id_for_import(
            conversation_project_uuid.as_deref(),
            &folder_map,
            &workspace_id,
            &mut unassigned_folder_id,
            &conn,
            &now,
        )?;

        match chat_file_store::import_chat_data(&conn, data, &workspace_id, &folder_id) {
            Ok(sid) => session_ids.push(sid),
            Err(e) => errors.push(format!("{}: {e}", data.title)),
        }
    }

    let pass = crypto.0.lock().ok().and_then(|g| g.clone());
    for id in &session_ids {
        let _ =
            chat_file_store::write_session_file(&conn, &chats_dir_state.0, id, pass.as_deref());
    }

    // Import memories from memories.json (if supplied and requested).
    let mut memories_imported = 0usize;
    if import_memories.unwrap_or(false) {
        if let Some(bytes) = mem_bytes.as_deref() {
            if let Ok(preview) =
                chat_file_store::preview_claude_memories(bytes, proj_bytes.as_deref())
            {
                if !preview.conversations_memory.trim().is_empty() {
                    let mem_id = uuid::Uuid::new_v4().to_string();
                    conn.execute(
                        "INSERT INTO memories (id, workspace_id, content, memory_type, scope, is_pinned, is_active, created_at, updated_at)
                         VALUES (?1, ?2, ?3, 'context', 'workspace', 0, 1, ?4, ?4)",
                        rusqlite::params![mem_id, workspace_id, preview.conversations_memory, now],
                    ).map_err(|e| e.to_string())?;
                    memories_imported += 1;
                }
                for pm in &preview.folder_memories {
                    if let Some(proj_id) = folder_map.get(&pm.project_uuid) {
                        let mem_id = uuid::Uuid::new_v4().to_string();
                        conn.execute(
                            "INSERT INTO memories (id, workspace_id, folder_id, content, memory_type, scope, is_pinned, is_active, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, 'context', 'workspace', 0, 1, ?5, ?5)",
                            rusqlite::params![mem_id, workspace_id, proj_id, pm.memory, now],
                        ).map_err(|e| e.to_string())?;
                        memories_imported += 1;
                    } else {
                        errors.push(format!(
                            "Skipped memory for project '{}' (project not imported)",
                            pm.folder_name
                        ));
                    }
                }
            }
        }
    }

    let total_attempted = chat_data_list.len();
    Ok(serde_json::json!({
        "imported": session_ids.len(),
        "skipped": total_attempted.saturating_sub(session_ids.len() + errors.len()),
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "folders_created": folders_created,
        "memories_imported": memories_imported,
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
