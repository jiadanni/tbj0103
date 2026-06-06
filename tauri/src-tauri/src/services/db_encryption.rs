//! Database encryption: PIN-derived KEK wraps a random DEK; DEK is the
//! SQLCipher key for the main aetherium.db. The wrapped DEK + KDF params
//! live in a small sidecar file next to the DB so we can detect "encryption
//! on" without opening the DB first.

use std::fs;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

pub const SIDECAR_FILENAME: &str = "aetherium.db.keywrap";

const SIDECAR_VERSION: u32 = 1;
const KDF_KIND: &str = "argon2id";
const DEK_LEN: usize = 32;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

// Argon2id parameters: 64 MiB, 3 iterations, parallelism 1.
// ~300ms on a modern laptop — fine for a one-time unlock.
const ARGON_MEM_KIB: u32 = 64 * 1024;
const ARGON_ITERS: u32 = 3;
const ARGON_PAR: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
pub struct Sidecar {
    pub version: u32,
    pub kdf: String,
    pub kdf_mem_kib: u32,
    pub kdf_iters: u32,
    pub kdf_par: u32,
    /// hex-encoded
    pub salt: String,
    /// hex-encoded
    pub nonce: String,
    /// hex-encoded ciphertext (includes GCM tag)
    pub wrapped_dek: String,
    pub created_at: String,
    /// Some("encrypt") or Some("decrypt") when a state change is staged and
    /// will run on next launch. None when the on-disk DB matches the sidecar.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_action: Option<String>,
}

pub fn sidecar_path(db_path: &Path) -> PathBuf {
    let mut p = db_path.to_path_buf();
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "aetherium.db".to_string());
    p.set_file_name(format!("{name}.keywrap"));
    p
}

pub fn sidecar_exists(db_path: &Path) -> bool {
    sidecar_path(db_path).exists()
}

pub fn read_sidecar(db_path: &Path) -> Result<Sidecar, String> {
    let path = sidecar_path(db_path);
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read keywrap file: {e}"))?;
    serde_json::from_slice::<Sidecar>(&bytes).map_err(|e| format!("Corrupt keywrap file: {e}"))
}

pub fn write_sidecar(db_path: &Path, sidecar: &Sidecar) -> Result<(), String> {
    let final_path = sidecar_path(db_path);
    let tmp_path = final_path.with_extension("keywrap.tmp");
    let bytes = serde_json::to_vec_pretty(sidecar)
        .map_err(|e| format!("Failed to serialize keywrap: {e}"))?;
    fs::write(&tmp_path, &bytes).map_err(|e| format!("Failed to write keywrap tmp: {e}"))?;
    fs::rename(&tmp_path, &final_path)
        .map_err(|e| format!("Failed to commit keywrap file: {e}"))?;
    Ok(())
}

pub fn remove_sidecar(db_path: &Path) -> Result<(), String> {
    let path = sidecar_path(db_path);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete keywrap file: {e}"))?;
    }
    Ok(())
}

fn derive_kek(
    pin: &[u8],
    salt: &[u8],
    mem_kib: u32,
    iters: u32,
    par: u32,
) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(mem_kib, iters, par, Some(32))
        .map_err(|e| format!("Bad Argon2 params: {e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = Zeroizing::new([0u8; 32]);
    argon
        .hash_password_into(pin, salt, &mut *out)
        .map_err(|e| format!("Argon2 KDF failed: {e}"))?;
    Ok(out)
}

fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

pub fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    if !s.len().is_multiple_of(2) {
        return Err("Invalid hex length".to_string());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| format!("Bad hex: {e}")))
        .collect()
}

/// Generate a fresh DEK, wrap it with a PIN-derived KEK, persist the sidecar.
/// Returns the unwrapped DEK so the caller can immediately use it as the
/// SQLCipher key for the re-encrypt flow.
pub fn create_sidecar(db_path: &Path, pin: &str) -> Result<Zeroizing<[u8; DEK_LEN]>, String> {
    if sidecar_exists(db_path) {
        return Err("Encryption is already enabled.".to_string());
    }

    let mut dek = Zeroizing::new([0u8; DEK_LEN]);
    rand::thread_rng().fill_bytes(&mut *dek);

    let salt = random_bytes(SALT_LEN);
    let kek = derive_kek(pin.as_bytes(), &salt, ARGON_MEM_KIB, ARGON_ITERS, ARGON_PAR)?;
    let nonce_bytes = random_bytes(NONCE_LEN);

    let cipher = Aes256Gcm::new_from_slice(&*kek).map_err(|e| format!("AES init: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let wrapped = cipher
        .encrypt(nonce, dek.as_slice())
        .map_err(|e| format!("DEK wrap failed: {e}"))?;

    let sidecar = Sidecar {
        version: SIDECAR_VERSION,
        kdf: KDF_KIND.to_string(),
        kdf_mem_kib: ARGON_MEM_KIB,
        kdf_iters: ARGON_ITERS,
        kdf_par: ARGON_PAR,
        salt: hex_encode(&salt),
        nonce: hex_encode(&nonce_bytes),
        wrapped_dek: hex_encode(&wrapped),
        created_at: chrono::Utc::now().to_rfc3339(),
        pending_action: None,
    };
    write_sidecar(db_path, &sidecar)?;

    Ok(dek)
}

/// Build a sidecar in memory (does not write) using a PIN-derived KEK to wrap
/// a fresh DEK. Used by the staged-enable path: caller sets `pending_action`
/// and writes the sidecar themselves so the encrypt happens at next launch.
pub fn build_sidecar_for_pin(pin: &str) -> Result<Sidecar, String> {
    let mut dek = Zeroizing::new([0u8; DEK_LEN]);
    rand::thread_rng().fill_bytes(&mut *dek);

    let salt = random_bytes(SALT_LEN);
    let kek = derive_kek(pin.as_bytes(), &salt, ARGON_MEM_KIB, ARGON_ITERS, ARGON_PAR)?;
    let nonce_bytes = random_bytes(NONCE_LEN);

    let cipher = Aes256Gcm::new_from_slice(&*kek).map_err(|e| format!("AES init: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let wrapped = cipher
        .encrypt(nonce, dek.as_slice())
        .map_err(|e| format!("DEK wrap failed: {e}"))?;

    Ok(Sidecar {
        version: SIDECAR_VERSION,
        kdf: KDF_KIND.to_string(),
        kdf_mem_kib: ARGON_MEM_KIB,
        kdf_iters: ARGON_ITERS,
        kdf_par: ARGON_PAR,
        salt: hex_encode(&salt),
        nonce: hex_encode(&nonce_bytes),
        wrapped_dek: hex_encode(&wrapped),
        created_at: chrono::Utc::now().to_rfc3339(),
        pending_action: None,
    })
}

/// Unwrap the DEK using the given PIN. Returns `Err("Incorrect PIN.")`
/// on AEAD verification failure.
pub fn unwrap_dek_with_pin(
    db_path: &Path,
    pin: &str,
) -> Result<Zeroizing<[u8; DEK_LEN]>, String> {
    let sidecar = read_sidecar(db_path)?;
    if sidecar.kdf != KDF_KIND {
        return Err(format!("Unsupported KDF: {}", sidecar.kdf));
    }
    let salt = hex_decode(&sidecar.salt)?;
    let nonce_bytes = hex_decode(&sidecar.nonce)?;
    let wrapped = hex_decode(&sidecar.wrapped_dek)?;

    let kek = derive_kek(
        pin.as_bytes(),
        &salt,
        sidecar.kdf_mem_kib,
        sidecar.kdf_iters,
        sidecar.kdf_par,
    )?;
    let cipher = Aes256Gcm::new_from_slice(&*kek).map_err(|e| format!("AES init: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let mut plaintext = cipher
        .decrypt(nonce, wrapped.as_slice())
        .map_err(|_| "Incorrect PIN.".to_string())?;

    if plaintext.len() != DEK_LEN {
        plaintext.zeroize();
        return Err("Corrupt keywrap: wrong DEK length.".to_string());
    }
    let mut out = Zeroizing::new([0u8; DEK_LEN]);
    out.copy_from_slice(&plaintext);
    plaintext.zeroize();
    Ok(out)
}

/// Re-wrap an existing DEK under a new PIN. Used when the user changes their PIN
/// without re-encrypting the database (DEK stays the same, KEK rotates).
pub fn rewrap_dek(
    db_path: &Path,
    dek: &[u8; DEK_LEN],
    new_pin: &str,
) -> Result<(), String> {
    let salt = random_bytes(SALT_LEN);
    let kek = derive_kek(new_pin.as_bytes(), &salt, ARGON_MEM_KIB, ARGON_ITERS, ARGON_PAR)?;
    let nonce_bytes = random_bytes(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(&*kek).map_err(|e| format!("AES init: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let wrapped = cipher
        .encrypt(nonce, dek.as_slice())
        .map_err(|e| format!("DEK wrap failed: {e}"))?;

    let sidecar = Sidecar {
        version: SIDECAR_VERSION,
        kdf: KDF_KIND.to_string(),
        kdf_mem_kib: ARGON_MEM_KIB,
        kdf_iters: ARGON_ITERS,
        kdf_par: ARGON_PAR,
        salt: hex_encode(&salt),
        nonce: hex_encode(&nonce_bytes),
        wrapped_dek: hex_encode(&wrapped),
        created_at: chrono::Utc::now().to_rfc3339(),
        pending_action: None,
    };
    write_sidecar(db_path, &sidecar)?;
    Ok(())
}

/// Apply `PRAGMA key = "x'<hex>'"` and verify the connection can read its
/// schema. SQLCipher does not error on a wrong key at PRAGMA time; the
/// first query fails with "file is not a database" instead. We probe with
/// a cheap `sqlite_master` read to surface a real error if the key is wrong.
pub fn apply_key(conn: &Connection, dek: &[u8; DEK_LEN]) -> Result<(), String> {
    let hex = hex_encode(dek);
    let pragma = format!("PRAGMA key = \"x'{hex}'\";");
    conn.execute_batch(&pragma)
        .map_err(|e| format!("Failed to apply DB key: {e}"))?;
    // Probe.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })
    .map_err(|_| "Incorrect PIN or database is not encrypted with this key.".to_string())?;
    Ok(())
}

/// Re-encrypt the existing plaintext DB in place using `sqlcipher_export`.
/// Steps:
///  1. Open the source (plain) DB.
///  2. ATTACH a new file with the DEK as its key.
///  3. `SELECT sqlcipher_export('encrypted')` to copy schema + data.
///  4. DETACH, then atomically replace the original file.
///
/// Caller is responsible for ensuring no other connections are open against
/// the source DB while this runs. Designed to be called BEFORE the r2d2 pool
/// is constructed (or after the pool is fully drained).
pub fn encrypt_in_place(db_path: &Path, dek: &[u8; DEK_LEN]) -> Result<(), String> {
    let encrypted_tmp = db_path.with_extension("db.enc.tmp");
    if encrypted_tmp.exists() {
        fs::remove_file(&encrypted_tmp)
            .map_err(|e| format!("Failed to clear stale tmp DB: {e}"))?;
    }

    {
        let conn = Connection::open(db_path)
            .map_err(|e| format!("Failed to open source DB: {e}"))?;
        let hex = hex_encode(dek);
        // ATTACH with key. The string literal is single-quoted SQL with an
        // escaped single-quote-free hex blob.
        let attach = format!(
            "ATTACH DATABASE '{}' AS encrypted KEY \"x'{hex}'\";",
            encrypted_tmp.to_string_lossy().replace('\'', "''")
        );
        conn.execute_batch(&attach)
            .map_err(|e| format!("ATTACH failed: {e}"))?;
        conn.query_row("SELECT sqlcipher_export('encrypted')", [], |_| Ok(()))
            .map_err(|e| format!("sqlcipher_export failed: {e}"))?;
        conn.execute_batch("DETACH DATABASE encrypted")
            .map_err(|e| format!("DETACH failed: {e}"))?;
    }

    fs::rename(&encrypted_tmp, db_path)
        .map_err(|e| format!("Failed to swap encrypted DB into place: {e}"))?;
    Ok(())
}

/// Inverse of `encrypt_in_place`: opens the encrypted DB with `dek`, exports
/// to a fresh plain SQLite file, then atomically replaces the original.
pub fn decrypt_in_place(db_path: &Path, dek: &[u8; DEK_LEN]) -> Result<(), String> {
    let plain_tmp = db_path.with_extension("db.plain.tmp");
    if plain_tmp.exists() {
        fs::remove_file(&plain_tmp)
            .map_err(|e| format!("Failed to clear stale tmp DB: {e}"))?;
    }

    {
        let conn = Connection::open(db_path)
            .map_err(|e| format!("Failed to open encrypted DB: {e}"))?;
        apply_key(&conn, dek)?;
        let attach = format!(
            "ATTACH DATABASE '{}' AS plain KEY '';",
            plain_tmp.to_string_lossy().replace('\'', "''")
        );
        conn.execute_batch(&attach)
            .map_err(|e| format!("ATTACH (plain) failed: {e}"))?;
        conn.query_row("SELECT sqlcipher_export('plain')", [], |_| Ok(()))
            .map_err(|e| format!("sqlcipher_export (plain) failed: {e}"))?;
        conn.execute_batch("DETACH DATABASE plain")
            .map_err(|e| format!("DETACH (plain) failed: {e}"))?;
    }

    fs::rename(&plain_tmp, db_path)
        .map_err(|e| format!("Failed to swap plain DB into place: {e}"))?;
    Ok(())
}
