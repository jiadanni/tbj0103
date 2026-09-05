use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, OptionalExtension, Result};
use std::collections::BTreeSet;
use std::path::Path;

#[cfg(test)]
pub mod test_utils;

pub type DbPool = Pool<SqliteConnectionManager>;

pub struct DbState(pub Pool<SqliteConnectionManager>);

const ALL_MIGRATION_NAMES: &[&str] = &[
    "v1_chat_project_no_fk",
    "v2_ai_models_table",
    "v3_memories_table",
    "v4_messages_duration_ms",
    "v5_workspace_topic_signature",
    "v6_learning_cards_workspace",
    "v7_chat_workspace_scope",
    "v8_all_tables_workspace_id",
    "v9_ensure_all_indexes",
    "v10_chat_sessions_is_incognito",
    "v11_conversation_summaries",
    "v12_artifacts",
    "v13_artifact_embeddings",
    "v14_memory_embeddings",
    "v15_project_scoped_memories",
    "v16_context_snapshots",
    "v17_chat_recycle_bin",
    "v18_git_sync_settings",
    "v19_confirm_move_to_trash",
    "v20_pin_lock_settings",
    "v21_chat_sessions_exclude_from_analytics",
    "v22_ai_model_role_tags",
    "v23_memory_scope",
    "v24_workspace_description",
    "v25_prompt_instructions",
    "v26_thought_session_id",
    "v26_sources_unification",
    "v27_switch_workspace_to_chat",
    "v27_sources_folder_tokens",
    "v28_workspace_is_hidden",
    "v29_query_indexes",
    "v30_performance_indexes",
    "v31_chat_sessions_is_imported",
    "v32_chat_sessions_last_accessed_at",
    "v33_source_chunks_embedding_blob",
    "v34_chat_sessions_last_processed_message_count",
    "v35_concept_nodes_hierarchy_level",
    "v36_ai_models_provider_model_unique",
    "v37_workspace_parent_id",
    "v38_workspace_icon",
    "v39_messages_variant_group",
    "v40_ai_models_is_hidden",
    "v41_workspace_order_index",
    "v42_workspace_last_message_at",
    "v43_switch_workspace_section",
    "v44_ai_models_context_size",
    "v45_workspaces_survey_data",
    "v46_fix_workspace_last_message_at_trigger",
    "v47_raise_migration_threshold",
    "v48_memory_summaries",
    "v49_analyze_jobs",
    "v50_rename_projects_to_folders",
    "v51_workspace_glossary",
    "v52_chat_sessions_unread",
    "v53_chat_identifiers",
    "v54_flashcard_topics",
    "v55_flashcard_topic_parent",
    "v56_quizzes",
    "v57_topics_to_concepts",
    "v58_learning_goals_concept_id",
    "v59_chat_sessions_message_count",
    "v60_about_you",
    "v61_memories_reinforcement",
    "v62_memories_supersession",
    "v63_concept_hierarchy_job",
    "v64_cleanup_invalid_part_of",
    "v65_workspace_prompt_bank",
    "v66_knowledge_graph_model_upgrade",
    "v67_lower_summarization_min_messages",
    "v68_roadmap_snapshots",
    "v69_project_notes_folder",
    "v70_project_notes_pinning",
    "v71_conversation_summary_types",
    "v72_make_memories_workspace_nullable",
    "v73_repair_quick_search_chat_sessions_au",
    "v74_inference_job_runs",
    "v75_fix_workspace_fk_shapes",
    "v76_learning_cards_generated_by_model",
    "v77_blocked_topics",
    "v78_learning_cards_kind",
    "v79_import_source_links",
    "v80_roadmap_snapshot_reason",
    "v81_search_session_workspace",
    "v82_chat_file_sync_outbox",
];

pub fn initialize_database(path: &Path) -> Result<Pool<SqliteConnectionManager>> {
    initialize_database_with_key(path, None)
}

/// Initialize the database, optionally with a SQLCipher key. When `key` is
/// `Some`, every pooled connection runs `PRAGMA key` before use; the bootstrap
/// connection that runs migrations is keyed up front too. When `None`, the
/// behavior is byte-identical to the pre-encryption path.
pub fn initialize_database_with_key(
    path: &Path,
    key: Option<[u8; 32]>,
) -> Result<Pool<SqliteConnectionManager>> {
    // We first open a direct connection to run pragmas, create tables and migrations,
    // ensuring this happens sequentially before the pool is used by commands.
    let conn = Connection::open(path)?;

    if let Some(k) = key.as_ref() {
        crate::services::db_encryption::apply_key(&conn, k).map_err(|msg| {
            rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(1), Some(msg))
        })?;
    }

    let is_fresh_database: bool = conn.query_row(
        "SELECT COUNT(*) = 0
         FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;

    // WAL mode first; foreign keys enabled AFTER migrations
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;

    create_migrations_table(&conn)?;

    if is_fresh_database {
        // Fresh databases can take the full current schema as-is.
        conn.execute_batch(include_str!("../schema.sql"))?;
        seed_all_migrations(&conn)?;
    } else {
        // Some databases can carry a malformed legacy quick-search trigger body
        // that references conversation_summaries_old. Repair it before running
        // migrations so setup does not fail while parsing/dropping triggers.
        repair_dangling_quick_search_trigger(&conn)?;
        // A v72 attempt that crashed mid-batch can leave an orphaned
        // `memories_old` table behind, which makes every subsequent startup
        // panic on v72's `RENAME TO memories_old`. Repair it before migrations
        // run so v72 can re-apply cleanly.
        repair_orphaned_memories_old(&conn)?;
        repair_interrupted_v75(&conn)?;
        // Existing databases must migrate first so schema-level indexes do not
        // reference columns that are added by later migrations.
        run_migrations(&conn)?;
        conn.execute_batch(include_str!("../schema.sql"))?;
    }

    // Now enforce foreign keys for normal operation
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    // Now create the pool. Set a busy_timeout so concurrent writers wait for
    // the SQLite lock instead of immediately returning SQLITE_BUSY — without
    // it, two writers racing (e.g. update_settings + the log flusher) can
    // produce silent write failures or surface as long unrelated stalls.
    let key_for_pool = key;
    let manager = SqliteConnectionManager::file(path).with_init(move |c| {
        if let Some(k) = key_for_pool.as_ref() {
            let hex: String = k.iter().map(|b| format!("{b:02x}")).collect();
            c.execute_batch(&format!("PRAGMA key = \"x'{hex}'\";"))?;
        }
        c.execute_batch("PRAGMA foreign_keys=ON;")?;
        c.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(())
    });

    let pool = r2d2::Pool::builder()
        .max_size(10)
        .build(manager)
        .map_err(|e| {
            rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(1), Some(e.to_string()))
        })?;

    Ok(pool)
}

fn create_migrations_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            name TEXT PRIMARY KEY NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
}

fn seed_all_migrations(conn: &Connection) -> Result<()> {
    for name in ALL_MIGRATION_NAMES {
        conn.execute(
            "INSERT OR IGNORE INTO _migrations(name) VALUES(?1)",
            rusqlite::params![name],
        )?;
    }

    Ok(())
}

fn repair_dangling_quick_search_trigger(conn: &Connection) -> Result<()> {
    let has_dangling_trigger: i64 = conn.query_row(
        "SELECT COUNT(*)
         FROM sqlite_master
         WHERE type = 'trigger'
           AND name = 'quick_search_chat_sessions_au'
           AND sql LIKE '%conversation_summaries_old%'",
        [],
        |row| row.get(0),
    )?;

    if has_dangling_trigger == 0 {
        return Ok(());
    }

    if conn
        .execute_batch("DROP TRIGGER IF EXISTS quick_search_chat_sessions_au;")
        .is_ok()
    {
        return Ok(());
    }

    // Fallback for malformed trigger entries that cannot be dropped normally.
    conn.execute_batch(
        "PRAGMA writable_schema=ON;
         DELETE FROM sqlite_master
         WHERE type = 'trigger' AND name = 'quick_search_chat_sessions_au';
         PRAGMA writable_schema=OFF;",
    )?;

    Ok(())
}

/// Recover from a partially-applied v72 migration.
///
/// `v72_make_memories_workspace_nullable` rebuilds the `memories` table via
/// `ALTER TABLE memories RENAME TO memories_old; CREATE TABLE memories ...;
/// INSERT ... SELECT FROM memories_old; DROP TABLE memories_old;` inside a
/// single `execute_batch`. That batch is not transactional, so if the process
/// dies (or any statement fails) partway through, the `_migrations` row is
/// never written and a `memories_old` table is left behind. The next startup
/// re-runs v72 and panics on `RENAME TO memories_old` because that name is
/// already taken.
///
/// This restores the pre-v72 state so v72 can re-apply exactly once:
/// `memories_old` holds the original, pre-migration rows, so it is the source
/// of truth. We discard any partial new `memories` table and rename
/// `memories_old` back to `memories`. We only act when v72 is not yet recorded
/// — once v72 has committed, no orphan should exist and we must not touch it.
fn repair_orphaned_memories_old(conn: &Connection) -> Result<()> {
    let v72_applied: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v72_make_memories_workspace_nullable'",
        [],
        |row| row.get(0),
    )?;
    if v72_applied != 0 {
        return Ok(());
    }

    let has_memories_old: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'memories_old'",
        [],
        |row| row.get(0),
    )?;
    if has_memories_old == 0 {
        return Ok(());
    }

    // `memories_old` is the original pre-v72 table. Drop any partial rebuild and
    // restore it under the canonical name so the frozen v72 body runs cleanly.
    conn.execute_batch(
        "PRAGMA foreign_keys=OFF;
         DROP TABLE IF EXISTS memories;
         ALTER TABLE memories_old RENAME TO memories;
         PRAGMA foreign_keys=ON;",
    )?;

    Ok(())
}

/// Schema migrations — each is guarded by the _migrations table so they
/// run exactly once against any existing database.
fn run_migrations(conn: &Connection) -> Result<()> {
    create_migrations_table(conn)?;

    // v1: drop the hard FK on chat_sessions.folder_id so that sessions
    // can exist independently of a folder (folder is optional context).
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
             INSERT OR IGNORE INTO chat_sessions_v2 (id, project_id, title, model_name, system_prompt, is_pinned, parent_session_id, branch_message_id, created_at, updated_at)
             SELECT id, project_id, title, model_name, system_prompt, is_pinned, parent_session_id, branch_message_id, created_at, updated_at FROM chat_sessions;
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
        let _ = conn.execute_batch("ALTER TABLE messages ADD COLUMN duration_ms INTEGER;");
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v4_messages_duration_ms');")?;
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
        let _ = conn
            .execute_batch("ALTER TABLE learning_cards RENAME COLUMN project_id TO workspace_id;");

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
                 workspace_id TEXT NOT NULL DEFAULT '' REFERENCES workspaces(id) ON DELETE CASCADE,
                 project_id TEXT NOT NULL DEFAULT '',
                 title TEXT NOT NULL DEFAULT 'New Chat',
                 model_name TEXT NOT NULL DEFAULT '',
                 system_prompt TEXT NOT NULL DEFAULT '',
                 is_pinned INTEGER NOT NULL DEFAULT 0,
                 parent_session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
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
             WHERE (workspace_id = '' OR workspace_id IS NULL) AND EXISTS (SELECT 1 FROM workspaces);

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

        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v7_chat_workspace_scope');")?;
    }

    // v8: add workspace_id to all remaining tables that need workspace scoping
    let applied_v8: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v8_all_tables_workspace_id'",
        [],
        |row| row.get(0),
    )?;

    if applied_v8 == 0 {
        let tables = [
            "uploaded_documents",
            "web_captures",
            "project_notes",
            "learning_goals",
            "concept_nodes",
            "note_templates",
            "daily_notes",
            "learning_paths",
            "calendar_alarms",
            "thought_queue",
        ];

        for table in tables {
            // Check if column already exists first to be safe
            let has_col: i64 = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = 'workspace_id'",
                        table
                    ),
                    [],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            if has_col == 0 {
                let _ = conn.execute_batch(&format!(
                    "ALTER TABLE {table} ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';
                     UPDATE {table} SET workspace_id = (SELECT id FROM workspaces LIMIT 1)
                     WHERE workspace_id = '' AND EXISTS (SELECT 1 FROM workspaces);",
                    table = table
                ));
            }
        }

        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v8_all_tables_workspace_id');")?;
    }

    // v9: backfill indexes for existing databases; fresh installs get them from schema.sql
    let applied_v9: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v9_ensure_all_indexes'",
        [],
        |row| row.get(0),
    )?;

    if applied_v9 == 0 {
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
             CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace ON chat_sessions(workspace_id);
             CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(project_id);
             CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
             CREATE INDEX IF NOT EXISTS idx_citations_message ON citations(message_id);
             CREATE INDEX IF NOT EXISTS idx_concept_nodes_workspace ON concept_nodes(workspace_id);
             CREATE INDEX IF NOT EXISTS idx_concept_links_source ON concept_links(source_id);
             CREATE INDEX IF NOT EXISTS idx_concept_links_target ON concept_links(target_id);
             CREATE INDEX IF NOT EXISTS idx_concept_mentions_concept ON concept_mentions(concept_id);
             CREATE INDEX IF NOT EXISTS idx_learning_goals_workspace ON learning_goals(workspace_id);
             CREATE INDEX IF NOT EXISTS idx_learning_cards_review ON learning_cards(next_review_date);
             CREATE INDEX IF NOT EXISTS idx_daily_notes_workspace_date ON daily_notes(workspace_id, date);
             CREATE INDEX IF NOT EXISTS idx_uploaded_docs_workspace ON uploaded_documents(workspace_id);
             CREATE INDEX IF NOT EXISTS idx_doc_chunks_document ON document_chunks(document_id);
             CREATE INDEX IF NOT EXISTS idx_web_captures_workspace ON web_captures(workspace_id);
             CREATE INDEX IF NOT EXISTS idx_project_notes_workspace ON project_notes(workspace_id);
             CREATE INDEX IF NOT EXISTS idx_audio_transcriptions_workspace ON audio_transcriptions(workspace_id);
             CREATE INDEX IF NOT EXISTS idx_alarms_fire_date ON calendar_alarms(fire_date);
             CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace_id);
             CREATE INDEX IF NOT EXISTS idx_memories_active ON memories(workspace_id, is_active);
             INSERT INTO _migrations(name) VALUES('v9_ensure_all_indexes');",
        )?;
    }

    // v10: add is_incognito column to chat_sessions for existing databases
    let applied_v10: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v10_chat_sessions_is_incognito'",
        [],
        |row| row.get(0),
    )?;

    if applied_v10 == 0 {
        // Ignore error if column already exists (fresh installs have it from schema.sql)
        let _ = conn.execute_batch(
            "ALTER TABLE chat_sessions ADD COLUMN is_incognito INTEGER NOT NULL DEFAULT 0;",
        );
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v10_chat_sessions_is_incognito');",
        )?;
    }

    // v11: Conversation summaries
    let applied_v11: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v11_conversation_summaries'",
        [],
        |row| row.get(0),
    )?;

    if applied_v11 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS conversation_summaries (
                id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                summary_type TEXT NOT NULL DEFAULT 'info'
                    CHECK(summary_type IN ('info', 'extensive')),
                content TEXT NOT NULL,
                key_topics TEXT NOT NULL DEFAULT '[]',
                message_range_start INTEGER NOT NULL,
                message_range_end INTEGER NOT NULL,
                token_count INTEGER NOT NULL DEFAULT 0,
                embedding BLOB,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO _migrations(name) VALUES('v11_conversation_summaries');",
        )?;
    }

    // v12: Artifacts
    let applied_v12: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v12_artifacts'",
        [],
        |row| row.get(0),
    )?;

    if applied_v12 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
                message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
                title TEXT NOT NULL,
                artifact_type TEXT NOT NULL DEFAULT 'code'
                    CHECK(artifact_type IN ('code','document','diagram','config','data','other')),
                language TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '[]',
                is_pinned INTEGER NOT NULL DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                parent_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
                token_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO _migrations(name) VALUES('v12_artifacts');",
        )?;
    }

    // v13: Artifact embeddings
    let applied_v13: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v13_artifact_embeddings'",
        [],
        |row| row.get(0),
    )?;

    if applied_v13 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS artifact_embeddings (
                artifact_id TEXT PRIMARY KEY NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
                embedding BLOB NOT NULL,
                model TEXT NOT NULL DEFAULT 'nomic-embed-text',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO _migrations(name) VALUES('v13_artifact_embeddings');",
        )?;
    }

    // v14: Memory embeddings
    let applied_v14: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v14_memory_embeddings'",
        [],
        |row| row.get(0),
    )?;

    if applied_v14 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS memory_embeddings (
                memory_id TEXT PRIMARY KEY NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
                embedding BLOB NOT NULL,
                model TEXT NOT NULL DEFAULT 'nomic-embed-text',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO _migrations(name) VALUES('v14_memory_embeddings');",
        )?;
    }

    // v15: Folder-scoped memories
    let applied_v15: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v15_project_scoped_memories'",
        [],
        |row| row.get(0),
    )?;

    if applied_v15 == 0 {
        let _ = conn
            .execute_batch("ALTER TABLE memories ADD COLUMN project_id TEXT NOT NULL DEFAULT '';");
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v15_project_scoped_memories');")?;
    }

    // v16: Context assembly snapshots
    let applied_v16: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v16_context_snapshots'",
        [],
        |row| row.get(0),
    )?;

    if applied_v16 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS context_snapshots (
                id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                message_id TEXT NOT NULL,
                assembled_context TEXT NOT NULL,
                token_budget INTEGER NOT NULL,
                tokens_used INTEGER NOT NULL,
                sources_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO _migrations(name) VALUES('v16_context_snapshots');",
        )?;
    }

    // v17: Chat recycle bin
    let applied_v17: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v17_chat_recycle_bin'",
        [],
        |row| row.get(0),
    )?;

    if applied_v17 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE chat_sessions ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;",
        );
        let _ = conn.execute_batch("ALTER TABLE chat_sessions ADD COLUMN deleted_at TEXT;");
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v17_chat_recycle_bin');")?;
    }

    // v18: Git sync settings
    let applied_v18: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v18_git_sync_settings'",
        [],
        |row| row.get(0),
    )?;

    if applied_v18 == 0 {
        conn.execute_batch(
            "INSERT OR IGNORE INTO settings (key, value) VALUES
                ('git_sync_enabled', 'false'),
                ('git_sync_remote_url', ''),
                ('git_sync_last_synced_at', ''),
                ('git_sync_last_error', '');
             INSERT INTO _migrations(name) VALUES('v18_git_sync_settings');",
        )?;
    }

    // v19: Confirm move to trash setting
    let applied_v19: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v19_confirm_move_to_trash'",
        [],
        |row| row.get(0),
    )?;

    if applied_v19 == 0 {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('confirm_move_to_trash', 'true')",
            [],
        );
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v19_confirm_move_to_trash');")?;
    }

    // v20: PIN lock settings
    let applied_v20: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v20_pin_lock_settings'",
        [],
        |row| row.get(0),
    )?;

    if applied_v20 == 0 {
        conn.execute_batch(
            "INSERT OR IGNORE INTO settings (key, value) VALUES
                ('pin_lock_enabled', 'false'),
                ('pin_passcode_hash', '');
             INSERT INTO _migrations(name) VALUES('v20_pin_lock_settings');",
        )?;
    }

    // v21: allow chats to opt out of analytics without being ephemeral
    let applied_v21: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v21_chat_sessions_exclude_from_analytics'",
        [],
        |row| row.get(0),
    )?;

    if applied_v21 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE chat_sessions ADD COLUMN exclude_from_analytics INTEGER NOT NULL DEFAULT 0;",
        );
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v21_chat_sessions_exclude_from_analytics');",
        )?;
    }

    // v22: add role tags for AI model task routing
    let applied_v22: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v22_ai_model_role_tags'",
        [],
        |row| row.get(0),
    )?;

    if applied_v22 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE ai_models ADD COLUMN role_tags TEXT NOT NULL DEFAULT '[]';",
        );
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v22_ai_model_role_tags');")?;
    }

    // v23: add scope column to memories (global vs workspace)
    let applied_v23: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v23_memory_scope'",
        [],
        |row| row.get(0),
    )?;

    if applied_v23 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'workspace';",
        );
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v23_memory_scope');")?;
    }

    // v24: add description column to workspaces
    let applied_v24: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v24_workspace_description'",
        [],
        |row| row.get(0),
    )?;

    if applied_v24 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE workspaces ADD COLUMN description TEXT NOT NULL DEFAULT '';",
        );
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v24_workspace_description');")?;
    }

    // v25: add prompt_instructions to workspaces and global settings
    let applied_v25: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v25_prompt_instructions'",
        [],
        |row| row.get(0),
    )?;

    if applied_v25 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE workspaces ADD COLUMN prompt_instructions TEXT NOT NULL DEFAULT '';",
        );
        let _ = conn.execute_batch(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('prompt_instructions', '\"\"');",
        );
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v25_prompt_instructions');")?;
    }

    // v26: add session_id to thought_queue for chat integration
    let applied: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v26_thought_session_id'",
        [],
        |row| row.get(0),
    )?;
    if applied == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE thought_queue ADD COLUMN session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL;",
        );
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v26_thought_session_id');")?;
    }

    // v26: create unified sources tables for existing databases before later
    // sources-specific migrations attempt to alter or index them.
    let applied_v26_sources: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v26_sources_unification'",
        [],
        |row| row.get(0),
    )?;
    if applied_v26_sources == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sources (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                source_type TEXT NOT NULL CHECK(source_type IN ('document', 'web_capture')),
                title TEXT NOT NULL DEFAULT '',
                filename TEXT,
                file_type TEXT,
                file_size INTEGER,
                url TEXT,
                content TEXT NOT NULL DEFAULT '',
                summary TEXT,
                favicon_data TEXT,
                is_processed INTEGER NOT NULL DEFAULT 0,
                folder TEXT,
                token_count INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS source_chunks (
                id TEXT PRIMARY KEY NOT NULL,
                source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                embedding BLOB,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT OR IGNORE INTO sources (
                id, workspace_id, source_type, title, filename, file_type, file_size, content, summary, is_processed, created_at, updated_at
            )
            SELECT
                id, workspace_id, 'document', filename, filename, file_type, file_size, content, summary, is_processed, created_at, updated_at
            FROM uploaded_documents;
            INSERT OR IGNORE INTO sources (
                id, workspace_id, source_type, title, url, content, summary, favicon_data, is_processed, created_at, updated_at
            )
            SELECT
                id, workspace_id, 'web_capture', title, url, content, summary, favicon_data, is_processed, created_at, datetime('now')
            FROM web_captures;
            INSERT OR IGNORE INTO source_chunks (id, source_id, content, chunk_index, embedding, created_at)
            SELECT id, document_id, content, chunk_index, embedding, created_at
            FROM document_chunks;
            INSERT INTO _migrations(name) VALUES('v26_sources_unification');",
        )?;
    }

    // v27: workspace switch behavior preference
    let applied_v27: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v27_switch_workspace_to_chat'",
        [],
        |row| row.get(0),
    )?;

    if applied_v27 == 0 {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('switch_workspace_to_chat', 'false')",
            [],
        );
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v27_switch_workspace_to_chat');",
        )?;
    }

    // v27: add folder and token_count columns to sources
    let applied_v27: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v27_sources_folder_tokens'",
        [],
        |row| row.get(0),
    )?;
    if applied_v27 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE sources ADD COLUMN folder TEXT;
             ALTER TABLE sources ADD COLUMN token_count INTEGER;",
        );
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v27_sources_folder_tokens');")?;
    }

    // v28: add is_hidden to workspaces for archive/hide support
    let applied_v28: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v28_workspace_is_hidden'",
        [],
        |row| row.get(0),
    )?;
    if applied_v28 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE workspaces ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;",
        );
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v28_workspace_is_hidden');")?;
    }

    // v29: add compound indexes for common list/query paths
    let applied_v29: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v29_query_indexes'",
        [],
        |row| row.get(0),
    )?;
    if applied_v29 == 0 {
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace_project_pinned_updated
                 ON chat_sessions(workspace_id, project_id, is_pinned, updated_at DESC);
             CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace_pinned_updated
                 ON chat_sessions(workspace_id, is_pinned, updated_at DESC);
             CREATE INDEX IF NOT EXISTS idx_messages_session_created_at
                 ON messages(session_id, created_at);
             CREATE INDEX IF NOT EXISTS idx_learning_cards_workspace_review
                 ON learning_cards(workspace_id, next_review_date);
             CREATE INDEX IF NOT EXISTS idx_concept_links_source_target
                 ON concept_links(source_id, target_id);
             INSERT INTO _migrations(name) VALUES('v29_query_indexes');",
        )?;
    }

    // v30: performance indexes for sources, artifacts, concept_mentions, thought_queue, memories
    let applied_v30: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v30_performance_indexes'",
        [],
        |row| row.get(0),
    )?;
    if applied_v30 == 0 {
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_sources_workspace ON sources(workspace_id);
             CREATE INDEX IF NOT EXISTS idx_sources_workspace_processed ON sources(workspace_id, is_processed);
             CREATE INDEX IF NOT EXISTS idx_source_chunks_source ON source_chunks(source_id);
             CREATE INDEX IF NOT EXISTS idx_artifacts_workspace ON artifacts(workspace_id);
             CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
             CREATE INDEX IF NOT EXISTS idx_concept_mentions_source ON concept_mentions(source_type, source_id);
             CREATE INDEX IF NOT EXISTS idx_thought_queue_status ON thought_queue(workspace_id, status, process_at);
             CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(workspace_id, is_active, scope);
             CREATE INDEX IF NOT EXISTS idx_conv_summaries_session ON conversation_summaries(session_id);
             INSERT INTO _migrations(name) VALUES('v30_performance_indexes');",
        )?;
    }

    // v31: add is_imported flag to chat_sessions for scheduler exclusion
    let applied_v31: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v31_chat_sessions_is_imported'",
        [],
        |row| row.get(0),
    )?;
    if applied_v31 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE chat_sessions ADD COLUMN is_imported INTEGER NOT NULL DEFAULT 0;",
        );
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v31_chat_sessions_is_imported');",
        )?;
    }

    // v32: add last_accessed_at column to chat_sessions
    let applied_v32: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v32_chat_sessions_last_accessed_at'",
        [],
        |row| row.get(0),
    )?;
    if applied_v32 == 0 {
        let _ = conn.execute_batch("ALTER TABLE chat_sessions ADD COLUMN last_accessed_at TEXT;");
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v32_chat_sessions_last_accessed_at');",
        )?;
    }

    // v33: convert text embeddings in source_chunks to blob
    let applied_v33: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v33_source_chunks_embedding_blob'",
        [],
        |row| row.get(0),
    )?;
    if applied_v33 == 0 {
        // Find chunks where embedding is text (JSON array like "[0.1, 0.2, ...]")
        let text_chunks: Vec<(String, String)> = {
            let mut stmt = conn.prepare(
                "SELECT id, embedding FROM source_chunks WHERE typeof(embedding) = 'text'",
            )?;
            let iter = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            iter.filter_map(Result::ok).collect()
        };

        let tx = conn.unchecked_transaction()?;
        for (id, emb_text) in text_chunks {
            if let Ok(vec) = serde_json::from_str::<Vec<f32>>(&emb_text) {
                let blob = crate::services::vector_index::f32_vec_to_bytes(&vec);
                tx.execute(
                    "UPDATE source_chunks SET embedding = ?1 WHERE id = ?2",
                    rusqlite::params![blob, id],
                )?;
            }
        }
        tx.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v33_source_chunks_embedding_blob');",
        )?;
        tx.commit()?;
    }

    // v34: add last_processed_message_count column to chat_sessions
    let applied_v34: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v34_chat_sessions_last_processed_message_count'",
        [],
        |row| row.get(0),
    )?;
    if applied_v34 == 0 {
        let _ = conn.execute_batch("ALTER TABLE chat_sessions ADD COLUMN last_processed_message_count INTEGER NOT NULL DEFAULT 0;");
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v34_chat_sessions_last_processed_message_count');",
        )?;
    }

    // v35: add hierarchy_level column to concept_nodes
    let applied_v35: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v35_concept_nodes_hierarchy_level'",
        [],
        |row| row.get(0),
    )?;
    if applied_v35 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE concept_nodes ADD COLUMN hierarchy_level TEXT DEFAULT 'concept';",
        );
        let _ = conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_concept_nodes_hierarchy ON concept_nodes(workspace_id, hierarchy_level);"
        );
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v35_concept_nodes_hierarchy_level');",
        )?;
    }

    // v36: dedupe legacy ai_models rows and enforce provider+model uniqueness
    let applied_v36: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v36_ai_models_provider_model_unique'",
        [],
        |row| row.get(0),
    )?;
    if applied_v36 == 0 {
        dedupe_ai_models(conn)?;
        conn.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_models_provider_model_unique
             ON ai_models(provider, model_id);
             INSERT INTO _migrations(name) VALUES('v36_ai_models_provider_model_unique');",
        )?;
    }

    // v37: add parent_workspace_id for hierarchical sub-workspaces
    let applied_v37: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v37_workspace_parent_id'",
        [],
        |row| row.get(0),
    )?;
    if applied_v37 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE workspaces ADD COLUMN parent_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL;",
        );
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v37_workspace_parent_id');")?;
    }

    // v38: add icon field to workspaces for visual identification
    let applied_v38: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v38_workspace_icon'",
        [],
        |row| row.get(0),
    )?;
    if applied_v38 == 0 {
        let _ =
            conn.execute_batch("ALTER TABLE workspaces ADD COLUMN icon TEXT NOT NULL DEFAULT '';");
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v38_workspace_icon');")?;
    }

    // v39: add variant_group_id to messages and index variant lookups
    let applied_v39: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v39_messages_variant_group'",
        [],
        |row| row.get(0),
    )?;
    if applied_v39 == 0 {
        let _ = conn.execute_batch("ALTER TABLE messages ADD COLUMN variant_group_id TEXT;");
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_messages_variant_group
                 ON messages(variant_group_id);
             INSERT INTO _migrations(name) VALUES('v39_messages_variant_group');",
        )?;
    }

    // v40: add is_hidden to ai_models for granular dropdown visibility
    let applied_v40: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v40_ai_models_is_hidden'",
        [],
        |row| row.get(0),
    )?;
    if applied_v40 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE ai_models ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;",
        );
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v40_ai_models_is_hidden');")?;
    }

    // v41: add order_index to workspaces
    let applied_v41: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v41_workspace_order_index'",
        [],
        |row| row.get(0),
    )?;
    if applied_v41 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE workspaces ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0;",
        );
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v41_workspace_order_index');")?;
    }

    // v42: add last_message_at to workspaces and a trigger to update it
    let applied_v42: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v42_workspace_last_message_at'",
        [],
        |row| row.get(0),
    )?;

    if applied_v42 == 0 {
        let _ = conn.execute_batch("ALTER TABLE workspaces ADD COLUMN last_message_at TEXT;");

        // Initial population: set last_message_at for all workspaces based on existing messages
        conn.execute_batch(
            "UPDATE workspaces 
             SET last_message_at = (
                SELECT m.created_at 
                FROM messages m
                JOIN chat_sessions s ON m.session_id = s.id
                WHERE s.workspace_id = workspaces.id
                ORDER BY m.created_at DESC
                LIMIT 1
             );",
        )?;

        // Create the trigger
        conn.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS update_workspace_last_message_at
             AFTER INSERT ON messages
             BEGIN
                 UPDATE workspaces 
                 SET last_message_at = NEW.created_at
                 WHERE id = (SELECT workspace_id FROM chat_sessions WHERE id = NEW.session_id);
             END;",
        )?;

        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v42_workspace_last_message_at');",
        )?;
    }

    // v43: migrate switch_workspace_to_chat (bool) → switch_workspace_section (string)
    let applied_v43: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v43_switch_workspace_section'",
        [],
        |row| row.get(0),
    )?;

    if applied_v43 == 0 {
        // Convert old boolean value: "true" → "/chat", anything else → ""
        let old_value: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'switch_workspace_to_chat'",
                [],
                |row| row.get(0),
            )
            .ok();
        let new_value = match old_value.as_deref() {
            Some("true") => "/chat",
            _ => "",
        };
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('switch_workspace_section', ?1)",
            [new_value],
        )?;
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v43_switch_workspace_section');",
        )?;
    }

    // v44: per-model num_ctx override. NULL means "use default".
    let applied_v44: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v44_ai_models_context_size'",
        [],
        |row| row.get(0),
    )?;
    if applied_v44 == 0 {
        // ALTER TABLE will fail if the column already exists (idempotency for
        // databases created from a newer schema.sql). Ignore that specific error.
        let _ = conn.execute_batch("ALTER TABLE ai_models ADD COLUMN context_size INTEGER;");
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v44_ai_models_context_size');")?;
    }

    // v45: workspace survey data (JSON blob).
    let applied_v45: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v45_workspaces_survey_data'",
        [],
        |row| row.get(0),
    )?;
    if applied_v45 == 0 {
        let _ = conn.execute_batch("ALTER TABLE workspaces ADD COLUMN survey_data TEXT;");
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v45_workspaces_survey_data');")?;
    }

    // v46: fix update_workspace_last_message_at trigger to never walk backwards
    let applied_v46: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v46_fix_workspace_last_message_at_trigger'",
        [],
        |row| row.get(0),
    )?;
    if applied_v46 == 0 {
        // Drop the old (buggy) trigger and recreate it with a MAX() guard so that
        // inserting a message with an older created_at (e.g. during import) can
        // never walk last_message_at backwards.
        conn.execute_batch(
            "DROP TRIGGER IF EXISTS update_workspace_last_message_at;
             CREATE TRIGGER update_workspace_last_message_at
             AFTER INSERT ON messages
             BEGIN
                 UPDATE workspaces
                 SET last_message_at = NEW.created_at
                 WHERE id = (SELECT workspace_id FROM chat_sessions WHERE id = NEW.session_id)
                   AND (last_message_at IS NULL OR NEW.created_at > last_message_at);
             END;",
        )?;

        // Correct any values that may have been set backwards by the old trigger:
        // re-compute last_message_at as the actual MAX message timestamp per workspace.
        conn.execute_batch(
            "UPDATE workspaces
             SET last_message_at = (
                 SELECT MAX(m.created_at)
                 FROM messages m
                 JOIN chat_sessions s ON m.session_id = s.id
                 WHERE s.workspace_id = workspaces.id
             );",
        )?;

        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v46_fix_workspace_last_message_at_trigger');",
        )?;
    }

    // v47: raise migration suggestion threshold from 0.3 to 0.5
    // The old value was too sensitive — messages on new sub-topics within the
    // same workspace's domain would score below 0.3 and trigger false suggestions.
    let applied_v47: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v47_raise_migration_threshold'",
        [],
        |row| row.get(0),
    )?;
    if applied_v47 == 0 {
        // Only update if the user still has the original default
        let _ = conn.execute(
            "UPDATE settings SET value = '0.5' WHERE key = 'migration_suggestion_threshold' AND value = '0.3'",
            [],
        );
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v47_raise_migration_threshold');",
        )?;
    }

    // v48: memory_summaries table + migrate context→fact + drop context CHECK
    let applied_v48: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v48_memory_summaries'",
        [],
        |row| row.get(0),
    )?;
    if applied_v48 == 0 {
        // Create memory_summaries table
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS memory_summaries (
                id TEXT PRIMARY KEY NOT NULL,
                scope TEXT NOT NULL DEFAULT 'global'
                    CHECK(scope IN ('global', 'workspace')),
                workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
                content TEXT NOT NULL DEFAULT '',
                is_auto_generated INTEGER NOT NULL DEFAULT 1,
                generated_at TEXT NOT NULL DEFAULT (datetime('now')),
                edited_at TEXT,
                UNIQUE(scope, workspace_id)
            );",
        )?;

        // Migrate context memories to fact
        let _ = conn.execute(
            "UPDATE memories SET memory_type = 'fact' WHERE memory_type = 'context'",
            [],
        );

        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v48_memory_summaries');")?;
    }

    // v49: analyze_jobs + analyze_job_chunks tables for chunked workspace analysis
    let applied_v49: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v49_analyze_jobs'",
        [],
        |row| row.get(0),
    )?;
    if applied_v49 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS analyze_jobs (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                model TEXT NOT NULL,
                total_chunks INTEGER NOT NULL,
                completed_chunks INTEGER NOT NULL DEFAULT 0,
                failed_chunks INTEGER NOT NULL DEFAULT 0,
                chunk_budget INTEGER NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                error TEXT
            );
            CREATE TABLE IF NOT EXISTS analyze_job_chunks (
                job_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                label TEXT NOT NULL,
                char_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                nodes_created INTEGER NOT NULL DEFAULT 0,
                links_created INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                finished_at TEXT,
                PRIMARY KEY (job_id, chunk_index)
            );
            CREATE INDEX IF NOT EXISTS idx_analyze_jobs_workspace
                ON analyze_jobs(workspace_id, started_at DESC);",
        )?;
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v49_analyze_jobs');")?;
    }

    // v50: rename projects → folders across all tables
    let applied_v50: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v50_rename_projects_to_folders'",
        [],
        |row| row.get(0),
    )?;
    if applied_v50 == 0 {
        conn.execute_batch(
            "ALTER TABLE projects RENAME TO folders;
             ALTER TABLE folders RENAME COLUMN project_description TO folder_description;
             ALTER TABLE chat_sessions RENAME COLUMN project_id TO folder_id;
             ALTER TABLE audio_transcriptions RENAME COLUMN project_id TO folder_id;
             ALTER TABLE memories RENAME COLUMN project_id TO folder_id;
             ALTER TABLE quick_search_documents RENAME COLUMN project_id TO folder_id;
             INSERT INTO _migrations(name) VALUES('v50_rename_projects_to_folders');",
        )?;
    }

    let applied_v51: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v51_workspace_glossary'",
        [],
        |row| row.get(0),
    )?;
    if applied_v51 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS workspace_glossary_terms (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                term TEXT NOT NULL,
                normalized_term TEXT NOT NULL,
                definition TEXT NOT NULL,
                aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json)),
                source_kind TEXT NOT NULL DEFAULT 'manual'
                    CHECK(source_kind IN ('manual', 'glossary_seed', 'ai_scan')),
                source_session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
                is_user_edited INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(workspace_id, normalized_term)
             );
             CREATE TABLE IF NOT EXISTS workspace_glossary_state (
                workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                last_seeded_at TEXT,
                assistant_message_count_at_seed INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE TABLE IF NOT EXISTS session_glossary_scan_state (
                session_id TEXT PRIMARY KEY NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                last_scanned_assistant_count INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE INDEX IF NOT EXISTS idx_workspace_glossary_workspace
                ON workspace_glossary_terms(workspace_id, normalized_term);
             CREATE INDEX IF NOT EXISTS idx_workspace_glossary_source_session
                ON workspace_glossary_terms(source_session_id);
             INSERT OR IGNORE INTO settings (key, value) VALUES
                ('hover_definition_scan_enabled', 'true'),
                ('hover_definition_scan_max_sessions', '3'),
                ('workspace_glossary_refresh_interval_minutes', '60');
             INSERT INTO _migrations(name) VALUES('v51_workspace_glossary');",
        )?;
    }

    let applied_v52: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v52_chat_sessions_unread'",
        [],
        |row| row.get(0),
    )?;
    if applied_v52 == 0 {
        conn.execute_batch(
            "ALTER TABLE chat_sessions ADD COLUMN is_unread INTEGER NOT NULL DEFAULT 0;
             INSERT INTO _migrations(name) VALUES('v52_chat_sessions_unread');",
        )?;
    }

    let applied_v53: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v53_chat_identifiers'",
        [],
        |row| row.get(0),
    )?;
    if applied_v53 == 0 {
        conn.execute_batch(
            "INSERT OR IGNORE INTO settings (key, value) VALUES
                ('user_chat_label', '\"You\"'),
                ('assistant_chat_label', '\"Assistant\"');
             INSERT INTO _migrations(name) VALUES('v53_chat_identifiers');",
        )?;
    }

    let applied_v54: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v54_flashcard_topics'",
        [],
        |row| row.get(0),
    )?;
    if applied_v54 == 0 {
        let _ = conn.execute_batch("ALTER TABLE learning_cards ADD COLUMN topic_id TEXT;");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS flashcard_topics (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                topic TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'chat_signature',
                mastery_score REAL NOT NULL DEFAULT 0.0,
                last_generated_at TEXT,
                card_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(workspace_id, topic)
            );
             CREATE INDEX IF NOT EXISTS idx_flashcard_topics_workspace ON flashcard_topics(workspace_id);
             CREATE INDEX IF NOT EXISTS idx_learning_cards_topic ON learning_cards(topic_id);
             INSERT INTO _migrations(name) VALUES('v54_flashcard_topics');",
        )?;
    }

    let applied_v55: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v55_flashcard_topic_parent'",
        [],
        |row| row.get(0),
    )?;
    if applied_v55 == 0 {
        let has_col: bool = {
            let mut stmt = conn.prepare("PRAGMA table_info(flashcard_topics)")?;
            let names = stmt
                .query_map([], |r| r.get::<_, String>(1))?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            names.iter().any(|n| n == "parent_topic_id")
        };
        if !has_col {
            let _ = conn.execute_batch(
                "ALTER TABLE flashcard_topics ADD COLUMN parent_topic_id TEXT REFERENCES flashcard_topics(id) ON DELETE SET NULL;",
            );
        }
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_flashcard_topics_parent ON flashcard_topics(parent_topic_id);
             INSERT INTO _migrations(name) VALUES('v55_flashcard_topic_parent');",
        )?;
    }

    let applied_v56: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v56_quizzes'",
        [],
        |row| row.get(0),
    )?;
    if applied_v56 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS quizzes (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK (kind IN ('pop', 'exam')),
                title TEXT NOT NULL DEFAULT '',
                topic_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(topic_ids)),
                topic_labels TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(topic_labels)),
                status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
                score REAL,
                question_count INTEGER NOT NULL DEFAULT 0,
                chat_session_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at TEXT
            );
             CREATE TABLE IF NOT EXISTS quiz_questions (
                id TEXT PRIMARY KEY NOT NULL,
                quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                prompt TEXT NOT NULL,
                expected_answer TEXT NOT NULL DEFAULT '',
                rubric TEXT NOT NULL DEFAULT '',
                topic TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(quiz_id, position)
            );
             CREATE TABLE IF NOT EXISTS quiz_answers (
                id TEXT PRIMARY KEY NOT NULL,
                quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
                question_id TEXT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
                user_answer TEXT NOT NULL DEFAULT '',
                score REAL,
                feedback TEXT NOT NULL DEFAULT '',
                graded_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(question_id)
            );
             CREATE INDEX IF NOT EXISTS idx_quizzes_workspace ON quizzes(workspace_id, created_at DESC);
             CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz ON quiz_questions(quiz_id, position);
             CREATE INDEX IF NOT EXISTS idx_quiz_answers_quiz ON quiz_answers(quiz_id);
             INSERT INTO _migrations(name) VALUES('v56_quizzes');",
        )?;
    }

    // v57: bridge legacy flashcard_topics into concept_nodes so the new Learning
    // hub can use a single taxonomy. Additive only — flashcard_topics rows and
    // learning_cards.topic_id remain untouched for back-compat.
    let applied_v57: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v57_topics_to_concepts'",
        [],
        |row| row.get(0),
    )?;
    if applied_v57 == 0 {
        // Guard: in legacy DB-migration snapshots used by tests, the schema-defined
        // tables (`learning_cards`, `concept_nodes`) may not exist yet — they are
        // created from `schema.sql` at app boot rather than via migrations. Skip
        // the backfill cleanly when any required table is missing; the marker is
        // still recorded so we don't keep retrying on every open.
        let tables_present = ["flashcard_topics", "concept_nodes", "learning_cards"]
            .iter()
            .all(|name| {
                conn.query_row(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
                    rusqlite::params![name],
                    |_| Ok(()),
                )
                .is_ok()
            });
        if tables_present {
            migrate_topics_to_concepts(conn)?;
        }
        conn.execute(
            "INSERT INTO _migrations(name) VALUES('v57_topics_to_concepts')",
            [],
        )?;
    }

    // v58: learning_goals gains optional concept_id so the Learning hub Goals
    // tab can scope to a selected concept. Additive nullable column.
    let applied_v58: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v58_learning_goals_concept_id'",
        [],
        |row| row.get(0),
    )?;
    if applied_v58 == 0 {
        let has_col: bool = {
            let mut stmt = conn.prepare("PRAGMA table_info(learning_goals)")?;
            let names = stmt
                .query_map([], |r| r.get::<_, String>(1))?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            names.iter().any(|n| n == "concept_id")
        };
        if !has_col {
            let _ = conn.execute_batch(
                "ALTER TABLE learning_goals ADD COLUMN concept_id TEXT REFERENCES concept_nodes(id) ON DELETE SET NULL;",
            );
        }
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_learning_goals_concept ON learning_goals(concept_id);
             INSERT INTO _migrations(name) VALUES('v58_learning_goals_concept_id');",
        )?;
    }

    // v59: denormalize chat message counts onto chat_sessions for fast session listing.
    let applied_v59: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v59_chat_sessions_message_count'",
        [],
        |row| row.get(0),
    )?;
    if applied_v59 == 0 {
        let has_col: bool = {
            let mut stmt = conn.prepare("PRAGMA table_info(chat_sessions)")?;
            let names = stmt
                .query_map([], |r| r.get::<_, String>(1))?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            names.iter().any(|n| n == "message_count")
        };
        if !has_col {
            let _ = conn.execute_batch(
                "ALTER TABLE chat_sessions ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;",
            );
        }

        conn.execute_batch(
            "UPDATE chat_sessions
             SET message_count = COALESCE((
                 SELECT COUNT(*)
                 FROM messages
                 WHERE messages.session_id = chat_sessions.id
             ), 0);

             DROP TRIGGER IF EXISTS chat_sessions_message_count_ai;
             CREATE TRIGGER chat_sessions_message_count_ai
             AFTER INSERT ON messages
             BEGIN
                 UPDATE chat_sessions
                 SET message_count = message_count + 1
                 WHERE id = NEW.session_id;
             END;

             DROP TRIGGER IF EXISTS chat_sessions_message_count_ad;
             CREATE TRIGGER chat_sessions_message_count_ad
             AFTER DELETE ON messages
             BEGIN
                 UPDATE chat_sessions
                 SET message_count = CASE WHEN message_count > 0 THEN message_count - 1 ELSE 0 END
                 WHERE id = OLD.session_id;
             END;

             DROP TRIGGER IF EXISTS chat_sessions_message_count_au;
             CREATE TRIGGER chat_sessions_message_count_au
             AFTER UPDATE OF session_id ON messages
             WHEN OLD.session_id != NEW.session_id
             BEGIN
                 UPDATE chat_sessions
                 SET message_count = CASE WHEN message_count > 0 THEN message_count - 1 ELSE 0 END
                 WHERE id = OLD.session_id;

                 UPDATE chat_sessions
                 SET message_count = message_count + 1
                 WHERE id = NEW.session_id;
             END;

             INSERT INTO _migrations(name) VALUES('v59_chat_sessions_message_count');",
        )?;
    }

    // v60: add about_you to workspaces and seed global about_you / inject_about_you_into_chat settings.
    let applied_v60: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v60_about_you'",
        [],
        |row| row.get(0),
    )?;
    if applied_v60 == 0 {
        let has_col: bool = {
            let mut stmt = conn.prepare("PRAGMA table_info(workspaces)")?;
            let names = stmt
                .query_map([], |r| r.get::<_, String>(1))?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            names.iter().any(|n| n == "about_you")
        };
        if !has_col {
            let _ = conn.execute_batch(
                "ALTER TABLE workspaces ADD COLUMN about_you TEXT NOT NULL DEFAULT '';",
            );
        }
        let _ = conn.execute_batch(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('about_you', '\"\"');\n             INSERT OR IGNORE INTO settings (key, value) VALUES ('inject_about_you_into_chat', 'true');",
        );
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v60_about_you');")?;
    }

    // v61: add reinforcement_count + last_reinforced_at to memories so we can
    // record how often a near-duplicate fact has been re-asserted.
    let applied_v61: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v61_memories_reinforcement'",
        [],
        |row| row.get(0),
    )?;
    if applied_v61 == 0 {
        let (has_reinforce, has_last_reinforced) = {
            let mut stmt = conn.prepare("PRAGMA table_info(memories)")?;
            let names = stmt
                .query_map([], |r| r.get::<_, String>(1))?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            (
                names.iter().any(|n| n == "reinforcement_count"),
                names.iter().any(|n| n == "last_reinforced_at"),
            )
        };
        if !has_reinforce {
            let _ = conn.execute_batch(
                "ALTER TABLE memories ADD COLUMN reinforcement_count INTEGER NOT NULL DEFAULT 1;",
            );
        }
        if !has_last_reinforced {
            let _ = conn.execute_batch("ALTER TABLE memories ADD COLUMN last_reinforced_at TEXT;");
        }
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v61_memories_reinforcement');")?;
    }

    // v62: add supersession columns to memories so the contradiction-detection
    // judge can mark old memories as replaced by new ones without deleting them.
    let applied_v62: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v62_memories_supersession'",
        [],
        |row| row.get(0),
    )?;
    if applied_v62 == 0 {
        let (has_by, has_at, has_reason) = {
            let mut stmt = conn.prepare("PRAGMA table_info(memories)")?;
            let names = stmt
                .query_map([], |r| r.get::<_, String>(1))?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            (
                names.iter().any(|n| n == "superseded_by"),
                names.iter().any(|n| n == "superseded_at"),
                names.iter().any(|n| n == "superseded_reason"),
            )
        };
        // SQLite cannot add a column with a REFERENCES constraint via ALTER
        // TABLE; the FK is enforced only on tables created via schema.sql. For
        // existing databases we add a plain TEXT column — referential integrity
        // is best-effort here and the application clears stale ids on delete.
        if !has_by {
            let _ = conn.execute_batch("ALTER TABLE memories ADD COLUMN superseded_by TEXT;");
        }
        if !has_at {
            let _ = conn.execute_batch("ALTER TABLE memories ADD COLUMN superseded_at TEXT;");
        }
        if !has_reason {
            let _ = conn.execute_batch("ALTER TABLE memories ADD COLUMN superseded_reason TEXT;");
        }
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v62_memories_supersession');")?;
    }

    // v63: add `parent_checked_at` to `concept_nodes` so the LLM-driven
    // hierarchy job can avoid re-evaluating concepts that have already been
    // checked recently, and enforce uniqueness on `concept_links`
    // (source_id, target_id, link_type) so the auto job cannot insert
    // duplicate `part_of` edges on retries / races.
    let applied_v63: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v63_concept_hierarchy_job'",
        [],
        |row| row.get(0),
    )?;
    if applied_v63 == 0 {
        let has_parent_checked_at = {
            let mut stmt = conn.prepare("PRAGMA table_info(concept_nodes)")?;
            let names = stmt
                .query_map([], |r| r.get::<_, String>(1))?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            names.iter().any(|n| n == "parent_checked_at")
        };
        if !has_parent_checked_at {
            let _ =
                conn.execute_batch("ALTER TABLE concept_nodes ADD COLUMN parent_checked_at TEXT;");
        }
        // Dedupe any existing duplicate concept_links rows before adding the
        // unique index — keep the earliest row per (source_id, target_id,
        // link_type) tuple. Best-effort: ignored if the rowids cannot be
        // resolved on an older database shape.
        let _ = conn.execute_batch(
            "DELETE FROM concept_links
             WHERE rowid NOT IN (
                 SELECT MIN(rowid) FROM concept_links
                 GROUP BY source_id, target_id, link_type
             );",
        );
        let _ = conn.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_concept_links_source_target_type
                 ON concept_links(source_id, target_id, link_type);",
        );
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v63_concept_hierarchy_job');")?;
    }

    // v64: clean up legacy `part_of` rows whose (child, parent) hierarchy
    // levels violate the chapter → section → concept invariant. These rows
    // pre-date `concept_hierarchy_service::persist_link`'s level guard and
    // cause renderers to silently drop edges, which in turn surfaces as
    // "Uncategorized" appearing as a child of some other chapter's subtree.
    let applied_v64: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v64_cleanup_invalid_part_of'",
        [],
        |row| row.get(0),
    )?;
    if applied_v64 == 0 {
        let _ = conn.execute_batch(
            "DELETE FROM concept_links
             WHERE link_type = 'part_of'
               AND id IN (
                 SELECT l.id FROM concept_links l
                 JOIN concept_nodes c ON c.id = l.source_id
                 JOIN concept_nodes p ON p.id = l.target_id
                 WHERE l.link_type = 'part_of'
                   AND NOT (
                     (c.hierarchy_level = 'concept' AND p.hierarchy_level = 'section')
                     OR (c.hierarchy_level = 'section' AND p.hierarchy_level = 'chapter')
                   )
               );",
        );
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v64_cleanup_invalid_part_of');")?;
    }

    // v65: persistent workspace prompt bank for explorer/starter prompts.
    let applied_v65: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v65_workspace_prompt_bank'",
        [],
        |row| row.get(0),
    )?;
    if applied_v65 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS workspace_prompt_bank (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                prompt TEXT NOT NULL,
                normalized_prompt TEXT NOT NULL,
                tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
                source TEXT NOT NULL DEFAULT 'ai'
                    CHECK(source IN ('ai','manual','fallback')),
                embedding BLOB,
                embedding_model TEXT,
                quality_score REAL NOT NULL DEFAULT 0.0,
                used_count INTEGER NOT NULL DEFAULT 0,
                dismissed_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(workspace_id, normalized_prompt)
            );
            CREATE TABLE IF NOT EXISTS workspace_prompt_bank_jobs (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                status TEXT NOT NULL DEFAULT 'queued'
                    CHECK(status IN ('queued','running','completed','failed','cancelled')),
                target_count INTEGER NOT NULL DEFAULT 120,
                generated_count INTEGER NOT NULL DEFAULT 0,
                model TEXT NOT NULL DEFAULT '',
                error TEXT,
                started_at TEXT,
                completed_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_workspace_prompt_bank_workspace
                ON workspace_prompt_bank(workspace_id, dismissed_at, used_count);
            CREATE INDEX IF NOT EXISTS idx_workspace_prompt_bank_jobs_workspace
                ON workspace_prompt_bank_jobs(workspace_id, status, created_at);
            INSERT INTO _migrations(name) VALUES('v65_workspace_prompt_bank');",
        )?;
    }

    let applied_v66: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v66_knowledge_graph_model_upgrade'",
        [],
        |row| row.get(0),
    )?;
    if applied_v66 == 0 {
        // 1. Alter concept_nodes
        let (has_sm, has_conf, has_uef, has_sup_by, has_sup_at, has_sup_re, has_job) = {
            let mut stmt = conn.prepare("PRAGMA table_info(concept_nodes)")?;
            let names = stmt
                .query_map([], |r| r.get::<_, String>(1))?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            (
                names.iter().any(|n| n == "source_model"),
                names.iter().any(|n| n == "confidence"),
                names.iter().any(|n| n == "user_edited_fields"),
                names.iter().any(|n| n == "superseded_by"),
                names.iter().any(|n| n == "superseded_at"),
                names.iter().any(|n| n == "supersede_reason"),
                names.iter().any(|n| n == "last_modified_by_job"),
            )
        };
        if !has_sm {
            let _ = conn.execute_batch("ALTER TABLE concept_nodes ADD COLUMN source_model TEXT;");
        }
        if !has_conf {
            let _ = conn.execute_batch(
                "ALTER TABLE concept_nodes ADD COLUMN confidence REAL NOT NULL DEFAULT 0.5;",
            );
        }
        if !has_uef {
            let _ = conn.execute_batch("ALTER TABLE concept_nodes ADD COLUMN user_edited_fields TEXT NOT NULL DEFAULT '[]';");
        }
        if !has_sup_by {
            let _ = conn.execute_batch("ALTER TABLE concept_nodes ADD COLUMN superseded_by TEXT;");
        }
        if !has_sup_at {
            let _ = conn.execute_batch("ALTER TABLE concept_nodes ADD COLUMN superseded_at TEXT;");
        }
        if !has_sup_re {
            let _ =
                conn.execute_batch("ALTER TABLE concept_nodes ADD COLUMN supersede_reason TEXT;");
        }
        if !has_job {
            let _ = conn
                .execute_batch("ALTER TABLE concept_nodes ADD COLUMN last_modified_by_job TEXT;");
        }

        // 2. Alter concept_links
        let (has_link_sm, has_link_conf, has_link_uef, has_link_job) = {
            let mut stmt = conn.prepare("PRAGMA table_info(concept_links)")?;
            let names = stmt
                .query_map([], |r| r.get::<_, String>(1))?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            (
                names.iter().any(|n| n == "source_model"),
                names.iter().any(|n| n == "confidence"),
                names.iter().any(|n| n == "user_edited_fields"),
                names.iter().any(|n| n == "last_modified_by_job"),
            )
        };
        if !has_link_sm {
            let _ = conn.execute_batch("ALTER TABLE concept_links ADD COLUMN source_model TEXT;");
        }
        if !has_link_conf {
            let _ = conn.execute_batch(
                "ALTER TABLE concept_links ADD COLUMN confidence REAL NOT NULL DEFAULT 0.5;",
            );
        }
        if !has_link_uef {
            let _ = conn.execute_batch("ALTER TABLE concept_links ADD COLUMN user_edited_fields TEXT NOT NULL DEFAULT '[]';");
        }
        if !has_link_job {
            let _ = conn
                .execute_batch("ALTER TABLE concept_links ADD COLUMN last_modified_by_job TEXT;");
        }

        // 3. Create proposals table & default settings keys
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS concept_change_proposals (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                job_id TEXT REFERENCES analyze_jobs(id) ON DELETE CASCADE,
                proposal_type TEXT NOT NULL CHECK (proposal_type IN ('upgrade','supersede','merge')),
                target_node_id TEXT REFERENCES concept_nodes(id) ON DELETE CASCADE,
                payload TEXT NOT NULL CHECK (json_valid(payload)),
                reason TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE INDEX IF NOT EXISTS idx_concept_change_proposals_workspace ON concept_change_proposals(workspace_id);
             INSERT OR IGNORE INTO settings (key, value) VALUES
                ('knowledge.upgrade_mode', '\"auto\"'),
                ('knowledge.supersede_mode', '\"auto\"'),
                ('knowledge.confidence_threshold', '0.05');
             INSERT INTO _migrations(name) VALUES('v66_knowledge_graph_model_upgrade');"
        )?;
    }

    let applied_v67: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v67_lower_summarization_min_messages'",
        [],
        |row| row.get(0),
    )?;
    if applied_v67 == 0 {
        conn.execute_batch(
            "UPDATE settings
             SET value = '1'
             WHERE key = 'summarization_min_messages'
               AND value = '10';
             INSERT INTO _migrations(name) VALUES('v67_lower_summarization_min_messages');",
        )?;
    }

    let applied_v68: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v68_roadmap_snapshots'",
        [],
        |row| row.get(0),
    )?;

    if applied_v68 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS roadmap_snapshots (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                source_job_id TEXT REFERENCES analyze_jobs(id) ON DELETE SET NULL,
                source_model TEXT,
                concept_count INTEGER NOT NULL DEFAULT 0,
                link_count INTEGER NOT NULL DEFAULT 0,
                payload TEXT NOT NULL CHECK (json_valid(payload)),
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_roadmap_snapshots_workspace_created
                ON roadmap_snapshots(workspace_id, created_at DESC);
            INSERT INTO _migrations(name) VALUES('v68_roadmap_snapshots');",
        )?;
    }

    let applied_v69: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v69_project_notes_folder'",
        [],
        |row| row.get(0),
    )?;

    if applied_v69 == 0 {
        // Idempotent guard — older builds may have already added the column via
        // `schema.sql` running after migrations on existing databases.
        let has_folder: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('project_notes') WHERE name = 'folder'",
            [],
            |row| row.get(0),
        )?;
        if has_folder == 0 {
            conn.execute_batch("ALTER TABLE project_notes ADD COLUMN folder TEXT;")?;
        }
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v69_project_notes_folder');")?;
    }

    let applied_v70: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v70_project_notes_pinning'",
        [],
        |row| row.get(0),
    )?;

    if applied_v70 == 0 {
        let has_is_pinned: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('project_notes') WHERE name = 'is_pinned'",
            [],
            |row| row.get(0),
        )?;
        if has_is_pinned == 0 {
            conn.execute_batch(
                "ALTER TABLE project_notes ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;",
            )?;
        }
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_project_notes_workspace_pinned_updated
                 ON project_notes(workspace_id, is_pinned, updated_at DESC);
             INSERT INTO _migrations(name) VALUES('v70_project_notes_pinning');",
        )?;
    }

    let applied_v71: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v71_conversation_summary_types'",
        [],
        |row| row.get(0),
    )?;

    if applied_v71 == 0 {
        conn.execute_batch(
            "ALTER TABLE conversation_summaries RENAME TO conversation_summaries_old;
             CREATE TABLE conversation_summaries (
                id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                summary_type TEXT NOT NULL DEFAULT 'info'
                    CHECK(summary_type IN ('info', 'extensive')),
                content TEXT NOT NULL,
                key_topics TEXT NOT NULL DEFAULT '[]',
                message_range_start INTEGER NOT NULL,
                message_range_end INTEGER NOT NULL,
                token_count INTEGER NOT NULL DEFAULT 0,
                embedding BLOB,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             INSERT INTO conversation_summaries (
                id, session_id, workspace_id, summary_type, content, key_topics,
                message_range_start, message_range_end, token_count, embedding, created_at, updated_at
             )
             SELECT
                id,
                session_id,
                workspace_id,
                CASE summary_type
                    WHEN 'rolling' THEN 'info'
                    ELSE 'extensive'
                END,
                content,
                key_topics,
                message_range_start,
                message_range_end,
                token_count,
                embedding,
                created_at,
                updated_at
             FROM conversation_summaries_old;
             DROP TABLE conversation_summaries_old;
             UPDATE quick_search_documents
             SET subtitle = CASE
                WHEN body IS NOT NULL AND doc_id LIKE 'summary:%' AND target_id IN (
                    SELECT id FROM conversation_summaries WHERE summary_type = 'extensive'
                ) THEN 'Extensive summary'
                WHEN doc_id LIKE 'summary:%' THEN 'Info summary'
                ELSE subtitle
             END
             WHERE kind = 'summary';
             INSERT INTO _migrations(name) VALUES('v71_conversation_summary_types');",
        )?;
    }

    let applied_v72: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v72_make_memories_workspace_nullable'",
        [],
        |row| row.get(0),
    )?;

    if applied_v72 == 0 {
        conn.execute_batch(
            "PRAGMA foreign_keys=OFF;
             ALTER TABLE memories RENAME TO memories_old;
             CREATE TABLE memories (
                 id TEXT PRIMARY KEY NOT NULL,
                 workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
                 folder_id TEXT NOT NULL DEFAULT '',
                 content TEXT NOT NULL,
                 memory_type TEXT NOT NULL DEFAULT 'fact'
                     CHECK(memory_type IN ('fact', 'preference')),
                 scope TEXT NOT NULL DEFAULT 'workspace'
                     CHECK(scope IN ('global', 'workspace')),
                 source_session_id TEXT,
                 is_pinned INTEGER NOT NULL DEFAULT 0,
                 is_active INTEGER NOT NULL DEFAULT 1,
                 reinforcement_count INTEGER NOT NULL DEFAULT 1,
                 last_reinforced_at TEXT,
                 superseded_by TEXT REFERENCES memories(id) ON DELETE SET NULL,
                 superseded_at TEXT,
                 superseded_reason TEXT,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             INSERT INTO memories (
                 id, workspace_id, folder_id, content, memory_type, scope, source_session_id,
                 is_pinned, is_active, reinforcement_count, last_reinforced_at,
                 superseded_by, superseded_at, superseded_reason, created_at, updated_at
             )
             SELECT
                 id, workspace_id, folder_id, content, memory_type, scope, source_session_id,
                 is_pinned, is_active, reinforcement_count, last_reinforced_at,
                 superseded_by, superseded_at, superseded_reason, created_at, updated_at
             FROM memories_old;
             DROP TABLE memories_old;
             PRAGMA foreign_keys=ON;
             INSERT INTO _migrations(name) VALUES('v72_make_memories_workspace_nullable');",
        )?;
    }

    // v73: repair `quick_search_chat_sessions_au` for databases where v71's
    // ALTER TABLE ... RENAME caused SQLite to rewrite the trigger body to
    // reference `conversation_summaries_old`. After v71 dropped that table the
    // trigger dangles, and any subsequent UPDATE on chat_sessions panics with
    // "no such table: main.conversation_summaries_old". Drop it here — the
    // schema.sql apply that runs right after migrations recreates the trigger
    // with the correct `conversation_summaries` reference.
    let applied_v73: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v73_repair_quick_search_chat_sessions_au'",
        [],
        |row| row.get(0),
    )?;

    if applied_v73 == 0 {
        conn.execute_batch(
            "DROP TRIGGER IF EXISTS quick_search_chat_sessions_au;
             INSERT INTO _migrations(name) VALUES('v73_repair_quick_search_chat_sessions_au');",
        )?;
    }

    let applied_v74: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v74_inference_job_runs'",
        [],
        |row| row.get(0),
    )?;

    if applied_v74 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS inference_job_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_key TEXT NOT NULL,
                workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                duration_ms INTEGER,
                input_tokens INTEGER,
                output_tokens INTEGER,
                status TEXT NOT NULL,
                error_message TEXT
            );
             CREATE INDEX IF NOT EXISTS idx_inference_job_runs_key_completed
                ON inference_job_runs(job_key, workspace_id, completed_at DESC);
             INSERT INTO _migrations(name) VALUES('v74_inference_job_runs');",
        )?;
    }

    // v75: repair workspace-scoped tables whose shape drifted on upgraded
    // databases. Two historical defects, both invisible to `cargo check` and
    // both blocking every INSERT while features appeared to "work":
    //   1. `learning_cards.workspace_id` still carried the legacy FK to
    //      "folders" (a column rename kept the old constraint), so inserting a
    //      card with a real workspace id failed `FOREIGN KEY constraint failed`.
    //   2. `uploaded_documents`, `web_captures`, `audio_transcriptions`, and
    //      `project_notes` kept a legacy `NOT NULL project_id/folder_id`
    //      FK column that current INSERTs never populate, while their bolted-on
    //      `workspace_id` column had no FK at all.
    // Each table is rebuilt to the schema.sql shape only when the drift marker
    // is present, so fresh installs and already-repaired databases skip the
    // rebuild entirely (idempotent re-runs).
    // Keep the shipped migration unchanged, but commit its work and marker
    // together so a new interruption cannot strand another rebuild table.
    apply_v75_atomically(conn)?;
    let applied_v75: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v75_fix_workspace_fk_shapes'",
        [],
        |row| row.get(0),
    )?;

    if applied_v75 == 0 {
        v75_fix_workspace_fk_shapes(conn)?;
        conn.execute(
            "INSERT INTO _migrations(name) VALUES('v75_fix_workspace_fk_shapes')",
            [],
        )?;
    }

    // v76: record which model generated each flashcard, enabling the cleanup
    // job to prefer cards from larger models when deduplicating. Idempotent:
    // the column is only added when missing (fresh installs get it from
    // schema.sql).
    let applied_v76: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v76_learning_cards_generated_by_model'",
        [],
        |row| row.get(0),
    )?;

    if applied_v76 == 0 {
        let has_column: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('learning_cards') WHERE name = 'generated_by_model'",
            [],
            |row| row.get(0),
        )?;
        if has_column == 0 {
            conn.execute_batch("ALTER TABLE learning_cards ADD COLUMN generated_by_model TEXT;")?;
        }
        conn.execute(
            "INSERT INTO _migrations(name) VALUES('v76_learning_cards_generated_by_model')",
            [],
        )?;
    }

    // v77: blocked_topics table — per-workspace name-based topic blocklist.
    // Survives concept_nodes deletion/recreation on signature resync.
    let applied_v77: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v77_blocked_topics'",
        [],
        |row| row.get(0),
    )?;

    if applied_v77 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS blocked_topics (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                normalized_name TEXT NOT NULL,
                display_name TEXT NOT NULL,
                blocked_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(workspace_id, normalized_name)
            );
            CREATE INDEX IF NOT EXISTS idx_blocked_topics_workspace ON blocked_topics(workspace_id);",
        )?;
        conn.execute(
            "INSERT INTO _migrations(name) VALUES('v77_blocked_topics')",
            [],
        )?;
    }

    // v78: add kind column to learning_cards
    let applied_v78: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v78_learning_cards_kind'",
        [],
        |row| row.get(0),
    )?;

    if applied_v78 == 0 {
        let mut pragma = conn.prepare("PRAGMA table_info(learning_cards);")?;
        let columns = pragma.query_map([], |r| r.get::<_, String>(1))?;
        let mut has_kind = false;
        for col in columns {
            if col? == "kind" {
                has_kind = true;
                break;
            }
        }
        if !has_kind {
            conn.execute_batch("ALTER TABLE learning_cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'flashcard';")?;
        }
        conn.execute(
            "INSERT INTO _migrations(name) VALUES('v78_learning_cards_kind')",
            [],
        )?;
    }

    // v79: import source identity — link imported chats/memories/destinations
    // back to their source-export identifiers so re-imports merge instead of
    // duplicating.
    let applied_v79: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v79_import_source_links'",
        [],
        |row| row.get(0),
    )?;

    if applied_v79 == 0 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS import_source_links (
                id TEXT PRIMARY KEY NOT NULL,
                source TEXT NOT NULL,
                source_conversation_uuid TEXT NOT NULL,
                chat_session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(source, source_conversation_uuid)
            );
            CREATE INDEX IF NOT EXISTS idx_import_source_links_session ON import_source_links(chat_session_id);
            CREATE TABLE IF NOT EXISTS import_destinations (
                id TEXT PRIMARY KEY NOT NULL,
                source TEXT NOT NULL,
                source_project_uuid TEXT NOT NULL,
                source_project_name TEXT NOT NULL DEFAULT '',
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                folder_id TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(source, source_project_uuid)
            );
            CREATE TABLE IF NOT EXISTS import_memory_links (
                id TEXT PRIMARY KEY NOT NULL,
                source TEXT NOT NULL,
                source_project_uuid TEXT NOT NULL,
                memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
                content_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(source, source_project_uuid)
            );",
        )?;
        conn.execute(
            "INSERT INTO _migrations(name) VALUES('v79_import_source_links')",
            [],
        )?;
    }

    // v80: snapshot provenance — record WHY a roadmap snapshot was captured
    // ('analysis' | 'scheduled' | 'manual' | 'drift') and a content hash of the
    // payload so repeat captures of an unchanged graph can be skipped instead of
    // writing an identical row every cycle.
    //
    // `reason` deliberately has no CHECK constraint: ALTER TABLE ADD COLUMN
    // cannot add one without a full table rebuild, so a fresh DB (schema.sql)
    // and a migrated DB would end up with divergent DDL — the exact drift class
    // v75 exists to repair. The value is validated in Rust instead.
    let applied_v80: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v80_roadmap_snapshot_reason'",
        [],
        |row| row.get(0),
    )?;

    if applied_v80 == 0 {
        let (has_reason, has_hash) = {
            let mut pragma = conn.prepare("PRAGMA table_info(roadmap_snapshots);")?;
            let columns = pragma.query_map([], |r| r.get::<_, String>(1))?;
            let mut reason = false;
            let mut hash = false;
            for col in columns {
                match col?.as_str() {
                    "reason" => reason = true,
                    "payload_hash" => hash = true,
                    _ => {}
                }
            }
            (reason, hash)
        };
        if !has_reason {
            conn.execute_batch(
                "ALTER TABLE roadmap_snapshots ADD COLUMN reason TEXT NOT NULL DEFAULT 'analysis';",
            )?;
        }
        if !has_hash {
            conn.execute_batch(
                "ALTER TABLE roadmap_snapshots ADD COLUMN payload_hash TEXT NOT NULL DEFAULT '';",
            )?;
        }
        // Existing databases already ran schema.sql's seed at creation time and
        // will not re-run it, so the new defaults have to be written here too.
        conn.execute_batch(
            "INSERT OR IGNORE INTO settings (key, value) VALUES
                ('roadmap_snapshot_auto_enabled', 'true'),
                ('roadmap_snapshot_interval_hours', '24'),
                ('roadmap_snapshot_retention_days', '60'),
                ('roadmap_snapshot_max_per_workspace', '40'),
                ('roadmap_snapshot_drift_threshold', '0.15');",
        )?;
        conn.execute(
            "INSERT INTO _migrations(name) VALUES('v80_roadmap_snapshot_reason')",
            [],
        )?;
    }

    let applied_v81: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v81_search_session_workspace'",
        [],
        |row| row.get(0),
    )?;
    if applied_v81 == 0 {
        let tx = conn.unchecked_transaction()?;
        let has_search: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'quick_search_documents')",
            [],
            |row| row.get(0),
        )?;
        if has_search {
            // Install the metadata guard before backfilling. Bootstrap applies
            // the current schema immediately after migrations, replacing the
            // session/artifact/summary triggers on every upgraded database.
            tx.execute_batch(
                "DROP TRIGGER IF EXISTS quick_search_documents_au;
                 CREATE TRIGGER quick_search_documents_au
                 AFTER UPDATE ON quick_search_documents
                 WHEN OLD.title != NEW.title OR OLD.subtitle != NEW.subtitle OR OLD.body != NEW.body
                 BEGIN
                     INSERT INTO quick_search_documents_fts(quick_search_documents_fts, rowid, title, subtitle, body)
                     VALUES ('delete', OLD.rowid, OLD.title, OLD.subtitle, OLD.body);
                     INSERT INTO quick_search_documents_fts(rowid, title, subtitle, body)
                     VALUES (NEW.rowid, NEW.title, NEW.subtitle, NEW.body);
                 END;
                 UPDATE quick_search_documents AS d
                 SET workspace_id = cs.workspace_id, folder_id = NULLIF(cs.folder_id, '')
                 FROM chat_sessions AS cs
                 WHERE d.session_id = cs.id
                   AND d.kind IN ('conversation', 'message', 'artifact', 'summary')
                   AND (d.workspace_id IS NOT cs.workspace_id OR d.folder_id IS NOT NULLIF(cs.folder_id, ''));",
            )?;
        }
        tx.execute(
            "INSERT INTO _migrations(name) VALUES('v81_search_session_workspace')",
            [],
        )?;
        tx.commit()?;
    }

    let applied_v82: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v82_chat_file_sync_outbox'",
        [],
        |row| row.get(0),
    )?;
    if applied_v82 == 0 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS chat_file_sync_outbox (
                 id TEXT PRIMARY KEY NOT NULL,
                 session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                 previous_plain TEXT NOT NULL,
                 previous_encrypted TEXT NOT NULL,
                 requires_encryption INTEGER NOT NULL DEFAULT 0,
                 created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE INDEX IF NOT EXISTS idx_chat_file_sync_outbox_session
                 ON chat_file_sync_outbox(session_id);",
        )?;
        tx.execute(
            "INSERT INTO _migrations(name) VALUES('v82_chat_file_sync_outbox')",
            [],
        )?;
        tx.commit()?;
    }

    Ok(())
}

/// Recover the five nontransactional rebuilds before schema bootstrap can
/// recreate an empty original table over a surviving temporary copy.
fn repair_interrupted_v75(conn: &Connection) -> Result<()> {
    let applied: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM _migrations WHERE name = 'v75_fix_workspace_fk_shapes')",
        [],
        |row| row.get(0),
    )?;
    if applied {
        return Ok(());
    }

    let legacy_alter: bool = conn.query_row("PRAGMA legacy_alter_table", [], |r| r.get(0))?;
    conn.pragma_update(None, "legacy_alter_table", true)?;
    let result = (|| {
        let tx = conn.unchecked_transaction()?;
        for table in [
            "learning_cards",
            "uploaded_documents",
            "web_captures",
            "audio_transcriptions",
            "project_notes",
        ] {
            let temp = format!("{table}_v75");
            let exists = |name: &str| -> Result<bool> {
                tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                    [name],
                    |row| row.get(0),
                )
            };
            if !exists(&temp)? {
                continue;
            }
            if exists(table)? {
                // A pre-DROP interruption leaves the original authoritative.
                // Verify every temporary row is still represented before
                // discarding the partial copy; unexpected drift fails closed.
                let columns = tx
                    .prepare("SELECT name FROM pragma_table_info(?1) ORDER BY cid")?
                    .query_map([&temp], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>>>()?
                    .into_iter()
                    .map(|name| format!("\"{}\"", name.replace('"', "\"\"")))
                    .collect::<Vec<_>>()
                    .join(", ");
                let diverged: bool = tx.query_row(
                    &format!(
                        "SELECT EXISTS(SELECT {columns} FROM \"{temp}\"
                         EXCEPT SELECT {columns} FROM \"{table}\")"
                    ),
                    [],
                    |row| row.get(0),
                )?;
                if diverged {
                    return Err(rusqlite::Error::InvalidParameterName(format!(
                        "Cannot recover {temp}: temporary rows differ from the original; both copies preserved"
                    )));
                }
                tx.execute_batch(&format!("DROP TABLE \"{temp}\";"))?;
            } else {
                // After DROP the temporary table is the only surviving copy.
                // Legacy ALTER permits the rename while old triggers still
                // refer to the temporarily absent original table.
                tx.execute_batch(&format!("ALTER TABLE \"{temp}\" RENAME TO \"{table}\";"))?;
            }
        }
        tx.commit()
    })();
    conn.pragma_update(None, "legacy_alter_table", legacy_alter)?;
    result
}

fn apply_v75_atomically(conn: &Connection) -> Result<()> {
    let applied: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM _migrations WHERE name = 'v75_fix_workspace_fk_shapes')",
        [],
        |row| row.get(0),
    )?;
    if applied {
        return Ok(());
    }
    let foreign_keys: bool = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
    conn.pragma_update(None, "foreign_keys", false)?;
    let result = (|| {
        let tx = conn.unchecked_transaction()?;
        v75_fix_workspace_fk_shapes(&tx)?;
        tx.execute(
            "INSERT INTO _migrations(name) VALUES('v75_fix_workspace_fk_shapes')",
            [],
        )?;
        tx.commit()
    })();
    conn.pragma_update(None, "foreign_keys", foreign_keys)?;
    result
}

/// Returns true when the workspace foreign-key declaration has drifted.
fn v75_table_needs_rebuild(conn: &Connection, table: &str) -> Result<bool> {
    let sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            rusqlite::params![table],
            |row| row.get(0),
        )
        .optional()?;
    let Some(sql) = sql else {
        // Table absent (very old DB before its introduction) — schema.sql
        // creates it correctly on this same startup, nothing to rebuild.
        return Ok(false);
    };
    let normalized = sql.split_whitespace().collect::<Vec<_>>().join(" ");
    Ok(!normalized.contains("workspace_id TEXT NOT NULL REFERENCES workspaces"))
}

fn v75_fix_workspace_fk_shapes(conn: &Connection) -> Result<()> {
    if v75_table_needs_rebuild(conn, "learning_cards")? {
        conn.execute_batch(
            "PRAGMA foreign_keys=OFF;
             CREATE TABLE learning_cards_v75 (
                 id TEXT PRIMARY KEY NOT NULL,
                 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                 front TEXT NOT NULL,
                 back TEXT NOT NULL,
                 source_type TEXT NOT NULL DEFAULT 'manual',
                 source_id TEXT,
                 topic_id TEXT,
                 ease_factor REAL NOT NULL DEFAULT 2.5,
                 interval INTEGER NOT NULL DEFAULT 1,
                 repetitions INTEGER NOT NULL DEFAULT 0,
                 next_review_date TEXT NOT NULL DEFAULT (date('now')),
                 last_reviewed_at TEXT,
                 created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             INSERT INTO learning_cards_v75 (id, workspace_id, front, back, source_type, source_id, topic_id, ease_factor, interval, repetitions, next_review_date, last_reviewed_at, created_at)
             SELECT id, workspace_id, front, back, source_type, source_id, topic_id, ease_factor, interval, repetitions, next_review_date, last_reviewed_at, created_at
             FROM learning_cards
             WHERE workspace_id IN (SELECT id FROM workspaces);
             DROP TABLE learning_cards;
             ALTER TABLE learning_cards_v75 RENAME TO learning_cards;
             CREATE INDEX IF NOT EXISTS idx_learning_cards_review ON learning_cards(next_review_date);
             CREATE INDEX IF NOT EXISTS idx_learning_cards_workspace_review ON learning_cards(workspace_id, next_review_date);
             PRAGMA foreign_keys=ON;",
        )?;
    }

    if v75_table_needs_rebuild(conn, "uploaded_documents")? {
        conn.execute_batch(
            "PRAGMA foreign_keys=OFF;
             CREATE TABLE uploaded_documents_v75 (
                 id TEXT PRIMARY KEY NOT NULL,
                 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                 filename TEXT NOT NULL,
                 file_type TEXT NOT NULL,
                 file_size INTEGER NOT NULL DEFAULT 0,
                 content TEXT NOT NULL DEFAULT '',
                 summary TEXT,
                 is_processed INTEGER NOT NULL DEFAULT 0,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             INSERT INTO uploaded_documents_v75 (id, workspace_id, filename, file_type, file_size, content, summary, is_processed, created_at, updated_at)
             SELECT id, workspace_id, filename, file_type, file_size, content, summary, is_processed, created_at, updated_at
             FROM uploaded_documents
             WHERE workspace_id IN (SELECT id FROM workspaces);
             DROP TABLE uploaded_documents;
             ALTER TABLE uploaded_documents_v75 RENAME TO uploaded_documents;
             CREATE INDEX IF NOT EXISTS idx_uploaded_docs_workspace ON uploaded_documents(workspace_id);
             PRAGMA foreign_keys=ON;",
        )?;
    }

    if v75_table_needs_rebuild(conn, "web_captures")? {
        conn.execute_batch(
            "PRAGMA foreign_keys=OFF;
             CREATE TABLE web_captures_v75 (
                 id TEXT PRIMARY KEY NOT NULL,
                 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                 url TEXT NOT NULL,
                 title TEXT NOT NULL DEFAULT '',
                 content TEXT NOT NULL DEFAULT '',
                 summary TEXT,
                 favicon_data TEXT,
                 is_processed INTEGER NOT NULL DEFAULT 0,
                 created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             INSERT INTO web_captures_v75 (id, workspace_id, url, title, content, summary, favicon_data, is_processed, created_at)
             SELECT id, workspace_id, url, title, content, summary, favicon_data, is_processed, created_at
             FROM web_captures
             WHERE workspace_id IN (SELECT id FROM workspaces);
             DROP TABLE web_captures;
             ALTER TABLE web_captures_v75 RENAME TO web_captures;
             CREATE INDEX IF NOT EXISTS idx_web_captures_workspace ON web_captures(workspace_id);
             PRAGMA foreign_keys=ON;",
        )?;
    }

    if v75_table_needs_rebuild(conn, "audio_transcriptions")? {
        conn.execute_batch(
            "PRAGMA foreign_keys=OFF;
             CREATE TABLE audio_transcriptions_v75 (
                 id TEXT PRIMARY KEY NOT NULL,
                 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                 folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
                 filename TEXT NOT NULL,
                 transcript TEXT NOT NULL DEFAULT '',
                 duration_seconds REAL,
                 is_processed INTEGER NOT NULL DEFAULT 0,
                 created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             INSERT INTO audio_transcriptions_v75 (id, workspace_id, folder_id, filename, transcript, duration_seconds, is_processed, created_at)
             SELECT id, workspace_id, folder_id, filename, transcript, duration_seconds, is_processed, created_at
             FROM audio_transcriptions
             WHERE workspace_id IN (SELECT id FROM workspaces)
               AND (folder_id IS NULL OR folder_id IN (SELECT id FROM folders));
             DROP TABLE audio_transcriptions;
             ALTER TABLE audio_transcriptions_v75 RENAME TO audio_transcriptions;
             CREATE INDEX IF NOT EXISTS idx_audio_transcriptions_workspace ON audio_transcriptions(workspace_id);
             PRAGMA foreign_keys=ON;",
        )?;
    }

    if v75_table_needs_rebuild(conn, "project_notes")? {
        conn.execute_batch(
            "PRAGMA foreign_keys=OFF;
             CREATE TABLE project_notes_v75 (
                 id TEXT PRIMARY KEY NOT NULL,
                 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                 title TEXT NOT NULL,
                 content TEXT NOT NULL DEFAULT '',
                 note_type TEXT NOT NULL DEFAULT 'manual'
                     CHECK(note_type IN ('manual','ai_generated','quiz')),
                 tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
                 is_pinned INTEGER NOT NULL DEFAULT 0,
                 folder TEXT,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             INSERT INTO project_notes_v75 (id, workspace_id, title, content, note_type, tags, is_pinned, folder, created_at, updated_at)
             SELECT id, workspace_id, title, content, note_type, tags, is_pinned, folder, created_at, updated_at
             FROM project_notes
             WHERE workspace_id IN (SELECT id FROM workspaces)
               AND json_valid(tags);
             DROP TABLE project_notes;
             ALTER TABLE project_notes_v75 RENAME TO project_notes;
             CREATE INDEX IF NOT EXISTS idx_project_notes_workspace ON project_notes(workspace_id);
             CREATE INDEX IF NOT EXISTS idx_project_notes_workspace_updated
                 ON project_notes(workspace_id, updated_at DESC);
             CREATE INDEX IF NOT EXISTS idx_project_notes_workspace_pinned_updated
                 ON project_notes(workspace_id, is_pinned, updated_at DESC);
             PRAGMA foreign_keys=ON;",
        )?;
    }

    Ok(())
}

/// One-time backfill: for every legacy `flashcard_topics` row with no matching
/// `concept_nodes.name` (case-insensitive) in the same workspace, insert a new
/// concept node with `hierarchy_level = 'concept'`. Then, for every
/// `learning_cards.topic_id` row whose topic has an equivalent concept, set
/// `source_type = 'concept'` and `source_id = <concept_id>`. The legacy
/// `topic_id` column is left untouched.
fn migrate_topics_to_concepts(conn: &Connection) -> Result<()> {
    // Collect candidate (workspace_id, topic, topic_id) rows.
    let mut stmt =
        conn.prepare("SELECT id, workspace_id, topic, created_at FROM flashcard_topics")?;
    let rows: Vec<(String, String, String, String)> = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?
        .filter_map(std::result::Result::ok)
        .collect();
    drop(stmt);

    for (topic_id, workspace_id, topic, created_at) in rows {
        let trimmed = topic.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Look up an existing concept_node by case-insensitive name.
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM concept_nodes
                 WHERE workspace_id = ?1 AND lower(name) = lower(?2)
                 LIMIT 1",
                rusqlite::params![workspace_id, trimmed],
                |r| r.get::<_, String>(0),
            )
            .ok();

        let concept_id = if let Some(id) = existing {
            id
        } else {
            let new_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at, hierarchy_level)
                 VALUES (?1, ?2, ?3, '', 'topic', '[]', '[]', '[]', 0.0, 0.0, 0, ?4, ?4, 'concept')",
                rusqlite::params![new_id, workspace_id, trimmed, created_at],
            )?;
            new_id
        };

        // Repoint cards that referenced this topic.
        conn.execute(
            "UPDATE learning_cards
             SET source_type = 'concept', source_id = ?1
             WHERE topic_id = ?2
               AND (source_type IS NULL OR source_type != 'concept' OR source_id IS NULL)",
            rusqlite::params![concept_id, topic_id],
        )?;
    }
    Ok(())
}

fn parse_role_tags(value: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(value).unwrap_or_default()
}

fn dedupe_ai_models(conn: &Connection) -> Result<()> {
    let duplicate_keys = {
        let mut stmt = conn.prepare(
            "SELECT provider, model_id
             FROM ai_models
             GROUP BY provider, model_id
             HAVING COUNT(*) > 1",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    for (provider, model_id) in duplicate_keys {
        let rows = {
            let mut stmt = conn.prepare(
                "SELECT id, name, role_tags, priority, is_paid, enabled, tokens_used_total
                 FROM ai_models
                 WHERE provider = ?1 AND model_id = ?2
                 ORDER BY priority ASC, created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map(rusqlite::params![provider, model_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i32>(4)? != 0,
                    row.get::<_, i32>(5)? != 0,
                    row.get::<_, i64>(6)?,
                ))
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        if rows.len() < 2 {
            continue;
        }

        let canonical = &rows[0];
        let canonical_id = canonical.0.clone();
        let canonical_name = if canonical.1.trim().is_empty() {
            rows.iter()
                .skip(1)
                .find_map(|row| {
                    let name = row.1.trim();
                    if name.is_empty() {
                        None
                    } else {
                        Some(name.to_string())
                    }
                })
                .unwrap_or_default()
        } else {
            canonical.1.clone()
        };
        let enabled = rows.iter().any(|row| row.5);
        let is_paid = rows.iter().any(|row| row.4);
        let tokens_used_total = rows.iter().map(|row| row.6).sum::<i64>();
        let role_tags = rows
            .iter()
            .flat_map(|row| parse_role_tags(&row.2))
            .fold(BTreeSet::new(), |mut acc, tag| {
                acc.insert(tag);
                acc
            })
            .into_iter()
            .collect::<Vec<_>>();
        let role_tags_json = serde_json::to_string(&role_tags)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        conn.execute(
            "UPDATE ai_models
             SET name = ?1,
                 role_tags = ?2,
                 is_paid = ?3,
                 enabled = ?4,
                 tokens_used_total = ?5
             WHERE id = ?6",
            rusqlite::params![
                canonical_name,
                role_tags_json,
                is_paid as i32,
                enabled as i32,
                tokens_used_total,
                canonical_id,
            ],
        )?;

        for row in rows.iter().skip(1) {
            conn.execute(
                "DELETE FROM ai_models WHERE id = ?1",
                rusqlite::params![row.0],
            )?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn storage_v75_recovers_every_rebuild_phase_and_repeated_startup() {
        for (table, fields, values) in [
            ("learning_cards", "front, back", "'front', 'back'"),
            ("uploaded_documents", "filename, file_type", "'doc', 'text'"),
            ("web_captures", "url", "'https://example.invalid'"),
            ("audio_transcriptions", "filename", "'audio'"),
            ("project_notes", "title", "'note'"),
        ] {
            for phase in 0..5 {
                let dir = tempfile::tempdir().unwrap();
                let path = dir.path().join("recovery.sqlite");
                drop(super::initialize_database(&path).unwrap());
                let conn = rusqlite::Connection::open(&path).unwrap();
                conn.execute_batch("PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON;").unwrap();
                let ddl: String = conn.query_row(
                    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table], |row| row.get(0),
                ).unwrap();
                let objects = |conn: &rusqlite::Connection| -> Vec<String> {
                    conn.prepare(
                        "SELECT name FROM sqlite_master WHERE tbl_name = ?1 AND type IN ('index', 'trigger') ORDER BY name"
                    ).unwrap().query_map([table], |row| row.get(0)).unwrap()
                        .collect::<rusqlite::Result<Vec<_>>>().unwrap()
                };
                let original_objects = objects(&conn);
                conn.execute_batch(&format!("DROP TABLE {table};")).unwrap();
                conn.execute_batch(&ddl.replace(
                    "workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE",
                    "workspace_id TEXT NOT NULL",
                )).unwrap();
                conn.execute_batch(&format!(
                    "INSERT INTO workspaces(id, name) VALUES ('recovery-ws', 'Recovery');
                     INSERT INTO {table}(id, workspace_id, {fields})
                     VALUES ('one', 'recovery-ws', {values}), ('two', 'recovery-ws', {values});
                     CREATE TABLE recovery_child (
                         id TEXT PRIMARY KEY, parent_id TEXT REFERENCES {table}(id) ON DELETE CASCADE
                     );
                     INSERT INTO recovery_child(id, parent_id) VALUES ('child', 'one');"
                )).unwrap();
                let temp = format!("{table}_v75");
                conn.execute_batch(&ddl.replacen(table, &temp, 1)).unwrap();
                let columns = conn.prepare("SELECT name FROM pragma_table_info(?1) ORDER BY cid")
                    .unwrap().query_map([table], |row| row.get::<_, String>(0)).unwrap()
                    .collect::<rusqlite::Result<Vec<_>>>().unwrap().join(", ");
                if phase > 0 {
                    let predicate = if phase == 1 { "WHERE id = 'one'" } else { "" };
                    conn.execute_batch(&format!(
                        "INSERT INTO {temp}({columns}) SELECT {columns} FROM {table} {predicate};"
                    )).unwrap();
                }
                if phase >= 3 {
                    conn.execute_batch(&format!("DROP TABLE {table};")).unwrap();
                }
                if phase == 4 {
                    conn.execute_batch(&format!("ALTER TABLE {temp} RENAME TO {table};")).unwrap();
                }
                let start = super::ALL_MIGRATION_NAMES.iter()
                    .position(|name| *name == "v75_fix_workspace_fk_shapes").unwrap();
                for name in &super::ALL_MIGRATION_NAMES[start..] {
                    conn.execute("DELETE FROM _migrations WHERE name = ?1", [name]).unwrap();
                }
                drop(conn);
                for _ in 0..2 {
                    let pool = super::initialize_database(&path)
                        .unwrap_or_else(|e| panic!("{table}, phase {phase}: {e}"));
                    let conn = pool.get().unwrap();
                    assert_eq!(conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get::<_, i64>(0)).unwrap(), 2);
                    assert_eq!(conn.query_row("SELECT COUNT(*) FROM recovery_child", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
                    assert_eq!(conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
                    assert_eq!(conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = ?1", [&temp], |r| r.get::<_, i64>(0)).unwrap(), 0);
                    assert_eq!(objects(&conn), original_objects);
                }
            }
        }
    }

    #[test]
    fn storage_v75_preserves_divergent_temp_copy_and_rolls_back_failures() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        super::create_migrations_table(&conn).unwrap();
        conn.execute_batch(
            "CREATE TABLE learning_cards (id TEXT PRIMARY KEY, workspace_id TEXT);
             CREATE TABLE learning_cards_v75 (id TEXT PRIMARY KEY, workspace_id TEXT);
             INSERT INTO learning_cards_v75(id, workspace_id) VALUES ('only-copy', 'ws');"
        ).unwrap();
        assert!(super::repair_interrupted_v75(&conn).is_err());
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM learning_cards_v75", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        conn.execute_batch("DROP TABLE learning_cards_v75; PRAGMA foreign_keys=ON;").unwrap();
        assert!(super::apply_v75_atomically(&conn).is_err());
        assert_eq!(conn.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'learning_cards_v75'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }

    #[test]
    fn storage_v81_repairs_metadata_without_touching_fts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("search.sqlite");
        let pool = super::initialize_database(&path).unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "INSERT INTO workspaces(id, name) VALUES ('old', 'Old'), ('new', 'New');
             INSERT INTO folders(id, workspace_id, name) VALUES ('target-folder', 'new', 'Folder');
             INSERT INTO chat_sessions(id, workspace_id, title) VALUES ('session', 'old', 'needle');
             INSERT INTO messages(id, session_id, role, content) VALUES ('message', 'session', 'user', 'needle');
             INSERT INTO artifacts(id, workspace_id, session_id, title, artifact_type, content)
                 VALUES ('artifact', 'old', 'session', 'needle', 'code', 'needle');
             INSERT INTO conversation_summaries(id, workspace_id, session_id, content, message_range_start, message_range_end)
                 VALUES ('summary', 'old', 'session', 'needle', 0, 1);
             CREATE TABLE storage_fts_audit (id INTEGER);
             CREATE TRIGGER storage_fts_audit_update AFTER UPDATE ON quick_search_documents
                 WHEN OLD.title != NEW.title OR OLD.subtitle != NEW.subtitle OR OLD.body != NEW.body
                 BEGIN INSERT INTO storage_fts_audit(id) VALUES (1); END;
             CREATE TRIGGER storage_fts_audit_delete AFTER DELETE ON quick_search_documents
                 BEGIN INSERT INTO storage_fts_audit(id) VALUES (1); END;
             DROP TRIGGER quick_search_chat_sessions_au;
             UPDATE chat_sessions SET workspace_id = 'new', folder_id = 'target-folder';
             DELETE FROM _migrations WHERE name = 'v81_search_session_workspace';"
        ).unwrap();
        drop(conn);
        drop(pool);
        for _ in 0..2 {
            let pool = super::initialize_database(&path).unwrap();
            let conn = pool.get().unwrap();
            let count = |workspace: &str| conn.query_row(
                "SELECT COUNT(*) FROM quick_search_documents_fts f
                 JOIN quick_search_documents d ON d.rowid = f.rowid
                 WHERE quick_search_documents_fts MATCH 'needle' AND d.workspace_id = ?1",
                [workspace], |r| r.get::<_, i64>(0)
            ).unwrap();
            assert_eq!(count("new"), 4);
            assert_eq!(count("old"), 0);
            assert_eq!(conn.query_row("SELECT COUNT(*) FROM storage_fts_audit", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
            conn.execute_batch("UPDATE chat_sessions SET workspace_id = 'old', folder_id = '';").unwrap();
            assert_eq!(count("old"), 4);
            conn.execute_batch("UPDATE chat_sessions SET workspace_id = 'new', folder_id = 'target-folder';").unwrap();
            assert_eq!(count("new"), 4);
            assert_eq!(conn.query_row("SELECT COUNT(*) FROM storage_fts_audit", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
            assert_eq!(conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
            conn.execute_batch(
                "UPDATE artifacts SET content = content || ' needle';
                 UPDATE conversation_summaries SET content = content || ' needle';
                 UPDATE chat_sessions SET is_deleted = 1;
                 UPDATE chat_sessions SET is_deleted = 0;"
            ).unwrap();
            assert_eq!(count("new"), 4, "edits and restore must not resurrect stale scope");
            crate::services::quick_search_index::rebuild(&conn).unwrap();
            assert_eq!(count("new"), 4, "full rebuild must retain the session's new scope");
            assert_eq!(count("old"), 0);
            conn.execute("DELETE FROM storage_fts_audit", []).unwrap();
        }
    }

    use super::{initialize_database, ALL_MIGRATION_NAMES};
    use rusqlite::Connection;

    #[test]
    fn migrates_legacy_ai_model_duplicates_into_single_rows() {
        let dir = tempfile::tempdir().expect("Failed to create temp dir");
        let path = dir.path().join("legacy.db");
        let conn = Connection::open(&path).expect("Failed to open legacy db");

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
                name TEXT PRIMARY KEY NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS ai_models (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                model_id TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT 'ollama',
                role_tags TEXT NOT NULL DEFAULT '[]',
                priority INTEGER NOT NULL DEFAULT 0,
                is_paid INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                tokens_used_total INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .expect("Failed to create legacy schema");

        for name in ALL_MIGRATION_NAMES {
            if *name == "v36_ai_models_provider_model_unique" {
                continue;
            }
            conn.execute(
                "INSERT INTO _migrations(name) VALUES(?1)",
                rusqlite::params![name],
            )
            .expect("Failed to seed migration");
        }

        conn.execute(
            "INSERT INTO ai_models (id, name, model_id, provider, role_tags, priority, is_paid, enabled, tokens_used_total, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                "model-a",
                "Gemma 4",
                "gemma4:latest",
                "ollama",
                "[\"chat\"]",
                1_i64,
                0_i32,
                1_i32,
                50_i64,
                "2026-04-10T08:00:00Z",
            ],
        )
        .expect("Failed to insert canonical row");
        conn.execute(
            "INSERT INTO ai_models (id, name, model_id, provider, role_tags, priority, is_paid, enabled, tokens_used_total, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                "model-b",
                "Gemma 4 Duplicate",
                "gemma4:latest",
                "ollama",
                "[\"vision\",\"chat\"]",
                4_i64,
                1_i32,
                0_i32,
                75_i64,
                "2026-04-11T08:00:00Z",
            ],
        )
        .expect("Failed to insert duplicate row");
        drop(conn);

        let pool = initialize_database(&path).expect("Failed to initialize migrated db");
        let conn = pool.get().expect("Failed to get connection");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ai_models WHERE provider = 'ollama' AND model_id = 'gemma4:latest'",
                [],
                |row| row.get(0),
            )
            .expect("Failed to count merged rows");
        assert_eq!(count, 1);

        let (id, role_tags, is_paid, enabled, tokens_used_total): (String, String, i32, i32, i64) =
            conn.query_row(
                "SELECT id, role_tags, is_paid, enabled, tokens_used_total
                 FROM ai_models
                 WHERE provider = 'ollama' AND model_id = 'gemma4:latest'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("Failed to fetch merged row");

        assert_eq!(id, "model-a");
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&role_tags).expect("Invalid role tag json"),
            vec!["chat", "vision"]
        );
        assert_eq!(is_paid, 1);
        assert_eq!(enabled, 1);
        assert_eq!(tokens_used_total, 125);

        let unique_index_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'index' AND name = 'idx_ai_models_provider_model_unique'",
                [],
                |row| row.get(0),
            )
            .expect("Failed to count unique index");
        assert_eq!(unique_index_count, 1);
    }

    #[test]
    fn initializes_database_with_message_variant_index() {
        let dir = tempfile::tempdir().expect("Failed to create temp dir");
        let path = dir.path().join("fresh.db");

        initialize_database(&path).expect("Failed to initialize database");

        let conn = Connection::open(&path).expect("Failed to reopen initialized database");
        let index_sql: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master
                 WHERE type = 'index' AND name = 'idx_messages_variant_group'",
                [],
                |row| row.get(0),
            )
            .expect("Failed to fetch variant index definition");

        assert_eq!(
            index_sql,
            "CREATE INDEX idx_messages_variant_group ON messages(variant_group_id)"
        );
    }

    #[test]
    fn migrates_legacy_databases_without_unified_sources_tables() {
        let dir = tempfile::tempdir().expect("Failed to create temp dir");
        let path = dir.path().join("legacy-sources.db");
        let conn = Connection::open(&path).expect("Failed to open legacy db");

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
                name TEXT PRIMARY KEY NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL DEFAULT 'My Workspace'
            );
            CREATE TABLE IF NOT EXISTS uploaded_documents (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                file_type TEXT NOT NULL,
                file_size INTEGER NOT NULL DEFAULT 0,
                content TEXT NOT NULL DEFAULT '',
                summary TEXT,
                is_processed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS document_chunks (
                id TEXT PRIMARY KEY NOT NULL,
                document_id TEXT NOT NULL,
                content TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                embedding TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS web_captures (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL,
                url TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                summary TEXT,
                favicon_data TEXT,
                is_processed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .expect("Failed to create legacy schema");

        conn.execute(
            "INSERT INTO workspaces (id, name) VALUES (?1, ?2)",
            rusqlite::params!["ws-1", "Workspace"],
        )
        .expect("Failed to insert workspace");
        conn.execute(
            "INSERT INTO uploaded_documents (id, workspace_id, filename, file_type, file_size, content, summary, is_processed, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                "doc-1",
                "ws-1",
                "notes.md",
                "text/markdown",
                42_i64,
                "legacy document body",
                "doc summary",
                1_i32,
                "2026-04-01T08:00:00Z",
                "2026-04-01T09:00:00Z",
            ],
        )
        .expect("Failed to insert uploaded document");
        conn.execute(
            "INSERT INTO document_chunks (id, document_id, content, chunk_index, embedding, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                "chunk-1",
                "doc-1",
                "legacy chunk",
                0_i64,
                "[0.1, 0.2]",
                "2026-04-01T10:00:00Z",
            ],
        )
        .expect("Failed to insert document chunk");
        conn.execute(
            "INSERT INTO web_captures (id, workspace_id, url, title, content, summary, favicon_data, is_processed, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                "web-1",
                "ws-1",
                "https://example.com",
                "Example",
                "legacy web content",
                "web summary",
                "icon",
                0_i32,
                "2026-04-02T08:00:00Z",
            ],
        )
        .expect("Failed to insert web capture");

        for name in ALL_MIGRATION_NAMES {
            if *name == "v26_sources_unification" {
                continue;
            }

            conn.execute(
                "INSERT INTO _migrations(name) VALUES(?1)",
                rusqlite::params![name],
            )
            .expect("Failed to seed migration");
        }
        drop(conn);

        let pool = initialize_database(&path).expect("Failed to initialize migrated db");
        let conn = pool.get().expect("Failed to get connection");

        let source_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sources", [], |row| row.get(0))
            .expect("Failed to count sources");
        assert_eq!(source_count, 2);

        let doc_row: (String, Option<String>, Option<String>, Option<i64>, i32) = conn
            .query_row(
                "SELECT title, filename, file_type, token_count, is_processed
                 FROM sources
                 WHERE id = 'doc-1'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("Failed to fetch migrated document source");
        assert_eq!(doc_row.0, "notes.md");
        assert_eq!(doc_row.1.as_deref(), Some("notes.md"));
        assert_eq!(doc_row.2.as_deref(), Some("text/markdown"));
        assert_eq!(doc_row.3, None);
        assert_eq!(doc_row.4, 1);

        let web_title: String = conn
            .query_row("SELECT title FROM sources WHERE id = 'web-1'", [], |row| {
                row.get(0)
            })
            .expect("Failed to fetch migrated web source");
        assert_eq!(web_title, "Example");

        let chunk_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM source_chunks WHERE source_id = 'doc-1'",
                [],
                |row| row.get(0),
            )
            .expect("Failed to count source chunks");
        assert_eq!(chunk_count, 1);
    }

    #[test]
    fn v64_cleanup_removes_invalid_part_of_rows_and_keeps_valid_ones() {
        // Build a fresh DB (all migrations applied, including v64), insert a
        // mix of valid and invalid `part_of` rows directly, then re-run the
        // cleanup DELETE that v64 issues and assert only invalid rows are
        // removed.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("v64.db");
        let pool = initialize_database(&path).expect("init db");
        let conn = pool.get().expect("conn");

        conn.execute(
            "INSERT INTO workspaces (id, name, created_at, updated_at)
             VALUES ('w1', 'WS', datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();

        let mk_node = |id: &str, name: &str, level: &str| {
            conn.execute(
                "INSERT INTO concept_nodes
                    (id, workspace_id, name, concept_description, concept_type, tags, aliases,
                     references_json, x_position, y_position, review_count, hierarchy_level,
                     created_at, updated_at)
                 VALUES (?1, 'w1', ?2, '', 'topic', '[]', '[]', '[]', 0.0, 0.0, 0, ?3,
                         datetime('now'), datetime('now'))",
                rusqlite::params![id, name, level],
            )
            .unwrap();
        };
        mk_node("ch1", "Ch 1", "chapter");
        mk_node("ch2", "Ch 2", "chapter");
        mk_node("sec1", "Sec 1", "section");
        mk_node("con1", "Con 1", "concept");

        let mk_link = |id: &str, src: &str, tgt: &str| {
            conn.execute(
                "INSERT INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at)
                 VALUES (?1, ?2, ?3, 'part_of', 1.0, 'test', datetime('now'))",
                rusqlite::params![id, src, tgt],
            )
            .unwrap();
        };
        // Valid: section -> chapter, concept -> section
        mk_link("l_valid_sec_ch", "sec1", "ch1");
        mk_link("l_valid_con_sec", "con1", "sec1");
        // Invalid: chapter -> chapter (the exact pattern from three.json)
        mk_link("l_bad_ch_ch", "ch2", "ch1");
        // Invalid: concept -> chapter
        mk_link("l_bad_con_ch", "con1", "ch1");

        // Re-run the same DELETE statement v64 issues. (v64 already ran during
        // initialize_database against an empty graph; this exercises the SQL
        // against the populated graph above.)
        conn.execute_batch(
            "DELETE FROM concept_links
             WHERE link_type = 'part_of'
               AND id IN (
                 SELECT l.id FROM concept_links l
                 JOIN concept_nodes c ON c.id = l.source_id
                 JOIN concept_nodes p ON p.id = l.target_id
                 WHERE l.link_type = 'part_of'
                   AND NOT (
                     (c.hierarchy_level = 'concept' AND p.hierarchy_level = 'section')
                     OR (c.hierarchy_level = 'section' AND p.hierarchy_level = 'chapter')
                   )
               );",
        )
        .unwrap();

        let remaining_ids: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT id FROM concept_links WHERE link_type = 'part_of' ORDER BY id")
                .unwrap();
            stmt.query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .filter_map(Result::ok)
                .collect()
        };
        assert_eq!(
            remaining_ids,
            vec!["l_valid_con_sec".to_string(), "l_valid_sec_ch".to_string()],
            "only valid part_of rows should survive"
        );
    }

    #[test]
    fn recovers_from_orphaned_memories_old_after_crashed_v72() {
        // Reproduce a database where the v72 rebuild crashed mid-batch: the
        // `ALTER TABLE memories RENAME TO memories_old` ran, but the process
        // died before `CREATE TABLE memories` / the `_migrations` insert. The
        // result is an orphaned `memories_old` table, no `memories` table, and
        // v72 still unrecorded. Before the fix, the next startup panicked with
        // "there is already another table or index with this name: memories_old"
        // when v72 re-ran its RENAME.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("orphaned-memories.db");
        let conn = Connection::open(&path).expect("open db");

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
                name TEXT PRIMARY KEY NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL DEFAULT 'My Workspace'
            );
            -- The orphan: pre-v72 `memories` shape, already renamed aside by the
            -- crashed migration. No live `memories` table exists.
            CREATE TABLE memories_old (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT,
                folder_id TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL,
                memory_type TEXT NOT NULL DEFAULT 'fact',
                scope TEXT NOT NULL DEFAULT 'workspace',
                source_session_id TEXT,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                reinforcement_count INTEGER NOT NULL DEFAULT 1,
                last_reinforced_at TEXT,
                superseded_by TEXT,
                superseded_at TEXT,
                superseded_reason TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .expect("create legacy schema with orphaned memories_old");

        conn.execute(
            "INSERT INTO workspaces (id, name) VALUES ('ws-1', 'Workspace')",
            [],
        )
        .expect("insert workspace");
        conn.execute(
            "INSERT INTO memories_old (id, workspace_id, content) VALUES ('mem-1', 'ws-1', 'remembered fact')",
            [],
        )
        .expect("insert orphaned memory row");

        // Seed every migration as applied EXCEPT v72, matching the crash state.
        for name in ALL_MIGRATION_NAMES {
            if *name == "v72_make_memories_workspace_nullable" {
                continue;
            }
            conn.execute(
                "INSERT INTO _migrations(name) VALUES(?1)",
                rusqlite::params![name],
            )
            .expect("seed migration");
        }
        drop(conn);

        // Must not panic; the pre-migration repair restores `memories`, then v72
        // re-applies cleanly.
        let pool = initialize_database(&path).expect("init must recover, not panic");
        let conn = pool.get().expect("get connection");

        // The orphan is gone and the canonical table exists with data preserved.
        let orphan_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'memories_old'",
                [],
                |row| row.get(0),
            )
            .expect("count memories_old");
        assert_eq!(orphan_count, 0, "orphaned memories_old should be cleaned up");

        let content: String = conn
            .query_row(
                "SELECT content FROM memories WHERE id = 'mem-1'",
                [],
                |row| row.get(0),
            )
            .expect("original memory row should survive the recovery");
        assert_eq!(content, "remembered fact");

        // v72 should now be recorded so it never runs again.
        let v72_applied: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _migrations WHERE name = 'v72_make_memories_workspace_nullable'",
                [],
                |row| row.get(0),
            )
            .expect("count v72 migration");
        assert_eq!(v72_applied, 1, "v72 should be recorded after recovery");
    }

    #[test]
    fn v75_rebuilds_drifted_workspace_fk_tables() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        // Simulate the drifted upgraded-database shape: learning_cards whose
        // workspace_id FK still targets "folders", and project_notes with a
        // legacy NOT NULL project_id FK plus an unconstrained workspace_id.
        conn.execute_batch(
            "CREATE TABLE workspaces (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
             CREATE TABLE folders (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
             INSERT INTO workspaces (id, name) VALUES ('ws-1', 'Workspace');
             INSERT INTO folders (id, name) VALUES ('fold-1', 'Project');
             CREATE TABLE learning_cards (
                 id TEXT PRIMARY KEY NOT NULL,
                 workspace_id TEXT NOT NULL REFERENCES \"folders\"(id) ON DELETE CASCADE,
                 front TEXT NOT NULL,
                 back TEXT NOT NULL,
                 source_type TEXT NOT NULL DEFAULT 'manual',
                 source_id TEXT,
                 ease_factor REAL NOT NULL DEFAULT 2.5,
                 interval INTEGER NOT NULL DEFAULT 1,
                 repetitions INTEGER NOT NULL DEFAULT 0,
                 next_review_date TEXT NOT NULL DEFAULT (date('now')),
                 last_reviewed_at TEXT,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 topic_id TEXT
             );
             CREATE TABLE project_notes (
                 id TEXT PRIMARY KEY NOT NULL,
                 project_id TEXT NOT NULL REFERENCES \"folders\"(id) ON DELETE CASCADE,
                 title TEXT NOT NULL,
                 content TEXT NOT NULL DEFAULT '',
                 note_type TEXT NOT NULL DEFAULT 'manual',
                 tags TEXT NOT NULL DEFAULT '[]',
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                 workspace_id TEXT NOT NULL DEFAULT '',
                 folder TEXT,
                 is_pinned INTEGER NOT NULL DEFAULT 0
             );",
        )
        .expect("create drifted schema");

        // The drifted shape rejects a workspace-scoped card insert.
        let failed = conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back) VALUES ('c1', 'ws-1', 'f', 'b')",
            [],
        );
        assert!(failed.is_err(), "drifted FK should reject workspace ids");

        // Seed one legacy row that must survive the rebuild (FKs off, the way
        // it would have landed historically).
        conn.execute_batch(
            "PRAGMA foreign_keys=OFF;
             INSERT INTO project_notes (id, project_id, title, workspace_id) VALUES ('n1', 'fold-1', 'Old note', 'ws-1');
             PRAGMA foreign_keys=ON;",
        )
        .expect("seed legacy note");

        super::v75_fix_workspace_fk_shapes(&conn).expect("run v75 rebuild");

        // Inserts with real workspace ids now succeed on both tables.
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back) VALUES ('c2', 'ws-1', 'f', 'b')",
            [],
        )
        .expect("card insert should succeed after rebuild");
        conn.execute(
            "INSERT INTO project_notes (id, workspace_id, title) VALUES ('n2', 'ws-1', 'New note')",
            [],
        )
        .expect("note insert should succeed after rebuild");

        // Legacy data survived the rebuild.
        let title: String = conn
            .query_row("SELECT title FROM project_notes WHERE id = 'n1'", [], |r| r.get(0))
            .expect("legacy note should survive");
        assert_eq!(title, "Old note");

        // Invalid workspace ids are still rejected (FK really points at workspaces).
        let bad = conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back) VALUES ('c3', 'fold-1', 'f', 'b')",
            [],
        );
        assert!(bad.is_err(), "folder ids must not satisfy the corrected FK");

        // Healthy tables are detected as not needing a rebuild (idempotent).
        assert!(!super::v75_table_needs_rebuild(&conn, "learning_cards").unwrap());
        assert!(!super::v75_table_needs_rebuild(&conn, "project_notes").unwrap());
        assert!(!super::v75_table_needs_rebuild(&conn, "missing_table").unwrap());
    }
}
