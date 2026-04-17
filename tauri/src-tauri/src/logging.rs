use chrono::Local;
use rusqlite::Connection;
use std::sync::OnceLock;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;

fn timestamp() -> String {
    Local::now().format("%Y-%m-%dT%H:%M:%S%.3f%:z").to_string()
}

pub fn stderr(message: impl AsRef<str>) {
    eprintln!("[{}] {}", timestamp(), message.as_ref());
}

// ---------------------------------------------------------------------------
// Persistent structured logging
// ---------------------------------------------------------------------------

static DB_POOL: OnceLock<Pool<SqliteConnectionManager>> = OnceLock::new();

/// Call once at app start to enable DB-backed logging.
pub fn init_pool(pool: Pool<SqliteConnectionManager>) {
    let _ = DB_POOL.set(pool);
}

fn persist(level: &str, source: &str, message: &str, metadata: &str) {
    if let Some(pool) = DB_POOL.get() {
        if let Ok(conn) = pool.get() {
            let _ = conn.execute(
                "INSERT INTO app_logs (timestamp, level, source, message, metadata) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![timestamp(), level, source, message, metadata],
            );
        }
    }
}

pub fn log_debug(source: &str, message: impl AsRef<str>) {
    let msg = message.as_ref();
    eprintln!("[{}] [DEBUG] [{}] {}", timestamp(), source, msg);
    persist("debug", source, msg, "{}");
}

pub fn log_info(source: &str, message: impl AsRef<str>) {
    let msg = message.as_ref();
    eprintln!("[{}] [INFO]  [{}] {}", timestamp(), source, msg);
    persist("info", source, msg, "{}");
}

pub fn log_warn(source: &str, message: impl AsRef<str>) {
    let msg = message.as_ref();
    eprintln!("[{}] [WARN]  [{}] {}", timestamp(), source, msg);
    persist("warn", source, msg, "{}");
}

pub fn log_error(source: &str, message: impl AsRef<str>) {
    let msg = message.as_ref();
    eprintln!("[{}] [ERROR] [{}] {}", timestamp(), source, msg);
    persist("error", source, msg, "{}");
}

pub fn log_with_meta(level: &str, source: &str, message: impl AsRef<str>, metadata: &str) {
    let msg = message.as_ref();
    let tag = match level {
        "debug" => "DEBUG",
        "warn" => "WARN",
        "error" => "ERROR",
        _ => "INFO",
    };
    eprintln!("[{}] [{}] [{}] {}", timestamp(), tag, source, msg);
    persist(level, source, msg, metadata);
}

/// Insert a log entry directly using an existing connection (for use inside commands).
pub fn log_with_conn(conn: &Connection, level: &str, source: &str, message: &str, metadata: &str) {
    let _ = conn.execute(
        "INSERT INTO app_logs (timestamp, level, source, message, metadata) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![timestamp(), level, source, message, metadata],
    );
}
