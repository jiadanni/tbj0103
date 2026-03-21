/// Ollama HTTP Client
/// Ported from Services/OllamaService.swift
///
/// Connects to a local Ollama instance (default: http://localhost:11434).
/// Supports chat, streaming, embeddings, and model listing.
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use crate::commands::ollama::StreamAbortState;

const DEFAULT_BASE_URL: &str = "http://localhost:11434";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<OllamaMessage>,
    pub stream: bool,
    pub options: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub model: String,
    pub message: OllamaMessage,
    pub done: bool,
    pub total_duration: Option<i64>,
    pub eval_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    pub model: String,
    pub message: OllamaMessage,
    pub done: bool,
    pub eval_count: Option<i64>,
    pub total_duration: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingRequest {
    pub model: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingResponse {
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub size: Option<i64>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagsResponse {
    pub models: Vec<ModelInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub session_id: String,
    pub chunk: String,
    pub done: bool,
    pub tokens_used: Option<i64>,
    pub duration_ms: Option<i64>,
}

pub struct OllamaClient {
    client: Client,
    pub base_url: String,
}

impl OllamaClient {
    fn clear_abort_flag(app: &AppHandle, session_id: &str) -> Result<(), String> {
        let abort_state = app.state::<StreamAbortState>();
        let mut abort_map = abort_state
            .0
            .lock()
            .map_err(|e: std::sync::PoisonError<std::sync::MutexGuard<'_, std::collections::HashMap<String, bool>>>| e.to_string())?;
        abort_map.remove(session_id);
        Ok(())
    }

    fn should_abort(app: &AppHandle, session_id: &str) -> Result<bool, String> {
        let abort_state = app.state::<StreamAbortState>();
        let abort_map = abort_state
            .0
            .lock()
            .map_err(|e: std::sync::PoisonError<std::sync::MutexGuard<'_, std::collections::HashMap<String, bool>>>| e.to_string())?;
        let should_abort = abort_map
            .get(session_id)
            .copied()
            .unwrap_or(false);
        Ok(should_abort)
    }

    pub fn new(base_url: Option<String>) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .expect("Failed to build HTTP client");
        Self {
            client,
            base_url: base_url.unwrap_or_else(|| DEFAULT_BASE_URL.to_string()),
        }
    }

    /// Resolves the requested model name to an available one, with fallback logic.
    pub async fn resolve_model(&self, requested: &str) -> Result<String, String> {
        let models = self.list_models().await?;
        if models.is_empty() {
            return Err("No Ollama models found. Please install a model using 'ollama pull llama3' or 'ollama pull qwen2.5' and ensure Ollama is running.".to_string());
        }

        // 1. Exact match
        if models.iter().any(|m| m.name == requested) {
            return Ok(requested.to_string());
        }

        // 2. Base name match (e.g. "llama3" matching "llama3:latest")
        if let Some(m) = models.iter().find(|m| m.name.starts_with(&format!("{}:", requested))) {
            return Ok(m.name.clone());
        }

        // 3. Fallback to first available non-embedding model
        let chat_fallback = models.iter()
            .find(|m| !m.name.contains("embed"))
            .map(|m| m.name.clone());

        if let Some(fb) = chat_fallback {
            return Ok(fb);
        }

        // 4. Absolute fallback to first model
        Ok(models[0].name.clone())
    }

    /// Send a single non-streaming message and return the full response.
    pub async fn send_message(
        &self,
        model: &str,
        messages: Vec<OllamaMessage>,
    ) -> Result<String, String> {
        let resolved_model = self.resolve_model(model).await?;
        let url = format!("{}/api/chat", self.base_url);
        let body = json!({
            "model": resolved_model,
            "messages": messages,
            "stream": false
        });

        let response = self.client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Ollama connection error: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Ollama error {status}: {text}"));
        }

        let chat_response: ChatResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {e}"))?;

        Ok(chat_response.message.content)
    }

    /// Internal helper: stream a chat response and emit events with a given prefix.
    /// The event emitted is "{event_prefix}{session_id}".
    async fn stream_with_prefix(
        &self,
        app: &AppHandle,
        session_id: &str,
        model: &str,
        messages: Vec<OllamaMessage>,
        event_prefix: &str,
    ) -> Result<String, String> {
        Self::clear_abort_flag(app, session_id)?;
        let resolved_model = self.resolve_model(model).await?;
        let url = format!("{}/api/chat", self.base_url);
        let body = json!({
            "model": resolved_model,
            "messages": messages,
            "stream": true
        });

        let response = self.client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Ollama connection error: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Ollama error {status}: {text}"));
        }

        let mut full_response = String::new();
        let mut stream = response.bytes_stream();
        let mut stream_done = false;

        loop {
            if Self::should_abort(app, session_id)? {
                stream_done = true;
                break;
            }

            let chunk_result = tokio::select! {
                next_chunk = stream.next() => next_chunk,
                _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {
                    continue;
                }
            };

            let Some(chunk_result) = chunk_result else {
                break;
            };
            let chunk = chunk_result.map_err(|e| format!("Stream error: {e}"))?;
            let text = std::str::from_utf8(&chunk).map_err(|e| format!("UTF-8 error: {e}"))?;

            for line in text.lines() {
                if line.is_empty() { continue; }
                if let Ok(parsed) = serde_json::from_str::<StreamChunk>(line) {
                    let content = parsed.message.content.clone();
                    full_response.push_str(&content);

                    let event_name = format!("{event_prefix}{session_id}");
                    if parsed.done {
                        let duration_ms = parsed.total_duration.map(|ns| ns / 1_000_000);
                        let _ = app.emit(&event_name, StreamEvent {
                            session_id: session_id.to_string(),
                            chunk: content,
                            done: true,
                            tokens_used: parsed.eval_count,
                            duration_ms,
                        });
                        stream_done = true;
                        break;
                    } else {
                        let _ = app.emit(&event_name, StreamEvent {
                            session_id: session_id.to_string(),
                            chunk: content,
                            done: false,
                            tokens_used: None,
                            duration_ms: None,
                        });
                    }
                }
            }
            if stream_done { break; }
        }

        if !stream_done {
            let _ = app.emit(&format!("{event_prefix}{session_id}"), StreamEvent {
                session_id: session_id.to_string(),
                chunk: String::new(),
                done: true,
                tokens_used: None,
                duration_ms: None,
            });
        }
        Self::clear_abort_flag(app, session_id)?;

        Ok(full_response)
    }

    /// Stream a chat response, emitting chunks as Tauri events.
    /// Event name: "ollama-stream-{session_id}"
    pub async fn stream_message(
        &self,
        app: &AppHandle,
        session_id: &str,
        model: &str,
        messages: Vec<OllamaMessage>,
    ) -> Result<String, String> {
        self.stream_with_prefix(app, session_id, model, messages, "ollama-stream-").await
    }

    /// Stream the refined (large-model) response, emitting chunks as Tauri events.
    /// Event name: "ollama-refine-{session_id}"
    pub async fn stream_refine_message(
        &self,
        app: &AppHandle,
        session_id: &str,
        model: &str,
        messages: Vec<OllamaMessage>,
    ) -> Result<String, String> {
        self.stream_with_prefix(app, session_id, model, messages, "ollama-refine-").await
    }

    /// Generate an embedding vector for the given text.
    pub async fn generate_embedding(&self, model: &str, text: &str) -> Result<Vec<f32>, String> {
        // Embeddings usually need a specific model, so we don't resolve_model here 
        // to avoid accidentally using a chat model for embeddings.
        let url = format!("{}/api/embeddings", self.base_url);
        let body = json!({ "model": model, "prompt": text });

        let response = self.client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Embedding request failed: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Ollama error {status}: {text}"));
        }

        let emb: EmbeddingResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse embedding: {e}"))?;

        Ok(emb.embedding)
    }

    /// Fetch list of locally available models.
    pub async fn list_models(&self) -> Result<Vec<ModelInfo>, String> {
        let url = format!("{}/api/tags", self.base_url);
        let response = self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch models: {e}"))?;

        if !response.status().is_success() {
            return Err(format!("Ollama returned status {}", response.status()));
        }

        let tags: TagsResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse models list: {e}"))?;

        Ok(tags.models)
    }

    /// Generate a short title for a chat session given the first user message.
    pub async fn generate_title(&self, model: &str, first_message: &str) -> Result<String, String> {
        let prompt = format!(
            "Generate a short (3-6 word) title for a conversation that starts with: \"{first_message}\". \
            Output ONLY the title, no quotes, no punctuation at the end."
        );
        let messages = vec![OllamaMessage {
            role: "user".to_string(),
            content: prompt,
        }];
        let title = self.send_message(model, messages).await?;
        Ok(title.trim().to_string())
    }

    /// Generate a title from a full conversation history (for periodic refresh).
    pub async fn generate_title_from_conversation(
        &self,
        model: &str,
        conversation: Vec<OllamaMessage>,
    ) -> Result<String, String> {
        // Build a summary of the conversation for the title prompt
        let summary: String = conversation
            .iter()
            .filter(|m| m.role == "user")
            .take(10)
            .map(|m| {
                let truncated: String = m.content.chars().take(200).collect();
                format!("- {truncated}")
            })
            .collect::<Vec<_>>()
            .join("\n");

        let prompt = format!(
            "Based on this conversation, generate a short (3-6 word) title that captures the main topic.\n\n\
            User messages:\n{summary}\n\n\
            Output ONLY the title, no quotes, no punctuation at the end."
        );
        let messages = vec![OllamaMessage {
            role: "user".to_string(),
            content: prompt,
        }];
        let title = self.send_message(model, messages).await?;
        Ok(title.trim().to_string())
    }
}

/// Cosine similarity between two embedding vectors.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity_identical() {
        let v = vec![1.0f32, 2.0, 3.0];
        assert!((cosine_similarity(&v, &v) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0f32, 0.0];
        let b = vec![0.0f32, 1.0];
        assert!((cosine_similarity(&a, &b)).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_empty() {
        assert_eq!(cosine_similarity(&[], &[]), 0.0);
    }
}
