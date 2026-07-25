use chrono::Local;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

fn timestamp() -> String {
    // Local time, second precision, no timezone offset. Sub-second timestamps
    // and the +HH:MM suffix were noise on every log line; for sub-second
    // ordering, rely on log ordering within a single second instead.
    Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

// ---------------------------------------------------------------------------
// Dynamic log levels
// ---------------------------------------------------------------------------

/// Numeric encoding: 0=debug, 1=info, 2=warn, 3=error
static MIN_LOG_LEVEL: AtomicU8 = AtomicU8::new(1); // default: info

/// Set the minimum log level. Entries below this level are silently dropped.
/// Accepts `"debug"`, `"info"`, `"warn"`, `"error"`. Unknown values default to `"info"`.
pub fn set_min_log_level(level: &str) {
    let l = level_to_u8(level);
    MIN_LOG_LEVEL.store(l, Ordering::Relaxed);
}

pub fn get_min_log_level() -> String {
    match MIN_LOG_LEVEL.load(Ordering::Relaxed) {
        0 => "debug",
        2 => "warn",
        3 => "error",
        _ => "info",
    }
    .to_string()
}

fn level_to_u8(level: &str) -> u8 {
    match level {
        "debug" => 0,
        "warn" => 2,
        "error" => 3,
        _ => 1,
    }
}

fn should_log(level: &str) -> bool {
    level_to_u8(level) >= MIN_LOG_LEVEL.load(Ordering::Relaxed)
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
    let _ = DB_POOL.set(pool.clone());
    BUFFERED_LOGGER.get_or_init(|| Mutex::new(BufferedLogger::new(pool)));
}

fn persist(level: &str, source: &str, message: &str, metadata: &str) {
    if !should_log(level) {
        return;
    }
    if let Some(pool) = DB_POOL.get() {
        if let Ok(conn) = pool.get() {
            let _ = conn.execute(
                "INSERT INTO app_logs (timestamp, level, source, message, metadata) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![timestamp(), level, source, message, metadata],
            );
        }
    }
}

/// Delete log rows older than `days` days.
pub fn prune_old_logs(conn: &Connection, days: u32) {
    let _ = conn.execute(
        "DELETE FROM app_logs WHERE timestamp < datetime('now', ?1)",
        rusqlite::params![format!("-{days} days")],
    );
}

pub fn log_debug(source: &str, message: impl AsRef<str>) {
    let msg = message.as_ref();
    if should_log("debug") {
        eprintln!("[{}] [DEBUG] [{}] {}", timestamp(), source, msg);
        persist("debug", source, msg, "{}");
    }
}

pub fn log_info(source: &str, message: impl AsRef<str>) {
    let msg = message.as_ref();
    if should_log("info") {
        eprintln!("[{}] [INFO]  [{}] {}", timestamp(), source, msg);
        persist("info", source, msg, "{}");
    }
}

pub fn log_warn(source: &str, message: impl AsRef<str>) {
    let msg = message.as_ref();
    if should_log("warn") {
        eprintln!("[{}] [WARN]  [{}] {}", timestamp(), source, msg);
        persist("warn", source, msg, "{}");
    }
}

pub fn log_error(source: &str, message: impl AsRef<str>) {
    let msg = message.as_ref();
    // errors always bypass the level filter — we never want to miss them
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

// ---------------------------------------------------------------------------
// Buffered logger — reduces per-event DB writes for noisy log sources
// ---------------------------------------------------------------------------

/// Maximum number of entries buffered before a forced flush.
const BUFFER_CAPACITY: usize = 50;
/// Maximum time between flushes.
const FLUSH_INTERVAL: Duration = Duration::from_secs(5);

/// Key used to aggregate repeated identical messages.
#[derive(Clone, Hash, Eq, PartialEq)]
struct AggregationKey {
    level: String,
    source: String,
    /// A template of the message (e.g. the log line with variable parts stripped).
    /// For simple dedup, this is just the full message text.
    message_template: String,
}

struct AggregatedEntry {
    first_timestamp: String,
    last_timestamp: String,
    count: u64,
    metadata: String,
}

struct BufferedEntry {
    timestamp: String,
    level: String,
    source: String,
    message: String,
    metadata: String,
}

struct BufferedLogger {
    pool: Pool<SqliteConnectionManager>,
    buffer: Vec<BufferedEntry>,
    aggregated: HashMap<AggregationKey, AggregatedEntry>,
    last_flush: Instant,
}

static BUFFERED_LOGGER: OnceLock<Mutex<BufferedLogger>> = OnceLock::new();

impl BufferedLogger {
    fn new(pool: Pool<SqliteConnectionManager>) -> Self {
        Self {
            pool,
            buffer: Vec::with_capacity(BUFFER_CAPACITY),
            aggregated: HashMap::new(),
            last_flush: Instant::now(),
        }
    }

    fn should_flush(&self) -> bool {
        self.buffer.len() >= BUFFER_CAPACITY
            || (!self.aggregated.is_empty() && self.last_flush.elapsed() >= FLUSH_INTERVAL)
            || self.buffer.len() + self.aggregated.len() >= BUFFER_CAPACITY
    }

    fn push(&mut self, level: &str, source: &str, message: &str, metadata: &str) {
        self.buffer.push(BufferedEntry {
            timestamp: timestamp(),
            level: level.to_string(),
            source: source.to_string(),
            message: message.to_string(),
            metadata: metadata.to_string(),
        });
        if self.should_flush() {
            self.flush();
        }
    }

    fn push_aggregated(
        &mut self,
        level: &str,
        source: &str,
        message_template: &str,
        metadata: &str,
    ) {
        let key = AggregationKey {
            level: level.to_string(),
            source: source.to_string(),
            message_template: message_template.to_string(),
        };
        let now = timestamp();
        self.aggregated
            .entry(key)
            .and_modify(|entry| {
                entry.last_timestamp = now.clone();
                entry.count += 1;
                // Keep latest metadata
                entry.metadata = metadata.to_string();
            })
            .or_insert(AggregatedEntry {
                first_timestamp: now.clone(),
                last_timestamp: now,
                count: 1,
                metadata: metadata.to_string(),
            });
        if self.should_flush() {
            self.flush();
        }
    }

    fn flush(&mut self) {
        if self.buffer.is_empty() && self.aggregated.is_empty() {
            return;
        }

        let Ok(conn) = self.pool.get() else { return };

        // Use a transaction for the entire batch.
        let Ok(tx) = conn.unchecked_transaction() else {
            return;
        };

        // Write individual buffered entries.
        for entry in self.buffer.drain(..) {
            let _ = tx.execute(
                "INSERT INTO app_logs (timestamp, level, source, message, metadata) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![entry.timestamp, entry.level, entry.source, entry.message, entry.metadata],
            );
        }

        // Write aggregated entries — append count to message if > 1.
        for (key, agg) in self.aggregated.drain() {
            let message = if agg.count > 1 {
                format!(
                    "{} (x{}, {}-{})",
                    key.message_template, agg.count, agg.first_timestamp, agg.last_timestamp
                )
            } else {
                key.message_template
            };
            let _ = tx.execute(
                "INSERT INTO app_logs (timestamp, level, source, message, metadata) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![agg.last_timestamp, key.level, key.source, message, agg.metadata],
            );
        }

        let _ = tx.commit();
        self.last_flush = Instant::now();
    }
}

/// Buffer a log entry for batch persistence. Non-error events accumulate
/// and are flushed in a single transaction when the buffer is full or a
/// timer expires. Errors bypass the buffer and persist immediately.
pub fn log_buffered(level: &str, source: &str, message: &str, metadata: &str) {
    // Errors always persist immediately — never risk losing them.
    if level == "error" {
        let tag = "ERROR";
        eprintln!("[{}] [{}] [{}] {}", timestamp(), tag, source, message);
        persist(level, source, message, metadata);
        return;
    }

    if !should_log(level) {
        return;
    }

    let tag = match level {
        "debug" => "DEBUG",
        "warn" => "WARN",
        _ => "INFO",
    };
    eprintln!("[{}] [{}] [{}] {}", timestamp(), tag, source, message);

    if let Some(logger) = BUFFERED_LOGGER.get() {
        if let Ok(mut logger) = logger.lock() {
            logger.push(level, source, message, metadata);
        } else {
            // Mutex poisoned — fall back to direct persist.
            persist(level, source, message, metadata);
        }
    } else {
        // Logger not initialized yet — fall back to direct persist.
        persist(level, source, message, metadata);
    }
}

/// Buffer a log entry with aggregation. Repeated identical messages (same
/// level + source + message_template) are collapsed into a single DB row
/// with a count annotation.
pub fn log_buffered_aggregated(level: &str, source: &str, message_template: &str, metadata: &str) {
    if level == "error" {
        let tag = "ERROR";
        eprintln!(
            "[{}] [{}] [{}] {}",
            timestamp(),
            tag,
            source,
            message_template
        );
        persist(level, source, message_template, metadata);
        return;
    }

    if !should_log(level) {
        return;
    }

    let tag = match level {
        "debug" => "DEBUG",
        "warn" => "WARN",
        _ => "INFO",
    };
    eprintln!(
        "[{}] [{}] [{}] {}",
        timestamp(),
        tag,
        source,
        message_template
    );

    if let Some(logger) = BUFFERED_LOGGER.get() {
        if let Ok(mut logger) = logger.lock() {
            logger.push_aggregated(level, source, message_template, metadata);
        } else {
            persist(level, source, message_template, metadata);
        }
    } else {
        persist(level, source, message_template, metadata);
    }
}

/// Force-flush any pending buffered log entries. Call on app shutdown or
/// when you need to guarantee all logs are persisted.
pub fn flush_buffered() {
    if let Some(logger) = BUFFERED_LOGGER.get() {
        if let Ok(mut logger) = logger.lock() {
            logger.flush();
        }
    }
}

/// Write a batch of log entries in a single transaction. Used by the
/// `log_frontend_events_batch` command to persist frontend logs efficiently.
pub fn persist_batch(entries: &[(String, String, String, String, String)]) {
    let Some(pool) = DB_POOL.get() else { return };
    let Ok(conn) = pool.get() else { return };
    let Ok(tx) = conn.unchecked_transaction() else {
        return;
    };
    for (ts, level, source, message, metadata) in entries {
        let _ = tx.execute(
            "INSERT INTO app_logs (timestamp, level, source, message, metadata) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![ts, level, source, message, metadata],
        );
    }
    let _ = tx.commit();
}

/// Spawn a background timer that periodically flushes the buffered logger
/// and optionally prunes logs older than `retention_days` once per day.
/// Call once during app setup, after `init_pool`.
pub fn start_flush_timer() {
    start_flush_timer_with_retention(Some(30));
}

pub fn normalize_retention_days(retention_days: Option<u32>) -> Option<u32> {
    retention_days.map(|days| days.max(1))
}

pub fn start_flush_timer_with_retention(retention_days: Option<u32>) {
    let retention_days = normalize_retention_days(retention_days);
    std::thread::spawn(move || {
        // Prune immediately on startup.
        if let (Some(days), Some(pool)) = (retention_days, DB_POOL.get()) {
            if let Ok(conn) = pool.get() {
                prune_old_logs(&conn, days);
            }
        }

        let mut last_prune = Instant::now();
        loop {
            std::thread::sleep(FLUSH_INTERVAL);
            flush_buffered();

            // Prune once every 24 hours.
            if last_prune.elapsed() >= Duration::from_secs(86_400) {
                if let (Some(days), Some(pool)) = (retention_days, DB_POOL.get()) {
                    if let Ok(conn) = pool.get() {
                        prune_old_logs(&conn, days);
                        last_prune = Instant::now();
                    }
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Typed metadata macro
// ---------------------------------------------------------------------------

/// Convenience macro for attaching structured key/value metadata to a log call.
///
/// # Examples
/// ```ignore
/// app_log_meta!("info", "chat", "Session started", session_id = session.id, model = &model);
/// ```
#[macro_export]
macro_rules! app_log_meta {
    ($level:expr, $source:expr, $msg:expr $(, $key:ident = $val:expr)* $(,)?) => {{
        let meta = ::serde_json::json!({ $(stringify!($key): $val),* }).to_string();
        $crate::logging::log_with_meta($level, $source, $msg, &meta);
    }};
}

#[cfg(test)]
mod tests {
    #[test]
    fn retention_days_can_be_disabled_or_clamped() {
        assert_eq!(super::normalize_retention_days(None), None);
        assert_eq!(super::normalize_retention_days(Some(0)), Some(1));
        assert_eq!(super::normalize_retention_days(Some(30)), Some(30));
    }
}
