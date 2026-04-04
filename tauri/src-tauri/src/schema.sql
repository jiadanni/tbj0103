-- Aetherium SQLite Schema
-- Ported from SwiftData @Model classes

CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL DEFAULT 'My Workspace',
    description TEXT NOT NULL DEFAULT '',
    prompt_instructions TEXT NOT NULL DEFAULT '',
    topic_signature TEXT NOT NULL DEFAULT '{}',
    signature_updated_at TEXT,
    is_hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    project_description TEXT NOT NULL DEFAULT '',
    custom_instructions TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#007AFF',
    icon TEXT NOT NULL DEFAULT 'folder',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT 'New Chat',
    model_name TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    is_incognito INTEGER NOT NULL DEFAULT 0,
    exclude_from_analytics INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    last_accessed_at TEXT,
    last_processed_message_count INTEGER NOT NULL DEFAULT 0,
    is_imported INTEGER NOT NULL DEFAULT 0,
    parent_session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
    branch_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    model_name TEXT,
    tokens_used INTEGER,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS citations (
    id TEXT PRIMARY KEY NOT NULL,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    relevance_score REAL NOT NULL DEFAULT 0.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS learning_goals (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    goal_description TEXT NOT NULL DEFAULT '',
    progress REAL NOT NULL DEFAULT 0.0 CHECK(progress >= 0.0 AND progress <= 1.0),
    is_completed INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,
    prerequisite_ids TEXT NOT NULL DEFAULT '[]',
    related_chat_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS concept_nodes (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    concept_description TEXT NOT NULL DEFAULT '',
    concept_type TEXT NOT NULL DEFAULT 'topic'
        CHECK(concept_type IN ('topic','person','technology','definition','question','insight','resource','custom')),
    tags TEXT NOT NULL DEFAULT '[]',
    aliases TEXT NOT NULL DEFAULT '[]',
    references_json TEXT NOT NULL DEFAULT '[]',
    x_position REAL NOT NULL DEFAULT 0.0,
    y_position REAL NOT NULL DEFAULT 0.0,
    review_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS concept_links (
    id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    link_type TEXT NOT NULL DEFAULT 'related'
        CHECK(link_type IN ('related','part_of','prerequisite','contradicts','supports','example')),
    strength REAL NOT NULL DEFAULT 0.5 CHECK(strength >= 0.0 AND strength <= 1.0),
    context TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS concept_mentions (
    id TEXT PRIMARY KEY NOT NULL,
    concept_id TEXT NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS graph_statistics (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
    total_concepts INTEGER NOT NULL DEFAULT 0,
    total_links INTEGER NOT NULL DEFAULT 0,
    avg_degree REAL NOT NULL DEFAULT 0.0,
    density REAL NOT NULL DEFAULT 0.0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Note templates & daily notes (from NoteTemplate.swift)
CREATE TABLE IF NOT EXISTS note_templates (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    template_description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'doc',
    is_built_in INTEGER NOT NULL DEFAULT 0,
    variables TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_notes (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    mood INTEGER CHECK(mood BETWEEN 1 AND 10),
    productivity INTEGER CHECK(productivity BETWEEN 1 AND 10),
    template_id TEXT REFERENCES note_templates(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, date)
);

CREATE TABLE IF NOT EXISTS learning_cards (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'manual',
    source_id TEXT,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    interval INTEGER NOT NULL DEFAULT 1,
    repetitions INTEGER NOT NULL DEFAULT 0,
    next_review_date TEXT NOT NULL DEFAULT (date('now')),
    last_reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS learning_paths (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    path_description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS path_milestones (
    id TEXT PRIMARY KEY NOT NULL,
    path_id TEXT NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    milestone_description TEXT NOT NULL DEFAULT '',
    is_completed INTEGER NOT NULL DEFAULT 0,
    order_index INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Project sources (from ProjectSource.swift)
CREATE TABLE IF NOT EXISTS uploaded_documents (
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

CREATE TABLE IF NOT EXISTS document_chunks (
    id TEXT PRIMARY KEY NOT NULL,
    document_id TEXT NOT NULL REFERENCES uploaded_documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    embedding TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS web_captures (
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

-- Unified sources table (merges uploaded_documents + web_captures)
CREATE TABLE IF NOT EXISTS sources (
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

-- Migrate existing documents into sources
INSERT OR IGNORE INTO sources (id, workspace_id, source_type, title, filename, file_type, file_size, content, summary, is_processed, created_at, updated_at)
    SELECT id, workspace_id, 'document', filename, filename, file_type, file_size, content, summary, is_processed, created_at, updated_at
    FROM uploaded_documents;

-- Migrate existing web captures into sources
INSERT OR IGNORE INTO sources (id, workspace_id, source_type, title, url, content, summary, favicon_data, is_processed, created_at, updated_at)
    SELECT id, workspace_id, 'web_capture', title, url, content, summary, favicon_data, is_processed, created_at, datetime('now')
    FROM web_captures;

-- Migrate existing document_chunks into source_chunks
INSERT OR IGNORE INTO source_chunks (id, source_id, content, chunk_index, embedding, created_at)
    SELECT id, document_id, content, chunk_index, embedding, created_at
    FROM document_chunks;

CREATE TABLE IF NOT EXISTS audio_transcriptions (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    transcript TEXT NOT NULL DEFAULT '',
    duration_seconds REAL,
    is_processed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_notes (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    note_type TEXT NOT NULL DEFAULT 'manual'
        CHECK(note_type IN ('manual','ai_generated','quiz')),
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Calendar alarms
CREATE TABLE IF NOT EXISTS calendar_alarms (
    id TEXT PRIMARY KEY NOT NULL UNIQUE,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    fire_date TEXT NOT NULL,
    duration_seconds REAL NOT NULL DEFAULT 0.0,
    input_prompt TEXT NOT NULL DEFAULT '',
    is_dismissed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Thought queue: scheduled / deferred AI processing items
CREATE TABLE IF NOT EXISTS thought_queue (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'scheduled', 'processing', 'done')),
    process_at TEXT,
    model_name TEXT NOT NULL DEFAULT '',
    prompt_prefix TEXT NOT NULL DEFAULT '',
    result TEXT,
    result_at TEXT,
    session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Migration: add session_id to existing thought_queue if missing
-- (SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we handle this in code)

-- AI memory for cross-session context
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    memory_type TEXT NOT NULL DEFAULT 'fact'
        CHECK(memory_type IN ('fact', 'preference', 'context')),
    scope TEXT NOT NULL DEFAULT 'workspace'
        CHECK(scope IN ('global', 'workspace')),
    source_session_id TEXT,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI model priority list with token tracking
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(model_id, provider)
);

-- Default web AI provider entries (disabled until user opts in)
INSERT OR IGNORE INTO ai_models(id, name, model_id, provider, priority, is_paid, enabled)
VALUES
    ('web-chatgpt',  'ChatGPT (Web)',  'chatgpt-web',  'web_chatgpt',  100, 0, 0),
    ('web-deepseek', 'DeepSeek (Web)', 'deepseek-web', 'web_deepseek', 101, 0, 0),
    ('web-claude',   'Claude (Web)',   'claude-web',   'web_claude',   102, 0, 0),
    ('web-gemini',   'Gemini (Web)',   'gemini-web',   'web_gemini',   103, 0, 0);

-- Settings (flat key-value store, mirrors @AppStorage)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

-- Built-in default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('preferred_model', '""'),
    ('background_model', '""'),
    ('quick_search_models', '[]'),
    ('backup_enabled', 'true'),
    ('touch_id_enabled', 'false'),
    ('pin_lock_enabled', 'false'),
    ('pin_passcode_hash', ''),
    ('auto_lock_minutes', '15'),
    ('theme', '"system"'),
    ('accent_color', '"#007AFF"'),
    ('font_size', '14'),
    ('sidebar_width', '240'),
    ('ollama_base_url', '"http://localhost:11434"'),
    ('embedding_model', '"nomic-embed-text"'),
    ('demo_mode', 'false'),
    ('topic_analysis_interval_minutes', '30'),
    ('migration_suggestion_threshold', '0.3'),
    ('web_session_preserve', 'false'),
    ('dual_model_enabled', 'false'),
    ('draft_model', '""'),
    ('dual_model_execution_mode', '"serial"'),
    ('compare_model_a', '""'),
    ('compare_model_b', '""'),
    ('immediate_delete', 'false'),
    ('confirm_move_to_trash', 'true'),
    ('prompt_instructions', '""'),
    ('hide_native_menu', 'false'),
    ('switch_workspace_to_chat', 'false');

-- Conversation summaries
CREATE TABLE IF NOT EXISTS conversation_summaries (
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

-- Artifacts
CREATE TABLE IF NOT EXISTS artifacts (
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

-- Artifact embeddings
CREATE TABLE IF NOT EXISTS artifact_embeddings (
    artifact_id TEXT PRIMARY KEY NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL,
    model TEXT NOT NULL DEFAULT 'nomic-embed-text',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Memory embeddings
CREATE TABLE IF NOT EXISTS memory_embeddings (
    memory_id TEXT PRIMARY KEY NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL,
    model TEXT NOT NULL DEFAULT 'nomic-embed-text',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Context assembly snapshots (debugging/replay)
CREATE TABLE IF NOT EXISTS context_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    assembled_context TEXT NOT NULL,
    token_budget INTEGER NOT NULL,
    tokens_used INTEGER NOT NULL,
    sources_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Base indexes for fresh installs; existing databases are backfilled in v9.
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace ON chat_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace_project_pinned_updated
    ON chat_sessions(workspace_id, project_id, is_pinned, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace_pinned_updated
    ON chat_sessions(workspace_id, is_pinned, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_session_created_at ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_citations_message ON citations(message_id);
CREATE INDEX IF NOT EXISTS idx_concept_nodes_workspace ON concept_nodes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_concept_links_source ON concept_links(source_id);
CREATE INDEX IF NOT EXISTS idx_concept_links_target ON concept_links(target_id);
CREATE INDEX IF NOT EXISTS idx_concept_links_source_target ON concept_links(source_id, target_id);
CREATE INDEX IF NOT EXISTS idx_concept_mentions_concept ON concept_mentions(concept_id);
CREATE INDEX IF NOT EXISTS idx_learning_goals_workspace ON learning_goals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_learning_cards_review ON learning_cards(next_review_date);
CREATE INDEX IF NOT EXISTS idx_learning_cards_workspace_review ON learning_cards(workspace_id, next_review_date);
CREATE INDEX IF NOT EXISTS idx_daily_notes_workspace_date ON daily_notes(workspace_id, date);
CREATE INDEX IF NOT EXISTS idx_uploaded_docs_workspace ON uploaded_documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_document ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_web_captures_workspace ON web_captures(workspace_id);
CREATE INDEX IF NOT EXISTS idx_project_notes_workspace ON project_notes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audio_transcriptions_workspace ON audio_transcriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_alarms_fire_date ON calendar_alarms(fire_date);
CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memories_active ON memories(workspace_id, is_active);

-- Performance indexes (v30)
CREATE INDEX IF NOT EXISTS idx_sources_workspace ON sources(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sources_workspace_processed ON sources(workspace_id, is_processed);
CREATE INDEX IF NOT EXISTS idx_source_chunks_source ON source_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_workspace ON artifacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
CREATE INDEX IF NOT EXISTS idx_concept_mentions_source ON concept_mentions(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_thought_queue_status ON thought_queue(workspace_id, status, process_at);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(workspace_id, is_active, scope);
CREATE INDEX IF NOT EXISTS idx_conv_summaries_session ON conversation_summaries(session_id);
