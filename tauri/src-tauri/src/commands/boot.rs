//! Boot-time orchestration for the encrypted-DB unlock flow.
//!
//! When the app launches with a sidecar present, the main React app mounts
//! but the SQLite pool has NOT been opened. The frontend calls
//! `boot_check_state` to learn that an unlock is required, takes a PIN from
//! the user, then calls `boot_unlock(pin)`. That command unwraps the DEK,
//! processes any pending action, opens the keyed pool, and completes the
//! rest of app setup (the `complete_db_dependent_setup` helper in lib.rs).

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct BootState {
    pub app_dir: PathBuf,
    pub db_path: PathBuf,
}

impl BootState {
    pub fn new(app_dir: PathBuf, db_path: PathBuf) -> Self {
        Self { app_dir, db_path }
    }
}

#[derive(Debug, Serialize)]
pub struct BootStatus {
    /// True when the DB is currently locked and the frontend should show
    /// the unlock route before mounting the rest of the app.
    pub unlock_required: bool,
    /// "encrypt" | "decrypt" | ""
    pub pending_action: String,
}

#[tauri::command]
pub async fn boot_check_state(boot: State<'_, BootState>) -> Result<BootStatus, String> {
    let db_path = boot.db_path.clone();
    tokio::task::spawn_blocking(move || -> Result<BootStatus, String> {
        if !crate::services::db_encryption::sidecar_exists(&db_path) {
            return Ok(BootStatus {
                unlock_required: false,
                pending_action: String::new(),
            });
        }
        let sidecar = crate::services::db_encryption::read_sidecar(&db_path).ok();
        let pending = sidecar.and_then(|s| s.pending_action).unwrap_or_default();
        Ok(BootStatus {
            unlock_required: true,
            pending_action: pending,
        })
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
}

#[tauri::command]
pub async fn boot_unlock(app: AppHandle, pin: String) -> Result<(), String> {
    let (db_path, app_dir) = {
        let boot = app.state::<BootState>();
        (boot.db_path.clone(), boot.app_dir.clone())
    };

    // Run the unwrap + any pending encrypt/decrypt on a blocking thread.
    let (pool, _was_kept_encrypted) = tokio::task::spawn_blocking({
        let db_path = db_path.clone();
        move || -> Result<(crate::db::DbPool, bool), String> {
            let sidecar = crate::services::db_encryption::read_sidecar(&db_path)?;
            let dek = crate::services::db_encryption::unwrap_dek_with_pin(&db_path, &pin)?;
            let mut keep_encrypted = true;
            match sidecar.pending_action.as_deref() {
                Some("encrypt") => {
                    crate::services::db_encryption::encrypt_in_place(&db_path, &dek)?;
                    let mut cleared = sidecar;
                    cleared.pending_action = None;
                    crate::services::db_encryption::write_sidecar(&db_path, &cleared)?;
                }
                Some("decrypt") => {
                    crate::services::db_encryption::decrypt_in_place(&db_path, &dek)?;
                    crate::services::db_encryption::remove_sidecar(&db_path)?;
                    keep_encrypted = false;
                }
                Some(other) => {
                    return Err(format!("Unknown pending DB action: {other}"));
                }
                None => {}
            }
            let pool = if keep_encrypted {
                let mut key = [0u8; 32];
                key.copy_from_slice(&*dek);
                crate::db::initialize_database_with_key(&db_path, Some(key))
                    .map_err(|e| format!("Failed to initialize encrypted database: {e}"))?
            } else {
                crate::db::initialize_database(&db_path)
                    .map_err(|e| format!("Failed to initialize database: {e}"))?
            };
            Ok((pool, keep_encrypted))
        }
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))??;

    // Finish the rest of setup with the open pool. complete_db_dependent_setup
    // lives in lib.rs.
    crate::complete_db_dependent_setup(app.clone(), app_dir, pool)?;

    // Tell the frontend that the main app is ready to mount.
    let _ = app.emit("boot-unlocked", ());
    Ok(())
}
