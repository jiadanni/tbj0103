//! RAG retrieval engine.
//! Fetches the most relevant document chunks for a query embedding
//! and builds a grounded prompt string for Ollama.

use rusqlite::Connection;
use crate::services::semantic_search::cosine_similarity;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrievedChunk {
    pub chunk_id: String,
    pub document_id: String,
    pub filename: String,
    pub content: String,
    pub score: f32,
    pub chunk_index: i64,
}

/// Return the top-`k` document chunks most similar to `query_embedding`
/// within the given workspace.
pub fn get_relevant_chunks(
    conn: &Connection,
    workspace_id: &str,
    query_embedding: &[f32],
    top_k: usize,
) -> Result<Vec<RetrievedChunk>, String> {
    let mut stmt = conn.prepare(
        "SELECT sc.id, sc.source_id, COALESCE(s.filename, s.title), sc.content, sc.embedding, sc.chunk_index
         FROM source_chunks sc
         JOIN sources s ON sc.source_id = s.id
         WHERE s.workspace_id = ?1 AND s.source_type = 'document' AND sc.embedding IS NOT NULL"
    ).map_err(|e| e.to_string())?;

    let mut scored: Vec<(f32, RetrievedChunk)> = stmt.query_map(
        rusqlite::params![workspace_id],
        |row| Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, i64>(5)?,
        ))
    ).map_err(|e| e.to_string())?
    .filter_map(Result::ok)
    .filter_map(|(chunk_id, doc_id, filename, content, emb_json, chunk_index)| {
        let embedding: Vec<f32> = serde_json::from_str(&emb_json).ok()?;
        let score = cosine_similarity(query_embedding, &embedding);
        Some((score, RetrievedChunk { chunk_id, document_id: doc_id, filename, content, score, chunk_index }))
    })
    .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    Ok(scored.into_iter().take(top_k).map(|(_, c)| c).collect())
}

/// Build a grounded system prompt that injects retrieved chunks as context.
pub fn build_grounded_prompt(user_message: &str, chunks: &[RetrievedChunk]) -> String {
    if chunks.is_empty() {
        return user_message.to_string();
    }
    let context_block = chunks
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let excerpt: String = c.content.chars().take(600).collect();
            format!("[{}] **{}** (chunk {}): {}", i + 1, c.filename, c.chunk_index, excerpt)
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    format!(
        "You are a helpful assistant with access to the following document context.\n\n\
         CONTEXT:\n{context_block}\n\n\
         USER QUESTION: {user_message}\n\n\
         Answer based on the provided context. Cite source numbers like [1], [2] when referencing specific content."
    )
}
