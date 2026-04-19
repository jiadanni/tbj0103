use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickSearchResult {
    pub doc_id: String,
    pub target_id: String,
    pub kind: String,
    pub title: String,
    pub subtitle: String,
    pub excerpt: String,
    pub workspace_id: Option<String>,
    pub workspace_name: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub session_id: Option<String>,
    pub source_session_id: Option<String>,
    pub updated_at: String,
    pub score: f64,
    pub recent: bool,
}

pub fn query(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<QuickSearchResult>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return recent_results(conn, limit);
    }

    let fts_query = build_fts_query(trimmed).ok_or_else(|| "Enter a search query.".to_string())?;
    query_filtered(conn, &fts_query, limit, None, None, None)
}

pub fn query_filtered(
    conn: &Connection,
    fts_query: &str,
    limit: usize,
    workspace_id: Option<&str>,
    exclude_session_id: Option<&str>,
    kind_filter: Option<&str>,
) -> Result<Vec<QuickSearchResult>, String> {
    let mut where_clauses = vec!["quick_search_documents_fts MATCH ?1"];
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(fts_query.to_string())];

    if let Some(ws_id) = workspace_id {
        where_clauses.push("d.workspace_id = ?2");
        params.push(Box::new(ws_id.to_string()));
    }

    if let Some(ex_sid) = exclude_session_id {
        where_clauses.push("d.session_id != ?3");
        params.push(Box::new(ex_sid.to_string()));
    }

    if let Some(kind) = kind_filter {
        // Use the next positional param index
        let next_idx = params.len() + 1;
        where_clauses.push(Box::leak(format!("d.kind = ?{}", next_idx).into_boxed_str()));
        params.push(Box::new(kind.to_string()));
    }

    let where_sql = where_clauses.join(" AND ");
    // Deduplicate by session_id so one chat only appears once even if many of
    // its rows (messages, summaries) all match the query.
    let sql = format!(
        r#"
        SELECT
            d.doc_id,
            d.target_id,
            d.kind,
            d.title,
            d.subtitle,
            d.body,
            d.workspace_id,
            COALESCE(w.name, ''),
            NULLIF(d.project_id, ''),
            NULLIF(COALESCE(p.name, ''), ''),
            d.session_id,
            d.source_session_id,
            d.updated_at,
            COALESCE(snippet(quick_search_documents_fts, 2, '', '', ' ... ', 18), ''),
            bm25(quick_search_documents_fts, 8.0, 2.0, 1.0)
        FROM quick_search_documents_fts
        JOIN quick_search_documents d ON d.rowid = quick_search_documents_fts.rowid
        LEFT JOIN workspaces w ON w.id = d.workspace_id
        LEFT JOIN projects p ON p.id = d.project_id
        WHERE {}
        GROUP BY d.session_id
        ORDER BY bm25(quick_search_documents_fts, 8.0, 2.0, 1.0) ASC, d.updated_at DESC
        LIMIT ?{}
    "#,
        where_sql,
        params.len() + 1
    );

    params.push(Box::new(limit as i64));
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            let body: String = row.get(5)?;
            let snippet: String = row.get(13)?;
            let excerpt = if snippet.trim().is_empty() {
                truncate_plaintext(&body, 180)
            } else {
                collapse_whitespace(&snippet)
            };

            Ok(QuickSearchResult {
                doc_id: row.get(0)?,
                target_id: row.get(1)?,
                kind: row.get(2)?,
                title: row.get(3)?,
                subtitle: row.get(4)?,
                excerpt,
                workspace_id: row.get(6)?,
                workspace_name: row.get(7)?,
                project_id: row.get(8)?,
                project_name: row.get(9)?,
                session_id: row.get(10)?,
                source_session_id: row.get(11)?,
                updated_at: row.get(12)?,
                score: row.get(14)?,
                recent: false,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn recent_results(conn: &Connection, limit: usize) -> Result<Vec<QuickSearchResult>, String> {
    let sql = r#"
        SELECT
            'session:' || cs.id,
            cs.id,
            'conversation',
            cs.title,
            'Recent chat',
            COALESCE((
                SELECT m.content
                FROM messages m
                WHERE m.session_id = cs.id
                ORDER BY m.created_at DESC
                LIMIT 1
            ), ''),
            cs.workspace_id,
            COALESCE(w.name, ''),
            NULLIF(cs.project_id, ''),
            NULLIF(COALESCE(p.name, ''), ''),
            cs.id,
            NULL,
            COALESCE(cs.last_accessed_at, cs.updated_at)
        FROM chat_sessions cs
        LEFT JOIN workspaces w ON w.id = cs.workspace_id
        LEFT JOIN projects p ON p.id = cs.project_id
        WHERE cs.is_deleted = 0
        ORDER BY COALESCE(cs.last_accessed_at, cs.updated_at) DESC, cs.updated_at DESC
        LIMIT ?1
    "#;

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit as i64], |row| {
            let excerpt: String = row.get(5)?;
            Ok(QuickSearchResult {
                doc_id: row.get(0)?,
                target_id: row.get(1)?,
                kind: row.get(2)?,
                title: row.get(3)?,
                subtitle: row.get(4)?,
                excerpt: truncate_plaintext(&excerpt, 180),
                workspace_id: row.get(6)?,
                workspace_name: row.get(7)?,
                project_id: row.get(8)?,
                project_name: row.get(9)?,
                session_id: row.get(10)?,
                source_session_id: row.get(11)?,
                updated_at: row.get(12)?,
                score: 0.0,
                recent: true,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn build_fts_query(input: &str) -> Option<String> {
    let terms = input
        .split_whitespace()
        .filter_map(|term| {
            let cleaned = term
                .trim_matches(|c: char| c.is_ascii_punctuation() && c != '-' && c != '_')
                .replace('"', "");
            if cleaned.is_empty() {
                None
            } else {
                Some(format!("\"{}\"*", cleaned))
            }
        })
        .collect::<Vec<_>>();

    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" AND "))
    }
}

fn truncate_plaintext(input: &str, max_chars: usize) -> String {
    let collapsed = collapse_whitespace(input);
    let mut chars = collapsed.chars();
    let preview = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{preview}…")
    } else {
        preview
    }
}

fn collapse_whitespace(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}
