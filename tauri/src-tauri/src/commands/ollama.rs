use tauri::{AppHandle, State};
use serde::{Deserialize, Serialize};
use crate::db::DbState;
use crate::ollama::client::{OllamaClient, OllamaMessage, ModelInfo};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub session_id: String,
    pub model: String,
    pub messages: Vec<OllamaMessage>,
    pub stream: bool,
    pub ollama_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingRequest {
    pub text: String,
    pub model: Option<String>,
    pub ollama_url: Option<String>,
}

/// Send a chat message (streaming or non-streaming).
/// For streaming: emits "ollama-stream-{session_id}" events to frontend.
#[tauri::command]
pub async fn send_message(app: AppHandle, req: SendMessageRequest) -> Result<String, String> {
    let client = OllamaClient::new(req.ollama_url);
    if req.stream {
        client.stream_message(&app, &req.session_id, &req.model, req.messages).await
    } else {
        client.send_message(&req.model, req.messages).await
    }
}

#[tauri::command]
pub async fn list_models(ollama_url: Option<String>) -> Result<Vec<ModelInfo>, String> {
    let client = OllamaClient::new(ollama_url);
    client.list_models().await
}

#[tauri::command]
pub async fn generate_title(model: String, first_message: String, ollama_url: Option<String>) -> Result<String, String> {
    let client = OllamaClient::new(ollama_url);
    client.generate_title(&model, &first_message).await
}

#[tauri::command]
pub async fn generate_embedding(req: EmbeddingRequest) -> Result<Vec<f32>, String> {
    let client = OllamaClient::new(req.ollama_url);
    let model = req.model.as_deref().unwrap_or("nomic-embed-text");
    client.generate_embedding(model, &req.text).await
}
