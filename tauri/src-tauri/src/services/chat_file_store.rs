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
