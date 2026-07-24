use std::sync::atomic::{AtomicBool, Ordering};

use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::DbState;

const PIN_HASH_KEY: &str = "pin_passcode_hash";
const PIN_ITERATIONS: u32 = 100_000;
const PIN_FAILED_ATTEMPTS_KEY: &str = "pin_failed_attempts";
const PIN_LOCKOUT_UNTIL_KEY: &str = "pin_lockout_until";
const MAX_PIN_ATTEMPTS: u32 = 5;

/// Backend authentication state — tracks whether the app has been unlocked.
/// Prevents IPC bypass of the lock screen (e.g. via DevTools or injected JS).
pub struct AuthState(pub AtomicBool);

impl Default for AuthState {
    fn default() -> Self {
        // Start locked; the frontend must call unlock_app after successful auth
        Self(AtomicBool::new(false))
    }
}

/// Returns an error if the app is locked and auth is required.
/// Commands that handle sensitive data should call this at the top.
pub fn require_auth(auth: &State<AuthState>, db: &State<DbState>) -> Result<(), String> {
    // If no lock is configured, auth is not required
    let conn = db.0.get().map_err(|e| e.to_string())?;
    let pin_enabled = get_setting(&conn, PIN_HASH_KEY)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);
    let pin_lock_enabled = get_setting(&conn, "pin_lock_enabled")
        .and_then(|v| v.parse().ok())
        .unwrap_or(false)
        && pin_enabled;
    let touch_id_enabled = get_setting(&conn, "touch_id_enabled")
        .map(|v| v == "true")
        .unwrap_or(false)
        && pin_lock_enabled;

    if !pin_lock_enabled && !touch_id_enabled {
        return Ok(());
    }

    if !auth.0.load(Ordering::Acquire) {
        return Err("App is locked. Please authenticate first.".to_string());
    }
    Ok(())
}

/// Like `require_auth`, but only enforced when the `strict_auth_mode`
/// setting is enabled. Disabled by default — destructive operations are
/// unprotected unless the user opts in via Settings → Security.
pub fn require_auth_for_destructive_ops(
    auth: &State<AuthState>,
    db: &State<DbState>,
) -> Result<(), String> {
    let conn = db.0.get().map_err(|e| e.to_string())?;
    let strict = get_setting(&conn, "strict_auth_mode")
        .map(|v| v == "true")
        .unwrap_or(false);
    if !strict {
        return Ok(());
    }
    // Delegate to the standard auth check
    require_auth(auth, db)
}

fn biometric_available() -> bool {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        true
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

fn biometric_label() -> String {
    #[cfg(target_os = "macos")]
    {
        "Touch ID".to_string()
    }

    #[cfg(target_os = "windows")]
    {
        "Windows Hello".to_string()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "Biometric authentication".to_string()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityStatus {
    pub pin_enabled: bool,
    pub pin_lock_enabled: bool,
    pub touch_id_enabled: bool,
    pub biometric_available: bool,
    pub biometric_label: String,
}

fn get_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    )
    .ok()
}

fn set_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn validate_pin(pin: &str) -> Result<(), String> {
    if pin.len() < 4 || pin.len() > 8 {
        return Err("PIN must be 4 to 8 digits.".to_string());
    }
    if !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("PIN must contain digits only.".to_string());
    }
    Ok(())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }

    let mut diff = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hex_to_bytes(value: &str) -> Result<Vec<u8>, String> {
    if !value.len().is_multiple_of(2) {
        return Err("Stored PIN data is invalid.".to_string());
    }

    value
        .as_bytes()
        .chunks(2)
        .map(|chunk| {
            std::str::from_utf8(chunk)
                .map_err(|_| "Stored PIN data is invalid.".to_string())
                .and_then(|pair| {
                    u8::from_str_radix(pair, 16)
                        .map_err(|_| "Stored PIN data is invalid.".to_string())
                })
        })
        .collect()
}

fn generate_pin_hash(pin: &str) -> String {
    let salt_seed = uuid::Uuid::new_v4().to_string();
    let salt = Sha256::digest(salt_seed.as_bytes());
    let mut derived_key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(pin.as_bytes(), &salt, PIN_ITERATIONS, &mut derived_key);
    format!(
        "pbkdf2_sha256${}${}${}",
        PIN_ITERATIONS,
        bytes_to_hex(&salt),
        bytes_to_hex(&derived_key)
    )
}

fn verify_pin_hash(pin: &str, stored_hash: &str) -> Result<bool, String> {
    let parts: Vec<&str> = stored_hash.split('$').collect();
    if parts.len() != 4 || parts[0] != "pbkdf2_sha256" {
        return Err("Stored PIN data is invalid.".to_string());
    }

    let iterations = parts[1]
        .parse::<u32>()
        .map_err(|_| "Stored PIN data is invalid.".to_string())?;
    let salt = hex_to_bytes(parts[2])?;
    let expected = hex_to_bytes(parts[3])?;
    let mut derived_key = vec![0u8; expected.len()];

    pbkdf2_hmac::<Sha256>(pin.as_bytes(), &salt, iterations, &mut derived_key);
    Ok(constant_time_eq(&derived_key, &expected))
}

#[tauri::command]
pub async fn get_security_status(state: State<'_, DbState>) -> Result<SecurityStatus, String> {
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || -> Result<SecurityStatus, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let pin_enabled = get_setting(&conn, PIN_HASH_KEY)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
        let pin_lock_enabled = get_setting(&conn, "pin_lock_enabled")
            .and_then(|value| value.parse().ok())
            .unwrap_or(false)
            && pin_enabled;
        let biometric_available = biometric_available();
        let touch_id_enabled = get_setting(&conn, "touch_id_enabled")
            .map(|value| value == "true")
            .unwrap_or(false)
            && biometric_available
            && pin_lock_enabled;

        Ok(SecurityStatus {
            pin_enabled,
            pin_lock_enabled,
            touch_id_enabled,
            biometric_available,
            biometric_label: biometric_label(),
        })
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
}

#[tauri::command]
pub fn set_pin_passcode(
    app: AppHandle,
    state: State<DbState>,
    current_pin: Option<String>,
    new_pin: String,
) -> Result<(), String> {
    validate_pin(&new_pin)?;

    let conn = state.0.get().map_err(|e| e.to_string())?;
    let existing_hash = get_setting(&conn, PIN_HASH_KEY).unwrap_or_default();

    if !existing_hash.trim().is_empty() {
        let provided = current_pin
            .as_ref()
            .ok_or_else(|| "Current PIN is required.".to_string())?;
        if !verify_pin_hash(provided, &existing_hash)? {
            return Err("Current PIN is incorrect.".to_string());
        }
    }

    let hash = generate_pin_hash(&new_pin);
    set_setting(&conn, PIN_HASH_KEY, &hash)?;

    // If DB encryption is configured, re-wrap the DEK with a KEK derived from
    // the new PIN. Without this, changing the PIN would break unlock.
    let db_path = db_path_from_app(&app)?;
    if crate::services::db_encryption::sidecar_exists(&db_path) {
        let provided = current_pin
            .ok_or_else(|| "Current PIN is required to re-wrap the encryption key.".to_string())?;
        let dek = crate::services::db_encryption::unwrap_dek_with_pin(&db_path, &provided)?;
        crate::services::db_encryption::rewrap_dek(&db_path, &dek, &new_pin)?;
    }

    let _ = app.emit("settings-changed", ());
    Ok(())
}

#[tauri::command]
pub fn verify_pin_passcode(state: State<DbState>, pin: String) -> Result<bool, String> {
    validate_pin(&pin)?;

    let conn = state.0.get().map_err(|e| e.to_string())?;

    // Check lockout
    if let Some(lockout_until) = get_setting(&conn, PIN_LOCKOUT_UNTIL_KEY) {
        if let Ok(until) = lockout_until.parse::<i64>() {
            let now = chrono::Utc::now().timestamp();
            if now < until {
                let remaining = until - now;
                return Err(format!(
                    "Too many failed attempts. Try again in {} seconds.",
                    remaining
                ));
            }
            // Lockout expired — clear it
            set_setting(&conn, PIN_FAILED_ATTEMPTS_KEY, "0")?;
            set_setting(&conn, PIN_LOCKOUT_UNTIL_KEY, "")?;
        }
    }

    let stored_hash = get_setting(&conn, PIN_HASH_KEY).unwrap_or_default();

    if stored_hash.trim().is_empty() {
        return Err("No PIN passcode is configured.".to_string());
    }

    let result = verify_pin_hash(&pin, &stored_hash)?;

    if result {
        // Success — reset failed attempts
        set_setting(&conn, PIN_FAILED_ATTEMPTS_KEY, "0")?;
        set_setting(&conn, PIN_LOCKOUT_UNTIL_KEY, "")?;
    } else {
        // Failure — increment attempts and apply exponential backoff
        let attempts: u32 = get_setting(&conn, PIN_FAILED_ATTEMPTS_KEY)
            .and_then(|v| v.parse().ok())
            .unwrap_or(0)
            + 1;
        set_setting(&conn, PIN_FAILED_ATTEMPTS_KEY, &attempts.to_string())?;

        if attempts >= MAX_PIN_ATTEMPTS {
            // Exponential backoff: 30s, 60s, 120s, 240s, ... capped at 900s (15 min)
            let rounds_over = attempts - MAX_PIN_ATTEMPTS;
            let lockout_secs: i64 = std::cmp::min(30 * (1i64 << rounds_over), 900);
            let until = chrono::Utc::now().timestamp() + lockout_secs;
            set_setting(&conn, PIN_LOCKOUT_UNTIL_KEY, &until.to_string())?;
            return Err(format!(
                "Too many failed attempts. Try again in {} seconds.",
                lockout_secs
            ));
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn remove_pin_passcode(
    app: AppHandle,
    state: State<DbState>,
    current_pin: String,
) -> Result<(), String> {
    validate_pin(&current_pin)?;

    let conn = state.0.get().map_err(|e| e.to_string())?;
    let stored_hash = get_setting(&conn, PIN_HASH_KEY).unwrap_or_default();

    if stored_hash.trim().is_empty() {
        return Err("No PIN passcode is configured.".to_string());
    }

    if !verify_pin_hash(&current_pin, &stored_hash)? {
        return Err("Current PIN is incorrect.".to_string());
    }

    // Removing the PIN while DB encryption is configured would leave the
    // encrypted DB orphaned (no way to derive the KEK). Require the user
    // to disable encryption first.
    let db_path = db_path_from_app(&app)?;
    if crate::services::db_encryption::sidecar_exists(&db_path) {
        return Err("Disable database encryption before removing the PIN passcode.".to_string());
    }

    set_setting(&conn, PIN_HASH_KEY, "")?;
    set_setting(&conn, "pin_lock_enabled", "false")?;
    set_setting(&conn, "touch_id_enabled", "false")?;
    let _ = app.emit("settings-changed", ());
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn authenticate_biometric() -> Result<bool, String> {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel::<bool>();
    let tx_shared = Arc::new(Mutex::new(Some(tx)));
    let tx_for_block = tx_shared.clone();

    unsafe {
        let context = LAContext::new();
        let reason = NSString::from_str("Unlock Aetherium");
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
            &reason,
            &RcBlock::new(move |success: Bool, _error: *mut NSError| {
                if let Ok(mut guard) = tx_for_block.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(success.as_bool());
                    }
                }
            }),
        );
    }

    rx.await
        .map_err(|_| "Authentication was cancelled.".to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn authenticate_biometric() -> Result<bool, String> {
    Ok(false)
}

/// Called by the frontend to unlock the app.
/// Verifies the PIN server-side before setting the auth state.
/// For biometric unlock, pass `biometric: true` with `pin` omitted —
/// the biometric challenge must already have succeeded via
/// `authenticate_biometric`.
#[tauri::command]
pub fn unlock_app(
    auth: State<AuthState>,
    state: State<DbState>,
    pin: Option<String>,
    biometric: Option<bool>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    // If no lock is configured, just unlock
    let stored_hash = get_setting(&conn, PIN_HASH_KEY).unwrap_or_default();
    let pin_lock_enabled = get_setting(&conn, "pin_lock_enabled")
        .and_then(|v| v.parse().ok())
        .unwrap_or(false)
        && !stored_hash.trim().is_empty();

    if !pin_lock_enabled {
        auth.0.store(true, Ordering::Release);
        return Ok(());
    }

    // Biometric path: the OS-level challenge already ran in authenticate_biometric.
    // We trust that result because it is a Tauri command that cannot be faked from JS.
    if biometric.unwrap_or(false) {
        let touch_id_enabled = get_setting(&conn, "touch_id_enabled")
            .map(|v| v == "true")
            .unwrap_or(false);
        if !touch_id_enabled {
            return Err("Biometric authentication is not enabled.".to_string());
        }
        auth.0.store(true, Ordering::Release);
        return Ok(());
    }

    // PIN path: verify server-side
    let pin = pin.ok_or_else(|| "PIN is required to unlock.".to_string())?;
    validate_pin(&pin)?;

    // Check lockout
    if let Some(lockout_until) = get_setting(&conn, PIN_LOCKOUT_UNTIL_KEY) {
        if let Ok(until) = lockout_until.parse::<i64>() {
            let now = chrono::Utc::now().timestamp();
            if now < until {
                let remaining = until - now;
                return Err(format!(
                    "Too many failed attempts. Try again in {} seconds.",
                    remaining
                ));
            }
            set_setting(&conn, PIN_FAILED_ATTEMPTS_KEY, "0")?;
            set_setting(&conn, PIN_LOCKOUT_UNTIL_KEY, "")?;
        }
    }

    if !verify_pin_hash(&pin, &stored_hash)? {
        // Increment failed attempts
        let attempts: u32 = get_setting(&conn, PIN_FAILED_ATTEMPTS_KEY)
            .and_then(|v| v.parse().ok())
            .unwrap_or(0)
            + 1;
        set_setting(&conn, PIN_FAILED_ATTEMPTS_KEY, &attempts.to_string())?;

        if attempts >= MAX_PIN_ATTEMPTS {
            let rounds_over = attempts - MAX_PIN_ATTEMPTS;
            let lockout_secs: i64 = std::cmp::min(30 * (1i64 << rounds_over), 900);
            let until = chrono::Utc::now().timestamp() + lockout_secs;
            set_setting(&conn, PIN_LOCKOUT_UNTIL_KEY, &until.to_string())?;
            return Err(format!(
                "Too many failed attempts. Try again in {} seconds.",
                lockout_secs
            ));
        }

        return Err("Incorrect PIN.".to_string());
    }

    // Success — reset failed attempts and unlock
    set_setting(&conn, PIN_FAILED_ATTEMPTS_KEY, "0")?;
    set_setting(&conn, PIN_LOCKOUT_UNTIL_KEY, "")?;
    auth.0.store(true, Ordering::Release);
    Ok(())
}

/// Called by the frontend when the user locks the app or on session timeout.
#[tauri::command]
pub fn lock_app(auth: State<AuthState>) -> Result<(), String> {
    auth.0.store(false, Ordering::Release);
    Ok(())
}

// ─── DB encryption ────────────────────────────────────────────────────────
//
// PIN-tied SQLCipher encryption. The DEK is a random 32 bytes wrapped by a
// PIN-derived KEK (Argon2id). The wrapped DEK lives in a sidecar file next
// to the DB so we can detect "encryption configured" without opening the DB.
//
// Enable/disable do NOT swap the live DB pool. They stage the change in a
// pending sidecar and prompt the user to restart; the actual encrypt/decrypt
// runs at next launch before the pool is built.

use std::path::PathBuf;

use crate::services::db_encryption;

fn db_path_from_app(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(app_dir.join("aetherium.db"))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DbEncryptionStatus {
    /// True when the sidecar file exists. Indicates encryption is configured
    /// (or pending) regardless of whether the live DB has been re-encrypted yet.
    pub configured: bool,
    /// True when there is a pending encrypt/decrypt action that will run on
    /// next launch. When set, the UI should prompt the user to restart.
    pub pending_restart: bool,
    /// "encrypt" | "decrypt" | "" — what will happen on next launch.
    pub pending_action: String,
}

#[tauri::command]
pub async fn get_db_encryption_status(app: AppHandle) -> Result<DbEncryptionStatus, String> {
    let db_path = db_path_from_app(&app)?;
    tokio::task::spawn_blocking(move || -> Result<DbEncryptionStatus, String> {
        let configured = db_encryption::sidecar_exists(&db_path);
        if !configured {
            return Ok(DbEncryptionStatus {
                configured: false,
                pending_restart: false,
                pending_action: String::new(),
            });
        }
        let sidecar = db_encryption::read_sidecar(&db_path).ok();
        let pending = sidecar
            .as_ref()
            .and_then(|s| s.pending_action.clone())
            .unwrap_or_default();
        Ok(DbEncryptionStatus {
            configured,
            pending_restart: !pending.is_empty(),
            pending_action: pending,
        })
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
}

/// Stage DB encryption. Verifies the supplied PIN against the configured
/// PIN hash, generates a fresh DEK, wraps it with a PIN-derived KEK, and
/// writes the sidecar with `pending_action = "encrypt"`. The actual
/// `encrypt_in_place` runs at next launch.
#[tauri::command]
pub async fn enable_db_encryption(
    app: AppHandle,
    state: State<'_, DbState>,
    pin: String,
) -> Result<(), String> {
    validate_pin(&pin)?;

    // PIN must be configured first; encryption is layered on top of it.
    let pool = state.0.clone();
    let stored_hash = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        Ok(get_setting(&conn, PIN_HASH_KEY).unwrap_or_default())
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))??;

    if stored_hash.trim().is_empty() {
        return Err("Configure a PIN passcode before enabling database encryption.".to_string());
    }
    if !verify_pin_hash(&pin, &stored_hash)? {
        return Err("Incorrect PIN.".to_string());
    }

    let db_path = db_path_from_app(&app)?;
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        if db_encryption::sidecar_exists(&db_path) {
            return Err("Database encryption is already configured.".to_string());
        }
        let mut sidecar = db_encryption::build_sidecar_for_pin(&pin)?;
        sidecar.pending_action = Some("encrypt".to_string());
        db_encryption::write_sidecar(&db_path, &sidecar)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))??;

    let _ = app.emit("settings-changed", ());
    Ok(())
}

/// Stage DB decryption. Verifies the PIN can unwrap the DEK, then marks the
/// sidecar with `pending_action = "decrypt"`. The actual `decrypt_in_place`
/// runs at next launch.
#[tauri::command]
pub async fn disable_db_encryption(app: AppHandle, pin: String) -> Result<(), String> {
    validate_pin(&pin)?;
    let db_path = db_path_from_app(&app)?;

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        if !db_encryption::sidecar_exists(&db_path) {
            return Err("Database encryption is not configured.".to_string());
        }
        // Verify PIN by attempting to unwrap.
        let _dek = db_encryption::unwrap_dek_with_pin(&db_path, &pin)?;
        let mut sidecar = db_encryption::read_sidecar(&db_path)?;
        sidecar.pending_action = Some("decrypt".to_string());
        db_encryption::write_sidecar(&db_path, &sidecar)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))??;

    let _ = app.emit("settings-changed", ());
    Ok(())
}

/// Cancel a pending encrypt/decrypt action staged by enable/disable.
#[tauri::command]
pub async fn cancel_pending_db_encryption(app: AppHandle, pin: String) -> Result<(), String> {
    validate_pin(&pin)?;
    let db_path = db_path_from_app(&app)?;

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        if !db_encryption::sidecar_exists(&db_path) {
            return Err("Nothing to cancel.".to_string());
        }
        let mut sidecar = db_encryption::read_sidecar(&db_path)?;
        let pending = sidecar.pending_action.clone().unwrap_or_default();
        if pending.is_empty() {
            return Err("No pending action to cancel.".to_string());
        }

        // For "encrypt" pending: DB is still plain, so we can just delete the
        // sidecar (revert to plain). For "decrypt" pending: DB is encrypted —
        // we need the PIN to confirm cancellation and we leave the sidecar in
        // place but clear the marker.
        match pending.as_str() {
            "encrypt" => {
                // Verify PIN by trying to unwrap before deleting.
                let _ = db_encryption::unwrap_dek_with_pin(&db_path, &pin)?;
                db_encryption::remove_sidecar(&db_path)?;
            }
            "decrypt" => {
                let _ = db_encryption::unwrap_dek_with_pin(&db_path, &pin)?;
                sidecar.pending_action = None;
                db_encryption::write_sidecar(&db_path, &sidecar)?;
            }
            other => {
                return Err(format!("Unknown pending action: {other}"));
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))??;

    let _ = app.emit("settings-changed", ());
    Ok(())
}
