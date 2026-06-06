pub fn cosine_similarity(v1: &[f32], v2: &[f32]) -> f32 {
    if v1.len() != v2.len() {
        return 0.0;
    }
    let dot_product: f32 = v1.iter().zip(v2.iter()).map(|(a, b)| a * b).sum();
    let norm1: f32 = v1.iter().map(|a| a * a).sum::<f32>().sqrt();
    let norm2: f32 = v2.iter().map(|a| a * a).sum::<f32>().sqrt();
    if norm1 == 0.0 || norm2 == 0.0 {
        return 0.0;
    }
    dot_product / (norm1 * norm2)
}

pub fn bytes_to_f32_vec(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
        .collect()
}

pub fn f32_vec_to_bytes(vec: &[f32]) -> Vec<u8> {
    vec.iter().flat_map(|&f| f.to_le_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity() {
        let v1 = vec![1.0, 0.0, 0.0];
        let v2 = vec![1.0, 0.0, 0.0];
        assert_eq!(cosine_similarity(&v1, &v2), 1.0);

        let v1 = vec![1.0, 0.0, 0.0];
        let v2 = vec![0.0, 1.0, 0.0];
        assert_eq!(cosine_similarity(&v1, &v2), 0.0);

        let v1 = vec![1.0];
        let v2 = vec![1.0, 2.0];
        assert_eq!(cosine_similarity(&v1, &v2), 0.0); // Different lengths

        let v1 = vec![0.0, 0.0];
        let v2 = vec![1.0, 1.0];
        assert_eq!(cosine_similarity(&v1, &v2), 0.0); // Zero norm
    }

    #[test]
    fn test_bytes_conversion() {
        let orig_vec = vec![1.0f32, 2.0, -3.5, 0.0, 42.42];
        let bytes = f32_vec_to_bytes(&orig_vec);
        let decoded = bytes_to_f32_vec(&bytes);

        assert_eq!(orig_vec, decoded);
    }
}
