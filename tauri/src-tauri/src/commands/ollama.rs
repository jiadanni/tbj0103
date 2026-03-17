use tauri::AppHandle;
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DualModelRequest {
    pub session_id: String,
    pub draft_model: String,
    pub refine_model: String,
    pub messages: Vec<OllamaMessage>,
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
pub async fn generate_title_from_conversation(
    model: String,
    conversation: Vec<OllamaMessage>,
    ollama_url: Option<String>,
) -> Result<String, String> {
    let client = OllamaClient::new(ollama_url);
    client.generate_title_from_conversation(&model, conversation).await
}

#[tauri::command]
pub async fn generate_embedding(req: EmbeddingRequest) -> Result<Vec<f32>, String> {
    let client = OllamaClient::new(req.ollama_url);
    let model = req.model.as_deref().unwrap_or("nomic-embed-text");
    client.generate_embedding(model, &req.text).await
}

/// Dual-model chat: streams the draft (small) model first via "ollama-stream-{session_id}",
/// then streams the refine (large) model via "ollama-refine-{session_id}" events.
/// The frontend shows the draft answer instantly and upgrades it when the refinement arrives.
#[tauri::command]
pub async fn send_dual_model_message(app: AppHandle, req: DualModelRequest) -> Result<String, String> {
    let client = OllamaClient::new(req.ollama_url);

    // Phase 1: stream the fast/draft model
    client.stream_message(&app, &req.session_id, &req.draft_model, req.messages.clone()).await?;

    // Phase 2: stream the large/refine model (separate event channel)
    client.stream_refine_message(&app, &req.session_id, &req.refine_model, req.messages).await
}
