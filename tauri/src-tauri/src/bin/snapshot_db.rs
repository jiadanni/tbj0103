// snapshot-db — capture a sanitized snapshot of the live Aetherium DB
// for use as a CI fixture against the migration upgrade test.
//
// Usage:
//   cargo run --bin snapshot-db
//   AETHERIUM_DB=/path/to/aetherium.db cargo run --bin snapshot-db
//   FORCE=1 cargo run --bin snapshot-db   # overwrite if snapshot exists
//
// What it does:
//   1. Locates the live DB (env override or platform default).
//   2. Reads the latest vN_* entry from _migrations to determine version.
//   3. If tests/snapshots/snapshot_vN.sqlite already exists, exits 0.
//   4. Otherwise: copies the DB to a temp file, wipes content-bearing
//      columns (conservative privacy pass), VACUUMs, writes to the
//      snapshots dir.
//   5. Prints the `git add` line so committing is one paste away.

use rusqlite::{Connection, OpenFlags};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

// Tables and the columns within them that hold user-generated content.
// Conservative — keeps IDs, FKs, timestamps, counters, settings, model
// names, and schema shape. Wipes anything that's a body, title, prompt,
// summary, embedding, or other user-authored or model-generated text.
//
// Add new tables here when migrations introduce them. If you forget, the
// snapshot will contain real content — the privacy guarantee is opt-in
// per column, by design.
//
// For tables whose wiped columns participate in a UNIQUE constraint
// (e.g. workspace_prompt_bank.normalized_prompt), wiping all rows to ''
// would collide. List those in CONTENT_TABLES_TO_TRUNCATE instead — the
// rows are dropped wholesale, which preserves the schema for the
// migration test while sidestepping the constraint.
const CONTENT_COLUMNS: &[(&str, &[&str])] = &[
    ("workspaces", &["name", "description"]),
    ("folders", &["name", "folder_description"]),
    ("chat_sessions", &["title", "system_prompt"]),
    ("messages", &["content"]),
    ("learning_goals", &["title", "goal_description"]),
    ("concept_nodes", &["name", "concept_description"]),
    ("concept_links", &["context"]),
    ("concept_mentions", &["context"]),
    ("note_templates", &["name", "template_description", "content"]),
    ("daily_notes", &["content"]),
    ("quizzes", &["title"]),
    ("quiz_questions", &["prompt", "expected_answer"]),
    ("quiz_answers", &["user_answer"]),
    ("uploaded_documents", &["filename", "content", "summary"]),
    ("document_chunks", &["content"]),
    ("web_captures", &["title", "content", "summary"]),
    ("sources", &["title", "filename", "content", "summary"]),
    ("source_chunks", &["content", "embedding"]),
    ("audio_transcriptions", &["filename"]),
    ("project_notes", &["title", "content"]),
    ("calendar_alarms", &["title", "input_prompt"]),
    ("thought_queue", &["content"]),
    ("memories", &["content"]),
    ("workspace_glossary_terms", &["definition"]),
    ("memory_summaries", &["content"]),
    ("memory_summary_snapshots", &["content"]),
    ("conversation_summaries", &["content", "embedding"]),
    ("artifacts", &["title", "content", "description"]),
    ("artifact_embeddings", &["embedding"]),
    ("memory_embeddings", &["embedding"]),
    // workspace_prompt_bank intentionally omitted — see CONTENT_TABLES_TO_TRUNCATE.
];

// Tables whose content columns are also UNIQUE-constrained. Wiping all
// rows to '' would cause UNIQUE collisions, so we drop the rows entirely.
// The schema and FKs are preserved, which is all the migration test needs.
const CONTENT_TABLES_TO_TRUNCATE: &[&str] = &[
    "workspace_prompt_bank",
    // Every row is log content; even wiping message/metadata would leave
    // millions of bytes of timestamp/level rows for no test value.
    "app_logs",
    // FTS5 mirror table — its content is duplicated from the source
    // tables we already wiped. Triggers regenerate it; dropping rows
    // here also clears the shadow _fts_data/_fts_docsize tables.
    "quick_search_documents",
];

fn default_db_path() -> Option<PathBuf> {
    // Mirrors Tauri's `app_data_dir()` per-platform behavior for
    // identifier "com.aetherium.app".
    #[cfg(target_os = "linux")]
    {
        let xdg = env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))?;
        Some(xdg.join("com.aetherium.app").join("aetherium.db"))
    }
    #[cfg(target_os = "macos")]
    {
        let home = env::var_os("HOME").map(PathBuf::from)?;
        Some(
            home.join("Library/Application Support")
                .join("com.aetherium.app")
                .join("aetherium.db"),
        )
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = env::var_os("APPDATA").map(PathBuf::from)?;
        Some(appdata.join("com.aetherium.app").join("aetherium.db"))
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        None
    }
}

fn snapshots_dir() -> PathBuf {
    // Resolve relative to the workspace, regardless of where cargo was
    // invoked from. CARGO_MANIFEST_DIR is set to src-tauri at compile
    // time; tests/snapshots lives directly under it.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/snapshots")
}

fn latest_migration_name(conn: &Connection) -> rusqlite::Result<Option<String>> {
    // Pick the migration whose numeric prefix is the largest. Names look
    // like "v73_repair_quick_search_chat_sessions_au" — we sort by the
    // integer between 'v' and '_'.
    let mut stmt = conn.prepare("SELECT name FROM _migrations")?;
    let names: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .filter_map(Result::ok)
        .collect();
    Ok(names.into_iter().max_by_key(|n| version_number(n)))
}

fn version_number(name: &str) -> u32 {
    name.strip_prefix('v')
        .and_then(|rest| rest.split('_').next())
        .and_then(|n| n.parse().ok())
        .unwrap_or(0)
}

fn version_prefix(name: &str) -> String {
    // "v73_repair_…" -> "v73"
    name.split('_').next().unwrap_or(name).to_string()
}

fn table_exists(conn: &Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name = ?1",
        rusqlite::params![table],
        |r| r.get::<_, bool>(0),
    )
    .unwrap_or(false)
}

fn sanitize(conn: &Connection, row_cap: u32) -> rusqlite::Result<(usize, usize)> {
    let mut wiped = 0usize;
    let mut capped = 0usize;

    for (table, cols) in CONTENT_COLUMNS {
        // Skip tables that don't exist in this snapshot's schema state
        // (e.g. snapshot from before a table was added).
        if !table_exists(conn, table) {
            continue;
        }
        // Cap row count first. We keep the OLDEST rows by rowid — those
        // have been through the most prior migrations, so they exercise
        // more of the migration history. A heavy user with 100k messages
        // would otherwise produce a 50MB snapshot.
        if row_cap > 0 {
            let n = conn.execute(
                &format!(
                    "DELETE FROM {table} WHERE rowid NOT IN \
                     (SELECT rowid FROM {table} ORDER BY rowid LIMIT {row_cap})"
                ),
                [],
            )?;
            capped += n;
        }
        // Build "col1 = '', col2 = '', col3 = ''". Empty string works
        // for both TEXT and BLOB columns in SQLite. Preserves row count,
        // drops the content.
        let assignments: Vec<String> = cols.iter().map(|c| format!("{c} = ''")).collect();
        let sql = format!("UPDATE {table} SET {}", assignments.join(", "));
        wiped += conn.execute(&sql, [])?;
    }

    for table in CONTENT_TABLES_TO_TRUNCATE {
        if !table_exists(conn, table) {
            continue;
        }
        wiped += conn.execute(&format!("DELETE FROM {table}"), [])?;
    }

    // FTS5 virtual tables maintain their own shadow storage and don't
    // automatically shrink when the underlying content table is emptied —
    // their _fts_data blob persists. Issue the FTS5 'delete-all' command
    // which actually clears the inverted index.
    if table_exists(conn, "quick_search_documents_fts") {
        conn.execute(
            "INSERT INTO quick_search_documents_fts(quick_search_documents_fts) VALUES('delete-all')",
            [],
        )?;
    }

    Ok((wiped, capped))
}

fn run() -> Result<(), String> {
    let live_db = env::var_os("AETHERIUM_DB")
        .map(PathBuf::from)
        .or_else(default_db_path)
        .ok_or("Could not determine live DB path. Set AETHERIUM_DB=/path/to/aetherium.db.")?;

    if !live_db.exists() {
        return Err(format!(
            "Live DB not found at {}. Has the app been run on this machine?",
            live_db.display()
        ));
    }
    println!("✓ Live DB: {}", live_db.display());

    // Open read-only to determine the version — no risk of corrupting
    // the user's actual database.
    let ro_conn = Connection::open_with_flags(
        &live_db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open live DB read-only: {e}"))?;

    let latest = latest_migration_name(&ro_conn)
        .map_err(|e| format!("Failed to read _migrations: {e}"))?
        .ok_or("No migrations recorded in live DB — is it actually an Aetherium DB?")?;
    drop(ro_conn);

    let version = version_prefix(&latest);
    println!("✓ Schema version: {version} (latest: {latest})");

    let snap_dir = snapshots_dir();
    fs::create_dir_all(&snap_dir).map_err(|e| format!("Failed to create snapshots dir: {e}"))?;
    let snap_path = snap_dir.join(format!("snapshot_{version}.sqlite"));

    if snap_path.exists() && env::var_os("FORCE").is_none() {
        println!(
            "✓ Snapshot already exists for {version} — nothing to do.\n  ({})\n  Set FORCE=1 to overwrite.",
            snap_path.display()
        );
        return Ok(());
    }

    // Copy the live DB to a temp path first. We never want to mutate
    // the user's real database — even with sanitize that wipes content,
    // a buggy run could corrupt their notes. Always work on a copy.
    let tmp_path = snap_dir.join(format!(".snapshot_{version}.tmp.sqlite"));
    if tmp_path.exists() {
        fs::remove_file(&tmp_path).ok();
    }
    fs::copy(&live_db, &tmp_path).map_err(|e| format!("Failed to copy live DB: {e}"))?;
    println!("→ Copied to scratch space");

    // Sanitize in place on the copy.
    {
        let conn = Connection::open(&tmp_path)
            .map_err(|e| format!("Failed to open copy for sanitize: {e}"))?;
        // Capping by rowid will orphan FK-referencing rows (e.g. messages
        // older than the surviving chat_session). That's fine for a test
        // fixture — the test cares about migration code paths, not FK
        // integrity — but SQLite will reject the DELETEs if enforcement
        // is on. Turn it off for the sanitize pass.
        conn.execute_batch("PRAGMA foreign_keys=OFF;")
            .map_err(|e| format!("Failed to disable FK enforcement: {e}"))?;
        let row_cap: u32 = env::var("ROW_CAP")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(500);
        let (wiped, capped) =
            sanitize(&conn, row_cap).map_err(|e| format!("Sanitize failed: {e}"))?;
        if row_cap > 0 {
            println!("→ Capped each table at {row_cap} rows (dropped {capped} excess row(s))");
        }
        println!("→ Wiped content from {wiped} row(s) across {} table(s)", CONTENT_COLUMNS.len());

        // VACUUM reclaims space freed by the wipes. Without it the file
        // is the same size as the live DB even though most content is
        // gone — defeats the point.
        conn.execute_batch("VACUUM;")
            .map_err(|e| format!("VACUUM failed: {e}"))?;
    }

    // Atomic move into final location.
    fs::rename(&tmp_path, &snap_path)
        .map_err(|e| format!("Failed to move into snapshots dir: {e}"))?;

    let size_kb = fs::metadata(&snap_path)
        .map(|m| m.len() / 1024)
        .unwrap_or(0);
    println!("✓ Wrote {} ({size_kb} KB)", snap_path.display());

    let rel = snap_path
        .strip_prefix(workspace_root())
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| snap_path.display().to_string());
    println!("\nStage with:\n  git add {rel}");

    Ok(())
}

fn workspace_root() -> &'static Path {
    // src-tauri/.. is the tauri/ workspace root; one more .. is the repo root.
    // We want paths printed relative to the repo root.
    static_root()
}

fn static_root() -> &'static Path {
    use std::sync::OnceLock;
    static ROOT: OnceLock<PathBuf> = OnceLock::new();
    ROOT.get_or_init(|| {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        // src-tauri -> tauri -> repo root
        manifest
            .parent()
            .and_then(|p| p.parent())
            .map(Path::to_path_buf)
            .unwrap_or_else(|| manifest.to_path_buf())
    })
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("✗ {e}");
            ExitCode::FAILURE
        }
    }
}
