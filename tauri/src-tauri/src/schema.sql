-- Aetherium SQLite Schema
-- Ported from SwiftData @Model classes

CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL DEFAULT 'My Workspace',
    description TEXT NOT NULL DEFAULT '',
    prompt_instructions TEXT NOT NULL DEFAULT '',
    topic_signature TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(topic_signature)),
    signature_updated_at TEXT,
    is_hidden INTEGER NOT NULL DEFAULT 0,
    icon TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    parent_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    last_message_at TEXT,
    survey_data TEXT,
    about_you TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    folder_description TEXT NOT NULL DEFAULT '',
    custom_instructions TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#007AFF',
    icon TEXT NOT NULL DEFAULT 'folder',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    folder_id TEXT NOT NULL DEFAULT '',
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
    message_count INTEGER NOT NULL DEFAULT 0,
    is_imported INTEGER NOT NULL DEFAULT 0,
    parent_session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
    branch_message_id TEXT,
    is_unread INTEGER NOT NULL DEFAULT 0,
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
    variant_group_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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
    prerequisite_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(prerequisite_ids)),
    related_chat_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(related_chat_ids)),
    concept_id TEXT REFERENCES concept_nodes(id) ON DELETE SET NULL,
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
    tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
    aliases TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases)),
    references_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(references_json)),
    x_position REAL NOT NULL DEFAULT 0.0,
    y_position REAL NOT NULL DEFAULT 0.0,
    review_count INTEGER NOT NULL DEFAULT 0,
    hierarchy_level TEXT DEFAULT 'concept',
    parent_checked_at TEXT,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_concept_links_source_target_type
    ON concept_links(source_id, target_id, link_type);

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
    variables TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(variables)),
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
    topic_id TEXT,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    interval INTEGER NOT NULL DEFAULT 1,
    repetitions INTEGER NOT NULL DEFAULT 0,
    next_review_date TEXT NOT NULL DEFAULT (date('now')),
    last_reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flashcard_topics (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'chat_signature',
    mastery_score REAL NOT NULL DEFAULT 0.0,
    last_generated_at TEXT,
    card_count INTEGER NOT NULL DEFAULT 0,
    parent_topic_id TEXT REFERENCES flashcard_topics(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, topic)
);

-- Pop quizzes and full exams. Questions are AI-generated from topic(s);
-- answers are typed free-text and graded by the AI.
CREATE TABLE IF NOT EXISTS quizzes (
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

-- Folder sources (from ProjectSource.swift)
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
    folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
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
    tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
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

CREATE TABLE IF NOT EXISTS workspace_glossary_terms (
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

-- AI memory summaries — one per (scope, workspace_id)
CREATE TABLE IF NOT EXISTS memory_summaries (
    id TEXT PRIMARY KEY NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global'
        CHECK(scope IN ('global', 'workspace')),
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    is_auto_generated INTEGER NOT NULL DEFAULT 1,
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    edited_at TEXT,
    UNIQUE(scope, workspace_id)
);

-- Version history for memory summaries — captures outgoing content before overwrite
CREATE TABLE IF NOT EXISTS memory_summary_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    summary_id TEXT NOT NULL REFERENCES memory_summaries(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK(scope IN ('global', 'workspace')),
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_auto_generated INTEGER NOT NULL DEFAULT 1,
    snapshotted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_summary_snapshots_summary
    ON memory_summary_snapshots(summary_id, snapshotted_at DESC);

-- AI model priority list with token tracking
CREATE TABLE IF NOT EXISTS ai_models (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    model_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'ollama',
    role_tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(role_tags)),
    priority INTEGER NOT NULL DEFAULT 0,
    is_paid INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    is_hidden INTEGER NOT NULL DEFAULT 0,
    tokens_used_total INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    context_size INTEGER,
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
    ('summarization_model', '""'),
    ('memory_extraction_model', '""'),
    ('flashcard_model', '""'),
    ('glossary_model', '""'),
    ('topic_signature_model', '""'),
    ('quick_search_models', '[]'),
    ('quick_search_shortcut', '"CmdOrCtrl+Shift+K"'),
    ('quick_search_workspace_scope', '"__all__"'),
    ('quick_search_type_filters', '["conversation","message","artifact","memory","summary"]'),
    ('backup_enabled', 'true'),
    ('touch_id_enabled', 'false'),
    ('pin_lock_enabled', 'false'),
    ('pin_passcode_hash', ''),
    ('auto_lock_minutes', '0'),
    ('theme', '"system"'),
    ('accent_color', '"#007AFF"'),
    ('font_size', '14'),
    ('sidebar_width', '240'),
    ('ollama_base_url', '"http://localhost:11434"'),
    ('auto_start_ollama', 'false'),
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
    ('open_in_background', 'false'),
    ('keep_running_in_tray', 'false'),
    ('immediate_delete', 'false'),
    ('confirm_move_to_trash', 'true'),
    ('prompt_instructions', '""'),
    ('hide_native_menu', 'false'),
    ('switch_workspace_section', ''),
    ('demo_dismissed', 'false'),
    ('memory_enabled', 'true'),
    ('memory_extraction_threshold', '5'),
    ('memory_extraction_idle_minutes', '5'),
    ('summarization_min_messages', '10'),
    ('summarization_max_sessions', '5'),
    ('hover_definition_scan_enabled', 'true'),
    ('hover_definition_scan_max_sessions', '3'),
    ('workspace_glossary_refresh_interval_minutes', '60'),
    ('git_sync_interval_minutes', '5'),
    ('user_chat_label', '"You"'),
    ('assistant_chat_label', '"Assistant"'),
    ('about_you', '""'),
    ('inject_about_you_into_chat', 'true'),
    ('vram_headroom_gb', '0'),
    ('vram_headroom_percent', '10'),
    ('ram_headroom_gb', '0'),
    ('ram_headroom_percent', '10');


-- Conversation summaries
CREATE TABLE IF NOT EXISTS conversation_summaries (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    summary_type TEXT NOT NULL DEFAULT 'rolling'
        CHECK(summary_type IN ('rolling', 'final', 'segment')),
    content TEXT NOT NULL,
    key_topics TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(key_topics)),
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
    tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
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

CREATE INDEX IF NOT EXISTS idx_workspace_glossary_workspace
    ON workspace_glossary_terms(workspace_id, normalized_term);
CREATE INDEX IF NOT EXISTS idx_workspace_glossary_source_session
    ON workspace_glossary_terms(source_session_id);

-- Context assembly snapshots (debugging/replay)
CREATE TABLE IF NOT EXISTS context_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    assembled_context TEXT NOT NULL,
    token_budget INTEGER NOT NULL,
    tokens_used INTEGER NOT NULL,
    sources_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(sources_json)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Quick search document index (FTS-backed)
CREATE TABLE IF NOT EXISTS quick_search_documents (
    rowid INTEGER PRIMARY KEY,
    doc_id TEXT NOT NULL UNIQUE,
    target_id TEXT NOT NULL,
    kind TEXT NOT NULL
        CHECK(kind IN ('conversation', 'message', 'artifact', 'memory', 'summary')),
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
    source_session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    subtitle TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS quick_search_documents_fts
USING fts5(
    title,
    subtitle,
    body,
    content='quick_search_documents',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS quick_search_documents_ai
AFTER INSERT ON quick_search_documents BEGIN
    INSERT INTO quick_search_documents_fts(rowid, title, subtitle, body)
    VALUES (NEW.rowid, NEW.title, NEW.subtitle, NEW.body);
END;

CREATE TRIGGER IF NOT EXISTS quick_search_documents_ad
AFTER DELETE ON quick_search_documents BEGIN
    INSERT INTO quick_search_documents_fts(quick_search_documents_fts, rowid, title, subtitle, body)
    VALUES ('delete', OLD.rowid, OLD.title, OLD.subtitle, OLD.body);
END;

-- Guard: only update the FTS index when the indexed text columns actually
-- changed. Updating a metadata column (folder_id, workspace_id, etc.) no
-- longer causes a superfluous FTS delete+insert pair per row.
DROP TRIGGER IF EXISTS quick_search_documents_au;
CREATE TRIGGER quick_search_documents_au
AFTER UPDATE ON quick_search_documents
WHEN OLD.title != NEW.title OR OLD.subtitle != NEW.subtitle OR OLD.body != NEW.body
BEGIN
    INSERT INTO quick_search_documents_fts(quick_search_documents_fts, rowid, title, subtitle, body)
    VALUES ('delete', OLD.rowid, OLD.title, OLD.subtitle, OLD.body);
    INSERT INTO quick_search_documents_fts(rowid, title, subtitle, body)
    VALUES (NEW.rowid, NEW.title, NEW.subtitle, NEW.body);
END;

CREATE TRIGGER IF NOT EXISTS quick_search_chat_sessions_ai
AFTER INSERT ON chat_sessions BEGIN
    INSERT INTO quick_search_documents (
        doc_id, target_id, kind, workspace_id, folder_id, session_id, source_session_id, title, subtitle, body, updated_at
    )
    SELECT
        'session:' || NEW.id,
        NEW.id,
        'conversation',
        NEW.workspace_id,
        NULLIF(NEW.folder_id, ''),
        NEW.id,
        NULL,
        NEW.title,
        'Conversation',
        '',
        NEW.updated_at
    WHERE NEW.is_deleted = 0;
END;

DROP TRIGGER IF EXISTS quick_search_chat_sessions_ad;
CREATE TRIGGER quick_search_chat_sessions_ad
AFTER DELETE ON chat_sessions BEGIN
    DELETE FROM quick_search_documents
    WHERE doc_id = 'session:' || OLD.id
       OR (session_id = OLD.id AND kind IN ('message', 'artifact', 'summary'));
END;

DROP TRIGGER IF EXISTS quick_search_chat_sessions_au;
CREATE TRIGGER quick_search_chat_sessions_au
AFTER UPDATE ON chat_sessions
FOR EACH ROW
-- Use IS NOT for folder_id comparison so NULL↔value transitions are detected.
WHEN (OLD.title != NEW.title OR OLD.is_deleted != NEW.is_deleted OR OLD.folder_id IS NOT NEW.folder_id)
BEGIN
    -- (a) Session soft-deleted: remove all its search documents in one pass.
    --     session_id = OLD.id covers the conversation doc and all
    --     message / artifact / summary rows for this session.
    DELETE FROM quick_search_documents
    WHERE OLD.is_deleted = 0 AND NEW.is_deleted = 1
      AND session_id = OLD.id;

    -- (b) Session restored (is_deleted 1→0): re-index the conversation entry
    --     and every message, artifact, and summary it contains.
    --     Full table scan is unavoidable here because the rows were absent.
    INSERT OR IGNORE INTO quick_search_documents (
        doc_id, target_id, kind, workspace_id, folder_id, session_id,
        source_session_id, title, subtitle, body, updated_at
    )
    SELECT
        'session:' || NEW.id, NEW.id, 'conversation',
        NEW.workspace_id, NULLIF(NEW.folder_id, ''), NEW.id, NULL,
        NEW.title, 'Conversation', '', NEW.updated_at
    WHERE OLD.is_deleted = 1 AND NEW.is_deleted = 0;

    INSERT OR IGNORE INTO quick_search_documents (
        doc_id, target_id, kind, workspace_id, folder_id, session_id,
        source_session_id, title, subtitle, body, updated_at
    )
    SELECT
        'message:' || m.id, m.id, 'message',
        NEW.workspace_id, NULLIF(NEW.folder_id, ''), NEW.id, NULL,
        NEW.title,
        CASE m.role
            WHEN 'assistant' THEN 'Assistant reply'
            WHEN 'system' THEN 'System message'
            ELSE 'User message'
        END,
        m.content, m.created_at
    FROM messages m
    WHERE m.session_id = NEW.id
      AND OLD.is_deleted = 1 AND NEW.is_deleted = 0;

    INSERT OR IGNORE INTO quick_search_documents (
        doc_id, target_id, kind, workspace_id, folder_id, session_id,
        source_session_id, title, subtitle, body, updated_at
    )
    SELECT
        'artifact:' || a.id, a.id, 'artifact',
        a.workspace_id, NULLIF(NEW.folder_id, ''), a.session_id, NULL,
        a.title,
        CASE
            WHEN a.language IS NOT NULL AND a.language != '' THEN a.artifact_type || ' • ' || a.language
            ELSE a.artifact_type
        END,
        TRIM(COALESCE(a.description, '') || CHAR(10) || CHAR(10) || COALESCE(a.content, '')),
        a.updated_at
    FROM artifacts a
    WHERE a.session_id = NEW.id
      AND OLD.is_deleted = 1 AND NEW.is_deleted = 0;

    INSERT OR IGNORE INTO quick_search_documents (
        doc_id, target_id, kind, workspace_id, folder_id, session_id,
        source_session_id, title, subtitle, body, updated_at
    )
    SELECT
        'summary:' || s.id, s.id, 'summary',
        s.workspace_id, NULLIF(NEW.folder_id, ''), s.session_id, NULL,
        NEW.title, s.summary_type || ' summary',
        s.content, s.updated_at
    FROM conversation_summaries s
    WHERE s.session_id = NEW.id
      AND OLD.is_deleted = 1 AND NEW.is_deleted = 0;

    -- (c) Session remains active and its title changed.
    --     UPDATE the existing rows in place: no table scan of messages/artifacts,
    --     no FTS bulk re-index — each updated row fires quick_search_documents_au
    --     which updates only that row's FTS entry.
    --     Artifact docs carry the artifact's own title, not the session title,
    --     so kind='artifact' is intentionally excluded here.
    UPDATE quick_search_documents
    SET title = NEW.title, updated_at = NEW.updated_at
    WHERE NEW.is_deleted = 0 AND OLD.is_deleted = 0
      AND OLD.title != NEW.title
      AND session_id = NEW.id
      AND kind IN ('conversation', 'message', 'summary');

    -- (d) Session remains active and was moved between folders.
    --     UPDATE folder_id in place on all related docs.
    --     Because folder_id is not an FTS-indexed column, quick_search_documents_au
    --     (guarded by WHEN text columns change) will NOT fire — zero FTS work.
    UPDATE quick_search_documents
    SET folder_id = NULLIF(NEW.folder_id, '')
    WHERE NEW.is_deleted = 0 AND OLD.is_deleted = 0
      AND OLD.folder_id IS NOT NEW.folder_id
      AND session_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS quick_search_messages_ai
AFTER INSERT ON messages BEGIN
    INSERT OR REPLACE INTO quick_search_documents (
        doc_id, target_id, kind, workspace_id, folder_id, session_id, source_session_id, title, subtitle, body, updated_at
    )
    SELECT
        'message:' || NEW.id,
        NEW.id,
        'message',
        cs.workspace_id,
        NULLIF(cs.folder_id, ''),
        NEW.session_id,
        NULL,
        cs.title,
        CASE NEW.role
            WHEN 'assistant' THEN 'Assistant reply'
            WHEN 'system' THEN 'System message'
            ELSE 'User message'
        END,
        NEW.content,
        NEW.created_at
    FROM chat_sessions cs
    WHERE cs.id = NEW.session_id
      AND cs.is_deleted = 0;
END;

DROP TRIGGER IF EXISTS quick_search_messages_au;
CREATE TRIGGER quick_search_messages_au
AFTER UPDATE ON messages
FOR EACH ROW
WHEN (OLD.content != NEW.content OR OLD.role != NEW.role)
BEGIN
    DELETE FROM quick_search_documents WHERE doc_id = 'message:' || OLD.id;
    INSERT OR REPLACE INTO quick_search_documents (
        doc_id, target_id, kind, workspace_id, folder_id, session_id, source_session_id, title, subtitle, body, updated_at
    )
    SELECT
        'message:' || NEW.id,
        NEW.id,
        'message',
        cs.workspace_id,
        NULLIF(cs.folder_id, ''),
        NEW.session_id,
        NULL,
        cs.title,
        CASE NEW.role
            WHEN 'assistant' THEN 'Assistant reply'
            WHEN 'system' THEN 'System message'
            ELSE 'User message'
        END,
        NEW.content,
        NEW.created_at
    FROM chat_sessions cs
    WHERE cs.id = NEW.session_id
      AND cs.is_deleted = 0;
END;

CREATE TRIGGER IF NOT EXISTS quick_search_messages_ad
AFTER DELETE ON messages BEGIN
    DELETE FROM quick_search_documents WHERE doc_id = 'message:' || OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS quick_search_artifacts_ai
AFTER INSERT ON artifacts BEGIN
    INSERT OR REPLACE INTO quick_search_documents (
        doc_id, target_id, kind, workspace_id, folder_id, session_id, source_session_id, title, subtitle, body, updated_at
    )
    SELECT
        'artifact:' || NEW.id,
        NEW.id,
        'artifact',
        NEW.workspace_id,
        NULLIF(COALESCE(cs.folder_id, ''), ''),
        NEW.session_id,
        NULL,
        NEW.title,
        CASE
            WHEN NEW.language IS NOT NULL AND NEW.language != '' THEN NEW.artifact_type || ' • ' || NEW.language
            ELSE NEW.artifact_type
        END,
        TRIM(COALESCE(NEW.description, '') || CHAR(10) || CHAR(10) || COALESCE(NEW.content, '')),
        NEW.updated_at
    FROM (SELECT 1) stub
    LEFT JOIN chat_sessions cs ON cs.id = NEW.session_id;
END;

DROP TRIGGER IF EXISTS quick_search_artifacts_au;
CREATE TRIGGER quick_search_artifacts_au
AFTER UPDATE ON artifacts
FOR EACH ROW
WHEN (OLD.content != NEW.content OR OLD.title != NEW.title OR OLD.description != NEW.description)
BEGIN
    DELETE FROM quick_search_documents WHERE doc_id = 'artifact:' || OLD.id;
    INSERT OR REPLACE INTO quick_search_documents (
        doc_id, target_id, kind, workspace_id, folder_id, session_id, source_session_id, title, subtitle, body, updated_at
    )
    SELECT
        'artifact:' || NEW.id,
        NEW.id,
        'artifact',
        NEW.workspace_id,
        NULLIF(COALESCE(cs.folder_id, ''), ''),
        NEW.session_id,
        NULL,
        NEW.title,
        CASE
            WHEN NEW.language IS NOT NULL AND NEW.language != '' THEN NEW.artifact_type || ' • ' || NEW.language
            ELSE NEW.artifact_type
        END,
        TRIM(COALESCE(NEW.description, '') || CHAR(10) || CHAR(10) || COALESCE(NEW.content, '')),
        NEW.updated_at
    FROM (SELECT 1) stub
    LEFT JOIN chat_sessions cs ON cs.id = NEW.session_id;
END;

CREATE TRIGGER IF NOT EXISTS quick_search_artifacts_ad
AFTER DELETE ON artifacts BEGIN
    DELETE FROM quick_search_documents WHERE doc_id = 'artifact:' || OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS quick_search_memories_ai
AFTER INSERT ON memories BEGIN
    INSERT OR REPLACE INTO quick_search_documents (
        doc_id, target_id, kind, workspace_id, folder_id, session_id, source_session_id, title, subtitle, body, updated_at
    )
    VALUES (
        'memory:' || NEW.id,
        NEW.id,
        'memory',
        NEW.workspace_id,
        NULLIF(NEW.folder_id, ''),
        NULL,
        NEW.source_session_id,
        CASE NEW.memory_type
            WHEN 'preference' THEN 'Preference'
            WHEN 'context' THEN 'Context'
            ELSE 'Fact'
        END,
        CASE NEW.scope
            WHEN 'global' THEN 'Global memory'
            ELSE 'Workspace memory'
        END,
        NEW.content,
        NEW.updated_at
    );
END;

DROP TRIGGER IF EXISTS quick_search_memories_au;
CREATE TRIGGER quick_search_memories_au
AFTER UPDATE ON memories
FOR EACH ROW
WHEN (OLD.content != NEW.content OR OLD.memory_type != NEW.memory_type OR OLD.scope != NEW.scope)
BEGIN
    DELETE FROM quick_search_documents WHERE doc_id = 'memory:' || OLD.id;
    INSERT OR REPLACE INTO quick_search_documents (
        doc_id, target_id, kind, workspace_id, folder_id, session_id, source_session_id, title, subtitle, body, updated_at
    )
    VALUES (
        'memory:' || NEW.id,
        NEW.id,
        'memory',
        NEW.workspace_id,
        NULLIF(NEW.folder_id, ''),
        NULL,
        NEW.source_session_id,
        CASE NEW.memory_type
            WHEN 'preference' THEN 'Preference'
            WHEN 'context' THEN 'Context'
            ELSE 'Fact'
        END,
        CASE NEW.scope
            WHEN 'global' THEN 'Global memory'
            ELSE 'Workspace memory'
        END,
        NEW.content,
        NEW.updated_at
    );
END;

CREATE TRIGGER IF NOT EXISTS quick_search_memories_ad
AFTER DELETE ON memories BEGIN
    DELETE FROM quick_search_documents WHERE doc_id = 'memory:' || OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS quick_search_summaries_ai
AFTER INSERT ON conversation_summaries BEGIN
    INSERT OR REPLACE INTO quick_search_documents (
        doc_id, target_id, kind, workspace_id, folder_id, session_id, source_session_id, title, subtitle, body, updated_at
    )
    SELECT
        'summary:' || NEW.id,
        NEW.id,
        'summary',
        NEW.workspace_id,
        NULLIF(cs.folder_id, ''),
        NEW.session_id,
        NULL,
        cs.title,
        NEW.summary_type || ' summary',
        NEW.content,
        NEW.updated_at
    FROM chat_sessions cs
    WHERE cs.id = NEW.session_id
      AND cs.is_deleted = 0;
END;

DROP TRIGGER IF EXISTS quick_search_summaries_au;
CREATE TRIGGER quick_search_summaries_au
AFTER UPDATE ON conversation_summaries
FOR EACH ROW
WHEN (OLD.content != NEW.content OR OLD.summary_type != NEW.summary_type)
BEGIN
    DELETE FROM quick_search_documents WHERE doc_id = 'summary:' || OLD.id;
    INSERT OR REPLACE INTO quick_search_documents (
        doc_id, target_id, kind, workspace_id, folder_id, session_id, source_session_id, title, subtitle, body, updated_at
    )
    SELECT
        'summary:' || NEW.id,
        NEW.id,
        'summary',
        NEW.workspace_id,
        NULLIF(cs.folder_id, ''),
        NEW.session_id,
        NULL,
        cs.title,
        NEW.summary_type || ' summary',
        NEW.content,
        NEW.updated_at
    FROM chat_sessions cs
    WHERE cs.id = NEW.session_id
      AND cs.is_deleted = 0;
END;

CREATE TRIGGER IF NOT EXISTS quick_search_summaries_ad
AFTER DELETE ON conversation_summaries BEGIN
    DELETE FROM quick_search_documents WHERE doc_id = 'summary:' || OLD.id;
END;

-- Base indexes for fresh installs; existing databases are backfilled in v9.
CREATE INDEX IF NOT EXISTS idx_folders_workspace ON folders(workspace_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace ON chat_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(folder_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace_project_pinned_updated
    ON chat_sessions(workspace_id, folder_id, is_pinned, updated_at DESC);
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
CREATE INDEX IF NOT EXISTS idx_quick_search_documents_kind_updated ON quick_search_documents(kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_quick_search_documents_session ON quick_search_documents(session_id);
CREATE INDEX IF NOT EXISTS idx_quick_search_documents_workspace ON quick_search_documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_concept_mentions_source ON concept_mentions(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_thought_queue_status ON thought_queue(workspace_id, status, process_at);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(workspace_id, is_active, scope);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_parent ON chat_sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_note_templates_workspace ON note_templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_learning_paths_workspace ON learning_paths(workspace_id);
CREATE INDEX IF NOT EXISTS idx_path_milestones_path ON path_milestones(path_id);
CREATE INDEX IF NOT EXISTS idx_calendar_alarms_workspace ON calendar_alarms(workspace_id);
CREATE INDEX IF NOT EXISTS idx_thought_queue_session ON thought_queue(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(folder_id);
CREATE INDEX IF NOT EXISTS idx_memories_source_session ON memories(source_session_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_message ON artifacts(message_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_parent ON artifacts(parent_artifact_id);
CREATE INDEX IF NOT EXISTS idx_context_snapshots_session ON context_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_quick_search_project_session ON quick_search_documents(folder_id, session_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_active ON chat_sessions(workspace_id, is_pinned, updated_at DESC) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_sources_unprocessed ON sources(workspace_id) WHERE is_processed = 0;

-- Application logs (persistent, queryable log entries)
CREATE TABLE IF NOT EXISTS app_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    level TEXT NOT NULL DEFAULT 'info'
        CHECK(level IN ('debug', 'info', 'warn', 'error')),
    source TEXT NOT NULL DEFAULT 'backend',
    message TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_app_logs_timestamp ON app_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level, timestamp DESC);

-- Message variants support (v39)
CREATE INDEX IF NOT EXISTS idx_messages_variant_group ON messages(variant_group_id);

-- Dashboard recent_activity UNION ALL: each branch filters by workspace_id and
-- orders by updated_at DESC. These composite indices let the per-branch
-- ORDER BY ... LIMIT 6 run as index scans instead of full-table sorts.
CREATE INDEX IF NOT EXISTS idx_project_notes_workspace_updated
    ON project_notes(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_concept_nodes_workspace_updated
    ON concept_nodes(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sources_workspace_updated
    ON sources(workspace_id, updated_at DESC);

-- Workspace last_message_at trigger (v42 + v46 fix)
-- Only advances last_message_at; never walks it backwards for out-of-order inserts.
DROP TRIGGER IF EXISTS update_workspace_last_message_at;
CREATE TRIGGER update_workspace_last_message_at
AFTER INSERT ON messages
BEGIN
    UPDATE workspaces
    SET last_message_at = NEW.created_at
    WHERE id = (SELECT workspace_id FROM chat_sessions WHERE id = NEW.session_id)
      AND (last_message_at IS NULL OR NEW.created_at > last_message_at);
END;
