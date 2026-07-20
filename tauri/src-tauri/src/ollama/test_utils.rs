/// Shared helpers for tests that require a live Ollama instance.
///
/// These tests are `#[ignore]`d by default so `cargo test` and CI stay fast
/// and offline. Run them explicitly with `npm run test:ollama:rust` (or
/// `cargo test -- --ignored`) against a running `ollama serve` with a
/// 7B+ model pulled.
#[cfg(test)]
pub mod tests {
    const DEFAULT_BASE_URL: &str = "http://localhost:11434";

    /// Skips the calling test (returns early) if no Ollama instance is
    /// reachable at `http://localhost:11434`, rather than failing the whole
    /// run — keeps `--ignored` runs usable on a machine with Ollama
    /// installed but not currently started.
    ///
    /// Usage:
    /// ```ignore
    /// #[tokio::test]
    /// #[ignore = "requires live Ollama instance"]
    /// async fn real_chat_completion_round_trips() {
    ///     if !require_ollama().await { return; }
    ///     // ... exercise the real client against localhost:11434
    /// }
    /// ```
    pub async fn require_ollama() -> bool {
        let reachable = reqwest::Client::new()
            .get(format!("{DEFAULT_BASE_URL}/api/tags"))
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);

        if !reachable {
            eprintln!(
                "skipping: no Ollama instance reachable at {DEFAULT_BASE_URL} \
                 (start it with `ollama serve` and pull a model)"
            );
        }
        reachable
    }
}
