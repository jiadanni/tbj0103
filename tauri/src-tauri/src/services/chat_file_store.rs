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

use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use rusqlite::Connection;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

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

/// Returns the file path for a session. Encrypted files use `.json.enc`.
pub fn session_file_path(chats_dir: &Path, session_id: &str, encrypted: bool) -> PathBuf {
    if encrypted {
        chats_dir.join(format!("{}.json.enc", session_id))
    } else {
        chats_dir.join(format!("{}.json", session_id))
    }
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

/// Write a chat session to its JSON file.
/// Pass `passphrase = Some(p)` to encrypt, `None` for plaintext.
/// Best-effort: callers should tolerate errors gracefully.
pub fn write_session_file(
    conn: &Connection,
    chats_dir: &Path,
    session_id: &str,
    passphrase: Option<&str>,
) -> Result<(), String> {
    std::fs::create_dir_all(chats_dir).map_err(|e| e.to_string())?;

    let data = load_from_db(conn, session_id)?;
    let json_bytes = serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?;

    if let Some(pass) = passphrase {
        use aes_gcm::aead::{AeadCore, KeyInit, Aead, OsRng};
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

        let enc_path = session_file_path(chats_dir, session_id, true);
        // Remove plaintext twin
        let _ = std::fs::remove_file(session_file_path(chats_dir, session_id, false));
        let out = serde_json::to_vec_pretty(&envelope).map_err(|e| e.to_string())?;
        std::fs::write(enc_path, out).map_err(|e| e.to_string())?;
    } else {
        let plain_path = session_file_path(chats_dir, session_id, false);
        // Remove encrypted twin
        let _ = std::fs::remove_file(session_file_path(chats_dir, session_id, true));
        std::fs::write(plain_path, &json_bytes).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Delete both file variants (plain + encrypted) for a session.
pub fn delete_session_file(chats_dir: &Path, session_id: &str) {
    let _ = std::fs::remove_file(session_file_path(chats_dir, session_id, false));
    let _ = std::fs::remove_file(session_file_path(chats_dir, session_id, true));
}

/// Read and optionally decrypt a chat JSON file.
pub fn read_session_file(path: &Path, passphrase: Option<&str>) -> Result<ChatFileData, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;

    if value.get("encrypted").and_then(|v| v.as_bool()) == Some(true) {
        let pass =
            passphrase.ok_or_else(|| "Passphrase required to open encrypted chat".to_string())?;
        let ef: EncryptedFile =
            serde_json::from_value(value).map_err(|e| e.to_string())?;

        use aes_gcm::aead::{KeyInit, Aead};
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
             (id, workspace_id, project_id, title, model_name, system_prompt, is_pinned, is_incognito, exclude_from_analytics, is_deleted, deleted_at, parent_session_id, branch_message_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, 0, 0, NULL, NULL, NULL, ?7, ?8)",
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
                uuid::Uuid::new_v4().to_string(), session_id, role, msg.content,
                msg.model, msg.tokens_used, msg.duration_ms, msg.timestamp
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
    created_at: Option<u64>,           // epoch ms
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
        let idx = slot.currently_selected.unwrap_or(0).min(slot.versions.len() - 1);
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
                            && block.style.as_ref().and_then(|style| style.style_type.as_deref()) == Some("thinking")
                        {
                            thought_title = block.style.as_ref().and_then(|style| style.title.clone());
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
            model_name = version.sender_info.as_ref().and_then(|s| s.sender_name.clone());
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

    let title = conv.name.clone().unwrap_or_else(|| "Imported Chat".to_string());
    let created = conv.created_at.map(epoch_ms_to_iso)
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let model = conv.last_used_model.as_ref()
        .and_then(|m| m.identifier.clone())
        .unwrap_or_default();
    let system_prompt = lm_effective_system_prompt(&conv);

    let messages = extract_messages_from_lm_conversation(&conv);
    if messages.is_empty() {
        return Err("Conversation contains no importable user, assistant, or system messages.".to_string());
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
pub fn discover_lmstudio_conversations(folder: &Path) -> Result<Vec<DiscoveredConversation>, String> {
    let mut results = Vec::new();

    fn walk(dir: &Path, root: &Path, results: &mut Vec<DiscoveredConversation>) -> Result<(), String> {
        let entries = std::fs::read_dir(dir).map_err(|e| format!("Cannot read {}: {e}", dir.display()))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, root, results)?;
            } else if path.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.ends_with(".conversation.json"))
                .unwrap_or(false)
            {
                // Determine the subfolder: immediate parent relative to root
                let subfolder = path.parent()
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
              deleted_at, parent_session_id, branch_message_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, 0, 0, NULL, NULL, NULL, ?7, ?8)",
        rusqlite::params![
            session_id, workspace_id, project_id,
            data.title, data.model, data.system_prompt,
            data.created_at, data.updated_at
        ],
    ).map_err(|e| e.to_string())?;

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
                uuid::Uuid::new_v4().to_string(), session_id, role,
                msg.content, msg.model, msg.tokens_used, msg.duration_ms,
                msg.timestamp
            ],
        ).map_err(|e| e.to_string())?;
    }

    Ok(session_id)
}

/// Re-encrypt (or decrypt) every chat file in `chats_dir`.
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
    let entries = std::fs::read_dir(chats_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
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

        if let Some(pass) = new_passphrase {
            use aes_gcm::aead::{AeadCore, KeyInit, Aead, OsRng};
            use aes_gcm::Aes256Gcm;
            use aes_gcm::aead::rand_core::RngCore;

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
            let new_path = chats_dir.join(format!("{}.json.enc", stem));
            let _ = std::fs::remove_file(chats_dir.join(format!("{}.json", stem)));
            let _ = std::fs::remove_file(chats_dir.join(format!("{}.json.enc", stem)));
            if let Ok(out) = serde_json::to_vec_pretty(&envelope) {
                let _ = std::fs::write(new_path, out);
            }
        } else {
            let new_path = chats_dir.join(format!("{}.json", stem));
            let _ = std::fs::remove_file(chats_dir.join(format!("{}.json.enc", stem)));
            let _ = std::fs::remove_file(chats_dir.join(format!("{}.json", stem)));
            let _ = std::fs::write(new_path, &json_bytes);
        }
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn parses_and_imports_mac_lmstudio_conversation_fixture() {
        let fixture_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("conversations-mac")
            .join("General")
            .join("1760004488608.conversation.json");
        let bytes = std::fs::read(&fixture_path).expect("fixture should be readable");
        let parsed = parse_lmstudio_conversation(&bytes).expect("fixture should parse");

        assert!(!parsed.messages.is_empty(), "fixture should yield importable messages");

        let conn = Connection::open_in_memory().expect("in-memory db should open");
        conn.execute_batch(include_str!("../schema.sql"))
            .expect("schema should initialize");
        conn.execute(
            "INSERT INTO workspaces (id, name, description, prompt_instructions, topic_signature, created_at, updated_at)
             VALUES (?1, ?2, '', '', '{}', datetime('now'), datetime('now'))",
            rusqlite::params!["ws-test", "Fixture Workspace"],
        )
        .expect("workspace insert should succeed");

        let session_id = import_chat_data(&conn, &parsed, "ws-test", "")
            .expect("fixture should import into sqlite");

        let message_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE session_id = ?1",
                rusqlite::params![session_id],
                |row| row.get(0),
            )
            .expect("message count query should succeed");

        assert!(message_count > 0, "imported session should persist messages");
    }
}
