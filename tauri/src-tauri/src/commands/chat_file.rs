//! Tauri commands for file-based chat storage and optional encryption.

use crate::commands::security::{require_auth, require_auth_for_destructive_ops, AuthState};
use crate::db::DbState;
use crate::models::chat::ChatSession;
use crate::services::chat_file_store;
use serde::Serialize;
use std::process::Command;
use tauri::{AppHandle, Emitter, Runtime, State};

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
    require_auth_for_destructive_ops(&auth, &db_state)?;
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
    auth: State<'_, AuthState>,
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
    require_auth_for_destructive_ops(&auth, &db_state)?;
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
    auth: State<'_, AuthState>,
    folder_paths: Vec<String>,
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    require_auth_for_destructive_ops(&auth, &db_state)?;
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
    auth: State<'_, AuthState>,
    file_path: String,
    workspace_name: Option<String>,
    selected_ids: Option<Vec<String>>,
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    require_auth_for_destructive_ops(&auth, &db_state)?;
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

    // Find or create subworkspace (folder) "Gemini"
    let folder_name = "Gemini";
    let existing_folder_id: Option<String> = conn
        .query_row(
            "SELECT id FROM folders WHERE workspace_id = ?1 AND lower(trim(name)) = lower(trim(?2)) AND is_deleted = 0 LIMIT 1",
            rusqlite::params![workspace_id, folder_name],
            |row| row.get(0),
        )
        .ok();

    let folder_id = if let Some(id) = existing_folder_id {
        id
    } else {
        let new_folder_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO folders (id, workspace_id, name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            rusqlite::params![new_folder_id, workspace_id, folder_name, now],
        ).map_err(|e| e.to_string())?;
        new_folder_id
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

        // Duplicate detection: same title + created_at in same workspace & folder
        let duplicate: bool = conn.query_row(
            "SELECT 1 FROM chat_sessions WHERE workspace_id = ?1 AND folder_id = ?2 AND title = ?3 AND created_at = ?4 AND is_imported = 1 LIMIT 1",
            rusqlite::params![workspace_id, folder_id, data.title, data.created_at],
            |_| Ok(true),
        ).unwrap_or(false);

        if duplicate {
            skipped += 1;
            continue;
        }

        match chat_file_store::import_chat_data(&conn, data, &workspace_id, &folder_id) {
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
        "folder_id": folder_id,
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
    auth: State<'_, AuthState>,
    folder_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    selected_ids: Option<Vec<String>>,
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    require_auth_for_destructive_ops(&auth, &db_state)?;
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

    // Probe the memories layout rather than inferring it from the format: a
    // hand-extracted export can pair v3 memories with an otherwise v2-looking
    // tree, and reading the wrong path loses memories silently.
    let memories_source = chat_file_store::claude_v2::find_memories_source(&folder);
    let has_memories_dir = matches!(
        memories_source,
        Some(chat_file_store::claude_v2::MemoriesSource::Directory(_))
    );

    // v3 (2026-08-30) is v2's tree with memories/<uuid>.json in place of
    // memories.json. Everything else about the two is byte-identical.
    let format = if has_projects_dir && has_memories_dir {
        "v3"
    } else if has_projects_dir {
        "v2"
    } else if has_projects_json || has_conversations {
        "legacy"
    } else {
        return Err(
            "Selected folder is not a recognised Claude Desktop export. \
             Looking for conversations.json and either projects.json or a projects/ directory. \
             If you have a set of export .zip files, unpack them into a single folder first."
                .to_string(),
        );
    };

    // A split export (conversations-001.zip and friends) merged by hand can
    // silently drop parts — one conversations.json overwrites the other. Flag
    // any leftover part-numbered file so the user can be warned.
    let has_split_parts = std::fs::read_dir(&folder)
        .map(|entries| {
            entries.flatten().any(|e| {
                e.file_name()
                    .to_str()
                    .and_then(|n| n.rsplit_once('-'))
                    .and_then(|(_, tail)| tail.split('.').next())
                    .is_some_and(|part| part.len() == 3 && part.chars().all(|c| c.is_ascii_digit()) && part != "000")
            })
        })
        .unwrap_or(false);

    Ok(serde_json::json!({
        "format": format,
        "files_found": {
            "conversations": has_conversations,
            "projects": has_projects_json || has_projects_dir,
            "memories": memories_source.is_some(),
        },
        "has_split_parts": has_split_parts,
    }))
}

/// Preview a Claude Desktop export folder. Auto-detects v2 vs legacy format.
/// Read the persisted matcher strictness ("strict" | "balanced" | "loose",
/// stored JSON-encoded by `update_setting`) and map it to a runner-up margin.
/// Missing or malformed values fall back to "balanced".
fn read_match_strictness(conn: &rusqlite::Connection) -> (String, f32) {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'import.match_strictness'",
            [],
            |row| row.get(0),
        )
        .ok();
    let strictness: String = raw
        .and_then(|v| serde_json::from_str::<String>(&v).ok())
        .unwrap_or_else(|| "balanced".to_string());
    let margin = chat_file_store::claude_v2_match::margin_for_strictness(&strictness);
    (strictness, margin)
}

#[tauri::command]
pub async fn preview_claude_files(
    folder_path: String,
    include_conversations: bool,
    include_projects: bool,
    include_memories: bool,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let pool = db_state.0.clone();
    tokio::task::spawn_blocking(move || {

    use chat_file_store::claude_v2;
    use chat_file_store::import_links::{self, SOURCE_CLAUDE};

    let folder = validate_user_path(&folder_path, true)?;
    if !folder.is_dir() {
        return Err("Selected path is not a folder.".to_string());
    }

    // Previously imported chats (by Claude conversation UUID) and remembered
    // destinations — two batched queries. Linked chats bypass the matcher and
    // the review UI, EXCEPT those still sitting in the unassigned area, which
    // re-enter matching every round; destinations pre-fill the pickers.
    let conn = pool.get().map_err(|e| e.to_string())?;
    let all_links = import_links::load_links(&conn, SOURCE_CLAUDE)?;
    let known_destinations = import_links::load_destinations(&conn, SOURCE_CLAUDE)?;
    let (match_strictness, match_margin) = read_match_strictness(&conn);
    drop(conn);
    let orphans_dest = known_destinations.get(import_links::ORPHANS_KEY);

    let is_v2 = folder.join("projects").is_dir();
    // Stage timings, logged once per scan. The conversations parse dominates
    // on large exports; measure before optimising it.
    let scan_started = std::time::Instant::now();

    if is_v2 {
        // ── v2 format ────────────────────────────────────────────────────────
        // 1. Load project name map (needed for memory resolution)
        let project_name_map = claude_v2::load_v2_project_name_map(&folder);

        // 2. Preview design_chats grouped by project UUID
        let (convs_by_project, skipped_empty_design) = if include_conversations || include_projects
        {
            claude_v2::preview_v2_design_chats(&folder)?
        } else {
            (std::collections::HashMap::new(), 0)
        };

        // 3. Orphan conversations from conversations.json
        let convs_started = std::time::Instant::now();
        let (orphan_conversations, skipped_empty_orphans) =
            if include_conversations && folder.join("conversations.json").is_file() {
                let bytes = std::fs::read(folder.join("conversations.json"))
                    .map_err(|e| format!("Failed to read conversations.json: {e}"))?;
                chat_file_store::preview_claude_conversations(&bytes)?
            } else {
                (Vec::new(), 0)
            };
        let skipped_empty = skipped_empty_design + skipped_empty_orphans;
        let convs_ms = convs_started.elapsed().as_millis();

        // 4. Memories
        //
        // Always resolve which projects *have* memory, even when the user has
        // not asked to import it: `has_memory` describes the export, and the
        // UI renders "(none in export)" from it. Gating it on include_memories
        // made every project claim to have no memory whenever the toggle was
        // off. Only the memory *content* is withheld.
        let (memory_uuids, memories) = {
            let (uuids, preview) = claude_v2::parse_v2_memories(&folder, &project_name_map)?;
            if include_memories {
                (uuids, preview)
            } else {
                (
                    uuids,
                    chat_file_store::ClaudeMemoryPreview {
                        conversations_memory: String::new(),
                        folder_memories: Vec::new(),
                    },
                )
            }
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

        // Already-imported chats present in this export (orphans + project
        // chats). Chats still sitting in the unassigned area go into
        // linked_unassigned instead: they stay matcher-eligible each round.
        let mut linked_conversations = std::collections::HashMap::new();
        let mut linked_unassigned = std::collections::HashMap::new();
        for conv in &orphan_conversations {
            if let Some(info) = all_links.get(&conv.uuid) {
                if import_links::is_unassigned_location(info, orphans_dest) {
                    linked_unassigned.insert(conv.uuid.clone(), info.clone());
                } else {
                    linked_conversations.insert(conv.uuid.clone(), info.clone());
                }
            }
        }
        for convs in convs_by_project.values() {
            for conv in convs {
                if let Some(info) = all_links.get(&conv.uuid) {
                    linked_conversations.insert(conv.uuid.clone(), info.clone());
                }
            }
        }

        // Suggest a project for each matcher-eligible orphan (keyword matcher;
        // the user can request AI matching separately). Linked orphans already
        // have a home — the matcher never sees them — except linked-unassigned
        // ones, which get re-suggested every round.
        let unlinked_orphans: Vec<_> = orphan_conversations
            .iter()
            .filter(|c| !linked_conversations.contains_key(&c.uuid))
            .cloned()
            .collect();
        let suggestions = if include_conversations && !projects.is_empty() {
            // Projects the export gave no text for get a recap from their own
            // conversations so the scan-time keyword matcher isn't left with
            // just the project name. The recap stays out of the returned
            // `folders` — it must not leak into created workspace descriptions.
            let match_projects = chat_file_store::claude_v2_match::recap_textless_projects(
                &projects,
                &memories_by_project,
                &convs_by_project,
            );
            chat_file_store::claude_v2_match::suggest_project_for_conversations_with_options(
                &unlinked_orphans,
                &match_projects,
                &memories_by_project,
                &std::collections::HashMap::new(),
                match_margin,
            )
        } else {
            Vec::new()
        };

        eprintln!(
            "[import] claude scan: {} conversations parsed in {}ms, {} projects, \
             total {}ms",
            orphan_count,
            convs_ms,
            projects.len(),
            scan_started.elapsed().as_millis()
        );

        Ok(serde_json::json!({
            // v3 parses through the v2 path — the trees are identical apart
            // from the memories layout, which parse_v2_memories probes for.
            "format": if matches!(
                claude_v2::find_memories_source(&folder),
                Some(claude_v2::MemoriesSource::Directory(_))
            ) { "v3" } else { "v2" },
            "folders": projects,
            "conversations_by_project": convs_by_project,
            "orphan_conversations": orphan_conversations,
            "orphan_count": orphan_count,
            "skipped_empty": skipped_empty,
            "memories": if include_memories { Some(memories) } else { None },
            "memories_by_project": if include_memories { Some(memories_by_project) } else { None },
            "suggestions": suggestions,
            "linked_conversations": linked_conversations,
            "linked_unassigned": linked_unassigned,
            "known_destinations": known_destinations,
            "match_strictness": match_strictness,
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
        // Always read memories so `has_memory` can describe the export
        // truthfully; the include flag controls what is *returned* below, not
        // whether we know the memory exists. See the v2 branch for the same
        // reasoning.
        let mem_bytes = read_file("memories.json")?;

        let (all_conversations, skipped_empty) = conv_bytes
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

        // Already-imported chats present in this export. Chats still sitting in
        // the unassigned area go into linked_unassigned instead: they stay
        // matcher-eligible each round.
        let mut linked_conversations = std::collections::HashMap::new();
        let mut linked_unassigned = std::collections::HashMap::new();
        for conv in &all_conversations {
            if let Some(info) = all_links.get(&conv.uuid) {
                if conv.project_uuid.is_none()
                    && import_links::is_unassigned_location(info, orphans_dest)
                {
                    linked_unassigned.insert(conv.uuid.clone(), info.clone());
                } else {
                    linked_conversations.insert(conv.uuid.clone(), info.clone());
                }
            }
        }

        // Linked orphans already have a home — the matcher never sees them —
        // except linked-unassigned ones, which get re-suggested every round.
        let unlinked_orphans: Vec<_> = orphan_conversations
            .iter()
            .filter(|c| !linked_conversations.contains_key(&c.uuid))
            .cloned()
            .collect();
        let suggestions = if include_conversations && !claude_projects.is_empty() {
            // Same recap as the v2 branch: text-less projects match on a
            // digest of their own conversations instead of just their name.
            let match_projects = chat_file_store::claude_v2_match::recap_textless_projects(
                &claude_projects,
                &memories_by_project,
                &convs_by_project,
            );
            chat_file_store::claude_v2_match::suggest_project_for_conversations_with_options(
                &unlinked_orphans,
                &match_projects,
                &memories_by_project,
                &std::collections::HashMap::new(),
                match_margin,
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
            "skipped_empty": skipped_empty,
            "memories": if include_memories { memories } else { None },
            "memories_by_project": if include_memories { Some(memories_by_project) } else { None },
            "suggestions": suggestions,
            "linked_conversations": linked_conversations,
            "linked_unassigned": linked_unassigned,
            "known_destinations": known_destinations,
            "match_strictness": match_strictness,
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

/// Propose tentative groups for chats that matched no project.
///
/// Embeds each chat title and clusters semantically, which catches groups that
/// share no vocabulary at all ("Post salah" / "Ju'mah prayer time" / "Mosque
/// prayer timing"). Falls back to lexical title clustering when no embedding
/// model is configured or Ollama is unreachable, so the feature still works
/// offline — just less well.
///
/// Returns `{ clusters, strategy }` where strategy is "embedding" or "lexical".
#[tauri::command]
pub async fn cluster_unmatched_claude_chats<R: Runtime>(
    app: AppHandle<R>,
    conversations: Vec<serde_json::Value>,
    unmatched_uuids: Vec<String>,
    model_override: Option<String>,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    use chat_file_store::{claude_v2_cluster, ClaudeConversationPreview, ClaudeMessagePreview};

    let conv_previews: Vec<ClaudeConversationPreview> = conversations
        .iter()
        .filter_map(|v| {
            let messages = v["messages"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            Some(ClaudeMessagePreview {
                                role: m["role"].as_str()?.to_string(),
                                content: m["content"].as_str().unwrap_or("").to_string(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            Some(ClaudeConversationPreview {
                uuid: v["uuid"].as_str()?.to_string(),
                name: v["name"].as_str().unwrap_or("").to_string(),
                message_count: 0,
                created_at: String::new(),
                updated_at: String::new(),
                project_uuid: None,
                first_user_message: v["first_user_message"].as_str().unwrap_or("").to_string(),
                summary: v["summary"].as_str().unwrap_or("").to_string(),
                messages,
            })
        })
        .collect();

    let unmatched: std::collections::HashSet<String> = unmatched_uuids.into_iter().collect();
    let total_unmatched = conv_previews
        .iter()
        .filter(|c| unmatched.contains(&c.uuid))
        .count();

    emit_cluster_task(
        &app,
        "started",
        &format!("Grouping {total_unmatched} unassigned chats"),
        None,
        None,
        Some(total_unmatched as u32),
    );

    // Resolve the embedding model; absence is not an error — we fall back.
    // Also resolve a chat model for cluster naming (again optional).
    let (embed_model, naming_model) = {
        let conn = db_state.0.get().map_err(|e| e.to_string())?;
        let embed = if let Some(m) = model_override.filter(|s| !s.is_empty()) {
            Some(m)
        } else {
            crate::services::model_settings::get_embedding_model(&conn)
        };
        let naming = crate::services::model_settings::get_configured_background_model(&conn)
            .or_else(|| crate::services::model_settings::get_configured_chat_model(&conn));
        (embed, naming)
    };

    let mut strategy = "lexical";
    let mut embedded = 0usize;
    let mut failed = 0usize;
    let mut clusters: Vec<claude_v2_cluster::ChatCluster> = Vec::new();

    if let Some(model) = embed_model {
        if let Ok(ollama) = crate::ollama::client::OllamaClient::new(None) {
            let mut embeddings: std::collections::HashMap<String, Vec<f32>> =
                std::collections::HashMap::new();
            let mut failures = 0usize;
            let mut done = 0usize;
            for conv in conv_previews.iter().filter(|c| unmatched.contains(&c.uuid)) {
                let input = claude_v2_cluster::embedding_input(conv);
                if input.is_empty() {
                    continue;
                }
                match ollama
                    .generate_embedding_with_options(
                        "claude_import_cluster",
                        &model,
                        &input,
                        Some("5m"),
                    )
                    .await
                {
                    Ok(mut v) => {
                        // Normalise once here so clustering can use a plain dot product.
                        let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
                        if n > 0.0 {
                            for x in v.iter_mut() {
                                *x /= n;
                            }
                            embeddings.insert(conv.uuid.clone(), v);
                        }
                    }
                    Err(_) => {
                        failures += 1;
                        // A few transient failures are fine — those chats just
                        // sit out. A wholesale failure means fall back instead.
                        if failures > 20 && embeddings.is_empty() {
                            break;
                        }
                    }
                }
                done += 1;
                // One Ollama call per chat, serial — minutes at scale, so the
                // status bar must show movement.
                if done.is_multiple_of(10) {
                    emit_cluster_task(
                        &app,
                        "processing",
                        &format!("Embedding chats ({done} of {total_unmatched})"),
                        Some(model.clone()),
                        Some(done as u32),
                        Some(total_unmatched as u32),
                    );
                }
            }

            if !embeddings.is_empty() {
                clusters = claude_v2_cluster::cluster_by_embedding(
                    &conv_previews,
                    &unmatched,
                    &embeddings,
                );
                strategy = "embedding";
                embedded = embeddings.len();
                failed = failures;
            }
        }
    }

    if strategy == "lexical" {
        clusters = claude_v2_cluster::cluster_unmatched(&conv_previews, &unmatched);
    }

    // Name the proposed groups with one batched LLM call. Degrades, never
    // fails: any cluster the response doesn't cover keeps a lexical name.
    let mut names_generated = 0usize;
    for cluster in clusters.iter_mut() {
        cluster.label =
            claude_v2_cluster::workspace_name_from_terms(&cluster.terms, &cluster.label);
    }
    if !clusters.is_empty() {
        if let Some(model) = naming_model {
            if let Ok(ollama) = crate::ollama::client::OllamaClient::new(None) {
                emit_cluster_task(
                    &app,
                    "processing",
                    &format!("Naming {} proposed groups", clusters.len()),
                    Some(model.clone()),
                    None,
                    None,
                );
                let titles_by_uuid: std::collections::HashMap<String, &str> = conv_previews
                    .iter()
                    .map(|c| (c.uuid.clone(), c.name.as_str()))
                    .collect();
                let prompt = claude_v2_cluster::naming_prompt(&clusters, &titles_by_uuid);
                let messages = vec![crate::ollama::client::OllamaMessage {
                    role: "user".to_string(),
                    content: prompt,
                }];
                if let Ok(reply) = ollama
                    .send_message_with_options("claude_import_cluster", &model, messages, Some("5m"))
                    .await
                {
                    let names = claude_v2_cluster::parse_cluster_names(&reply, clusters.len());
                    for (cluster, name) in clusters.iter_mut().zip(names) {
                        if let Some(name) = name {
                            cluster.label = name;
                            names_generated += 1;
                        }
                    }
                }
            }
        }
    }

    emit_cluster_task(
        &app,
        "completed",
        &format!("Proposed {} groups from {total_unmatched} unassigned chats", clusters.len()),
        None,
        None,
        None,
    );

    Ok(serde_json::json!({
        "clusters": clusters,
        "strategy": strategy,
        "embedded": embedded,
        "failed": failed,
        "names_generated": names_generated,
    }))
}

/// Emit a `background-task` event for the clustering job (same shape as
/// `emit_match_task`, distinct task type so the status bar can label it).
fn emit_cluster_task<R: Runtime>(
    app: &AppHandle<R>,
    status: &str,
    message: &str,
    model: Option<String>,
    current: Option<u32>,
    total: Option<u32>,
) {
    let _ = app.emit(
        "background-task",
        crate::services::background_scheduler::BackgroundTaskEvent {
            task_type: "claude_import_cluster".to_string(),
            status: status.to_string(),
            message: message.to_string(),
            model,
            workspace_id: None,
            current,
            total,
            current_task_type: None,
            workspace_index: None,
            workspace_total: None,
        },
    );
}

/// Emit a `background-task` event for the import AI-matching job so the
/// status bar shows progress while the (potentially minutes-long) IPC call
/// runs. Both matching strategies share the `claude_import_match` task type.
fn emit_match_task<R: Runtime>(
    app: &AppHandle<R>,
    status: &str,
    message: &str,
    model: Option<String>,
    current: Option<u32>,
    total: Option<u32>,
) {
    let _ = app.emit(
        "background-task",
        crate::services::background_scheduler::BackgroundTaskEvent {
            task_type: "claude_import_match".to_string(),
            status: status.to_string(),
            message: message.to_string(),
            model,
            workspace_id: None,
            current,
            total,
            current_task_type: None,
            workspace_index: None,
            workspace_total: None,
        },
    );
}

/// Embed `(key, text)` pairs, returning unit-length vectors by key.
///
/// Entries whose text is empty are skipped, and individual failures drop that
/// key rather than aborting: per the enrichment-must-degrade rule, a chat that
/// fails to embed loses its semantic rescue and nothing else. Vectors are
/// normalised here so comparisons stay a plain dot product.
async fn embed_by_key(
    ollama: &crate::ollama::client::OllamaClient,
    model: &str,
    items: Vec<(String, String)>,
    mut on_progress: impl FnMut(usize, usize),
) -> std::collections::HashMap<String, Vec<f32>> {
    let total = items.len();
    let mut out = std::collections::HashMap::new();
    let mut failures = 0usize;
    for (i, (key, text)) in items.into_iter().enumerate() {
        if text.trim().is_empty() {
            continue;
        }
        match ollama
            .generate_embedding_with_options("claude_import_match", model, &text, Some("5m"))
            .await
        {
            Ok(mut v) => {
                let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
                if n > 0.0 {
                    v.iter_mut().for_each(|x| *x /= n);
                    out.insert(key, v);
                }
            }
            Err(_) => {
                failures += 1;
                // A wholesale outage should stop early rather than spend
                // minutes failing once per chat.
                if failures > 20 && out.is_empty() {
                    break;
                }
            }
        }
        if (i + 1).is_multiple_of(10) {
            on_progress(i + 1, total);
        }
    }
    out
}

/// Re-run deterministic project matching after distilling each project's
/// prompt/description/memory into a topic list with one LLM call per few projects.
///
/// This is the cheap path: inference cost scales with the number of *projects*
/// (~20) rather than conversations (~1000), and the per-chat matching stays
/// deterministic. Prefer this over `match_claude_with_llm` for large exports.
///
/// Returns `{ suggestions, topics_by_project, projects_with_topics }` so the UI
/// can report how many projects were successfully enriched.
#[tauri::command]
pub async fn match_claude_with_topics<R: Runtime>(
    app: AppHandle<R>,
    conversations: Vec<serde_json::Value>,
    projects: Vec<serde_json::Value>,
    memories_by_project: std::collections::HashMap<String, String>,
    model_override: Option<String>,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    use crate::services::model_settings::{
        get_configured_background_model, get_configured_chat_model,
    };
    use chat_file_store::{ClaudeConversationPreview, ClaudeMessagePreview, ClaudeProjectPreview};

    let (model, match_margin) = {
        let conn = db_state.0.get().map_err(|e| e.to_string())?;
        let (_, margin) = read_match_strictness(&conn);
        let model = if let Some(m) = model_override.filter(|s| !s.is_empty()) {
            m
        } else {
            get_configured_background_model(&conn)
                .or_else(|| get_configured_chat_model(&conn))
                .ok_or("No AI model configured. Set one in Settings \u{2192} AI Models.")?
        };
        (model, margin)
    };

    let ollama = crate::ollama::client::OllamaClient::new(None)?;

    let conv_previews: Vec<ClaudeConversationPreview> = conversations
        .iter()
        .filter_map(|v| {
            // `messages` is optional — when present it widens the matchable text
            // beyond the first user turn.
            let messages = v["messages"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            Some(ClaudeMessagePreview {
                                role: m["role"].as_str()?.to_string(),
                                content: m["content"].as_str().unwrap_or("").to_string(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            Some(ClaudeConversationPreview {
                uuid: v["uuid"].as_str()?.to_string(),
                name: v["name"].as_str().unwrap_or("").to_string(),
                message_count: 0,
                created_at: String::new(),
                updated_at: String::new(),
                project_uuid: None,
                first_user_message: v["first_user_message"].as_str().unwrap_or("").to_string(),
                summary: v["summary"].as_str().unwrap_or("").to_string(),
                messages,
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

    emit_match_task(
        &app,
        "started",
        "Generating project topics",
        Some(model.clone()),
        None,
        None,
    );

    let outcome = chat_file_store::claude_v2_match::generate_project_topics(
        &proj_previews,
        &memories_by_project,
        &ollama,
        &model,
        |done, total| {
            emit_match_task(
                &app,
                "processing",
                &format!("Generating project topics (batch {done} of {total})"),
                Some(model.clone()),
                Some(done as u32),
                Some(total as u32),
            );
        },
    )
    .await;

    // Semantic rescue inputs. Embedding the ~25 projects is cheap; chats are
    // embedded only where the lexical passes came up empty, which is where the
    // tier can actually change the outcome. Any failure here leaves the maps
    // empty and the match falls back to lexical-only.
    let (chat_embeddings, project_embeddings) = {
        let embed_model = {
            let conn = db_state.0.get().map_err(|e| e.to_string())?;
            crate::services::model_settings::get_embedding_model(&conn)
        };
        match embed_model {
            Some(embed_model) => {
                emit_match_task(
                    &app,
                    "processing",
                    "Embedding projects",
                    Some(embed_model.clone()),
                    None,
                    None,
                );
                let projects_input: Vec<(String, String)> = proj_previews
                    .iter()
                    .map(|p| {
                        let memory =
                            memories_by_project.get(&p.uuid).cloned().unwrap_or_default();
                        let text = chat_file_store::claude_v2_match::project_source_text(
                            &p.prompt_template,
                            &p.description,
                            &memory,
                            chat_file_store::claude_v2_match::PROJECT_EMBED_CHARS,
                        );
                        (p.uuid.clone(), format!("{} {}", p.name, text))
                    })
                    .collect();
                let project_embeddings =
                    embed_by_key(&ollama, &embed_model, projects_input, |_, _| {}).await;

                if project_embeddings.is_empty() {
                    (std::collections::HashMap::new(), project_embeddings)
                } else {
                    // Which chats the lexical passes leave unplaced.
                    let lexical =
                        chat_file_store::claude_v2_match::suggest_project_for_conversations_with_options(
                            &conv_previews,
                            &proj_previews,
                            &memories_by_project,
                            &outcome.topics,
                            match_margin,
                        );
                    let unplaced: Vec<(String, String)> = conv_previews
                        .iter()
                        .zip(&lexical)
                        .filter(|(_, s)| s.project_uuid.is_none())
                        .map(|(c, _)| {
                            (
                                c.uuid.clone(),
                                chat_file_store::claude_v2_match::chat_embedding_input(c),
                            )
                        })
                        .collect();
                    let total = unplaced.len();
                    let model_for_progress = embed_model.clone();
                    let chat_embeddings = embed_by_key(
                        &ollama,
                        &embed_model,
                        unplaced,
                        |done, _| {
                            emit_match_task(
                                &app,
                                "processing",
                                &format!("Embedding unmatched chats ({done} of {total})"),
                                Some(model_for_progress.clone()),
                                Some(done as u32),
                                Some(total as u32),
                            );
                        },
                    )
                    .await;
                    (chat_embeddings, project_embeddings)
                }
            }
            None => (
                std::collections::HashMap::new(),
                std::collections::HashMap::new(),
            ),
        }
    };

    // Deterministic re-match with the enriched vocabulary. Projects the model
    // failed on are simply absent from `topics` and score on base vocabulary.
    let suggestions =
        chat_file_store::claude_v2_match::suggest_project_for_conversations_with_embeddings(
            &conv_previews,
            &proj_previews,
            &memories_by_project,
            &outcome.topics,
            &chat_embeddings,
            &project_embeddings,
            match_margin,
        );

    if outcome.batches_failed > 0 && outcome.batches_failed == outcome.batches_total {
        emit_match_task(
            &app,
            "failed",
            &format!(
                "Topic generation failed for all {} batches: {}",
                outcome.batches_total,
                outcome.last_error.as_deref().unwrap_or("unknown error"),
            ),
            Some(model.clone()),
            None,
            None,
        );
    } else {
        emit_match_task(
            &app,
            "completed",
            &format!(
                "Matched {} chats using topics from {} of {} projects",
                suggestions.len(),
                outcome.topics.len(),
                proj_previews.len(),
            ),
            Some(model.clone()),
            None,
            None,
        );
    }

    Ok(serde_json::json!({
        "suggestions": suggestions,
        "topics_by_project": outcome.topics,
        "projects_with_topics": outcome.topics.len(),
        "projects_total": proj_previews.len(),
        "topic_batches_total": outcome.batches_total,
        "topic_batches_failed": outcome.batches_failed,
        "llm_error": outcome.last_error,
    }))
}

/// Generate short descriptions for Claude projects (typically ones the export
/// left blank) from their name, memory excerpt, and a sample of chat titles.
/// The review UI uses the result as matching input — a distilled substitute
/// for long narrative memories — and as the description of the workspace the
/// project imports into.
#[tauri::command]
pub async fn generate_claude_project_descriptions<R: Runtime>(
    app: AppHandle<R>,
    projects: Vec<serde_json::Value>,
    memories_by_project: std::collections::HashMap<String, String>,
    chat_titles_by_project: std::collections::HashMap<String, Vec<String>>,
    // Optional model override — uses the configured background/chat model if absent.
    model_override: Option<String>,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    use crate::services::model_settings::{
        get_configured_background_model, get_configured_chat_model,
    };
    use chat_file_store::ClaudeProjectPreview;

    let model = {
        let conn = db_state.0.get().map_err(|e| e.to_string())?;
        if let Some(m) = model_override.filter(|s| !s.is_empty()) {
            m
        } else {
            get_configured_background_model(&conn)
                .or_else(|| get_configured_chat_model(&conn))
                .ok_or("No AI model configured. Set one in Settings \u{2192} AI Models.")?
        }
    };
    let ollama = crate::ollama::client::OllamaClient::new(None)?;

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

    emit_match_task(
        &app,
        "started",
        "Generating project descriptions",
        Some(model.clone()),
        None,
        None,
    );

    let outcome = chat_file_store::claude_v2_match::generate_project_descriptions(
        &proj_previews,
        &memories_by_project,
        &chat_titles_by_project,
        &ollama,
        &model,
        |done, total| {
            emit_match_task(
                &app,
                "processing",
                &format!("Generating project descriptions (batch {done} of {total})"),
                Some(model.clone()),
                Some(done as u32),
                Some(total as u32),
            );
        },
    )
    .await;

    if outcome.batches_failed > 0 && outcome.batches_failed == outcome.batches_total {
        emit_match_task(
            &app,
            "failed",
            &format!(
                "Description generation failed for all {} batches: {}",
                outcome.batches_total,
                outcome.last_error.as_deref().unwrap_or("unknown error"),
            ),
            Some(model.clone()),
            None,
            None,
        );
    } else {
        emit_match_task(
            &app,
            "completed",
            &format!(
                "Generated descriptions for {} of {} projects",
                outcome.descriptions.len(),
                proj_previews.len(),
            ),
            Some(model.clone()),
            None,
            None,
        );
    }

    Ok(serde_json::json!({
        "descriptions": outcome.descriptions,
        "batches_total": outcome.batches_total,
        "batches_failed": outcome.batches_failed,
        "llm_error": outcome.last_error,
    }))
}

/// Re-run project matching for a set of orphan conversations using an LLM.
/// Called on demand from the import UI — the scan completes with keyword
/// suggestions first; the user can then request a more accurate LLM pass.
///
/// `conversations` is a list of `{ uuid, name, first_user_message }` objects.
/// `projects` is a list of `{ uuid, name, prompt_template, description }` objects.
/// `memories_by_project` maps project UUID → memory text.
#[tauri::command]
pub async fn match_claude_with_llm<R: Runtime>(
    app: AppHandle<R>,
    conversations: Vec<serde_json::Value>,
    projects: Vec<serde_json::Value>,
    memories_by_project: std::collections::HashMap<String, String>,
    // Optional model override -- uses the configured background/chat model if absent.
    model_override: Option<String>,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    use crate::services::model_settings::{get_configured_background_model, get_configured_chat_model};
    use chat_file_store::{ClaudeConversationPreview, ClaudeProjectPreview};

    let (model, match_margin) = {
        let conn = db_state.0.get().map_err(|e| e.to_string())?;
        let (_, margin) = read_match_strictness(&conn);
        let model = if let Some(m) = model_override.filter(|s| !s.is_empty()) {
            m
        } else {
            get_configured_background_model(&conn)
                .or_else(|| get_configured_chat_model(&conn))
                .ok_or("No AI model configured. Set one in Settings \u{2192} AI Models.")?
        };
        (model, margin)
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
                summary: v["summary"].as_str().unwrap_or("").to_string(),
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

    emit_match_task(
        &app,
        "started",
        &format!("Classifying {} chats", conv_previews.len()),
        Some(model.clone()),
        None,
        None,
    );

    let outcome = chat_file_store::claude_v2_match::suggest_project_with_llm(
        &conv_previews,
        &proj_previews,
        &memories_by_project,
        &ollama,
        &model,
        match_margin,
        |done, total| {
            emit_match_task(
                &app,
                "processing",
                &format!("Classifying chats (batch {done} of {total})"),
                Some(model.clone()),
                Some(done as u32),
                Some(total as u32),
            );
        },
    )
    .await;

    if let Some(err) = &outcome.llm_error {
        emit_match_task(
            &app,
            "failed",
            &format!(
                "AI matching stopped after batch {} of {} ({}) — remaining chats used keyword fallback",
                outcome.batches_completed, outcome.batches_total, err,
            ),
            Some(model.clone()),
            Some(outcome.batches_completed as u32),
            Some(outcome.batches_total as u32),
        );
    } else {
        emit_match_task(
            &app,
            "completed",
            &format!("Classified {} chats", outcome.suggestions.len()),
            Some(model.clone()),
            None,
            None,
        );
    }

    Ok(serde_json::json!({
        "suggestions": outcome.suggestions,
        "batches_total": outcome.batches_total,
        "batches_completed": outcome.batches_completed,
        "llm_error": outcome.llm_error,
    }))
}

/// Destination for imported chats/memories: a workspace, optionally with a folder inside it.
/// An empty `folder_id` means "insert directly into the workspace, no folder" —
/// this is the case for projects imported as a new (sub-)workspace.
#[derive(serde::Deserialize)]
pub struct ClaudeImportDestination {
    // The frontend sends camelCase nested keys; Tauri only converts top-level
    // argument names, so accept both spellings.
    #[serde(alias = "workspaceId")]
    workspace_id: String,
    #[serde(alias = "folderId")]
    folder_id: String,
}

/// Import Claude Desktop conversations and memories from a folder.
/// The frontend resolves destinations (creates workspaces/folders) before calling this —
/// the backend is a pure inserter that accepts pre-resolved workspace/folder IDs.
///
/// - `folder_mappings`: claude project_uuid → aetherium destination
/// - `project_memory_targets`: claude project_uuid → aetherium destination (subset of above)
/// - `orphans_destination`: destination for conversations that have no project mapping
/// - `selected_conversation_ids`: only import these conversation UUIDs (empty = all)
/// - `selected_project_ids`: only import project chats from these project UUIDs (empty = all in folder_mappings)
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn import_claude_files(
    auth: State<'_, AuthState>,
    folder_path: String,
    folder_mappings: std::collections::HashMap<String, ClaudeImportDestination>,
    project_memory_targets: std::collections::HashMap<String, ClaudeImportDestination>,
    orphans_destination: Option<ClaudeImportDestination>,
    selected_conversation_ids: Option<Vec<String>>,
    selected_project_ids: Option<Vec<String>>,
    // chat_uuid → claude project_uuid. Routes an otherwise-orphan chat into
    // the folder mapped to that project (must also appear in folder_mappings).
    chat_project_overrides: Option<std::collections::HashMap<String, String>>,
    // Re-import behavior — see `import_lmstudio_folder` for the semantics.
    merge_existing: Option<bool>,
    clone_edited: Option<bool>,
    // When true, previously imported chats that were moved in-app are moved
    // back to their resolved import destination. Default: app state wins.
    restore_destinations: Option<bool>,
    // Display names for destinations whose key isn't a real Claude project —
    // e.g. proposed-group synthetic keys — so import_destinations rows stay
    // meaningful on re-import.
    project_name_overrides: Option<std::collections::HashMap<String, String>>,
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    require_auth_for_destructive_ops(&auth, &db_state)?;
    let chats_dir = chats_dir_state.0.clone();
    let passphrase = crypto.0.lock().ok().and_then(|g| g.clone());
    let pool = db_state.0.clone();
    tokio::task::spawn_blocking(move || {
    use chat_file_store::claude_v2;
    use chat_file_store::import_links::{self, SOURCE_CLAUDE};

    let merge_existing = merge_existing.unwrap_or(false);
    let clone_edited = clone_edited.unwrap_or(false);
    let restore_destinations = restore_destinations.unwrap_or(false);

    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let folder = validate_user_path(&folder_path, true)?;
    if !folder.is_dir() {
        return Err("Selected path is not a folder.".to_string());
    }

    let is_v2 = folder.join("projects").is_dir();
    let now = chrono::Utc::now().to_rfc3339();

    // Everything DB-side happens in one transaction; committed before file writes.
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let links = import_links::load_links(&tx, SOURCE_CLAUDE)?;

    let mut session_ids = Vec::new();
    let mut errors = Vec::new();
    let mut skipped = 0usize;
    let mut appended_sessions = 0usize;
    let mut appended_messages = 0usize;
    let mut cloned = 0usize;
    let mut linked = 0usize;
    let mut moved_back = 0usize;
    let mut reassigned = 0usize;

    let overrides = chat_project_overrides.unwrap_or_default();

    // Parse every chat to import first so the dedup fallback below can resolve
    // candidates with one batched query instead of one query per chat.
    let mut all_chats: Vec<(chat_file_store::ChatFileData, Option<String>)> = Vec::new();
    if is_v2 {
        // Project chats from design_chats/
        let proj_ids: Vec<String> =
            selected_project_ids.unwrap_or_else(|| folder_mappings.keys().cloned().collect());
        let design_chats = claude_v2::parse_v2_design_chats_filtered(&folder, &[])?;
        for (data, project_uuid) in design_chats {
            if let Some(uuid) = project_uuid.as_deref() {
                if !proj_ids.contains(&uuid.to_string()) {
                    continue;
                }
            }
            all_chats.push((data, project_uuid));
        }

        // Orphan conversations from conversations.json. Parsed even without an
        // orphans destination when overrides or existing links can route/merge them.
        let conv_path = folder.join("conversations.json");
        if conv_path.is_file()
            && (orphans_destination.is_some() || !overrides.is_empty() || !links.is_empty())
        {
            let bytes = std::fs::read(&conv_path)
                .map_err(|e| format!("Failed to read conversations.json: {e}"))?;
            let orphans = chat_file_store::parse_claude_conversations_filtered(
                &bytes,
                selected_conversation_ids.as_deref().unwrap_or(&[]),
            )?;
            for (data, _) in orphans {
                all_chats.push((data, None));
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
            all_chats.extend(convs);
        }
    }

    // Batched dedup-candidate lookup for chats without a link: one query over
    // all distinct created_at values (millisecond-precise, so candidate sets
    // stay tiny) instead of a per-chat query. (title, created_at) →
    // [(session_id, workspace_id, folder_id)].
    type DedupCandidates =
        std::collections::HashMap<(String, String), Vec<(String, String, String)>>;
    let mut candidates: DedupCandidates = std::collections::HashMap::new();
    {
        let unlinked_times: Vec<&str> = {
            let mut set = std::collections::BTreeSet::new();
            for (data, _) in &all_chats {
                if !links.contains_key(&data.id) {
                    set.insert(data.created_at.as_str());
                }
            }
            set.into_iter().collect()
        };
        for chunk in unlinked_times.chunks(500) {
            let placeholders = vec!["?"; chunk.len()].join(", ");
            let sql = format!(
                "SELECT id, workspace_id, folder_id, title, created_at FROM chat_sessions
                 WHERE is_imported = 1 AND is_deleted = 0 AND created_at IN ({placeholders})"
            );
            let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                let (sid, ws, fid, title, created) = row.map_err(|e| e.to_string())?;
                candidates.entry((title, created)).or_default().push((sid, ws, fid));
            }
        }
    }

    // Helper: insert one conversation. Routing precedence:
    //   1. embedded project_uuid → folder_mappings
    //   2. chat_project_overrides[chat.id] → folder_mappings
    //   3. orphans_destination (fallback)
    // For previously imported (linked) chats, app state wins by default —
    // EXCEPT when this run carries an explicit per-chat override, which
    // expresses user intent and moves the existing session to that destination.
    let mut insert_chat =
        |data: &chat_file_store::ChatFileData, project_uuid: Option<&str>| -> Result<(), String> {
            let dest = if let Some(uuid) = project_uuid {
                folder_mappings.get(uuid)
            } else if let Some(target_project) = overrides.get(&data.id) {
                folder_mappings.get(target_project)
            } else {
                orphans_destination.as_ref()
            };

            // Previously imported chat, recognized by its Claude conversation
            // UUID. Merges regardless of destination or the merge_existing flag
            // (a link means "this IS the same chat"); by default it merges
            // wherever the chat now lives in-app.
            if let Some(link) = links.get(&data.id) {
                linked += 1;
                let explicit_override =
                    project_uuid.is_none() && overrides.contains_key(&data.id);
                if explicit_override {
                    // The user assigned this chat in this run (e.g. a leftover
                    // from "Unassigned Imports" finally routed to a project) —
                    // move the existing session, regardless of restore mode.
                    if let Some(dest) = dest {
                        if link.workspace_id != dest.workspace_id
                            || link.folder_id != dest.folder_id
                        {
                            tx.execute(
                                "UPDATE chat_sessions SET workspace_id = ?1, folder_id = ?2, updated_at = ?3 WHERE id = ?4",
                                rusqlite::params![dest.workspace_id, dest.folder_id, now, link.session_id],
                            )
                            .map_err(|e| e.to_string())?;
                            reassigned += 1;
                        }
                    }
                } else if restore_destinations {
                    if let Some(dest) = dest {
                        if link.workspace_id != dest.workspace_id
                            || link.folder_id != dest.folder_id
                        {
                            tx.execute(
                                "UPDATE chat_sessions SET workspace_id = ?1, folder_id = ?2, updated_at = ?3 WHERE id = ?4",
                                rusqlite::params![dest.workspace_id, dest.folder_id, now, link.session_id],
                            )
                            .map_err(|e| e.to_string())?;
                            moved_back += 1;
                        }
                    }
                }
                match chat_file_store::reconcile_chat_data(&tx, data, &link.session_id) {
                    Ok(chat_file_store::ReconcileOutcome::Identical) => return Ok(()),
                    Ok(chat_file_store::ReconcileOutcome::Appended { new }) => {
                        appended_messages += new;
                        appended_sessions += 1;
                        session_ids.push(link.session_id.clone());
                        return Ok(());
                    }
                    Ok(chat_file_store::ReconcileOutcome::Edited) => {
                        if !clone_edited {
                            skipped += 1;
                            return Ok(());
                        }
                        cloned += 1;
                        // Import as a fresh session below; the clone becomes the
                        // linked session so future re-imports merge into it. It
                        // lands at the resolved destination, or where the
                        // original currently lives when none was resolved.
                        let (ws, fid) = match dest {
                            Some(d) => (d.workspace_id.clone(), d.folder_id.clone()),
                            None => (link.workspace_id.clone(), link.folder_id.clone()),
                        };
                        match chat_file_store::import_chat_data(&tx, data, &ws, &fid) {
                            Ok(sid) => {
                                import_links::upsert_link(&tx, SOURCE_CLAUDE, &data.id, &sid, &now)?;
                                session_ids.push(sid);
                            }
                            Err(e) => errors.push(format!("{}: {e}", data.title)),
                        }
                        return Ok(());
                    }
                    Err(e) => {
                        errors.push(format!("{}: reconcile failed: {e}", data.title));
                        return Ok(());
                    }
                }
            }

            let Some(dest) = dest else {
                return Ok(()); // no destination → skip
            };
            let workspace_id = dest.workspace_id.clone();
            let folder_id = dest.folder_id.clone();

            // No link yet — fall back to the historical (title, created_at)
            // dedup against imported sessions: first scoped to the resolved
            // destination, then globally when exactly one candidate matches
            // (clones share title+created_at, so ambiguity means "no match").
            // Any hit backfills the link for future imports.
            let existing_session_id: Option<String> = candidates
                .get(&(data.title.clone(), data.created_at.clone()))
                .and_then(|cands| {
                    import_links::pick_dedup_candidate(cands, &workspace_id, &folder_id)
                })
                .map(str::to_string);

            if let Some(existing) = existing_session_id {
                import_links::upsert_link(&tx, SOURCE_CLAUDE, &data.id, &existing, &now)?;
                if !merge_existing {
                    skipped += 1;
                    return Ok(());
                }
                match chat_file_store::reconcile_chat_data(&tx, data, &existing) {
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

            match chat_file_store::import_chat_data(&tx, data, &workspace_id, &folder_id) {
                Ok(sid) => {
                    import_links::upsert_link(&tx, SOURCE_CLAUDE, &data.id, &sid, &now)?;
                    session_ids.push(sid);
                }
                Err(e) => errors.push(format!("{}: {e}", data.title)),
            }
            Ok(())
        };

    for (data, project_uuid) in &all_chats {
        insert_chat(data, project_uuid.as_deref())?;
    }

    // Import per-project memories, deduplicated against prior imports via
    // import_memory_links: unchanged content is skipped, changed content
    // updates the previously imported memory in place.
    let mut memories_imported = 0usize;
    let mut memories_updated = 0usize;
    let mut memories_skipped = 0usize;
    if !project_memory_targets.is_empty() {
        let mem_path = folder.join("memories.json");
        if mem_path.is_file() {
            let mem_bytes = std::fs::read(&mem_path)
                .map_err(|e| format!("Failed to read memories.json: {e}"))?;
            let mem_links = import_links::load_memory_links(&tx, SOURCE_CLAUDE)?;

            let mut import_memory = |project_uuid: &str,
                                     memory: &str,
                                     dest: &ClaudeImportDestination|
             -> Result<(), String> {
                let hash = import_links::memory_content_hash(memory);
                match mem_links.get(project_uuid) {
                    Some((_, prior_hash)) if *prior_hash == hash => {
                        memories_skipped += 1;
                    }
                    Some((mem_id, _)) => {
                        tx.execute(
                            "UPDATE memories SET content = ?1, updated_at = ?2 WHERE id = ?3",
                            rusqlite::params![memory, now, mem_id],
                        )
                        .map_err(|e| e.to_string())?;
                        import_links::upsert_memory_link(
                            &tx, SOURCE_CLAUDE, project_uuid, mem_id, &hash, &now,
                        )?;
                        memories_updated += 1;
                    }
                    None => {
                        let mem_id = uuid::Uuid::new_v4().to_string();
                        tx.execute(
                            "INSERT INTO memories (id, workspace_id, folder_id, content, memory_type, scope, is_pinned, is_active, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, 'fact', 'workspace', 0, 1, ?5, ?5)",
                            rusqlite::params![mem_id, dest.workspace_id, dest.folder_id, memory, now],
                        )
                        .map_err(|e| e.to_string())?;
                        import_links::upsert_memory_link(
                            &tx, SOURCE_CLAUDE, project_uuid, &mem_id, &hash, &now,
                        )?;
                        memories_imported += 1;
                    }
                }
                Ok(())
            };

            // Determine which memory key to use based on format
            if is_v2 {
                let name_map = claude_v2::load_v2_project_name_map(&folder);
                let (_, preview) = claude_v2::parse_v2_memories(&folder, &name_map)?;
                for pm in &preview.folder_memories {
                    if let Some(dest) = project_memory_targets.get(&pm.project_uuid) {
                        import_memory(&pm.project_uuid, &pm.memory, dest)?;
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
                        if let Some(dest) = project_memory_targets.get(&pm.project_uuid) {
                            import_memory(&pm.project_uuid, &pm.memory, dest)?;
                        }
                    }
                }
            }
        }
    }

    // Remember every destination used in this run so later imports reuse it:
    // per-project mappings plus the orphans destination under ORPHANS_KEY.
    {
        let project_names: std::collections::HashMap<String, String> = if is_v2 {
            claude_v2::load_v2_project_name_map(&folder)
        } else {
            let mut map = std::collections::HashMap::new();
            if let Ok(bytes) = std::fs::read(folder.join("projects.json")) {
                if let Ok(vals) = serde_json::from_slice::<Vec<serde_json::Value>>(&bytes) {
                    for v in vals {
                        if let (Some(uuid), Some(name)) = (
                            v.get("uuid").and_then(|x| x.as_str()),
                            v.get("name").and_then(|x| x.as_str()),
                        ) {
                            map.insert(uuid.to_string(), name.to_string());
                        }
                    }
                }
            }
            map
        };
        let name_overrides = project_name_overrides.unwrap_or_default();
        for (project_uuid, dest) in &folder_mappings {
            let name = name_overrides
                .get(project_uuid)
                .or_else(|| project_names.get(project_uuid))
                .map(String::as_str)
                .unwrap_or("");
            import_links::upsert_destination(
                &tx, SOURCE_CLAUDE, project_uuid, name,
                &dest.workspace_id, &dest.folder_id, &now,
            )?;
        }
        if let Some(dest) = orphans_destination.as_ref() {
            import_links::upsert_destination(
                &tx, SOURCE_CLAUDE, import_links::ORPHANS_KEY, "",
                &dest.workspace_id, &dest.folder_id, &now,
            )?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    let pass = passphrase;
    for id in &session_ids {
        let _ = chat_file_store::write_session_file(&conn, &chats_dir, id, pass.as_deref());
    }

    Ok(serde_json::json!({
        "imported": session_ids.len(),
        "skipped": skipped,
        "appended_sessions": appended_sessions,
        "appended_messages": appended_messages,
        "cloned": cloned,
        "linked": linked,
        "moved_back": moved_back,
        "reassigned": reassigned,
        "memories_imported": memories_imported,
        "memories_updated": memories_updated,
        "memories_skipped": memories_skipped,
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
    auth: State<'_, AuthState>,
    chats_dir_state: State<'_, ChatsDirState>,
    crypto: State<'_, ChatCryptoState>,
    db_state: State<'_, DbState>,
) -> Result<usize, String> {
    require_auth_for_destructive_ops(&auth, &db_state)?;
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

/// Preview the account-level memories in a Claude export (v3 `memory_files`).
///
/// Account memories describe the user rather than a project, so they import at
/// global scope and need no project mapping. Each entry reports whether it is
/// already imported, so the UI can distinguish new from updated.
#[tauri::command]
pub async fn preview_claude_account_memories(
    db_state: State<'_, DbState>,
    folder_path: String,
) -> Result<serde_json::Value, String> {
    let pool = db_state.0.clone();
    tokio::task::spawn_blocking(move || {
        use chat_file_store::account_memory::account_link_key;
        use chat_file_store::import_links::{self, SOURCE_CLAUDE};

        let folder = validate_user_path(&folder_path, true)?;
        if !folder.is_dir() {
            return Err("Selected path is not a folder.".to_string());
        }

        let memories = chat_file_store::claude_v2::parse_v2_account_memories(&folder)?;

        let conn = pool.get().map_err(|e| e.to_string())?;
        let links = import_links::load_memory_links(&conn, SOURCE_CLAUDE)?;
        drop(conn);

        let entries: Vec<serde_json::Value> = memories
            .iter()
            .map(|m| {
                let hash = import_links::memory_content_hash(&m.content);
                // Three states drive the UI: new, changed upstream, unchanged.
                let status = match links.get(&account_link_key(&m.key)) {
                    Some((_, prior)) if *prior == hash => "unchanged",
                    Some(_) => "updated",
                    None => "new",
                };
                serde_json::json!({
                    "key": m.key,
                    "category": m.category,
                    "label": m.label,
                    "content": m.content,
                    "kind": m.kind.as_db_value(),
                    "updated_at": m.updated_at,
                    "status": status,
                })
            })
            .collect();

        Ok(serde_json::json!({
            "total": entries.len(),
            "memories": entries,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Import selected account-level memories from a Claude export.
///
/// `selected_keys` are [`ImportedMemory::key`] values from the preview; passing
/// none imports every entry. Re-importing is idempotent: an unchanged entry is
/// skipped, a changed one updates the row it created rather than adding a
/// duplicate.
#[tauri::command]
pub async fn import_claude_account_memories(
    auth: State<'_, AuthState>,
    db_state: State<'_, DbState>,
    folder_path: String,
    selected_keys: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    require_auth_for_destructive_ops(&auth, &db_state)?;
    let pool = db_state.0.clone();
    tokio::task::spawn_blocking(move || {
        use chat_file_store::account_memory::account_link_key;
        use chat_file_store::import_links::{self, SOURCE_CLAUDE};

        let folder = validate_user_path(&folder_path, true)?;
        if !folder.is_dir() {
            return Err("Selected path is not a folder.".to_string());
        }

        let memories = chat_file_store::claude_v2::parse_v2_account_memories(&folder)?;
        let selected: Option<std::collections::HashSet<String>> =
            selected_keys.map(|v| v.into_iter().collect());

        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let links = import_links::load_memory_links(&tx, SOURCE_CLAUDE)?;
        let now = chrono::Utc::now().to_rfc3339();

        let (mut imported, mut updated, mut skipped) = (0usize, 0usize, 0usize);

        for m in &memories {
            if selected.as_ref().is_some_and(|s| !s.contains(&m.key)) {
                continue;
            }
            let link_key = account_link_key(&m.key);
            let hash = import_links::memory_content_hash(&m.content);

            match links.get(&link_key) {
                Some((_, prior)) if *prior == hash => skipped += 1,
                Some((mem_id, _)) => {
                    tx.execute(
                        "UPDATE memories SET content = ?1, memory_type = ?2, updated_at = ?3
                         WHERE id = ?4",
                        rusqlite::params![m.content, m.kind.as_db_value(), now, mem_id],
                    )
                    .map_err(|e| e.to_string())?;
                    import_links::upsert_memory_link(
                        &tx, SOURCE_CLAUDE, &link_key, mem_id, &hash, &now,
                    )?;
                    updated += 1;
                }
                None => {
                    let mem_id = uuid::Uuid::new_v4().to_string();
                    // workspace_id NULL + scope 'global': account memory is not
                    // bound to any one workspace.
                    tx.execute(
                        "INSERT INTO memories
                             (id, workspace_id, folder_id, content, memory_type, scope,
                              is_pinned, is_active, created_at, updated_at)
                         VALUES (?1, NULL, '', ?2, ?3, 'global', 0, 1, ?4, ?4)",
                        rusqlite::params![mem_id, m.content, m.kind.as_db_value(), now],
                    )
                    .map_err(|e| e.to_string())?;
                    import_links::upsert_memory_link(
                        &tx, SOURCE_CLAUDE, &link_key, &mem_id, &hash, &now,
                    )?;
                    imported += 1;
                }
            }
        }

        tx.commit().map_err(|e| e.to_string())?;

        Ok(serde_json::json!({
            "imported": imported,
            "updated": updated,
            "skipped": skipped,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Fast projects-only preview of a Claude export.
///
/// `preview_claude_files` parses conversations.json, which dominates its cost —
/// on a 1151-conversation export that is ~1.1s against ~10ms for everything
/// else. Projects do not depend on it, so this command returns them
/// immediately and lets the UI paint while the full scan runs.
///
/// Deliberately read-only and DB-free: no import links, no matcher, no
/// suggestions. The full scan remains the source of truth and overwrites what
/// this returns.
#[tauri::command]
pub async fn preview_claude_projects_fast(folder_path: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        use chat_file_store::claude_v2;

        let folder = validate_user_path(&folder_path, true)?;
        if !folder.is_dir() {
            return Err("Selected path is not a folder.".to_string());
        }
        // v2/v3 only — the legacy layout keeps projects inside projects.json,
        // which this fast path does not read.
        if !folder.join("projects").is_dir() {
            return Ok(serde_json::json!({ "available": false, "folders": [] }));
        }

        let started = std::time::Instant::now();
        let name_map = claude_v2::load_v2_project_name_map(&folder);
        let (memory_uuids, _) = claude_v2::parse_v2_memories(&folder, &name_map)?;
        let (convs_by_project, _) = claude_v2::preview_v2_design_chats(&folder)?;
        let projects = claude_v2::preview_v2_projects(&folder, &memory_uuids, &convs_by_project)?;

        Ok(serde_json::json!({
            "available": true,
            "folders": projects,
            "elapsed_ms": started.elapsed().as_millis() as u64,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}
