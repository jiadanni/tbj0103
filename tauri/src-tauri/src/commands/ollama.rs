use crate::ollama::client::{ModelInfo, OllamaClient, OllamaMessage};
use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};
use tauri::AppHandle;
use tokio::sync::oneshot;

pub struct StreamAbortEntry {
    pub aborted: bool,
    pub cancel_tx: Option<oneshot::Sender<()>>,
}

pub struct StreamAbortState(
    pub std::sync::Mutex<std::collections::HashMap<String, StreamAbortEntry>>,
);
const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub session_id: String,
    pub model: String,
    pub messages: Vec<OllamaMessage>,
    pub stream: bool,
    pub ollama_url: Option<String>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingRequest {
    pub text: String,
    pub model: Option<String>,
    pub ollama_url: Option<String>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DualModelRequest {
    pub session_id: String,
    pub draft_model: String,
    pub refine_model: String,
    pub messages: Vec<OllamaMessage>,
    pub execution_mode: Option<String>,
    pub ollama_url: Option<String>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaRuntimeStatus {
    pub available: bool,
    pub launched: bool,
    pub message: String,
    pub models: Vec<ModelInfo>,
}

fn context(
    request_id: Option<String>,
    command_name: &'static str,
    session_id: Option<&str>,
    model: Option<&str>,
    stream: Option<bool>,
) -> crate::ollama::client::RequestContext {
    crate::ollama::client::RequestContext {
        request_id,
        command_name: Some(command_name),
        session_id: session_id.map(ToOwned::to_owned),
        model: model.map(ToOwned::to_owned),
        stream,
    }
}

/// Send a chat message (streaming or non-streaming).
/// For streaming: emits "ollama-stream-{session_id}" events to frontend.
#[tauri::command]
pub async fn send_message(app: AppHandle, req: SendMessageRequest) -> Result<String, String> {
    let client = OllamaClient::new(req.ollama_url)?;
    let ctx = context(
        req.request_id.clone(),
        "send_message",
        Some(&req.session_id),
        Some(&req.model),
        Some(req.stream),
    );
    if req.stream {
        client
            .stream_message_observed(&app, &req.session_id, &req.model, req.messages, &ctx)
            .await
    } else {
        client
            .send_message_observed(&req.model, req.messages, &ctx)
            .await
    }
}

#[tauri::command]
pub async fn list_models(
    ollama_url: Option<String>,
    request_id: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    let client = OllamaClient::new(ollama_url)?;
    let ctx = context(request_id, "list_models", None, None, Some(false));
    client.list_models_observed(&ctx).await
}

/// Same as list_models but bypasses the process-level cache.
/// Called from the frontend's `listModelsFresh` (e.g., Preferences refresh button).
#[tauri::command]
pub async fn list_models_fresh(
    ollama_url: Option<String>,
    request_id: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    let client = OllamaClient::new(ollama_url)?;
    client.invalidate_model_cache();
    let ctx = context(request_id, "list_models_fresh", None, None, Some(false));
    client.list_models_observed(&ctx).await
}

#[tauri::command]
pub async fn ensure_ollama_running(
    ollama_url: Option<String>,
    request_id: Option<String>,
) -> Result<OllamaRuntimeStatus, String> {
    let normalized_url = ollama_url
        .clone()
        .unwrap_or_else(|| DEFAULT_OLLAMA_URL.to_string())
        .trim_end_matches('/')
        .to_string();

    let client = OllamaClient::new(Some(normalized_url.clone()))?;
    let ctx = context(
        request_id.clone(),
        "ensure_ollama_running",
        None,
        None,
        Some(false),
    );
    if let Ok(models) = client.list_models_observed(&ctx).await {
        return Ok(runtime_status(models, false));
    }

    if normalized_url != DEFAULT_OLLAMA_URL {
        return Err(format!(
            "Ollama is not reachable at {normalized_url}. Automatic startup is only supported for {DEFAULT_OLLAMA_URL}."
        ));
    }

    launch_ollama_process()?;

    for _ in 0..10 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let retry_client = OllamaClient::new(Some(normalized_url.clone()))?;
        if let Ok(models) = retry_client.list_models_observed(&ctx).await {
            return Ok(runtime_status(models, true));
        }
    }

    Err("Tried to launch Ollama, but it did not become reachable. Run `ollama serve` manually and try again.".to_string())
}

#[tauri::command]
pub async fn generate_title(
    model: String,
    first_message: String,
    ollama_url: Option<String>,
    request_id: Option<String>,
) -> Result<String, String> {
    let client = OllamaClient::new(ollama_url)?;
    let ctx = context(
        request_id,
        "generate_title",
        None,
        Some(&model),
        Some(false),
    );
    client
        .generate_title_observed(&model, &first_message, &ctx)
        .await
}

#[tauri::command]
pub async fn generate_title_from_conversation(
    model: String,
    conversation: Vec<OllamaMessage>,
    ollama_url: Option<String>,
    request_id: Option<String>,
) -> Result<String, String> {
    let client = OllamaClient::new(ollama_url)?;
    let ctx = context(
        request_id,
        "generate_title_from_conversation",
        None,
        Some(&model),
        Some(false),
    );
    client
        .generate_title_from_conversation_observed(&model, conversation, &ctx)
        .await
}

#[tauri::command]
pub async fn generate_embedding(req: EmbeddingRequest) -> Result<Vec<f32>, String> {
    let client = OllamaClient::new(req.ollama_url)?;
    let model = req.model.as_deref().unwrap_or("nomic-embed-text");
    let ctx = context(
        req.request_id,
        "generate_embedding",
        None,
        Some(model),
        Some(false),
    );
    client
        .generate_embedding_observed(model, &req.text, &ctx)
        .await
}

/// Dual-model chat: streams the draft (small) model first via "ollama-stream-{session_id}",
/// then streams the refine (large) model via "ollama-refine-{session_id}" events.
/// The frontend shows the draft answer instantly and upgrades it when the refinement arrives.
#[tauri::command]
pub async fn send_dual_model_message(
    app: AppHandle,
    req: DualModelRequest,
) -> Result<String, String> {
    let client = OllamaClient::new(req.ollama_url)?;
    let execution_mode = req.execution_mode.as_deref().unwrap_or("serial");
    let draft_ctx = context(
        req.request_id.clone(),
        "send_dual_model_message:draft",
        Some(&req.session_id),
        Some(&req.draft_model),
        Some(true),
    );
    let refine_ctx = context(
        req.request_id.clone(),
        "send_dual_model_message:refine",
        Some(&req.session_id),
        Some(&req.refine_model),
        Some(true),
    );

    match execution_mode {
        "serial" => {
            client
                .stream_message_observed(
                    &app,
                    &req.session_id,
                    &req.draft_model,
                    req.messages.clone(),
                    &draft_ctx,
                )
                .await?;
            client
                .stream_refine_message_observed(
                    &app,
                    &req.session_id,
                    &req.refine_model,
                    req.messages,
                    &refine_ctx,
                )
                .await
        }
        "parallel" => {
            OllamaClient::clear_abort_flag(&app, &req.session_id)?;
            let result = tokio::try_join!(
                client.stream_message_unmanaged_observed(
                    &app,
                    &req.session_id,
                    &req.draft_model,
                    req.messages.clone(),
                    &draft_ctx
                ),
                client.stream_refine_message_unmanaged_observed(
                    &app,
                    &req.session_id,
                    &req.refine_model,
                    req.messages,
                    &refine_ctx
                )
            );
            OllamaClient::clear_abort_flag(&app, &req.session_id)?;
            let (_, refine_response) = result?;
            Ok(refine_response)
        }
        other => Err(format!("Unsupported dual-model execution mode: {other}")),
    }
}

#[tauri::command]
pub async fn generate_follow_ups(
    model: String,
    messages: Vec<OllamaMessage>,
    ollama_url: Option<String>,
    request_id: Option<String>,
) -> Result<Vec<String>, String> {
    let client = OllamaClient::new(ollama_url)?;
    let ctx = context(
        request_id,
        "generate_follow_ups",
        None,
        Some(&model),
        Some(false),
    );

    let mut prompt_messages = messages;
    prompt_messages.push(OllamaMessage {
        role: "user".to_string(),
        content: "Based on this conversation, suggest exactly 3 short follow-up questions the user might ask next.\nReturn ONLY a JSON array of strings, no markdown: [\"question 1\", \"question 2\", \"question 3\"]".to_string(),
    });

    let raw = client
        .send_message_observed(&model, prompt_messages, &ctx)
        .await?;
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
    request_id: Option<String>,
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

    let client = OllamaClient::new(ollama_url)?;
    let ctx = context(
        request_id,
        "extract_topics",
        None,
        Some(&model),
        Some(false),
    );
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];

    let raw = client.send_message_observed(&model, messages, &ctx).await?;

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
pub async fn stop_stream(
    session_id: String,
    state: tauri::State<'_, StreamAbortState>,
) -> Result<(), String> {
    let mut abort_map = state.0.lock().map_err(|e| e.to_string())?;
    let entry = abort_map.entry(session_id).or_insert(StreamAbortEntry {
        aborted: false,
        cancel_tx: None,
    });
    entry.aborted = true;
    if let Some(cancel_tx) = entry.cancel_tx.take() {
        let _ = cancel_tx.send(());
    }
    Ok(())
}

fn runtime_status(models: Vec<ModelInfo>, launched: bool) -> OllamaRuntimeStatus {
    let model_count = models.len();
    let message = if launched {
        format!("Ollama started successfully. {model_count} model(s) found.")
    } else {
        format!("Ollama is running. {model_count} model(s) found.")
    };

    OllamaRuntimeStatus {
        available: true,
        launched,
        message,
        models,
    }
}

fn launch_ollama_process() -> Result<(), String> {
    Command::new("ollama")
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch `ollama serve`: {e}"))
}
