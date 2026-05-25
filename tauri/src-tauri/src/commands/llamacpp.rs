#[cfg(feature = "llamacpp")]
use crate::llamacpp::worker::{ChatMessage, InferenceRequest, LlamacppWorkerState};
use serde::Deserialize;
#[cfg(feature = "llamacpp")]
use std::collections::HashMap;
#[cfg(feature = "llamacpp")]
use std::sync::Mutex;
#[cfg(feature = "llamacpp")]
use tauri::State;
#[cfg(feature = "llamacpp")]
use tokio::sync::oneshot;

#[cfg(feature = "llamacpp")]
pub struct LlamacppCancelState(pub Mutex<HashMap<String, oneshot::Sender<()>>>);

#[derive(Deserialize)]
pub struct SendLlamacppRequest {
    pub session_id: String,
    pub model_path: String,
    #[cfg(feature = "llamacpp")]
    pub messages: Vec<ChatMessage>,
}

#[cfg(feature = "llamacpp")]
#[tauri::command]
pub async fn send_llamacpp_message(
    state: State<'_, LlamacppWorkerState>,
    cancel_state: State<'_, LlamacppCancelState>,
    req: SendLlamacppRequest,
) -> Result<(), String> {
    let (cancel_tx, cancel_rx) = oneshot::channel();

    // Store cancel_tx
    {
        let mut map = cancel_state.0.lock().map_err(|e| e.to_string())?;
        map.insert(req.session_id.clone(), cancel_tx);
    }

    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(InferenceRequest {
        session_id: req.session_id,
        messages: req.messages,
        model_path: req.model_path,
        cancel_rx,
    })
    .map_err(|e| e.to_string())
}

#[cfg(not(feature = "llamacpp"))]
#[tauri::command]
pub async fn send_llamacpp_message(req: SendLlamacppRequest) -> Result<(), String> {
    let _ = req;
    Err("llama.cpp support is disabled in this build".to_string())
}

#[cfg(feature = "llamacpp")]
#[tauri::command]
pub fn stop_llamacpp_stream(
    session_id: String,
    cancel_state: State<'_, LlamacppCancelState>,
) -> Result<(), String> {
    let mut map = cancel_state.0.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = map.remove(&session_id) {
        let _ = tx.send(());
    }
    Ok(())
}

#[cfg(not(feature = "llamacpp"))]
#[tauri::command]
pub fn stop_llamacpp_stream(session_id: String) -> Result<(), String> {
    let _ = session_id;
    Ok(())
}

#[tauri::command]
pub fn list_llamacpp_models(model_paths: Vec<String>) -> Result<Vec<String>, String> {
    Ok(model_paths
        .into_iter()
        .filter(|p| std::path::Path::new(p).exists())
        .collect())
}
