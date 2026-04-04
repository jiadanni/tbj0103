use crate::db::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub result_type: String,
    pub title: String,
    pub excerpt: String,
    pub score: f64,
    pub source_id: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    pub workspace_id: String,
    pub project_id: Option<String>,
    pub limit: Option<i64>,
}

/// Keyword search across notes, chat messages, concepts, and documents.
/// Full semantic search requires embeddings from the Ollama service — handled async from the frontend.
#[tauri::command]
pub fn keyword_search(
    state: State<DbState>,
    req: SearchRequest,
) -> Result<Vec<SearchResult>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let limit = req.limit.unwrap_or(20);
    let pattern = format!("%{}%", req.query.to_lowercase());
    let mut results: Vec<SearchResult> = Vec::new();

    // Search concept nodes
    let mut stmt = conn
        .prepare(
            "SELECT id, name, concept_description FROM concept_nodes
         WHERE workspace_id = ?1 AND (lower(name) LIKE ?2 OR lower(concept_description) LIKE ?2)
         ORDER BY name LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let concepts = stmt
        .query_map(rusqlite::params![req.workspace_id, pattern, limit], |row| {
            let name: String = row.get(1)?;
            let desc: String = row.get(2)?;
            Ok(SearchResult {
                id: row.get(0)?,
                result_type: "concept".to_string(),
                title: name.clone(),
                excerpt: desc.chars().take(120).collect(),
                score: 1.0,
                source_id: None,
                project_id: None,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    results.extend(concepts);

    // Search chat messages (optionally scoped to project)
    let msg_query = if req.project_id.is_some() {
        "SELECT m.id, cs.title, m.content, cs.project_id FROM messages m
         JOIN chat_sessions cs ON m.session_id = cs.id
         WHERE cs.project_id = ?3 AND lower(m.content) LIKE ?2
         ORDER BY m.created_at DESC LIMIT ?4"
    } else {
        "SELECT m.id, cs.title, m.content, cs.project_id FROM messages m
         JOIN chat_sessions cs ON m.session_id = cs.id
         JOIN projects p ON cs.project_id = p.id
         WHERE p.workspace_id = ?1 AND lower(m.content) LIKE ?2
         ORDER BY m.created_at DESC LIMIT ?4"
    };
    let project_filter = req.project_id.as_deref().unwrap_or("");
    let mut stmt2 = conn.prepare(msg_query).map_err(|e| e.to_string())?;
    let messages = stmt2
        .query_map(
            rusqlite::params![req.workspace_id, pattern, project_filter, limit],
            |row| {
                let content: String = row.get(2)?;
                let excerpt: String = content.chars().take(120).collect();
                Ok(SearchResult {
                    id: row.get(0)?,
                    result_type: "message".to_string(),
                    title: row.get(1)?,
                    excerpt,
                    score: 0.9,
                    source_id: None,
                    project_id: row.get(3)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    results.extend(messages);

    // Search project notes (workspace-scoped)
    let mut stmt3 = conn
        .prepare(
            "SELECT n.id, n.title, n.content, n.workspace_id FROM project_notes n
         WHERE n.workspace_id = ?1 AND (lower(n.title) LIKE ?2 OR lower(n.content) LIKE ?2)
         ORDER BY n.updated_at DESC LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let notes = stmt3
        .query_map(rusqlite::params![req.workspace_id, pattern, limit], |row| {
            let content: String = row.get(2)?;
            Ok(SearchResult {
                id: row.get(0)?,
                result_type: "note".to_string(),
                title: row.get(1)?,
                excerpt: content.chars().take(120).collect(),
                score: 0.85,
                source_id: None,
                project_id: None,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    results.extend(notes);

    // Sort by score desc and truncate
    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(limit as usize);
    Ok(results)
}

/// Semantic search — receives pre-computed embedding from frontend (via Ollama),
/// computes cosine similarity against stored chunk embeddings.
#[tauri::command]
pub fn semantic_search(
    state: State<DbState>,
    req: SearchRequest,
    query_embedding: Vec<f32>,
    workspace_id: String,
) -> Result<Vec<SearchResult>, String> {
    let limit = req.limit.unwrap_or(10) as usize;

    // Fetch raw rows from DB, then release the lock before computing cosine similarity.
    let raw_rows: Vec<(String, String, String, Vec<u8>, String)>;
    {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT sc.id, sc.source_id, sc.content, sc.embedding, s.title
             FROM source_chunks sc
             JOIN sources s ON sc.source_id = s.id
             WHERE s.workspace_id = ?1 AND sc.embedding IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(rusqlite::params![workspace_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Vec<u8>>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        raw_rows = rows.filter_map(Result::ok).collect();
    } // DB lock released here

    // Compute cosine similarity outside the lock in parallel
    use rayon::prelude::*;
    let mut scored: Vec<(f64, SearchResult)> = raw_rows
        .into_par_iter()
        .filter_map(|(chunk_id, doc_id, content, emb_blob, filename)| {
            let embedding = crate::services::vector_index::bytes_to_f32_vec(&emb_blob);
            if embedding.is_empty() {
                return None;
            }
            let score =
                crate::ollama::client::cosine_similarity(&query_embedding, &embedding) as f64;
            let excerpt: String = content.chars().take(200).collect();
            Some((
                score,
                SearchResult {
                    id: chunk_id,
                    result_type: "document_chunk".to_string(),
                    title: filename,
                    excerpt,
                    score,
                    source_id: Some(doc_id),
                    project_id: None,
                },
            ))
        })
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let results = scored.into_iter().take(limit).map(|(_, r)| r).collect();
    Ok(results)
}
