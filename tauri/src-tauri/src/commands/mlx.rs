use tauri::AppHandle;
use serde::{Deserialize, Serialize};
use crate::mlx::client::{MlxClient, MlxMessage, MlxModelInfo};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMlxRequest {
    pub session_id: String,
    pub model: String,
    pub messages: Vec<MlxMessage>,
    pub mlx_url: Option<String>,
}

#[tauri::command]
pub async fn send_mlx_message(app: AppHandle, req: SendMlxRequest) -> Result<String, String> {
    let client = MlxClient::new(req.mlx_url);
    client.stream_message(&app, &req.session_id, &req.model, req.messages).await
}

#[tauri::command]
pub async fn list_mlx_models(mlx_url: Option<String>) -> Result<Vec<MlxModelInfo>, String> {
    let client = MlxClient::new(mlx_url);
    client.list_models().await
}
