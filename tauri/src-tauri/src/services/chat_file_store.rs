//! File-based chat storage — writes/reads chat sessions as JSON files,
//! optionally encrypted with AES-256-GCM (PBKDF2-derived key).
//!
//! On-disk format (plaintext) mirrors LM Studio:
//! ```json
//! { "id": "…", "title": "…", "model": "…", "system_prompt": "…",
//!   "created_at": "…", "updated_at": "…",
//!   "messages": [{ "id": "…", "role": "user", "content": "…",
//!                  "model": null, "tokens_used": null, "timestamp": "…" }] }
//! ```
//! Encrypted files (`.json.enc`) contain:
//! ```json
//! { "encrypted": true, "version": 1,
//!   "salt": "base64", "nonce": "base64", "ciphertext": "base64" }
//! ```

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

// ── Public file-data structs ──────────────────────────────────────────────────

/// LM Studio-compatible on-disk representation of a chat session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatFileData {
    pub id: String,
    pub title: String,
    pub model: String,
    pub system_prompt: String,
    pub created_at: String,
    pub updated_at: String,
    pub messages: Vec<ChatFileMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatFileMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_used: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    pub timestamp: String,
}

// ── Internal encrypted envelope ───────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct EncryptedFile {
    encrypted: bool,
    version: u8,
    salt: String,
    nonce: String,
    ciphertext: String,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Returns the flat (legacy) file path for a session. Encrypted files use `.json.enc`.
/// Used as a fallback when the DB-aware path cannot be resolved.
pub fn session_file_path(chats_dir: &Path, session_id: &str, encrypted: bool) -> PathBuf {
    if encrypted {
        chats_dir.join(format!("{}.json.enc", session_id))
    } else {
        chats_dir.join(format!("{}.json", session_id))
    }
}

/// Replace filesystem-unsafe characters in a workspace or project name.
fn sanitize_dir_name(name: &str) -> String {
    name.trim()
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            c => c,
        })
        .collect()
}

#[derive(Debug, Clone)]
pub struct SessionFileVariants {
    pub plain: PathBuf,
    pub encrypted: PathBuf,
}

/// Returns the file path for a session organized into workspace/project subdirectories.
/// Path: `chats_dir/{workspace_name}/{project_name}/{session_id}.json[.enc]`
/// Falls back to the flat `chats_dir/{session_id}.json[.enc]` path if the session
/// is not found in the database.
pub fn session_file_path_for_session(
    conn: &Connection,
    chats_dir: &Path,
    session_id: &str,
    encrypted: bool,
) -> PathBuf {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT w.name, COALESCE(NULLIF(p.name, ''), '')
             FROM chat_sessions cs
             JOIN workspaces w ON w.id = cs.workspace_id
             LEFT JOIN projects p ON p.id = cs.project_id AND cs.project_id != ''
             WHERE cs.id = ?1",
            rusqlite::params![session_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();

    let subdir = match row {
        Some((ws, proj)) if !proj.is_empty() => chats_dir
            .join(sanitize_dir_name(&ws))
            .join(sanitize_dir_name(&proj)),
        Some((ws, _)) => chats_dir.join(sanitize_dir_name(&ws)),
        None => chats_dir.to_path_buf(),
    };

    let ext = if encrypted { "json.enc" } else { "json" };
    subdir.join(format!("{}.{}", session_id, ext))
}

fn session_file_variants_for_session(
    conn: &Connection,
    chats_dir: &Path,
    session_id: &str,
) -> SessionFileVariants {
    SessionFileVariants {
        plain: session_file_path_for_session(conn, chats_dir, session_id, false),
        encrypted: session_file_path_for_session(conn, chats_dir, session_id, true),
    }
}

pub fn capture_session_file_variants(
    conn: &Connection,
    chats_dir: &Path,
    session_ids: &[String],
) -> HashMap<String, SessionFileVariants> {
    session_ids
        .iter()
        .map(|session_id| {
            (
                session_id.clone(),
                session_file_variants_for_session(conn, chats_dir, session_id),
            )
        })
        .collect()
}

fn prune_empty_parent_dirs(chats_dir: &Path, file_path: &Path) {
    let mut current = file_path.parent();

    while let Some(dir) = current {
        if dir == chats_dir {
            break;
        }

        match std::fs::remove_dir(dir) {
            Ok(()) => current = dir.parent(),
            Err(_) => break,
        }
    }
}

fn remove_stale_file_if_needed(chats_dir: &Path, old_path: &Path, new_path: &Path) {
    if old_path == new_path {
        return;
    }

    if std::fs::remove_file(old_path).is_ok() {
        prune_empty_parent_dirs(chats_dir, old_path);
    }
}

pub fn sync_session_files_for_hierarchy_change(
    conn: &Connection,
    chats_dir: &Path,
    session_ids: &[String],
    previous_paths: &HashMap<String, SessionFileVariants>,
    passphrase: Option<&str>,
) -> Result<(), String> {
    for session_id in session_ids {
        write_session_file(conn, chats_dir, session_id, passphrase)?;

        let current_paths = session_file_variants_for_session(conn, chats_dir, session_id);
        if let Some(previous) = previous_paths.get(session_id) {
            remove_stale_file_if_needed(chats_dir, &previous.plain, &current_paths.plain);
            remove_stale_file_if_needed(chats_dir, &previous.encrypted, &current_paths.encrypted);
        }
    }

    Ok(())
}

/// Derive a 256-bit AES key from a passphrase + random salt using PBKDF2-SHA256.
fn derive_key(passphrase: &str, salt: &[u8]) -> [u8; 32] {
    use pbkdf2::pbkdf2_hmac;
    use sha2::Sha256;
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, 100_000, &mut key);
    key
}

/// Load a session and all its messages from the database into `ChatFileData`.
fn load_from_db(conn: &Connection, session_id: &str) -> Result<ChatFileData, String> {
    let row: (String, String, String, String, String) = conn
        .query_row(
            "SELECT title, model_name, system_prompt, created_at, updated_at
             FROM chat_sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, role, content, model_name, tokens_used, duration_ms, created_at
             FROM messages WHERE session_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let messages = stmt
        .query_map(rusqlite::params![session_id], |r| {
            Ok(ChatFileMessage {
                id: r.get(0)?,
                role: r.get(1)?,
                content: r.get(2)?,
                model: r.get(3)?,
                tokens_used: r.get(4)?,
                duration_ms: r.get(5)?,
                timestamp: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(ChatFileData {
        id: session_id.to_string(),
        title: row.0,
        model: row.1,
        system_prompt: row.2,
        created_at: row.3,
        updated_at: row.4,
        messages,
    })
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Write a chat session to its JSON file, organized into workspace/project subdirectories.
/// Pass `passphrase = Some(p)` to encrypt, `None` for plaintext.
/// Also removes any legacy flat-directory files for the same session (migration).
/// Best-effort: callers should tolerate errors gracefully.
pub fn write_session_file(
    conn: &Connection,
    chats_dir: &Path,
    session_id: &str,
    passphrase: Option<&str>,
) -> Result<(), String> {
    let encrypted = passphrase.is_some();
    let target_path = session_file_path_for_session(conn, chats_dir, session_id, encrypted);
    let target_dir = target_path.parent().unwrap_or(chats_dir);
    std::fs::create_dir_all(target_dir).map_err(|e| e.to_string())?;

    // Remove legacy flat-directory twins (migration from old layout)
    let legacy_plain = session_file_path(chats_dir, session_id, false);
    let legacy_enc = session_file_path(chats_dir, session_id, true);
    if legacy_plain != target_path {
        let _ = std::fs::remove_file(&legacy_plain);
    }
    if legacy_enc != target_path {
        let _ = std::fs::remove_file(&legacy_enc);
    }

    let data = load_from_db(conn, session_id)?;
    let json_bytes = serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?;

    if let Some(pass) = passphrase {
        use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
        use aes_gcm::Aes256Gcm;

        let mut salt = [0u8; 16];
        use aes_gcm::aead::rand_core::RngCore;
        OsRng.fill_bytes(&mut salt);

        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let key = derive_key(pass, &salt);
        let cipher = Aes256Gcm::new(aes_gcm::Key::<Aes256Gcm>::from_slice(&key));

        let ciphertext = cipher
            .encrypt(&nonce, json_bytes.as_ref())
            .map_err(|e| format!("Encryption failed: {e}"))?;

        let envelope = EncryptedFile {
            encrypted: true,
            version: 1,
            salt: B64.encode(salt),
            nonce: B64.encode(nonce.as_slice()),
            ciphertext: B64.encode(&ciphertext),
        };

        // Remove the plaintext twin at the new location
        let _ = std::fs::remove_file(session_file_path_for_session(conn, chats_dir, session_id, false));
        let out = serde_json::to_vec_pretty(&envelope).map_err(|e| e.to_string())?;
        std::fs::write(&target_path, out).map_err(|e| e.to_string())?;
    } else {
        // Remove the encrypted twin at the new location
        let _ = std::fs::remove_file(session_file_path_for_session(conn, chats_dir, session_id, true));
        std::fs::write(&target_path, &json_bytes).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Delete both file variants (plain + encrypted) for a session, from both the
/// workspace/project subdirectory and the legacy flat location.
pub fn delete_session_file(conn: &Connection, chats_dir: &Path, session_id: &str) {
    // Delete from the current (subdirectory) location
    let _ = std::fs::remove_file(session_file_path_for_session(conn, chats_dir, session_id, false));
    let _ = std::fs::remove_file(session_file_path_for_session(conn, chats_dir, session_id, true));
    // Also clean up any legacy flat-dir files
    let _ = std::fs::remove_file(session_file_path(chats_dir, session_id, false));
    let _ = std::fs::remove_file(session_file_path(chats_dir, session_id, true));
}

/// Read and optionally decrypt a chat JSON file.
pub fn read_session_file(path: &Path, passphrase: Option<&str>) -> Result<ChatFileData, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;

    if value.get("encrypted").and_then(|v| v.as_bool()) == Some(true) {
        let pass =
            passphrase.ok_or_else(|| "Passphrase required to open encrypted chat".to_string())?;
        let ef: EncryptedFile = serde_json::from_value(value).map_err(|e| e.to_string())?;

        use aes_gcm::aead::{Aead, KeyInit};
        use aes_gcm::{Aes256Gcm, Nonce};

        let salt = B64.decode(&ef.salt).map_err(|e| e.to_string())?;
        let nonce_bytes = B64.decode(&ef.nonce).map_err(|e| e.to_string())?;
        let ciphertext = B64.decode(&ef.ciphertext).map_err(|e| e.to_string())?;

        let key = derive_key(pass, &salt);
        let cipher = Aes256Gcm::new(aes_gcm::Key::<Aes256Gcm>::from_slice(&key));
        let nonce = Nonce::from_slice(&nonce_bytes);
        let plain = cipher
            .decrypt(nonce, ciphertext.as_ref())
            .map_err(|_| "Decryption failed — wrong passphrase or corrupted file".to_string())?;

        serde_json::from_slice(&plain).map_err(|e| e.to_string())
    } else {
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    }
}

/// Import a chat file into the database. Returns the session id.
pub fn import_session_from_file(
    conn: &Connection,
    path: &Path,
    workspace_id: &str,
    project_id: &str,
    passphrase: Option<&str>,
) -> Result<String, String> {
    let data = read_session_file(path, passphrase)?;
    let session_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO chat_sessions
             (id, workspace_id, project_id, title, model_name, system_prompt, is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at, is_imported, parent_session_id, branch_message_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, 0, 0, NULL, 1, NULL, NULL, ?7, ?8)",
        rusqlite::params![
            session_id, workspace_id, project_id, data.title, data.model, data.system_prompt,
            data.created_at, data.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;

    for msg in &data.messages {
        let role = msg.role.trim().to_lowercase();
        if !matches!(role.as_str(), "user" | "assistant" | "system") {
            return Err(format!("Unsupported message role: {}", msg.role));
        }

        conn.execute(
            "INSERT INTO messages
                 (id, session_id, role, content, model_name, tokens_used, duration_ms, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                session_id,
                role,
                msg.content,
                msg.model,
                msg.tokens_used,
                msg.duration_ms,
                msg.timestamp
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(session_id)
}

// ── LM Studio .conversation.json parser ──────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LmConversation {
    name: Option<String>,
    created_at: Option<u64>, // epoch ms
    system_prompt: Option<String>,
    messages: Vec<LmMessageSlot>,
    /// Per-chat prediction config may hold systemPrompt override
    #[serde(default)]
    per_chat_prediction_config: Option<LmPredictionConfig>,
    /// Model used in the conversation
    last_used_model: Option<LmModelRef>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LmMessageSlot {
    versions: Vec<LmMessageVersion>,
    currently_selected: Option<usize>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LmMessageVersion {
    role: Option<String>,
    #[serde(default)]
    content: Vec<LmContentBlock>,
    /// For multiStep messages, content lives inside steps
    #[serde(default)]
    steps: Vec<LmStep>,
    #[serde(default)]
    sender_info: Option<LmSenderInfo>,
    #[serde(rename = "type")]
    msg_type: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LmStep {
    #[serde(rename = "type")]
    step_type: Option<String>,
    #[serde(default)]
    content: Vec<LmContentBlock>,
    gen_info: Option<LmGenInfo>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct LmContentBlock {
    #[serde(rename = "type")]
    block_type: Option<String>,
    text: Option<String>,
    #[serde(rename = "tokensCount")]
    tokens_count: Option<i64>,
    style: Option<LmBlockStyle>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LmBlockStyle {
    style_type: Option<String>,
    title: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LmGenInfo {
    identifier: Option<String>,
    stats: Option<LmStats>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LmStats {
    total_time_sec: Option<f64>,
    predicted_tokens_count: Option<i64>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LmSenderInfo {
    sender_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LmPredictionConfig {
    fields: Vec<LmConfigField>,
}

#[derive(Debug, Deserialize)]
struct LmConfigField {
    key: String,
    value: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct LmModelRef {
    identifier: Option<String>,
}

/// Extract the effective system prompt from the LM Studio conversation.
fn lm_effective_system_prompt(conv: &LmConversation) -> String {
    // Check per-chat prediction config first (higher priority)
    if let Some(ref cfg) = conv.per_chat_prediction_config {
        for f in &cfg.fields {
            if f.key == "llm.prediction.systemPrompt" {
                if let Some(s) = f.value.as_str() {
                    if !s.is_empty() {
                        return s.to_string();
                    }
                }
            }
        }
    }
    conv.system_prompt.clone().unwrap_or_default()
}

/// Convert epoch milliseconds to an ISO-8601 datetime string.
fn epoch_ms_to_iso(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let nsecs = ((ms % 1000) * 1_000_000) as u32;
    chrono::DateTime::from_timestamp(secs, nsecs)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339())
}

/// Extract flat messages from LM Studio's versioned/multi-step format.
fn extract_messages_from_lm_conversation(conv: &LmConversation) -> Vec<ChatFileMessage> {
    let base_ts = conv.created_at.unwrap_or(0);
    let mut result = Vec::new();

    for (i, slot) in conv.messages.iter().enumerate() {
        if slot.versions.is_empty() {
            continue;
        }
        let idx = slot
            .currently_selected
            .unwrap_or(0)
            .min(slot.versions.len() - 1);
        let version = &slot.versions[idx];

        let role = match version.role.as_deref() {
            Some(r) => r.to_lowercase(),
            None => continue,
        };
        if !matches!(role.as_str(), "user" | "assistant" | "system") {
            continue;
        }

        // Extract text content depending on singleStep vs multiStep
        let is_multi = version.msg_type.as_deref() == Some("multiStep");

        let mut text_parts: Vec<String> = Vec::new();
        let mut thought_title: Option<String> = None;
        let mut model_name: Option<String> = None;
        let mut tokens: Option<i64> = None;
        let mut duration_ms: Option<i64> = None;

        if is_multi {
            // multiStep: iterate steps, skip debugInfoBlock
            for step in &version.steps {
                if step.step_type.as_deref() != Some("contentBlock") {
                    continue;
                }
                for block in &step.content {
                    if block.block_type.as_deref() == Some("text") {
                        if let Some(ref t) = block.text {
                            if !t.is_empty() {
                                text_parts.push(t.clone());
                            }
                        }
                        if thought_title.is_none()
                            && block
                                .style
                                .as_ref()
                                .and_then(|style| style.style_type.as_deref())
                                == Some("thinking")
                        {
                            thought_title =
                                block.style.as_ref().and_then(|style| style.title.clone());
                        }
                    }
                }
                // Extract model/stats from genInfo on the step
                if let Some(ref gi) = step.gen_info {
                    if model_name.is_none() {
                        model_name = gi.identifier.clone();
                    }
                    if let Some(ref stats) = gi.stats {
                        if tokens.is_none() {
                            tokens = stats.predicted_tokens_count;
                        }
                        if duration_ms.is_none() {
                            duration_ms = stats.total_time_sec.map(|s| (s * 1000.0) as i64);
                        }
                    }
                }
            }
        } else {
            // singleStep: content blocks are directly on the version
            for block in &version.content {
                if block.block_type.as_deref() == Some("text") {
                    if let Some(ref t) = block.text {
                        if !t.is_empty() {
                            text_parts.push(t.clone());
                        }
                    }
                }
            }
        }

        // Fall back to sender_info for model name
        if model_name.is_none() {
            model_name = version
                .sender_info
                .as_ref()
                .and_then(|s| s.sender_name.clone());
        }

        let mut content = text_parts.join("\n\n");
        if content.is_empty() {
            continue;
        }
        if let Some(title) = thought_title.filter(|value| !value.trim().is_empty()) {
            if let Some((thought, answer)) = content.split_once("\n\n\n") {
                let safe_title = title.replace('"', "&quot;");
                content = format!(
                    "<think title=\"{safe_title}\">\n{}\n</think>\n\n{}",
                    thought.trim(),
                    answer.trim(),
                );
            }
        }

        // Approximate timestamp: base + offset per message
        let msg_ts = if base_ts > 0 {
            epoch_ms_to_iso(base_ts + (i as u64 * 1000))
        } else {
            chrono::Utc::now().to_rfc3339()
        };

        result.push(ChatFileMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role,
            content,
            model: model_name,
            tokens_used: tokens,
            duration_ms,
            timestamp: msg_ts,
        });
    }

    result
}

/// Parse an LM Studio `.conversation.json` file into our `ChatFileData`.
pub fn parse_lmstudio_conversation(bytes: &[u8]) -> Result<ChatFileData, String> {
    let conv: LmConversation =
        serde_json::from_slice(bytes).map_err(|e| format!("Invalid LM Studio JSON: {e}"))?;

    let title = conv
        .name
        .clone()
        .unwrap_or_else(|| "Imported Chat".to_string());
    let created = conv
        .created_at
        .map(epoch_ms_to_iso)
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let model = conv
        .last_used_model
        .as_ref()
        .and_then(|m| m.identifier.clone())
        .unwrap_or_default();
    let system_prompt = lm_effective_system_prompt(&conv);

    let messages = extract_messages_from_lm_conversation(&conv);
    if messages.is_empty() {
        return Err(
            "Conversation contains no importable user, assistant, or system messages.".to_string(),
        );
    }

    Ok(ChatFileData {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        model,
        system_prompt,
        created_at: created.clone(),
        updated_at: created,
        messages,
    })
}

/// A conversation file with its relative subfolder path.
pub struct DiscoveredConversation {
    pub path: PathBuf,
    /// The immediate parent folder name (used as project name), or empty for root-level files.
    pub subfolder: String,
}

/// Walk a directory recursively and discover all `.conversation.json` files,
/// grouped by their immediate parent folder relative to the root.
pub fn discover_lmstudio_conversations(
    folder: &Path,
) -> Result<Vec<DiscoveredConversation>, String> {
    let mut results = Vec::new();

    fn walk(
        dir: &Path,
        root: &Path,
        results: &mut Vec<DiscoveredConversation>,
    ) -> Result<(), String> {
        let entries =
            std::fs::read_dir(dir).map_err(|e| format!("Cannot read {}: {e}", dir.display()))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, root, results)?;
            } else if path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.ends_with(".conversation.json") || n == "conversation.json")
                .unwrap_or(false)
            {
                // Determine the subfolder: immediate parent relative to root
                let subfolder = path
                    .parent()
                    .filter(|p| *p != root)
                    .and_then(|p| p.file_name())
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                results.push(DiscoveredConversation { path, subfolder });
            }
        }
        Ok(())
    }

    walk(folder, folder, &mut results)?;
    Ok(results)
}

/// Import a single parsed `ChatFileData` into the database.
/// Returns the session ID on success.
pub fn import_chat_data(
    conn: &Connection,
    data: &ChatFileData,
    workspace_id: &str,
    project_id: &str,
) -> Result<String, String> {
    if data.messages.is_empty() {
        return Err("Conversation contains no supported messages.".to_string());
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO chat_sessions
             (id, workspace_id, project_id, title, model_name, system_prompt,
              is_pinned, is_incognito, exclude_from_analytics, is_deleted,
              deleted_at, is_imported, parent_session_id, branch_message_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, 0, 0, NULL, 1, NULL, NULL, ?7, ?8)",
        rusqlite::params![
            session_id,
            workspace_id,
            project_id,
            data.title,
            data.model,
            data.system_prompt,
            data.created_at,
            data.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;

    for msg in &data.messages {
        let role = msg.role.trim().to_lowercase();
        if !matches!(role.as_str(), "user" | "assistant" | "system") {
            continue;
        }
        conn.execute(
            "INSERT INTO messages
                 (id, session_id, role, content, model_name, tokens_used, duration_ms, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                session_id,
                role,
                msg.content,
                msg.model,
                msg.tokens_used,
                msg.duration_ms,
                msg.timestamp
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(session_id)
}

/// Re-encrypt (or decrypt) every chat file under `chats_dir` (walks recursively).
/// Called when the user enables/disables encryption or changes the passphrase.
/// Returns the number of files re-written.
pub fn reencrypt_all_files(
    chats_dir: &Path,
    old_passphrase: Option<&str>,
    new_passphrase: Option<&str>,
) -> Result<usize, String> {
    if !chats_dir.exists() {
        return Ok(0);
    }
    let mut count = 0usize;
    reencrypt_walk(chats_dir, old_passphrase, new_passphrase, &mut count);
    Ok(count)
}

fn reencrypt_walk(dir: &Path, old_passphrase: Option<&str>, new_passphrase: Option<&str>, count: &mut usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            reencrypt_walk(&path, old_passphrase, new_passphrase, count);
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !name.ends_with(".json") && !name.ends_with(".json.enc") {
            continue;
        }
        // Try to read the file
        let data = match read_session_file(&path, old_passphrase) {
            Ok(d) => d,
            Err(_) => continue, // skip unreadable files
        };
        let json_bytes = match serde_json::to_vec_pretty(&data) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let stem = if name.ends_with(".json.enc") {
            name.trim_end_matches(".json.enc")
        } else {
            name.trim_end_matches(".json")
        };
        // File lives in `path.parent()` (its subdir), so write back there
        let file_dir = path.parent().unwrap_or(dir);

        if let Some(pass) = new_passphrase {
            use aes_gcm::aead::rand_core::RngCore;
            use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
            use aes_gcm::Aes256Gcm;

            let mut salt = [0u8; 16];
            OsRng.fill_bytes(&mut salt);
            let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
            let key = derive_key(pass, &salt);
            let cipher = Aes256Gcm::new(aes_gcm::Key::<Aes256Gcm>::from_slice(&key));
            let ciphertext = match cipher.encrypt(&nonce, json_bytes.as_ref()) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let envelope = EncryptedFile {
                encrypted: true,
                version: 1,
                salt: B64.encode(salt),
                nonce: B64.encode(nonce.as_slice()),
                ciphertext: B64.encode(&ciphertext),
            };
            let new_path = file_dir.join(format!("{}.json.enc", stem));
            let _ = std::fs::remove_file(file_dir.join(format!("{}.json", stem)));
            let _ = std::fs::remove_file(file_dir.join(format!("{}.json.enc", stem)));
            if let Ok(out) = serde_json::to_vec_pretty(&envelope) {
                let _ = std::fs::write(new_path, out);
            }
        } else {
            let new_path = file_dir.join(format!("{}.json", stem));
            let _ = std::fs::remove_file(file_dir.join(format!("{}.json.enc", stem)));
            let _ = std::fs::remove_file(file_dir.join(format!("{}.json", stem)));
            let _ = std::fs::write(new_path, &json_bytes);
        }
        *count += 1;
    }
}

// ── Google Takeout (Gemini) parser ──────────────────────────────────────────

pub fn parse_gemini_takeout(html: &str) -> std::result::Result<Vec<ChatFileData>, String> {
    let mut turns = Vec::new();
    let re_date = regex::Regex::new(r"(\d{1,2} [A-Z][a-z]{2} \d{4}), (\d{2}:\d{2}:\d{2})").unwrap();
    let re_tags = regex::Regex::new(r"<[^>]+>").unwrap();
    let re_img = regex::Regex::new(r#"<img\s+[^>]*src="([^"]+)""#).unwrap();

    // Split by the outer cell div
    for part in html.split("<div class=\"outer-cell ") {
        if !part.contains("Prompted") {
            continue;
        }

        let prompt_start = match part.find("Prompted") {
            Some(i) => i + 8,
            None => continue,
        };
        let after_prompt = &part[prompt_start..];

        let trimmed = after_prompt
            .trim_start()
            .trim_start_matches('\u{a0}')
            .trim_start_matches("&#160;")
            .trim_start_matches("&nbsp;")
            .trim_start();

        let prompt_end = trimmed.find("<br>").unwrap_or(trimmed.len());
        let prompt_text = &trimmed[..prompt_end];

        if let Some(caps) = re_date.captures(trimmed) {
            let date_str = caps.get(1).unwrap().as_str();
            let time_str = caps.get(2).unwrap().as_str();
            let date_match = caps.get(0).unwrap();

            // Try to parse timestamp for grouping
            let ts_str = format!("{} {}", date_str, time_str);
            let timestamp = chrono::NaiveDateTime::parse_from_str(&ts_str, "%d %b %Y %H:%M:%S")
                .map(|dt| dt.and_utc())
                .unwrap_or_else(|_| chrono::Utc::now());

            let after_date = &trimmed[date_match.end()..];
            let mut assistant_html = after_date;

            // Extract image if present
            let mut image_ref = None;
            if let Some(img_caps) = re_img.captures(part) {
                image_ref = Some(img_caps.get(1).unwrap().as_str().to_string());
            }

            // Skip the timezone/other meta info up to the response body
            if let Some(idx) = assistant_html.find("<p>") {
                assistant_html = &assistant_html[idx..];
            } else if let Some(idx) = assistant_html.find("<br>") {
                assistant_html = &assistant_html[idx + 4..];
            }
            if let Some(idx) = assistant_html.find("</div></div></div>") {
                assistant_html = &assistant_html[..idx];
            } else if let Some(idx) = assistant_html.find("</div><div class=") {
                assistant_html = &assistant_html[..idx];
            } else if let Some(idx) = assistant_html.find("</div>") {
                assistant_html = &assistant_html[..idx];
            }

            let safe_html = assistant_html
                .replace("<br>", "\n")
                .replace("</p>", "\n\n")
                .replace("&nbsp;", " ")
                .replace("&quot;", "\"")
                .replace("&amp;", "&")
                .replace("&#39;", "'")
                .replace("&lt;", "<")
                .replace("&gt;", ">");

            let safe_text = re_tags
                .replace_all(&safe_html, "")
                .to_string()
                .trim()
                .to_string();
            
            let mut safe_prompt = prompt_text
                .replace("&nbsp;", " ")
                .replace("&quot;", "\"")
                .replace("&amp;", "&")
                .replace("&#39;", "'")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .trim()
                .to_string();

            // Append image reference to prompt if found
            if let Some(ref img) = image_ref {
                safe_prompt.push_str(&format!("\n\n![Attachment]({})", img));
            }

            turns.push((timestamp, safe_prompt, safe_text));
        }
    }

    if turns.is_empty() {
        return Ok(Vec::new());
    }

    // Sort turns chronologically (Takeout is usually newest first)
    turns.sort_by_key(|t| t.0);

    let mut sessions = Vec::new();
    let mut current_messages = Vec::new();
    let mut last_ts: Option<chrono::DateTime<chrono::Utc>> = None;
    let gap_threshold = chrono::Duration::minutes(30);

    for (ts, prompt, response) in turns {
        // Start new session if gap is too large
        if let Some(last) = last_ts {
            if ts.signed_duration_since(last) > gap_threshold {
                if !current_messages.is_empty() {
                    sessions.push(create_session_from_messages(current_messages));
                    current_messages = Vec::new();
                }
            }
        }

        let id_prefix = uuid::Uuid::new_v4().to_string();
        let ts_iso = ts.to_rfc3339();

        current_messages.push(ChatFileMessage {
            id: format!("{}-user", id_prefix),
            role: "user".to_string(),
            content: prompt,
            model: None,
            tokens_used: None,
            timestamp: ts_iso.clone(),
            duration_ms: None,
        });

        current_messages.push(ChatFileMessage {
            id: format!("{}-assistant", id_prefix),
            role: "assistant".to_string(),
            content: response,
            model: Some("gemini".to_string()),
            tokens_used: None,
            timestamp: ts_iso,
            duration_ms: None,
        });

        last_ts = Some(ts);
    }

    if !current_messages.is_empty() {
        sessions.push(create_session_from_messages(current_messages));
    }

    Ok(sessions)
}

fn create_session_from_messages(messages: Vec<ChatFileMessage>) -> ChatFileData {
    let first_ts = messages.first().map(|m| m.timestamp.clone()).unwrap_or_default();
    let first_prompt = messages.first().map(|m| m.content.clone()).unwrap_or_default();
    
    // Create a title from the first prompt (limit length)
    let title = if first_prompt.len() > 40 {
        format!("{}...", &first_prompt[..37].replace('\n', " "))
    } else {
        first_prompt.replace('\n', " ")
    };

    ChatFileData {
        id: uuid::Uuid::new_v4().to_string(),
        title: format!("Gemini: {}", title),
        model: "gemini".to_string(),
        system_prompt: "".to_string(),
        created_at: first_ts.clone(),
        updated_at: first_ts,
        messages,
    }
}


// ── Claude Desktop JSON parser ───────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct ClaudeConversation {
    uuid: String,
    name: String,
    #[serde(default)]
    summary: Option<String>,
    created_at: String,
    updated_at: String,
    #[serde(default)]
    chat_messages: Vec<ClaudeChatMessage>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct ClaudeChatMessage {
    uuid: String,
    text: String,
    sender: String, // "human" or "assistant"
    #[serde(default)]
    content: Vec<ClaudeContentBlock>,
    created_at: String,
    #[serde(default)]
    attachments: Vec<ClaudeAttachment>,
    #[serde(default)]
    files: Vec<serde_json::Value>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct ClaudeContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    thinking: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    input: Option<serde_json::Value>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct ClaudeAttachment {
    #[serde(default)]
    file_name: Option<String>,
    #[serde(default)]
    extracted_content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ClaudeProject {
    uuid: String,
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    prompt_template: Option<String>,
    #[serde(default)]
    docs: Vec<ClaudeProjectDoc>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct ClaudeProjectDoc {
    uuid: String,
    filename: String,
    content: String,
}

/// Extract message content from a Claude Desktop chat message.
/// Prefers structured `content` blocks; falls back to `text` field.
fn extract_claude_message_content(msg: &ClaudeChatMessage) -> String {
    if msg.content.is_empty() {
        // Add attachment content if available
        let mut text = msg.text.clone();
        for att in &msg.attachments {
            if let (Some(name), Some(content)) = (&att.file_name, &att.extracted_content) {
                if !content.is_empty() {
                    text.push_str(&format!("\n\n---\n📎 {name}\n{content}"));
                }
            }
        }
        return text;
    }

    let mut parts: Vec<String> = Vec::new();

    for block in &msg.content {
        match block.block_type.as_str() {
            "text" => {
                if let Some(ref t) = block.text {
                    if !t.is_empty() {
                        parts.push(t.clone());
                    }
                }
            }
            "thinking" => {
                if let Some(ref t) = block.thinking {
                    if !t.is_empty() {
                        parts.push(format!("<think>\n{}\n</think>", t.trim()));
                    }
                }
            }
            "tool_use" => {
                if let Some(ref name) = block.name {
                    let input_str = block
                        .input
                        .as_ref()
                        .map(|v| serde_json::to_string_pretty(v).unwrap_or_default())
                        .unwrap_or_default();
                    if !input_str.is_empty() {
                        parts.push(format!("🔧 Tool: {name}\n```json\n{input_str}\n```"));
                    }
                }
            }
            // tool_result, token_budget — skip or ignore
            _ => {}
        }
    }

    // Append attachment content
    for att in &msg.attachments {
        if let (Some(name), Some(content)) = (&att.file_name, &att.extracted_content) {
            if !content.is_empty() {
                parts.push(format!("---\n📎 {name}\n{content}"));
            }
        }
    }

    if parts.is_empty() {
        // Fall back to text field
        msg.text.clone()
    } else {
        parts.join("\n\n")
    }
}

/// Parse a Claude Desktop `conversations.json` into a Vec of `ChatFileData`.
pub fn parse_claude_conversations(bytes: &[u8]) -> Result<Vec<ChatFileData>, String> {
    let conversations: Vec<ClaudeConversation> =
        serde_json::from_slice(bytes).map_err(|e| format!("Invalid Claude Desktop JSON: {e}"))?;

    let mut results = Vec::new();

    for conv in &conversations {
        if conv.chat_messages.is_empty() {
            continue;
        }

        let messages: Vec<ChatFileMessage> = conv
            .chat_messages
            .iter()
            .filter_map(|msg| {
                let role = match msg.sender.as_str() {
                    "human" => "user",
                    "assistant" => "assistant",
                    _ => return None,
                };
                let content = extract_claude_message_content(msg);
                if content.is_empty() {
                    return None;
                }
                Some(ChatFileMessage {
                    id: msg.uuid.clone(),
                    role: role.to_string(),
                    content,
                    model: if role == "assistant" {
                        Some("claude".to_string())
                    } else {
                        None
                    },
                    tokens_used: None,
                    duration_ms: None,
                    timestamp: msg.created_at.clone(),
                })
            })
            .collect();

        if messages.is_empty() {
            continue;
        }

        results.push(ChatFileData {
            id: conv.uuid.clone(),
            title: conv.name.clone(),
            model: "claude".to_string(),
            system_prompt: String::new(),
            created_at: conv.created_at.clone(),
            updated_at: conv.updated_at.clone(),
            messages,
        });
    }

    Ok(results)
}

/// Parse a Claude Desktop `projects.json` into a map of project UUID -> (name, description, system_prompt).
pub fn parse_claude_projects(
    bytes: &[u8],
) -> Result<Vec<(String, String, String, String)>, String> {
    let projects: Vec<ClaudeProject> =
        serde_json::from_slice(bytes).map_err(|e| format!("Invalid Claude projects JSON: {e}"))?;

    Ok(projects
        .into_iter()
        .map(|p| {
            (
                p.uuid,
                p.name,
                p.description.unwrap_or_default(),
                p.prompt_template.unwrap_or_default(),
            )
        })
        .collect())
}

/// Return lightweight project previews from `projects.json`.
pub fn preview_claude_projects(bytes: &[u8]) -> Result<Vec<ClaudeProjectPreview>, String> {
    let projects: Vec<ClaudeProject> =
        serde_json::from_slice(bytes).map_err(|e| format!("Invalid Claude projects JSON: {e}"))?;

    Ok(projects
        .into_iter()
        .map(|p| ClaudeProjectPreview {
            uuid: p.uuid,
            name: p.name,
            description: p.description.unwrap_or_default(),
            has_prompt: p.prompt_template.as_ref().map_or(false, |s| !s.is_empty()),
            doc_count: p.docs.len(),
        })
        .collect())
}

/// Deserialize `memories.json` and build previews, resolving project UUIDs to
/// names using the provided `projects.json` bytes (if available).
pub fn preview_claude_memories(
    mem_bytes: &[u8],
    project_bytes: Option<&[u8]>,
) -> Result<ClaudeMemoryPreview, String> {
    #[derive(Deserialize)]
    struct ClaudeMemoryAccount {
        #[serde(default)]
        conversations_memory: String,
        #[serde(default)]
        project_memories: std::collections::HashMap<String, String>,
    }

    let accounts: Vec<ClaudeMemoryAccount> =
        serde_json::from_slice(mem_bytes).map_err(|e| format!("Invalid memories JSON: {e}"))?;

    let account = accounts.into_iter().next().unwrap_or(ClaudeMemoryAccount {
        conversations_memory: String::new(),
        project_memories: std::collections::HashMap::new(),
    });

    // Build UUID → name map from projects.json
    let name_map: std::collections::HashMap<String, String> = project_bytes
        .and_then(|b| serde_json::from_slice::<Vec<ClaudeProject>>(b).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|p| (p.uuid, p.name))
        .collect();

    let project_memories: Vec<ClaudeProjectMemoryPreview> = account
        .project_memories
        .into_iter()
        .filter(|(_, mem)| !mem.trim().is_empty())
        .map(|(uuid, memory)| {
            let project_name = name_map
                .get(&uuid)
                .cloned()
                .unwrap_or_else(|| format!("Unknown project ({uuid})"));
            ClaudeProjectMemoryPreview {
                project_uuid: uuid,
                project_name,
                memory,
            }
        })
        .collect();

    Ok(ClaudeMemoryPreview {
        conversations_memory: account.conversations_memory,
        project_memories,
    })
}

/// Lightweight preview of a Claude Desktop conversation for the UI picker.
#[derive(Debug, Clone, Serialize)]
pub struct ClaudeConversationPreview {
    pub uuid: String,
    pub name: String,
    pub message_count: usize,
    pub created_at: String,
    pub updated_at: String,
}

/// Lightweight preview of a Claude Desktop project for the UI picker.
#[derive(Debug, Clone, Serialize)]
pub struct ClaudeProjectPreview {
    pub uuid: String,
    pub name: String,
    pub description: String,
    pub has_prompt: bool,
    pub doc_count: usize,
}

/// Preview of Claude Desktop memories.
#[derive(Debug, Clone, Serialize)]
pub struct ClaudeMemoryPreview {
    pub conversations_memory: String,
    pub project_memories: Vec<ClaudeProjectMemoryPreview>,
}

/// A single project memory entry for preview.
#[derive(Debug, Clone, Serialize)]
pub struct ClaudeProjectMemoryPreview {
    pub project_uuid: String,
    pub project_name: String,
    pub memory: String,
}

/// Parse `conversations.json` and return lightweight previews (no message content).
pub fn preview_claude_conversations(bytes: &[u8]) -> Result<Vec<ClaudeConversationPreview>, String> {
    let conversations: Vec<ClaudeConversation> =
        serde_json::from_slice(bytes).map_err(|e| format!("Invalid Claude Desktop JSON: {e}"))?;

    Ok(conversations
        .into_iter()
        .filter(|c| !c.chat_messages.is_empty())
        .map(|c| {
            let msg_count = c.chat_messages.len();
            ClaudeConversationPreview {
                uuid: c.uuid,
                name: c.name,
                message_count: msg_count,
                created_at: c.created_at,
                updated_at: c.updated_at,
            }
        })
        .collect())
}

/// Parse a Claude Desktop `conversations.json`, filtering to only the given UUIDs.
/// If `selected_ids` is empty, parses all.
pub fn parse_claude_conversations_filtered(
    bytes: &[u8],
    selected_ids: &[String],
) -> Result<Vec<ChatFileData>, String> {
    if selected_ids.is_empty() {
        return parse_claude_conversations(bytes);
    }

    let conversations: Vec<ClaudeConversation> =
        serde_json::from_slice(bytes).map_err(|e| format!("Invalid Claude Desktop JSON: {e}"))?;

    let id_set: std::collections::HashSet<&str> =
        selected_ids.iter().map(|s| s.as_str()).collect();

    let mut results = Vec::new();

    for conv in &conversations {
        if !id_set.contains(conv.uuid.as_str()) {
            continue;
        }
        if conv.chat_messages.is_empty() {
            continue;
        }

        let messages: Vec<ChatFileMessage> = conv
            .chat_messages
            .iter()
            .filter_map(|msg| {
                let role = match msg.sender.as_str() {
                    "human" => "user",
                    "assistant" => "assistant",
                    _ => return None,
                };
                let content = extract_claude_message_content(msg);
                if content.is_empty() {
                    return None;
                }
                Some(ChatFileMessage {
                    id: msg.uuid.clone(),
                    role: role.to_string(),
                    content,
                    model: if role == "assistant" {
                        Some("claude".to_string())
                    } else {
                        None
                    },
                    tokens_used: None,
                    duration_ms: None,
                    timestamp: msg.created_at.clone(),
                })
            })
            .collect();

        if messages.is_empty() {
            continue;
        }

        results.push(ChatFileData {
            id: conv.uuid.clone(),
            title: conv.name.clone(),
            model: "claude".to_string(),
            system_prompt: String::new(),
            created_at: conv.created_at.clone(),
            updated_at: conv.updated_at.clone(),
            messages,
        });
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
}
