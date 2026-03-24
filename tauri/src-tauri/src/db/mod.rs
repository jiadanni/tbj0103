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

        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v7_chat_workspace_scope');",
        )?;
    }

    // v8: add workspace_id to all remaining tables that need workspace scoping
    let applied_v8: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v8_all_tables_workspace_id'",
        [],
        |row| row.get(0),
    )?;

    if applied_v8 == 0 {
        let tables = [
            "uploaded_documents", "web_captures", "project_notes", "learning_goals",
            "concept_nodes", "note_templates", "daily_notes", "learning_paths",
            "calendar_alarms", "thought_queue"
        ];

        for table in tables {
            // Check if column already exists first to be safe
            let has_col: i64 = conn.query_row(
                &format!("SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = 'workspace_id'", table),
                [],
                |row| row.get(0),
            ).unwrap_or(0);

            if has_col == 0 {
                let _ = conn.execute_batch(&format!(
                    "ALTER TABLE {table} ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';
                     UPDATE {table} SET workspace_id = (SELECT id FROM workspaces LIMIT 1)
                     WHERE workspace_id = '' AND EXISTS (SELECT 1 FROM workspaces);",
                    table = table
                ));
            }
        }

        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v8_all_tables_workspace_id');",
        )?;
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

    // v15: Project-scoped memories
    let applied_v15: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v15_project_scoped_memories'",
        [],
        |row| row.get(0),
    )?;

    if applied_v15 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE memories ADD COLUMN project_id TEXT NOT NULL DEFAULT '';",
        );
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v15_project_scoped_memories');",
        )?;
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
        let _ = conn.execute_batch(
            "ALTER TABLE chat_sessions ADD COLUMN deleted_at TEXT;",
        );
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v17_chat_recycle_bin');",
        )?;
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
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v19_confirm_move_to_trash');",
        )?;
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
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v22_ai_model_role_tags');",
        )?;
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
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v23_memory_scope');",
        )?;
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
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v24_workspace_description');",
        )?;
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
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v25_prompt_instructions');",
        )?;
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
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v26_thought_session_id');",
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
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v27_sources_folder_tokens');",
        )?;
    }

    // v28: add is_archived column to workspaces
    let applied_v28: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _migrations WHERE name = 'v28_workspaces_is_archived'",
        [],
        |row| row.get(0),
    )?;
    if applied_v28 == 0 {
        let _ = conn.execute_batch(
            "ALTER TABLE workspaces ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;",
        );
        conn.execute_batch(
            "INSERT INTO _migrations(name) VALUES('v28_workspaces_is_archived');",
        )?;
    }

    Ok(())
}
