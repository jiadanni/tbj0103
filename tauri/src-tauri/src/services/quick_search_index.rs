use rusqlite::Connection;

pub fn ensure_populated(conn: &Connection) -> Result<(), String> {
    let document_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM quick_search_documents", [], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;

    if document_count > 0 || source_row_count(conn)? == 0 {
        return Ok(());
    }

    rebuild(conn)
}

pub fn rebuild(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        BEGIN IMMEDIATE;
        DELETE FROM quick_search_documents;
        INSERT OR REPLACE INTO quick_search_documents (
            doc_id, target_id, kind, workspace_id, folder_id, session_id, source_session_id, title, subtitle, body, updated_at
        )
        SELECT
            'session:' || cs.id,
            cs.id,
            'conversation',
            cs.workspace_id,
            NULLIF(cs.folder_id, ''),
            cs.id,
            NULL,
            cs.title,
            'Conversation',
            '',
            cs.updated_at
        FROM chat_sessions cs
        WHERE cs.is_deleted = 0;

        INSERT OR REPLACE INTO quick_search_documents (
            doc_id, target_id, kind, workspace_id, folder_id, session_id, source_session_id, title, subtitle, body, updated_at
        )
        SELECT
            'message:' || m.id,
            m.id,
            'message',
            cs.workspace_id,
            NULLIF(cs.folder_id, ''),
            m.session_id,
            NULL,
            cs.title,
            CASE m.role
                WHEN 'assistant' THEN 'Assistant reply'
                WHEN 'system' THEN 'System message'
                ELSE 'User message'
            END,
            m.content,
            m.created_at
        FROM messages m
        JOIN chat_sessions cs ON cs.id = m.session_id
        WHERE cs.is_deleted = 0;

        INSERT OR REPLACE INTO quick_search_documents (
            doc_id, target_id, kind, workspace_id, folder_id, session_id, source_session_id, title, subtitle, body, updated_at
        )
        SELECT
            'artifact:' || a.id,
            a.id,
            'artifact',
            a.workspace_id,
            NULLIF(COALESCE(cs.folder_id, ''), ''),
            a.session_id,
            NULL,
            a.title,
            CASE
                WHEN a.language IS NOT NULL AND a.language != '' THEN a.artifact_type || ' • ' || a.language
                ELSE a.artifact_type
            END,
            TRIM(COALESCE(a.description, '') || CHAR(10) || CHAR(10) || COALESCE(a.content, '')),
            a.updated_at
        FROM artifacts a
        LEFT JOIN chat_sessions cs ON cs.id = a.session_id;

        INSERT OR REPLACE INTO quick_search_documents (
            doc_id, target_id, kind, workspace_id, folder_id, session_id, source_session_id, title, subtitle, body, updated_at
        )
        SELECT
            'memory:' || m.id,
            m.id,
            'memory',
            m.workspace_id,
            NULLIF(m.folder_id, ''),
            NULL,
            m.source_session_id,
            CASE m.memory_type
                WHEN 'preference' THEN 'Preference'
                WHEN 'context' THEN 'Context'
                ELSE 'Fact'
            END,
            CASE m.scope
                WHEN 'global' THEN 'Global memory'
                ELSE 'Workspace memory'
            END,
            m.content,
            m.updated_at
        FROM memories m;

        INSERT OR REPLACE INTO quick_search_documents (
            doc_id, target_id, kind, workspace_id, folder_id, session_id, source_session_id, title, subtitle, body, updated_at
        )
        SELECT
            'summary:' || s.id,
            s.id,
            'summary',
            s.workspace_id,
            NULLIF(cs.folder_id, ''),
            s.session_id,
            NULL,
            cs.title,
            s.summary_type || ' summary',
            s.content,
            s.updated_at
        FROM conversation_summaries s
        JOIN chat_sessions cs ON cs.id = s.session_id
        WHERE cs.is_deleted = 0;
        COMMIT;
        "#,
    )
    .map_err(|e| e.to_string())
}

fn source_row_count(conn: &Connection) -> Result<i64, String> {
    let counts = [
        "SELECT COUNT(*) FROM chat_sessions WHERE is_deleted = 0",
        "SELECT COUNT(*) FROM messages",
        "SELECT COUNT(*) FROM artifacts",
        "SELECT COUNT(*) FROM memories",
        "SELECT COUNT(*) FROM conversation_summaries",
    ];

    let mut total = 0_i64;
    for query in counts {
        let count: i64 = conn
            .query_row(query, [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        total += count;
    }
    Ok(total)
}
