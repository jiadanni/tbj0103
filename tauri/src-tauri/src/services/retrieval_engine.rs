//! RAG retrieval engine.
//! Fetches the most relevant document chunks for a query embedding
//! and builds a grounded prompt string for Ollama.

use crate::services::semantic_search::cosine_similarity;
use rusqlite::Connection;
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
    let mut stmt = conn
        .prepare(
            "SELECT sc.id, sc.embedding
         FROM source_chunks sc
         JOIN sources s ON sc.source_id = s.id
         WHERE s.workspace_id = ?1 AND s.source_type = 'document' AND sc.embedding IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;

    let raw_rows: Vec<(String, Vec<u8>)> = stmt
        .query_map(rusqlite::params![workspace_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    use rayon::prelude::*;
    let mut scored: Vec<(f32, String)> = raw_rows
        .into_par_iter()
        .filter_map(|(chunk_id, emb_blob)| {
            let embedding = crate::services::vector_index::bytes_to_f32_vec(&emb_blob);
            if embedding.is_empty() {
                return None;
            }
            let score = cosine_similarity(query_embedding, &embedding);
            Some((score, chunk_id))
        })
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(top_k);

    if scored.is_empty() {
        return Ok(Vec::new());
    }

    let chunk_ids: Vec<String> = scored.iter().map(|(_, id)| id.clone()).collect();
    let placeholders = chunk_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let query = format!(
        "SELECT sc.id, sc.source_id, COALESCE(s.filename, s.title), sc.content, sc.chunk_index
         FROM source_chunks sc
         JOIN sources s ON sc.source_id = s.id
         WHERE sc.id IN ({})",
        placeholders
    );
    let mut fetch_stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let mut chunk_map = std::collections::HashMap::new();
    let params = rusqlite::params_from_iter(chunk_ids.iter());

    let rows = fetch_stmt
        .query_map(params, |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows.filter_map(Result::ok) {
        chunk_map.insert(row.0.clone(), row);
    }

    let mut results = Vec::new();
    for (score, id) in scored {
        if let Some((chunk_id, doc_id, filename, content, chunk_index)) = chunk_map.remove(&id) {
            results.push(RetrievedChunk {
                chunk_id,
                document_id: doc_id,
                filename,
                content,
                score,
                chunk_index,
            });
        }
    }

    Ok(results)
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
            format!(
                "[{}] **{}** (chunk {}): {}",
                i + 1,
                c.filename,
                c.chunk_index,
                excerpt
            )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_grounded_prompt() {
        let chunks = vec![
            RetrievedChunk {
                chunk_id: "c1".to_string(),
                document_id: "d1".to_string(),
                filename: "doc1.txt".to_string(),
                content: "This is some test content about rust.".to_string(),
                score: 0.9,
                chunk_index: 0,
            },
            RetrievedChunk {
                chunk_id: "c2".to_string(),
                document_id: "d2".to_string(),
                filename: "doc2.md".to_string(),
                content: "Tauri is great for desktop apps.".to_string(),
                score: 0.8,
                chunk_index: 1,
            },
        ];

        let prompt = build_grounded_prompt("What is Tauri?", &chunks);

        assert!(prompt.contains("doc1.txt"));
        assert!(prompt.contains("doc2.md"));
        assert!(prompt.contains("Tauri is great for desktop apps."));
        assert!(prompt.contains("What is Tauri?"));
        assert!(prompt.starts_with("You are a helpful assistant"));
    }

    #[test]
    fn test_build_grounded_prompt_empty() {
        let prompt = build_grounded_prompt("Just a question", &[]);
        assert_eq!(prompt, "Just a question");
    }
}
