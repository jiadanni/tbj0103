use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, Result};
use std::collections::BTreeSet;
use std::path::Path;

#[cfg(test)]
pub mod test_utils;

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
];

pub fn initialize_database(path: &Path) -> Result<Pool<SqliteConnectionManager>> {
    // We first open a direct connection to run pragmas, create tables and migrations,
    // ensuring this happens sequentially before the pool is used by commands.
    let conn = Connection::open(path)?;
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
        // Existing databases must migrate first so schema-level indexes do not
        // reference columns that are added by later migrations.
        run_migrations(&conn)?;
        conn.execute_batch(include_str!("../schema.sql"))?;
    }

    // Now enforce foreign keys for normal operation
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    // Now create the pool
    let manager = SqliteConnectionManager::file(path)
        .with_init(|c| c.execute_batch("PRAGMA foreign_keys=ON;"));

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
                summary_type TEXT NOT NULL DEFAULT 'rolling'
                    CHECK(summary_type IN ('rolling', 'final', 'segment')),
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
            "ALTER TABLE concept_nodes ADD COLUMN hierarchy_level TEXT DEFAULT 'concept';"
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
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v37_workspace_parent_id');",
        )?;
    }

    // v38: add icon field to workspaces for visual identification
    let applied_v38: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v38_workspace_icon'",
        [],
        |row| row.get(0),
    )?;
    if applied_v38 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE workspaces ADD COLUMN icon TEXT NOT NULL DEFAULT '';",
        );
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v38_workspace_icon');",
        )?;
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
        let _ = conn.execute_batch("ALTER TABLE ai_models ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;");
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
             );"
        )?;

        // Create the trigger
        conn.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS update_workspace_last_message_at
             AFTER INSERT ON messages
             BEGIN
                 UPDATE workspaces 
                 SET last_message_at = NEW.created_at
                 WHERE id = (SELECT workspace_id FROM chat_sessions WHERE id = NEW.session_id);
             END;"
        )?;

        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v42_workspace_last_message_at');")?;
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
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v43_switch_workspace_section');")?;
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
             END;"
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
             );"
        )?;

        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v46_fix_workspace_last_message_at_trigger');")?;
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
        conn.execute_batch("INSERT INTO _migrations(name) VALUES('v47_raise_migration_threshold');")?;
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
            );"
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
                ON analyze_jobs(workspace_id, started_at DESC);"
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
        let _ = conn.execute_batch(
            "ALTER TABLE learning_cards ADD COLUMN topic_id TEXT;",
        );
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
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, topic, created_at FROM flashcard_topics",
    )?;
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
                    if name.is_empty() { None } else { Some(name.to_string()) }
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
            conn.execute("DELETE FROM ai_models WHERE id = ?1", rusqlite::params![row.0])?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
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

        let (id, role_tags, is_paid, enabled, tokens_used_total): (String, String, i32, i32, i64) = conn
            .query_row(
                "SELECT id, role_tags, is_paid, enabled, tokens_used_total
                 FROM ai_models
                 WHERE provider = 'ollama' AND model_id = 'gemma4:latest'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .expect("Failed to fetch merged row");

        assert_eq!(id, "model-a");
        assert_eq!(serde_json::from_str::<Vec<String>>(&role_tags).expect("Invalid role tag json"), vec!["chat", "vision"]);
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
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .expect("Failed to fetch migrated document source");
        assert_eq!(doc_row.0, "notes.md");
        assert_eq!(doc_row.1.as_deref(), Some("notes.md"));
        assert_eq!(doc_row.2.as_deref(), Some("text/markdown"));
        assert_eq!(doc_row.3, None);
        assert_eq!(doc_row.4, 1);

        let web_title: String = conn
            .query_row(
                "SELECT title FROM sources WHERE id = 'web-1'",
                [],
                |row| row.get(0),
            )
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
}
