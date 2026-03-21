use tauri::AppHandle;
use serde::{Deserialize, Serialize};
use crate::ollama::client::{OllamaClient, OllamaMessage, ModelInfo};

pub struct StreamAbortState(pub std::sync::Mutex<std::collections::HashMap<String, bool>>);

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

#[tauri::command]
pub async fn generate_follow_ups(
    model: String,
    messages: Vec<OllamaMessage>,
    ollama_url: Option<String>,
) -> Result<Vec<String>, String> {
    let client = OllamaClient::new(ollama_url);

    let mut prompt_messages = messages;
    prompt_messages.push(OllamaMessage {
        role: "user".to_string(),
        content: "Based on this conversation, suggest exactly 3 short follow-up questions the user might ask next.\nReturn ONLY a JSON array of strings, no markdown: [\"question 1\", \"question 2\", \"question 3\"]".to_string(),
    });

    let raw = client.send_message(&model, prompt_messages).await?;
    let json_str = extract_json_array(&raw);
    serde_json::from_str::<Vec<String>>(&json_str)
        .map_err(|e| format!("Failed to parse follow-ups: {e} — raw: {raw}"))
}

/// Extracts key topics from a list of text snippets (chat titles, note titles, etc.)
/// using Ollama. Returns a JSON array of { topic, weight } objects.
/// Falls back to an empty array if the model is unavailable.
#[tauri::command]
pub async fn extract_topics(
    texts: Vec<String>,
    model: String,
    ollama_url: Option<String>,
) -> Result<Vec<TopicEntry>, String> {
    if texts.is_empty() {
        return Ok(vec![]);
    }

    let combined: String = texts
        .iter()
        .take(60)
        .cloned()
        .collect::<Vec<_>>()
        .join(" | ");

    let prompt = format!(
        "Analyze these text snippets and identify the 10-15 most important knowledge topics being studied:\n\n\
        {combined}\n\n\
        Return ONLY a JSON array like: \
        [{{\"topic\":\"Machine Learning\",\"weight\":9}},{{\"topic\":\"Rust Programming\",\"weight\":6}}]\n\
        Use meaningful multi-word topics, not single generic words. \
        Weight 1-10 based on how prominent the topic is. No explanation, just the JSON array."
    );

    let client = OllamaClient::new(ollama_url);
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];

    let raw = client.send_message(&model, messages).await?;

    // Parse the JSON array from the response (model may wrap it in markdown)
    let json_str = extract_json_array(&raw);
    serde_json::from_str::<Vec<TopicEntry>>(&json_str)
        .map_err(|e| format!("Failed to parse topics: {e} — raw: {raw}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicEntry {
    pub topic: String,
    pub weight: u32,
}

/// Extracts the first JSON array `[...]` substring from a raw model response.
fn extract_json_array(s: &str) -> String {
    if let (Some(start), Some(end)) = (s.find('['), s.rfind(']')) {
        s[start..=end].to_string()
    } else {
        "[]".to_string()
    }
}

/// Cancel an in-progress stream for the given session.
#[tauri::command]
pub async fn stop_stream(session_id: String, state: tauri::State<'_, StreamAbortState>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(session_id, true);
    Ok(())
}
