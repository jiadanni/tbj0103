use rusqlite::{Connection, Result};
use std::path::Path;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

pub fn initialize_database(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;

    // WAL mode first; foreign keys enabled AFTER migrations
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;

    // Create all tables (idempotent for new installs)
    conn.execute_batch(include_str!("../schema.sql"))?;

    // Apply any pending schema migrations
    run_migrations(&conn)?;

    // Now enforce foreign keys for normal operation
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    Ok(conn)
}

/// Schema migrations — each is guarded by the _migrations table so they
/// run exactly once against any existing database.
fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            name TEXT PRIMARY KEY NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    // v1: drop the hard FK on chat_sessions.project_id so that sessions
    // can exist independently of a project (project is optional context).
    let applied: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v1_chat_project_no_fk'",
        [],
        |row| row.get(0),
    )?;

    if applied == 0 {
        conn.execute_batch(
            "PRAGMA foreign_keys=OFF;
             CREATE TABLE IF NOT EXISTS chat_sessions_v2 (
                 id TEXT PRIMARY KEY NOT NULL,
                 project_id TEXT NOT NULL DEFAULT '',
                 title TEXT NOT NULL DEFAULT 'New Chat',
                 model_name TEXT NOT NULL DEFAULT '',
                 system_prompt TEXT NOT NULL DEFAULT '',
                 is_pinned INTEGER NOT NULL DEFAULT 0,
                 parent_session_id TEXT,
                 branch_message_id TEXT,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             INSERT OR IGNORE INTO chat_sessions_v2 SELECT * FROM chat_sessions;
             DROP TABLE IF EXISTS chat_sessions;
             ALTER TABLE chat_sessions_v2 RENAME TO chat_sessions;
             INSERT INTO _migrations(name) VALUES('v1_chat_project_no_fk');",
        )?;
    }

    // v2: add ai_models table for multi-model priority list with token tracking
    let applied_v2: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v2_ai_models_table'",
        [],
        |row| row.get(0),
    )?;

    if applied_v2 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS ai_models (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                model_id TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT 'ollama',
                priority INTEGER NOT NULL DEFAULT 0,
                is_paid INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                tokens_used_total INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO _migrations(name) VALUES('v2_ai_models_table');",
        )?;
    }

    // v3: add memories table for cross-session AI memory
    let applied_v3: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v3_memories_table'",
        [],
        |row| row.get(0),
    )?;

    if applied_v3 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                memory_type TEXT NOT NULL DEFAULT 'fact'
                    CHECK(memory_type IN ('fact', 'preference', 'context')),
                source_session_id TEXT,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace_id);
            CREATE INDEX IF NOT EXISTS idx_memories_active ON memories(workspace_id, is_active);
            INSERT INTO _migrations(name) VALUES('v3_memories_table');",
        )?;
    }

    // v4: add duration_ms column to messages for tok/s persistence
    let applied_v4: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v4_messages_duration_ms'",
        [],
        |row| row.get(0),
    )?;

    if applied_v4 == 0 {
        // Ignore error if column already exists (fresh installs have it from schema.sql)
        let _ = conn.execute_batch(
            "ALTER TABLE messages ADD COLUMN duration_ms INTEGER;",
        );
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v4_messages_duration_ms');",
        )?;
    }

    // v5: add topic_signature and signature_updated_at to workspaces, plus new settings
    let applied_v5: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v5_workspace_topic_signature'",
        [],
        |row| row.get(0),
    )?;

    if applied_v5 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE workspaces ADD COLUMN topic_signature TEXT NOT NULL DEFAULT '{}';
             ALTER TABLE workspaces ADD COLUMN signature_updated_at TEXT;
             INSERT OR IGNORE INTO settings (key, value) VALUES
                ('topic_analysis_interval_minutes', '30'),
                ('migration_suggestion_threshold', '0.3');",
        );
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v5_workspace_topic_signature');",
        )?;
    }

    // v6: rename project_id to workspace_id in learning_cards and create its index
    let applied_v6: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v6_learning_cards_workspace'",
        [],
        |row| row.get(0),
    )?;

    if applied_v6 == 0 {
        // Safe to ignore error if project_id doesn't exist (e.g., fresh installations or manual edits)
        let _ = conn.execute_batch("ALTER TABLE learning_cards RENAME COLUMN project_id TO workspace_id;");
        
        conn.execute_batch(
            "DROP INDEX IF EXISTS idx_learning_cards_project;
             CREATE INDEX IF NOT EXISTS idx_learning_cards_workspace ON learning_cards(workspace_id);
             INSERT INTO _migrations(name) VALUES('v6_learning_cards_workspace');",
        )?;
    }

    // v7: add workspace_id to chat_sessions and audio_transcriptions
    let applied_v7: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v7_chat_workspace_scope'",
        [],
        |row| row.get(0),
    )?;

    if applied_v7 == 0 {
        // chat_sessions table restructure
        let _ = conn.execute_batch(
            "PRAGMA foreign_keys=OFF;
             CREATE TABLE IF NOT EXISTS chat_sessions_v3 (
                 id TEXT PRIMARY KEY NOT NULL,
                 workspace_id TEXT NOT NULL DEFAULT '',
                 project_id TEXT NOT NULL DEFAULT '',
                 title TEXT NOT NULL DEFAULT 'New Chat',
                 model_name TEXT NOT NULL DEFAULT '',
                 system_prompt TEXT NOT NULL DEFAULT '',
                 is_pinned INTEGER NOT NULL DEFAULT 0,
                 parent_session_id TEXT,
                 branch_message_id TEXT,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             INSERT OR IGNORE INTO chat_sessions_v3 (id, project_id, title, model_name, system_prompt, is_pinned, parent_session_id, branch_message_id, created_at, updated_at)
             SELECT id, project_id, title, model_name, system_prompt, is_pinned, parent_session_id, branch_message_id, created_at, updated_at FROM chat_sessions;
             
             UPDATE chat_sessions_v3
             SET workspace_id = (SELECT workspace_id FROM projects WHERE projects.id = chat_sessions_v3.project_id)
             WHERE project_id != '' AND EXISTS (SELECT 1 FROM projects WHERE projects.id = chat_sessions_v3.project_id);
             
             UPDATE chat_sessions_v3
             SET workspace_id = (SELECT id FROM workspaces LIMIT 1)
             WHERE workspace_id = '' OR workspace_id IS NULL;

             DROP TABLE IF EXISTS chat_sessions;
             ALTER TABLE chat_sessions_v3 RENAME TO chat_sessions;
             CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace ON chat_sessions(workspace_id);
             PRAGMA foreign_keys=ON;"
        );

        // audio_transcriptions column add
        let _ = conn.execute_batch(
            "ALTER TABLE audio_transcriptions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';
             UPDATE audio_transcriptions
             SET workspace_id = (SELECT workspace_id FROM projects WHERE projects.id = audio_transcriptions.project_id)
             WHERE project_id != '' AND EXISTS (SELECT 1 FROM projects WHERE projects.id = audio_transcriptions.project_id);
             
             UPDATE audio_transcriptions
             SET workspace_id = (SELECT id FROM workspaces LIMIT 1)
             WHERE workspace_id = '' OR workspace_id IS NULL;
             CREATE INDEX IF NOT EXISTS idx_audio_transcriptions_workspace ON audio_transcriptions(workspace_id);"
        );

        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v7_chat_workspace_scope');",
        )?;
    }

    Ok(())
}
