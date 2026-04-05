use crate::models::artifact::{Artifact, ArtifactSummary, CreateArtifactRequest};
use crate::services::context_assembler::estimate_tokens;
use crate::services::vector_index::{bytes_to_f32_vec, cosine_similarity, f32_vec_to_bytes};
use rusqlite::Connection;

pub fn store_artifact_embedding(
    conn: &Connection,
    artifact_id: &str,
    embedding: &[f32],
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let bytes = f32_vec_to_bytes(embedding);
    conn.execute(
        "INSERT OR REPLACE INTO artifact_embeddings (artifact_id, embedding, model, created_at)
         VALUES (?1, ?2, 'nomic-embed-text', ?3)",
        rusqlite::params![artifact_id, bytes, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn search_artifacts_semantic(
    conn: &Connection,
    workspace_id: &str,
    query_embedding: &[f32],
    limit: usize,
) -> Result<Vec<(ArtifactSummary, f32)>, String> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.title, a.artifact_type, a.language, a.description, a.tags, a.is_pinned, a.version, a.updated_at, ae.embedding
         FROM artifacts a
         JOIN artifact_embeddings ae ON a.id = ae.artifact_id
         WHERE a.workspace_id = ?1"
    ).map_err(|e| e.to_string())?;

    let mut results: Vec<(ArtifactSummary, f32)> = stmt
        .query_map(rusqlite::params![workspace_id], |row| {
            let embedding_bytes: Vec<u8> = row.get(9)?;
            let artifact_embedding = bytes_to_f32_vec(&embedding_bytes);
            let score = cosine_similarity(query_embedding, &artifact_embedding);

            let tags_json: String = row.get(5)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            Ok((
                ArtifactSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    artifact_type: row.get(2)?,
                    language: row.get(3)?,
                    description: row.get(4)?,
                    tags,
                    is_pinned: row.get::<_, i32>(6)? != 0,
                    version: row.get(7)?,
                    updated_at: row.get(8)?,
                },
                score,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);
    Ok(results)
}

pub fn create_artifact(conn: &Connection, req: CreateArtifactRequest) -> Result<Artifact, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let token_count = estimate_tokens(&req.content) as i32;
    let tags_json =
        serde_json::to_string(&req.tags.unwrap_or_default()).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO artifacts (id, workspace_id, session_id, message_id, title, artifact_type, language, content, description, tags, is_pinned, version, parent_artifact_id, token_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, 1, ?11, ?12, ?13, ?14)",
        rusqlite::params![
            id, req.workspace_id, req.session_id, req.message_id,
            req.title, req.artifact_type, req.language, req.content,
            req.description, tags_json, req.parent_artifact_id,
            token_count, now, now
        ],
    ).map_err(|e| e.to_string())?;

    get_artifact(conn, &id)
}

pub fn get_artifact(conn: &Connection, id: &str) -> Result<Artifact, String> {
    conn.query_row(
        "SELECT id, workspace_id, session_id, message_id, title, artifact_type, language, content, description, tags, is_pinned, version, parent_artifact_id, token_count, created_at, updated_at
         FROM artifacts WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(Artifact {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                session_id: row.get(2)?,
                message_id: row.get(3)?,
                title: row.get(4)?,
                artifact_type: row.get(5)?,
                language: row.get(6)?,
                content: row.get(7)?,
                description: row.get(8)?,
                tags: row.get(9)?,
                is_pinned: row.get::<_, i32>(10)? != 0,
                version: row.get(11)?,
                parent_artifact_id: row.get(12)?,
                token_count: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        },
    ).map_err(|e| e.to_string())
}

pub fn list_artifacts(
    conn: &Connection,
    workspace_id: &str,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<ArtifactSummary>, String> {
    let limit = limit.unwrap_or(200).clamp(1, 1000);
    let offset = offset.unwrap_or(0).max(0);
    let mut stmt = conn.prepare(
        "SELECT id, title, artifact_type, language, description, tags, is_pinned, version, updated_at
         FROM artifacts WHERE workspace_id = ?1 ORDER BY is_pinned DESC, updated_at DESC
         LIMIT ?2 OFFSET ?3"
    ).map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map(rusqlite::params![workspace_id, limit, offset], |row| {
            let tags_json: String = row.get(5)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(ArtifactSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                artifact_type: row.get(2)?,
                language: row.get(3)?,
                description: row.get(4)?,
                tags,
                is_pinned: row.get::<_, i32>(6)? != 0,
                version: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    iter.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn delete_artifact(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM artifacts WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_artifact_pin(conn: &Connection, id: &str, is_pinned: bool) -> Result<(), String> {
    let pin_val = if is_pinned { 1 } else { 0 };
    conn.execute(
        "UPDATE artifacts SET is_pinned = ?1 WHERE id = ?2",
        rusqlite::params![pin_val, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
