use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::services::workspace_hierarchy::descendant_workspace_ids;

pub const QUICK_SEARCH_KIND_FILTERS: [&str; 5] =
    ["conversation", "message", "artifact", "memory", "summary"];

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
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
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
    workspace_id: Option<&str>,
    kind_filters: Option<&[String]>,
    include_descendants: bool,
) -> Result<Vec<QuickSearchResult>, String> {
    let effective_kind_filters = normalize_kind_filters(kind_filters);
    let resolved_ids = resolve_workspace_ids(conn, workspace_id, include_descendants)?;
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return recent_results(
            conn,
            limit,
            resolved_ids.as_deref(),
            effective_kind_filters.as_deref(),
        );
    }

    let fts_query = build_fts_query(trimmed).ok_or_else(|| "Enter a search query.".to_string())?;
    query_filtered(
        conn,
        &fts_query,
        limit,
        resolved_ids.as_deref(),
        None,
        effective_kind_filters.as_deref(),
    )
}

pub fn query_filtered(
    conn: &Connection,
    fts_query: &str,
    limit: usize,
    workspace_ids: Option<&[String]>,
    exclude_session_id: Option<&str>,
    kind_filters: Option<&[String]>,
) -> Result<Vec<QuickSearchResult>, String> {
    let mut where_clauses = vec!["quick_search_documents_fts MATCH ?1".to_string()];
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(fts_query.to_string())];

    if let Some(ws_ids) = workspace_ids {
        if ws_ids.len() == 1 {
            where_clauses.push(format!("d.workspace_id = ?{}", params.len() + 1));
            params.push(Box::new(ws_ids[0].clone()));
        } else if !ws_ids.is_empty() {
            let mut placeholders = Vec::with_capacity(ws_ids.len());
            for ws_id in ws_ids {
                placeholders.push(format!("?{}", params.len() + 1));
                params.push(Box::new(ws_id.clone()));
            }
            where_clauses.push(format!("d.workspace_id IN ({})", placeholders.join(", ")));
        }
    }

    if let Some(ex_sid) = exclude_session_id {
        where_clauses.push(format!("d.session_id != ?{}", params.len() + 1));
        params.push(Box::new(ex_sid.to_string()));
    }

    if let Some(kinds) = kind_filters {
        if !kinds.is_empty() {
            let mut placeholders = Vec::with_capacity(kinds.len());
            for kind in kinds {
                placeholders.push(format!("?{}", params.len() + 1));
                params.push(Box::new(kind.clone()));
            }
            where_clauses.push(format!("d.kind IN ({})", placeholders.join(", ")));
        }
    }

    let where_sql = where_clauses.join(" AND ");
    // Deduplicate by session_id so one chat only appears once even if many of
    // its rows (messages, summaries) all match the query.
    //
    // Split into two CTEs to satisfy SQLite's FTS5 constraints:
    //   - FTS5 auxiliary functions (bm25, snippet) cannot be used in the same
    //     SELECT as window functions (ROW_NUMBER) — SQLite rejects it with
    //     "unable to use function snippet in the requested context" for OR queries.
    //   - GROUP BY with FTS5 functions is also rejected.
    // Solution: materialise the FTS results first (fts_matches AS MATERIALIZED),
    // then apply ROW_NUMBER in a second CTE over the plain temp table.
    let sql = format!(
        r#"
        WITH fts_matches AS MATERIALIZED (
            SELECT
                d.doc_id,
                d.target_id,
                d.kind,
                d.title,
                d.subtitle,
                d.body,
                d.workspace_id,
                COALESCE(w.name, '') AS workspace_name,
                NULLIF(d.folder_id, '') AS folder_id,
                NULLIF(COALESCE(p.name, ''), '') AS folder_name,
                d.session_id,
                d.source_session_id,
                d.updated_at,
                COALESCE(snippet(quick_search_documents_fts, 2, '', '', ' ... ', 18), '') AS snip,
                bm25(quick_search_documents_fts, 8.0, 2.0, 1.0) AS score
            FROM quick_search_documents_fts
            JOIN quick_search_documents d ON d.rowid = quick_search_documents_fts.rowid
            LEFT JOIN workspaces w ON w.id = d.workspace_id
            LEFT JOIN folders p ON p.id = d.folder_id
            WHERE {}
        ),
        ranked AS (
            SELECT *,
                ROW_NUMBER() OVER (
                    PARTITION BY COALESCE(session_id, doc_id)
                    ORDER BY score ASC, updated_at DESC
                ) AS rn
            FROM fts_matches
        )
        SELECT doc_id, target_id, kind, title, subtitle, body,
               workspace_id, workspace_name, folder_id, folder_name,
               session_id, source_session_id, updated_at, snip, score
        FROM ranked
        WHERE rn = 1
        ORDER BY score ASC, updated_at DESC
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
            let clean_body = sanitize_quick_search_text(&body);
            let clean_snippet = sanitize_quick_search_text(&snippet);
            let excerpt = if snippet.trim().is_empty() {
                truncate_plaintext(&clean_body, 180)
            } else {
                collapse_whitespace(&clean_snippet)
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
                folder_id: row.get(8)?,
                folder_name: row.get(9)?,
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

fn resolve_workspace_ids(
    conn: &Connection,
    workspace_id: Option<&str>,
    include_descendants: bool,
) -> Result<Option<Vec<String>>, String> {
    let ws_id = match workspace_id {
        Some(id) => id,
        None => return Ok(None),
    };
    if include_descendants {
        let ids = descendant_workspace_ids(conn, ws_id)?;
        Ok(Some(ids))
    } else {
        Ok(Some(vec![ws_id.to_string()]))
    }
}

fn recent_results(
    conn: &Connection,
    limit: usize,
    workspace_ids: Option<&[String]>,
    kind_filters: Option<&[String]>,
) -> Result<Vec<QuickSearchResult>, String> {
    if matches!(kind_filters, Some(kinds) if !kinds.iter().any(|kind| kind == "conversation")) {
        return Ok(vec![]);
    }

    let mut sql = String::from(
        r#"
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
            NULLIF(cs.folder_id, ''),
            NULLIF(COALESCE(p.name, ''), ''),
            cs.id,
            NULL,
            COALESCE(cs.last_accessed_at, cs.updated_at)
        FROM chat_sessions cs
        LEFT JOIN workspaces w ON w.id = cs.workspace_id
        LEFT JOIN folders p ON p.id = cs.folder_id
        WHERE cs.is_deleted = 0
    "#,
    );

    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(ws_ids) = workspace_ids {
        if ws_ids.len() == 1 {
            sql.push_str(" AND cs.workspace_id = ?1");
            params.push(Box::new(ws_ids[0].clone()));
        } else if !ws_ids.is_empty() {
            let mut placeholders = Vec::with_capacity(ws_ids.len());
            for ws_id in ws_ids {
                placeholders.push(format!("?{}", params.len() + 1));
                params.push(Box::new(ws_id.clone()));
            }
            sql.push_str(&format!(
                " AND cs.workspace_id IN ({})",
                placeholders.join(", ")
            ));
        }
    }

    sql.push_str(
        r#"
        ORDER BY COALESCE(cs.last_accessed_at, cs.updated_at) DESC, cs.updated_at DESC
        LIMIT ?"#,
    );
    sql.push_str(&(params.len() + 1).to_string());

    params.push(Box::new(limit as i64));
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            let excerpt: String = row.get(5)?;
            Ok(QuickSearchResult {
                doc_id: row.get(0)?,
                target_id: row.get(1)?,
                kind: row.get(2)?,
                title: row.get(3)?,
                subtitle: row.get(4)?,
                excerpt: truncate_plaintext(&sanitize_quick_search_text(&excerpt), 180),
                workspace_id: row.get(6)?,
                workspace_name: row.get(7)?,
                folder_id: row.get(8)?,
                folder_name: row.get(9)?,
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

fn normalize_kind_filters(kind_filters: Option<&[String]>) -> Option<Vec<String>> {
    let kind_filters = kind_filters?;

    let mut normalized = Vec::new();
    for kind in kind_filters {
        if QUICK_SEARCH_KIND_FILTERS.contains(&kind.as_str())
            && !normalized.iter().any(|existing| existing == kind)
        {
            normalized.push(kind.clone());
        }
    }

    if normalized.is_empty() || normalized.len() == QUICK_SEARCH_KIND_FILTERS.len() {
        None
    } else {
        Some(normalized)
    }
}

pub(crate) fn build_fts_query(input: &str) -> Option<String> {
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

fn sanitize_quick_search_text(input: &str) -> String {
    let mut sanitized = input.to_string();
    for marker in [
        "<|start|>",
        "<|assistant|>",
        "<|user|>",
        "<|system|>",
        "<|channel|>",
        "<|message|>",
        "<|final|>",
    ] {
        sanitized = sanitized.replace(marker, " ");
    }

    collapse_whitespace(&sanitized)
}
