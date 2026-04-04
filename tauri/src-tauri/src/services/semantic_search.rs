//! Semantic search helpers.
//! The main search command is in commands/search.rs.
//! This module exposes the cosine-similarity utility for use in retrieval_engine.

/// Compute cosine similarity between two equal-length float vectors.
/// Returns a value in [-1, 1]; higher means more similar.
use ndarray::ArrayView1;

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let a_arr = ArrayView1::from(a);
    let b_arr = ArrayView1::from(b);

    let dot = a_arr.dot(&b_arr);
    let mag_a = a_arr.dot(&a_arr).sqrt();
    let mag_b = b_arr.dot(&b_arr).sqrt();

    if mag_a == 0.0 || mag_b == 0.0 {
        0.0
    } else {
        dot / (mag_a * mag_b)
    }
}
