/// MLX LM HTTP Client
/// Connects to a local MLX server (mlx_lm.server) (default: http://localhost:8080).
/// Supports OpenAI-compatible chat completions with streaming.
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use crate::commands::ollama::StreamAbortState;
use crate::ollama::client::StreamEvent;

const DEFAULT_BASE_URL: &str = "http://localhost:8080";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlxMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<MlxMessage>,
    pub stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionResponse {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<Choice>,
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Choice {
    pub index: u32,
    pub message: Option<MlxMessage>,
    pub delta: Option<Delta>,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Delta {
    pub role: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlxModelInfo {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlxModelsList {
    pub data: Vec<MlxModelInfo>,
}

pub struct MlxClient {
    client: Client,
    pub base_url: String,
}

impl MlxClient {
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

    fn should_abort(app: &AppHandle, session_id: &str) -> Result<bool, String> {
        let abort_state = app.state::<StreamAbortState>();
        let abort_map = abort_state
            .0
            .lock()
            .map_err(|e| e.to_string())?;
        let should_abort = abort_map
            .get(session_id)
            .copied()
            .unwrap_or(false);
        Ok(should_abort)
    }

    pub(crate) fn clear_abort_flag(app: &AppHandle, session_id: &str) -> Result<(), String> {
        let abort_state = app.state::<StreamAbortState>();
        let mut abort_map = abort_state
            .0
            .lock()
            .map_err(|e| e.to_string())?;
        abort_map.remove(session_id);
        Ok(())
    }

    /// Stream a chat response, emitting chunks as Tauri events.
    /// Uses OpenAI-compatible SSE format.
    /// Event name: "ollama-stream-{session_id}" (reusing same prefix for frontend consistency)
    pub async fn stream_message(
        &self,
        app: &AppHandle,
        session_id: &str,
        model: &str,
        messages: Vec<MlxMessage>,
    ) -> Result<String, String> {
        Self::clear_abort_flag(app, session_id)?;
        let url = format!("{}/v1/chat/completions", self.base_url);
        let body = json!({
            "model": model,
            "messages": messages,
            "stream": true
        });

        let response = self.client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("MLX connection error: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("MLX error {status}: {text}"));
        }

        let mut full_response = String::new();
        let mut stream = response.bytes_stream();
        let mut stream_done = false;
        let event_name = format!("ollama-stream-{session_id}");

        loop {
            if Self::should_abort(app, session_id)? {
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
                let line = line.trim();
                if line.is_empty() { continue; }
                if line == "data: [DONE]" {
                    stream_done = true;
                    break;
                }

                if let Some(json_str) = line.strip_prefix("data: ") {
                    if let Ok(parsed) = serde_json::from_str::<ChatCompletionResponse>(json_str) {
                        if let Some(choice) = parsed.choices.first() {
                            if let Some(delta) = &choice.delta {
                                if let Some(content) = &delta.content {
                                    full_response.push_str(content);
                                    let _ = app.emit(&event_name, StreamEvent {
                                        session_id: session_id.to_string(),
                                        chunk: content.clone(),
                                        done: false,
                                        tokens_used: None,
                                        duration_ms: None,
                                    });
                                }
                            }

                            if choice.finish_reason.is_some() {
                                stream_done = true;
                                break;
                            }
                        }
                    }
                }
            }
            if stream_done { break; }
        }

        // Final event
        let _ = app.emit(&event_name, StreamEvent {
            session_id: session_id.to_string(),
            chunk: String::new(),
            done: true,
            tokens_used: None,
            duration_ms: None,
        });

        Self::clear_abort_flag(app, session_id)?;
        Ok(full_response)
    }

    /// Fetch list of available models from MLX server.
    pub async fn list_models(&self) -> Result<Vec<MlxModelInfo>, String> {
        let url = format!("{}/v1/models", self.base_url);
        let response = self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch MLX models: {e}"))?;

        if !response.status().is_success() {
            return Err(format!("MLX returned status {}", response.status()));
        }

        let models_list: MlxModelsList = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse MLX models list: {e}"))?;

        Ok(models_list.data)
    }
}
