//! Tauri commands for file-based chat storage and optional encryption.

use crate::commands::security::{require_auth, AuthState};
use crate::db::DbState;
use crate::models::chat::ChatSession;
use crate::services::chat_file_store;
use serde::Serialize;
use std::process::Command;
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
fn try_linux_file_selection(reveal_path: &std::path::Path) -> Result<(), String> {
    let abs_path = std::fs::canonicalize(reveal_path).map_err(|e| e.to_string())?;
    let file_uri = reqwest::Url::from_file_path(abs_path)
        .map_err(|_| "Failed to create file URI".to_string())?
        .to_string();

    // Escape for GVariant string literal: backslash and double quote
    let escaped_uri = file_uri.replace('\\', "\\\\").replace('"', "\\\"");

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
            &format!("[\"{escaped_uri}\"]"),
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
pub async fn reveal_chat_file(
    session_id: String,
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let chats_dir = chats_dir_state.0.clone();
    let encrypted = crypto.0.lock().map_err(|e| e.to_string())?.is_some();
    let pool = db_state.0.clone();
    tokio::task::spawn_blocking(move || {
    let conn = pool.get().map_err(|e| e.to_string())?;
    // Try the workspace/folder subdirectory path first
    let path = chat_file_store::session_file_path_for_session(
        &conn,
        &chats_dir,
        &session_id,
        encrypted,
    );
    let fallback_path = chat_file_store::session_file_path_for_session(
        &conn,
        &chats_dir,
        &session_id,
        !encrypted,
    );
    // Legacy flat-directory paths as final fallback
    let legacy_path =
        chat_file_store::session_file_path(&chats_dir, &session_id, encrypted);
    let legacy_fallback =
        chat_file_store::session_file_path(&chats_dir, &session_id, !encrypted);
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
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Enable (or rotate) encryption for all chat JSON files.
/// Stores the passphrase in the system keychain.
#[tauri::command]
pub async fn setup_chat_encryption(
    auth: State<'_, AuthState>,
    passphrase: String,
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<usize, String> {
    require_auth(&auth, &db_state)?;
    if passphrase.is_empty() {
        return Err("Passphrase must not be empty".to_string());
    }
    let chats_dir = chats_dir_state.0.clone();
    let old_pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
    let pool = db_state.0.clone();
    let passphrase_clone = passphrase.clone();

    let count = tokio::task::spawn_blocking(move || {
        // Re-encrypt / encrypt all existing files
        let count = chat_file_store::reencrypt_all_files(
            &chats_dir,
            old_pass.as_deref(),
            Some(&passphrase_clone),
        )?;

        // Persist new passphrase
        keyring_store(&passphrase_clone)?;

        // Persist flag in settings DB
        let conn = pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('chat_encryption_enabled', 'true')",
            [],
        )
        .map_err(|e| e.to_string())?;

        // Sync any sessions that don't yet have a file
        sync_all_to_files_internal(&conn, &chats_dir, Some(&passphrase_clone))?;

        Ok::<usize, String>(count)
    })
    .await
    .map_err(|e| e.to_string())??;

    // Update in-memory state (must hold the lock briefly on the async task)
    *crypto.0.lock().map_err(|e| e.to_string())? = Some(passphrase);

    Ok(count)
}

/// Disable encryption — decrypt all files and clear the keychain entry.
#[tauri::command]
pub async fn disable_chat_encryption(
    auth: State<'_, AuthState>,
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<usize, String> {
    require_auth(&auth, &db_state)?;
    let chats_dir = chats_dir_state.0.clone();
    let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
    let pool = db_state.0.clone();

    let count = tokio::task::spawn_blocking(move || {
        let count = chat_file_store::reencrypt_all_files(&chats_dir, pass.as_deref(), None)?;
        keyring_delete();

        let conn = pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('chat_encryption_enabled', 'false')",
            [],
        )
        .map_err(|e| e.to_string())?;

        Ok::<usize, String>(count)
    })
    .await
    .map_err(|e| e.to_string())??;

    *crypto.0.lock().map_err(|e| e.to_string())? = None;

    Ok(count)
}

/// Export a single chat session to a specific file path (always plaintext).
#[tauri::command]
pub async fn export_chat_as_json(
    auth: State<'_, AuthState>,
    session_id: String,
    dest_path: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    require_auth(&auth, &db_state)?;
    let pool = db_state.0.clone();
    tokio::task::spawn_blocking(move || {
        let dest = validate_user_path(&dest_path, false)?;
        let conn = pool.get().map_err(|e| e.to_string())?;
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
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Import a chat JSON (plain or encrypted) into the database.
/// Returns the imported chat session.
#[tauri::command]
pub async fn import_chat_from_json(
    auth: State<'_, AuthState>,
    path: String,
    workspace_id: String,
    folder_id: Option<String>,
    passphrase: Option<String>,
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<ChatSession, String> {
    require_auth(&auth, &db_state)?;
    let chats_dir = chats_dir_state.0.clone();
    let pass = crypto.0.lock().ok().and_then(|g| g.clone());
    let pool = db_state.0.clone();
    tokio::task::spawn_blocking(move || {
    let validated_path = validate_user_path(&path, true)?;
    let conn = pool.get().map_err(|e| e.to_string())?;
    let session_id = chat_file_store::import_session_from_file(
        &conn,
        &validated_path,
        &workspace_id,
        folder_id.as_deref().unwrap_or(""),
        passphrase.as_deref(),
    )?;

    let _ = chat_file_store::write_session_file(
        &conn,
        &chats_dir,
        &session_id,
        pass.as_deref(),
    );

    conn.query_row(
        "SELECT id, workspace_id, folder_id, title, model_name, system_prompt, is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at, last_accessed_at, last_processed_message_count, is_imported, parent_session_id, branch_message_id, is_unread, created_at, updated_at
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
                is_unread: row.get::<_, i32>(16)? != 0,
                created_at: row.get(17)?,
                updated_at: row.get(18)?,
                message_count: 0,
            })
        },
    )
    .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Import all LM Studio `.conversation.json` files from a folder (recursively).
/// Root folder name → workspace, subfolders → folders, conversations → sessions.
/// Returns the workspace ID and count of imported sessions.
#[tauri::command]
pub async fn preview_lmstudio_folder(folder_path: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
    preview_lmstudio_folder_inner(folder_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn preview_lmstudio_folder_inner(folder_path: String) -> Result<serde_json::Value, String> {
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
        .map(
            |(name, (conversation_count, message_count))| LmStudioFolderPreview {
                uuid: name.clone(),
                name,
                conversation_count,
                message_count,
            },
        )
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
#[allow(clippy::too_many_arguments)]
pub async fn import_lmstudio_folder(
    folder_path: String,
    workspace_name: Option<String>,
    selected_ids: Option<Vec<String>>,
    selected_folder_ids: Option<Vec<String>>,
    // Re-import behavior. When `merge_existing` is true, duplicates are reconciled
    // (new tail messages appended). When false (default), duplicates are skipped.
    // `clone_edited` only matters when merging: if the existing chat has been edited
    // locally, import the source as a fresh session with a new UUID instead of skipping.
    merge_existing: Option<bool>,
    clone_edited: Option<bool>,
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let chats_dir = chats_dir_state.0.clone();
    let passphrase = crypto.0.lock().ok().and_then(|g| g.clone());
    let pool = db_state.0.clone();
    tokio::task::spawn_blocking(move || {
    let merge_existing = merge_existing.unwrap_or(false);
    let clone_edited = clone_edited.unwrap_or(false);
    let conn = pool.get().map_err(|e| e.to_string())?;
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
    let mut appended_messages = 0usize;
    let mut appended_sessions = 0usize;
    let mut cloned = 0usize;
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

                    // Find existing imported chat with same title + created_at in same workspace/folder.
                    let existing_session_id: Option<String> = conn.query_row(
                        "SELECT id FROM chat_sessions WHERE workspace_id = ?1 AND folder_id = ?2 AND title = ?3 AND created_at = ?4 AND is_imported = 1 LIMIT 1",
                        rusqlite::params![workspace_id, folder_id, data.title, data.created_at],
                        |row| row.get::<_, String>(0),
                    ).ok();

                    if let Some(existing) = existing_session_id {
                        if !merge_existing {
                            skipped += 1;
                            continue;
                        }
                        match chat_file_store::reconcile_chat_data(&conn, &data, &existing) {
                            Ok(chat_file_store::ReconcileOutcome::Identical) => {
                                skipped += 1;
                                continue;
                            }
                            Ok(chat_file_store::ReconcileOutcome::Appended { new }) => {
                                appended_messages += new;
                                appended_sessions += 1;
                                session_ids.push(existing);
                                continue;
                            }
                            Ok(chat_file_store::ReconcileOutcome::Edited) => {
                                if !clone_edited {
                                    skipped += 1;
                                    continue;
                                }
                                // Fall through to import as a fresh session (new uuid).
                                cloned += 1;
                            }
                            Err(e) => {
                                errors.push(format!("{}: reconcile failed: {e}", conv.path.display()));
                                continue;
                            }
                        }
                    }

                    match chat_file_store::import_chat_data(&conn, &data, &workspace_id, &folder_id)
                    {
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
    for id in &session_ids {
        let _ = chat_file_store::write_session_file(&conn, &chats_dir, id, passphrase.as_deref());
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
        "appended_sessions": appended_sessions,
        "appended_messages": appended_messages,
        "cloned": cloned,
        "workspace_id": workspace_id.unwrap_or_default(),
        "workspace_name": workspace_name,
        "folders_created": folder_map.len(),
        "errors": errors.len(),
        "error_messages": errors.iter().take(10).cloned().collect::<Vec<_>>(),
    }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Import multiple folders as separate workspaces.
/// Each folder becomes its own workspace with the folder name.
#[tauri::command]
pub async fn import_multiple_folders(
    folder_paths: Vec<String>,
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    if folder_paths.is_empty() {
        return Err("No folders selected".to_string());
    }
    let chats_dir = chats_dir_state.0.clone();
    let passphrase = crypto.0.lock().ok().and_then(|g| g.clone());
    let pool = db_state.0.clone();
    tokio::task::spawn_blocking(move || {
    let conn = pool.get().map_err(|e| e.to_string())?;
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
                                } else if let Some(existing_folder_id) =
                                    folder_map.get(&conv.subfolder)
                                {
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

                                match chat_file_store::import_chat_data(
                                    &conn,
                                    &data,
                                    &workspace_id,
                                    &folder_id,
                                ) {
                                    Ok(sid) => session_ids.push(sid),
                                    Err(e) => import_errors.push(format!(
                                        "{}: {}",
                                        conv.path.display(),
                                        e
                                    )),
                                }
                            }
                            Err(e) => import_errors.push(format!("{}: {}", conv.path.display(), e)),
                        },
                        Err(e) => import_errors.push(format!("{}: {}", conv.path.display(), e)),
                    }
                }

                // Sync imported sessions to chat files
                for id in &session_ids {
                    let _ = chat_file_store::write_session_file(
                        &conn,
                        &chats_dir,
                        id,
                        passphrase.as_deref(),
                    );
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
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Preview a Gemini Takeout HTML file — returns conversation summaries for selection.
#[tauri::command]
pub async fn preview_gemini_takeout(file_path: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
    preview_gemini_takeout_inner(file_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn preview_gemini_takeout_inner(file_path: String) -> Result<serde_json::Value, String> {
    let html_file = validate_user_path(&file_path, true)?;
    if !html_file.is_file() {
        return Err(format!("{} is not a file", file_path));
    }

    let html_bytes =
        std::fs::read(&html_file).map_err(|e| format!("Failed to read file: {}", e))?;
    let html = String::from_utf8_lossy(&html_bytes).to_string();

    let sessions = chat_file_store::parse_gemini_takeout(&html)?;
    if sessions.is_empty() {
        let has_outer_cell = html.contains("outer-cell");
        let has_prompted = html.contains("Prompted") || html.contains("prompted");
        let has_content_cell = html.contains("content-cell");
        let file_len = html.len();
        return Err(format!(
            "No conversations found in the selected HTML file. \
             (file size: {} bytes, has outer-cell: {}, has content-cell: {}, has Prompted: {})",
            file_len, has_outer_cell, has_content_cell, has_prompted
        ));
    }

    let previews: Vec<serde_json::Value> = sessions
        .iter()
        .map(|s| {
            let first_user = s
                .messages
                .iter()
                .find(|m| m.role == "user")
                .map(|m| {
                    let chars: String = m.content.chars().take(280).collect();
                    chars
                })
                .unwrap_or_default();
            let messages: Vec<serde_json::Value> = s
                .messages
                .iter()
                .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
                .collect();
            serde_json::json!({
                "uuid": s.id,
                "name": s.title,
                "message_count": s.messages.len(),
                "created_at": s.created_at,
                "updated_at": s.updated_at,
                "first_user_message": first_user,
                "messages": messages,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "conversations": previews,
        "total": previews.len(),
    }))
}

/// Import a Gemini Takeout file into a new or existing workspace.
/// Accepts optional `selected_ids` to import only chosen conversations.
#[tauri::command]
pub async fn import_gemini_takeout(
    file_path: String,
    workspace_name: Option<String>,
    selected_ids: Option<Vec<String>>,
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let chats_dir = chats_dir_state.0.clone();
    let crypto_pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
    let pool = db_state.0.clone();
    tokio::task::spawn_blocking(move || {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let html_file = validate_user_path(&file_path, true)?;
    if !html_file.is_file() {
        return Err(format!("{} is not a file", file_path));
    }

    let html_bytes =
        std::fs::read(&html_file).map_err(|e| format!("Failed to read file: {}", e))?;
    let html = String::from_utf8_lossy(&html_bytes).to_string();

    let sessions = chat_file_store::parse_gemini_takeout(&html)?;
    if sessions.is_empty() {
        let has_outer_cell = html.contains("outer-cell");
        let has_prompted = html.contains("Prompted") || html.contains("prompted");
        let has_content_cell = html.contains("content-cell");
        let file_len = html.len();
        return Err(format!(
            "No Gemini conversations found in the selected HTML file. \
             (file size: {} bytes, has outer-cell: {}, has content-cell: {}, has Prompted: {})",
            file_len, has_outer_cell, has_content_cell, has_prompted
        ));
    }

    // Filter to selected IDs if provided
    let id_filter: Option<std::collections::HashSet<&str>> = selected_ids
        .as_ref()
        .map(|ids| ids.iter().map(|s| s.as_str()).collect());

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
    let mut skipped = 0usize;
    let mut errors = Vec::new();

    for data in &sessions {
        // Skip if not in selection
        if let Some(ref filter) = id_filter {
            if !filter.contains(data.id.as_str()) {
                continue;
            }
        }

        // Duplicate detection: same title + created_at in same workspace (like LM Studio)
        let duplicate: bool = conn.query_row(
            "SELECT 1 FROM chat_sessions WHERE workspace_id = ?1 AND title = ?2 AND created_at = ?3 AND is_imported = 1 LIMIT 1",
            rusqlite::params![workspace_id, data.title, data.created_at],
            |_| Ok(true),
        ).unwrap_or(false);

        if duplicate {
            skipped += 1;
            continue;
        }

        match chat_file_store::import_chat_data(&conn, data, &workspace_id, "") {
            Ok(sid) => session_ids.push(sid),
            Err(e) => errors.push(format!("{}: {e}", data.title)),
        }
    }

    // Write to disk for file-based consistency
    for id in &session_ids {
        let _ = chat_file_store::write_session_file(&conn, &chats_dir, id, crypto_pass.as_deref());
    }

    Ok(serde_json::json!({
        "imported_sessions": session_ids.len(),
        "imported_messages": sessions.iter().map(|s| s.messages.len()).sum::<usize>(),
        "skipped": skipped,
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "errors": errors.len(),
        "error_messages": errors.iter().take(10).cloned().collect::<Vec<_>>(),
    }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Preview a ChatGPT export folder — returns conversation summaries for selection.
#[tauri::command]
pub async fn preview_chatgpt_folder(
    folder_path: String,
) -> Result<chat_file_store::GptPreviewResponse, String> {
    tokio::task::spawn_blocking(move || {
        let folder = validate_user_path(&folder_path, true)?;
        if !folder.is_dir() {
            return Err(format!("{} is not a folder.", folder_path));
        }

        let file_paths = chat_file_store::discover_chatgpt_files(&folder)?;
        if file_paths.is_empty() {
            return Err(
                "No conversations.json or conversations-*.json files found in the selected folder."
                    .to_string(),
            );
        }

        let mut previews = Vec::new();
        for path in file_paths {
            let bytes = std::fs::read(&path)
                .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
            let conversations: Vec<chat_file_store::GptConversation> =
                serde_json::from_slice(&bytes)
                    .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;

            for conv in conversations {
                match chat_file_store::parse_gpt_conversation(&conv) {
                    Ok(chat_data) => {
                        let first_user = chat_data
                            .messages
                            .iter()
                            .find(|m| m.role == "user")
                            .map(|m| {
                                let chars: String = m.content.chars().take(280).collect();
                                chars
                            })
                            .unwrap_or_default();

                        let messages: Vec<chat_file_store::GptPreviewMessage> = chat_data
                            .messages
                            .iter()
                            .map(|m| chat_file_store::GptPreviewMessage {
                                role: m.role.clone(),
                                content: m.content.clone(),
                            })
                            .collect();

                        previews.push(chat_file_store::GptConversationPreview {
                            uuid: conv.id.clone(),
                            name: chat_data.title,
                            message_count: chat_data.messages.len(),
                            created_at: chat_data.created_at,
                            updated_at: chat_data.updated_at,
                            first_user_message: first_user,
                            messages,
                        });
                    }
                    Err(_) => {
                        // Quietly skip invalid conversations
                    }
                }
            }
        }

        let total = previews.len();
        Ok(chat_file_store::GptPreviewResponse {
            conversations: previews,
            total,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Import conversations from a ChatGPT export folder into a new or existing workspace.
#[tauri::command]
pub async fn import_chatgpt_folder(
    folder_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    selected_ids: Option<Vec<String>>,
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let chats_dir = chats_dir_state.0.clone();
    let passphrase = crypto.0.lock().ok().and_then(|g| g.clone());
    let pool = db_state.0.clone();

    tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let folder = validate_user_path(&folder_path, true)?;
        if !folder.is_dir() {
            return Err(format!("{} is not a folder.", folder_path));
        }

        let file_paths = chat_file_store::discover_chatgpt_files(&folder)?;
        if file_paths.is_empty() {
            return Err("No conversations.json or conversations-*.json files found in the selected folder.".to_string());
        }

        let id_filter: Option<std::collections::HashSet<String>> = selected_ids
            .map(|ids| ids.into_iter().collect());

        let mut all_conversations = Vec::new();
        for path in file_paths {
            let bytes = std::fs::read(&path)
                .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
            let conversations: Vec<chat_file_store::GptConversation> = serde_json::from_slice(&bytes)
                .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;
            all_conversations.extend(conversations);
        }

        let resolved_workspace_id = if let Some(wid) = workspace_id {
            let exists: bool = conn.query_row(
                "SELECT 1 FROM workspaces WHERE id = ?1",
                rusqlite::params![wid],
                |_| Ok(true),
            ).unwrap_or(false);
            if !exists {
                return Err(format!("Workspace {} not found", wid));
            }
            wid
        } else if let Some(wname) = workspace_name {
            let wname_trimmed = wname.trim();
            if wname_trimmed.is_empty() {
                return Err("Workspace name cannot be empty".to_string());
            }
            let existing_id: Option<String> = conn.query_row(
                "SELECT id FROM workspaces WHERE lower(trim(name)) = lower(trim(?1)) LIMIT 1",
                rusqlite::params![wname_trimmed],
                |row| row.get(0),
            ).ok();

            if let Some(id) = existing_id {
                id
            } else {
                let new_id = uuid::Uuid::new_v4().to_string();
                let now = chrono::Utc::now().to_rfc3339();
                conn.execute(
                    "INSERT INTO workspaces (id, name, description, prompt_instructions, topic_signature, created_at, updated_at)
                     VALUES (?1, ?2, '', '', '{}', ?3, ?3)",
                    rusqlite::params![new_id, wname_trimmed, now],
                ).map_err(|e| e.to_string())?;
                new_id
            }
        } else {
            return Err("Either workspace_id or workspace_name must be provided".to_string());
        };

        let mut session_ids = Vec::new();
        let mut skipped = 0usize;
        let mut errors = Vec::new();

        fn compute_chat_content_hash(messages: &[chat_file_store::ChatFileMessage]) -> String {
            use sha2::{Sha256, Digest};
            let mut hasher = Sha256::new();
            for msg in messages {
                hasher.update(msg.role.as_bytes());
                hasher.update(msg.content.as_bytes());
            }
            format!("{:x}", hasher.finalize())
        }

        for conv in all_conversations {
            if let Some(ref filter) = id_filter {
                if !filter.contains(&conv.id) {
                    continue;
                }
            }

            match chat_file_store::parse_gpt_conversation(&conv) {
                Ok(chat_data) => {
                    // Try duplicate detection title + created_at + workspace
                    let mut duplicate: bool = conn.query_row(
                        "SELECT 1 FROM chat_sessions WHERE workspace_id = ?1 AND title = ?2 AND created_at = ?3 AND is_imported = 1 LIMIT 1",
                        rusqlite::params![resolved_workspace_id, chat_data.title, chat_data.created_at],
                        |_| Ok(true),
                    ).unwrap_or(false);

                    // Message content hash fallback
                    if !duplicate {
                        let mut stmt = conn.prepare(
                            "SELECT id FROM chat_sessions WHERE workspace_id = ?1 AND title = ?2 AND is_imported = 1"
                        ).map_err(|e| e.to_string())?;

                        let candidate_ids = stmt.query_map(
                            rusqlite::params![resolved_workspace_id, chat_data.title],
                            |row| row.get::<_, String>(0)
                        ).map_err(|e| e.to_string())?
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|e| e.to_string())?;

                        let incoming_hash = compute_chat_content_hash(&chat_data.messages);

                        for cid in candidate_ids {
                            let mut msg_stmt = conn.prepare(
                                "SELECT role, content FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
                            ).map_err(|e| e.to_string())?;

                            let existing_messages = msg_stmt.query_map(
                                rusqlite::params![cid],
                                |r| {
                                    let role: String = r.get(0)?;
                                    let content: String = r.get(1)?;
                                    Ok(chat_file_store::ChatFileMessage {
                                        id: String::new(),
                                        role,
                                        content,
                                        model: None,
                                        tokens_used: None,
                                        duration_ms: None,
                                        timestamp: String::new(),
                                    })
                                }
                            ).map_err(|e| e.to_string())?
                            .collect::<Result<Vec<_>, _>>()
                            .map_err(|e| e.to_string())?;

                            let candidate_hash = compute_chat_content_hash(&existing_messages);
                            if incoming_hash == candidate_hash {
                                duplicate = true;
                                break;
                            }
                        }
                    }

                    if duplicate {
                        skipped += 1;
                        continue;
                    }

                    match chat_file_store::import_chat_data(&conn, &chat_data, &resolved_workspace_id, "") {
                        Ok(sid) => {
                            session_ids.push(sid);
                        }
                        Err(e) => {
                            errors.push(format!("{}: {e}", chat_data.title));
                        }
                    }
                }
                Err(e) => {
                    errors.push(format!("{}: {e}", conv.title.unwrap_or_else(|| "Untitled".to_string())));
                }
            }
        }

        // Write to disk for file-based consistency (best-effort)
        for id in &session_ids {
            let _ = chat_file_store::write_session_file(&conn, &chats_dir, id, passphrase.as_deref());
        }

        Ok(serde_json::json!({
            "imported_sessions": session_ids.len(),
            "skipped": skipped,
            "workspace_id": resolved_workspace_id,
            "errors": errors.len(),
            "error_messages": errors.iter().take(10).cloned().collect::<Vec<_>>(),
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Detect the format of a Claude Desktop export folder.
/// Returns "legacy" if `projects.json` is present, "v2" if `projects/` directory is present.
#[tauri::command]
pub async fn detect_claude_format(folder_path: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
    detect_claude_format_inner(folder_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn detect_claude_format_inner(folder_path: String) -> Result<serde_json::Value, String> {
    let folder = validate_user_path(&folder_path, true)?;
    if !folder.is_dir() {
        return Err("Selected path is not a folder.".to_string());
    }
    let has_projects_dir = folder.join("projects").is_dir();
    let has_projects_json = folder.join("projects.json").is_file();
    let has_conversations = folder.join("conversations.json").is_file();

    let format = if has_projects_dir {
        "v2"
    } else if has_projects_json || has_conversations {
        "legacy"
    } else {
        return Err(
            "Selected folder is not a recognised Claude Desktop export. \
             Looking for conversations.json and either projects.json or a projects/ directory."
                .to_string(),
        );
    };

    Ok(serde_json::json!({
        "format": format,
        "files_found": {
            "conversations": has_conversations,
            "projects": has_projects_json || has_projects_dir,
            "memories": folder.join("memories.json").is_file(),
        }
    }))
}

/// Preview a Claude Desktop export folder. Auto-detects v2 vs legacy format.
#[tauri::command]
pub async fn preview_claude_files(
    folder_path: String,
    include_conversations: bool,
    include_projects: bool,
    include_memories: bool,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {

    use chat_file_store::claude_v2;

    let folder = validate_user_path(&folder_path, true)?;
    if !folder.is_dir() {
        return Err("Selected path is not a folder.".to_string());
    }

    let is_v2 = folder.join("projects").is_dir();

    if is_v2 {
        // ── v2 format ────────────────────────────────────────────────────────
        // 1. Load project name map (needed for memory resolution)
        let project_name_map = claude_v2::load_v2_project_name_map(&folder);

        // 2. Preview design_chats grouped by project UUID
        let convs_by_project = if include_conversations || include_projects {
            claude_v2::preview_v2_design_chats(&folder)?
        } else {
            std::collections::HashMap::new()
        };

        // 3. Orphan conversations from conversations.json
        let orphan_conversations =
            if include_conversations && folder.join("conversations.json").is_file() {
                let bytes = std::fs::read(folder.join("conversations.json"))
                    .map_err(|e| format!("Failed to read conversations.json: {e}"))?;
                chat_file_store::preview_claude_conversations(&bytes)?
            } else {
                Vec::new()
            };

        // 4. Memories
        let (memory_uuids, memories) = if include_memories {
            claude_v2::parse_v2_memories(&folder, &project_name_map)?
        } else {
            (
                std::collections::HashSet::new(),
                chat_file_store::ClaudeMemoryPreview {
                    conversations_memory: String::new(),
                    folder_memories: Vec::new(),
                },
            )
        };

        // 5. Projects with conversation_count + has_memory populated
        let projects = if include_projects {
            claude_v2::preview_v2_projects(&folder, &memory_uuids, &convs_by_project)?
        } else {
            Vec::new()
        };

        let orphan_count = orphan_conversations.len();

        // Per-project memory map (uuid → memory text), used both by the matcher
        // and by the UI's inline memory preview.
        let memories_by_project: std::collections::HashMap<String, String> = memories
            .folder_memories
            .iter()
            .map(|m| (m.project_uuid.clone(), m.memory.clone()))
            .collect();

        // Suggest a project for each orphan (keyword matcher; user can request
        // embedding-based matching separately via match_claude_with_embeddings).
        let suggestions = if include_conversations && !projects.is_empty() {
            chat_file_store::claude_v2_match::suggest_project_for_conversations(
                &orphan_conversations,
                &projects,
                &memories_by_project,
            )
        } else {
            Vec::new()
        };

        Ok(serde_json::json!({
            "format": "v2",
            "folders": projects,
            "conversations_by_project": convs_by_project,
            "orphan_conversations": orphan_conversations,
            "orphan_count": orphan_count,
            "memories": if include_memories { Some(memories) } else { None },
            "memories_by_project": if include_memories { Some(memories_by_project) } else { None },
            "suggestions": suggestions,
            "files_found": {
                "conversations": folder.join("conversations.json").is_file(),
                "projects": folder.join("projects").is_dir(),
                "memories": folder.join("memories.json").is_file(),
            }
        }))
    } else {
        // ── legacy format ────────────────────────────────────────────────────
        let read_file = |name: &str| -> Result<Option<Vec<u8>>, String> {
            let p = folder.join(name);
            if !p.is_file() {
                return Ok(None);
            }
            std::fs::read(&p)
                .map(Some)
                .map_err(|e| format!("Failed to read {name}: {e}"))
        };

        let conv_bytes = if include_conversations {
            read_file("conversations.json")?
        } else {
            None
        };
        let proj_bytes = if include_projects {
            read_file("projects.json")?
        } else {
            None
        };
        let mem_bytes = if include_memories {
            read_file("memories.json")?
        } else {
            None
        };

        let all_conversations = conv_bytes
            .as_deref()
            .map(chat_file_store::preview_claude_conversations)
            .transpose()?
            .unwrap_or_default();

        let mut claude_projects = proj_bytes
            .as_deref()
            .map(chat_file_store::preview_claude_projects)
            .transpose()?
            .unwrap_or_default();

        let memories = mem_bytes
            .as_deref()
            .map(|b| chat_file_store::preview_claude_memories(b, proj_bytes.as_deref()))
            .transpose()?;

        // Build conversations_by_project and enrich projects with counts + has_memory
        let mut convs_by_project: std::collections::HashMap<String, Vec<_>> =
            std::collections::HashMap::new();
        let mut orphan_conversations = Vec::new();
        for conv in &all_conversations {
            match &conv.project_uuid {
                Some(uuid) => convs_by_project
                    .entry(uuid.clone())
                    .or_default()
                    .push(conv.clone()),
                None => orphan_conversations.push(conv.clone()),
            }
        }

        let memory_uuid_set: std::collections::HashSet<String> = memories
            .as_ref()
            .map(|m| {
                m.folder_memories
                    .iter()
                    .map(|fm| fm.project_uuid.clone())
                    .collect()
            })
            .unwrap_or_default();

        for p in &mut claude_projects {
            p.conversation_count = convs_by_project.get(&p.uuid).map(|v| v.len()).unwrap_or(0);
            p.has_memory = memory_uuid_set.contains(&p.uuid);
        }

        let orphan_count = orphan_conversations.len();

        let memories_by_project: std::collections::HashMap<String, String> = memories
            .as_ref()
            .map(|m| {
                m.folder_memories
                    .iter()
                    .map(|fm| (fm.project_uuid.clone(), fm.memory.clone()))
                    .collect()
            })
            .unwrap_or_default();

        let suggestions = if include_conversations && !claude_projects.is_empty() {
            chat_file_store::claude_v2_match::suggest_project_for_conversations(
                &orphan_conversations,
                &claude_projects,
                &memories_by_project,
            )
        } else {
            Vec::new()
        };

        Ok(serde_json::json!({
            "format": "legacy",
            "folders": claude_projects,
            "conversations_by_project": convs_by_project,
            "orphan_conversations": orphan_conversations,
            "orphan_count": orphan_count,
            "memories": memories,
            "memories_by_project": if include_memories { Some(memories_by_project) } else { None },
            "suggestions": suggestions,
            "files_found": {
                "conversations": folder.join("conversations.json").is_file(),
                "projects": folder.join("projects.json").is_file(),
                "memories": folder.join("memories.json").is_file(),
            }
        }))
    }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Re-run project matching for a set of orphan conversations using Ollama
/// embeddings. Called on demand from the import UI — the scan completes with
/// keyword suggestions first; the user can then request a more accurate pass.
///
/// `conversations` is a list of `{ uuid, name, first_user_message }` objects.
/// `projects` is a list of `{ uuid, name, prompt_template, description }` objects.
/// `memories_by_project` maps project UUID → memory text.
#[tauri::command]
pub async fn match_claude_with_embeddings(
    conversations: Vec<serde_json::Value>,
    projects: Vec<serde_json::Value>,
    memories_by_project: std::collections::HashMap<String, String>,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    use crate::services::model_settings::get_embedding_model;
    use chat_file_store::{ClaudeConversationPreview, ClaudeProjectPreview};

    let embedding_model = {
        let conn = db_state.0.get().map_err(|e| e.to_string())?;
        get_embedding_model(&conn)
            .ok_or("No embedding model configured. Set one in Settings → AI Models.")?
    };

    let ollama = crate::ollama::client::OllamaClient::new(None)?;

    // Deserialise lightweight conversation and project summaries from the frontend.
    let conv_previews: Vec<ClaudeConversationPreview> = conversations
        .iter()
        .filter_map(|v| {
            Some(ClaudeConversationPreview {
                uuid: v["uuid"].as_str()?.to_string(),
                name: v["name"].as_str().unwrap_or("").to_string(),
                message_count: 0,
                created_at: String::new(),
                updated_at: String::new(),
                project_uuid: None,
                first_user_message: v["first_user_message"].as_str().unwrap_or("").to_string(),
                messages: Vec::new(),
            })
        })
        .collect();

    let proj_previews: Vec<ClaudeProjectPreview> = projects
        .iter()
        .filter_map(|v| {
            Some(ClaudeProjectPreview {
                uuid: v["uuid"].as_str()?.to_string(),
                name: v["name"].as_str().unwrap_or("").to_string(),
                description: v["description"].as_str().unwrap_or("").to_string(),
                has_prompt: false,
                doc_count: 0,
                conversation_count: 0,
                has_memory: false,
                prompt_template: v["prompt_template"].as_str().unwrap_or("").to_string(),
            })
        })
        .collect();

    let suggestions = chat_file_store::claude_v2_match::suggest_project_with_embeddings(
        &conv_previews,
        &proj_previews,
        &memories_by_project,
        &ollama,
        &embedding_model,
    )
    .await;

    Ok(serde_json::json!(suggestions))
}

/// Import Claude Desktop conversations and memories from a folder.
/// The frontend resolves destinations (creates workspaces/folders) before calling this —
/// the backend is a pure inserter that accepts pre-resolved folder IDs.
///
/// - `folder_mappings`: claude project_uuid → aetherium folder_id
/// - `project_memory_targets`: claude project_uuid → aetherium folder_id (subset of above)
/// - `orphans_folder_id`: folder to place conversations that have no project mapping
/// - `selected_conversation_ids`: only import these conversation UUIDs (empty = all)
/// - `selected_project_ids`: only import project chats from these project UUIDs (empty = all in folder_mappings)
#[allow(clippy::too_many_arguments)]
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn import_claude_files(
    folder_path: String,
    folder_mappings: std::collections::HashMap<String, String>,
    project_memory_targets: std::collections::HashMap<String, String>,
    orphans_folder_id: Option<String>,
    selected_conversation_ids: Option<Vec<String>>,
    selected_project_ids: Option<Vec<String>>,
    // chat_uuid → claude project_uuid. Routes an otherwise-orphan chat into
    // the folder mapped to that project (must also appear in folder_mappings).
    chat_project_overrides: Option<std::collections::HashMap<String, String>>,
    // Re-import behavior — see `import_lmstudio_folder` for the semantics.
    merge_existing: Option<bool>,
    clone_edited: Option<bool>,
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let chats_dir = chats_dir_state.0.clone();
    let passphrase = crypto.0.lock().ok().and_then(|g| g.clone());
    let pool = db_state.0.clone();
    tokio::task::spawn_blocking(move || {
    use chat_file_store::claude_v2;

    let merge_existing = merge_existing.unwrap_or(false);
    let clone_edited = clone_edited.unwrap_or(false);

    let conn = pool.get().map_err(|e| e.to_string())?;
    let folder = validate_user_path(&folder_path, true)?;
    if !folder.is_dir() {
        return Err("Selected path is not a folder.".to_string());
    }

    let is_v2 = folder.join("projects").is_dir();
    let now = chrono::Utc::now().to_rfc3339();

    let mut session_ids = Vec::new();
    let mut errors = Vec::new();
    let mut skipped = 0usize;
    let mut appended_sessions = 0usize;
    let mut appended_messages = 0usize;
    let mut cloned = 0usize;

    let overrides = chat_project_overrides.unwrap_or_default();

    // Helper: insert one conversation. Routing precedence:
    //   1. embedded project_uuid → folder_mappings
    //   2. chat_project_overrides[chat.id] → folder_mappings
    //   3. orphans_folder_id (fallback)
    let mut insert_chat =
        |data: &chat_file_store::ChatFileData, project_uuid: Option<&str>| -> Result<(), String> {
            let folder_id = if let Some(uuid) = project_uuid {
                folder_mappings.get(uuid).cloned().unwrap_or_default()
            } else if let Some(target_project) = overrides.get(&data.id) {
                folder_mappings
                    .get(target_project)
                    .cloned()
                    .unwrap_or_default()
            } else {
                orphans_folder_id.clone().unwrap_or_default()
            };
            if folder_id.is_empty() {
                return Ok(()); // no destination → skip
            }
            // Look up workspace_id from folder
            let workspace_id: String = conn
                .query_row(
                    "SELECT workspace_id FROM folders WHERE id = ?1",
                    rusqlite::params![folder_id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("Folder {} not found: {e}", folder_id))?;

            // Dedup by (workspace, folder, title, created_at) on imported sessions.
            // (The historical `WHERE id = data.id` check was a no-op because
            // `import_chat_data` always generates a fresh chat_sessions.id.)
            let existing_session_id: Option<String> = conn
                .query_row(
                    "SELECT id FROM chat_sessions WHERE workspace_id = ?1 AND folder_id = ?2 AND title = ?3 AND created_at = ?4 AND is_imported = 1 LIMIT 1",
                    rusqlite::params![workspace_id, folder_id, data.title, data.created_at],
                    |row| row.get::<_, String>(0),
                )
                .ok();

            if let Some(existing) = existing_session_id {
                if !merge_existing {
                    skipped += 1;
                    return Ok(());
                }
                match chat_file_store::reconcile_chat_data(&conn, data, &existing) {
                    Ok(chat_file_store::ReconcileOutcome::Identical) => {
                        skipped += 1;
                        return Ok(());
                    }
                    Ok(chat_file_store::ReconcileOutcome::Appended { new }) => {
                        appended_messages += new;
                        appended_sessions += 1;
                        session_ids.push(existing);
                        return Ok(());
                    }
                    Ok(chat_file_store::ReconcileOutcome::Edited) => {
                        if !clone_edited {
                            skipped += 1;
                            return Ok(());
                        }
                        cloned += 1;
                        // Fall through to import as a fresh session (new uuid).
                    }
                    Err(e) => {
                        errors.push(format!("{}: reconcile failed: {e}", data.title));
                        return Ok(());
                    }
                }
            }

            match chat_file_store::import_chat_data(&conn, data, &workspace_id, &folder_id) {
                Ok(sid) => session_ids.push(sid),
                Err(e) => errors.push(format!("{}: {e}", data.title)),
            }
            Ok(())
        };

    if is_v2 {
        // Import project chats from design_chats/
        let proj_ids: Vec<String> =
            selected_project_ids.unwrap_or_else(|| folder_mappings.keys().cloned().collect());
        // All design_chats for selected projects
        let design_chats = claude_v2::parse_v2_design_chats_filtered(&folder, &[])?;
        for (data, project_uuid) in &design_chats {
            if let Some(uuid) = project_uuid.as_deref() {
                if !proj_ids.contains(&uuid.to_string()) {
                    continue;
                }
            }
            insert_chat(data, project_uuid.as_deref())?;
        }

        // Import orphan conversations from conversations.json
        let conv_path = folder.join("conversations.json");
        if conv_path.is_file() && orphans_folder_id.is_some() {
            let bytes = std::fs::read(&conv_path)
                .map_err(|e| format!("Failed to read conversations.json: {e}"))?;
            let orphans = chat_file_store::parse_claude_conversations_filtered(
                &bytes,
                selected_conversation_ids.as_deref().unwrap_or(&[]),
            )?;
            for (data, _) in &orphans {
                insert_chat(data, None)?;
            }
        }
    } else {
        // Legacy format: conversations.json with optional project_uuid on each
        let conv_path = folder.join("conversations.json");
        if conv_path.is_file() {
            let bytes = std::fs::read(&conv_path)
                .map_err(|e| format!("Failed to read conversations.json: {e}"))?;
            let convs = chat_file_store::parse_claude_conversations_filtered(
                &bytes,
                selected_conversation_ids.as_deref().unwrap_or(&[]),
            )?;
            for (data, project_uuid) in &convs {
                insert_chat(data, project_uuid.as_deref())?;
            }
        }
    }

    let pass = passphrase;
    for id in &session_ids {
        let _ = chat_file_store::write_session_file(&conn, &chats_dir, id, pass.as_deref());
    }

    // Import per-project memories
    let mut memories_imported = 0usize;
    if !project_memory_targets.is_empty() {
        let mem_path = folder.join("memories.json");
        if mem_path.is_file() {
            let mem_bytes = std::fs::read(&mem_path)
                .map_err(|e| format!("Failed to read memories.json: {e}"))?;

            // Determine which memory key to use based on format
            if is_v2 {
                let name_map = claude_v2::load_v2_project_name_map(&folder);
                let (_, preview) = claude_v2::parse_v2_memories(&folder, &name_map)?;
                for pm in &preview.folder_memories {
                    if let Some(folder_id) = project_memory_targets.get(&pm.project_uuid) {
                        let workspace_id: String = conn
                            .query_row(
                                "SELECT workspace_id FROM folders WHERE id = ?1",
                                rusqlite::params![folder_id],
                                |row| row.get(0),
                            )
                            .map_err(|e| format!("Folder {folder_id} not found: {e}"))?;
                        let mem_id = uuid::Uuid::new_v4().to_string();
                        conn.execute(
                            "INSERT INTO memories (id, workspace_id, folder_id, content, memory_type, scope, is_pinned, is_active, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, 'context', 'workspace', 0, 1, ?5, ?5)",
                            rusqlite::params![mem_id, workspace_id, folder_id, pm.memory, now],
                        ).map_err(|e| e.to_string())?;
                        memories_imported += 1;
                    }
                }
            } else {
                let proj_bytes = folder
                    .join("projects.json")
                    .is_file()
                    .then(|| std::fs::read(folder.join("projects.json")).ok())
                    .flatten();
                if let Ok(preview) =
                    chat_file_store::preview_claude_memories(&mem_bytes, proj_bytes.as_deref())
                {
                    for pm in &preview.folder_memories {
                        if let Some(folder_id) = project_memory_targets.get(&pm.project_uuid) {
                            let workspace_id: String = conn
                                .query_row(
                                    "SELECT workspace_id FROM folders WHERE id = ?1",
                                    rusqlite::params![folder_id],
                                    |row| row.get(0),
                                )
                                .map_err(|e| format!("Folder {folder_id} not found: {e}"))?;
                            let mem_id = uuid::Uuid::new_v4().to_string();
                            conn.execute(
                                "INSERT INTO memories (id, workspace_id, folder_id, content, memory_type, scope, is_pinned, is_active, created_at, updated_at)
                                 VALUES (?1, ?2, ?3, ?4, 'context', 'workspace', 0, 1, ?5, ?5)",
                                rusqlite::params![mem_id, workspace_id, folder_id, pm.memory, now],
                            ).map_err(|e| e.to_string())?;
                            memories_imported += 1;
                        }
                    }
                }
            }
        }
    }

    Ok(serde_json::json!({
        "imported": session_ids.len(),
        "skipped": skipped,
        "appended_sessions": appended_sessions,
        "appended_messages": appended_messages,
        "cloned": cloned,
        "memories_imported": memories_imported,
        "errors": errors.len(),
        "error_messages": errors.iter().take(10).cloned().collect::<Vec<_>>(),
    }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Sync every session in the DB to the chats directory.
/// Useful after a cold start to ensure files are up to date.
#[tauri::command]
pub async fn sync_all_chats_to_files(
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<usize, String> {
    let chats_dir = chats_dir_state.0.clone();
    let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
    let pool = db_state.0.clone();
    tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(|e| e.to_string())?;
        sync_all_to_files_internal(&conn, &chats_dir, pass.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
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

#[cfg(test)]
mod tests {

    #[test]
    fn test_uri_escaping() {
        // Test with actual characters that need escaping in GVariant string literals
        let file_uri = "file:///tmp/test%20%22quote%22%20%5Cback.txt";
        let escaped_uri = file_uri.replace('\\', "\\\\").replace('"', "\\\"");

        assert_eq!(escaped_uri, "file:///tmp/test%20%22quote%22%20%5Cback.txt");

        let file_uri_with_special = "file:///path/with\"quote\\backslash";
        let escaped_uri = file_uri_with_special
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        assert_eq!(escaped_uri, "file:///path/with\\\"quote\\\\backslash");
    }
}
