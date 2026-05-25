use std::sync::atomic::{AtomicBool, Ordering};

use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};

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
        return "Touch ID".to_string();
    }

    #[cfg(target_os = "windows")]
    {
        return "Windows Hello".to_string();
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
pub fn get_security_status(state: State<DbState>) -> Result<SecurityStatus, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
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
        let provided = current_pin.ok_or_else(|| "Current PIN is required.".to_string())?;
        if !verify_pin_hash(&provided, &existing_hash)? {
            return Err("Current PIN is incorrect.".to_string());
        }
    }

    let hash = generate_pin_hash(&new_pin);
    set_setting(&conn, PIN_HASH_KEY, &hash)?;
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

/// Called by the frontend after successful PIN or biometric authentication.
/// Sets the backend auth state to unlocked so that protected commands work.
#[tauri::command]
pub fn unlock_app(auth: State<AuthState>) -> Result<(), String> {
    auth.0.store(true, Ordering::Release);
    Ok(())
}

/// Called by the frontend when the user locks the app or on session timeout.
#[tauri::command]
pub fn lock_app(auth: State<AuthState>) -> Result<(), String> {
    auth.0.store(false, Ordering::Release);
    Ok(())
}
